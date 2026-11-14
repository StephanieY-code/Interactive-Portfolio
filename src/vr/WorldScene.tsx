import { OrbitControls, useGLTF } from "@react-three/drei"
import { useFrame, useThree } from "@react-three/fiber"
import type { ThreeEvent } from "@react-three/fiber"
import { IfInSessionMode, TeleportTarget, XROrigin } from "@react-three/xr"
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import * as THREE from "three"
import type { GLTF } from "three/examples/jsm/loaders/GLTFLoader.js"
import { RectAreaLightUniformsLib } from "three/examples/jsm/lights/RectAreaLightUniformsLib.js"
import { MORPH_TIMELINE, easeInOut, phase, type Morph, type ViewRect } from "./morph"
import type { CoverCamera, TouchableGroup, VRWorld, WorldSettings } from "./worlds"

RectAreaLightUniformsLib.init()

type Vec3 = [number, number, number]

/** A light as written by scripts/blender/export_world.py. */
type LightRecord = {
  name: string
  type: "point" | "spot" | "sun" | "area"
  color: Vec3
  position: Vec3
  direction: Vec3
  up?: Vec3
  intensity: number
  angle?: number
  blend?: number
  width?: number
  height?: number
  shadow: boolean
  softness: number
}

/** Blender's color look (Render Properties > Color Management). */
type ColorView = { transform?: string; exposure?: number }

/** Blender's color look as a 3D color table, made by export_world.py. */
type ViewLut = { size: number; min: number; max: number; data: string }

// Compressed models are unpacked by the Draco decoder in public/draco/.
const DRACO_PATH = `${import.meta.env.BASE_URL}draco/`

/** A camera view: what it looks at, from which side, and how wide. */
type Pose = {
  target: THREE.Vector3
  /** From the target toward the camera (length 1). */
  direction: THREE.Vector3
  /** Half the width of scene in view, at the target (meters). */
  halfWidth: number
  /** Horizontal field of view (radians). */
  hfov: number
}

// A flat-looking view: a very long lens from far away, like Blender's
// orthographic camera (the drawing's view starts like this).
const FLAT_FOV = THREE.MathUtils.degToRad(6)

type PreparedWorld = {
  background: THREE.Color
  /** What's drawn behind the world: a plain color already in Blender's
   * color look, or a tiny image that the web's color look is applied to. */
  backdrop: THREE.Color | THREE.Texture
  /** Lighting was baked by Cycles, so no extra world light is added. */
  baked: boolean
  toneMapping: THREE.ToneMapping
  toneMappingExposure: number
  fogNear: number
  lights: THREE.Object3D[]
  /** Pieces that react to pointing and clicking (removed from the scene). */
  touchables: THREE.Object3D[]
  touchClips: Map<THREE.Object3D, THREE.AnimationClip[]>
  loopClips: THREE.AnimationClip[]
  /** Everything below is in real-world meters (scale already applied). */
  cameraPosition: THREE.Vector3
  target: THREE.Vector3
  horizontalFov: number
  /** The view the cover drawing matches, and the view the 3D world opens on. */
  coverPose: Pose
  openPose: Pose
  /** Width / height of the Blender render (the drawing's shape). */
  renderAspect: number
  /** How far the world reaches from its middle (meters). */
  sceneRadius: number
  spawn: THREE.Vector3
  spawnYaw: number
  teleportCenter: THREE.Vector3
  teleportRadius: number
}

const prepared = new WeakMap<GLTF, PreparedWorld>()

const materialsOf = (mesh: THREE.Mesh) =>
  Array.isArray(mesh.material) ? mesh.material : [mesh.material]

// three.js tidies Blender names ("Cube.007" becomes "Cube007"), so patterns
// written with Blender names are tidied the same way before comparing.
const tidy = (name: string) => THREE.PropertyBinding.sanitizeNodeName(name)
const nameMatches = (name: string, pattern: string) =>
  pattern.endsWith("*")
    ? name.startsWith(tidy(pattern.slice(0, -1)))
    : name === tidy(pattern)

const hasAncestorIn = (object: THREE.Object3D, set: THREE.Object3D[]) => {
  for (let o = object.parent; o; o = o.parent) if (set.includes(o)) return true
  return false
}

