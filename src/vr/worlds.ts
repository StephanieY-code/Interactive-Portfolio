// Finds each VR world in src/vr-worlds/<world>/ automatically:
//   cover.jpg (or .png/.webp)  the 2D drawing shown on the VR card
//   cover.mp4 (or .webm/.mov)  optional video (like the drawing's timelapse)
//                              that plays on the screen when it's clicked
//   render.jpg (or .png/.webp) optional 3D render from the same view as the
//                              drawing; the drawing flips over to show it
//   scene.glb                  the 3D world, made by "Export VR World.command"
//   world.json                 optional settings (see src/vr-worlds/README.md)
// A card with no scene.glb keeps the simple animated placeholder world.

export type TouchableGroup = {
  /** Shown to screen readers, e.g. "Plant". */
  name: string
  /** Blender object names; a trailing * matches the start of a name. */
  objects: string[]
}

export type CoverCamera = {
  /** Location X, Y, Z in meters. */
  location: [number, number, number]
  /** Rotation X, Y, Z in degrees (XYZ Euler). */
  rotation: [number, number, number]
  /** For an orthographic camera: its Orthographic Scale. */
  orthographicScale?: number
  /** For a perspective camera: how wide it sees, in degrees. */
  fov?: number
}

export type WorldSettings = {
  title?: string
  /** Size multiplier. In VR, 1 Blender unit = 1 meter. */
  scale?: number
  /** How far (in real meters) visitors start from what the camera looks at. */
  startDistance?: number
  /** Blender object VR visitors start standing on, like "Cube.007". */
  startOn?: string
  /** Blender object VR visitors start facing, like "Cube". */
  startFacing?: string
  /** The Blender camera view the cover drawing was painted from, if it isn't
   * the file's own camera (numbers from Blender's N panel). The 3D world
   * starts lined up with the drawing from here. */
  coverCamera?: CoverCamera
  /** Turn off light shadows if the headset feels choppy. */
  shadows?: boolean
  /** Groups of objects that sway when pointed at and clicked/pinched. */
  touchable?: TouchableGroup[]
}

export type VRWorld = {
  id: string
  title: string
  cover?: string
  /** The drawing's timelapse, played when the screen is clicked. */
  coverVideo?: string
  /** A 3D render from the drawing's view; the drawing flips over to it. */
  render?: string
  model?: string
  settings: WorldSettings
}

const covers = import.meta.glob<string>(
  "../vr-worlds/*/cover.{png,jpg,jpeg,webp,PNG,JPG,JPEG,WEBP}",
  { eager: true, import: "default" },
)
const coverVideos = import.meta.glob<string>(
  "../vr-worlds/*/cover.{mp4,webm,mov,MP4,WEBM,MOV}",
  { eager: true, query: "?url", import: "default" },
)
const renders = import.meta.glob<string>(
  "../vr-worlds/*/render.{png,jpg,jpeg,webp,PNG,JPG,JPEG,WEBP}",
  { eager: true, import: "default" },
)
const models = import.meta.glob<string>("../vr-worlds/*/scene.glb", {
  eager: true,
  query: "?url",
  import: "default",
})
const settingsFiles = import.meta.glob<WorldSettings>(
  "../vr-worlds/*/world.json",
  { eager: true, import: "default" },
)

const inFolder = <T>(files: Record<string, T>, id: string) =>
  Object.entries(files).find(([path]) =>
    path.startsWith(`../vr-worlds/${id}/`),
  )?.[1]

export function getWorld(id: string): VRWorld {
  const settings = inFolder(settingsFiles, id) ?? {}
  return {
    id,
    title: settings.title ?? id[0].toUpperCase() + id.slice(1),
    cover: inFolder(covers, id),
    coverVideo: inFolder(coverVideos, id),
    render: inFolder(renders, id),
    model: inFolder(models, id),
    settings,
  }
}
