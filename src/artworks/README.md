# Artworks

Put images in these folders and they appear in the gallery automatically:

- `2d/` → the **2D** goose
- `3d/` → the **3D** goose

Supported: `.png`, `.jpg`, `.jpeg`, `.webp`, `.avif`, `.gif`

**Order:** files are sorted by name, so number them: `01-sunset-goose.png`,
`02-tomato-study.jpg`, ... The part after the number becomes the title
("Sunset goose").

**Size:** keep each image under about 2–3 MB (around 2400 px on the longest
side) so the site stays fast.

Until a folder has at least one image, that gallery shows placeholder art.

## Publishing

- **On your Mac:** drop the files in, then double-click `Publish Artwork.command`
  in the project folder. It commits and pushes them, and the live site updates
  about a minute later.
- **On github.com:** open this folder in the repo, choose **Add file → Upload
  files**, drag the images in, and click **Commit changes**. The site redeploys
  on its own.