function makeLights(records: LightRecord[], scale: number, shadows: boolean) {
  const objects: THREE.Object3D[] = []
  const configureShadow = (
    light: THREE.SpotLight | THREE.DirectionalLight,
    record: LightRecord,
  ) => {
    if (!shadows || !record.shadow) return
    light.castShadow = true
    light.shadow.mapSize.set(1024, 1024)
    light.shadow.bias = -0.0003
    light.shadow.normalBias = 0.02
    light.shadow.radius = THREE.MathUtils.clamp(1 + record.softness * 3, 1, 6)
  }

  for (const record of records) {
    const color = new THREE.Color(...record.color)
    const position = new THREE.Vector3(...record.position)
    const aim = position.clone().add(new THREE.Vector3(...record.direction))
    // Lights live inside the scaled world, so point/spot brightness is
    // adjusted to keep the same look when the world is resized.
    const pointIntensity = record.intensity * scale * scale

    if (record.type === "spot") {
      const light = new THREE.SpotLight(
        color,
        pointIntensity,
        0,
        record.angle ?? Math.PI / 4,
        record.blend ?? 0,
        2,
      )
      light.position.copy(position)
      light.target.position.copy(aim)
      configureShadow(light, record)
      objects.push(light, light.target)
    } else if (record.type === "point") {
      const light = new THREE.PointLight(color, pointIntensity, 0, 2)
      light.position.copy(position)
      objects.push(light)
    } else if (record.type === "sun") {
      const light = new THREE.DirectionalLight(color, record.intensity)
      light.position.copy(position)
      light.target.position.copy(aim)
      configureShadow(light, record)
      const camera = light.shadow.camera
      camera.left = camera.bottom = -8
      camera.right = camera.top = 8
      camera.far = 60
      objects.push(light, light.target)
    } else if (record.type === "area" && shadows && record.shadow) {
      // Web area lights can't cast shadows, and shadows matter more (trees
      // and walls blocking the light, like in the render), so this one
      // becomes a wide, soft spotlight just as bright.
      const light = new THREE.SpotLight(
        color,
        record.intensity * (record.width ?? 1) * (record.height ?? 1) * scale * scale,
        0,
        THREE.MathUtils.degToRad(75),
        1,
        2,
      )
      light.position.copy(position)
      light.target.position.copy(aim)
      configureShadow(light, record)
      light.shadow.radius = 6
      objects.push(light, light.target)
    } else if (record.type === "area") {
      const light = new THREE.RectAreaLight(
        color,
        record.intensity,
        (record.width ?? 1) * scale,
        (record.height ?? 1) * scale,
      )
      light.position.copy(position)
      if (record.up) light.up.set(...record.up)
      light.lookAt(aim)
      objects.push(light)
    }
  }

  // A .glb from somewhere else (no Blender light data): simple soft lighting.
  if (records.length === 0) {
    objects.push(new THREE.HemisphereLight(0xfff4e6, 0x30304a, 2.2))
    const sun = new THREE.DirectionalLight(0xffffff, 2)
    sun.position.set(3, 6, 4)
    objects.push(sun)
  }
  return objects
}

function makeTouchables(
  scene: THREE.Object3D,
  groups: TouchableGroup[],
): THREE.Object3D[] {
  // Objects named "touch..." in Blender are touchable too.
  const named: THREE.Object3D[] = []
  scene.traverse((o) => {
    if (/^touch/i.test(o.name) && !hasAncestorIn(o, named)) named.push(o)
  })
  const allGroups = [
    ...groups,
    ...named.map((o) => ({
      name: o.name.replace(/^touch[_\-\s]*/i, "") || o.name,
      objects: [o.name],
    })),
  ]

  scene.updateMatrixWorld(true)
  const pivots: THREE.Object3D[] = []
  for (const group of allGroups) {
    const members: THREE.Object3D[] = []
    scene.traverse((o) => {
      if (o === scene || hasAncestorIn(o, members)) return
      if (group.objects.some((pattern) => nameMatches(o.name, pattern)))
        members.push(o)
    })
    if (members.length === 0) {
      console.warn(`[VR] No objects found for touchable "${group.name}".`)
      continue
    }

    // The group sways around the bottom-center of its bounding box.
    const box = new THREE.Box3()
    members.forEach((m) => box.expandByObject(m))
    const pivot = new THREE.Group()
    pivot.name = `touch:${group.name}`
    pivot.userData.touchable = group.name
    pivot.position.set(
      (box.min.x + box.max.x) / 2,
      box.min.y,
      (box.min.z + box.max.z) / 2,
    )
    pivot.updateMatrixWorld(true)
    members.forEach((m) => pivot.attach(m))

    // Own copies of materials, so highlighting one piece doesn't light up
    // anything else that shares its material.
    pivot.traverse((o) => {
      const mesh = o as THREE.Mesh
      if (!mesh.isMesh) return
      mesh.material = Array.isArray(mesh.material)
        ? mesh.material.map((m) => m.clone())
        : mesh.material.clone()
    })
    pivots.push(pivot)
  }
  return pivots
}

/** A camera from Blender's N panel numbers (Z up) in web coordinates (Y up). */
function blenderCameraView(camera: CoverCamera) {
  const toWeb = (v: THREE.Vector3) => new THREE.Vector3(v.x, v.z, -v.y)
  const [rx, ry, rz] = camera.rotation.map(THREE.MathUtils.degToRad)
  // Blender's XYZ rotation turns around X first, then Y, then Z.
  const look = new THREE.Vector3(0, 0, -1).applyEuler(new THREE.Euler(rx, ry, rz, "ZYX"))
  return {
    position: toWeb(new THREE.Vector3(...camera.location)),
    direction: toWeb(look).normalize(),
  }
}

/** A view partway between two views: it turns, moves, and changes lens
 * smoothly, keeping the same width of scene in view (a "dolly zoom"). */
function blendPose(a: Pose, b: Pose, t: number) {
  const target = a.target.clone().lerp(b.target, t)
  const direction = a.direction.clone().lerp(b.direction, t).normalize()
  const hfov = Math.exp(THREE.MathUtils.lerp(Math.log(a.hfov), Math.log(b.hfov), t))
  const halfWidth = THREE.MathUtils.lerp(a.halfWidth, b.halfWidth, t)
  const distance = halfWidth / Math.tan(hfov / 2)
  return { target, position: target.clone().addScaledVector(direction, distance), hfov, distance }
}

