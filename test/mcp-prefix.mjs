// Behavioural tests for the `mcp-prefix` plugin target (ruvnet/ruflo#2685).
//
// ADR-016 discipline: drive the REAL patcher against a real (sandboxed) plugin tree, assert on
// observed file bytes — never grep the source — and mutation-test each guard (remove the guard,
// confirm the test fails). The sandbox is a throwaway HOME set via RUFLO_SOURCE_PATCH_HOME BEFORE
// the patcher is imported, because paths.mjs reads it at module load.

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const SANDBOX = process.argv[2] || fs.mkdtempSync(path.join(os.tmpdir(), 'mcpx-'));
process.env.RUFLO_SOURCE_PATCH_HOME = SANDBOX;
process.env.RSP_NO_SELF_UPDATE = '1';

const { apply, restore, status, patchOnly, discover } = await import('../lib/mcp-prefix/patcher.mjs');

let fail = 0;
const check = (desc, cond) => {
  console.log(`${cond ? '✓' : '✘'} ${desc}`);
  if (!cond) fail = 1;
};

const CACHE = path.join(SANDBOX, '.claude', 'plugins', 'cache', 'ruflo');
const MKT = path.join(SANDBOX, '.claude', 'plugins', 'marketplaces', 'ruflo', 'plugins');
const write = (p, s) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, s); return p; };
const read = (p) => fs.readFileSync(p, 'utf8');
const backup = (p) => `${p}.rsp-backup`;

// ── MX1: rewrites every occurrence across cache + marketplace; leaves other servers alone ──
const agentFile = write(path.join(CACHE, 'ruflo-swarm', '0.2.0', 'agents', 'architect.md'),
  'allowed-tools: mcp__claude-flow__*\nCall mcp__claude-flow__agent_spawn then mcp__claude-flow__memory_store.\nmcp__ruv-swarm__init and mcp__plugin_ruflo-core_ruflo__task_orchestrate stay.\n');
const mktFile = write(path.join(MKT, 'ruflo-core', 'skills', 'x', 'SKILL.md'),
  'Use mcp__claude-flow__swarm_init.\n');
const jsonFile = write(path.join(CACHE, 'ruflo-goals', '0.2.0', 'settings.json'),
  '{"permissions":{"allow":["mcp__claude-flow__memory_usage"]}}\n');

const a1 = apply();
check('MX1a apply patched all three files', a1.patched === 3);
check('MX1b every mcp__claude-flow__ in the agent file became the plugin form',
  !read(agentFile).includes('mcp__claude-flow__')
  && read(agentFile).includes('mcp__plugin_ruflo-core_ruflo__agent_spawn')
  && read(agentFile).includes('mcp__plugin_ruflo-core_ruflo__*'));
check('MX1c a DIFFERENT server prefix (mcp__ruv-swarm__) is untouched',
  read(agentFile).includes('mcp__ruv-swarm__init'));
check('MX1d an already-plugin-form ref is not double-prefixed',
  read(agentFile).includes('mcp__plugin_ruflo-core_ruflo__task_orchestrate')
  && !read(agentFile).includes('mcp__plugin_ruflo-core_ruflo__plugin_'));
check('MX1e the marketplace copy is patched too', !read(mktFile).includes('mcp__claude-flow__'));
check('MX1f the JSON permission entry is patched', read(jsonFile).includes('mcp__plugin_ruflo-core_ruflo__memory_usage'));

// ── MX2: idempotent — a second apply changes nothing ──
const a2 = apply();
check('MX2 second apply patches 0 (idempotent)', a2.patched === 0);
check('MX2b patchOnly is a fixed point on its own output', patchOnly(read(agentFile)) === read(agentFile));

// ── MX3: backup + byte-identical restore ──
check('MX3a a .rsp-backup was created', fs.existsSync(backup(agentFile)));
const s1 = status();
check('MX3b status reports all discovered files patched', s1.files >= 3 && s1.patched === s1.files);
const originalAgent = read(backup(agentFile));
const r1 = restore();
check('MX3c restore restored files', r1.restored >= 3);
check('MX3d the file is byte-identical to the vendor original', read(agentFile) === originalAgent
  && read(agentFile).includes('mcp__claude-flow__agent_spawn'));
check('MX3e the backup is removed after restore', !fs.existsSync(backup(agentFile)));

// ── MX4: only text files under the ruflo trees; nothing outside, no binaries ──
write(path.join(SANDBOX, '.claude', 'plugins', 'cache', 'other-mkt', 'p', '1.0', 'a.md'),
  'mcp__claude-flow__agent_spawn\n'); // different marketplace — must be ignored
write(path.join(CACHE, 'ruflo-x', '0.1.0', 'logo.png'), 'mcp__claude-flow__not_a_ref\n'); // wrong extension
const discovered = discover();
check('MX4a a non-ruflo marketplace is out of scope',
  !discovered.some((f) => f.includes('other-mkt')));
check('MX4b a non-text file is not discovered', !discovered.some((f) => f.endsWith('.png')));

// ── MX5 (mutation of the R1a/R4 class): a POISONED (empty) backup never truncates the file ──
const poison = write(path.join(CACHE, 'ruflo-y', '0.1.0', 'p.md'), 'mcp__plugin_ruflo-core_ruflo__x already ours\n');
fs.writeFileSync(backup(poison), ''); // empty backup = poison
const before = read(poison);
apply();
check('MX5a apply does not truncate a file with an empty backup', read(poison) === before && read(poison).length > 0);
const rp = restore();
fs.existsSync(poison) && check('MX5b restore does not truncate from an empty backup', read(poison).length > 0);

// ── MX6 (re-baseline, R3 class): an in-place /plugin update is patched, not reverted to stale backup ──
const upd = write(path.join(CACHE, 'ruflo-z', '0.1.0', 'u.md'), 'v1 mcp__claude-flow__old\n');
apply(); // patches v1, writes backup
check('MX6a v1 patched', !read(upd).includes('mcp__claude-flow__') && read(upd).includes('mcp__plugin_ruflo-core_ruflo__old'));
// simulate /plugin update rewriting the file in place with NEW upstream bytes carrying the bare prefix
fs.writeFileSync(upd, 'v2 NEW mcp__claude-flow__fresh\n');
apply(); // must re-baseline off the new bytes and patch THEM, not restore stale v1
check('MX6b the NEW upstream content is patched', read(upd).includes('mcp__plugin_ruflo-core_ruflo__fresh'));
check('MX6c the stale v1 backup did not clobber the update', read(upd).includes('v2 NEW') && !read(upd).includes('v1 '));

if (fail) { console.log('\n✘ test/mcp-prefix.mjs FAILED'); process.exit(1); }
console.log('\n✓ mcp-prefix: all checks passed');
