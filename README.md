# Interactive-Portfolio

Stephanie Yang's creative portfolio: 2D, 3D, and VR work. Built in Figma Make with React, Vite, and Tailwind CSS.

**Live site:** https://stephaniey-code.github.io/Interactive-Portfolio/

## Run locally

```bash
pnpm install
pnpm dev
```

Then open http://localhost:8443.

## Add artwork

1. Put images in `src/artworks/2d` or `src/artworks/3d`. Number them to set
   the order: `01-sunset.png`, `02-goose.jpg`, ...
2. Double-click **`Publish Artwork.command`** in this folder (or run
   `pnpm art:publish`). It shrinks big images to website size, keeps the
   full-size originals in `artwork-originals/` (never uploaded), then commits
   and pushes just the artwork.
3. The live site updates in about a minute.

**3D models:** put a `.blend` file in `artwork-originals/3d/` and publish.
Blender renders a looping 360° spin of it (a small video, like a GIF) into
the 3D gallery. It only re-renders when the `.blend` is new or changed.

You can also upload straight on github.com: open `src/artworks/2d` (or `3d`),
choose **Add file → Upload files**, then **Commit changes**. Those uploads
aren't shrunk, so resize big images first.
More details: [src/artworks/README.md](src/artworks/README.md)

## VR worlds (Blender → website → Meta Quest)

Each VR card opens a 3D world made in Blender. Visitors can look around on a
laptop or phone, or press **Enter VR** in a Meta Quest's browser to step
inside (WebXR).

1. Double-click **`Export VR World.command`**, pick the `.blend` file and the
   card (garden, clouds, or moon).
2. Put the card's 2D drawing next to it as `src/vr-worlds/<card>/cover.jpg`.
3. Double-click **`Publish Artwork.command`**.

Settings, Blender tips, and how to try it on a Quest:
[src/vr-worlds/README.md](src/vr-worlds/README.md)

## Deploy

Every push to `main` builds the site and publishes it to GitHub Pages through
`.github/workflows/deploy-pages.yml`. You can also re-run it by hand from the
repo's **Actions** tab.
