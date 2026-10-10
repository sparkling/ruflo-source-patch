import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { collectLegacyQuiescence, verifyLegacyQuiescence } from '../lib/cwd/memory-fence-quiescence.mjs';

const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'rsp-quiescence-test-')));
const uid = process.getuid(), pid = 111;
const start = 'Fri Oct  9 22:00:00 2026';
const fence = { dev: 1, ino: 2, uid, gid: process.getgid(), mode: 0o40700, size: 64,
  birthtimeMs: Date.parse('2026-10-09T23:15:13Z'), mtimeMs: 1, ctimeMs: 1 };
const database = path.join(root, 'memory.db');
const header = `Process: node [111]\nLaunch Time: 2026-10-09 23:00:00.000 +0100\nDate/Time: 2026-10-10 17:00:00.000 +0100\nCall graph:\n`;
const idle = `    90 Thread_1 DispatchQueue_1: com.apple.main-thread (serial)
    + 90 node::Start(int, char**)
    + 90 node::NodeMainInstance::Run()
    + 90 node::SpinEventLoopInternal(node::Environment*)
    + 90 uv_run
    + 90 uv__io_poll
    + 90 kevent
`;
let sample = header + idle, extra = false, calls = 0, source;
const artifacts = [];
const exec = (file, args) => {
  if (file.endsWith('/sysctl')) return '77E731A9-BDE4-4F73-8D0C-BFB02F6657AD\n';
  if (file.endsWith('/ps') && args.includes('args=')) return `/usr/bin/node ${source} PostToolUse`;
  if (file.endsWith('/ps')) return `-2 7 1 ${start} system-daemon\n${uid} 111 1 ${start} renamed-node-title\n${extra ? `${uid} 112 1 ${start} node\n` : ''}`;
  if (file.endsWith('/lsof') && args.includes('txt'))
    return `p111\nn/usr/local/bin/node\n${extra ? 'p112\nn/usr/local/bin/node\n' : ''}`;
  if (file.endsWith('/lsof')) return 'p111\nf0\ntunix\nnstdin\n';
  if (file.endsWith('/sample')) { calls++; fs.writeFileSync(args.at(-1), sample); artifacts.push(path.dirname(args.at(-1))); return ''; }
  throw new Error('unexpected fixture command ' + file);
};
const options = { exec, getPlatform: () => 'darwin' };
let checks = 0;
const check = (condition, label) => { assert.ok(condition, label); checks++; };
const refuse = (fn, pattern = /refused/) => { assert.throws(fn, pattern); checks++; };
try {
  const evidence = collectLegacyQuiescence(database, fence, options);
  check(evidence.processes[0].kind === 'node', 'actual executable detects renamed Node process');
  check(evidence.proofs[0].disposition === 'native-event-loop-idle', 'root event-loop sample proves synchronous recovery exited');
  check(verifyLegacyQuiescence(evidence, database, fence, options), 'unchanged exact evidence verifies');
  check(calls === 1, 'verification uses existing sample rather than resampling');
  refuse(() => verifyLegacyQuiescence({ ...evidence, processes: [] }, database, fence, options), /inventory changed/);
  refuse(() => verifyLegacyQuiescence({ ...evidence, proofs: [] }, database, fence, options), /missing proof/);
  refuse(() => verifyLegacyQuiescence(evidence, database, { ...fence, ino: 3 }, options), /fence, host/);
  const fabricated = structuredClone(evidence); fabricated.proofs[0].disposition = 'fabricated-idle';
  refuse(() => verifyLegacyQuiescence(fabricated, database, fence, options), /sample or source evidence changed/);
  extra = true;
  refuse(() => verifyLegacyQuiescence(evidence, database, fence, options), /inventory changed/);
  extra = false;
  fs.appendFileSync(evidence.proofs[0].artifact, 'changed');
  refuse(() => verifyLegacyQuiescence(evidence, database, fence, options), /artifact changed/);
  sample = header + idle + `    90 Thread_2 WorkerThread
    + 90 node::worker::Worker::Run()
    + 90 Builtins_InterpreterEntryTrampoline
    + 90 read
`;
  refuse(() => collectLegacyQuiescence(database, fence, options), /unproved worker isolate/);
  sample = header + idle + '    90 Thread_2: WorkerThread\n    + 90 unresolvedNativeFrame\n';
  refuse(() => collectLegacyQuiescence(database, fence, options), /unresolved worker isolate/);
  for (const frame of ['Builtins_InterpreterEntryTrampoline', 'v8::Execution::Call']) {
    sample = header + idle + `    90 Thread_2: custom-worker\n    + 90 ${frame}\n`;
    refuse(() => collectLegacyQuiescence(database, fence, options), /unclassified JavaScript isolate/);
  }
  const embedded = { ...options, exec(file, args) {
    return file.endsWith('/lsof') && args.includes('txt') ? 'p111\nn/custom/host\nn/usr/lib/libnode.dylib\n' : exec(file, args);
  } };
  refuse(() => collectLegacyQuiescence(database, fence, embedded), /unreviewed embedded Node/);
  sample = header + idle.replace('node::SpinEventLoopInternal(node::Environment*)', 'unknown::Run()');
  refuse(() => collectLegacyQuiescence(database, fence, options), /unproved main isolate/);
  sample = header.replace('2026-10-10 17:00:00.000', '2026-10-09 22:30:00.000') + idle;
  refuse(() => collectLegacyQuiescence(database, fence, options), /predates fence/);

  const scripts = path.join(root, '.cache/ruvnet-brain/versions/4.5.16/scripts');
  fs.mkdirSync(scripts, { recursive: true }); source = path.join(scripts, 'session-snapshot-hook.mjs');
  fs.writeFileSync(source, `const payload = JSON.parse(fs.readFileSync(0, 'utf8') || '{}');\nconst result = runProjectTransitionHook(projectDir, process.argv[2], { payload });`);
  fs.writeFileSync(path.join(scripts, 'project-progression-store.mjs'), 'return spawnSync(invocation.executable, invocation.args, { ...options, shell: false });');
  sample = header + `    90 Thread_1 DispatchQueue_1: com.apple.main-thread (serial)
    + 90 node::fs::ReadFileUtf8
    + 90 read
`;
  const stdin = collectLegacyQuiescence(database, fence, options);
  check(stdin.proofs[0].sources.length === 2, 'stdin exclusion is bound to exact external-writer source');
  fs.appendFileSync(source, '\nchanged');
  refuse(() => verifyLegacyQuiescence(stdin, database, fence, options), /sample or source evidence changed/);
  const blockedOptions = { ...options, exec(file, args) {
    return file.endsWith('/lsof') && !args.includes('txt') ? 'p111\nf14\ntREG\nnclaim\n' : exec(file, args);
  } };
  refuse(() => collectLegacyQuiescence(database, fence, blockedOptions), /regular data descriptor/);
  console.log(`memory-fence-quiescence: ${checks} checks passed`);
} finally {
  for (const directory of new Set(artifacts)) fs.rmSync(directory, { recursive: true, force: true });
  fs.rmSync(root, { recursive: true, force: true });
}
