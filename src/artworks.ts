// Every image or video in src/artworks/2d and src/artworks/3d shows up in the
// gallery automatically. Files are sorted by name, so prefix them with numbers
// (01-sunset.png, 02-goose.jpg, ...) to control the order. The name after the
// number becomes the artwork's title (used as alt text for screen readers).
//
// Videos (.mp4/.webm) play silently on a loop, like a GIF. The spinning 3D
// turntables made from artwork-originals/3d/*.blend land here as a pair:
// name.av1.mp4 (small, played by most browsers) and name.mp4 (the fallback).
// A pair counts as one artwork; each visitor's browser downloads only one.

export type VideoSource = { src: string; type: string }
export type Artwork = {
  src: string
  title: string
  media: "image" | "video"
  /** Video files to try in order (best compression first). */
  sources?: VideoSource[]
}
export type ArtworkKind = "2D" | "3D"

const AV1_SUFFIX = /\.av1\.mp4$/i
// AV1, main profile, 8-bit, level 4.0 (fits 1080p at 24 fps).
const AV1_TYPE = 'video/mp4; codecs="av01.0.08M.08"'

const files = import.meta.glob<string>(
  "./artworks/{2d,3d}/*.{png,jpg,jpeg,webp,avif,gif,mp4,webm,PNG,JPG,JPEG,WEBP,AVIF,GIF,MP4,WEBM}",
  { eager: true, import: "default" },
)

const isVideo = (fileName: string) => /\.(mp4|webm)$/i.test(fileName)

function titleFromFileName(fileName: string) {
  const title = fileName
    .replace(/\.[^.]+$/, "") // extension
    .replace(/^\d+[\s._-]*/, "") // leading order number
    .replace(/[-_]+/g, " ")
    .trim()
  return title ? title[0].toUpperCase() + title.slice(1) : "Untitled"
}

function artworksIn(folder: "2d" | "3d"): Artwork[] {
  const inFolder = Object.entries(files)
    .filter(([path]) => path.startsWith(`./artworks/${folder}/`))
    .map(([path, src]) => ({ src, fileName: path.split("/").pop()! }))
  const av1ByName = new Map(
    inFolder
      .filter(({ fileName }) => AV1_SUFFIX.test(fileName))
      .map(({ fileName, src }) => [fileName.replace(AV1_SUFFIX, ""), src]),
  )

  return inFolder
    .filter(({ fileName }) => !AV1_SUFFIX.test(fileName))
    .sort((a, b) =>
      a.fileName.localeCompare(b.fileName, undefined, { numeric: true }),
    )
    .map(({ src, fileName }): Artwork => {
      const title = titleFromFileName(fileName)
      if (!isVideo(fileName)) return { src, title, media: "image" }
      const av1 = av1ByName.get(fileName.replace(/\.(mp4|webm)$/i, ""))
      const sources: VideoSource[] = [
        ...(av1 ? [{ src: av1, type: AV1_TYPE }] : []),
        { src, type: /\.webm$/i.test(fileName) ? "video/webm" : "video/mp4" },
      ]
      return { src, title, media: "video", sources }
    })
}

export const artworks: Record<ArtworkKind, Artwork[]> = {
  "2D": artworksIn("2d"),
  "3D": artworksIn("3d"),
}
