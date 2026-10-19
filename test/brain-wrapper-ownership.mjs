import { nativeOwnershipSatisfied } from '../lib/brain-wrapper-ownership/native.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import vm from 'node:vm';
import { patchSource, reverseSource, HASHES } from '../lib/brain-wrapper-ownership/patcher.mjs';

const fixture = name => fs.readFileSync(new URL('./fixtures/brain-wrapper-ownership/' + name, import.meta.url));
const native = fixture('native-4.7.6.mjs').toString() + "\n// The bridge's previous bytes";
assert.equal(nativeOwnershipSatisfied(native), true);
assert.deepEqual(patchSource(native), { next: native, applied: [], missing: [] });
assert.equal(nativeOwnershipSatisfied(native.replace('stat.nlink !== 1', 'false')), false);
const modern = fixture('native-4.7.14.mjs').toString() + "\n// The bridge's previous bytes";
assert.equal(nativeOwnershipSatisfied(modern), true);
assert.deepEqual(patchSource(modern), { next: modern, applied: [], missing: [] });
for (const [before, after] of [['stat.nlink !== 1', 'false'], ['row.bytes === bytes.length', 'true'],
  ["return { state: 'prior-release', release: past.tags[past.tags.length - 1] }", "return { state: 'conflict' }"]]) {
  assert(modern.includes(before));
  assert.equal(nativeOwnershipSatisfied(modern.replace(before, after)), false);
}
const source = fixture('ownership.mjs').toString();
const patched = patchSource(source);
assert.deepEqual(patched.missing, []);
assert.equal(reverseSource(patched.next), source);
assert.equal(patchSource(patched.next).next, patched.next);
assert(patchSource(source + source).missing.length);
assert(patchSource(source.replace('stat.nlink !== 1', 'false')).missing.length);
assert(patchSource(patched.next.replace('stat.nlink !== 1', 'false')).missing.length);
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rsp-wrapper-ownership-'));
try {
  const home = path.join(root, 'home'), repo = path.join(root, 'package');
  const bridge = path.join(home, '.cache/ruvnet-brain/codex-hook.mjs');
  fs.mkdirSync(path.dirname(bridge), { recursive: true });
  fs.mkdirSync(path.join(repo, 'plugin/scripts'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'plugin/scripts/codex-hook-wrapper.mjs'), fixture('wrapper-4.6.1.mjs'));
  const check = (body = patched.next, candidate = bridge, overrides = {}) => vm.runInNewContext(
    body + '\nlegacyBrainWrapperOwnership(candidate, home)',
    { fs, path, crypto, process, REPO_ROOT: repo, candidate, home, ...overrides }, { timeout: 1000 });
  assert.equal(check().state, 'absent');
  for (const [i, version] of ['4.5.16', '4.6.1'].entries()) {
    const bytes = fixture('wrapper-' + version + '.mjs');
    assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), HASHES[i]);
    fs.writeFileSync(bridge, bytes);
    assert.equal(check().state, 'verified');
    assert.equal(check(source).state, version === '4.5.16' ? 'conflict' : 'verified');
    fs.appendFileSync(bridge, '\n// edited');
    assert.equal(check().state, 'conflict');
  }
  fs.writeFileSync(bridge, fixture('wrapper-4.5.16.mjs'));
  const before = fs.readFileSync(bridge);
  assert.equal(check().state, 'verified');
  assert.deepEqual(fs.readFileSync(bridge), before, 'ownership proof never writes bridge');
  assert.equal(check(patched.next, path.join(root, 'wrong-path')).state, 'conflict');
  assert.equal(check(patched.next, bridge, { process: { getuid: () => -1 } }).state, 'conflict');
  const linked = path.join(root, 'linked');
  fs.linkSync(bridge, linked);
  assert.equal(check().state, 'conflict');
  fs.unlinkSync(bridge);
  fs.symlinkSync(linked, bridge);
  assert.equal(check().state, 'conflict');
  fs.unlinkSync(bridge);
  fs.mkdirSync(bridge);
  assert.equal(check().state, 'conflict');
  fs.rmdirSync(bridge);
  const namespace = path.dirname(bridge), moved = path.join(root, 'moved');
  fs.renameSync(namespace, moved);
  fs.symlinkSync(moved, namespace);
  assert.equal(check().state, 'conflict');
  console.log('Brain #420: native old-wrapper refusal reproduced; exact historical/current hashes accepted; edited/path/owner/link/directory/namespace conflicts retained; reversible guarded transform PASS');
} finally { fs.rmSync(root, { recursive: true, force: true }); }
