#!/usr/bin/env bash
# Durable guard-only negative control for SOL6-R3-IMPL-02 / SOL6-R4-IMPL-01.
#
# Proves the replacement-canvas ownership assertions in
# test/serve/public/hooks/use-pdf-pages.dom.test.tsx are non-vacuous: removing
# ONLY the canvas identity conjunct from `identityStillValid` in
# src/serve/public/hooks/use-pdf-pages.ts must make the intended test FAIL.
#
# Everything this script prints goes to a durable artifact under .flow/reviews/
# so the evidence is independently inspectable from the repository itself.
#
# Fail-safe restoration, in layers:
#   1. fresh task-scoped backup taken before any mutation
#   2. `trap restore EXIT INT TERM HUP` — atomic restore (write temp + mv)
#   3. detached watchdog (setsid) restoring unconditionally — survives SIGKILL
#      of this shell and of the whole process group (e.g. an OOM kill)
#   4. memory-bounded run: a runaway dies at 3G instead of taking the box down
#      and being mistaken for evidence (the round-2 attempt died at exit 137)
#
# Usage: bash .flow/reviews/fn-112-task-6-gates/negative-control.sh

set -uo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
TARGET="$REPO/src/serve/public/hooks/use-pdf-pages.ts"
GATES="$REPO/.flow/reviews/fn-112-task-6-gates"
LOG="$GATES/negative-control.log"
BACKUP="$(mktemp "${TMPDIR:-/tmp}/upp-negctl-XXXXXX.ts")"
TESTFILE="test/serve/public/hooks/use-pdf-pages.dom.test.tsx"
TESTNAME='SOL6-IMPL-02: canvas replaced while getPage is pending starts nothing'
GUARD='canvasRef.current.get(pageNumber) === canvas'

cd "$REPO" || exit 90
: > "$LOG"
exec > >(tee -a "$LOG") 2>&1

echo "=== fn-112 task .6 — guard-only negative control (durable artifact) ==="
echo "utc_start:  $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "repo:       $REPO"
echo "target:     src/serve/public/hooks/use-pdf-pages.ts"
echo "test file:  $TESTFILE"
echo "test name:  $TESTNAME"
echo "git HEAD:   $(git rev-parse HEAD)"
echo "branch:     $(git branch --show-current)"
echo

echo "--- [1] pre-flight: backup + mutation-site uniqueness ---"
cp -f "$TARGET" "$BACKUP"
BACKUP_SHA="$(sha256sum "$BACKUP" | cut -d' ' -f1)"
PRE_SHA="$(sha256sum "$TARGET" | cut -d' ' -f1)"
GUARD_COUNT_BEFORE="$(grep -c "$GUARD" "$TARGET")"
echo "backup path:          $BACKUP"
echo "backup sha256:        $BACKUP_SHA"
echo "target sha256 before: $PRE_SHA"
echo "guard occurrences before: $GUARD_COUNT_BEFORE"
if [ "$GUARD_COUNT_BEFORE" != "1" ]; then
  echo "PREFLIGHT FAIL: expected exactly 1 guard occurrence, found $GUARD_COUNT_BEFORE"
  exit 91
fi
echo

restore() {
  cp -f "$BACKUP" "$TARGET.negctl.tmp" && mv -f "$TARGET.negctl.tmp" "$TARGET"
}
trap restore EXIT INT TERM HUP

# Detached watchdog: restores even if this shell is SIGKILLed / OOM-killed.
setsid nohup bash -c "sleep 600; cp -f '$BACKUP' '$TARGET'" >/dev/null 2>&1 </dev/null &
WATCHDOG=$!
echo "--- [2] fail-safe restoration armed ---"
echo "trap:     EXIT INT TERM HUP -> atomic restore (cp to temp + mv)"
echo "watchdog: detached setsid pid $WATCHDOG, unconditional restore after 600s"
echo

