// Read-only macOS proof for the installed, cooperating Ruflo Node protocol.
// This is not a claim about arbitrary hostile code running as the same UID.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { MEMORY_LOCK_SOURCE as LEGACY_SOURCE } from './memory-lock-source-v1.mjs';
import { collectLinuxLegacyQuiescence, verifyLinuxLegacyQuiescence } from './memory-fence-quiescence-linux.mjs';

const schema = 'rsp-legacy-quiescence/v1';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const fail = reason => { throw new Error(`legacy quiescence refused: ${reason}`); };
const identity = st => Object.fromEntries(['dev', 'ino', 'uid', 'gid', 'mode', 'size',
  'birthtimeMs', 'mtimeMs', 'ctimeMs'].map(key => [key, st[key]]));
const run = (file, args) => execFileSync(file, args, {
  encoding: 'utf8', timeout: 15000, maxBuffer: 8 * 1024 * 1024, env: { ...process.env, TZ: 'UTC' },
});
const idle = /node::SpinEventLoopInternal[^\n]*\n[^\n]*uv_run[^\n]*\n[^\n]*uv__io_poll[^\n]*\n[^\n]*kevent/;
const platform = () => process.platform;

function boot(exec) {
  const id = exec('/usr/sbin/sysctl', ['-n', 'kern.bootsessionuuid']).trim();
  if (!/^[0-9a-f-]{36}$/i.test(id)) fail('boot identity unavailable');
  return id;
}

function inventory(cutoff, exec) {
  const rows = [];
  const lines = exec('/bin/ps', ['-axo', 'uid=,pid=,ppid=,lstart=,comm=']).trim().split('\n');
  for (const line of lines) {
    const m = line.match(/^\s*(-?\d+)\s+(\d+)\s+(\d+)\s+(.{24})\s+(.+)$/);
    if (!m) fail('unparsed process inventory');
    const [, uid, pid, ppid, started, command] = m;
    const startMs = Date.parse(started + ' UTC');
    if (!Number.isFinite(startMs)) fail('unparsed process start time');
    if (Number(uid) === process.getuid() && startMs <= cutoff + 1000)
      rows.push({ pid: Number(pid), ppid: Number(ppid), startMs, command });
  }
  if (!rows.length || rows.length > 2048) fail('process inventory empty or unbounded');
  const images = new Map();
  let pid;
  const result = exec('/usr/sbin/lsof', ['-a', '-p', rows.map(r => r.pid).join(','), '-d', 'txt', '-F', 'pn']);
  for (const line of result.split('\n')) {
    if (/^p\d+$/.test(line)) { pid = Number(line.slice(1)); images.set(pid, []); }
    else if (line.startsWith('n') && images.has(pid)) images.get(pid).push(line.slice(1));
  }
  return rows.map(row => {
    const mapped = images.get(row.pid);
    if (!mapped?.length || !path.isAbsolute(mapped[0])) fail(`executable unresolved for PID ${row.pid}`);
    const executable = mapped[0];
    const name = path.basename(executable);
    if (name !== 'node' && mapped.some(p => path.basename(p) === 'node' || /\/libnode[^/]*\.(dylib|so)/.test(p)))
      fail(`unreviewed embedded Node executable ${executable}`);
    const kind = name === 'node' ? 'node' : name === 'node_repl' ? 'proxy'
      : ['bun', 'deno'].includes(name) ? 'unsupported-js' : 'outside-installed-node-protocol';
    if (kind === 'unsupported-js') fail(`unreviewed JavaScript runtime ${executable}`);
    // Electron applications and compiled Claude hosts are NOT classified as unable
    // to run JS. They are outside this installed Node MCP/CLI launch contract;
    // Claude's configured external Node children are inventoried independently.
    // Do not extend this collector to inline/embedded Ruflo installations unchanged.
    return { ...row, executable, kind, embeddedElectron: mapped.some(p => p.includes('Electron Framework')),
      scope: kind === 'outside-installed-node-protocol' ? 'not-an-installed-ruflo-node-owner' : 'node-runtime-inspected' };
  }).sort((a, b) => a.pid - b.pid);
}

