// Execute notice boundaries only, with capture/store authority replaced by fixture receipts.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { spawnSync } from 'node:child_process';
import { discover } from './patcher.mjs';
import { composeSource, isOurs } from '../plugin-compose.mjs';
import { readState } from '../cwd/state.mjs';
import { existingPathRelative } from '../path-containment.mjs';

function functionSource(source, name = 'stopNotice') {
  const start = source.indexOf(`export function ${name}(`);
  const end = source.indexOf('\n}', start);
  if (start < 0 || end < 0) throw new Error('native stopNotice function absent');
  return source.slice(start, end + 2).replace('export function', 'function');
}
function boundary(source, site) {
  if (site === 'compat') {
    const comment = source.indexOf('// Compatibility entrypoint uses the same minimized transition producer');
    const start = source.indexOf('void (async () => {', comment);
    const end = source.indexOf('})();', start);
    if (comment < 0 || start < 0 || end < 0) throw new Error('native compatibility boundary absent');
    return source.slice(start, end + 5)
      .replace("await import('./project-transition-hook.mjs')", 'await Promise.resolve({ runProjectTransitionHook: fixtureTransition, transitionPendingNotice: fixturePendingNotice })');
  }
  const start = source.indexOf('if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))');
  if (start < 0) throw new Error('native direct boundary absent');
  return source.slice(start).replace('import.meta.url', JSON.stringify('file:///fixture/direct.mjs'));
}

export async function exerciseSources({ notice, compat, direct }, root) {
  const nativeConditions = notice.includes('export function conditionNotice(');
  const helpers = (nativeConditions ? functionSource(notice, 'conditionNotice') + '\n' + functionSource(direct, 'transitionPendingNotice') + '\n' : '') + functionSource(notice);
  const swarm = path.join(root, '.swarm');
  fs.mkdirSync(swarm, { recursive: true });
  const ledger = path.join(swarm, '.continuity-stop-notices.json');
  let calls = 0;
  const receipts = [];
  const captures = [];
  async function run(site, session, state = 'pending') {
    let output = '';
    const payload = { cwd: path.join(root, 'nested'), session_id: session };
    const context = vm.createContext({
      fs: { ...fs, readFileSync: (file, ...args) => file === 0 ? JSON.stringify(payload) : fs.readFileSync(file, ...args) },
      path, Date, Promise, normalizeHostEvent: payload => payload, NOTICE_STATE: '.continuity-stop-notices.json',
      recordingLine: status => `native:${status.problem}`,
      projectDirectory: () => payload.cwd,
      resolveProjectStore: () => ({ projectRoot: root, canonicalAgentDbPath: path.join(swarm, 'memory.fixture') }),
      fileURLToPath: () => '/fixture/direct.mjs',
      process: { argv: ['node', '/fixture/direct.mjs', 'PostToolUse'], env: {}, cwd: () => payload.cwd,
        stdout: { write: text => { output += text; } } },
      runProjectTransitionHook: (cwd, event, options) => {
        calls += 1;
        captures.push({ cwd, event, payload: options.payload, state });
        if (state === 'throw') throw new Error('capture fixture refusal');
        if (state === 'committed') receipts.push({ payloadDigest: 'exact', readbackDigest: 'exact' });
        return { state, receipt: state === 'committed' ? receipts.at(-1) : null };
      },
    });
    context.fixtureTransition = context.runProjectTransitionHook;
    vm.runInContext(`${helpers}\nconst fixturePendingNotice = typeof transitionPendingNotice === 'function' ? transitionPendingNotice : undefined;\n${boundary(site === 'compat' ? compat : direct, site)}`, context, { timeout: 100 });
    await new Promise(resolve => setImmediate(resolve));
    return output;
  }
  const first = await run('compat', 'same-session');
  assert.match(first, /pending; exact readback was not verified/);
  assert.equal(await run('compat', 'same-session'), '', 'same-session compatibility deferral is deduplicated');
  assert.equal(await run('direct', 'same-session'), '', 'both routes share one native condition ledger');
  assert.match(await run('direct', 'other-session'), /pending; exact AgentDB readback was not verified/);
  for (const site of ['compat', 'direct']) {
    assert.match(await run(site, 'same-session', 'throw'), /capture degraded; exact readback was not verified/);
    assert.equal(await run(site, 'same-session', 'committed'), '', 'verified result is not changed to pending');
  }
  assert.equal(calls, 8);
  assert.equal(captures.length, 8, 'deduplication never skips capture');
  assert.deepEqual(receipts, Array.from({ length: 2 }, () => ({ payloadDigest: 'exact', readbackDigest: 'exact' })));
  assert.equal(captures.every(c => c.cwd.endsWith('/nested')), true, 'capture inputs remain unchanged');
  const context = vm.createContext({ fs, path, Date, NOTICE_STATE: '.continuity-stop-notices.json',
    recordingLine: status => `native:${status.problem}` });
  vm.runInContext(`${nativeConditions ? functionSource(notice, 'conditionNotice') : ''}\n${functionSource(notice)}; globalThis.notice = stopNotice;`, context, { timeout: 100 });
  const journal = { swarm, now: Date.now };
  const status = { stuck: true, problem: 'quarantined' };
  assert.equal(context.notice({ journal, status, session: 'same-session' }), '[RuvNet Brain] native:quarantined');
  assert.equal(context.notice({ journal, status, session: 'same-session' }), '', 'old continuity deduplication is unchanged');
  assert.equal(context.notice({ journal, status: { stuck: false }, session: 'same-session' }), '');
  assert.equal(context.notice({ journal, status: { stuck: true, problem: 'corrupt' }, session: 'same-session' }), '[RuvNet Brain] native:corrupt');
  const state = JSON.parse(fs.readFileSync(ledger, 'utf8'));
  assert.deepEqual(state['same-session'].conditions, [nativeConditions ? 'project-transition-pending-readback' : 'project-transition-pending', 'quarantined', 'corrupt']);
  return { calls, captures, receipts };
}

