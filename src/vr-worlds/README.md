# VR worlds

Each VR card on the site opens the world in its folder:

```
src/vr-worlds/
  garden/   ← card 1
  clouds/   ← card 2
  moon/     ← card 3
```

Inside a world's folder:

| File | What it is |
| --- | --- |
| `cover.jpg` (or `.png`) | The 2D drawing shown on the card. |
| `scene.glb` | The 3D world, made from your Blender file (see below). |
| `world.json` | Optional settings (see below). |

A card with no `scene.glb` keeps the simple animated placeholder world.

## Add or update a world

1. **Export from Blender:** double-click **`Export VR World.command`** in the
   project folder, pick your `.blend` file, then pick the card (garden,
   clouds, or moon). Blender runs in the background and your `.blend` file
   is never changed. Read the short report it prints; lines starting with
   `!` are things to know about.
2. **Add the cover:** put the card's drawing in the same folder as
   `cover.jpg`.
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
- **shadows**: set to `false` if the headset feels choppy.
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
  glass. Procedural node setups don't carry over, so bake them to an image
  texture.
- **Lights:** point, spot, sun, and area lights carry over with their color
  and strength (including Exposure). Shadows come from spot and sun lights.
- **Animations:** animations on touchable objects play when they're touched;
  all other animations loop.
- **The floor:** visitors can teleport anywhere on the ground (height 0)
  near the scene.

## On a Meta Quest

1. Open the **Browser** app on the Quest and go to
   https://stephaniey-code.github.io/Interactive-Portfolio/
2. Scroll to the VR cards and click one.
3. Press **Enter VR** at the bottom.
4. **Look around** by turning your head. **Point and pull the trigger** (or
   pinch with your hand) to touch things. To move, **point at the floor**
   until a curved line appears, then pull the trigger to teleport there.
5. To leave, press the **Meta button** on the right controller and choose
   to exit, or take the headset off.
