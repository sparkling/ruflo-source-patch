// Patches the INSTALLED `ruflo-adr` plugin's `adr-index` importer
// (`scripts/import.mjs`, ruvnet/ruflo#2660), scoped to the `ruflo` upstream
// marketplace. Sibling of the adr-template patcher: that one fixes what
// adr-create WRITES, this one fixes what adr-index READS BACK IN.
//
// THE BUG: `adr-index` cannot update an ADR that changed. Its SKILL.md
// advertises "Build or REBUILD the ADR index ... when the AgentDB graph is out
// of sync with the on-disk ADR files" — and that is the one thing it cannot do.
// Both namespaces are insert-only, and that single choice fails in OPPOSITE
// directions depending on whether the key is deterministic:
//
//   adr-patterns  key `ADR-001::<basename>` — deterministic, so it collides.
//                 The INSERT is rejected and the record stays FROZEN at
//                 whatever was first indexed. Ratify an ADR (proposed ->
//                 accepted), re-run adr-index, and the graph still says
//                 proposed.
//
//   adr-edges     key embeds Date.now()+random, so it NEVER collides. Every run
//                 re-inserts the whole edge set: 3 -> 6 -> 9 -> ... Duplicate
//                 edges silently weight an ADR by how many times someone ran
//                 the indexer.
//
// Neither half is recoverable by running the tool again, and it reports success
// either way (see edit 2/4 below).
//
// THE UPSERT TWIST (ruvnet/ruflo#2594): `memory store --help` advertises
// `-u, --upsert  [default: true]` — but that declared default is NOT honored.
// Measured against @claude-flow/cli@latest:
//
//   store to an existing key, no flag  -> exit 1, "UNIQUE constraint failed", NO write
//   store to an existing key, --upsert -> exit 0, updated
//
// So the flag must be passed EXPLICITLY. Relying on the documented default —
// which is what import.mjs effectively does by omitting it — silently gets a
// strict insert. Keep the explicit flag even after #2594 is fixed: it costs
// nothing and makes the intent legible at the call site.
//
// WHAT THIS DOES NOT FIX: deletions. With upsert + deterministic keys, re-running
// adr-index CONVERGES (status, metadata and changed relations all land), but a
// removed ADR file or a deleted `Depends-on:` line leaves an orphan row that no
// re-import reaps. Reaping needs a full drop-and-rebuild — that is the separate
// `adr-reindex` script target, and it needs raw SQL because the CLI has no hard
// delete (`memory delete` is a soft delete, and the tombstone still trips the
// UNIQUE constraint on re-store, #2652).

import fs from 'node:fs';
import path from 'node:path';
import { HOME_BASE } from '../cwd/paths.mjs';

const MARKETPLACE = 'ruflo'; // upstream only — no legacy forks
const PLUGIN_NAME = 'ruflo-adr';
const SCRIPT_SUFFIX = ['scripts', 'import.mjs'];

