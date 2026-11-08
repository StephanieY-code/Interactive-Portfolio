"""Renders a looping 360-degree turntable video of a Blender scene.

Run by scripts/turntables.sh (which the publish button runs for every .blend
in artwork-originals/3d). Blender runs in the background, and your .blend
file is never changed or saved.

    Blender -b -Y scene.blend --python turntable.py -- out.mp4 [frames] [size] [h264_crf] [av1_crf]

How the spin is made, on a temporary copy of the scene in memory:
  * The "main object" is everything visible except flat ground/backdrop
    planes. A new camera circles it, starting from your camera's direction
    and height (or a 3/4 view if there is no camera), pulled back just far
    enough that nothing is ever cut off.
  * Your lights travel with the camera, so the model stays lit the way you
    lit it, from every side.
  * It loops seamlessly: the last frame leads straight back into the first.
  * Frames are rendered once (lossless), then encoded twice, silent and square:
      out.av1.mp4  AV1, about half the size; Chrome, Firefox, Edge, Quest,
                   and newer Apple devices play this one
      out.mp4      H.264, the fallback every other browser plays
    Both are tuned to load fast (about 0.25 MB and 0.4 MB for a 6-second,
    720x720 spin) while staying crisp at gallery size.
"""

import math
import os
import shutil
import sys
import tempfile
import time

import bpy
import numpy
from mathutils import Matrix, Vector

args = sys.argv[sys.argv.index("--") + 1 :]
out_path = os.path.abspath(args[0])
av1_path = out_path[: -len(".mp4")] + ".av1.mp4"
FRAMES = int(args[1]) if len(args) > 1 else 144  # 6 seconds at 24 fps
SIZE = int(args[2]) if len(args) > 2 else 720
H264_CRF = int(args[3]) if len(args) > 3 else 28  # lower = sharper, bigger
AV1_CRF = int(args[4]) if len(args) > 4 else 42

scene = bpy.context.scene
depsgraph = bpy.context.evaluated_depsgraph_get()


def world_corners(ob):
    evaluated = ob.evaluated_get(depsgraph)
    return [evaluated.matrix_world @ Vector(corner) for corner in evaluated.bound_box]


def main_objects():
    """Visible, renderable objects with geometry, minus flat ground/backdrops."""
    candidates = [
        ob
        for ob in scene.objects
        if ob.visible_get()
        and not ob.hide_render
        and ob.type in {"MESH", "CURVE", "SURFACE", "META", "FONT", "CURVES", "POINTCLOUD", "VOLUME"}
    ]
    solid = []
    for ob in candidates:
        corners = world_corners(ob)
        size = [max(c[i] for c in corners) - min(c[i] for c in corners) for i in range(3)]
        if max(size) > 0 and min(size) < 0.01 * max(size):
            continue  # a flat plane: floor, wall, or backdrop
        solid.append(ob)
    return solid or candidates


objects = main_objects()
if not objects:
    print("TURNTABLE-ERROR: there's nothing visible to spin around.")
    sys.exit(1)

def world_points(ob):
    """The model's real surface points (fast, with numpy); box corners as a fallback."""
    evaluated = ob.evaluated_get(depsgraph)
    try:
        mesh = evaluated.to_mesh()
    except RuntimeError:
        mesh = None
    if mesh is None or len(mesh.vertices) == 0:
        if mesh is not None:
            evaluated.to_mesh_clear()
        return numpy.array([tuple(c) for c in world_corners(ob)])
    coords = numpy.empty(len(mesh.vertices) * 3)
    mesh.vertices.foreach_get("co", coords)
    evaluated.to_mesh_clear()
    coords = coords.reshape(-1, 3)
    matrix = numpy.array(evaluated.matrix_world)
    return coords @ matrix[:3, :3].T + matrix[:3, 3]


