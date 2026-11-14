import { OrbitControls, useGLTF } from "@react-three/drei"
import { useFrame, useThree } from "@react-three/fiber"
import type { ThreeEvent } from "@react-three/fiber"
import { IfInSessionMode, TeleportTarget, XROrigin } from "@react-three/xr"
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import * as THREE from "three"
import type { GLTF } from "three/examples/jsm/loaders/GLTFLoader.js"
import { RectAreaLightUniformsLib } from "three/examples/jsm/lights/RectAreaLightUniformsLib.js"
import type { TouchableGroup, VRWorld, WorldSettings } from "./worlds"

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

type PreparedWorld = {
  background: THREE.Color
  /** The background as a tiny image, so it gets the same color look. */
  backgroundTexture: THREE.Texture
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
  }
  scene.updateMatrixWorld(true)

  const meshes: THREE.Mesh[] = []
  scene.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh)
  })
  for (const mesh of meshes) {
    const seeThrough = materialsOf(mesh).some((m) => m.transparent)
    mesh.castShadow = shadows && !seeThrough // light passes through glass
    mesh.receiveShadow = shadows
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

  // Fog only far beyond the world, so the whole scene stays crisp.
  const sceneBox = new THREE.Box3().setFromObject(scene)
  const bounds = sceneBox.getBoundingSphere(new THREE.Sphere())
  const fogNear = Math.max(14, (cameraPosition.distanceTo(target) + bounds.radius) * scale)

  // Blender's color look: AgX (Blender's default) softens bright lights the
  // same way on the web; Standard shows colors as they are.
  const view = extras.view ?? {}
  const exposure = view.exposure ?? 0
  const toneMapping = view.transform?.startsWith("AgX")
    ? THREE.AgXToneMapping
    : view.transform === "Khronos PBR Neutral"
      ? THREE.NeutralToneMapping
      : exposure !== 0
        ? THREE.LinearToneMapping
        : THREE.NoToneMapping
  const background = new THREE.Color(...(extras.background ?? [0.05, 0.05, 0.05]))
  const backgroundTexture = new THREE.DataTexture(
    new Float32Array([background.r, background.g, background.b, 1]),
    1,
    1,
    THREE.RGBAFormat,
    THREE.FloatType,
  )
  backgroundTexture.colorSpace = THREE.LinearSRGBColorSpace
  backgroundTexture.needsUpdate = true

  // VR start point: a "VR_Spawn" empty from Blender, or a few steps back from
  // what the camera looks at. Visitors face that spot.
  const flat = new THREE.Vector3(cameraDirection.x, 0, cameraDirection.z)
  if (flat.lengthSq() < 1e-6) flat.set(0, 0, -1)
  flat.normalize()
  const spawnNode = scene.getObjectByName("VR_Spawn")
  const spawn = spawnNode
    ? spawnNode.getWorldPosition(new THREE.Vector3())
    : target.clone().addScaledVector(flat, -(settings.startDistance ?? 3) / scale)
  spawn.y = spawnNode ? spawn.y : 0
  const facing = new THREE.Vector3(target.x - spawn.x, 0, target.z - spawn.z)
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

  const result: PreparedWorld = {
    background,
    backgroundTexture,
    toneMapping,
    toneMappingExposure: 2 ** exposure,
    fogNear,
    lights: makeLights(extras.lights ?? [], scale, shadows),
    touchables,
    touchClips,
    loopClips,
    cameraPosition: cameraPosition.multiplyScalar(scale),
    target: target.multiplyScalar(scale),
    horizontalFov,
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
      if (!lit.emissive) continue
      lit.userData.restingEmissive ??= lit.emissive.clone()
      if (on) lit.emissive.set(0x5c4520)
      else lit.emissive.copy(lit.userData.restingEmissive)
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
}: {
  world: VRWorld
  preview?: boolean
}) {
  const gltf = useGLTF(world.model!) as unknown as GLTF
  const setup = useMemo(
    () => prepareWorld(gltf, world.settings),
    [gltf, world.settings],
  )
  const scale = world.settings.scale ?? 1
  const { gl, camera, size, clock } = useThree()

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
    camera.position.copy(setup.cameraPosition)
    camera.lookAt(setup.target)
  }, [camera, setup])

  // ...and shows the same width of scene on any screen shape.
  useEffect(() => {
    const perspective = camera as THREE.PerspectiveCamera
    if (!perspective.isPerspectiveCamera) return
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
  }, [camera, size, setup])

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
      <primitive attach="background" object={setup.backgroundTexture} />
      <fog attach="fog" args={[setup.background, setup.fogNear, setup.fogNear + 26]} />
      {/* Blender's world color lights everything a little, like in EEVEE. */}
      <ambientLight color={setup.background} intensity={Math.PI} />

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

export const preloadWorldModel = (url: string) => useGLTF.preload(url)