// Exact strings, not regexes — same literal find/replace discipline as the
// adr-template patcher, so an anchor that no longer matches (upstream
// rewording) is skipped rather than guessed at.
//
// Each edit carries `variants` (alternative anchors for the same fix) and a
// `done()` predicate that reports whether the fix is present, INDEPENDENT of
// which anchor produced it. That matters: the installed copies are NOT identical.
// The marketplace checkout carries local #2474 fixes and passes its args in the
// `--key=${key}` form (npm rejects an argv token starting with a U+2014 em-dash,
// so ADR titles containing one made every store fail), while the cache copy uses
// the `'--key', key` form. One anchor cannot match both.
//
// `done()` is what makes a PARTIAL patch visible. Matching on anchor-absence
// alone would call a file "patched" when an anchor simply never existed — which
// is precisely how a missing --upsert edit could sail through green while
// leaving the actual bug (#2660) in place.
const EDITS = [
  // 1. Pass --upsert explicitly. Without it the store is a strict INSERT and
  //    every already-indexed ADR is frozen. The CLI's declared default of true
  //    is not honored (#2594), so omitting the flag is not an option.
  //    '--upsert' is a boolean flag and is a valid argv token on its own, so the
  //    same insert works regardless of which form the neighbouring args use.
  {
    id: 'upsert',
    done: (src) => src.includes("'--upsert',"),
    variants: [
      {
        find: "    '--key', key,\n    '--value', typeof value === 'string' ? value : JSON.stringify(value),",
        replace: "    '--key', key,\n    // ruflo-source-patch (#2660): explicit --upsert. The CLI declares this the\n    // default but does not honor it (#2594), so omitting it means a strict INSERT.\n    '--upsert',\n    '--value', typeof value === 'string' ? value : JSON.stringify(value),",
      },
      {
        find: '    `--key=${key}`,\n    `--value=${valueStr}`,',
        replace: "    `--key=${key}`,\n    // ruflo-source-patch (#2660): explicit --upsert. The CLI declares this the\n    // default but does not honor it (#2594), so omitting it means a strict INSERT.\n    '--upsert',\n    `--value=${valueStr}`,",
      },
    ],
  },

  // 2. Stop counting a failed write as a stored record. `memoryStore()` maps the
  //    UNIQUE-constraint failure (exit 1) to the sentinel 'exists', and the
  //    caller folds 'exists' into the success tally — so the summary prints
  //    "Records stored: 2/2" while nothing was written and `errors` stays empty.
  //    With --upsert in place 'exists' is unreachable for records; if it ever
  //    reappears it is a genuine failure and belongs in `errors`.
  {
    id: 'records-miscount',
    done: (src) => src.includes("if (r === 'ok') storedRecords++;"),
    variants: [{
      find: "    if (r === 'ok' || r === 'exists') storedRecords++;",
      replace: "    if (r === 'ok') storedRecords++;",
    }],
  },

  // 3. Make the edge key deterministic. The edge's identity IS (relation, from,
  //    to) — embedding Date.now()+random in the key is what makes it impossible
  //    to upsert, and guarantees a fresh duplicate row on every single run.
  //    `capturedAt` already lives in the VALUE, where it belongs; it has no
  //    business in the identity.
  {
    id: 'edge-key',
    done: (src) => src.includes('const key = `${e.relation}:${e.from}->${e.to}`;'),
    variants: [{
      find: '    const key = `${e.relation}:${e.from}->${e.to}:${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;',
      replace: '    const key = `${e.relation}:${e.from}->${e.to}`;',
    }],
  },

  // 4. Same miscount on the edges path.
  {
    id: 'edges-miscount',
    done: (src) => src.includes("if (r === 'ok') storedEdges++;"),
    variants: [{
      find: "    if (r === 'ok' || r === 'exists') storedEdges++;",
      replace: "    if (r === 'ok') storedEdges++;",
    }],
  },
];

const backupOf = (file) => `${file}.rsp-backup`;

// Write only when bytes actually change, and write atomically (temp -> fsync ->
// rename), same durability discipline as the other patchers.
function writeIfChanged(file, next) {
  let current;
  try { current = fs.readFileSync(file, 'utf8'); } catch { current = null; }
  if (current === next) return false;
  const tmp = path.join(path.dirname(file), `.${path.basename(file)}.rsp-tmp-${process.pid}`);
  let fd;
  try {
    fd = fs.openSync(tmp, 'wx');
    fs.writeFileSync(fd, next);
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = undefined;
    fs.renameSync(tmp, file);
  } finally {
    if (fd !== undefined) { try { fs.closeSync(fd); } catch {} }
    if (fs.existsSync(tmp)) { try { fs.rmSync(tmp, { force: true }); } catch {} }
  }
  return true;
}

