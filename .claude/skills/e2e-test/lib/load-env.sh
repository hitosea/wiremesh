#!/bin/bash
# Load servers.env and validate required variables.
# Usage: source lib/load-env.sh   (from skill dir or any cwd)
#
# Exposes: WIREMESH_A_IP, WIREMESH_A_DOMAIN, WIREMESH_B_IP, WIREMESH_C_IP,
#          WIREMESH_D_IP, WIREMESH_SSH_USER, WIREMESH_SSH_PASS,
#          WIREMESH_PLATFORM_URL, WIREMESH_LOCAL_URL,
#          WM_SKILL_DIR, WM_PROJECT_ROOT.
# Convenience aliases: A_IP, B_IP, C_IP, D_IP, A_DOMAIN.

set -u

WM_SKILL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WM_PROJECT_ROOT="$(cd "$WM_SKILL_DIR/../../.." && pwd)"

ENV_FILE="$WM_SKILL_DIR/servers.env"
if [ ! -f "$ENV_FILE" ]; then
    echo "ERROR: $ENV_FILE not found." >&2
    echo "Copy $WM_SKILL_DIR/servers.env.example to $ENV_FILE and fill in values." >&2
    return 1 2>/dev/null || exit 1
fi

# shellcheck disable=SC1090
set -a
. "$ENV_FILE"
set +a

: "${WIREMESH_LOCAL_URL:=http://localhost:3456}"

REQUIRED=(
    WIREMESH_A_IP WIREMESH_A_DOMAIN
    WIREMESH_B_IP WIREMESH_C_IP WIREMESH_D_IP
    WIREMESH_SSH_USER WIREMESH_SSH_PASS
    WIREMESH_PLATFORM_URL
)
MISSING=()
for var in "${REQUIRED[@]}"; do
    [ -z "${!var:-}" ] && MISSING+=("$var")
done
if [ ${#MISSING[@]} -gt 0 ]; then
    echo "ERROR: missing values in $ENV_FILE: ${MISSING[*]}" >&2
    return 1 2>/dev/null || exit 1
fi

A_IP=$WIREMESH_A_IP
A_DOMAIN=$WIREMESH_A_DOMAIN
B_IP=$WIREMESH_B_IP
C_IP=$WIREMESH_C_IP
D_IP=$WIREMESH_D_IP
PLATFORM=$WIREMESH_PLATFORM_URL
LOCAL_URL=$WIREMESH_LOCAL_URL

export WM_SKILL_DIR WM_PROJECT_ROOT
export A_IP A_DOMAIN B_IP C_IP D_IP PLATFORM LOCAL_URL