/** Aims the camera's lens at one rectangle of the canvas: the scene is framed
 * for that rectangle (the TV, or the big window), wherever it is on screen. */
function frameCamera(
  camera: THREE.PerspectiveCamera,
  frame: ViewRect,
  width: number,
  height: number,
  hfov: number,
  near: number,
  /** 0: fill the frame's width (like the drawing in the TV). 1: also keep
   * the whole height of the render in view (on wide screens). */
  fitWhole = 0,
  renderAspect = 16 / 9,
) {
  const aspect = frame.w / Math.max(1, frame.h)
  const widthFit = Math.tan(hfov / 2) / aspect
  const wholeFit = Math.tan(hfov / 2) / Math.min(aspect, renderAspect)
  camera.aspect = aspect
  camera.fov = THREE.MathUtils.radToDeg(
    2 * Math.atan(THREE.MathUtils.lerp(widthFit, wholeFit, fitWhole)),
  )
  camera.near = near
  camera.far = 500
  camera.setViewOffset(frame.w, frame.h, -frame.x, -frame.y, width, height)
}

const findObject = (scene: THREE.Object3D, name: string) => {
  let found: THREE.Object3D | undefined
  scene.traverse((o) => {
    if (!found && nameMatches(o.name, name)) found = o
  })
  if (!found) console.warn(`[VR] No object named "${name}" in the world.`)
  return found
}

/** A plain material showing its color times the light Cycles baked into
 * the model's vertex colors. */
function bakedMaterial(source: THREE.Material, twoSided: boolean): THREE.Material {
  const lit = source as THREE.MeshStandardMaterial
  const material = new THREE.MeshBasicMaterial({
    name: source.name,
    color: lit.color?.clone() ?? new THREE.Color(1, 1, 1),
    map: lit.map ?? null,
    alphaMap: lit.alphaMap ?? null,
    transparent: source.transparent,
    opacity: source.opacity,
    alphaTest: source.alphaTest,
    side: source.side,
    // See-through glass has no light of its own baked on it.
    vertexColors: !source.transparent,
  })
  const glow = lit.emissive?.clone().multiplyScalar(lit.emissiveIntensity ?? 1)
  if (glow && glow.r + glow.g + glow.b > 0) material.userData.glow = glow
  if (twoSided && !source.transparent) material.userData.backLight = true
  return material
}

/** Blender's color table as a 3D texture the graphics card can look up. */
function lutTexture(lut: ViewLut) {
  const rgb = Uint8Array.from(atob(lut.data), (c) => c.charCodeAt(0))
  const rgba = new Uint8Array((rgb.length / 3) * 4)
  for (let i = 0, j = 0; i < rgb.length; i += 3, j += 4) {
    rgba[j] = rgb[i]
    rgba[j + 1] = rgb[i + 1]
    rgba[j + 2] = rgb[i + 2]
    rgba[j + 3] = 255
  }
  const texture = new THREE.Data3DTexture(rgba, lut.size, lut.size, lut.size)
  texture.format = THREE.RGBAFormat
  texture.type = THREE.UnsignedByteType
  texture.minFilter = texture.magFilter = THREE.LinearFilter
  texture.wrapS = texture.wrapT = texture.wrapR = THREE.ClampToEdgeWrapping
  texture.unpackAlignment = 1
  texture.needsUpdate = true
  return texture
}

const glsl = (n: number) => (Number.isInteger(n) ? `${n}.0` : `${n}`)

/** Shader changes for one material:
 *  - backLight: a thin surface seen from behind shows its back's baked light.
 *  - glow: a glowing (emission) color added on top of baked light.
 *  - Blender's exact color look, by looking each pixel's light value up in
 *    Blender's color table (instead of the web's own color look). */
