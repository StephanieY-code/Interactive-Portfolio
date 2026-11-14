"""Exports a Blender scene as a web/VR-ready .glb for the portfolio.

Run by scripts/export-vr-world.sh (or "Export VR World.command"); it runs
Blender in the background, so your .blend file is never changed or saved.

    Blender -b -Y scene.blend --python export_world.py -- out.glb

What it does on a temporary copy of the scene in memory:
  * Skips hidden objects, and exports the camera and animations.
  * Copies made with Geometry Nodes (scattered leaves, grass) become real
    geometry, since the web format can't store them as copies.
  * Toon color setups (Shader to RGB -> Color Ramp) become the single color
    they show in a Cycles render.
  * Materials the web can't read (glass or mix-shader setups) are swapped for
    see-through tinted glass, or simplified to their Principled BSDF. Objects
    with no material get Blender's default grey (the web would show metal).
  * Textures larger than 2048 px are scaled down, and all are saved as WebP,
    so they're light enough for a Meta Quest.
  * Lights are written into the file the way Blender renders them (color,
    power x 2^exposure, cone, shadows), including Area lights, which the
    standard web format can't hold. The viewer rebuilds them from this.
  * Saves Blender's color look (AgX or Standard) so the web matches it.
  * Prints a short report: size, triangle count, and any warnings.
"""

import json
import math
import os
import struct
import sys

import bpy
from mathutils import Vector

MAX_TEXTURE = 2048
TRIANGLE_BUDGET = 300_000

out_path = sys.argv[sys.argv.index("--") + 1]
warnings = []


def surface_source(material):
    """Returns the node plugged into the material output's Surface socket."""
    for node in material.node_tree.nodes:
        if node.bl_idname == "ShaderNodeOutputMaterial" and node.is_active_output:
            links = node.inputs["Surface"].links
            return node, (links[0].from_node if links else None)
    return None, None


def make_glass(material):
    """Replaces a glass/transparent node setup with simple tinted glass."""
    tree = material.node_tree
    output, _ = surface_source(material)
    glass = tree.nodes.new("ShaderNodeBsdfPrincipled")
    glass.inputs["Base Color"].default_value = (0.85, 0.93, 1.0, 1.0)
    glass.inputs["Roughness"].default_value = 0.05
    glass.inputs["Alpha"].default_value = 0.18
    tree.links.new(glass.outputs["BSDF"], output.inputs["Surface"])
    if hasattr(material, "surface_render_method"):
        material.surface_render_method = "BLENDED"
    if hasattr(material, "blend_method"):
        material.blend_method = "BLEND"
    material.use_backface_culling = False


def give_default_material():
    """Objects with no material render grey in Blender, but metal on the web."""
    default = None
    for ob in bpy.context.scene.objects:
        if not ob.visible_get() or ob.type != "MESH":
            continue
        if ob.material_slots and all(slot.material for slot in ob.material_slots):
            continue
        if default is None:
            default = bpy.data.materials.new("Default grey")
            default.use_nodes = True
            bsdf = default.node_tree.nodes.get("Principled BSDF")
            bsdf.inputs["Base Color"].default_value = (0.8, 0.8, 0.8, 1.0)
            bsdf.inputs["Metallic"].default_value = 0.0
            bsdf.inputs["Roughness"].default_value = 0.5
        if not ob.material_slots:
            ob.data.materials.append(default)
        for slot in ob.material_slots:
            if not slot.material:
                slot.material = default


