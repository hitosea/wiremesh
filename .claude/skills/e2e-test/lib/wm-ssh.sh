#!/bin/bash
# SSH helper. Usage: lib/wm-ssh.sh <host> <command>
#
# Reads SSH credentials from servers.env (via lib/load-env.sh).
# StrictHostKeyChecking is disabled because the IPs come from .env;
# the test always operates against operator-controlled hosts.

set -euo pipefail
HOST=$1
shift
CMD="$*"

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/load-env.sh
. "$DIR/load-env.sh"

SSHPASS="$WIREMESH_SSH_PASS" sshpass -e ssh \
    -o StrictHostKeyChecking=no \
    -o UserKnownHostsFile=/dev/null \
    -o ConnectTimeout=10 \
    -o LogLevel=ERROR \
    "$WIREMESH_SSH_USER@$HOST" "$CMD"
