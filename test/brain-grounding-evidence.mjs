// Recorded, unmodified Brain 4.3.28 hook fixtures: issue #316.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const sandbox = fs.realpathSync(path.resolve(process.argv[2] || fs.mkdtempSync(path.join(os.tmpdir(), 'rsp-grounding-'))));
process.env.RUFLO_SOURCE_PATCH_HOME = sandbox;
process.env.RSP_RUVNET_BRAIN_HOME = path.join(sandbox, '.cache', 'ruvnet-brain');
process.env.RSP_CODEX_HOME = path.join(sandbox, '.codex');
const patcher = await import('../lib/brain-grounding-evidence/patcher.mjs');
const compose = await import('../lib/plugin-compose.mjs');
const { VENDOR_SPECS } = await import('../lib/brain-managed-memory-boundary/transforms.mjs');
const fixtures = new URL('./fixtures/brain-grounding-evidence/', import.meta.url);
const read = (name) => fs.readFileSync(new URL(name, fixtures), 'utf8');
const pristine = read('grounding-stamp.sh');
const patched = patcher.patchSource(pristine);
assert.deepEqual(patched.missing, []);
assert.equal(patcher.isPatched(patched.next), true);
assert.equal(patcher.reverseSource(patched.next), pristine);
assert.deepEqual(patcher.patchSource(patched.next), { next: patched.next, applied: [], missing: [] });
for (const drift of [pristine.replace('mkdir -p', 'mkdir  -p'), pristine + pristine,
  patched.next.replace(': > "$DIR/search_ruvnet"', 'false # removed stamp')]) {
  const result = patcher.patchSource(drift);
  assert.equal(result.next, drift);
  assert.equal(result.missing.length, 1);
}

function write(file, source) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, source);
}
const success = 'Searched 1 RuvNet repos (ruvnet-brain).\n#1 repo=ruvnet-brain\npath : plugin/scripts/grounding-stamp.sh';
let sequence = 0;
function scenario(source, query, response = success, expectedBlocked = false, expectedStamps = ['search_ruvnet']) {
  const root = path.join(sandbox, `case-${sequence++}`);
  const stamps = path.join(root, 'grounded');
  const scripts = path.join(root, 'scripts');
  for (const name of ['grounding-turn-mark.mjs', 'ruvnet-gate1-pattern.mjs', 'hook-input.mjs']) {
    write(path.join(scripts, name), read(name));
  }
  write(path.join(scripts, 'grounding-turn-gate.mjs'), read('grounding-turn-gate.mjs')
    .replace("path.join(HOME, '.cache', 'ruvnet-brain', 'grounded')", JSON.stringify(stamps)));
  write(path.join(scripts, 'grounding-stamp.sh'), source
    .replace('DIR="$HOME/.cache/ruvnet-brain/grounded"', `DIR=${JSON.stringify(stamps)}`));
  write(path.join(scripts, 'ground-before-write.sh'), read('ground-before-write.sh')
    .replace('STAMP_DIR="$HOME/.cache/ruvnet-brain/grounded"', `STAMP_DIR=${JSON.stringify(stamps)}`));
  write(path.join(root, 'profile.json'), '{}');
  const env = { ...process.env, RUVNET_GROUNDING_TURN_DIR: path.join(root, 'turns'),
    RUVNET_EVIDENCE_FILE: path.join(root, 'no-evidence'), MODEL_ROUTER_PROFILE: path.join(root, 'profile.json'),
    RUVNET_BRAIN_STATE_DIR: path.join(root, 'state'), RUVNET_SKIP_GROUNDING_CHECK: '0' };
  function run(name, payload) {
    return spawnSync(name.endsWith('.sh') ? 'bash' : process.execPath, [path.join(scripts, name)], {
      input: JSON.stringify(payload), encoding: 'utf8', env, cwd: root, timeout: 10000,
    });
  }
  const mark = run('grounding-turn-mark.mjs', { hook_event_name: 'UserPromptSubmit', session_id: 'test', prompt: 'ruvnet-brain grounding' });
  assert.equal(mark.status, 0, mark.stderr);
  assert.equal(fs.existsSync(path.join(root, 'turns', 'test.json')), true);
  const stamp = run('grounding-stamp.sh', { tool_input: { query },
    ...(response === null ? {} : { tool_response: { content: [{ type: 'text', text: response }] } }) });
  assert.equal(stamp.status, 0, stamp.stderr);
  assert.deepEqual(fs.existsSync(stamps) ? fs.readdirSync(stamps).sort() : [], expectedStamps.sort());
  const stop = run('grounding-turn-gate.mjs', { hook_event_name: 'Stop', session_id: 'test' });
  assert.equal(stop.status, 0, stop.stderr);
  assert.equal(stop.stdout.includes('no successful'), expectedBlocked, stop.stdout);
  assert.equal(fs.existsSync(path.join(root, 'turns', 'test.json')), false, 'marker consumed');
  const writeCheck = (product) => run('ground-before-write.sh', {
    tool_name: 'Write', tool_input: { file_path: path.join(root, 'code.mjs'), content: `import '${product}';` },
  });
  assert.equal(writeCheck('agentdb').status, 2, 'generic evidence never authorizes AgentDB writes');
  assert.equal(writeCheck('ruflo').status, expectedStamps.includes('ruflo') ? 0 : 2);
  return { root, stamps, run };
}

