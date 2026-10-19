// Execute the reviewed native ownership boundary in disposable files only (#420).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import crypto, { createHash } from 'node:crypto';
const retainedGeneration = '045537a05e1e4361f8f5a2a83fb2bd6166b43e88aa54618f5546e5012a0537b6';
// Independently verified against the public v4.7.14 installer, including both helpers.
const publishedHistory = '1238eeeea446bd709153d9ded087de4959d12db6e28ef86e7c0dc83216ca216f';
const proven = new Map();
export function nativeOwnershipSatisfied(source) {
  const start = source.indexOf('function legacyBrainWrapperOwnership(');
  const end = source.indexOf("\n// The bridge's previous bytes", start);
  if (start < 0 || end < 0) return false;
  const body = source.slice(start, end);
  const hash = createHash('sha256').update(body).digest('hex');
  if (![retainedGeneration, publishedHistory].includes(hash)) return false;
  if (proven.has(hash)) return proven.get(hash);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rsp-native-wrapper-'));
  try {
    const home = path.join(root, 'home'), repo = path.join(root, 'repo');
    const candidate = path.join(home, '.cache/ruvnet-brain/codex-hook.mjs');
    const shipped = path.join(repo, 'plugin/scripts/codex-hook-wrapper.mjs');
    const generation = path.join(home, '.cache/ruvnet-brain/versions/4.6.4/scripts');
    fs.mkdirSync(path.dirname(candidate), { recursive: true });
    fs.mkdirSync(path.dirname(shipped), { recursive: true });
    fs.mkdirSync(generation, { recursive: true });
    fs.writeFileSync(shipped, 'current native wrapper fixture');
    const check = (file = candidate, proc = process) => vm.runInNewContext(
      body + '\nlegacyBrainWrapperOwnership(candidate, home)',
      { fs, path, crypto, process: proc, REPO_ROOT: repo, candidate: file, home }, { timeout: 1000 }).state;
    const expect = (value, wanted) => { if (value !== wanted) throw Error(value + ' != ' + wanted); };
    expect(check(), 'absent');
    fs.writeFileSync(candidate, fs.readFileSync(shipped)); expect(check(), 'verified');
    fs.writeFileSync(candidate, 'genuine prior fixture'); expect(check(), 'conflict');
    fs.writeFileSync(path.join(generation, 'codex-hook-wrapper.mjs'), fs.readFileSync(candidate));
    expect(check(), 'prior-generation');
    if (hash === publishedHistory) {
      // A pruned generation is proven by committed public history, never a marker.
      fs.unlinkSync(path.join(generation, 'codex-hook-wrapper.mjs'));
      const historyFile = path.join(repo, 'data/codex-hook-wrapper-history.json');
      const row = { sha256: createHash('sha256').update(fs.readFileSync(candidate)).digest('hex'),
        bytes: fs.statSync(candidate).size, tags: ['v4.5.16'] };
      const history = { schemaVersion: 1, kind: 'ruvnet-brain-codex-hook-wrapper-history', wrappers: [row] };
      fs.mkdirSync(path.dirname(historyFile), { recursive: true });
      const writeHistory = value => fs.writeFileSync(historyFile, JSON.stringify(value));
      writeHistory(history); expect(check(), 'prior-release');
      for (const change of [{ bytes: row.bytes + 1 }, { sha256: '0'.repeat(64) }, { tags: ['untrusted'] }]) {
        writeHistory({ ...history, wrappers: [{ ...row, ...change }] }); expect(check(), 'conflict');
      }
      writeHistory({ ...history, schemaVersion: 2 }); expect(check(), 'conflict');
      fs.writeFileSync(historyFile, '{'); expect(check(), 'conflict');
      writeHistory(history);
    }
    expect(check(path.join(root, 'foreign')), 'conflict');
    expect(check(candidate, { getuid: () => -1 }), 'conflict');
    fs.appendFileSync(candidate, ' edited'); expect(check(), 'conflict');
    fs.writeFileSync(candidate, 'genuine prior fixture');
    fs.linkSync(candidate, path.join(root, 'hardlink')); expect(check(), 'conflict');
    fs.unlinkSync(candidate); fs.symlinkSync(shipped, candidate); expect(check(), 'conflict');
    fs.unlinkSync(candidate); fs.mkdirSync(candidate); expect(check(), 'conflict');
    fs.rmdirSync(candidate); fs.writeFileSync(candidate, 'genuine prior fixture');
    const namespace = path.dirname(candidate), moved = path.join(root, 'moved');
    fs.renameSync(namespace, moved); fs.symlinkSync(moved, namespace); expect(check(), 'conflict');
    proven.set(hash, true); return true;
  } catch { proven.set(hash, false); return false; }
  finally { fs.rmSync(root, { recursive: true, force: true }); }
}
