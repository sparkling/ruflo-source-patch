#!/usr/bin/env bash
# The suites are independent: each takes its own `mktemp -d` sandbox and stubs HOME, the npx root and the
# global npm root into it. Serially they cost the SUM of their runtimes; in parallel, the MAX. The fuzz
# suite alone is ~60s and dominates, so the rest run inside its shadow for free.
#
# Output is buffered per suite and printed in a fixed order, so a parallel run reads exactly like a serial
# one. A suite that fails still fails the whole run: every exit code is collected, none are swallowed.
set -uo pipefail
cd "$(dirname "$0")/.."

# NO TEST MAY SELF-UPDATE THIS MACHINE. Several suites spawn `monitor run`, whose tick now ends by
# checking GitHub for a newer TAG and, if it finds one, really running `npx github:...#vX monitor install`.
# Unguarded, running the test suite would reach the network and reinstall the developer's own tool from
# whatever is published. The self-update tests lift this locally and put it back.
export RSP_NO_SELF_UPDATE=1

SUITES=(sequence-fuzz plugin-notify reporting untested concurrency cleanup-procs monitor-internals)
tmp=$(mktemp -d); pids=(); fail=0

for s in "${SUITES[@]}"; do
  ( node "test/$s.mjs" "$(mktemp -d)" >"$tmp/$s.out" 2>&1; echo $? >"$tmp/$s.code" ) &
  pids+=($!)
done
for p in "${pids[@]}"; do wait "$p"; done

for s in "${SUITES[@]}"; do
  cat "$tmp/$s.out"
  [ "$(cat "$tmp/$s.code" 2>/dev/null || echo 1)" = "0" ] || { fail=1; echo "✘ test/$s.mjs FAILED"; }
done

node scripts/md-lint.mjs || fail=1
rm -rf "$tmp"
exit $fail
