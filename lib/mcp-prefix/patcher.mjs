// Rewrites the ruflo plugins' bundled MCP tool references from the legacy
// standalone prefix `mcp__claude-flow__` to the plugin-namespaced form
// `mcp__plugin_ruflo-core_ruflo__` (ruvnet/ruflo#2685).
//
// THE BUG. Every `ruflo` Claude Code plugin bundles skills, agents, commands and
// hooks that name the MCP tools `mcp__claude-flow__<tool>`. That prefix only
// resolves when the server is registered STANDALONE under the key `claude-flow`
// (`claude mcp add claude-flow …`, ruvnet/ruflo#2206). When ruflo is used AS A
// PLUGIN — the marketplace install path — Claude Code namespaces the plugin's own
// bundled MCP server, so the very same tools are exposed as
// `mcp__plugin_ruflo-core_ruflo__<tool>`. Claude Code's own MCP reference is
// explicit: "A hook matcher written against the bare server key … NEVER fires for
// a plugin-bundled server." So under plugin loading the bundled `allowed-tools`
// globs grant nothing, and prompt-embedded tool names name tools that don't exist.
//
// The platform will not bridge this: anthropics/claude-code#29360 and #15145 are
// both CLOSED AS NOT PLANNED. The fix has to live in the plugin content.
//
// WHY UNIFORM REPLACEMENT IS CORRECT. Measured on a current install: only
// `ruflo-core` ships an `.mcp.json` (server key `ruflo`); no other ruflo-* plugin
// ships its own server. So every `mcp__claude-flow__<tool>` reference across all
// ~30 plugin packages resolves to that ONE server, and the plugin-namespaced name
// for all of them is uniformly `mcp__plugin_ruflo-core_ruflo__<tool>`. The edit is
// a single literal, applied to every occurrence (ADR-001's `all` case), never a
// per-site anchor table.
//
// SAFETY. This only ever touches files UNDER the ruflo plugin trees, which are
// loaded only when the plugin is enabled — and when the plugin is enabled, the
// plugin-namespaced prefix is the one that resolves. So the rewrite is correct
// wherever it takes effect and inert where the plugin isn't loaded. Every file is
// backed up to `<file>.rsp-backup` first and `uninstall` restores it byte-for-byte
// (a `/plugin update` that lands a fresh copy re-baselines, per pristine.mjs).
// It is scoped to the `ruflo` marketplace only; forks under other marketplace
// names are out of scope by design.

import fs from 'node:fs';
import path from 'node:path';
import { HOME_BASE } from '../cwd/paths.mjs';

const MARKETPLACE = 'ruflo'; // upstream marketplace only — no legacy forks
const ANCHOR = 'mcp__claude-flow__';
const REPLACEMENT = 'mcp__plugin_ruflo-core_ruflo__';

// Text files the ruflo plugins actually carry references in. A binary/asset with
// these bytes is not a thing we produce, and reading everything under the tree
// every monitor tick is the cost we bound here.
const TEXT_EXT = new Set(['.md', '.json', '.sh', '.mjs', '.js', '.cjs', '.txt', '.yaml', '.yml']);
// Never descend into these — a plugin that vendors node_modules would explode the walk.
const SKIP_DIRS = new Set(['node_modules', '.git']);

// Pure, deterministic, idempotent: REPLACEMENT does not contain ANCHOR, so a second
// pass is a no-op. resolvePristine() relies on this to recognise our own output.
export const patchOnly = (src) => src.split(ANCHOR).join(REPLACEMENT);

// The exact inverse of patchOnly — a plain split/join is a lossless bijection as long as
// pristine never already contained REPLACEMENT (a highly project-specific literal no vendor
// file predates) and current carries no bare ANCHOR (which isPatched already requires before
// a caller may use this). Exposed so pristine.mjs's poisoned-backup recovery can reconstruct a
// candidate pristine when the real `.rsp-backup` is lost — and it is NEVER trusted on its own:
// the caller must re-run `patchOnly` on the result and require it reproduce `current` byte for
// byte before accepting it. That round-trip, not this function's own correctness, is the proof.
export const unpatchOnly = (src) => src.split(REPLACEMENT).join(ANCHOR);

const isTextFile = (f) => TEXT_EXT.has(path.extname(f));

// Recursively collect files under `root` that are candidates: a matching extension,
// AND either the live bytes still carry the anchor (unpatched) or a `.rsp-backup`
// sibling exists (we patched it before — its live bytes no longer carry the anchor,
// so a content-only scan would lose it and `status`/`restore` would go blind).
function walk(root, out) {
  let entries;
  try { entries = fs.readdirSync(root, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    const full = path.join(root, e.name);
    if (e.isDirectory()) {
      if (!SKIP_DIRS.has(e.name)) walk(full, out);
      continue;
    }
    if (!e.isFile()) continue;
    if (e.name.endsWith('.rsp-backup') || e.name.includes('.rsp-tmp-')) continue;
    if (!isTextFile(e.name)) continue;
    let src;
    try { src = fs.readFileSync(full, 'utf8'); } catch { continue; }
    // A file we PATCH (still carries the bare prefix) or ALREADY patched (carries our plugin-form output).
    // Deliberately NOT "any file with a sibling .rsp-backup" — that was the over-broad discovery that let
    // this sweep hijack adr-template/adr-index's own files and corrupt their shared pristine (ADR-020).
    // Vendor plugin files use the bare `mcp__claude-flow__`; the plugin-form prefix appears only because
    // WE wrote it, so it is a safe self-signal and never claims a file this target has no business in.
    if (src.includes(ANCHOR) || src.includes(REPLACEMENT)) out.add(full);
  }
}

// The two ruflo plugin roots. The cache path is versioned (a `/plugin update`
// lands a fresh version dir with no backup and re-baselines naturally); the
// marketplace path is rewritten in place, which is exactly what pristine.mjs's
// re-baseline rule exists to survive.
export function discover() {
  const out = new Set();
  walk(path.join(HOME_BASE, '.claude', 'plugins', 'cache', MARKETPLACE), out);
  walk(path.join(HOME_BASE, '.claude', 'plugins', 'marketplaces', MARKETPLACE), out);
  return [...out];
}

// The composable pieces. The per-file loop (pristine, compose, write, restore) lives in the shared
// engine (plugin-compose.mjs) so this target composes correctly with adr-template/adr-index on a shared
// file instead of fighting them over one backup.
//
// A substitution has no partial/ambiguous state: it either has the bare prefix to rewrite or it doesn't.
// So `missing` is always empty, and this target never reports INCOMPLETE.
export function patchSource(src) {
  const next = patchOnly(src);
  return { next, applied: next === src ? [] : ['mcp-prefix'], missing: [] };
}

// Fully patched == carries OUR plugin-form output and no bare prefix remains. It must be a POSITIVE
// signal, not merely "no bare prefix": a file with no mcp refs at all trivially lacks the bare prefix,
// and the composition engine's isOurs() (which ORs every target's isPatched) would then treat every
// no-mcp file as ours and never re-baseline a genuine upstream change. Vendor plugin files use the bare
// prefix; the plugin-form appears only because we wrote it.
export const isPatched = (src) => src.includes(REPLACEMENT) && !src.includes(ANCHOR);

export const descriptor = {
  name: 'mcp-prefix',
  atomic: false,
  discover,
  patchSource,
  isPatched,
  reverse: unpatchOnly,
};