export function probeTransitionNoticeReplacement({ files = discover(), installed = readState().pluginTargets } = {}) {
  let temporary;
  try {
    if (!files.length || files.length % 3) return { state: 'unknown', evidence: 'no complete installed transition notice bundle' };
    temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'rsp-native-transition-notice-'));
    for (let i = 0; i < files.length; i += 3) {
      const read = file => {
        const regular = candidate => {
          const st = fs.lstatSync(candidate);
          if (!st.isFile() || st.isSymbolicLink() || !st.size
              || existingPathRelative(path.dirname(path.dirname(file)), candidate) === null) throw new Error(`unsafe native source: ${candidate}`);
        };
        regular(file);
        const live = fs.readFileSync(file, 'utf8');
        if (!live.includes('ruflo-source-patch')) return live;
        if (!isOurs(live, installed)) throw new Error('untracked or foreign source ownership');
        const backup = `${file}.rsp-backup`;
        regular(backup);
        const original = fs.readFileSync(backup, 'utf8');
        if (original.includes('ruflo-source-patch') || isOurs(original, installed)
            || composeSource(original, installed) !== live) throw new Error('unproved pristine/live composition');
        return original;
      };
      const root = path.join(temporary, String(i));
      fs.mkdirSync(root);
      const fixture = path.join(root, 'sources.json');
      fs.writeFileSync(fixture, JSON.stringify({ notice: read(files[i]), compat: read(files[i + 1]), direct: read(files[i + 2]) }));
      const result = spawnSync(process.execPath, ['--input-type=module', '-e',
        `import fs from 'node:fs'; import { exerciseSources } from ${JSON.stringify(import.meta.url)};
        await exerciseSources(JSON.parse(fs.readFileSync(process.argv[1], 'utf8')), process.argv[2]);`, fixture, root],
      { encoding: 'utf8', timeout: 5000, env: { HOME: temporary, PATH: process.env.PATH || '' }, maxBuffer: 1024 * 1024 });
      if (result.error || result.status !== 0) throw new Error(result.error?.message || result.stderr || `probe exited ${result.status}`);
    }
    return { state: 'superseded', evidence: `${files.length / 3} pristine native bundles deduplicate only pending notices; both capture routes, exact fixture receipts, degraded output and native continuity notices remain intact` };
  } catch (error) { return { state: 'live', evidence: `native transition notice proof failed: ${error.message}` }; }
  finally { if (temporary) fs.rmSync(temporary, { recursive: true, force: true }); }
}
