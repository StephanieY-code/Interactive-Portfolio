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

1. Put your full-size art in **`artwork-originals/`** in this folder (it
   stays on your Mac and is never uploaded). Number files to set the order:
   `01-sunset.jpg`, `02-goose.png`, ...
   - **2D:** images go in `artwork-originals/2d/`.
   - **3D:** `.blend` files go in `artwork-originals/3d/`.
2. Double-click **`Publish Artwork.command`** (or run `pnpm art:publish`). It
   makes website-sized copies of new or changed 2D images (and removes ones
   you deleted), renders a looping 360° spin of each new or changed `.blend`,
   then commits and pushes.
3. The live site updates in about a minute.

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
