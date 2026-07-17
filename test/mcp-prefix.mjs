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

// ── PR: POISONED-BACKUP RECOVERY (the real bug: a whole-plugin backup wipe left mcp-prefix's own
// edits genuinely applied but unrecoverable, and — because the composed engine correctly refuses to
// touch a file it cannot verify — permanently blocked adr-template's still-pending edit on the SAME
// file. Measured live: 294 files, and the adr-template test suite's own P1 case among them). ──

// PR1: mcp-prefix ALONE, backup poisoned (emptied) after a real patch — recovery must reconstruct
// the true pristine via reverse + round-trip, restore the backup, and leave the (already-correct)
// live file untouched. Uninstall afterward must restore byte-identical TRUE vendor, proving the
// recovered pristine was not merely plausible but exactly right.
const pr1 = write(path.join(CACHE, 'ruflo-pr1', '0.1.0', 'x.md'), 'call mcp__claude-flow__memory_store twice: mcp__claude-flow__memory_store\n');
const pr1Vendor = read(pr1);
applyComposed(['mcp-prefix']);
check('PR1a mcp-prefix patched pr1 normally', read(pr1).includes('mcp__plugin_ruflo-core_ruflo__memory_store') && !read(pr1).includes('mcp__claude-flow__'));
fs.writeFileSync(bak(pr1), ''); // simulate the backup-wipe event
const pr1Before = read(pr1);
const a2 = applyComposed(['mcp-prefix']);
check('PR1b no skip:poisoned-backup reported once recovery succeeds', !a2.log.some((l) => l.includes('skip:poisoned-backup') && l.includes('/ruflo-pr1/')));
check('PR1c a recovered-pristine line was logged', a2.log.some((l) => l.startsWith('recovered-pristine') && l.includes('/ruflo-pr1/')));
check('PR1d the live file is untouched (it was already correctly patched)', read(pr1) === pr1Before);
check('PR1e the backup now holds the TRUE original vendor bytes, not a guess', fs.existsSync(bak(pr1)) && read(bak(pr1)) === pr1Vendor);
reconcile([], ['mcp-prefix']);
check('PR1f uninstall from the RECOVERED backup restores byte-identical true vendor', read(pr1) === pr1Vendor);

// PR2: the ACTUAL measured bug. mcp-prefix has already patched a file adr-template ALSO claims but has
// NOT yet edited (adr-template's anchor is still the buggy, unpatched form). Backup poisoned. Recovery
// must unblock adr-template's pending edit on the SAME apply, exactly like the real adr-create/SKILL.md.
const SKILL2 = path.join(CACHE, 'ruflo-adr', '0.4.2', 'skills', 'adr-create', 'SKILL.md');
const skill2Vendor = '# adr-create\n\n'
  + '   - **Status**: proposed\n'
  + "   - **Date**: <today's date YYYY-MM-DD>\n"
  + '   - **Deciders**: <leave blank for author to fill>\n'
  + '   - **Tags**: <leave blank>\n\n'
  + 'Then call mcp__claude-flow__memory_store.\n';
write(SKILL2, skill2Vendor);
applyComposed(['mcp-prefix']); // mcp-prefix alone first — adr-template not installed yet, matches the real timeline
check('PR2a mcp-prefix alone patched refs, adr-template edits absent', read(SKILL2).includes('mcp__plugin_ruflo-core_ruflo__memory_store') && read(SKILL2).includes('   - **Status**: proposed'));
fs.writeFileSync(bak(SKILL2), ''); // the backup-wipe event
const c3 = applyComposed(['adr-template', 'mcp-prefix']); // NOW both are installed, matching real state
check('PR2b adr-template applied=true, not stuck behind the poisoned backup (this IS the measured P1 bug)', read(SKILL2).includes('   **Status**: proposed') && !read(SKILL2).includes('   - **Status**: proposed'));
check('PR2c mcp-prefix refs remain correctly rewritten', read(SKILL2).includes('mcp__plugin_ruflo-core_ruflo__memory_store'));
check('PR2d recovered-pristine logged for SKILL2', c3.log.some((l) => l.startsWith('recovered-pristine') && l.includes('/adr-create/SKILL.md') && l.includes('0.4.2')));
check('PR2e the recovered backup is the TRUE vendor bytes (buggy status form, bare mcp prefix)', read(bak(SKILL2)) === skill2Vendor);
reconcile([], ['adr-template', 'mcp-prefix']);
check('PR2f uninstalling both restores byte-identical TRUE vendor', read(SKILL2) === skill2Vendor);

