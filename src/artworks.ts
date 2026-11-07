// Every image in src/artworks/2d and src/artworks/3d shows up in the gallery
// automatically. Files are sorted by name, so prefix them with numbers
// (01-sunset.png, 02-goose.jpg, ...) to control the order. The name after the
// number becomes the artwork's title (used as alt text for screen readers).

export type Artwork = { src: string; title: string }
export type ArtworkKind = "2D" | "3D"

const files = import.meta.glob<string>(
  "./artworks/{2d,3d}/*.{png,jpg,jpeg,webp,avif,gif,PNG,JPG,JPEG,WEBP,AVIF,GIF}",
  { eager: true, import: "default" },
)

function titleFromFileName(fileName: string) {
  const title = fileName
    .replace(/\.[^.]+$/, "") // extension
    .replace(/^\d+[\s._-]*/, "") // leading order number
    .replace(/[-_]+/g, " ")
    .trim()
  return title ? title[0].toUpperCase() + title.slice(1) : "Untitled"
}

function artworksIn(folder: "2d" | "3d"): Artwork[] {
  return Object.entries(files)
    .filter(([path]) => path.startsWith(`./artworks/${folder}/`))
    .map(([path, src]) => ({ path, src, fileName: path.split("/").pop()! }))
    .sort((a, b) =>
      a.fileName.localeCompare(b.fileName, undefined, { numeric: true }),
    )
    .map(({ src, fileName }) => ({ src, title: titleFromFileName(fileName) }))
}

export const artworks: Record<ArtworkKind, Artwork[]> = {
  "2D": artworksIn("2d"),
  "3D": artworksIn("3d"),
}
