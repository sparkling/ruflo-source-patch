#!/usr/bin/env bash
# ruflo-adr-reindex — rebuild a project's ADR index and dependency graph from docs/adr/.
#
#   ruflo-adr-reindex [project-dir] [--dry-run]
#
# WHY THIS EXISTS
# ---------------
# `adr-index` has no reconcile path. The `adr-index` PATCH TARGET fixes the common
# case (ruvnet/ruflo#2660): with an explicit --upsert and a deterministic edge key,
# re-running the importer CONVERGES — status changes, metadata and changed relations
# all land, and edges stop duplicating.
#
# What upsert cannot do is REAP. Delete an ADR file, or remove a `Depends-on:` line
# from one, and the orphan row survives every future import: nothing tells the
# importer that a row it wrote last week no longer has a source. Only a full
# drop-and-rebuild reconciles deletions.
#
# That is what this does. The ADR files are the source of truth; adr-patterns /
# adr-edges are a derived cache; for a derived cache the correct reconcile is a
# rebuild. At ADR scale (tens to low hundreds of files) it is instant.
#
# The DELETE must be raw SQL. The CLI has no hard delete: `memory delete` is a SOFT
# delete, and the tombstoned row still trips the UNIQUE constraint on re-store
# (ruvnet/ruflo#2652, #2594). `memory cleanup` only reaps stale/expired entries.
#
# WHEN TO RUN
#   - after DELETING an ADR, or removing a relation line from one   <- required
#   - any time you want to be certain the graph matches the files   <- cheap
# For an ordinary edit (ratify an ADR, add a relation), the patched importer
# handles it: just run /adr-index as normal.
set -euo pipefail

DRY_RUN=0
PROJECT=""
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=1 ;;
    -h|--help) sed -n '2,6p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    -*) echo "unknown flag: $arg" >&2; exit 1 ;;
    *)  PROJECT="$arg" ;;
  esac
done
PROJECT="${PROJECT:-$PWD}"

# Resolve the project root: nearest ancestor with a .git, so this works from a
# subdirectory (the same cwd-drift problem the `cwd` target exists to fix).
ROOT="$(cd "$PROJECT" && git rev-parse --show-toplevel 2>/dev/null || echo "$PROJECT")"
DB="$ROOT/.swarm/memory.db"

[ -d "$ROOT/docs/adr" ] || [ -d "$ROOT/docs/adrs" ] || {
  echo "error: no docs/adr/ or docs/adrs/ under $ROOT" >&2; exit 1; }
[ -f "$DB" ] || { echo "error: no AgentDB at $DB (run \`ruflo memory init\` first)" >&2; exit 1; }
command -v sqlite3 >/dev/null || { echo "error: sqlite3 not on PATH" >&2; exit 1; }

# Resolve the newest installed ruflo-adr, so a plugin upgrade doesn't silently
# leave us running a stale importer.
PLUGIN_ROOT="$HOME/.claude/plugins/cache/ruflo/ruflo-adr"
PLUGIN="$(find "$PLUGIN_ROOT" -maxdepth 1 -mindepth 1 -type d 2>/dev/null | sort -V | tail -1)"
[ -n "$PLUGIN" ] && [ -f "$PLUGIN/scripts/import.mjs" ] || {
  echo "error: ruflo-adr plugin not found under $PLUGIN_ROOT" >&2; exit 1; }

count() { sqlite3 "$DB" "SELECT count(*) FROM memory_entries WHERE namespace='$1';"; }

