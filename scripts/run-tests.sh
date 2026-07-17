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
# The UserPromptSubmit hook (notify.mjs) now RE-BOOTSTRAPS a monitor it finds dead (ADR-021). That touches
# launchctl, which is machine-global and NOT sandboxed by HOME — a test driving the hook with a "down"
# monitor would register a real launchd job pointing at a sandbox path. This keeps the hook a pure reporter
# in tests; recovery itself is proven end-to-end and by recoverMonitor's unit test (RC1).
export RSP_NO_MONITOR_RECOVER=1
# NO TEST MAY TOUCH REAL launchd/cron. The launchd LABEL is a constant, not sandboxed by HOME, so a
# sandboxed uninstallMonitor()/installMonitor() would bootout the developer's (or a `npm test` user's) REAL
# monitor agent — the actual cause of the drops this project hunted. This no-ops the mutating launchctl/
# crontab calls; the plist/meta/heartbeat FILE logic still runs, so coverage is unchanged.
export RSP_NO_LAUNCHCTL=1
# Suites run in PARALLEL. The monitor tick now auto-restarts stale memory writers (ADR-023) by
# scanning the whole machine, so a tick-exercising suite would SIGTERM another suite's fake
# writers. Disable the kill globally; the stale-writer suite deletes this in-process to exercise
# the real kill against only its OWN fakes. Same discipline as RSP_NO_LAUNCHCTL above.
export RSP_NO_STALE_WRITER_KILL=1

SUITES=(sequence-fuzz plugin-notify reporting untested concurrency cleanup-procs stale-writer monitor-internals mcp-prefix design-wall)
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