scenario(pristine, 'ruvnet-brain grounding hooks', success, true, []); // red: vendor bug
scenario(patched.next, 'ruvnet-brain grounding hooks');
scenario(patched.next, 'agenticow API');
const card = '⚡ FAST LANE — zero-ML keyword match (named directly)\n#1  repo=ruvnet-brain  evidence=curated-capability-card\npath : ruvnet-brain/kb/capability-cards.md#ruvnet-brain\n----- grounded summary -----\nCited summary.';
scenario(pristine, 'ruvnet-brain grounding', card, true, []);
scenario(patched.next, 'ruvnet-brain grounding', card);
scenario(patched.next, 'ruflo grounding', card); // card evidence must not broaden write authorization
scenario(patched.next, 'ruvnet-brain grounding', card.replace('path : ', ''), true, []);
scenario(patched.next, 'ruvnet-brain grounding', `${card}\nsearch_ruvnet error: unavailable`, true, []);
scenario(patched.next, 'Ruflo grounding hooks', success, false, ['ruflo', 'search_ruvnet']);
for (const response of [null, '', 'unrelated response', 'RuvNet Brain is disabled', 'RUVNET BRAIN IS DOWN',
  'search_ruvnet error: unavailable', `${success}\n(no results found)`, `${success}\nRuvNet Brain is disabled`,
  `${success}\nRUVNET BRAIN IS DOWN`, `${success}\nsearch_ruvnet error: unavailable`]) {
  scenario(patched.next, 'ruvnet-brain grounding', response, true, []);
}
scenario(patched.next, '', success, true, []);
const stale = scenario(patched.next, 'ruvnet-brain grounding');
fs.utimesSync(path.join(stale.stamps, 'search_ruvnet'), new Date(0), new Date(0));
stale.run('grounding-turn-mark.mjs', { hook_event_name: 'UserPromptSubmit', session_id: 'test', prompt: 'ruvnet-brain grounding' });
assert.match(stale.run('grounding-turn-gate.mjs', { hook_event_name: 'Stop', session_id: 'test' }).stdout, /no successful/);

assert.deepEqual(patcher.discover(), [], 'no installed Brain means no target');
const brainHome = process.env.RSP_RUVNET_BRAIN_HOME;
const active = path.join(brainHome, 'versions', '4.3.28');
const cache = path.join(sandbox, '.codex/plugins/cache/ruvnet-brain/ruvnet-brain/4.3.28');
const old = path.join(brainHome, 'versions', '4.3.10');
for (const root of [active, cache, old]) {
  write(path.join(root, '.claude-plugin/plugin.json'), JSON.stringify({ name: 'ruvnet-brain', version: root === old ? '4.3.10' : '4.3.28' }));
  for (const spec of VENDOR_SPECS) write(path.join(root, spec.relative), '// vendor discovery fixture');
  write(path.join(root, 'scripts/hook-input.mjs'), read('hook-input.mjs'));
  write(path.join(root, 'scripts/grounding-stamp.sh'), pristine);
}
write(path.join(brainHome, 'active.json'), JSON.stringify({ version: '4.3.28', codeRoot: active }));
assert.equal(patcher.discover().length, 2, 'only active and matching host version');
const result = compose.applyComposed(['brain-grounding-evidence']);
assert.equal(result.errors, 0, JSON.stringify(result));
assert.equal(result.incomplete, 0);
assert.equal(result.patched, 2);
assert.deepEqual(compose.statusComposed()['brain-grounding-evidence'], { files: 2, patched: 2 });
assert.equal(compose.applyComposed(['brain-grounding-evidence']).patched, 0);
assert.equal(fs.readFileSync(path.join(old, 'scripts/grounding-stamp.sh'), 'utf8'), pristine);
const restored = compose.reconcile([], ['brain-grounding-evidence']);
assert.equal(restored.errors, 0, JSON.stringify(restored));
for (const root of [active, cache]) assert.equal(fs.readFileSync(path.join(root, 'scripts/grounding-stamp.sh'), 'utf8'), pristine);
fs.unlinkSync(path.join(cache, 'scripts/grounding-stamp.sh'));
assert.deepEqual(compose.statusComposed()['brain-grounding-evidence'], { files: 2, patched: 0 }, 'missing hook remains visible');
write(path.join(brainHome, 'active.json'), '{"version":"broken"}');
assert.throws(() => compose.statusComposed(['brain-grounding-evidence']), /valid native version and codeRoot/);
assert.doesNotThrow(() => compose.statusComposed(['brain-dual-host-stdin']), 'unrelated status does not discover invalid Brain generation');
console.log('✓ brain-grounding-evidence: pristine red; real mark→stamp→Stop green; failures/stale evidence blocked; product writes remain scoped; active-only composition and exact restore');
