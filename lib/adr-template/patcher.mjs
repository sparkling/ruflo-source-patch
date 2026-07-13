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
const EDITS = [
  { find: '   - **Status**: proposed', replace: '   **Status**: proposed' },
  { find: "   - **Date**: <today's date YYYY-MM-DD>", replace: "   **Date**: <today's date YYYY-MM-DD>" },
  { find: '   - **Deciders**: <leave blank for author to fill>', replace: '   **Deciders**: <leave blank for author to fill>' },
  { find: '   - **Tags**: <leave blank>', replace: '   **Tags**: <leave blank>' },
];

import { backupOf, writeIfChanged, resolvePristine, restoreFromBackup } from '../pristine.mjs';

// Bytes-in -> bytes-out, pure: resolvePristine() uses it to recognise our own output on
// disk and so tell "upstream replaced this file" apart from "we already patched it".
const patchOnly = (src) => {
  let next = src;
  for (const e of EDITS) if (next.includes(e.find)) next = next.split(e.find).join(e.replace);
  return next;
};

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

// "Patched" means the bullet-marker anchor is absent from the template.
function isPatched(src) {
  return !EDITS.some((e) => src.includes(e.find));
}

export function apply() {
  const result = { patched: 0, unchanged: 0, skipped: 0, rebaselined: 0, log: [] };
  for (const file of discover()) {
    const { pristine, rebaselined, empty, poisoned } = resolvePristine(file, patchOnly);
    if (poisoned) {
      result.skipped++;
      result.log.push(`skip:poisoned-backup ${file} — its .rsp-backup was empty and has been discarded; the file is patched but its pristine is unrecoverable. Reinstall the plugin to reset.`);
      continue;
    }
    if (empty) {
      result.skipped++;
      result.log.push(`skip:empty-file ${file} — zero bytes; refusing to patch or overwrite it`);
      continue;
    }
    if (rebaselined) {
      result.rebaselined++;
      result.log.push(`re-baselined ${file} — upstream replaced it; patching the NEW file, not restoring the old one`);
    }
    const usable = EDITS.filter((e) => pristine.includes(e.find));
    if (!usable.length) {
      result.skipped++;
      result.log.push(`skip:anchor-not-found ${file}`);
      continue;
    }
    let next = pristine;
    for (const e of usable) next = next.split(e.find).join(e.replace);
    if (writeIfChanged(file, next)) {
      result.patched++;
      result.log.push(`patched ${file}`);
    } else {
      result.unchanged++;
    }
  }
  return result;
}

export function revert() {
  const result = { reverted: 0, log: [] };
  for (const file of discover()) {
    // NEVER restore an empty backup — that truncates the file instead of restoring it.
    const r = restoreFromBackup(file);
    if (r.poisoned) {
      result.log.push(`skip:poisoned-backup ${file} — its .rsp-backup was empty; discarded it rather than overwriting the file with nothing. The file stays patched; reinstall the plugin to reset.`);
      continue;
    }
    if (!r.reverted) continue;
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
      if (isPatched(fs.readFileSync(file, 'utf8'))) {
        out.patched++;
        out.log.push(`patched ${file}`);
      } else {
        out.log.push(`not-patched ${file}`);
      }
    } catch { /* unreadable */ }
  }
  return out;
}
