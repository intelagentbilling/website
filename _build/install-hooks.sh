#!/usr/bin/env bash
#
# Points this clone's git hooks at _build/hooks so a stale build cannot be
# committed. Run once per clone:
#
#   ./_build/install-hooks.sh
#
set -euo pipefail
cd "$(dirname "$0")/.."
git config core.hooksPath _build/hooks
chmod +x _build/hooks/*
echo "git hooks -> _build/hooks"
echo "pre-commit will now block a commit whose generated pages are out of date."
