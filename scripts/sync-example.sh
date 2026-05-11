#!/usr/bin/env bash
# scripts/sync-example.sh
# ─────────────────────────────────────────────────────────────────────
# Force-relink the example app's local copy of the parent library
# after a parent rebuild.
#
# Why this exists:
#   The example at `examples/nestjs-app/` consumes the parent via
#   `"nest-warden": "file:../.."`. pnpm resolves `file:` by packing the
#   parent into a content-hashed tarball and extracting it under
#   `node_modules/nest-warden/`. The tarball is cached by hash, so a
#   parent `dist/` rebuild — which changes file contents but not the
#   manifest the hash is computed from — is NOT re-extracted on the
#   next `pnpm install`. The result: the example reads stale library
#   code until the cache is invalidated.
#
#   This script invalidates the cache and re-extracts in one command.
#   Keeping the `file:` protocol preserves the "tarball install" shape
#   in CI and proves the published artifact will work for real
#   consumers — a property a `link:` or workspace setup would lose.
#
# Usage:
#   bash scripts/sync-example.sh             # rebuild parent + relink (default)
#   bash scripts/sync-example.sh --skip-build  # relink only (used by `pnpm dev`)
#
# Exposed as `pnpm sync:example` and `pnpm sync:example:fast` from
# the parent's package.json. The legacy step-by-step lives in
# `.claude/skills/rebuild-example/SKILL.md` for reference.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
EXAMPLE="$ROOT/examples/nestjs-app"

SKIP_BUILD=false
for arg in "$@"; do
  case "$arg" in
    --skip-build) SKIP_BUILD=true ;;
    -h | --help)
      sed -n '2,30p' "$0" # echo the header comment as inline docs
      exit 0
      ;;
    *)
      echo "[sync:example] Unknown argument: $arg" >&2
      echo "[sync:example] Run with -h for help." >&2
      exit 2
      ;;
  esac
done

if [ ! -d "$EXAMPLE" ]; then
  echo "[sync:example] Example directory not found at $EXAMPLE" >&2
  exit 1
fi

if [ "$SKIP_BUILD" = false ]; then
  echo "[sync:example] Building parent library…"
  (cd "$ROOT" && pnpm build)
fi

echo "[sync:example] Dropping cached link at $EXAMPLE/node_modules/nest-warden"
rm -rf "$EXAMPLE/node_modules/nest-warden"

echo "[sync:example] Re-installing example (pnpm install --ignore-workspace --force)"
(cd "$EXAMPLE" && pnpm install --ignore-workspace --force --reporter=silent)

echo "[sync:example] Done."
