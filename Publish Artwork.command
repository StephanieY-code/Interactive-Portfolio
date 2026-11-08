#!/bin/sh
# Double-click me in Finder to publish your artwork (src/artworks) and VR worlds
# (src/vr-worlds) to the live site.
cd "$(dirname "$0")" || exit 1
sh scripts/publish-art.sh
echo ""
printf "Press Return to close this window."
read -r _
