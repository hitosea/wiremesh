#!/bin/bash
# Run a batch of device tests in parallel and print a colour-free summary.
#
# Usage: batch-test.sh [-j PARALLEL] [-o RESULTS_TSV] <matrix.tsv>
#
# matrix.tsv format (tab-separated, no header):
#   <device_id>\t<name>\t<protocol>\t<line_id>\t<expected_csv>
#
# expected_csv format:  ifconfig.me=B,ip.me=C,icanhazip.com=D
#                       (key=letter, where A/B/C/D map to servers in servers.env)
#
# Defaults:
#   -j 8              eight tests in parallel
#   -o results.tsv    written into the skill dir
#
# Exit code: number of failed devices (0 = all pass).

set -uo pipefail

PARALLEL=8
RESULTS_TSV=""

while [ $# -gt 0 ]; do
    case "$1" in
        -j) PARALLEL=$2; shift 2;;
        -o) RESULTS_TSV=$2; shift 2;;
        *) break;;
    esac
done
MATRIX=${1:?usage: batch-test.sh [-j N] [-o results.tsv] <matrix.tsv>}

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/load-env.sh
. "$DIR/load-env.sh"

[ -z "$RESULTS_TSV" ] && RESULTS_TSV="$WM_SKILL_DIR/results.tsv"
: > "$RESULTS_TSV"

# Build the docker image once (cached on subsequent runs); export so that
# parallel run-test.sh invocations do not each call build-image.sh.
WM_IMAGE=$("$DIR/build-image.sh")
export WM_IMAGE

declare -A IP_TO_LETTER=(
    ["$A_IP"]=A
    ["$B_IP"]=B
    ["$C_IP"]=C
    ["$D_IP"]=D
)

OUT_DIR=$(mktemp -d)
trap 'rm -rf "$OUT_DIR"' EXIT

# Single-device worker. Writes a result line to RESULTS_TSV.
run_one() {
    local DID=$1 DNAME=$2 PROTO=$3 LINE=$4 EXPECTED=$5
    local OUT="$OUT_DIR/$DID.out"
    "$DIR/run-test.sh" "$DID" "$DNAME" "$PROTO" "$LINE" "$EXPECTED" >"$OUT" 2>&1 || true

    # Parse "== key ==\n<ip>" blocks out of the output.
    declare -A ACTUAL
    local current_key=""
    while IFS= read -r line; do
        if [[ "$line" == "== "*" ==" ]]; then
            current_key="${line#== }"
            current_key="${current_key% ==}"
        elif [ -n "$current_key" ] && [ -n "$line" ]; then
            local cleaned
            cleaned=$(printf '%s' "$line" | tr -d '[:space:]')
            if [ -n "$cleaned" ] && [ -z "${ACTUAL[$current_key]:-}" ]; then
                ACTUAL[$current_key]=$cleaned
            fi
        fi
    done <"$OUT"

    local ALL_PASS=PASS DETAILS=""
    IFS=',' read -ra PAIRS <<<"$EXPECTED"
    for p in "${PAIRS[@]}"; do
        local k=${p%%=*}
        local want=${p##*=}
        local got_ip=${ACTUAL[$k]:-MISS}
        local got_letter=${IP_TO_LETTER[$got_ip]:-?}
        if [ "$got_letter" = "$want" ]; then
            DETAILS+="${k}=${got_letter}+ "
        else
            DETAILS+="${k}=${got_letter}(want ${want})- "
            ALL_PASS=FAIL
        fi
    done

    printf '[%s] %s (%s line=%s) %s  %s\n' "$DID" "$DNAME" "$PROTO" "$LINE" "$ALL_PASS" "$DETAILS"
    printf '%s\t%s\t%s\t%s\t%s\t%s\n' "$DID" "$DNAME" "$PROTO" "$LINE" "$ALL_PASS" "$DETAILS" >>"$RESULTS_TSV"
}
TOTAL=$(grep -cv '^$' "$MATRIX" 2>/dev/null || true)
echo "Running $TOTAL tests with -j $PARALLEL ..."

# Bash-native job control: cap concurrent backgrounds at PARALLEL with `wait -n`.
running=0
while IFS=$'\t' read -r DID DNAME PROTO LINE EXPECTED; do
    [ -z "$DID" ] && continue
    run_one "$DID" "$DNAME" "$PROTO" "$LINE" "$EXPECTED" &
    running=$((running + 1))
    if [ "$running" -ge "$PARALLEL" ]; then
        wait -n
        running=$((running - 1))
    fi
done < "$MATRIX"
wait

PASS=$(grep -c $'\tPASS\t' "$RESULTS_TSV" || true)
FAIL=$(grep -c $'\tFAIL\t' "$RESULTS_TSV" || true)
echo ""
echo "=== Summary ==="
echo "Total: $TOTAL"
echo "Pass:  $PASS"
echo "Fail:  $FAIL"

# Surface failures in their full form.
if [ "$FAIL" -gt 0 ]; then
    echo ""
    echo "=== Failed devices ==="
    grep $'\tFAIL\t' "$RESULTS_TSV" || true
fi

exit "$FAIL"
