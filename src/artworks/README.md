# Artworks

Put images in these folders and they appear in the gallery automatically:

- `2d/` → the **2D** goose
- `3d/` → the **3D** goose

Supported: `.png`, `.jpg`, `.jpeg`, `.webp`, `.avif`, `.gif`, and videos
(`.mp4`, `.webm`), which play silently on a loop like a GIF.

## 3D models: spinning turntables from Blender

Put a `.blend` file in **`artwork-originals/3d/`** (in the project folder) and
press **`Publish Artwork.command`**. Blender makes a smooth, looping 360° spin
of it, and the spin appears in the **3D** gallery:

```
artwork-originals/3d/01-dragon.blend  →  src/artworks/3d/01-dragon.mp4
                                          src/artworks/3d/01-dragon.av1.mp4
```

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
  its last spin. Otherwise publishing stays quick. Rendering takes a few
  minutes per model.
- **Order and title** work like images: `02-robot.blend` becomes "Robot".
- **To remove one:** delete its two videos from `src/artworks/3d/` (and the
  `.blend` from `artwork-originals/3d/`, or it'll be made again), then publish.
- The `.blend` files stay on your Mac: `artwork-originals/` is never uploaded.

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