// Discover every installed copy of the UPSTREAM ruflo-adr's scripts/import.mjs:
//   cache/ruflo/ruflo-adr/<version>/scripts/import.mjs
//   marketplaces/ruflo/plugins/ruflo-adr/scripts/import.mjs
// Scoped to the `ruflo` marketplace only — legacy forks under other marketplace
// names are out of scope and must never be touched by this target.
export function discover() {
  const found = [];

  const cachePluginRoot = path.join(HOME_BASE, '.claude', 'plugins', 'cache', MARKETPLACE, PLUGIN_NAME);
  try {
    for (const version of fs.readdirSync(cachePluginRoot)) {
      const file = path.join(cachePluginRoot, version, ...SCRIPT_SUFFIX);
      if (fs.existsSync(file)) found.push(file);
    }
  } catch { /* not installed via this cache path */ }

  const marketplaceFile = path.join(
    HOME_BASE, '.claude', 'plugins', 'marketplaces', MARKETPLACE, 'plugins', PLUGIN_NAME, ...SCRIPT_SUFFIX,
  );
  if (fs.existsSync(marketplaceFile)) found.push(marketplaceFile);

  return [...new Set(found)];
}

// Once a backup exists it is the only source of truth for "pristine" — same rule
// as the other patchers, so re-running install/uninstall stays idempotent.
function readPristine(file) {
  const backup = backupOf(file);
  if (fs.existsSync(backup)) return fs.readFileSync(backup, 'utf8');
  const src = fs.readFileSync(file, 'utf8');
  fs.copyFileSync(file, backup);
  return src;
}

// "Patched" means every edit's fix is PRESENT — not merely that its anchor is
// absent. An anchor can be absent because the fix is in, or because the file
// never had that shape; only done() tells those apart.
function isPatched(src) {
  return EDITS.every((e) => e.done(src));
}

// Apply every edit whose fix isn't already present, using whichever variant
// matches this copy. Returns the ids that could NOT be applied — a non-empty
// `missing` is a loud failure, not a rounding error: a copy missing the `upsert`
// edit still has bug #2660 in full.
function patchSource(pristine) {
  let next = pristine;
  const applied = [];
  const missing = [];
  for (const e of EDITS) {
    if (e.done(next)) continue;
    const v = e.variants.find((x) => next.includes(x.find));
    if (!v) { missing.push(e.id); continue; }
    next = next.split(v.find).join(v.replace);
    applied.push(e.id);
  }
  return { next, applied, missing };
}

export function apply() {
  const result = { patched: 0, unchanged: 0, skipped: 0, incomplete: 0, log: [] };
  for (const file of discover()) {
    const pristine = readPristine(file);
    const { next, applied, missing } = patchSource(pristine);

    if (!applied.length && missing.length) {
      result.skipped++;
      result.log.push(`skip:no-anchor-matched ${file} — missing: ${missing.join(', ')}`);
      continue;
    }

    const changed = writeIfChanged(file, next);
    if (changed) result.patched++;
    else result.unchanged++;

    if (missing.length) {
      // Partial. Say so plainly — this is the one outcome that must never look
      // like success, because the file is left carrying the bug it claims to fix.
      result.incomplete++;
      result.log.push(`INCOMPLETE ${file} — applied: ${applied.join(', ') || 'none'}; NOT APPLIED: ${missing.join(', ')} (upstream shape changed?)`);
    } else if (changed) {
      result.log.push(`patched ${file} (${applied.length}/${EDITS.length} edits)`);
    }
  }
  return result;
}

export function revert() {
  const result = { reverted: 0, log: [] };
  for (const file of discover()) {
    const backup = backupOf(file);
    if (!fs.existsSync(backup)) continue;
    fs.copyFileSync(backup, file);
    fs.rmSync(backup, { force: true });
    result.reverted++;
    result.log.push(`reverted ${file}`);
  }
  return result;
}

export function status() {
  const out = { files: 0, patched: 0, log: [] };
  for (const file of discover()) {
    out.files++;
    try {
      const src = fs.readFileSync(file, 'utf8');
      if (isPatched(src)) {
        out.patched++;
        out.log.push(`patched ${file}`);
      } else {
        // Name the specific edits that are missing. "not-patched" alone would
        // hide a copy that has three of four fixes and still carries the bug.
        const missing = EDITS.filter((e) => !e.done(src)).map((e) => e.id);
        out.log.push(`not-patched ${file} — missing: ${missing.join(', ')}`);
      }
    } catch { /* unreadable */ }
  }
  return out;
}