// PR3: TWO targets have ALREADY applied to the same file (genuinely ambiguous — which one would
// un-compose first?) and the backup is poisoned. Recovery must REFUSE, not guess; the ordinary
// skip:poisoned-backup report fires and the live file is left exactly as it was.
const SKILL3 = path.join(CACHE, 'ruflo-adr', '0.4.3', 'skills', 'adr-create', 'SKILL.md');
const skill3Vendor = skill2Vendor;
write(SKILL3, skill3Vendor);
applyComposed(['adr-template', 'mcp-prefix']); // BOTH apply this time — both isPatched() become true
check('PR3a fixture: both targets genuinely applied', read(SKILL3).includes('   **Status**: proposed') && read(SKILL3).includes('mcp__plugin_ruflo-core_ruflo__'));
const skill3Patched = read(SKILL3);
fs.writeFileSync(bak(SKILL3), '');
const a3 = applyComposed(['adr-template', 'mcp-prefix']);
check('PR3b two-claimant poisoning is REFUSED, not guessed at', a3.log.some((l) => l.startsWith('skip:poisoned-backup') && l.includes('0.4.3')));
check('PR3c no recovered-pristine line for this file', !a3.log.some((l) => l.startsWith('recovered-pristine') && l.includes('0.4.3')));
check('PR3d the live file is untouched — no wrong bytes written', read(SKILL3) === skill3Patched);

// PR4: resolvePristine's round-trip safety net itself, tested directly against the `{candidate,
// verify}` contract — proves the guarantee holds regardless of what any future target's `reverse`
// might return, not just mcp-prefix's (which is provably well-behaved and can't easily be coaxed
// into producing a bad candidate through the real engine).
{
  const { resolvePristine } = await import('../lib/pristine.mjs');

  // PR4a — a WRONG candidate (verify does not reproduce current): refused, never silently accepted.
  const pr4a = write(path.join(SANDBOX, 'pr4a-standalone.txt'), 'AAA\n');
  const patchFn = (s) => s.replace('AAA', 'BBB');
  fs.writeFileSync(pr4a, patchFn('AAA\n'));
  const ra = resolvePristine(pr4a, patchFn, {
    isOurs: (src) => src.includes('BBB'),
    recoverPoisoned: () => ({ candidate: 'WRONG GUESS\n', verify: (c) => patchFn(c) }), // won't reproduce current
  });
  check('PR4a a candidate whose verify does not reproduce current is REFUSED (poisoned), never silently accepted', ra.poisoned === true && ra.pristine === null && !ra.recovered);

  // PR4b — a CORRECT candidate, verified with a NARROWLY-SCOPED function (not the full patchFn):
  // accepted. This is exactly the shape plugin-compose.mjs relies on — verify scoped to only the
  // transform that actually produced `current`, which can differ from the full active composition.
  const pr4b = write(path.join(SANDBOX, 'pr4b-standalone.txt'), 'AAA\n');
  fs.writeFileSync(pr4b, patchFn('AAA\n'));
  const rb = resolvePristine(pr4b, patchFn, {
    isOurs: (src) => src.includes('BBB'),
    recoverPoisoned: () => ({ candidate: 'AAA\n', verify: (c) => patchFn(c) }), // reproduces current exactly
  });
  check('PR4b a candidate whose scoped verify DOES reproduce current is ACCEPTED and backed up', rb.recovered === true && rb.pristine === 'AAA\n' && fs.readFileSync(`${pr4b}.rsp-backup`, 'utf8') === 'AAA\n');

  // PR4c — recoverPoisoned returns a bare string (old contract) or omits verify: treated as no
  // candidate. The contract is {candidate, verify} or null — nothing else is trusted.
  const pr4c = write(path.join(SANDBOX, 'pr4c-standalone.txt'), 'AAA\n');
  fs.writeFileSync(pr4c, patchFn('AAA\n'));
  const rc = resolvePristine(pr4c, patchFn, {
    isOurs: (src) => src.includes('BBB'),
    recoverPoisoned: () => 'AAA\n', // bare string — not the {candidate, verify} shape
  });
  check('PR4c a bare-string return (not {candidate, verify}) is treated as no recovery offered', rc.poisoned === true && !rc.recovered);
}

if (fail) { console.log('\n✘ test/mcp-prefix.mjs FAILED'); process.exit(1); }
console.log('\n✓ mcp-prefix + composition: all checks passed');