echo "--- [3] mutation: remove ONLY the canvas identity conjunct ---"
python3 - "$TARGET" <<'PY'
import sys
p = sys.argv[1]
src = open(p).read()
needle = "        canvasRef.current.get(pageNumber) === canvas &&\n        canvas.isConnected;\n"
repl   = "        canvas.isConnected;\n"
n = src.count(needle)
print(f"mutation site occurrences: {n}")
assert n == 1, f"expected exactly 1 mutation site, found {n}"
open(p, "w").write(src.replace(needle, repl))
print("MUTATION APPLIED (guard conjunct removed; nothing else changed)")
PY
if [ $? -ne 0 ]; then
  echo "MUTATION FAILED — trap will restore"
  exit 92
fi
echo
echo "--- [3a] exact diff proving ONLY the guard was removed (backup -> mutated) ---"
diff -u "$BACKUP" "$TARGET"
echo "(diff exit $? — 1 means 'differs', which is expected here)"
echo "target sha256 mutated: $(sha256sum "$TARGET" | cut -d' ' -f1)"
echo "guard occurrences while mutated: $(grep -c "$GUARD" "$TARGET")"
echo

echo "--- [4] run the intended test against the MUTATED source (expect failure) ---"
echo "command: bun test --smol $TESTFILE -t \"$TESTNAME\""
systemd-run --user --scope -q -p MemoryMax=3G -p MemorySwapMax=0 -- \
  timeout -k 10 240 bun test --smol "$TESTFILE" -t "$TESTNAME"
RC=$?
echo
echo "NEGATIVE_CONTROL_EXIT=$RC"
case "$RC" in
  1) echo "NEGATIVE_CONTROL_VALIDITY=VALID (normal test failure — not a signal/OOM/timeout)" ;;
  0) echo "NEGATIVE_CONTROL_VALIDITY=INVALID (test PASSED under mutation — assertion is vacuous)" ;;
  124) echo "NEGATIVE_CONTROL_VALIDITY=INVALID (timeout)" ;;
  137|139|143) echo "NEGATIVE_CONTROL_VALIDITY=INVALID (killed by signal / OOM)" ;;
  *) echo "NEGATIVE_CONTROL_VALIDITY=INVALID (unexpected rc=$RC)" ;;
esac
echo

echo "--- [5] restore + prove byte identity ---"
restore
kill "$WATCHDOG" 2>/dev/null
POST_SHA="$(sha256sum "$TARGET" | cut -d' ' -f1)"
if cmp -s "$BACKUP" "$TARGET"; then CMP=identical; else CMP=MISMATCH; fi
echo "cmp backup vs target:  $CMP"
echo "target sha256 after:   $POST_SHA"
echo "target sha256 before:  $PRE_SHA"
echo "backup sha256:         $BACKUP_SHA"
echo "/tmp/upp.orig.ts sha256: $(sha256sum /tmp/upp.orig.ts 2>/dev/null | cut -d' ' -f1)"
echo "guard occurrences after restore: $(grep -c "$GUARD" "$TARGET")"
echo "git status for target: $(git status --short -- "$TARGET" | head -1)"
echo

echo "--- [6] restored positive run (same test, same filter — expect PASS) ---"
echo "command: bun test $TESTFILE -t \"$TESTNAME\""
systemd-run --user --scope -q -p MemoryMax=3G -p MemorySwapMax=0 -- \
  timeout -k 10 240 bun test "$TESTFILE" -t "$TESTNAME"
POS_RC=$?
echo
echo "POSITIVE_RERUN_EXIT=$POS_RC"
echo

echo "=== summary ==="
echo "negative control exit: $RC (expected 1)"
echo "positive rerun exit:   $POS_RC (expected 0)"
echo "restoration:           $CMP"
echo "guard restored:        $(grep -c "$GUARD" "$TARGET") occurrence(s)"
echo "utc_end:               $(date -u +%Y-%m-%dT%H:%M:%SZ)"
# Restoration is already proven above; disarm the trap BEFORE discarding the
# backup so the exit path cannot emit a spurious failed-restore line.
trap - EXIT INT TERM HUP
rm -f "$BACKUP"
if [ "$RC" = "1" ] && [ "$POS_RC" = "0" ] && [ "$CMP" = "identical" ]; then
  echo "OVERALL=PASS (assertion proven non-vacuous; source restored byte-identical)"
  exit 0
fi
echo "OVERALL=FAIL"
exit 1
