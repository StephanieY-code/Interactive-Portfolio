# Artworks

This folder holds what the website's galleries show:

- `2d/` → the **2D** goose
- `3d/` → the **3D** goose

You don't put files here by hand. Put your art in **`artwork-originals/`**
(in the project folder) and press **`Publish Artwork.command`**. It makes the
website versions here for you:

```
artwork-originals/2d/03-Amaura.jpg     →  src/artworks/2d/03-Amaura.jpg      (website-sized)
artwork-originals/3d/01-dragon.blend   →  src/artworks/3d/01-dragon.mp4      (spinning video)
                                          src/artworks/3d/01-dragon.av1.mp4
```

`artwork-originals/` stays on your Mac and is never uploaded, so your
full-size files stay private and the website stays fast.

**Order and titles:** files are sorted by name, so number them:
`01-sunset-goose.png`, `02-tomato-study.jpg`, ... The part after the number
becomes the title ("Sunset goose"). Until a gallery has at least one piece, it
shows placeholder art.

## 2D art

Put full-size images (`.jpg`, `.png`, `.webp`, `.gif`, ...) in
**`artwork-originals/2d/`**, then publish. The 2D gallery always matches that
folder:

- **New image:** a website-sized copy is added (at most 2000 px on its longest
  side, about 0.3 MB; it looks the same on screen).
- **Changed or replaced image** (same file name): its copy is remade.
- **Deleted or renamed image:** its old copy is removed from the gallery.
- PNGs with transparency stay PNG; other PNGs become (much smaller) JPGs.
  Animated GIFs keep their animation.
- An image that lands in `src/artworks/2d/` some other way (dropped in
  directly, or uploaded on github.com) is moved into `artwork-originals/2d/`
  on the next publish, so it's kept, not removed.

## 3D models: spinning turntables from Blender

Put a `.blend` file in **`artwork-originals/3d/`** and publish. Blender makes
a smooth, looping 360° spin of it for the 3D gallery:

- **It renders by itself**, in the background, with your scene's lights,
  materials, and color look. Your `.blend` is never changed.
- **The camera circles the model** from your camera's angle and height,
  zoomed so nothing is ever cut off. Your lights move with it, so the model
  stays lit the way you lit it. Flat floors or backdrops are ignored when
  working out what to circle.
- **Two small videos** are made: AV1 (about half the size, played by Chrome,
  Firefox, Edge, the Quest, and newer Apple devices) and H.264 (the fallback
  for everything else). Each visitor downloads only one. A 6-second spin at
  720×720 is usually around 0.25 MB, so it loads in a blink.
- **It only re-renders when needed:** a new `.blend`, or one you saved since
  its last spin. Rendering takes a few minutes per model.
- **To remove one:** delete its two videos from `src/artworks/3d/` and the
  `.blend` from `artwork-originals/3d/` (or it'll be made again), then
  publish.

## Publishing from github.com instead

Open `src/artworks/2d` (or `3d`) in the repo on github.com, choose **Add file
→ Upload files**, drag the images in, and click **Commit changes**. The site
redeploys on its own. These uploads aren't resized, so shrink big images
first (around 2000 px on the longest side). The next time you publish from
your Mac, they're also copied into `artwork-originals/`.
