// Finds each VR world in src/vr-worlds/<world>/ automatically:
//   cover.jpg (or .png/.webp)  the 2D drawing shown on the VR card
//   cover.mp4 (or .webm/.mov)  optional video (like the drawing's timelapse)
//                              that plays on the screen when it's clicked
//   scene.glb                  the 3D world, made by "Export VR World.command"
//   world.json                 optional settings (see src/vr-worlds/README.md)
// A card with no scene.glb keeps the simple animated placeholder world.

export type TouchableGroup = {
  /** Shown to screen readers, e.g. "Plant". */
  name: string
  /** Blender object names; a trailing * matches the start of a name. */
  objects: string[]
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
  /** Turn off light shadows if the headset feels choppy. */
  shadows?: boolean
  /** Groups of objects that sway when pointed at and clicked/pinched. */
  touchable?: TouchableGroup[]
}

export type VRWorld = {
  id: string
  title: string
  cover?: string
  /** A looping video shown on the card in place of the cover drawing. */
  coverVideo?: string
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
    model: inFolder(models, id),
    settings,
  }
}
