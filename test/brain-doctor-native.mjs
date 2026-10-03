// Execute the modern doctor classifiers and the native one-verdict reducer.
// All receipts and fake listeners live in a temporary sandbox; no managed database is opened.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import http from 'node:http';
import * as consolePatch from '../lib/brain-console-lifecycle/patcher.mjs';
import * as releasePatch from '../lib/brain-release-lockstep/patcher.mjs';
import { doctorVerdict } from './fixtures/brain-doctor-verdict.mjs';

const check = (name, condition) => { if (!condition) throw new Error(name); };
const source = fs.readFileSync(new URL('./fixtures/brain-doctor-4.5.2.txt', import.meta.url), 'utf8');
const consoleResult = consolePatch.patchSource(source);
const releaseResult = releasePatch.patchSource(source);
for (const [name, owner, result] of [
  ['console', consolePatch, consoleResult], ['release', releasePatch, releaseResult],
]) {
  check(name + ' current native anchors', result.missing.length === 0);
  check(name + ' exact reverse', owner.reverseSource(result.next) === source);
  check(name + ' idempotent', owner.patchSource(result.next).next === result.next);
  check(name + ' evidence', owner.isPatched(result.next));
}
const both = releasePatch.patchSource(consoleResult.next);
check('both modern doctor owners compose', !both.missing.length
  && consolePatch.isPatched(both.next) && releasePatch.isPatched(both.next));
const reverseOrder = consolePatch.patchSource(releaseResult.next);
check('both composition orders produce identical bytes', reverseOrder.next === both.next);
check('both exact reverse', consolePatch.reverseSource(releasePatch.reverseSource(both.next)) === source);

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'rsp-native-doctor-'));
const savedHome = process.env.RUVNET_BRAIN_HOME;
let listener;
try {
  process.env.RUVNET_BRAIN_HOME = temp;
  fs.writeFileSync(path.join(temp, 'active.json'), '{"version":"4.5.2"}\n');
  const classifier = releaseResult.next.slice(releaseResult.next.indexOf('function checkVersionDrift('),
    releaseResult.next.indexOf('/**\n * ruflo-source-patch (stuinfla/ruvnet-brain#77): shared'));
  const factory = new Function('fs', 'os', 'path', 'installedBrainVersion', 'PACKAGE_VERSION',
    'wrapperVersion', 'codexPluginStatus', classifier + '\nreturn checkVersionDrift;');
  const makeState = (bundle, pkg, claude, codex) => factory(fs, os, path, () => bundle, pkg,
    () => claude, () => ({ installed: true, version: codex }))('/unused');
  const state = makeState('v4.5.2', '4.5.2', '4.5.2', '4.5.2');
  check('equal v-prefix versions converge', !state.drift);
  const split = makeState('v4.5.2', '4.5.2', '4.5.2', '4.5.1');
  check('one stale host is detected', split.drift);
  const checkLine = (id, label, failed, detail, fix) => ({ id, label, state: failed ? 'fail' : 'ok', detail, fix });
  const releaseLine = releaseResult.next.slice(releaseResult.next.indexOf("    check('release-lockstep'"),
    releaseResult.next.indexOf("    check('identity'"));
  const lines = new Function('versionState', 'check', 'return [' + releaseLine + '];');
  check('native verdict and exit reject drift', doctorVerdict({ lines: [] }, lines(split, checkLine)).exitCode === 1);
  check('native verdict accepts matched versions', doctorVerdict({ lines: [] }, lines(state, checkLine)).exitCode === 0);
  check('deleting modern verdict invalidates release evidence', !releasePatch.isPatched(
    releaseResult.next.replace(releaseLine, '')));

  const cache = path.join(temp, 'kb'), entry = path.join(cache, '.console-runtime', 'scripts', 'onboarding-console.mjs');
  fs.mkdirSync(path.dirname(entry), { recursive: true });
  // This inspector isolates the doctor's native-inspector wiring from network/provider setup.
  listener = http.createServer((request, response) => {
    response.end(request.url === '/api/runtime' ? JSON.stringify({ product: 'ruvnet-brain-console' }) : 'RuvNet Brain');
  });
  await new Promise((resolve) => listener.listen(0, '127.0.0.1', resolve));
  const listenerPort = listener.address().port;
  fs.writeFileSync(entry, `export async function inspectConsoleRuntime({cwd}) {
    if (cwd.endsWith('stale-project')) return { state: 'stale-running' };
    if (cwd.endsWith('foreign-project')) return { state: 'foreign-port' };
    if (cwd.endsWith('legacy-project')) return { state: 'foreign-port', port: ${listenerPort} };
    return { state: 'not-running' };
  }`);
  const start = consoleResult.next.indexOf('async function consoleRuntimeStatus(');
  const end = consoleResult.next.indexOf('// ── `--doctor`:', start);
  const helper = consoleResult.next.slice(start, end);
  const inspect = new Function('fs', 'path', 'os', 'pathToFileURL', helper + '\nreturn consoleRuntimeStatus;')(
    fs, path, os, pathToFileURL);
  check('native stopped console is healthy', (await inspect(cache)).healthy);
  const receiptDir = path.join(temp, 'console-instances'); fs.mkdirSync(receiptDir);
  const receipt = path.join(receiptDir, 'receipt.json');
  fs.writeFileSync(receipt, JSON.stringify({ product: 'ruvnet-brain-console', schema: 1,
    scope: path.join(temp, 'stale-project') }));
  const stale = await inspect(cache);
  check('stale live console is detected', !stale.healthy && stale.state === 'stale-running');
  const consoleLine = consoleResult.next.slice(consoleResult.next.indexOf("    check('console-runtime'"));
  const lineEnd = consoleLine.indexOf("'Launch /rvbc to activate the current runtime safely'),")
    + "'Launch /rvbc to activate the current runtime safely'),".length;
  const consoleLines = new Function('consoleRuntime', 'check', 'return [' + consoleLine.slice(0, lineEnd) + '];');
  check('native verdict rejects stale console', doctorVerdict({ lines: [] }, consoleLines(stale, checkLine)).exitCode === 1);
  fs.writeFileSync(receipt, JSON.stringify({ product: 'ruvnet-brain-console', schema: 1,
    scope: path.join(temp, 'foreign-project') }));
  check('foreign port remains preserved', (await inspect(cache)).healthy);
  fs.writeFileSync(receipt, JSON.stringify({ product: 'ruvnet-brain-console', schema: 1,
    scope: path.join(temp, 'legacy-project') }));
  const legacy = await inspect(cache);
  check('unreceipted Brain listener is not called healthy', !legacy.healthy && legacy.state === 'legacy-unowned');
  await new Promise((resolve) => listener.close(resolve));
  fs.writeFileSync(receipt, '{');
  check('malformed receipt fails closed', !(await inspect(cache)).healthy);
  fs.unlinkSync(entry);
  // A new entry path prevents the module cache from turning a missing runtime into success.
  check('missing runtime fails closed', !(await inspect(path.join(temp, 'missing-kb'))).healthy);
  const syntax = spawnSync(process.execPath, ['--input-type=module', '--check'], {
    input: helper, encoding: 'utf8', timeout: 5000,
  });
  check('generated modern helper parses', syntax.status === 0);
  console.log('✔ native Brain doctor: exact composition/reverse, real verdict exit, drift, live inspector and conservative failures');
} finally {
  listener?.closeAllConnections(); listener?.close();
  if (savedHome === undefined) delete process.env.RUVNET_BRAIN_HOME;
  else process.env.RUVNET_BRAIN_HOME = savedHome;
  fs.rmSync(temp, { recursive: true, force: true });
}