def fix_materials():
    used = {
        slot.material
        for ob in bpy.context.scene.objects
        if ob.visible_get() and ob.type in {"MESH", "CURVE", "SURFACE", "META", "FONT"}
        for slot in ob.material_slots
        if slot.material
    }
    for material in used:
        if not material.use_nodes or not material.node_tree:
            continue
        output, source = surface_source(material)
        if output is None or source is None:
            continue
        if source.bl_idname == "ShaderNodeBsdfPrincipled":
            continue
        kinds = {n.bl_idname for n in material.node_tree.nodes}
        principled = next(
            (n for n in material.node_tree.nodes if n.bl_idname == "ShaderNodeBsdfPrincipled"), None
        )
        is_glass = kinds & {"ShaderNodeBsdfGlass", "ShaderNodeBsdfRefraction"} or (
            "ShaderNodeBsdfTransparent" in kinds and not principled
        )
        if is_glass:
            make_glass(material)
            warnings.append(f"'{material.name}': glass setup exported as simple see-through glass.")
            continue
        if principled:
            material.node_tree.links.new(principled.outputs["BSDF"], output.inputs["Surface"])
            warnings.append(f"'{material.name}': special node setup simplified to its Principled BSDF.")
        else:
            warnings.append(
                f"'{material.name}': node setup can't be exported to the web; it will look plain. "
                "Use a Principled BSDF, or bake it to an image texture."
            )


LUMINANCE = (0.2126, 0.7152, 0.0722)


def as_float(value):
    return sum(c * w for c, w in zip(value, LUMINANCE)) if isinstance(value, tuple) else value


def as_color(value):
    return value if isinstance(value, tuple) else (value, value, value, 1.0)


def smooth(edge0, edge1, x, smoother):
    t = min(max((x - edge0) / (edge1 - edge0), 0.0), 1.0)
    return t * t * t * (t * (t * 6 - 15) + 10) if smoother else t * t * (3 - 2 * t)


def constant_value(socket):
    """What a node input works out to, when it's the same everywhere on the
    surface (no textures, attributes, or lighting tricks), else None.

    Blender's renderer (Cycles) can't run the "Shader to RGB" toon node and
    treats it as unplugged, so the input it feeds keeps its own value. That's
    what the render shows, so the web gets that too.
    """
    if not socket.links:
        value = socket.default_value
        return tuple(value) if hasattr(value, "__len__") else value
    node = socket.links[0].from_node
    kind = node.bl_idname
    if kind == "ShaderNodeShaderToRGB":
        value = socket.default_value
        return tuple(value) if hasattr(value, "__len__") else value
    if kind == "ShaderNodeRGB":
        return tuple(node.outputs[0].default_value)
    if kind == "ShaderNodeValue":
        return node.outputs[0].default_value
    if kind == "ShaderNodeValToRGB":  # Color Ramp
        factor = constant_value(node.inputs[0])
        return None if factor is None else tuple(node.color_ramp.evaluate(as_float(factor)))
    if kind == "ShaderNodeMapRange" and node.data_type == "FLOAT":
        values = [constant_value(node.inputs[i]) for i in range(6)]
        if any(v is None for v in values):
            return None
        x, from_min, from_max, to_min, to_max, steps = (as_float(v) for v in values)
        if from_max == from_min:
            return 0.0
        if node.interpolation_type in {"SMOOTHSTEP", "SMOOTHERSTEP"}:
            smoother = node.interpolation_type == "SMOOTHERSTEP"
            if from_min > from_max:
                factor = 1 - smooth(from_max, from_min, x, smoother)
            else:
                factor = smooth(from_min, from_max, x, smoother)
        else:
            factor = (x - from_min) / (from_max - from_min)
            if node.interpolation_type == "STEPPED" and steps > 0:
                factor = math.floor(factor * (steps + 1)) / steps
        result = to_min + factor * (to_max - to_min)
        if node.clamp and node.interpolation_type in {"LINEAR", "STEPPED"}:
            result = min(max(result, min(to_min, to_max)), max(to_min, to_max))
        return result
    return None


def fold_constant_colors():
    """Color setups like toon ramps (Shader to RGB -> Color Ramp) can't be
    read by the web; when they work out to one color, use that color."""
    used = {
        slot.material
        for ob in bpy.context.scene.objects
        if ob.visible_get()
        for slot in ob.material_slots
        if slot.material and slot.material.use_nodes and slot.material.node_tree
    }
    for material in used:
        tree = material.node_tree
        for node in tree.nodes:
            if node.bl_idname != "ShaderNodeBsdfPrincipled":
                continue
            for socket in node.inputs:
                if not socket.links or socket.type not in {"RGBA", "VALUE"}:
                    continue
                value = constant_value(socket)
                if value is None:
                    continue
                tree.links.remove(socket.links[0])
                socket.default_value = as_color(value) if socket.type == "RGBA" else as_float(value)