points = numpy.concatenate([world_points(ob) for ob in objects])
low, high = points.min(axis=0), points.max(axis=0)
center = Vector(((low + high) / 2).tolist())
# The model spins around a vertical axis, so it sweeps out a cylinder:
spin_radius = float(numpy.sqrt(((points[:, :2] - numpy.array(center[:2])) ** 2).sum(axis=1)).max())
height = float(high[2] - low[2])

# Start from the scene camera's direction, height, and lens.
original_camera = scene.camera
if original_camera:
    offset = original_camera.matrix_world.translation - center
    azimuth = math.atan2(offset.y, offset.x)
    elevation = math.asin(max(-0.95, min(0.95, offset.z / max(offset.length, 1e-6))))
    lens = original_camera.data.lens if original_camera.data.type == "PERSP" else 50.0
    sensor = original_camera.data.sensor_width
else:
    azimuth, elevation, lens, sensor = math.radians(-60), math.radians(15), 50.0, 36.0

# Pull back just far enough that the spinning model (a cylinder of
# spin_radius x height, seen from `elevation`) always fits the square frame.
half_fov = math.atan((sensor / 2) / lens)
seen_height = height * math.cos(elevation) + 2 * spin_radius * abs(math.sin(elevation))
distance = 1.05 * max(
    spin_radius / math.sin(half_fov),  # its width, at any angle
    seen_height / (2 * math.tan(half_fov)) + spin_radius,  # its height, nearest edge
)
radius = math.hypot(spin_radius, height / 2)  # for the camera's clipping range

pivot = bpy.data.objects.new("Turntable Pivot", None)
scene.collection.objects.link(pivot)
pivot.location = center

camera_data = bpy.data.cameras.new("Turntable Camera")
camera_data.lens = lens
camera_data.sensor_width = sensor
camera_data.sensor_fit = "AUTO"
camera_data.clip_start = max(0.001, (distance - radius) * 0.05)
camera_data.clip_end = (distance + radius) * 4
camera = bpy.data.objects.new("Turntable Camera", camera_data)
scene.collection.objects.link(camera)
direction = Vector(
    (
        math.cos(elevation) * math.cos(azimuth),
        math.cos(elevation) * math.sin(azimuth),
        math.sin(elevation),
    )
)
camera.matrix_world = Matrix.Translation(center + direction * distance) @ (
    (-direction).to_track_quat("-Z", "Y").to_matrix().to_4x4()
)
bpy.context.view_layer.update()

# Camera and lights ride on the pivot, so the lighting turns with the view.
for ob in [camera] + [o for o in scene.objects if o.type == "LIGHT" and o.parent is None]:
    world = ob.matrix_world.copy()
    ob.parent = pivot
    ob.matrix_world = world
scene.camera = camera

# One full turn: frame 1 is 0 degrees, frame FRAMES+1 would be 360 again.
# A driver (not keyframes) keeps it simple and needs no Python scripting.
driver = pivot.driver_add("rotation_euler", 2).driver
driver.type = "SCRIPTED"
driver.expression = f"(frame - 1) * {2 * math.pi / FRAMES!r}"

# Render settings: square, 24 fps, the scene's own engine and look.
render = scene.render
render.resolution_x = render.resolution_y = SIZE
render.resolution_percentage = 100
render.pixel_aspect_x = render.pixel_aspect_y = 1
render.use_border = False
render.film_transparent = False
render.fps, render.fps_base = 24, 1
scene.frame_start, scene.frame_end, scene.frame_step = 1, FRAMES, 1
if render.engine == "CYCLES":
    scene.cycles.samples = min(scene.cycles.samples, 128)
    scene.cycles.use_denoising = True

# Step 1: render every frame once, losslessly (PNG), with the scene's colors.
frames_dir = tempfile.mkdtemp(prefix="turntable-frames-")
# For checking framing: TURNTABLE_STILLS=<folder> keeps the PNG frames there.
stills_dir = os.environ.get("TURNTABLE_STILLS")
if stills_dir:
    frames_dir = os.path.abspath(stills_dir)