function customizeShader(
  material: THREE.Material,
  view?: { table: THREE.Data3DTexture; lut: ViewLut },
) {
  const glow = material.userData.glow as THREE.Color | undefined
  const backLight = material.userData.backLight === true
  if (!view && !glow && !backLight) return
  material.onBeforeCompile = (shader) => {
    if (backLight) {
      shader.vertexShader = shader.vertexShader
        .replace(
          "#include <color_pars_vertex>",
          "#include <color_pars_vertex>\nattribute vec4 color_1;\nvarying vec3 vBackLight;",
        )
        .replace("#include <color_vertex>", "#include <color_vertex>\nvBackLight = color_1.rgb;")
      shader.fragmentShader = shader.fragmentShader
        .replace("#include <color_pars_fragment>", "#include <color_pars_fragment>\nvarying vec3 vBackLight;")
        .replace(
          "#include <color_fragment>",
          `#if defined( USE_COLOR_ALPHA )
            diffuseColor *= gl_FrontFacing ? vColor : vec4( vBackLight, vColor.a );
          #elif defined( USE_COLOR )
            diffuseColor.rgb *= gl_FrontFacing ? vColor : vBackLight;
          #endif`,
        )
    }
    if (glow) {
      shader.uniforms.bakedGlow = { value: glow }
      shader.fragmentShader = shader.fragmentShader
        .replace("void main() {", "uniform vec3 bakedGlow;\nvoid main() {")
        .replace("#include <opaque_fragment>", "#include <opaque_fragment>\ngl_FragColor.rgb += bakedGlow;")
    }
    if (view) {
      const { table, lut } = view
      shader.uniforms.blenderView = { value: table }
      shader.fragmentShader = shader.fragmentShader
        .replace("void main() {", "uniform sampler3D blenderView;\nvoid main() {")
        .replace(
          "#include <tonemapping_fragment>",
          `{
            vec3 stops = (log2(max(gl_FragColor.rgb, vec3(1e-10))) - ${glsl(lut.min)}) / ${glsl(lut.max - lut.min)};
            vec3 cell = clamp(stops, 0.0, 1.0) * ${glsl((lut.size - 1) / lut.size)} + ${glsl(0.5 / lut.size)};
            vec3 screen = texture(blenderView, cell).rgb;
            gl_FragColor.rgb = mix(
              pow((screen + 0.055) / 1.055, vec3(2.4)),
              screen / 12.92,
              vec3(lessThanEqual(screen, vec3(0.04045)))
            );
          }`,
        )
    }
  }
  material.customProgramCacheKey = () =>
    [
      "blender",
      backLight ? "back" : "",
      glow ? "glow" : "",
      view ? `view-${view.lut.size}-${view.lut.min}-${view.lut.max}` : "",
    ].join("-")
  material.needsUpdate = true
}

