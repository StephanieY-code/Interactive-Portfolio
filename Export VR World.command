#!/bin/sh
# Double-click me in Finder to turn a Blender file into one of the site's VR
# worlds. You'll pick the .blend file and which VR card it belongs to.
cd "$(dirname "$0")" || exit 1

finish() {
  echo ""
  printf "Press Return to close this window."
  read -r _
  exit 0
}

blend=$(osascript -e 'POSIX path of (choose file with prompt "Pick the Blender (.blend) file for your VR world")' 2>/dev/null) || {
  echo "No file picked, so nothing was exported."
  finish
}
world=$(osascript -e 'choose from list {"garden", "clouds", "moon"} with prompt "Which VR card should open this world?" default items {"garden"}' 2>/dev/null)
if [ -z "$world" ] || [ "$world" = "false" ]; then
  echo "No VR card picked, so nothing was exported."
  finish
fi

sh scripts/export-vr-world.sh "$blend" "$world"
echo ""
echo "When you're happy with it, double-click 'Publish Artwork.command' to put it online."
finish
