// Behavioural tests for mcp-prefix and the plugin COMPOSITION engine (ruvnet/ruflo#2685, ADR-020).
//
// ADR-016 discipline: drive the REAL engine against a real (sandboxed) plugin tree, assert on observed
// file bytes — never grep the source. The sandbox is a throwaway HOME set via RUFLO_SOURCE_PATCH_HOME
// BEFORE any lib module is imported, because paths.mjs reads it at module load.

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const SANDBOX = process.argv[2] || fs.mkdtempSync(path.join(os.tmpdir(), 'mcpx-'));
process.env.RUFLO_SOURCE_PATCH_HOME = SANDBOX;
process.env.RSP_NO_SELF_UPDATE = '1';

const { applyComposed, reconcile, statusComposed } = await import('../lib/plugin-compose.mjs');
const { descriptor: mcpDescriptor } = await import('../lib/mcp-prefix/patcher.mjs');

let fail = 0;
const check = (desc, cond) => { console.log(`${cond ? '✓' : '✘'} ${desc}`); if (!cond) fail = 1; };

const CACHE = path.join(SANDBOX, '.claude', 'plugins', 'cache', 'ruflo');
const MKT = path.join(SANDBOX, '.claude', 'plugins', 'marketplaces', 'ruflo', 'plugins');
const write = (p, s) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, s); return p; };
const read = (p) => fs.readFileSync(p, 'utf8');
const bak = (p) => `${p}.rsp-backup`;

// ── MX1: mcp-prefix alone rewrites every ref; leaves other servers alone; idempotent; restores ──
const agent = write(path.join(CACHE, 'ruflo-swarm', '0.2.0', 'agents', 'architect.md'),
  'allowed-tools: mcp__claude-flow__*\nCall mcp__claude-flow__agent_spawn then mcp__claude-flow__memory_store.\nmcp__ruv-swarm__init and mcp__plugin_ruflo-core_ruflo__task_orchestrate stay.\n');
const agentVendor = read(agent);

const a1 = applyComposed(['mcp-prefix']);
check('MX1a apply patched the agent file', a1.patched >= 1);
check('MX1b every mcp__claude-flow__ became the plugin form',
  !read(agent).includes('mcp__claude-flow__') && read(agent).includes('mcp__plugin_ruflo-core_ruflo__agent_spawn') && read(agent).includes('mcp__plugin_ruflo-core_ruflo__*'));
check('MX1c a different server prefix (mcp__ruv-swarm__) is untouched', read(agent).includes('mcp__ruv-swarm__init'));
check('MX1d an already-plugin-form ref is not double-prefixed', !read(agent).includes('mcp__plugin_ruflo-core_ruflo__plugin_'));
check('MX1e backup created', fs.existsSync(bak(agent)));
check('MX1f idempotent (second apply patches 0)', applyComposed(['mcp-prefix']).patched === 0);
const s1 = statusComposed();
check('MX1g status: mcp-prefix reports the file patched', s1['mcp-prefix'].files >= 1 && s1['mcp-prefix'].patched === s1['mcp-prefix'].files);
const r1 = reconcile([], ['mcp-prefix']);
check('MX1h uninstall restored byte-identical vendor', read(agent) === agentVendor && !fs.existsSync(bak(agent)));

// ── MX-COMPOSE: adr-template AND mcp-prefix on ONE file, from ONE pristine (the whole point) ──
// A real adr-create/SKILL.md that carries BOTH adr-template's status bullet AND mcp tool refs.
const SKILL = path.join(CACHE, 'ruflo-adr', '0.4.0', 'skills', 'adr-create', 'SKILL.md');
const skillVendor = '# adr-create\n\n'
  + '   - **Status**: proposed\n'
  + "   - **Date**: <today's date YYYY-MM-DD>\n"
  + '   - **Deciders**: <leave blank for author to fill>\n'
  + '   - **Tags**: <leave blank>\n\n'
  + 'Then call mcp__claude-flow__memory_store and mcp__claude-flow__agentdb_pattern-store.\n';