function prepareWorld(gltf: GLTF, settings: WorldSettings): PreparedWorld {
  const cached = prepared.get(gltf)
  if (cached) return cached

  const scene = gltf.scene
  const scale = settings.scale ?? 1
  const shadows = settings.shadows ?? true
  const extras = (scene.userData.vr ?? {}) as {
    lights?: LightRecord[]
    background?: Vec3
    view?: ColorView
    baked?: boolean
    viewLut?: ViewLut
    backgroundOnScreen?: Vec3
  }
  const baked = extras.baked === true
  scene.updateMatrixWorld(true)

  const meshes: THREE.Mesh[] = []
  scene.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh)
  })
  // Baked worlds: Cycles saved the light on every surface in the model, so
  // each surface just shows its color times that light (no live lights or
  // shadows to work out, which is also much lighter for a headset).
  // Thin surfaces like leaves also have the light on their back side.
  const bakedVersions = new Map<string, THREE.Material>()
  for (const mesh of meshes) {
    if (baked && mesh.geometry.getAttribute("color")) {
      const twoSided = Boolean(mesh.geometry.getAttribute("color_1"))
      const swap = (m: THREE.Material) => {
        const key = `${m.uuid}:${twoSided}`
        if (!bakedVersions.has(key)) bakedVersions.set(key, bakedMaterial(m, twoSided))
        return bakedVersions.get(key)!
      }
      mesh.material = Array.isArray(mesh.material)
        ? mesh.material.map(swap)
        : swap(mesh.material)
    }
    const seeThrough = materialsOf(mesh).some((m) => m.transparent)
    mesh.castShadow = shadows && !baked && !seeThrough // light passes through glass
    mesh.receiveShadow = shadows && !baked
    if (seeThrough) materialsOf(mesh).forEach((m) => (m.depthWrite = false))
  }

  // Where the Blender camera is and what it looks at.
  const blenderCamera = gltf.cameras.find(
    (c) =>
      (c as THREE.PerspectiveCamera).isPerspectiveCamera ||
      (c as THREE.OrthographicCamera).isOrthographicCamera,
  )
  const cameraPosition = new THREE.Vector3()
  const cameraDirection = new THREE.Vector3(0, 0, -1)
  let horizontalFov = THREE.MathUtils.degToRad(60)
  if (blenderCamera) {
    blenderCamera.getWorldPosition(cameraPosition)
    blenderCamera.getWorldDirection(cameraDirection)
    const perspective = blenderCamera as THREE.PerspectiveCamera
    if (perspective.isPerspectiveCamera) {
      horizontalFov =
        2 *
        Math.atan(
          Math.tan(THREE.MathUtils.degToRad(perspective.fov) / 2) *
            perspective.aspect,
        )
    }
  } else {
    const box = new THREE.Box3().setFromObject(scene)
    const center = box.getCenter(new THREE.Vector3())
    const size = box.getSize(new THREE.Vector3()).length()
    cameraPosition.set(center.x, center.y + size * 0.15, box.max.z + size * 0.4)
    cameraDirection.subVectors(center, cameraPosition).normalize()
  }
  const hit = new THREE.Raycaster(cameraPosition, cameraDirection, 0.01, 1000)
    .intersectObjects(meshes, false)
    .find((h) => !materialsOf(h.object as THREE.Mesh).some((m) => m.transparent))
  const target = hit
    ? hit.point.clone()
    : cameraPosition.clone().addScaledVector(cameraDirection, 10)
  const blenderView = { position: cameraPosition.clone(), direction: cameraDirection.clone() }

  // An orthographic (flat, no perspective) Blender camera: the web view
  // steps back along the same line of sight with a long lens, so it frames
  // the same width of scene and still looks nearly as flat as the render.
  const flatCamera = blenderCamera as THREE.OrthographicCamera | undefined
  if (flatCamera?.isOrthographicCamera) {
    const halfWidth = (flatCamera.right - flatCamera.left) / 2 / flatCamera.zoom
    horizontalFov = THREE.MathUtils.degToRad(30)
    cameraPosition
      .copy(target)
      .addScaledVector(cameraDirection, -halfWidth / Math.tan(horizontalFov / 2))
  }

  // The view the cover drawing was painted from: world.json's coverCamera,
  // or else the Blender camera. Flat (orthographic) cameras become FLAT_FOV.
  const coverPose = ((): Pose => {
    const flat = flatCamera?.isOrthographicCamera
    const own = settings.coverCamera
    const from = own ? blenderCameraView(own) : blenderView
    const aim = own
      ? (new THREE.Raycaster(from.position, from.direction, 0.01, 1000)
          .intersectObjects(meshes, false)
          .find((h) => !materialsOf(h.object as THREE.Mesh).some((m) => m.transparent))
          ?.point ?? from.position.clone().addScaledVector(from.direction, 10))
      : target.clone()
    const distance = from.position.distanceTo(aim)
    let halfWidth: number
    let hfov: number
    if (own) {
      hfov = own.orthographicScale ? FLAT_FOV : THREE.MathUtils.degToRad(own.fov ?? 40)
      halfWidth = own.orthographicScale
        ? own.orthographicScale / 2
        : distance * Math.tan(hfov / 2)
    } else if (flat) {
      hfov = FLAT_FOV
      halfWidth = (flatCamera!.right - flatCamera!.left) / 2 / flatCamera!.zoom
    } else {
      hfov = horizontalFov
      halfWidth = distance * Math.tan(hfov / 2)
    }
    return {
      target: aim.multiplyScalar(scale),
      direction: from.direction.clone().negate(),
      halfWidth: halfWidth * scale,
      hfov,
    }
  })()

  // Fog only far beyond the world, so the whole scene stays crisp.
  const sceneBox = new THREE.Box3().setFromObject(scene)
  const bounds = sceneBox.getBoundingSphere(new THREE.Sphere())
  const fogNear = Math.max(14, (cameraPosition.distanceTo(target) + bounds.radius) * scale)

  // Blender's color look: AgX (Blender's default) softens bright lights the
  // same way on the web; Standard shows colors as they are.
  // With a color table from Blender, every surface gets Blender's exact
  // color look (see customizeShader), and the background is already in it.
  const view = extras.view ?? {}
  const exposure = view.exposure ?? 0
  const lut = extras.viewLut
  const toneMapping = lut
    ? THREE.NoToneMapping
    : view.transform?.startsWith("AgX")
      ? THREE.AgXToneMapping
      : view.transform === "Khronos PBR Neutral"
        ? THREE.NeutralToneMapping
        : exposure !== 0
          ? THREE.LinearToneMapping
          : THREE.NoToneMapping
  const background = new THREE.Color(...(extras.background ?? [0.05, 0.05, 0.05]))
  let backdrop: THREE.Color | THREE.Texture
  if (lut && extras.backgroundOnScreen) {
    backdrop = new THREE.Color().setRGB(
      ...extras.backgroundOnScreen,
      THREE.SRGBColorSpace,
    )
  } else {
    const texture = new THREE.DataTexture(
      new Float32Array([background.r, background.g, background.b, 1]),
      1,
      1,
      THREE.RGBAFormat,
      THREE.FloatType,
    )
    texture.colorSpace = THREE.LinearSRGBColorSpace
    texture.needsUpdate = true
    backdrop = texture
  }

  // VR start point: a "VR_Spawn" empty from Blender; or standing on top of
  // the object named in world.json's "startOn"; or a few steps back from
  // what the camera looks at. Visitors face "startFacing" (an object's
  // name), or else what the camera looks at.
  const flat = new THREE.Vector3(cameraDirection.x, 0, cameraDirection.z)
  if (flat.lengthSq() < 1e-6) flat.set(0, 0, -1)
  flat.normalize()
  const spawnNode = scene.getObjectByName("VR_Spawn")
  const startOn = settings.startOn ? findObject(scene, settings.startOn) : undefined
  let spawn: THREE.Vector3
  if (spawnNode) {
    spawn = spawnNode.getWorldPosition(new THREE.Vector3())
  } else if (startOn) {
    const box = new THREE.Box3().setFromObject(startOn)
    spawn = box.getCenter(new THREE.Vector3()).setY(Math.max(0, box.max.y))
  } else {
    spawn = target.clone().addScaledVector(flat, -(settings.startDistance ?? 3) / scale)
    spawn.y = 0
  }
  const faceObject = settings.startFacing
    ? findObject(scene, settings.startFacing)
    : undefined
  const lookAt = faceObject
    ? new THREE.Box3().setFromObject(faceObject).getCenter(new THREE.Vector3())
    : target
  const facing = new THREE.Vector3(lookAt.x - spawn.x, 0, lookAt.z - spawn.z)
  if (facing.lengthSq() < 1e-6) facing.copy(flat)
  facing.normalize()

  // Where visitors can teleport: the world's whole floor area when they
  // start on it (a diorama or room), else around the start and the subject.
  const floorCenter = sceneBox.getCenter(new THREE.Vector3()).setY(0)
  const floorRadius =
    Math.min(sceneBox.max.x - sceneBox.min.x, sceneBox.max.z - sceneBox.min.z) / 2
  const startsOnFloor =
    floorRadius * scale >= 3 &&
    Math.hypot(spawn.x - floorCenter.x, spawn.z - floorCenter.z) < floorRadius * 0.95
  const spawnToTarget = Math.hypot(target.x - spawn.x, target.z - spawn.z)
  const teleportCenter = startsOnFloor
    ? floorCenter
    : new THREE.Vector3((spawn.x + target.x) / 2, 0, (spawn.z + target.z) / 2)

  const touchables = makeTouchables(scene, settings.touchable ?? [])
  const touchClips = new Map<THREE.Object3D, THREE.AnimationClip[]>()
  const loopClips: THREE.AnimationClip[] = []
  for (const clip of gltf.animations) {
    const owner = touchables.find((pivot) =>
      clip.tracks.some((track) =>
        pivot.getObjectByName(
          THREE.PropertyBinding.parseTrackName(track.name).nodeName,
        ),
      ),
    )
    if (owner) touchClips.set(owner, [...(touchClips.get(owner) ?? []), clip])
    else loopClips.push(clip)
  }

  // After the touchables made their own copies of materials.
  const lookup = lut ? { table: lutTexture(lut), lut } : undefined
  const done = new Set<THREE.Material>()
  for (const root of [scene, ...touchables]) {
    root.traverse((o) => {
      const mesh = o as THREE.Mesh
      if (!mesh.isMesh) return
      for (const material of materialsOf(mesh)) {
        if (done.has(material)) continue
        done.add(material)
        customizeShader(material, lookup)
      }
    })
  }

  // The 3D world opens from the same point of view as the cover picture;
  // a flat view gets a normal lens there, so it has real depth.
  const openPose: Pose = {
    target: coverPose.target.clone(),
    direction: coverPose.direction.clone(),
    halfWidth: coverPose.halfWidth,
    hfov: coverPose.hfov === FLAT_FOV ? THREE.MathUtils.degToRad(30) : coverPose.hfov,
  }

  const renderAspect = flatCamera?.isOrthographicCamera
    ? (flatCamera.right - flatCamera.left) / (flatCamera.top - flatCamera.bottom)
    : ((blenderCamera as THREE.PerspectiveCamera | undefined)?.aspect ?? 16 / 9)

  const result: PreparedWorld = {
    background,
    backdrop,
    baked,
    toneMapping,
    toneMappingExposure: lut ? 1 : 2 ** exposure,
    fogNear,
    lights: makeLights(extras.lights ?? [], scale, shadows && !baked),
    touchables,
    touchClips,
    loopClips,
    cameraPosition: cameraPosition.multiplyScalar(scale),
    target: target.multiplyScalar(scale),
    horizontalFov,
    coverPose,
    openPose,
    renderAspect,
    sceneRadius: bounds.radius * scale,
    spawn: spawn.multiplyScalar(scale),
    spawnYaw: Math.atan2(-facing.x, -facing.z),
    teleportCenter: teleportCenter.multiplyScalar(scale),
    teleportRadius: startsOnFloor
      ? floorRadius * scale * 0.95
      : Math.max((spawnToTarget * scale) / 2 + 2.5, 5),
  }
  prepared.set(gltf, result)
  return result
}

