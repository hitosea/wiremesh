#!/bin/bash
# Build the wm-test docker image with the dev machine's Xray binary baked in.
# Tag = sha256 prefix of (Dockerfile + xray version) so a cached image is
# reused across runs and across project clones with the same Xray version.
#
# Stdout: the resolved image tag (callers should `docker run "$(build-image.sh)" ...`).
# Stderr: build progress.

set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/load-env.sh
. "$DIR/load-env.sh"

ARCH=$(uname -m | sed -e 's/x86_64/amd64/' -e 's/aarch64/arm64/')
XRAY_TAR="$WM_PROJECT_ROOT/public/xray/xray-linux-${ARCH}.tar.gz"
XRAY_VERSION_FILE="$WM_PROJECT_ROOT/public/xray/xray-version.txt"

if [ ! -f "$XRAY_TAR" ] || [ ! -f "$XRAY_VERSION_FILE" ]; then
    echo "ERROR: xray binary missing. Expected $XRAY_TAR + $XRAY_VERSION_FILE" >&2
    exit 1
fi

XRAY_VERSION=$(tr -d '[:space:]' < "$XRAY_VERSION_FILE")
DOCKERFILE="$WM_SKILL_DIR/Dockerfile"
HASH=$(printf '%s\n' "$XRAY_VERSION" "$ARCH" | cat - "$DOCKERFILE" | sha256sum | awk '{print $1}')
TAG="wm-test:${XRAY_VERSION}-${ARCH}-${HASH:0:8}"

if docker image inspect "$TAG" >/dev/null 2>&1; then
    echo "$TAG"
    exit 0
fi

echo "[build-image] building $TAG (xray $XRAY_VERSION/$ARCH)" >&2
BUILD_CTX=$(mktemp -d)
trap 'rm -rf "$BUILD_CTX"' EXIT
tar xzf "$XRAY_TAR" -C "$BUILD_CTX"
cp "$DOCKERFILE" "$BUILD_CTX/Dockerfile"

docker build --quiet -t "$TAG" "$BUILD_CTX" >&2
echo "$TAG"
