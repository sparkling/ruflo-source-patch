// Execute only reviewed native classifier bodies against in-memory files and receipts.
import assert from 'node:assert/strict';
import path from 'node:path';
import { createHash } from 'node:crypto';

export function exerciseNativeDoctor({ sources, doctorChecks }) {
  const files = new Map();
  const fakeFs = { readFileSync(file, encoding) {
    if (!files.has(file)) throw Object.assign(Error('fixture absent'), { code: 'ENOENT' });
    const bytes = Buffer.from(files.get(file));
    return encoding ? bytes.toString(encoding) : bytes;
  } };
  const factory = new Function('fs', 'path', 'createHash', 'PACKAGE_VERSION', 'HOST_LABELS',
    Object.values(sources).join('\n')
    + '\nreturn { inspectInstalledBrain, classifyHostConvergence, doctorVerdict };');
  const native = factory(fakeFs, path, createHash, '4.7.28', { codex: 'Codex', claude: 'Claude' });
  const [adapter, ...calls] = doctorChecks;
  const assembleChecks = new Function('installedIdentity', 'hostConvergence',
    adapter + '\nreturn [' + calls.join('\n') + '];');
  const verdict = (installedIdentity, hostConvergence) => native.doctorVerdict({ lines: [] },
    assembleChecks(installedIdentity, hostConvergence));
  const identity = bytes => ({ bytes: Buffer.byteLength(bytes), sha256: createHash('sha256').update(bytes).digest('hex') });
  const root = path.resolve('/rsp-native-doctor-fixture');
  const put = (file, value) => files.set(path.join(root, file), typeof value === 'string' ? value : JSON.stringify(value));
  function seed(version = '4.7.28') {
    files.clear();
    put('SOURCE.json', { brainVersion: version, releaseTag: `v${version}`, corpusReleaseTag: 'corpus-sha256-' + 'a'.repeat(64) });
    const names = ['forge-mcp-all.mjs', 'forge-ask-all.mjs', 'forge-rerank.mjs', 'card-lane.mjs', 'coverage-integrity.mjs'];
    const rows = names.map(name => { put(name, `// inert ${name}`); return { path: name, ...identity(files.get(path.join(root, name))) }; });
    put('RUNTIME-IDENTITY.json', { schemaVersion: 1, kind: 'ruvnet-brain-installed-runtime', brainVersion: version,
      executables: { 'coverage-integrity.mjs': identity(files.get(path.join(root, 'coverage-integrity.mjs'))) } });
    put('ARCHIVE-MANIFEST.json', { kind: 'ruvnet-brain-archive-manifest', version, files: rows });
  }
  let assertions = 0;
  const check = (label, actual, expected) => { assert.equal(actual, expected, label); assertions++; };
  const receipt = () => ({ desiredVersion: '4.7.28', hosts: { codex: { state: 'ready', version: '4.7.28' } }, consoleRuntime: { state: 'ready' } });
  const checkIdentity = (label, expected, packageVersion = '4.7.28') => {
    const actual = native.inspectInstalledBrain(root, packageVersion);
    check(label, actual.healthy, expected);
    check(label + ' assembled verdict', verdict(actual, native.classifyHostConvergence(receipt())).exitCode, expected ? 0 : 1);
  };
  const checkHosts = (label, row, expected) => {
    const actual = native.classifyHostConvergence(row);
    check(label, actual.healthy, expected);
    check(label + ' assembled verdict', verdict(native.inspectInstalledBrain(root, '4.7.28'), actual).exitCode, expected ? 0 : 1);
  };
  seed();
  checkIdentity('coherent native identity', true);
  check('content-addressed corpus remains separate', native.inspectInstalledBrain(root, '4.7.28').corpusTag, 'corpus-sha256-' + 'a'.repeat(64));
  checkIdentity('coherent engine ahead of caller is valid', true, '4.7.27');
  checkIdentity('engine behind caller fails', false, '4.7.29');
  for (const name of ['SOURCE.json', 'RUNTIME-IDENTITY.json', 'ARCHIVE-MANIFEST.json', 'forge-mcp-all.mjs', 'coverage-integrity.mjs']) {
    seed(); files.delete(path.join(root, name));
    checkIdentity('missing ' + name, false);
  }
  for (const name of ['forge-mcp-all.mjs', 'coverage-integrity.mjs']) {
    seed(); put(name, '// changed executable');
    checkIdentity('changed ' + name, false);
  }
  seed(); put('SOURCE.json', { brainVersion: '4.7.28', releaseTag: 'v4.7.27' });
  checkIdentity('contradictory source identity', false);
  seed();
  checkHosts('ready hosts', receipt(), true);
  const ahead = receipt(); ahead.desiredVersion = ahead.hosts.codex.version = '4.7.29';
  checkHosts('ahead hosts and receipt', ahead, true);
  for (const state of ['disabled', 'absent']) {
    const row = receipt(); row.hosts.codex = { state };
    checkHosts(state + ' host preserved', row, true);
  }
  const open = receipt(); Object.assign(open.hosts.codex, { restartRequired: true, restartScope: 'open-sessions' });
  checkHosts('proven open-session-only restart', open, true);
  open.hosts.codex.restartScope = 'unproven';
  checkHosts('unproven boot surface', open, false);
  for (const change of [row => { row.desiredVersion = '4.7.27'; }, row => { row.hosts.codex.version = '4.7.27'; },
    row => { row.hosts.codex.state = 'pending'; }, row => { row.consoleRuntime.state = 'pending'; }]) {
    const row = receipt(); change(row);
    checkHosts('native convergence defect', row, false);
  }
  checkHosts('missing receipt', null, false);
  check('currency warnings do not fail doctor', native.doctorVerdict({ lines: [{ id: 'hosts', state: 'warn' }] },
    assembleChecks(native.inspectInstalledBrain(root, '4.7.28'), native.classifyHostConvergence(receipt()))).exitCode, 0);
  return { assertions };
}