function setHighlight(pivot: THREE.Object3D, on: boolean) {
  pivot.traverse((o) => {
    const mesh = o as THREE.Mesh
    if (!mesh.isMesh) return
    for (const material of materialsOf(mesh)) {
      const lit = material as THREE.MeshStandardMaterial
      if (lit.emissive) {
        lit.userData.restingEmissive ??= lit.emissive.clone()
        if (on) lit.emissive.set(0x5c4520)
        else lit.emissive.copy(lit.userData.restingEmissive)
      } else if (lit.color) {
        // Plain (baked) materials have no glow: brighten the color instead.
        lit.userData.restingColor ??= lit.color.clone()
        lit.color.copy(lit.userData.restingColor)
        if (on) lit.color.multiplyScalar(1.6)
      }
    }
  })
}

const touchableFrom = (object: THREE.Object3D | null) => {
  for (let o = object; o; o = o.parent) if (o.userData.touchable) return o
  return null
}

// How far the mouse moved between press and release. VR controllers and
// hands don't report this (reading it throws), and never drag the view.
const dragDistance = (event: ThreeEvent<MouseEvent>) => {
  try {
    return event.delta
  } catch {
    return 0
  }
}

/**
 * The 3D world. `preview` is the small live view inside the VR slide's
 * screen: same room, lights, and plant, drifting slowly, with no VR controls
 * or mouse interaction (clicking the screen opens the full world instead).
 */
