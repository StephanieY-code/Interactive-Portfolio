# VR worlds

Each VR card on the site opens the world in its folder:

```
src/vr-worlds/
  garden/   ← card 1 (the one on the VR slide; now the Ramen Shop)
  clouds/   ← card 2
  moon/     ← card 3
```

On the VR slide, the TV screen shows the world's cover drawing. Clicking it
plays the drawing's timelapse (`cover.mp4`) on the screen (clicking again
skips it), then the slide zooms into the screen. Clicking **Step inside**
(or the screen) opens the 3D world in a big framed panel, like the artwork
popup, with an **Enter VR** button for Quest visitors. The ✕ or the Escape
key zooms back out.

Inside a world's folder:

| File | What it is |
| --- | --- |
| `cover.jpg` (or `.png`, `.webp`) | The 2D drawing shown on the TV screen. |
| `cover.mp4` (or `.webm`) | Optional. The drawing's timelapse, played once on the TV when it's clicked, before the zoom. Without it, a click zooms straight in. |
| `scene.glb` | The 3D world, made from your Blender file (see below). |
| `world.json` | Optional settings (see below). |

A card with no `scene.glb` keeps the simple animated placeholder world. A
world with no cover shows a live 3D view on the TV instead.

## Add or update a world

1. **Export from Blender:** double-click **`Export VR World.command`** in the
   project folder, pick your `.blend` file, then pick the card (garden,
   clouds, or moon). Blender runs in the background and your `.blend` file
   is never changed. Read the short report it prints; lines starting with
   `!` are things to know about.
2. **Add the cover:** put the card's drawing in the same folder as
   `cover.jpg` (delete the old cover if it has a different ending, like
   `cover.webp`). For a timelapse, also add `cover.mp4`. Keep the video
   small (under about 5 MB) so it starts quickly; it only plays inside the
   TV, so 960 x 720 is plenty. Its last frame should be the finished
   drawing, since the drawing takes over when the zoom starts.
3. **Preview (optional):** run `pnpm dev` and open http://localhost:8443.
4. **Publish:** double-click **`Publish Artwork.command`**. The live site
   updates about a minute later.

From a terminal, step 1 is: `pnpm vr:export ~/Desktop/BLENDER/PLANT.blend garden`

## Settings (`world.json`)

```json
{
  "title": "Garden",
  "scale": 0.4,
  "startDistance": 3,
  "startOn": "Cube.007",
  "startFacing": "Cube",
  "shadows": true,
  "touchable": [
    { "name": "Plant", "objects": ["Cube.007", "BézierCurve*"] }
  ]
}
```

- **title**: the world's name (screen readers and the loading message).
- **scale**: size multiplier. In VR, 1 Blender unit = 1 real meter. The
  garden's plant is about 4 units tall, so `0.4` makes it a 1.6 m houseplant.
- **startDistance**: how many meters from the main subject visitors start.
- **startOn**: the name of a Blender object VR visitors start standing on
  (the Ramen Shop uses `Cube.007`, the first stone of the path).
- **startFacing**: the name of a Blender object VR visitors start facing
  (the Ramen Shop uses `Cube`, the shop itself).
- **shadows**: set to `false` if the headset feels choppy (only matters if
  baking ever fails, since baked worlds already have their shadows).
- **touchable**: groups of Blender objects that glow when pointed at and
  sway when clicked or pinched. Use the names from Blender's Outliner; a
  `*` at the end matches the start of a name (`BézierCurve*` matches
  `BézierCurve.001`, `.002`, ...).

## Blender tips for VR

- **Name things to make them touchable:** any object whose name starts with
  `touch` (like `touch_lamp`) is touchable without editing `world.json`.
  Its children come along, so you can parent a group under one empty.
- **Choose where visitors start:** add an Empty (Add → Empty → Plain Axes)
  named `VR_Spawn` on the floor. Visitors start there, facing what your
  camera looks at. Without it, they start a few steps back from the
  camera's subject.
- **Your camera matters:** on laptops and phones, the world opens from your
  Blender camera's view.
- **Keep it light for the headset:** under about 300,000 triangles, textures
  up to 2048 px (bigger ones are shrunk for you), and a file under 25 MB.
- **Materials:** use the Principled BSDF. Glass becomes simple see-through
  glass. Toon setups (Shader to RGB → Color Ramp) become the one color they
  show in a Cycles render. Other procedural node setups don't carry over,
  so bake them to an image texture.
- **Geometry Nodes:** scattered copies (like leaves on a tree) are turned
  into real geometry for the export, so they show up on the web.
- **Lighting is baked:** during the export, Cycles works out the light on
  every surface (bounced light and soft shadows included) and saves it into
  the model, so the web looks like a Cycles render of your scene, even if
  the file is set to EEVEE. It takes about a minute. Big flat faces get
  split into smaller ones so the light has enough detail, and thin parts
  like leaves get light on both sides. If you change lights, export again.
- **Camera:** a perspective or orthographic camera both work. The web view
  starts from the same angle and shows the same width of the scene.
- **Color:** Blender's color look (AgX, Filmic, Standard, plus its Look
  and Exposure, in Render Properties → Color Management) carries over
  exactly, as a small color table saved in the model.
- **Animations:** animations on touchable objects play when they're touched;
  all other animations loop.
- **The floor:** visitors can teleport anywhere on the ground (height 0)
  across the scene.

## On a Meta Quest

1. Open the **Browser** app on the Quest and go to
   https://stephaniey-code.github.io/Interactive-Portfolio/
2. Scroll to the VR slide and click the TV screen.
3. Press **Enter VR** at the bottom.
4. **Look around** by turning your head. **Point and pull the trigger** (or
   pinch with your hand) to touch things. To move, **point at the floor**
   until a curved line appears, then pull the trigger to teleport there.
5. To leave, press the **Meta button** on the right controller and choose
   to exit, or take the headset off.