def realize_instances():
    """Copies made by Geometry Nodes (scattered leaves, grass, rocks) aren't
    saved on their own in the web format, so they're turned into real
    geometry for the export."""
    done = set()
    for ob in bpy.context.scene.objects:
        if not ob.visible_get():
            continue
        for modifier in ob.modifiers:
            group = getattr(modifier, "node_group", None)
            if modifier.type != "NODES" or group is None or group in done:
                continue
            done.add(group)
            output = next(
                (n for n in group.nodes if n.bl_idname == "NodeGroupOutput" and n.is_active_output),
                None,
            )
            if output is None:
                continue
            for socket in output.inputs:
                if socket.type != "GEOMETRY" or not socket.links:
                    continue
                source = socket.links[0].from_socket
                realize = group.nodes.new("GeometryNodeRealizeInstances")
                group.links.new(source, realize.inputs[0])
                group.links.new(realize.outputs[0], socket)


def shrink_textures():
    for image in bpy.data.images:
        if image.users == 0 or image.source not in {"FILE", "GENERATED"}:
            continue
        width, height = image.size
        if max(width, height) > MAX_TEXTURE:
            factor = MAX_TEXTURE / max(width, height)
            image.scale(max(1, round(width * factor)), max(1, round(height * factor)))
            warnings.append(f"Texture '{image.name}' {width}x{height} scaled down to fit {MAX_TEXTURE}px.")


def count_triangles():
    depsgraph = bpy.context.evaluated_depsgraph_get()
    total = 0
    for ob in bpy.context.scene.objects:
        if not ob.visible_get() or ob.type not in {"MESH", "CURVE", "SURFACE", "META", "FONT"}:
            continue
        evaluated = ob.evaluated_get(depsgraph)
        try:
            mesh = evaluated.to_mesh()
        except RuntimeError:
            continue
        if mesh:
            mesh.calc_loop_triangles()
            total += len(mesh.loop_triangles)
            evaluated.to_mesh_clear()
    return total


def y_up(vector):
    """Blender is Z-up; the web (glTF) is Y-up."""
    return [round(vector.x, 4), round(vector.z, 4), round(-vector.y, 4)]


def light_records():
    """Each visible light as Blender renders it, in web units.

    Point/spot intensity is power / 4pi (Blender's convention), sun is its
    strength, and area lights become rectangles with luminance
    power / (pi * width * height). The viewer adjusts these for the
    world's scale.
    """
    records = []
    for ob in bpy.context.scene.objects:
        if not ob.visible_get() or ob.type != "LIGHT":
            continue
        light = ob.data
        power = light.energy * 2 ** getattr(light, "exposure", 0.0)
        color = list(light.color)
        if getattr(light, "use_temperature", False):
            color = [c * t for c, t in zip(color, light.temperature_color)]
        matrix = ob.matrix_world
        record = {
            "name": ob.name,
            "type": light.type.lower(),
            "color": [round(c, 4) for c in color],
            "position": y_up(matrix.translation),
            "direction": y_up((matrix.to_3x3() @ Vector((0, 0, -1))).normalized()),
            "shadow": bool(getattr(light, "use_shadow", True)),
            "softness": round(getattr(light, "shadow_soft_size", 0.0), 4),
        }
        if light.type in {"POINT", "SPOT"}:
            record["intensity"] = power / (4 * math.pi)
        if light.type == "SPOT":
            record["angle"] = light.spot_size / 2
            record["blend"] = light.spot_blend
        if light.type == "SUN":
            record["intensity"] = power
        if light.type == "AREA":
            scale = matrix.to_scale()
            width = light.size * scale.x
            height = (light.size_y if light.shape in {"RECTANGLE", "ELLIPSE"} else light.size) * scale.y
            record["width"] = round(width, 4)
            record["height"] = round(height, 4)
            normalized = getattr(light, "normalize", True)
            record["intensity"] = power / (math.pi * width * height) if normalized else power / math.pi
            record["up"] = y_up((matrix.to_3x3() @ Vector((0, 1, 0))).normalized())
        records.append(record)
    return records