export function WorldScene({
  world,
  preview = false,
  morph,
}: {
  world: VRWorld
  preview?: boolean
  /** Opening from the cover drawing: the camera follows this. */
  morph?: Morph
}) {
  const gltf = useGLTF(world.model!, DRACO_PATH) as unknown as GLTF
  const setup = useMemo(
    () => prepareWorld(gltf, world.settings),
    [gltf, world.settings],
  )
  const scale = world.settings.scale ?? 1
  const { gl, camera, size, clock, scene } = useThree()
  const controls = useThree((state) => state.controls) as unknown as {
    target: THREE.Vector3
    enabled: boolean
  } | null
  // Where the visitor left the camera, so closing glides back from there.
  const leftAt = useRef<Pose | null>(null)
  const wasSettled = useRef(false)

  const mixer = useMemo(() => new THREE.AnimationMixer(gltf.scene), [gltf])
  const touchMixers = useMemo(
    () => new Map(setup.touchables.map((t) => [t, new THREE.AnimationMixer(t)])),
    [setup],
  )
  const sways = useRef(new Map<THREE.Object3D, { start: number; axis: THREE.Vector3 }>())
  const hoverCounts = useRef(new Map<THREE.Object3D, number>())
  const busyUntil = useRef(0)

  // Match Blender's color look (before the first frame is drawn).
  useLayoutEffect(() => {
    gl.toneMapping = setup.toneMapping
    gl.toneMappingExposure = setup.toneMappingExposure
  }, [gl, setup])

  // The world is still, so shadows are drawn once and redrawn only while
  // something moves (much lighter for a headset).
  useEffect(() => {
    gl.shadowMap.autoUpdate = setup.loopClips.length > 0
    gl.shadowMap.needsUpdate = true
  }, [gl, setup])

  // Blender animations that aren't on a touchable object play on a loop.
  useEffect(() => {
    setup.loopClips.forEach((clip) => mixer.clipAction(clip).play())
    return () => {
      mixer.stopAllAction()
    }
  }, [mixer, setup])

  // On a screen, the view starts where the Blender camera is...
  useEffect(() => {
    if (morph) return // the opening animation places the camera
    camera.position.copy(setup.cameraPosition)
    camera.lookAt(setup.target)
  }, [camera, setup, morph])

  // ...and shows the same width of scene on any screen shape.
  useEffect(() => {
    const perspective = camera as THREE.PerspectiveCamera
    if (morph || !perspective.isPerspectiveCamera) return
    const aspect = size.width / Math.max(1, size.height)
    const vertical = 2 * Math.atan(Math.tan(setup.horizontalFov / 2) / aspect)
    perspective.fov = THREE.MathUtils.clamp(
      THREE.MathUtils.radToDeg(vertical),
      20,
      100,
    )
    perspective.near = 0.05
    perspective.far = 500
    perspective.updateProjectionMatrix()
  }, [camera, size, setup, morph])

  // Opening from the drawing (and closing back to it): the camera starts on
  // the drawing's flat view inside the TV, then turns into 3D depth as the
  // view grows into the big window. Once open, the visitor takes over.
  useFrame(() => {
    const perspective = camera as THREE.PerspectiveCamera
    if (!morph || !perspective.isPerspectiveCamera || gl.xr.isPresenting) return
    const fog = scene.fog as THREE.Fog | null
    if (morph.settled) {
      if (!wasSettled.current) {
        wasSettled.current = true
        if (controls) controls.enabled = true
        if (fog) {
          fog.near = setup.fogNear
          fog.far = setup.fogNear + 26
        }
      }
      frameCamera(
        perspective,
        morph.frame,
        size.width,
        size.height,
        setup.openPose.hfov,
        0.05,
        1,
        setup.renderAspect,
      )
      perspective.updateProjectionMatrix()
      return
    }
    if (wasSettled.current) {
      // Closing: glide back to the drawing from wherever the visitor looked.
      wasSettled.current = false
      const aim = controls?.target.clone() ?? setup.openPose.target.clone()
      const distance = perspective.position.distanceTo(aim)
      leftAt.current = {
        target: aim,
        direction: perspective.position.clone().sub(aim).normalize(),
        halfWidth: distance * Math.tan(setup.openPose.hfov / 2),
        hfov: setup.openPose.hfov,
      }
    }
    if (controls) controls.enabled = false
    const t = easeInOut(phase(morph.progress, MORPH_TIMELINE.camera))
    const pose = blendPose(setup.coverPose, leftAt.current ?? setup.openPose, t)
    perspective.position.copy(pose.position)
    perspective.lookAt(pose.target)
    controls?.target.copy(pose.target)
    frameCamera(
      perspective,
      morph.frame,
      size.width,
      size.height,
      pose.hfov,
      Math.max(0.05, pose.distance * 0.03),
      t,
      setup.renderAspect,
    )
    perspective.updateProjectionMatrix()
    // The flat view starts far away: keep the distance haze beyond the world.
    if (fog) {
      fog.near = Math.max(setup.fogNear, pose.distance + setup.sceneRadius)
      fog.far = fog.near + 26
    }
  })

  useEffect(
    () => () => {
      document.body.style.cursor = ""
    },
    [],
  )
  useFrame((_, delta) => {
    if (preview) drift(camera, setup, clock.elapsedTime)
    mixer.update(delta)
    touchMixers.forEach((m) => m.update(delta))
    const now = clock.elapsedTime
    sways.current.forEach((sway, pivot) => {
      const t = now - sway.start
      if (t > 3) {
        pivot.quaternion.identity()
        sways.current.delete(pivot)
      } else {
        const angle = 0.2 * Math.exp(-1.4 * t) * Math.sin(7 * t)
        pivot.quaternion.setFromAxisAngle(sway.axis, angle)
      }
    })
    if (sways.current.size > 0 || now < busyUntil.current) {
      gl.shadowMap.needsUpdate = true
    }
  })

  const onPointerOver = (event: ThreeEvent<PointerEvent>) => {
    const pivot = touchableFrom(event.object)
    if (!pivot) return
    event.stopPropagation()
    const count = (hoverCounts.current.get(pivot) ?? 0) + 1
    hoverCounts.current.set(pivot, count)
    if (count === 1) setHighlight(pivot, true)
    if (!gl.xr.isPresenting) document.body.style.cursor = "pointer"
  }

  const onPointerOut = (event: ThreeEvent<PointerEvent>) => {
    const pivot = touchableFrom(event.object)
    if (!pivot) return
    const count = Math.max(0, (hoverCounts.current.get(pivot) ?? 1) - 1)
    hoverCounts.current.set(pivot, count)
    if (count === 0) {
      setHighlight(pivot, false)
      document.body.style.cursor = ""
    }
  }

  const onClick = (event: ThreeEvent<MouseEvent>) => {
    const pivot = touchableFrom(event.object)
    if (!pivot || dragDistance(event) > 8) return // a drag to look around, not a tap
    event.stopPropagation()
    // Rock side to side as seen by the visitor (tilting around their line of
    // sight), so the sway is easy to see from wherever they stand.
    const axis = new THREE.Vector3(event.ray.direction.x, 0, event.ray.direction.z)
    if (axis.lengthSq() < 1e-6) axis.set(0, 0, -1)
    sways.current.set(pivot, { start: clock.elapsedTime, axis: axis.normalize() })

    const clips = setup.touchClips.get(pivot) ?? []
    const touchMixer = touchMixers.get(pivot)
    for (const clip of clips) {
      const action = touchMixer?.clipAction(clip)
      action?.reset().setLoop(THREE.LoopOnce, 1).play()
      busyUntil.current = Math.max(busyUntil.current, clock.elapsedTime + clip.duration)
    }
  }

  return (
    <>
      <primitive attach="background" object={setup.backdrop} />
      <fog
        attach="fog"
        args={[
          setup.backdrop instanceof THREE.Color ? setup.backdrop : setup.background,
          setup.fogNear,
          setup.fogNear + 26,
        ]}
      />
      {/* Blender's world color lights everything a little, like in EEVEE. */}
      {!setup.baked && <ambientLight color={setup.background} intensity={Math.PI} />}

      <group scale={scale}>
        <primitive object={gltf.scene} />
        {setup.lights.map((light) => (
          <primitive key={light.uuid} object={light} />
        ))}
        {setup.touchables.map((pivot) =>
          preview ? (
            <primitive key={pivot.uuid} object={pivot} />
          ) : (
            <primitive
              key={pivot.uuid}
              object={pivot}
              onPointerOver={onPointerOver}
              onPointerOut={onPointerOut}
              onClick={onClick}
            />
          ),
        )}
      </group>

      {!preview && <WorldControls setup={setup} />}
    </>
  )
}