image = render.image_settings
image.media_type = "IMAGE"
image.file_format = "PNG"
image.color_mode = "RGB"
image.compression = 15
render.filepath = os.path.join(frames_dir, "frame-")
render.use_file_extension = True

started = time.time()


def report_progress(_scene, _depsgraph=None):
    done = _scene.frame_current - _scene.frame_start + 1
    if done == 1 or done % 12 == 0 or done == FRAMES:
        elapsed = time.time() - started
        print(f"TURNTABLE-PROGRESS {done}/{FRAMES} frames ({elapsed:.0f}s)", flush=True)


bpy.app.handlers.render_post.append(report_progress)
bpy.ops.render.render(animation=True, scene=scene.name)
bpy.app.handlers.render_post.remove(report_progress)
if stills_dir:
    print(f"TURNTABLE-DONE stills in {stills_dir} ({time.time() - started:.0f}s)")
    sys.exit(0)

frames = sorted(f for f in os.listdir(frames_dir) if f.endswith(".png"))
if len(frames) != FRAMES:
    print(f"TURNTABLE-ERROR: only {len(frames)} of {FRAMES} frames were rendered.")
    sys.exit(1)

# Step 2: encode those frames into the two videos with Blender's video editor.
# The frames already have the scene's colors baked in, so this scene uses the
# plain "Standard" view to pass them through unchanged.
encoder = bpy.data.scenes.new("Turntable Encode")
encoder.view_settings.view_transform = "Standard"
encoder.view_settings.look = "None"
encoder.view_settings.exposure = 0
encoder.view_settings.gamma = 1
encoder.sequencer_colorspace_settings.name = "sRGB"
editor = encoder.sequence_editor_create()
strips = editor.strips if hasattr(editor, "strips") else editor.sequences
strip = strips.new_image(
    name="frames", filepath=os.path.join(frames_dir, frames[0]), channel=1, frame_start=1
)
for name in frames[1:]:
    strip.elements.append(name)
encoder.frame_start, encoder.frame_end = 1, FRAMES
out = encoder.render
out.resolution_x = out.resolution_y = SIZE
out.resolution_percentage = 100
out.fps, out.fps_base = 24, 1
out.use_sequencer = True
out.use_compositing = False
out.image_settings.media_type = "VIDEO"
out.image_settings.file_format = "FFMPEG"
out.image_settings.color_mode = "RGB"
video = out.ffmpeg
video.format = "MPEG4"
video.ffmpeg_preset = "BEST"  # slowest encode, smallest file
video.gopsize = FRAMES
video.use_max_b_frames = True
video.max_b_frames = 3
video.audio_codec = "NONE"
video.constant_rate_factor = "CUSTOM"


def encode(codec, crf, destination):
    video.codec = codec
    video.custom_constant_rate_factor = crf
    work_dir = tempfile.mkdtemp(prefix="turntable-video-")
    out.filepath = os.path.join(work_dir, "spin-")
    bpy.ops.render.render(animation=True, scene=encoder.name)
    made = [f for f in os.listdir(work_dir) if f.lower().endswith(".mp4")]
    if not made:
        print(f"TURNTABLE-ERROR: Blender didn't produce the {codec} video.")
        sys.exit(1)
    os.makedirs(os.path.dirname(destination), exist_ok=True)
    shutil.move(os.path.join(work_dir, made[0]), destination)
    shutil.rmtree(work_dir, ignore_errors=True)
    return os.path.getsize(destination) / 1_000_000


h264_mb = encode("H264", H264_CRF, out_path)
av1_mb = encode("AV1", AV1_CRF, av1_path)
shutil.rmtree(frames_dir, ignore_errors=True)

print(
    f"TURNTABLE-DONE {os.path.basename(out_path)}: {SIZE}x{SIZE}, {FRAMES} frames, "
    f"{av1_mb:.1f} MB (AV1) / {h264_mb:.1f} MB (H.264 fallback), "
    f"made in {time.time() - started:.0f}s",
    flush=True,
)
