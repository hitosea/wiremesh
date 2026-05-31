#!/bin/bash
# Safely restart the WireMesh dev server. Usage: lib/restart-dev.sh
#
# Why this exists: the e2e test wipes data/wiremesh* and Next.js caches DB
# state, so the dev server MUST be restarted afterwards. Doing that by hand
# (pkill -f next, killall node, kill $(lsof -ti:PORT)) is dangerous on a shared
# host — it can hit happy-next, another container's next-server, or unrelated
# node processes and crash the whole machine. A past run did exactly that.
#
# Safety model — two independent guards, no broad matching ever:
#   1. We anchor on the PID actually LISTENING on the dev port, then walk its
#      real process tree by PPID (pgrep -P), never by command-line text. So this
#      can never match the shell that invoked the script, a `grep next` in some
#      pipeline, or anything else by coincidence.
#   2. Every PID we signal must have /proc/PID/cwd == this checkout. Other
#      users' / other containers' processes (whose cwd we can't even read) and
#      anything outside this directory are structurally impossible to hit.
# If the port is held by something that is NOT ours, the script ABORTS without
# killing anything.

set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/load-env.sh
. "$DIR/load-env.sh"

# Port comes from LOCAL_URL (e.g. http://localhost:3456); default 3456.
PORT="$(printf '%s' "$LOCAL_URL" | sed -nE 's#.*:([0-9]+).*#\1#p')"
: "${PORT:=3456}"
# Log lives in the skill dir, where *.log is already gitignored.
LOG_FILE="$WM_SKILL_DIR/dev-server-${PORT}.log"

echo "[restart-dev] target port=$PORT, project=$WM_PROJECT_ROOT"

is_ours() { [ "$(readlink "/proc/$1/cwd" 2>/dev/null || true)" = "$WM_PROJECT_ROOT" ]; }

# PID listening on $PORT, if any. -p is REQUIRED: without it ss omits the
# users:((...,pid=N)) field and we'd never see the running dev server.
listener_pid() {
    ss -ltnpH "sport = :$PORT" 2>/dev/null | grep -oP 'pid=\K[0-9]+' | head -1
}

# Recursively list descendant PIDs by PPID only (never command-line text).
descendants() {
    local child
    for child in $(pgrep -P "$1" 2>/dev/null || true); do
        printf '%s\n' "$child"
        descendants "$child"
    done
}

# Walk up from the listener to the top of OUR dev-server tree: keep climbing
# while the parent is still in this checkout and is part of the npm/next launch
# chain. Stops before ever reaching the invoking shell or init.
top_ancestor() {
    local pid=$1 ppid
    while :; do
        ppid="$(ps -o ppid= -p "$pid" 2>/dev/null | tr -d ' ')"
        { [ -z "$ppid" ] || [ "$ppid" -le 1 ]; } && break
        is_ours "$ppid" || break
        case "$(ps -o args= -p "$ppid" 2>/dev/null || true)" in
            *"npm run dev"*|*"next dev"*|*"sh -c next"*) pid="$ppid" ;;
            *) break ;;
        esac
    done
    printf '%s\n' "$pid"
}

# --- 1. Identify and stop our dev server -----------------------------------
LPID="$(listener_pid || true)"
if [ -n "${LPID:-}" ]; then
    if ! is_ours "$LPID"; then
        echo "[restart-dev] ABORT: PID $LPID holds port $PORT but its cwd is" >&2
        echo "  '$(readlink "/proc/$LPID/cwd" 2>/dev/null || echo '?')' (expected '$WM_PROJECT_ROOT')." >&2
        echo "  This is NOT our dev server — refusing to kill it." >&2
        echo "  Do NOT use pkill/killall. Investigate manually:" >&2
        echo "    ls -l /proc/$LPID/cwd ; ps -o pid,ppid,args -p $LPID" >&2
        exit 1
    fi

    ROOT="$(top_ancestor "$LPID")"
    # Build the kill set: root + all descendants, each re-checked as ours.
    mapfile -t TREE < <( { printf '%s\n' "$ROOT"; descendants "$ROOT"; } | sort -u )
    KILL_SET=()
    for p in "${TREE[@]}"; do is_ours "$p" && KILL_SET+=("$p"); done

    echo "[restart-dev] stopping dev server tree (root=$ROOT, cwd ok): ${KILL_SET[*]}"
    kill -TERM "${KILL_SET[@]}" 2>/dev/null || true
    for _ in $(seq 1 12); do
        [ -z "$(listener_pid || true)" ] && break
        sleep 1
    done
    if [ -n "$(listener_pid || true)" ]; then
        echo "[restart-dev] port still held after TERM, sending KILL"
        # Re-resolve survivors (descendants may have been reparented) and KILL.
        SURV="$(listener_pid || true)"
        if [ -n "$SURV" ] && is_ours "$SURV"; then
            mapfile -t TREE2 < <( { printf '%s\n' "$(top_ancestor "$SURV")"; descendants "$(top_ancestor "$SURV")"; printf '%s\n' "$SURV"; } | sort -u )
            for p in "${TREE2[@]}"; do is_ours "$p" && kill -KILL "$p" 2>/dev/null || true; done
            sleep 2
        fi
    fi
    if [ -n "$(listener_pid || true)" ]; then
        echo "[restart-dev] ERROR: port $PORT still held after KILL — aborting, not starting a duplicate." >&2
        exit 1
    fi
else
    echo "[restart-dev] no listener on port $PORT — nothing to stop"
fi

# --- 2. Relaunch ------------------------------------------------------------
echo "[restart-dev] starting: PORT=$PORT npm run dev  (log: $LOG_FILE)"
( cd "$WM_PROJECT_ROOT" && PORT="$PORT" nohup npm run dev > "$LOG_FILE" 2>&1 & )

# --- 3. Wait until ready (a real 2xx/3xx, not a connection failure) ---------
for _ in $(seq 1 60); do
    code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 3 "$LOCAL_URL/login" 2>/dev/null || true)"
    if [[ "$code" =~ ^[23] ]]; then
        echo "[restart-dev] ready: $LOCAL_URL responded HTTP $code"
        exit 0
    fi
    sleep 1
done

echo "[restart-dev] ERROR: dev server did not become ready in 60s — see $LOG_FILE" >&2
tail -20 "$LOG_FILE" >&2 || true
exit 1
