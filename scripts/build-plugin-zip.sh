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

mkdir -p "${PLUGIN_DIR}"

rsync -a --exclude-from="${REPO_ROOT}/.distignore" "${REPO_ROOT}/" "${PLUGIN_DIR}/"

ZIP_NAME="post-voice-${VERSION}.zip"
( cd "${STAGE_DIR}" && zip -rq "${REPO_ROOT}/${ZIP_NAME}" post-voice )

rm -rf "${STAGE_DIR}"

echo "built ${ZIP_NAME}"
