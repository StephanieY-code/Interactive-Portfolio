#!/bin/sh
# Publishes your artwork and VR worlds to the live site:
#   artwork-originals/2d  (full-size images)  → website-sized copies, 2D gallery
#   artwork-originals/3d  (.blend files)      → spinning videos, 3D gallery
#   src/vr-worlds                             → VR worlds
# then commits and pushes to GitHub, which rebuilds the site (about a minute).
#
# Run it by double-clicking "Publish Artwork.command" in Finder,
# or from a terminal with: pnpm art:publish

set -eu
cd "$(dirname "$0")/.."

SITE_URL="https://stephaniey-code.github.io/Interactive-Portfolio/"
ACTIONS_URL="https://github.com/StephanieY-code/Interactive-Portfolio/actions"
CONTENT="src/artworks src/vr-worlds"
GITHUB_FILE_LIMIT=100000000 # GitHub refuses single files over 100 MB

# Use the GitHub CLI login for git, without changing any global git settings.
git_gh() {
  git -c credential.helper= -c 'credential.helper=!gh auth git-credential' "$@"
}

fail() {
  echo ""
  echo "✗ $1"
  exit 1
}

command -v git >/dev/null 2>&1 || fail "git isn't installed."
command -v gh >/dev/null 2>&1 || fail "The GitHub CLI (gh) isn't installed. Get it from https://cli.github.com"
gh auth status >/dev/null 2>&1 || fail "You're not signed in to GitHub. Run: gh auth login"
git config user.email >/dev/null 2>&1 || fail "git doesn't know who you are yet. Run: git config user.email \"you@example.com\""

branch=$(git rev-parse --abbrev-ref HEAD)
[ "$branch" = "main" ] || fail "You're on the '$branch' branch. Switch to main first: git switch main"

echo "→ Getting the latest version from GitHub..."
git_gh pull --rebase --autostash --quiet origin main \
  || fail "Couldn't update from GitHub. Fix the message above, then try again."

echo "→ Updating the 2D gallery from artwork-originals/2d..."
sh scripts/sync-2d.sh || fail "Couldn't update the 2D gallery. Check the message above."

echo "→ Updating the 3D gallery from Blender files in artwork-originals/3d..."
sh scripts/turntables.sh || fail "Couldn't make the 3D spins. Check the message above."

echo "→ Making big images website-sized..."
sh scripts/shrink-art.sh || fail "Couldn't shrink the images. Check the message above."

# shellcheck disable=SC2086 # CONTENT is a list of folders
git add -A -- $CONTENT

# shellcheck disable=SC2086
if git diff --cached --quiet -- $CONTENT; then
  echo ""
  echo "Nothing new to publish."
  echo "Add images to artwork-originals/2d, .blend files to artwork-originals/3d,"
  echo "or export a VR world, then run this again."
  exit 0
fi

# shellcheck disable=SC2086
for file in $(git diff --cached --name-only --diff-filter=AM -- $CONTENT | tr ' ' '\001'); do
  file=$(printf '%s' "$file" | tr '\001' ' ')
  if [ "$(stat -f %z "$file")" -gt "$GITHUB_FILE_LIMIT" ]; then
    git reset --quiet -- $CONTENT
    fail "$file is over 100 MB, which GitHub doesn't allow. Make it smaller first."
  fi
done

tab=$(printf '\t')
# shellcheck disable=SC2086
changes=$(git diff --cached --name-status -- $CONTENT \
  | sed -e 's#src/artworks/##g' -e 's#src/vr-worlds/#VR #g' \
        -e "s/^A${tab}/  added    /" -e "s/^M${tab}/  changed  /" \
        -e "s/^D${tab}/  removed  /" -e "s/^R[0-9]*${tab}/  renamed  /" \
        -e "s/${tab}/ → /")
# shellcheck disable=SC2086
count=$(git diff --cached --name-only -- $CONTENT | wc -l | tr -d ' ')

echo ""
echo "Publishing $count change(s):"
echo "$changes"

if [ "$count" = "1" ]; then subject="Update artwork"; else subject="Update artwork ($count files)"; fi
# shellcheck disable=SC2086
git commit --quiet -m "$subject" -m "$changes" -- $CONTENT

echo ""
echo "→ Pushing to GitHub..."
git_gh push --quiet origin main || fail "Push failed. Check the message above."

echo ""
echo "✓ Published! The live site updates in about a minute:"
echo "  $SITE_URL"
echo "  (Watch the deploy at $ACTIONS_URL)"
