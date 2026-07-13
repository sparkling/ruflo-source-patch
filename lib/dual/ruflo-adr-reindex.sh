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
sqlite3 "$DB" "
  DELETE FROM memory_entries WHERE namespace IN ('adr-patterns','adr-edges');
  PRAGMA wal_checkpoint(TRUNCATE);
"

echo "==> rebuilding from the ADR files"
ADR_ROOT="$ROOT" node "$PLUGIN/scripts/import.mjs"

# A rebuild that stored nothing is the worst outcome: the old index is already
# gone, so a silent failure leaves an EMPTY graph that `verify` then certifies as
# healthy (0 records, 0 dangling refs, 0 cycles — a clean bill of health on
# nothing). Never exit 0 on that.
RECORDS="$(count adr-patterns)"
if [ "$RECORDS" -eq 0 ]; then
  echo "error: rebuild stored 0 records — the index is now EMPTY." >&2
  echo "       The ADR files are intact; re-run this command to rebuild." >&2
  echo "       If it persists, the CLI's store is failing — run the importer directly to see why:" >&2
  echo "       ADR_ROOT=$ROOT node $PLUGIN/scripts/import.mjs" >&2
  exit 1
fi

echo "==> verifying graph integrity"
ADR_ROOT="$ROOT" node "$PLUGIN/scripts/verify.mjs"

echo "==> after     adr-patterns=$RECORDS  adr-edges=$(count adr-edges)"