function sourceRecord(file, io) {
  const stat = io.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 1024 * 1024) fail('source identity unavailable');
  const bytes = io.readFileSync(file);
  return { path: file, sha256: sha(bytes), bytes: bytes.toString('utf8') };
}

function stdinSource(pid, exec, io) {
  const argv = exec('/bin/ps', ['-p', String(pid), '-o', 'args=']).trim();
  const m = argv.match(/^\S+\s+(\S+\/scripts\/session-snapshot-hook\.mjs)\s+(PostToolUse|PreToolUse|UserPromptSubmit|PostToolUseFailure|SubagentStop)$/);
  if (!m || !m[1].includes('/.cache/ruvnet-brain/versions/')) fail(`unproved synchronous read in PID ${pid}`);
  const source = sourceRecord(m[1], io);
  const store = sourceRecord(path.join(path.dirname(m[1]), 'project-progression-store.mjs'), io);
  if (!source.bytes.includes("const payload = JSON.parse(fs.readFileSync(0, 'utf8') || '{}');")
    || !source.bytes.includes('const result = runProjectTransitionHook(projectDir, process.argv[2], { payload });')
    || !store.bytes.includes('return spawnSync(invocation.executable, invocation.args, { ...options, shell: false });'))
    fail('Brain stdin/external-writer source contract changed');
  // The legacy recovery keeps its regular claim descriptor until its finally block.
  // A read sample followed by no regular data descriptor excludes a retained claim read;
  // a completed recovery cannot reenter while the unchanged fence remains present.
  const descriptors = exec('/usr/sbin/lsof', ['-nP', '-p', String(pid), '-F', 'ftn']);
  let data = false;
  for (const line of descriptors.split('\n')) {
    if (line.startsWith('f')) data = /^f\d/.test(line);
    if (data && line === 'tREG') fail(`regular data descriptor remains in PID ${pid}`);
  }
  return [source, store].map(({ bytes, ...record }) => record);
}

function sampleProof(row, text, exec, io) {
  const pidMatch = text.match(/^Process:\s+.*\[(\d+)\]/m);
  const launch = text.match(/^Launch Time:\s+(.+)$/m);
  const sampled = text.match(/^Date\/Time:\s+(.+)$/m);
  if (!pidMatch || Number(pidMatch[1]) !== row.pid || !launch || !sampled
    || Math.abs(Date.parse(launch[1]) - row.startMs) >= 1000) fail('sample process identity mismatch');
  const graph = text.split('Call graph:\n')[1]?.split('\nTotal number')[0];
  if (!graph) fail('sample call graph absent');
  const threads = graph.split(/(?=^    \d+ Thread_)/m).filter(b => /^    \d+ Thread_/.test(b));
  const main = threads.find(b => b.includes('com.apple.main-thread'));
  if (!main) fail('sample main thread absent');
  const workers = threads.filter(b => b.includes('node::worker::Worker::Run'));
  if (threads.some(b => b !== main && !workers.includes(b)
    && /Builtins_|v8::(?:internal::)?Execution::|node::(?:StartExecution|LoadEnvironment)/.test(b)))
    fail(`unclassified JavaScript isolate in PID ${row.pid}`);
  if (threads.some(b => /Thread_\d+: WorkerThread/.test(b) && !b.includes('node::worker::Worker::Run')))
    fail(`unresolved worker isolate in PID ${row.pid}`);
  if (workers.some(b => !idle.test(b))) fail(`unproved worker isolate in PID ${row.pid}`);
  let disposition = 'native-event-loop-idle', sources = [];
  if (row.kind === 'proxy') {
    if (/node::|v8::/.test(graph)) fail('proxy contains unreviewed native JavaScript frames');
    disposition = 'rust-proxy-no-node-isolate';
  } else if (!idle.test(main)) {
    if (main.includes('node::SyncProcessRunner::Spawn')) disposition = 'external-child-launcher-wait';
    else if (main.includes('node::fs::ReadFileUtf8')) {
      sources = stdinSource(row.pid, exec, io);
      disposition = 'brain-stdin-before-external-writer';
    } else fail(`unproved main isolate in PID ${row.pid}`);
  }
  return { disposition, sampledAt: sampled[1], launchTime: launch[1], sources,
    // These exact parsed stacks remain in the durable recovery intent/receipt.
    stacks: [main, ...workers].join('\n') };
}

