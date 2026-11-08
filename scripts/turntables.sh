#!/bin/sh
# Makes a spinning 360-degree video for every Blender file in
# artwork-originals/3d and puts it in the 3D gallery (src/artworks/3d).
#
#   artwork-originals/3d/01-dragon.blend  ->  src/artworks/3d/01-dragon.av1.mp4
#                                            src/artworks/3d/01-dragon.mp4
# (AV1 is about half the size and most browsers play it; the plain .mp4 is
#  the fallback for older iPhones and Macs. Each visitor downloads only one.)
#
# A video is only re-rendered when its .blend is new or has been saved since
# the last render, so publishing again is quick. The publish button runs
# this for you; to run it on its own: pnpm art:spin
#
# Your .blend files stay on your Mac (artwork-originals is never uploaded);
# only the finished videos go online.

set -eu
cd "$(dirname "$0")/.."

SOURCE="artwork-originals/3d"
OUTPUT="src/artworks/3d"
FRAMES=144 # 6 seconds at 24 frames per second
SIZE=720   # pixels, square (the gallery shows it at most ~520 px tall)
H264_CRF=28 # video quality, lower = sharper but bigger. Tuned on the dragon:
AV1_CRF=42  # ~0.25 MB (AV1) / ~0.4 MB (H.264) per spin, still crisp at gallery size

[ -d "$SOURCE" ] || exit 0
ls "$SOURCE"/*.blend >/dev/null 2>&1 || exit 0

blender=${BLENDER:-}
if [ -z "$blender" ]; then
  for candidate in /Applications/Blender.app/Contents/MacOS/Blender \
    "$HOME/Applications/Blender.app/Contents/MacOS/Blender"; do
    [ -x "$candidate" ] && blender=$candidate && break
  done
fi
[ -n "$blender" ] || blender=$(command -v blender 2>/dev/null || true)
if [ -z "$blender" ]; then
  echo "  (Skipping 3D spins: Blender isn't installed in Applications.)"
  exit 0
fi

mkdir -p "$OUTPUT"
made=0
for blend in "$SOURCE"/*.blend; do
  name=$(basename "$blend" .blend)
  video="$OUTPUT/$name.mp4"
  if [ -f "$video" ] && [ ! "$blend" -nt "$video" ]; then
    continue # already up to date
  fi

  echo "  Spinning $name.blend (a few minutes; Blender works in the background)..."
  work=$(mktemp -d) # render outside the site, so a half-made video never shows
  # -Y: don't run scripts stored inside the .blend file.
  "$blender" -b -Y "$blend" --python scripts/blender/turntable.py \
    -- "$work/spin.mp4" "$FRAMES" "$SIZE" "$H264_CRF" "$AV1_CRF" 2>&1 \
    | tee "$work/log.txt" | grep --line-buffered "^TURNTABLE-PROGRESS" \
    | sed -u -e 's/^TURNTABLE-PROGRESS /    /' || true

  if grep -q "^TURNTABLE-DONE" "$work/log.txt" && [ -f "$work/spin.mp4" ] \
    && [ -f "$work/spin.av1.mp4" ]; then
    mv "$work/spin.av1.mp4" "$OUTPUT/$name.av1.mp4"
    mv "$work/spin.mp4" "$video"
    grep "^TURNTABLE-DONE" "$work/log.txt" | sed -e "s/^TURNTABLE-DONE spin.mp4/  ✓ $name.mp4/"
    made=$((made + 1))
  else
    echo "  ✗ Couldn't make a spin for $name.blend. Blender said:"
    grep -E "TURNTABLE-ERROR|Error|error" "$work/log.txt" | tail -5 | sed -e 's/^/      /'
  fi
  rm -rf "$work"
done

[ "$made" -eq 0 ] || echo "  Made $made spinning video(s) in $OUTPUT."
