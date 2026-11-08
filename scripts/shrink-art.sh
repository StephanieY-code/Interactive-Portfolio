#!/bin/sh
# Makes big artwork images website-sized so the portfolio loads fast.
#
# For every PNG or JPG in src/artworks/2d and src/artworks/3d:
#   - longer than 2400 px on a side -> scaled down to 2400 px (shape kept)
#   - still over 3 MB after that    -> saved as a JPG instead, but only if the
#                                      image has no transparency
# Before changing anything, the untouched original is copied into
# artwork-originals/ next to this project. That folder stays on your Mac and
# is never uploaded.
#
# The publish button (publish-art.sh) runs this for you. To run it on its
# own: pnpm art:shrink

set -eu
cd "$(dirname "$0")/.."

MAX_SIDE=2400
MAX_BYTES=3000000
JPEG_QUALITY=85
ORIGINALS_DIR="artwork-originals"

if ! command -v sips >/dev/null 2>&1; then
  echo "(Skipping image shrinking: it uses macOS's built-in 'sips' tool.)"
  exit 0
fi

megabytes() { awk -v b="$1" 'BEGIN { printf "%.1f MB", b / 1000000 }'; }

# Reads one property (pixelWidth, pixelHeight, hasAlpha) of an image.
image_prop() { sips -g "$1" "$2" 2>/dev/null | awk -v key="$1:" '$1 == key { print $2 }'; }

# Copies the original into artwork-originals/, never overwriting an earlier copy.
save_original() {
  destination="$ORIGINALS_DIR/${1#src/artworks/}"
  mkdir -p "$(dirname "$destination")"
  if [ -e "$destination" ]; then
    destination="${destination%.*}-$(date +%Y%m%d-%H%M%S).${destination##*.}"
  fi
  cp -p "$1" "$destination"
}

list=$(mktemp)
scratch=$(mktemp -d) # resized copies are made here, outside the project
trap 'rm -rf "$list" "$scratch"' EXIT
find src/artworks/2d src/artworks/3d -type f \
  \( -iname '*.png' -o -iname '*.jpg' -o -iname '*.jpeg' \) | sort > "$list"

shrunk=0
while IFS= read -r file; do
  width=$(image_prop pixelWidth "$file")
  height=$(image_prop pixelHeight "$file")
  [ -n "$width" ] && [ -n "$height" ] || continue
  bytes=$(stat -f %z "$file")
  longest=$width
  [ "$height" -gt "$longest" ] && longest=$height

  extension=$(printf '%s' "${file##*.}" | tr '[:upper:]' '[:lower:]')
  too_big=no
  [ "$longest" -gt "$MAX_SIDE" ] && too_big=yes
  heavy_opaque_png=no
  if [ "$extension" = "png" ] && [ "$bytes" -gt "$MAX_BYTES" ] \
    && [ "$(image_prop hasAlpha "$file")" = "no" ]; then
    heavy_opaque_png=yes
  fi

  # Nothing to gain: leave it alone. (Each image is changed at most once, so
  # publishing again never re-compresses it.)
  [ "$too_big" = "yes" ] || [ "$heavy_opaque_png" = "yes" ] || continue

  target=$file
  work="$scratch/image.$extension"

  # 1. Scale down to MAX_SIDE on the longest side (JPGs re-saved at 85%).
  #    Images that are already small enough are never enlarged.
  if [ "$too_big" = "no" ]; then
    cp "$file" "$work"
  elif [ "$extension" = "png" ]; then
    sips -s format png -Z "$MAX_SIDE" "$file" --out "$work" >/dev/null
  else
    sips -s format jpeg -s formatOptions "$JPEG_QUALITY" -Z "$MAX_SIDE" \
      "$file" --out "$work" >/dev/null
  fi

  # 2. A PNG that's still heavy and has no transparency becomes a JPG.
  if [ "$extension" = "png" ] && [ "$(stat -f %z "$work")" -gt "$MAX_BYTES" ] \
    && [ "$(image_prop hasAlpha "$work")" = "no" ]; then
    target="${file%.*}.jpg"
    [ -e "$target" ] && target="${file%.*}-web.jpg"
    sips -s format jpeg -s formatOptions "$JPEG_QUALITY" "$work" \
      --out "$scratch/image.jpg" >/dev/null
    rm "$work"
    work="$scratch/image.jpg"
  fi

  new_bytes=$(stat -f %z "$work")
  if [ "$new_bytes" -ge "$bytes" ]; then
    rm -f "$work" # Nothing gained, keep the original as it is.
    continue
  fi

  save_original "$file"
  [ "$target" != "$file" ] && rm "$file"
  mv "$work" "$target"
  shrunk=$((shrunk + 1))

  echo "  ${target#src/artworks/}: ${width}×${height}, $(megabytes "$bytes")" \
    "→ $(image_prop pixelWidth "$target")×$(image_prop pixelHeight "$target")," \
    "$(megabytes "$new_bytes")"
  if [ "$new_bytes" -gt "$MAX_BYTES" ]; then
    case "$target" in
      *.png | *.PNG) echo "    (still over 3 MB: it has transparency, so it stays a PNG)" ;;
      *) echo "    (still over 3 MB: it's a very detailed image)" ;;
    esac
  fi
done < "$list"

if [ "$shrunk" -gt 0 ]; then
  echo "  Originals saved in $ORIGINALS_DIR/ (stays on your Mac, never uploaded)."
fi
