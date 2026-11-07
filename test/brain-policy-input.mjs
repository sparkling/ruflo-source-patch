import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { SPECS, patchSource, reverseSource, isPatched } from '../lib/brain-policy-input/patcher.mjs';

const reader = cap => `INPUT=""; _l=""
while IFS= read -r -t 2 _l; do
  INPUT+="$_l"
  [ \${#INPUT} -ge ${cap} ] && break
done
[ -n "$_l" ] && INPUT+="$_l"
INPUT="\${INPUT:0:${cap}}"
printf '%s' "$INPUT"`;
const run = (source, input, env = process.env) => spawnSync('/bin/bash', ['-c', source],
  { input, env, encoding: 'utf8', timeout: 5000, maxBuffer: 2 ** 22 });
for (const cap of [32768, 65536]) {
  const source = reader(cap), patched = patchSource(source);
  assert.deepEqual(patched.missing, []);
  assert(isPatched(patched.next));
  assert.equal(reverseSource(patched.next), source);
  assert.equal(patchSource(patched.next).next, patched.next);
  assert(patchSource(source + '\n' + source).missing.length);
  assert(patchSource(source.replace('-ge ' + cap, '-ge 7')).missing.length);
  for (const input of ['', 'hello', 'a\nb\nc', 'x'.repeat(cap), 'x'.repeat(cap + 1234),
    ...['é', '漢', '🙂'].flatMap(character => [0, 1, 2, 3, 4].map(offset =>
      'x'.repeat(offset) + character.repeat(cap + 10))),
    JSON.stringify({ content: '\\"é🙂'.repeat(18000), file_path: '/tmp/never-written' })]) {
    const before = run(source, input), after = run(patched.next, input);
    assert.equal(before.status, 0, before.stderr);
    assert.equal(after.status, 0, after.stderr);
    assert(after.stdout === before.stdout,
      `native prefix changed: cap=${cap}, input=${input.length}, before=${Buffer.byteLength(before.stdout)}, after=${Buffer.byteLength(after.stdout)}`);
  }
}

// The host need not close stdin. After the UTF-8-safe read bound the patched
// reader must exit; the old reader waits for newline/EOF/deadline instead.
async function openPipe(source) {
  const child = spawn('/bin/bash', ['-c', source], { stdio: ['pipe', 'pipe', 'pipe'] });
  let output = '', error = '';
  child.stdout.on('data', b => { output += b; });
  child.stderr.on('data', b => { error += b; });
  child.stdin.on('error', () => {});
  const closed = new Promise(resolve => child.once('close', code => resolve({ code, output, error })));
  child.stdin.write('x'.repeat(300000));
  const early = await Promise.race([closed, new Promise(resolve => setTimeout(() => resolve(null), 800))]);
  if (!early) child.stdin.end();
  return { early, result: await closed };
}
assert.equal((await openPipe(reader(65536))).early, null, 'mutation: old loop waits beyond cap');
const bounded = await openPipe(patchSource(reader(65536)).next);
assert(bounded.early, 'counted reader completes while pipe remains open');
assert.equal(bounded.result.output, 'x'.repeat(65536));

// Exercise the actual installed consent guard as an inert subprocess. The guard
// only inspects an event; no tool dispatcher or application write is involved.
const nativeHome = path.join(os.homedir(), '.cache/ruvnet-brain');
if (fs.existsSync(path.join(nativeHome, 'active.json'))) {
const active = JSON.parse(fs.readFileSync(path.join(nativeHome, 'active.json'), 'utf8'));
const scripts = path.join(nativeHome, active.codeRoot || `versions/${active.version}`, 'scripts');
for (const spec of SPECS) {
  const native = reverseSource(fs.readFileSync(path.join(scripts, spec.relative.split('/').at(-1)), 'utf8'));
  assert.deepEqual(patchSource(native).missing, [], spec.relative);
  assert.equal(reverseSource(patchSource(native).next), native);
}
const consent = patchSource(fs.readFileSync(path.join(scripts, 'protect-brain-state.sh'), 'utf8')).next;
const denied = run(consent, JSON.stringify({ tool_name: 'Write', tool_input: {
  file_path: path.join(os.homedir(), '.config/ruvnet-brain/settings.json'), content: 'x'.repeat(900000),
} }));
assert.equal(denied.status, 2, denied.stderr);
assert.match(denied.stderr, /BLOCKED/);
const allowed = run(consent, JSON.stringify({ tool_name: 'Write', tool_input: {
  file_path: '/tmp/rsp-policy-test-not-written.txt', content: 'x'.repeat(900000),
} }));
assert.equal(allowed.status, 0, allowed.stderr);
const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'rsp-policy-guard-'));
try {
  const profile = path.join(sandbox, 'profile.json');
  fs.writeFileSync(profile, '{}');
  const ground = patchSource(fs.readFileSync(path.join(scripts, 'ground-before-write.sh'), 'utf8')).next;
  const ungrounded = run(ground, JSON.stringify({ tool_name: 'Write', tool_input: {
    file_path: '/tmp/rsp-policy-test-not-written.mjs', content: "import x from 'ruvector';" + 'x'.repeat(900000),
  } }), { ...process.env, HOME: sandbox, MODEL_ROUTER_PROFILE: profile,
    RUVNET_BRAIN_STATE_DIR: path.join(sandbox, 'state'), RUVNET_SKIP_GROUNDING_CHECK: '0' });
  assert.equal(ungrounded.status, 2, ungrounded.stderr);
  assert.match(ungrounded.stderr, /ruvector/);
} finally { fs.rmSync(sandbox, { recursive: true, force: true }); }
} else {
  console.log('Native installed-policy checks unavailable; portable reader tests only.');
}
console.log('PASS bounded policy input: exact prefixes, open pipe, native consent refusal/allow');