function settings(options) {
  return { io: options.io || fs, exec: options.exec || run, getPlatform: options.getPlatform || platform };
}

export function collectLegacyQuiescence(databasePath, fenceStat, options = {}) {
  const { io, exec, getPlatform } = settings(options);
  if (getPlatform() === 'linux') return collectLinuxLegacyQuiescence(databasePath, fenceStat, options);
  if (getPlatform() !== 'darwin') fail('macOS collector required');
  if (!path.isAbsolute(databasePath) || !Number.isFinite(fenceStat.birthtimeMs)) fail('invalid fence input');
  const startBoot = boot(exec), fence = identity(fenceStat);
  const before = inventory(fenceStat.birthtimeMs, exec);
  const directory = io.mkdtempSync(path.join(os.tmpdir(), 'rsp-legacy-quiescence-'));
  io.chmodSync(directory, 0o700);
  const proofs = [];
  for (const row of before) {
    if (row.kind === 'outside-installed-node-protocol') continue;
    const artifact = path.join(directory, `${row.pid}.sample.txt`);
    exec('/usr/bin/sample', [String(row.pid), '1', '10', '-file', artifact]);
    io.chmodSync(artifact, 0o600);
    const bytes = io.readFileSync(artifact);
    if (bytes.length > 2 * 1024 * 1024) fail('sample exceeds bounded proof size');
    proofs.push({ pid: row.pid, artifact, sha256: sha(bytes), ...sampleProof(row, bytes.toString('utf8'), exec, io) });
  }
  const evidence = { schema, databasePath, fence, bootId: startBoot, uid: process.getuid(),
    protocolSha256: sha(LEGACY_SOURCE), collectedAt: new Date().toISOString(), processes: before, proofs };
  if (Buffer.byteLength(JSON.stringify(evidence)) > 1024 * 1024) fail('evidence exceeds 1MiB');
  verifyLegacyQuiescence(evidence, databasePath, fenceStat, options);
  return evidence;
}

export function verifyLegacyQuiescence(evidence, databasePath, fenceStat, options = {}) {
  const { io, exec, getPlatform } = settings(options);
  if (getPlatform() === 'linux') return verifyLinuxLegacyQuiescence(evidence, databasePath, fenceStat, options);
  if (getPlatform() !== 'darwin' || evidence?.schema !== schema || evidence.databasePath !== databasePath
    || evidence.uid !== process.getuid() || evidence.bootId !== boot(exec)
    || evidence.protocolSha256 !== sha(LEGACY_SOURCE) || !isDeepStrictEqual(evidence.fence, identity(fenceStat)))
    fail('fence, host, boot or protocol changed');
  const current = inventory(fenceStat.birthtimeMs, exec);
  const previous = new Map(evidence.processes.map(row => [row.pid, row]));
  if (previous.size !== evidence.processes.length) fail('duplicate process evidence');
  for (const row of current) {
    if (!isDeepStrictEqual(previous.get(row.pid), row)) fail(`older process inventory changed at PID ${row.pid}`);
    if (row.kind === 'outside-installed-node-protocol') continue;
    const proof = evidence.proofs.find(p => p.pid === row.pid);
    if (!proof) fail(`missing proof for PID ${row.pid}`);
    const st = io.lstatSync(proof.artifact);
    if (!st.isFile() || st.isSymbolicLink() || st.uid !== process.getuid() || (st.mode & 0o777) !== 0o600
      || st.size > 2 * 1024 * 1024) fail('sample artifact ownership changed');
    const bytes = io.readFileSync(proof.artifact);
    if (sha(bytes) !== proof.sha256) fail('sample artifact changed');
    const parsed = sampleProof(row, bytes.toString('utf8'), exec, io);
    const { pid, artifact, sha256, ...expected } = proof;
    if (!isDeepStrictEqual(parsed, expected)) fail(`sample or source evidence changed for PID ${row.pid}`);
    const sampledAt = Date.parse(parsed.sampledAt);
    if (!(sampledAt > fenceStat.birthtimeMs) || sampledAt > Date.now()) fail('sample predates fence or is in the future');
  }
  return true;
}
