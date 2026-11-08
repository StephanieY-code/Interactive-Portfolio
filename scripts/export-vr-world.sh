#!/bin/sh
# Turns a Blender file into a VR world for one of the site's VR cards.
#
#   sh scripts/export-vr-world.sh ~/Desktop/BLENDER/PLANT.blend garden
#   (or double-click "Export VR World.command" and pick from menus)
#
# It runs Blender in the background (your .blend file is never changed),
# writes src/vr-worlds/<world>/scene.glb, and prints a short report. Publish
# it afterwards with "Publish Artwork.command".

set -eu
cd "$(dirname "$0")/.."

fail() {
  echo ""
  echo "✗ $1"
  exit 1
}

[ $# -eq 2 ] || fail "Usage: sh scripts/export-vr-world.sh <file.blend> <garden|clouds|moon>"
blend_file=$1
world=$2

case "$world" in
  garden | clouds | moon) ;;
  *) fail "'$world' isn't one of the VR cards. Use garden, clouds, or moon." ;;
esac
[ -f "$blend_file" ] || fail "Can't find the Blender file: $blend_file"
case "$blend_file" in
  *.blend) ;;
  *) fail "That isn't a .blend file: $blend_file" ;;
esac

blender=${BLENDER:-}
if [ -z "$blender" ]; then
  for candidate in /Applications/Blender.app/Contents/MacOS/Blender \
    "$HOME/Applications/Blender.app/Contents/MacOS/Blender"; do
    [ -x "$candidate" ] && blender=$candidate && break
  done
fi
[ -n "$blender" ] || blender=$(command -v blender 2>/dev/null || true)
[ -n "$blender" ] || fail "Can't find Blender. Install it in Applications (blender.org)."

folder="src/vr-worlds/$world"
mkdir -p "$folder"

echo "→ Exporting $(basename "$blend_file") into the $world world (Blender runs in the background)..."
log=$(mktemp)
trap 'rm -f "$log"' EXIT
# -Y: don't run scripts stored inside the .blend file.
if ! "$blender" -b -Y "$blend_file" --python scripts/blender/export_world.py \
  -- "$folder/scene.glb" > "$log" 2>&1; then
  tail -20 "$log"
  fail "Blender couldn't export the file. The lines above say why."
fi
grep -q "VR-EXPORT-DONE" "$log" || { tail -20 "$log"; fail "The export didn't finish. The lines above say why."; }
sed -n '/VR-EXPORT-REPORT/,/VR-EXPORT-DONE/p' "$log" | sed -e '/VR-EXPORT-/d'

if [ ! -f "$folder/world.json" ]; then
  title=$(printf '%s' "$world" | awk '{ print toupper(substr($0, 1, 1)) substr($0, 2) }')
  printf '{\n  "title": "%s",\n  "scale": 1\n}\n' "$title" > "$folder/world.json"
  echo "  Made $folder/world.json (settings: title, size, touchable objects)."
fi

echo ""
echo "✓ Exported to $folder/scene.glb"
if ! ls "$folder"/cover.* >/dev/null 2>&1; then
  echo "  Tip: add the card's 2D drawing as $folder/cover.jpg (or .png)."
fi
echo "  Preview it with 'pnpm dev', then publish with 'Publish Artwork.command'."