def world_background():
    world = bpy.context.scene.world
    if world and world.use_nodes:
        for node in world.node_tree.nodes:
            if node.bl_idname == "ShaderNodeBackground":
                color = node.inputs["Color"].default_value
                strength = node.inputs["Strength"].default_value
                return [round(c * strength, 4) for c in color[:3]]
    return [0.05, 0.05, 0.05]


def add_scene_extras(path, extras):
    """Stores extra data in the .glb's scene (three.js reads it as userData)."""
    with open(path, "rb") as file:
        data = file.read()
    json_length = struct.unpack_from("<I", data, 12)[0]
    gltf = json.loads(data[20 : 20 + json_length])
    binary_chunks = data[20 + json_length :]
    scene = gltf["scenes"][gltf.get("scene", 0)]
    scene.setdefault("extras", {})["vr"] = extras
    encoded = json.dumps(gltf, separators=(",", ":")).encode("utf-8")
    encoded += b" " * ((4 - len(encoded) % 4) % 4)
    total = 12 + 8 + len(encoded) + len(binary_chunks)
    with open(path, "wb") as file:
        file.write(struct.pack("<III", 0x46546C67, 2, total))
        file.write(struct.pack("<II", len(encoded), 0x4E4F534A))
        file.write(encoded)
        file.write(binary_chunks)


def missing_images():
    for image in bpy.data.images:
        if image.users and image.source == "FILE" and not image.packed_file:
            path = bpy.path.abspath(image.filepath)
            if not os.path.exists(path):
                warnings.append(f"Image '{image.name}' is missing ({path}); that texture will be blank.")


def color_view():
    """Blender's color look (AgX, Standard...), so the web can match it."""
    view = bpy.context.scene.view_settings
    return {"transform": view.view_transform, "exposure": round(view.exposure, 4)}


missing_images()
realize_instances()
give_default_material()
fix_materials()
fold_constant_colors()
shrink_textures()
lights = light_records()
triangles = count_triangles()
if triangles > TRIANGLE_BUDGET:
    warnings.append(
        f"{triangles:,} triangles is a lot for a Quest headset (aim for under {TRIANGLE_BUDGET:,}). "
        "Try the Decimate modifier or lower Subdivision levels."
    )

os.makedirs(os.path.dirname(os.path.abspath(out_path)), exist_ok=True)
bpy.ops.export_scene.gltf(
    filepath=out_path,
    export_format="GLB",
    use_visible=True,
    export_apply=True,
    export_yup=True,
    export_lights=False,  # rebuilt by the viewer from the "vr" extras below
    export_cameras=True,
    export_animations=True,
    export_image_format="WEBP",
    export_image_quality=85,
)
add_scene_extras(
    out_path, {"lights": lights, "background": world_background(), "view": color_view()}
)

size_mb = os.path.getsize(out_path) / 1_000_000
if size_mb > 25:
    warnings.append(f"The file is {size_mb:.1f} MB; aim for under 25 MB so it loads quickly.")

print("")
print("VR-EXPORT-REPORT")
print(f"  File: {out_path}")
print(f"  Size: {size_mb:.1f} MB")
print(f"  Triangles: {triangles:,}")
print(f"  Lights: {len(lights)}")
spawn = bpy.context.scene.objects.get("VR_Spawn")
print(
    "  VR start point: "
    + ("the VR_Spawn empty" if spawn else "a few steps back from what the camera looks at")
)
for line in warnings:
    print(f"  ! {line}")
print("VR-EXPORT-DONE")
