#!/bin/sh
# Keeps the 2D gallery in step with artwork-originals/2d, the folder where you
# keep your full-size 2D art:
#   * every image there gets a website-sized copy in src/artworks/2d
#     (at most 2000 px on its longest side, JPEG quality 80: about 0.3 MB);
#   * an image you change or replace there gets a fresh copy;
#   * an image you delete or rename there is removed from the gallery.
# Your full-size files are never changed and never uploaded.
#
# Images that reach src/artworks/2d some other way (dropped in directly, or
# uploaded on github.com) are moved into artwork-originals/2d, so they're
# kept instead of removed.
#
# The publish button runs this for you; to run it on its own: pnpm art:sync

set -eu
cd "$(dirname "$0")/.."

SOURCE="artwork-originals/2d"
OUTPUT="src/artworks/2d"
# Which website copies this script made, and from which original (with the
# original's size and date, to notice when it changes).
MANIFEST="$OUTPUT/.from-originals"
MAX_SIDE=2000
JPEG_QUALITY=80
tab=$(printf '\t')

lower_ext() { printf '%s' "${1##*.}" | tr '[:upper:]' '[:lower:]'; }
is_image() {
  case "$(lower_ext "$1")" in png | jpg | jpeg | webp | avif | gif) return 0 ;; esac
  return 1
}
list_images() { # file names (not paths) of the images directly in folder $1
  find "$1" -maxdepth 1 -type f ! -name '.*' | sort | while IFS= read -r path; do
    if is_image "$path"; then printf '%s\n' "${path##*/}"; fi
  done
}
fingerprint() { stat -f '%z:%m' "$1"; }
megabytes() { awk -v b="$1" 'BEGIN { printf "%.1f MB", b / 1000000 }'; }
kilobytes() { awk -v b="$1" 'BEGIN { printf "%d KB", b / 1000 }'; }

[ -d "$SOURCE" ] || exit 0
# Not using the originals folder for 2D: leave the gallery folder as it is.
[ -n "$(list_images "$SOURCE")" ] || exit 0
if ! command -v sips >/dev/null 2>&1; then
  echo "  (Skipping 2D: it uses macOS's built-in 'sips' image tool.)"
  exit 0
fi
mkdir -p "$OUTPUT"
[ -f "$MANIFEST" ] || : > "$MANIFEST"

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

web_name() { # the website copy's name for original $1
  base=${1%.*}
  case "$(lower_ext "$1")" in
    jpg | jpeg) echo "$base.jpg" ;;
    png)
      # Transparent PNGs stay PNG; everything else becomes a (much smaller) JPG.
      if [ "$(sips -g hasAlpha "$SOURCE/$1" 2>/dev/null | awk '/hasAlpha/ { print $2 }')" = "yes" ]; then
        echo "$base.png"
      else
        echo "$base.jpg"
      fi
      ;;
    *) echo "$1" ;; # webp, avif, gif (animated GIFs keep their animation)
  esac
}

plan() { # writes "web name<TAB>original name" for every original
  list_images "$SOURCE" > "$work/originals"
  : > "$work/plan"
  while IFS= read -r original; do
    printf '%s\t%s\n' "$(web_name "$original")" "$original" >> "$work/plan"
  done < "$work/originals"
  cut -f1 "$work/plan" > "$work/expected"
}

# 1. Keep images that reached the gallery some other way.
plan
list_images "$OUTPUT" > "$work/gallery"
while IFS= read -r web; do
  grep -qxF "$web" "$work/expected" && continue
  cut -f1 "$MANIFEST" | grep -qxF "$web" && continue # made by us; handled below
  mv "$OUTPUT/$web" "$SOURCE/$web"
  echo "  kept $web (it was only in the website folder): moved into $SOURCE"
done < "$work/gallery"
plan

# 2. Make or refresh website copies.
while IFS="$tab" read -r web original; do
  source_file="$SOURCE/$original"
  copy="$OUTPUT/$web"
  print=$(fingerprint "$source_file")
  if [ -f "$copy" ] && grep -qxF "$web$tab$original$tab$print" "$MANIFEST"; then
    continue # already up to date
  fi

  width=$(sips -g pixelWidth "$source_file" | awk '/pixelWidth/ { print $2 }')
  height=$(sips -g pixelHeight "$source_file" | awk '/pixelHeight/ { print $2 }')
  longest=$width
  [ "$height" -gt "$longest" ] && longest=$height
  resize=""
  [ "$longest" -gt "$MAX_SIDE" ] && resize="-Z $MAX_SIDE"
  made="$work/$web"

  case "$web" in
    *.jpg)
      # shellcheck disable=SC2086 # $resize is either empty or two words
      sips -s format jpeg -s formatOptions "$JPEG_QUALITY" $resize "$source_file" --out "$made" >/dev/null
      # A small JPG that wouldn't get any smaller is used as it is.
      case "$(lower_ext "$original")" in
        jpg | jpeg)
          if [ -z "$resize" ] && [ "$(stat -f %z "$made")" -ge "$(stat -f %z "$source_file")" ]; then
            cp "$source_file" "$made"
          fi
          ;;
      esac
      ;;
    *.png)
      if [ -n "$resize" ]; then
        # shellcheck disable=SC2086
        sips -s format png $resize "$source_file" --out "$made" >/dev/null
      else
        cp "$source_file" "$made"
      fi
      ;;
    *) cp "$source_file" "$made" ;;
  esac

  [ -f "$copy" ] && verb="updated" || verb="added  "
  mv "$made" "$copy"
  new_width=$(sips -g pixelWidth "$copy" | awk '/pixelWidth/ { print $2 }')
  new_height=$(sips -g pixelHeight "$copy" | awk '/pixelHeight/ { print $2 }')
  echo "  $verb $web: ${width}×${height}, $(megabytes "$(stat -f %z "$source_file")")" \
    "→ ${new_width}×${new_height}, $(kilobytes "$(stat -f %z "$copy")")"
done < "$work/plan"

# 3. Remove website copies whose original was deleted or renamed.
while IFS="$tab" read -r web _original _print; do
  [ -n "$web" ] || continue
  grep -qxF "$web" "$work/expected" && continue
  if [ -f "$OUTPUT/$web" ]; then
    rm "$OUTPUT/$web"
    echo "  removed $web (no longer in $SOURCE)"
  fi
done < "$MANIFEST"

# 4. Remember what we made, and from what.
: > "$work/manifest"
while IFS="$tab" read -r web original; do
  printf '%s\t%s\t%s\n' "$web" "$original" "$(fingerprint "$SOURCE/$original")" >> "$work/manifest"
done < "$work/plan"
mv "$work/manifest" "$MANIFEST"