write(SKILL, skillVendor);

const c1 = applyComposed(['adr-template', 'mcp-prefix']);
check('C1 both targets composed onto the shared file (patched)', c1.patched >= 1 && c1.incomplete === 0);
check('C2 adr-template applied: the status bullet is stripped', read(SKILL).includes('   **Status**: proposed') && !read(SKILL).includes('   - **Status**: proposed'));
check('C3 mcp-prefix applied: refs rewritten', read(SKILL).includes('mcp__plugin_ruflo-core_ruflo__memory_store') && !read(SKILL).includes('mcp__claude-flow__'));
check('C4 there is ONE backup and it is the true vendor pristine', fs.existsSync(bak(SKILL))
  && read(bak(SKILL)) === skillVendor
  && read(bak(SKILL)).includes('   - **Status**: proposed') && read(bak(SKILL)).includes('mcp__claude-flow__'));
const cs = statusComposed();
check('C5 status: both targets report the shared file patched',
  cs['adr-template'].patched >= 1 && cs['mcp-prefix'].patched >= 1);

// uninstall mcp-prefix ONLY — adr-template's edit must survive, mcp's must revert, from the same pristine
const c2 = reconcile(['adr-template'], ['mcp-prefix']);
check('C6 after removing mcp-prefix: status bullet STILL stripped (adr-template intact)', read(SKILL).includes('   **Status**: proposed') && !read(SKILL).includes('   - **Status**'));
check('C7 after removing mcp-prefix: refs reverted to the bare prefix', read(SKILL).includes('mcp__claude-flow__memory_store') && !read(SKILL).includes('mcp__plugin_ruflo-core_ruflo__'));
check('C8 the backup is still the vendor pristine (never corrupted)', read(bak(SKILL)) === skillVendor);

// uninstall the rest — byte-identical vendor restore
reconcile([], ['adr-template']);
check('C9 fully uninstalled: SKILL.md is byte-identical vendor, backup gone', read(SKILL) === skillVendor && !fs.existsSync(bak(SKILL)));

// ── MX-NOHIJACK: mcp-prefix must NOT claim a sibling target's file that has no mcp refs ──
// This is the exact bug: a file with a .rsp-backup but no mcp refs must not be discovered/hijacked.
const sibling = write(path.join(CACHE, 'ruflo-adr', '0.4.0', 'scripts', 'import.mjs'),
  "const key = 'x'; // adr-index territory, zero mcp refs\n");
fs.writeFileSync(bak(sibling), 'VENDOR PRISTINE OWNED BY ANOTHER TARGET\n'); // simulate adr-index's backup
const discovered = mcpDescriptor.discover();
check('NH1 mcp-prefix does NOT discover a no-mcp file even though it has a .rsp-backup', !discovered.includes(sibling));
applyComposed(['mcp-prefix']);
check('NH2 the sibling backup is left untouched (not re-baselined/corrupted)', read(bak(sibling)) === 'VENDOR PRISTINE OWNED BY ANOTHER TARGET\n');

// ── MX-REBASELINE: an in-place /plugin update is patched, not reverted to a stale backup (R3 class) ──
const upd = write(path.join(CACHE, 'ruflo-x', '0.1.0', 'u.md'), 'v1 mcp__claude-flow__old\n');
applyComposed(['mcp-prefix']);
fs.writeFileSync(upd, 'v2 NEW mcp__claude-flow__fresh\n'); // simulate /plugin update overwriting in place
applyComposed(['mcp-prefix']);
check('RB1 the NEW upstream content is patched', read(upd).includes('mcp__plugin_ruflo-core_ruflo__fresh') && read(upd).includes('v2 NEW'));
check('RB2 the stale v1 backup did not clobber the update', !read(upd).includes('v1 '));

if (fail) { console.log('\n✘ test/mcp-prefix.mjs FAILED'); process.exit(1); }
console.log('\n✓ mcp-prefix + composition: all checks passed');
