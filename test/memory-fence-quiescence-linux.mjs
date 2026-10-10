import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { collectLinuxLegacyQuiescence as collect, verifyLinuxLegacyQuiescence as verify,
  nativeAddonThreadProof } from '../lib/cwd/memory-fence-quiescence-linux.mjs';

const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'rsp-linux-proof-fixture-')));
const artifacts = new Set();
const db = path.join(root, 'memory.db'); // No managed database is created or opened.
const fence = { dev: 1, ino: 2, uid: process.getuid(), gid: process.getgid(), mode: 16832,
  size: 4096, birthtimeMs: Date.now() - 10000, mtimeMs: 1, ctimeMs: 1 };
const thread = { tid: 123, name: 'MainThread', wait: 'ep_poll', syscall: '281',
  stack: 'ep_poll\ndo_epoll_wait\n__x64_sys_epoll_pwait' };
const owner = { pid: 123, startMs: 1, startTicks: '10', executable: '/opt/node', kind: 'node',
  isolated: false, cwd: '/fixture', entry: 'runtime.mjs', threads: [thread] };
let census, samples = 0, checks = 0, sampleOffset = 0;
const goodStack = `Thread 2 (LWP 124 "MainThread"):
#0  syscall () from /lib/libc.so.6
#1  ?? () from /package/native.node
#2  ?? () from /package/native.node
#3  ?? () from /lib/libc.so.6
#4  ?? () from /lib/libc.so.6
`;
const io = { ...fs, mkdtempSync(prefix) { const dir = fs.mkdtempSync(prefix); artifacts.add(dir); return dir; } };
const options = { io, getPlatform: () => 'linux', exec(file, args) {
  assert.equal(file, '/usr/bin/sudo');
  assert.deepEqual(args.slice(0, 3), ['-n', '/usr/bin/python3', '-c']);
  if (args[3].includes("'/usr/bin/gdb'")) {
    samples++;
    return JSON.stringify({ pid: 123, startTicks: '10', sampledAtMs: Date.now() + sampleOffset, text: goodStack });
  }
  return JSON.stringify(census);
} };
const check = (value, message) => { assert.ok(value, message); checks++; };
const fails = fn => { assert.throws(fn); checks++; };
function reset() { census = { bootId: '00000000-0000-0000-0000-000000000001', processes: [structuredClone(owner)] }; }
try {
  reset(); const evidence = collect(db, fence, options);
  check(verify(evidence, db, fence, options), 'epoll-backed native owner proof verifies');
  check(samples === 0, 'unambiguous epoll owner requires no debugger');
  census.bootId = '00000000-0000-0000-0000-000000000002'; fails(() => verify(evidence, db, fence, options));
  reset(); census.processes[0].startMs++; fails(() => verify(evidence, db, fence, options));
  reset(); census.processes.push({ ...owner, pid: 321 }); fails(() => verify(evidence, db, fence, options));
  reset(); census.processes[0].threads[0].wait = 'futex_wait_queue'; fails(() => collect(db, fence, options));
  reset(); census.processes[0].threads[0].syscall = '0'; fails(() => collect(db, fence, options));
  reset(); census.processes[0].isolated = true; census.processes[0].threads = [];
  check(collect(db, fence, options).proofs[0].kind.includes('different-mount'), 'proved inaccessible mount namespace is explicit');
  reset(); census.processes[0].threads.push({ tid: 124, name: 'MainThread', wait: 'futex_wait_queue' });
  const native = collect(db, fence, options);
  check(native.proofs[0].kind === 'native-thread-stacks' && samples === 1, 'ambiguous native thread uses one debugger sample');
  verify(native, db, fence, options); verify(native, db, fence, options);
  check(samples === 1, 'repeat identity verification reuses exact retained stack evidence');
  check(native.proofs[0].frames[0].frames.length === 5, 'verified frames embedded for durable operator receipt');
  const tamperedFrames = structuredClone(native); tamperedFrames.proofs[0].frames[0].frames.pop();
  fails(() => verify(tamperedFrames, db, fence, options));
  fs.appendFileSync(native.proofs[0].artifact, 'tampered'); fails(() => verify(native, db, fence, options));
  check(nativeAddonThreadProof(goodStack, [124]), 'complete native addon to libc root accepted');
  fails(() => nativeAddonThreadProof(goodStack, [12]));
  fails(() => nativeAddonThreadProof(goodStack.replace('LWP 124', 'LWP 1240'), [124]));
  fails(() => nativeAddonThreadProof(goodStack + 'Backtrace stopped: Cannot access memory', [124]));
  fails(() => nativeAddonThreadProof(goodStack.replace('#2  ?? () from /package/native.node', '#2 node::worker::Worker::Run()'), [124]));
  fails(() => nativeAddonThreadProof(goodStack.replace('#4  ?? () from /lib/libc.so.6', '#4  0x123 in ?? ()'), [124]));
  const poolStack = goodStack.replace('#1  ?? () from /package/native.node', '#1 uv_cond_wait (cond=...) at ../deps/uv/src/unix/thread.c:835')
    .replace('#2  ?? () from /package/native.node', '#2 node::(anonymous namespace)::PlatformWorkerThread(void*) ()');
  check(nativeAddonThreadProof(poolStack, [124]), 'native platform worker root qualifies by stack');
  fails(() => nativeAddonThreadProof(poolStack.replace('PlatformWorkerThread(void*)', 'worker::Worker::Run()'), [124]));
  reset(); census.processes[0].threads.push({ tid: 124, name: 'V8Worker', wait: 'futex_wait_queue' });
  const beforeSamples = samples; collect(db, fence, options);
  check(samples === beforeSamples + 1, 'native-looking worker name still requires stack evidence');
  sampleOffset = 60000; fails(() => collect(db, fence, options)); sampleOffset = 0;
  fails(() => verify({ ...evidence, excess: 'x'.repeat(1024 * 1024) }, db, fence, options));
  reset(); fails(() => collect(db, fence, { ...options, getPlatform: () => 'darwin' }));
  console.log(`memory-fence-quiescence-linux: ${checks} checks passed`);
} finally {
  for (const dir of artifacts) fs.rmSync(dir, { recursive: true, force: true });
  fs.rmSync(root, { recursive: true, force: true });
}
