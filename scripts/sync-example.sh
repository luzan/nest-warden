#!/usr/bin/env bash
# scripts/sync-example.sh
# ─────────────────────────────────────────────────────────────────────
# Force-relink the example app's local copy of the parent library
# after a parent rebuild.
#
# Why this exists:
#   The example at `examples/nestjs-app/` consumes the parent via
#   `"nest-warden": "file:../.."`. pnpm resolves `file:` by packing the
#   parent into a tarball and hard-linking its files into a virtual-store
#   entry under `node_modules/.pnpm/`. Those hard links become stale
#   when `pnpm build` recreates `dist/` (tsup `clean: true` deletes and
#   rewrites every file — new inodes). The result: the example reads
#   stale library code until the cache is invalidated.
#
#   This script drops BOTH the `node_modules/nest-warden` symlink AND
#   the `.pnpm/` virtual-store entry for nest-warden, then re-installs
#   so pnpm re-packs from the current `dist/` and creates fresh hard
#   links. Without removing the `.pnpm/` entry, pnpm reuses the stale
#   hard links even after `rm -rf node_modules/nest-warden`.
#
#   Keeping the `file:` protocol preserves the "tarball install" shape
#   in CI and proves the published artifact will work for real consumers
#   — a property a `link:` or workspace setup would lose.
#
#   pnpm 11 note: `pnpm install` exits 1 with [ERR_PNPM_IGNORED_BUILDS]
#   whenever it adds a package whose transitive deps include native
#   build-script packages (esbuild, cpu-features, ssh2…), regardless of
#   `allowBuilds` or `onlyBuiltDependencies` values in the workspace
#   YAML. This is a pnpm 11.x limitation. nest-warden IS installed
#   correctly despite the non-zero exit code; this script verifies that
#   and continues.
#
# Usage:
#   bash scripts/sync-example.sh             # rebuild parent + relink (default)
#   bash scripts/sync-example.sh --skip-build  # relink only (used by `pnpm dev`)
#
# Exposed as `pnpm sync:example` and `pnpm sync:example:fast` from
# the parent's package.json.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
EXAMPLE="$ROOT/examples/nestjs-app"

SKIP_BUILD=false
for arg in "$@"; do
  case "$arg" in
    --skip-build) SKIP_BUILD=true ;;
    -h | --help)
      sed -n '2,46p' "$0" # echo the header comment as inline docs
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

# Drop the symlink AND the virtual-store entry. Removing only the
# symlink is insufficient — pnpm reuses the stale .pnpm/ hard-links on
# the next install. Removing both forces a full re-pack from file:../.
echo "[sync:example] Dropping cached link and virtual-store entry…"
rm -rf "$EXAMPLE/node_modules/nest-warden"
rm -rf "$EXAMPLE/node_modules/.pnpm/nest-warden@"*

# Re-install. pnpm 11 exits 1 with [ERR_PNPM_IGNORED_BUILDS] when it
# adds any package whose transitive deps have native build scripts —
# even when those packages are already built. nest-warden is installed
# correctly despite this; we verify and continue.
echo "[sync:example] Re-installing example (pnpm install --ignore-workspace)"
set +e
(cd "$EXAMPLE" && pnpm install --ignore-workspace)
INSTALL_EXIT=$?
set -e

if [ $INSTALL_EXIT -ne 0 ]; then
  if [ ! -L "$EXAMPLE/node_modules/nest-warden" ] && [ ! -d "$EXAMPLE/node_modules/nest-warden" ]; then
    echo "[sync:example] ERROR: install failed and nest-warden is not present." >&2
    echo "[sync:example]        Re-run with full output to diagnose:" >&2
    echo "[sync:example]          cd examples/nestjs-app && pnpm install --ignore-workspace" >&2
    exit 1
  fi
  echo "[sync:example] NOTE: [ERR_PNPM_IGNORED_BUILDS] from pnpm 11 — nest-warden is installed."
  echo "[sync:example]       Native packages (esbuild, cpu-features…) are already built."
fi

# pnpm 11 rewrites pnpm-workspace.yaml's allowBuilds section with
# placeholder text on any install that adds a package. Restore from git
# so the working tree stays clean.
git -C "$EXAMPLE" checkout -- pnpm-workspace.yaml 2>/dev/null || true

echo "[sync:example] Done."
