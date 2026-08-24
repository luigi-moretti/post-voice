#!/usr/bin/env bash
set -euo pipefail

# Builds the installable plugin zip from the current working tree,
# respecting .distignore. Called by .github/workflows/release-assets.yml
# right after `npm run build`; also runnable locally for a smoke test.
#
# Usage: scripts/build-plugin-zip.sh <version>
# Output: post-voice-<version>.zip in the repo root.

if [ $# -ne 1 ]; then
	echo "usage: $0 <version>" >&2
	exit 1
fi

VERSION="$1"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STAGE_DIR="$(mktemp -d)"
PLUGIN_DIR="${STAGE_DIR}/post-voice"

# Ephemeral CI runners never hit either case below, but this script is
# also documented for local smoke-testing (TESTING.md) — a mid-run
# failure there shouldn't leave a stray temp dir, and re-running against
# the same version shouldn't silently append into a zip from last time.
trap 'rm -rf "${STAGE_DIR}"' EXIT

mkdir -p "${PLUGIN_DIR}"

rsync -a --exclude-from="${REPO_ROOT}/.distignore" "${REPO_ROOT}/" "${PLUGIN_DIR}/"

ZIP_NAME="post-voice-${VERSION}.zip"
rm -f "${REPO_ROOT}/${ZIP_NAME}"
( cd "${STAGE_DIR}" && zip -rq "${REPO_ROOT}/${ZIP_NAME}" post-voice )

echo "built ${ZIP_NAME}"
