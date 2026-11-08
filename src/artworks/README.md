# Artworks

Put images in these folders and they appear in the gallery automatically:

- `2d/` → the **2D** goose
- `3d/` → the **3D** goose

Supported: `.png`, `.jpg`, `.jpeg`, `.webp`, `.avif`, `.gif`

**Order:** files are sorted by name, so number them: `01-sunset-goose.png`,
`02-tomato-study.jpg`, ... The part after the number becomes the title
("Sunset goose").

**Size:** don't worry about it when publishing from your Mac. The publish
button shrinks big PNG/JPG files for you (see below).

Until a folder has at least one image, that gallery shows placeholder art.

## Publishing

- **On your Mac (recommended):** drop the files in, then double-click
  `Publish Artwork.command` in the project folder. It:
  1. makes big images website-sized: anything longer than 2400 px is scaled
     down, and a heavy PNG without transparency becomes a JPG;
  2. keeps your untouched full-size originals in `artwork-originals/` in the
     project folder (that folder stays on your Mac and is never uploaded);
  3. commits and pushes the artwork, and the live site updates about a minute
     later.
- **On github.com:** open this folder in the repo, choose **Add file → Upload
  files**, drag the images in, and click **Commit changes**. The site redeploys
  on its own. Images uploaded this way are **not** shrunk, so resize big ones
  first (around 2400 px on the longest side, under ~3 MB).
