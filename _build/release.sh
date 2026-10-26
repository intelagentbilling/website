#!/usr/bin/env bash
#
# IntelAGENT website release.
#
#   ./_build/release.sh              build + verify, touch nothing in git
#   ./_build/release.sh --publish    build + verify, then commit and push to main
#
# GitHub Pages serves this repo directly, so "publish" means "push to main".
# Verification runs before anything is committed: a stale or broken build
# cannot be published.
#
set -euo pipefail

cd "$(dirname "$0")/.."
ROOT="$PWD"
PUBLISH=0
MESSAGE=""

while [ $# -gt 0 ]; do
  case "$1" in
    --publish) PUBLISH=1 ;;
    -m) shift; MESSAGE="${1:-}" ;;
    -h|--help) sed -n '2,12p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "unknown option: $1" >&2; exit 2 ;;
  esac
  shift
done

step() { printf '\n\033[1m==> %s\033[0m\n' "$1"; }
fail() { printf '\n\033[31mrelease failed: %s\033[0m\n' "$1" >&2; exit 1; }

command -v node >/dev/null 2>&1 || fail "node is not on PATH"

step "Build"
node _build/build.js

step "Verify"
node _build/verify.js || fail "verification found problems (nothing was committed)"

if [ "$PUBLISH" -eq 0 ]; then
  step "Changed files"
  if git -C "$ROOT" diff --quiet && git -C "$ROOT" diff --cached --quiet && \
     [ -z "$(git -C "$ROOT" ls-files --others --exclude-standard)" ]; then
    echo "  (working tree clean — nothing to publish)"
  else
    git -C "$ROOT" status --short
    cat <<'EOF'

Build is clean and verified. To publish:

  ./_build/release.sh --publish -m "Add emergency medicine specialty page"
EOF
  fi
  exit 0
fi

# ---------------------------------------------------------------- publishing

BRANCH="$(git -C "$ROOT" rev-parse --abbrev-ref HEAD)"
[ "$BRANCH" = "main" ] || fail "on branch '$BRANCH'; GitHub Pages publishes from main"

if git -C "$ROOT" diff --quiet && git -C "$ROOT" diff --cached --quiet && \
   [ -z "$(git -C "$ROOT" ls-files --others --exclude-standard)" ]; then
  echo "nothing to publish — working tree is clean"
  exit 0
fi

if [ -z "$MESSAGE" ]; then
  fail "a commit message is required: ./_build/release.sh --publish -m \"...\""
fi

step "Commit"
git -C "$ROOT" add -A
git -C "$ROOT" commit -m "$MESSAGE"

step "Push"
git -C "$ROOT" push origin main

printf '\n\033[32mPublished.\033[0m GitHub Pages usually serves the change within a minute.\n'
printf 'Check: https://www.intelagent.ca/sitemap.xml\n'
