// Patches the INSTALLED `ruflo-adr` plugin's `adr-create` skill template
// (ruvnet/ruflo#2659), scoped to the `ruflo` upstream marketplace — this makes
// adr-create's own output match what adr-index's parser expects. The two
// skills ship in the SAME plugin and currently disagree with each other.
//
// adr-create's template (SKILL.md step 3) writes Status/Date/Deciders/Tags as
// a bullet list:
//
//   - **Status**: proposed
//   - **Date**: <today's date YYYY-MM-DD>
//
// adr-index's parser (`scripts/import.mjs`) only recognises two formats per
// its OWN doc comment: "v3-style" (a `**Status**: Proposed` line with NO
// leading marker) or YAML frontmatter. Neither matches the bullet form, so
// `parseStatus`/`parseDate`/`parseTags`'s `^`-anchored regexes never match a
// line that starts with `- `, and every ADR authored via adr-create's own
// documented template indexes into `adr-patterns` with status/date/tags
// silently dropped to empty/Unknown. Confirmed against a real ADR produced by
// following the skill exactly (docs/adr/ADR-001-*.md, 2026-07-13).
//
// Fix: strip the leading `- ` from those four template lines in adr-create's
// SKILL.md, so its own output matches the "v3-style" format adr-index already
// parses — one plugin, one format, both skills agree.

import fs from 'node:fs';
import path from 'node:path';
import { HOME_BASE } from '../cwd/paths.mjs';

const MARKETPLACE = 'ruflo'; // upstream only — no legacy forks
const PLUGIN_NAME = 'ruflo-adr';
const SKILL_SUFFIX = ['skills', 'adr-create', 'SKILL.md'];

// The four buggy lines and their fixed (unprefixed) form. Exact strings, not
// regexes — matches this toolkit's literal find/replace discipline elsewhere,
// so an anchor that no longer matches (upstream rewording) is skipped
// individually rather than guessed at.
//
// Each edit carries a `done()` predicate that reports whether the fix is PRESENT — the same
// discipline adr-index/patcher.mjs uses, and for the reason it spells out: "An anchor can be
// absent because the fix is in, or because the file never had that shape; only done() tells
// those apart."
//
// This file used to define patched as the mere ABSENCE of the anchors, which is exactly the
// trap its sibling documents. Upstream reindents or rewords one of these lines and every
// anchor stops matching — so `status` reported `1/1 patched` and `monitor check` printed
// `ok — no drift`, while #2659 was fully live and every ADR authored through adr-create kept
// indexing with an empty status, date and tags. Two of the three reporting surfaces were
// green on a dead patch.
//
// done() discriminates cleanly here: the buggy line is `   - **Status**…` (three spaces, a
// dash, a space), so it does NOT contain the fixed substring `   **Status**` (three spaces
// then the bold marker). Absent BOTH forms => upstream changed shape => not patched, loudly.
const EDITS = [
  { id: 'status', find: '   - **Status**: proposed', replace: '   **Status**: proposed' },
  { id: 'date', find: "   - **Date**: <today's date YYYY-MM-DD>", replace: "   **Date**: <today's date YYYY-MM-DD>" },
  { id: 'deciders', find: '   - **Deciders**: <leave blank for author to fill>', replace: '   **Deciders**: <leave blank for author to fill>' },
  { id: 'tags', find: '   - **Tags**: <leave blank>', replace: '   **Tags**: <leave blank>' },
].map((e) => ({ ...e, done: (src) => src.includes(e.replace) }));

// Discover every installed copy of the UPSTREAM ruflo-adr's adr-create/SKILL.md:
//   cache/ruflo/ruflo-adr/<version>/skills/adr-create/SKILL.md
//   marketplaces/ruflo/plugins/ruflo-adr/skills/adr-create/SKILL.md
// Scoped to the `ruflo` marketplace only — legacy forks under other
// marketplace names (e.g. an old `sparkleideas` checkout) are out of scope
// and must never be touched by this target.
export function discover() {
  const found = [];

  const cachePluginRoot = path.join(HOME_BASE, '.claude', 'plugins', 'cache', MARKETPLACE, PLUGIN_NAME);
  try {
    for (const version of fs.readdirSync(cachePluginRoot)) {
      const file = path.join(cachePluginRoot, version, ...SKILL_SUFFIX);
      if (fs.existsSync(file)) found.push(file);
    }
  } catch { /* not installed via this cache path */ }

  const marketplaceFile = path.join(
    HOME_BASE, '.claude', 'plugins', 'marketplaces', MARKETPLACE, 'plugins', PLUGIN_NAME, ...SKILL_SUFFIX,
  );
  if (fs.existsSync(marketplaceFile)) found.push(marketplaceFile);

  return [...new Set(found)];
}

// "Patched" means every edit's fix is PRESENT — not merely that its anchor is gone.
function isPatched(src) {
  return EDITS.every((e) => e.done(src));
}

// How many times does this anchor occur? split().join() is replace-ALL, so an anchor that is no longer
// UNIQUE would be applied to every occurrence — silently, and in a place we never inspected.
//
// Anchor uniqueness is a property of UPSTREAM'S CODE, which we do not control and cannot guarantee for
// any future release. Today all of them are unique. That is a measurement, not a promise. So we check it
// at apply time and REFUSE when it no longer holds: an ambiguous anchor is not a licence to guess, it is
// a signal that upstream restructured and a human must look.
const occurrences = (src, needle) => {
  let n = 0;
  let i = 0;
  while ((i = src.indexOf(needle, i)) !== -1) { n++; i += needle.length; }
  return n;
};

// Apply every edit whose fix isn't already present, using its unique anchor. Returns the ids that could
// NOT be applied — a non-empty `missing` is a loud failure (a template with 3 of 4 lines fixed still
// mis-indexes every ADR on the 4th), and an ambiguous anchor is refused, never guessed at. Same shape as
// the adr-index / verify-interface patchers, so the shared engine can compose all of them uniformly.
function patchSource(pristine) {
  let next = pristine;
  const applied = [];
  const missing = [];
  for (const e of EDITS) {
    if (e.done(next)) continue;
    const n = occurrences(next, e.find);
    if (n === 1) { next = next.split(e.find).join(e.replace); applied.push(e.id); }
    else { missing.push(n > 1 ? `${e.id}(AMBIGUOUS: anchor occurs ${n}x)` : e.id); }
  }
  return { next, applied, missing };
}

// The composable descriptor. The per-file loop (pristine, compose, write, restore, reporting) lives in
// the shared engine (plugin-compose.mjs), so this target and mcp-prefix patch a shared adr-create/SKILL.md
// from ONE pristine instead of corrupting each other's backup (ADR-020).
export const descriptor = {
  name: 'adr-template',
  atomic: false,
  editCount: EDITS.length,
  discover,
  patchSource,
  isPatched,
};