/** Mouse/touch looking around, plus the VR start point and teleporting. */
function WorldControls({ setup }: { setup: PreparedWorld }) {
  const [origin, setOrigin] = useState(() => setup.spawn.clone())
  const { teleportCenter, teleportRadius } = setup
  return (
    <>
      {/* Camera controls are removed in VR (the headset moves the camera). */}
      <IfInSessionMode deny={["immersive-vr", "immersive-ar"]}>
        <OrbitControls
          makeDefault
          target={setup.target}
          enableDamping
          maxPolarAngle={Math.PI * 0.49}
          minDistance={0.4}
          maxDistance={setup.cameraPosition.distanceTo(setup.target) * 1.6}
        />
      </IfInSessionMode>

      {/* VR: where visitors stand, and the floor they can teleport across. */}
      <XROrigin position={origin} rotation={[0, setup.spawnYaw, 0]} />
      <TeleportTarget onTeleport={(point) => setOrigin(point.clone())}>
        <mesh
          position={[teleportCenter.x, 0.01, teleportCenter.z]}
          rotation={[-Math.PI / 2, 0, 0]}
        >
          <circleGeometry args={[teleportRadius, 48]} />
          <meshBasicMaterial transparent opacity={0} depthWrite={false} />
        </mesh>
      </TeleportTarget>
    </>
  )
}

// The preview's slow drift: a few degrees left and right around what the
// Blender camera looks at, once every 16 seconds.
const driftOffset = new THREE.Vector3()
function drift(camera: THREE.Camera, setup: PreparedWorld, time: number) {
  const angle = 0.06 * Math.sin((time * 2 * Math.PI) / 16)
  driftOffset
    .subVectors(setup.cameraPosition, setup.target)
    .applyAxisAngle(THREE.Object3D.DEFAULT_UP, angle)
  camera.position.copy(setup.target).add(driftOffset)
  camera.position.y += 0.03 * Math.sin((time * 2 * Math.PI) / 11)
  camera.lookAt(setup.target)
}

export const preloadWorldModel = (url: string) => useGLTF.preload(url, DRACO_PATH)
