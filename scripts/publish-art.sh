#!/bin/sh
# Publishes new, changed, or deleted artwork in src/artworks to GitHub.
# Pushing to main makes GitHub Actions rebuild the live site (about a minute).
#
# Run it by double-clicking "Publish Artwork.command" in Finder,
# or from a terminal with: pnpm art:publish

set -eu
cd "$(dirname "$0")/.."

SITE_URL="https://stephaniey-code.github.io/Interactive-Portfolio/"
ACTIONS_URL="https://github.com/StephanieY-code/Interactive-Portfolio/actions"

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

echo "→ Making big images website-sized..."
sh scripts/shrink-art.sh || fail "Couldn't shrink the images. Check the message above."

git add -A -- src/artworks

if git diff --cached --quiet -- src/artworks; then
  echo ""
  echo "No new artwork to publish."
  echo "Put images in src/artworks/2d or src/artworks/3d, then run this again."
  exit 0
fi

tab=$(printf '\t')
changes=$(git diff --cached --name-status -- src/artworks \
  | sed -e 's#src/artworks/##g' \
        -e "s/^A${tab}/  added    /" -e "s/^M${tab}/  changed  /" \
        -e "s/^D${tab}/  removed  /" -e "s/^R[0-9]*${tab}/  renamed  /" \
        -e "s/${tab}/ → /")
count=$(git diff --cached --name-only -- src/artworks | wc -l | tr -d ' ')

echo ""
echo "Publishing $count artwork change(s):"
echo "$changes"

if [ "$count" = "1" ]; then subject="Update artwork"; else subject="Update artworks ($count files)"; fi
git commit --quiet -m "$subject" -m "$changes" -- src/artworks

echo ""
echo "→ Pushing to GitHub..."
git_gh push --quiet origin main || fail "Push failed. Check the message above."

echo ""
echo "✓ Published! The live site updates in about a minute:"
echo "  $SITE_URL"
echo "  (Watch the deploy at $ACTIONS_URL)"