# How many ADRs SHOULD be in the index. Mirrors import.mjs's own discovery rule exactly (any
# .md under docs/adr/ or docs/adrs/, recursively) — which is what it calls `desiredRecords`.
# Without this the rebuild has no post-condition worth the name; see the guard at the bottom.
#
# Only ever hand `find` directories that EXIST. Most projects have docs/adr and not docs/adrs, so
# naming both unconditionally makes find exit 1 — and under `set -e` that killed the script dead,
# right after a perfectly good rebuild, with no message and exit 1. (Observed, in this script,
# during exactly the verification run that was supposed to prove it worked.)
adr_file_count() {
  local dirs=()
  [ -d "$ROOT/docs/adr" ] && dirs+=("$ROOT/docs/adr")
  [ -d "$ROOT/docs/adrs" ] && dirs+=("$ROOT/docs/adrs")
  [ ${#dirs[@]} -eq 0 ] && { echo 0; return; }
  find "${dirs[@]}" -type f -name '*.md' | wc -l | tr -d ' '
}

# THE WRITE LOCK — the same <db>.rsp-lock the `memory` patch target installs into the CLI
# (O_EXCL create, holder writes its pid, stale after 15s).
#
# WHY THIS SCRIPT NEEDS IT. ruflo writes memory.db as a whole-file read-modify-write image, so a
# concurrent writer that read BEFORE our delete and flushes AFTER it puts every row back — the
# "50 acked, 25 on disk" failure the memory patch exists to prevent, aimed squarely at the one
# operation this script exists to perform. Deleting outside the lock made the reconcile itself
# the least safe write in the system.
#
# SCOPE: the DELETE only. We must NOT hold it across the re-import — the patched CLI takes this
# same lock for every store, and would spin for 5s and then proceed UNLOCKED (its timeout path
# degrades rather than fails). Locking the delete is what the race needs; locking the import
# would only disable the import's own locking.
#
# A LOCK IS A CONVENTION, NOT A MECHANISM. Nothing in the OS enforces this file — it works only
# because the OTHER side takes it too, and the other side only takes it if the `memory` patch
# target is installed (it is that patch which wraps storeEntry/getEntry/deleteEntry in
# __rufloLockAcquire). Install adr-reindex WITHOUT memory and this script would hold a file that
# nothing on earth honours, print "holding the write lock", and delete straight into the race it
# claims to be protected from. So: check that the lock means something, and say so when it does
# not. Announcing a protection you do not have is worse than announcing none.
LOCK="$DB.rsp-lock"

# Does the INSTALLED CLI actually honour <db>.rsp-lock? Checked against the vendor bytes, not
# against our own state.json — state records what we were asked to install; only the file says
# what is true. Any copy missing the wrapper is enough to lose the race.
memory_lock_honored() {
  local f
  for f in "$HOME"/.npm/_npx/*/node_modules/@claude-flow/cli/dist/src/memory/memory-initializer.js \
           "$(dirname "$(dirname "$(command -v node)")")"/lib/node_modules/@claude-flow/cli/dist/src/memory/memory-initializer.js; do
    [ -f "$f" ] || continue
    grep -q '__rufloLockAcquire' "$f" || return 1
    return 0
  done
  return 1   # no CLI found at all — assume nothing honours it
}
lock_acquire() {
  local deadline=$(( $(date +%s) + 5 ))
  while :; do
    if ( set -o noclobber; printf '%s' "$$" > "$LOCK" ) 2>/dev/null; then
      trap 'rm -f "$LOCK"' EXIT INT TERM
      return 0
    fi
    # Steal a stale lock: >15s old means the holder died mid-write.
    local age
    age=$(( $(date +%s) - $(stat -f %m "$LOCK" 2>/dev/null || stat -c %Y "$LOCK" 2>/dev/null || echo 0) ))
    if [ "$age" -gt 15 ]; then rm -f "$LOCK"; continue; fi
    [ "$(date +%s)" -ge "$deadline" ] && return 1
    sleep 0.1
  done
}

# Run FROM the project root. import.mjs takes ADR_ROOT to find the ADR *files*, but
# it shells out to the ruflo CLI to store them — and the CLI resolves which
# memory.db to write from its CWD, not from ADR_ROOT. Invoked from anywhere else,
# the importer reads the right ADRs and writes them to the wrong database (or to
# none at all, if that directory has no .swarm) — while this script has already
# emptied the real one. Observed exactly that: `Records stored: 0/2` and an empty
# index, run from a sibling repo.
cd "$ROOT"

echo "==> project   $ROOT"
echo "==> importer  $PLUGIN/scripts/import.mjs"
echo "==> before    adr-patterns=$(count adr-patterns)  adr-edges=$(count adr-edges)"

if [ "$DRY_RUN" = 1 ]; then
  echo "==> dry run — would DELETE both namespaces and re-import; nothing written"
  ADR_ROOT="$ROOT" IMPORT_DRY_RUN=1 node "$PLUGIN/scripts/import.mjs"
  exit 0
fi

# Drop the derived cache. Both namespaces together: clearing only adr-patterns
# would fix stale statuses and leave duplicate edges behind — a partial rebuild
# is its own trap.
#
# The CHECKPOINT is belt-and-braces, NOT a fix for anything observed here. Tested
# without it: the delete lands, the re-import stores 2/2 every time, and the WAL is
# already empty — the sqlite3 CLI checkpoints on close. It is kept only because the
# CLI reads through sql.js, which has documented WAL-coherence bugs (ruvnet/ruflo#2584,
# #2646): a reader that saw a stale pre-delete image would try to INSERT rows it
# believes still exist, hit UNIQUE, and store nothing. One PRAGMA removes that class
# of hazard regardless of who checkpoints. Do not read this as a reproduction.
echo "==> clearing (hard delete — a soft delete would block the re-store)"

# Say what the lock is actually worth BEFORE relying on it.
if memory_lock_honored; then
  HONORED=1
else
  HONORED=0
  echo "    WARNING: the \`memory\` patch target is NOT installed in the ruflo CLI." >&2
  echo "             <db>.rsp-lock is advisory — it only works because the CLI takes it too, and" >&2
  echo "             an unpatched CLI does not. This delete is therefore UNPROTECTED: a daemon or" >&2
  echo "             MCP server holding a pre-delete image can flush it back and resurrect every" >&2
  echo "             row (ruvnet/ruflo#2621). The post-check below will catch it if it happens." >&2
  echo "             Fix properly:  npx @sparkleideas/ruflo-source-patch memory install" >&2
  echo "             Or, for this run:  npx @claude-flow/cli@latest daemon stop" >&2
fi

if lock_acquire; then
  [ "$HONORED" = 1 ] && echo "    holding the write lock ($LOCK)"
else
  # Never hard-fail on the lock — same discipline as the memory patch itself, which proceeds
  # unlocked rather than breaking memory. But SAY SO: an unlocked delete is exactly the window
  # in which a concurrent writer can resurrect everything we are about to remove.
  echo "    WARNING: could not take the write lock after 5s — deleting UNLOCKED." >&2
  echo "             A concurrent ruflo writer could resurrect these rows. The post-check below" >&2
  echo "             will catch it if it happens; re-run this command if it does." >&2
fi

sqlite3 "$DB" "
  DELETE FROM memory_entries WHERE namespace IN ('adr-patterns','adr-edges');
  PRAGMA wal_checkpoint(TRUNCATE);
"

# Release BEFORE the import: the patched CLI takes this same lock on every store, and holding it
# here would make it spin out and fall back to unlocked writes for the entire rebuild.
rm -f "$LOCK"; trap - EXIT INT TERM

echo "==> rebuilding from the ADR files"
ADR_ROOT="$ROOT" node "$PLUGIN/scripts/import.mjs"

# THE POST-CONDITION. The index must now hold EXACTLY one record per ADR file — no more, no less.
#
# `records != 0` was the old check, and it cannot see the failure this script exists to prevent.
# If the delete is clobbered (a concurrent writer flushing a pre-delete image), the re-import
# simply upserts cleanly on top of the resurrected rows: records is nonzero, every store reports
# ok, and the script exits 0 having reconciled NOTHING — with the orphans it was run to reap
# still sitting there. The one job, silently not done.
#
# Comparing against the file count catches both directions at once: too few (the store is
# failing) and too many (the delete didn't take, or didn't stick).
RECORDS="$(count adr-patterns)"
EXPECTED="$(adr_file_count)"

if [ "$RECORDS" -eq 0 ]; then
  echo "error: rebuild stored 0 records — the index is now EMPTY." >&2
  echo "       The ADR files are intact; re-run this command to rebuild." >&2
  echo "       If it persists, the CLI's store is failing — run the importer directly to see why:" >&2
  echo "       ADR_ROOT=$ROOT node $PLUGIN/scripts/import.mjs" >&2
  exit 1
fi

if [ "$RECORDS" -ne "$EXPECTED" ]; then
  echo "error: the index holds $RECORDS record(s) for $EXPECTED ADR file(s) — NOT reconciled." >&2
  if [ "$RECORDS" -gt "$EXPECTED" ]; then
    echo "       More rows than files: the DELETE did not stick. A concurrent ruflo writer" >&2
    echo "       (daemon, MCP server) most likely flushed a pre-delete image back over it." >&2
    echo "       Stop it and re-run:  npx @claude-flow/cli@latest daemon stop" >&2
  else
    echo "       Fewer rows than files: some ADRs failed to store. Run the importer directly:" >&2
    echo "       ADR_ROOT=$ROOT node $PLUGIN/scripts/import.mjs" >&2
  fi
  exit 1
fi

echo "==> verifying graph integrity"
ADR_ROOT="$ROOT" node "$PLUGIN/scripts/verify.mjs"

echo "==> after     adr-patterns=$RECORDS  adr-edges=$(count adr-edges)"
