// Read-only Linux proof for installed, cooperating Node owners; not hostile embedded JS.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { MEMORY_LOCK_SOURCE as LEGACY_SOURCE } from './memory-lock-source-v1.mjs';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const fail = reason => { throw new Error(`Linux legacy quiescence refused: ${reason}`); };
const identity = st => Object.fromEntries(['dev', 'ino', 'uid', 'gid', 'mode', 'size',
  'birthtimeMs', 'mtimeMs', 'ctimeMs'].map(key => [key, st[key]]));
const helper = String.raw`import os,sys,json
uid=int(sys.argv[1]);cut=float(sys.argv[2]);db=sys.argv[3];gate=db+'.rsp-lock.recovery'
boot=open('/proc/sys/kernel/random/boot_id').read().strip()
btime=int(next(x.split()[1] for x in open('/proc/stat') if x.startswith('btime ')))
ticks=os.sysconf('SC_CLK_TCK');rows=[]
def read(p):
 with open(p) as f:return f.read(1048576)
def mounts(pid):
 return [x.split() for x in read('/proc/'+str(pid)+'/mountinfo').splitlines()]
def below(p,r):return p==r or p.startswith(r.rstrip('/')+'/')
host=mounts('self');ownns=os.readlink('/proc/self/ns/mnt');st=os.lstat(gate)
device=str(os.major(st.st_dev))+':'+str(os.minor(st.st_dev))
hm=max((m for m in host if below(gate,m[4])),key=lambda m:len(m[4]))
fsPath=os.path.normpath(hm[3]+'/'+os.path.relpath(gate,hm[4]))
for n in os.listdir('/proc'):
 if not n.isdigit():continue
 p='/proc/'+n
 try:
  if os.stat(p).st_uid!=uid:continue
  s=read(p+'/stat').rsplit(')',1)[1].split();start=(btime+int(s[19])/ticks)*1000
  if start>cut+1000 or s[0]=='Z':continue
  exe=os.readlink(p+'/exe');kind='node' if os.path.basename(exe)=='node' else 'outside-installed-node-protocol'
  if os.path.basename(exe) in ['node_repl','bun','deno']:raise RuntimeError('unreviewed runtime '+exe)
  if kind!='node' and 'libnode' in read(p+'/maps'):raise RuntimeError('embedded libnode '+exe)
  row={'pid':int(n),'startMs':start,'startTicks':s[19],'executable':exe,'kind':kind}
  if kind=='node':
   row['mountNamespace']=os.readlink(p+'/ns/mnt');ms=mounts(n)
   row['isolated']=row['mountNamespace']!=ownns and not os.path.lexists(p+'/root'+gate) and not any(m[2]==device and below(fsPath,m[3]) for m in ms)
   row['cwd']=os.readlink(p+'/cwd');row['threads']=[]
   argv=open(p+'/cmdline','rb').read(16384).split(b'\0')
   row['entry']=next((x.decode() for x in argv[1:] if x.endswith((b'.js',b'.mjs',b'.cjs'))),'')
   if not row['isolated']:
    for t in os.listdir(p+'/task'):
     td=p+'/task/'+t;comm=read(td+'/comm').strip();wait=read(td+'/wchan').strip()
     r={'tid':int(t),'name':comm,'wait':wait}
     if wait=='ep_poll':r['stack']=read(td+'/stack');r['syscall']=read(td+'/syscall').split()[0]
     row['threads'].append(r)
   row['threads'].sort(key=lambda x:x['tid'])
  rows.append(row)
 except FileNotFoundError:
  if os.path.exists(p):raise
rows.sort(key=lambda x:x['pid'])
print(json.dumps({'bootId':boot,'processes':rows}))
`;
// Copies library FILE images, never inferior memory, into a temporary debugger sysroot.
// This handles long-lived processes whose mapped libc predates the installed libc.
const stackHelper = String.raw`import os,sys,json,tempfile,shutil,subprocess,time
pid=int(sys.argv[1]);p='/proc/'+str(pid)
def start():return open(p+'/stat').read().rsplit(')',1)[1].split()[19]
before=start();root=tempfile.mkdtemp(prefix='rsp-native-symbols-',dir='/tmp');seen=set();total=0
try:
 for line in open(p+'/maps'):
  a=line.split()
  if len(a)<6:continue
  name=a[5]
  if not name.startswith('/') or '..' in name.split('/') or not any(x in name for x in ('.so','.node')) or name in seen:continue
  seen.add(name);source=p+'/map_files/'+a[0];size=os.stat(source).st_size;total+=size
  if size>134217728 or total>268435456 or len(seen)>128:raise RuntimeError('unbounded library images')
  target=root+name;os.makedirs(os.path.dirname(target),exist_ok=True);shutil.copyfile(source,target)
 for alias in ['/lib','/lib64']:
  if os.path.islink(alias) and not os.path.lexists(root+alias):
   os.symlink(os.path.relpath(root+os.path.realpath(alias),root),root+alias)
 args=['/usr/bin/gdb','-nx','-nh','--batch']
 for cmd in ['set auto-load off','set debuginfod enabled off','set pagination off','set print frame-arguments none','file '+p+'/exe','set sysroot '+root,'attach '+str(pid),'thread apply all bt 64','detach']:args+=['-ex',cmd]
 child=subprocess.Popen(args,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,text=True)
 try:output=child.communicate(timeout=15)[0]
 except subprocess.TimeoutExpired:
  child.terminate()
  try:child.communicate(timeout=3)
  except subprocess.TimeoutExpired:child.kill();child.communicate()
  raise RuntimeError('bounded debugger timeout; tracer terminated')
 if child.returncode or len(output)>2097152 or start()!=before:raise RuntimeError('debugger or process identity failed')
 status=open(p+'/status').read()
 if '\nTracerPid:\t0\n' not in '\n'+status:raise RuntimeError('debugger did not detach')
 print(json.dumps({'pid':pid,'startTicks':before,'sampledAtMs':time.time()*1000,'text':output}))
finally:shutil.rmtree(root)
`;
const defaultExec = (file, args) => execFileSync(file, args,
  { encoding: 'utf8', timeout: 22000, maxBuffer: 4 * 1024 * 1024 });

function scan(databasePath, fenceStat, options) {
  const exec = options.exec || defaultExec;
  const data = JSON.parse(exec('/usr/bin/sudo', ['-n', '/usr/bin/python3', '-c', helper,
    String(process.getuid()), String(fenceStat.birthtimeMs), databasePath]));
  if (!/^[0-9a-f-]{36}$/i.test(data.bootId) || !Array.isArray(data.processes)
    || !data.processes.length || data.processes.length > 2048) fail('unbounded or invalid process census');
  return data;
}

function threadFrames(text, tids) {
  const blocks = text.split(/^Thread /m).slice(1);
  return tids.map(tid => {
    const block = blocks.find(b => new RegExp(`LWP ${tid}(?:\\)|\\s|$)`).test(b.slice(0, 150)));
    return { tid, frames: block?.split('\n').filter(line => /^#\d+\s/.test(line)) };
  });
}
export function nativeAddonThreadProof(text, tids) {
  if (text.includes('Backtrace stopped:') || text.includes('Cannot access memory')) fail('native stack is incomplete');
  for (const { tid, frames } of threadFrames(text, tids)) {
    const nativeOwner = /node::(?:\(anonymous namespace\)::)?PlatformWorkerThread|node::inspector::(?:\(anonymous namespace\)::)?StartIoThreadMain| in worker \(.* at .*deps\/uv\/src\/threadpool\.c/;
    const nativeWait = /\buv_(?:_sem_wait|sem_wait|cond_wait)\b|node::TaskQueue(?:::|<).*BlockingPop/;
    if (!frames || frames.length < 4 || frames.length >= 64
      || !frames.some(f => / from \S+\.node$/.test(f) || nativeOwner.test(f))
      || !frames.every(f => / from \S+(?:\.node|\/libc\.so\.\d+)$/.test(f) || nativeOwner.test(f) || nativeWait.test(f))
      || !frames.slice(-2).every(f => /\/libc\.so\.\d+$/.test(f))) fail(`unproved native addon thread ${tid}`);
  }
  return true;
}

function qualify(row, options, existing) {
  if (row.kind === 'outside-installed-node-protocol') return { pid: row.pid, kind: row.kind };
  if (row.kind !== 'node') fail('unreviewed runtime');
  if (row.isolated) return { pid: row.pid, kind: 'different-mount-namespace-no-fence-filesystem-access' };
  const threads = row.threads;
  if (!Array.isArray(threads) || !threads.length || threads.length > 512) fail('invalid thread census');
  const epoll = t => t.wait === 'ep_poll' && t.syscall === '281'
    && t.stack.includes('__x64_sys_epoll_pwait') && t.stack.includes('ep_poll');
  if (!epoll(threads.find(t => t.tid === row.pid) || {})) fail(`main thread not quiescent: ${row.pid}`);
  // Names are not authority: JavaScript workers may choose native-looking names.
  const ambiguous = threads.filter(t => t.tid !== row.pid && !epoll(t));
  if (ambiguous.length) {
    const io = options.io || fs;
    let proof = existing;
    if (!proof) {
      const sample = JSON.parse((options.exec || defaultExec)('/usr/bin/sudo',
        ['-n', '/usr/bin/python3', '-c', stackHelper, String(row.pid)]));
      if (sample.pid !== row.pid || sample.startTicks !== row.startTicks
        || !Number.isFinite(sample.sampledAtMs)) fail('native sample identity invalid');
      const directory = io.mkdtempSync(path.join(os.tmpdir(), 'rsp-linux-quiescence-'));
      io.chmodSync(directory, 0o700);
      const artifact = path.join(directory, `${row.pid}.json`);
      io.writeFileSync(artifact, JSON.stringify(sample), { mode: 0o600, flag: 'wx' });
      proof = { pid: row.pid, kind: 'native-thread-stacks', artifact, sha256: sha(io.readFileSync(artifact)) };
    }
    if (proof.kind !== 'native-thread-stacks') fail('missing native sample');
    const st = io.lstatSync(proof.artifact);
    if (!st.isFile() || st.isSymbolicLink() || st.uid !== process.getuid()
      || (st.mode & 0o777) !== 0o600 || st.size > 2097152) fail('native sample ownership invalid');
    const bytes = io.readFileSync(proof.artifact);
    if (sha(bytes) !== proof.sha256) fail('native sample changed');
    const sample = JSON.parse(bytes);
    if (sample.pid !== row.pid || sample.startTicks !== row.startTicks || !Number.isFinite(sample.sampledAtMs)
      || sample.sampledAtMs <= options.fenceBirthtimeMs || sample.sampledAtMs > Date.now())
      fail('sample time invalid or process changed');
    const tids = ambiguous.map(t => t.tid);
    nativeAddonThreadProof(sample.text, tids);
    const frames = threadFrames(sample.text, tids);
    if (existing && !isDeepStrictEqual(existing.frames, frames)) fail('retained native frames changed');
    return { ...proof, frames };
  }
  return { pid: row.pid, kind: 'kernel-epoll-outside-synchronous-recovery', threads: threads.length };
}

export function collectLinuxLegacyQuiescence(databasePath, fenceStat, options = {}) {
  if ((options.getPlatform?.() || process.platform) !== 'linux') fail('Linux required');
  const io = options.io || fs;
  const before = scan(databasePath, fenceStat, options);
  options = { ...options, fenceBirthtimeMs: fenceStat.birthtimeMs };
  const proofs = before.processes.map(row => qualify(row, options));
  const evidence = { schema: 'rsp-legacy-quiescence/v1', platform: 'linux', databasePath,
    fence: identity(fenceStat), uid: process.getuid(), bootId: before.bootId,
    protocolSha256: sha(LEGACY_SOURCE), collectedAt: new Date().toISOString(),
    processes: before.processes, proofs };
  if (Buffer.byteLength(JSON.stringify(evidence)) > 1024 * 1024) fail('evidence exceeds 1MiB');
  verifyLinuxLegacyQuiescence(evidence, databasePath, fenceStat, options);
  return evidence;
}

export function verifyLinuxLegacyQuiescence(evidence, databasePath, fenceStat, options = {}) {
  if (Buffer.byteLength(JSON.stringify(evidence) || '') > 1024 * 1024) fail('evidence exceeds 1MiB');
  if ((options.getPlatform?.() || process.platform) !== 'linux' || evidence?.platform !== 'linux'
    || evidence.schema !== 'rsp-legacy-quiescence/v1' || evidence.databasePath !== databasePath
    || evidence.uid !== process.getuid() || evidence.protocolSha256 !== sha(LEGACY_SOURCE)
    || !isDeepStrictEqual(evidence.fence, identity(fenceStat))) fail('fence or protocol changed');
  const current = scan(databasePath, fenceStat, options);
  options = { ...options, fenceBirthtimeMs: fenceStat.birthtimeMs };
  if (current.bootId !== evidence.bootId) fail('boot changed');
  const previous = new Map(evidence.processes.map(row => [row.pid, row]));
  if (previous.size !== evidence.processes.length) fail('duplicate process identity');
  for (const row of current.processes) {
    const old = previous.get(row.pid);
    if (!old || old.startMs !== row.startMs || old.executable !== row.executable || old.kind !== row.kind)
      fail(`process identity changed: ${row.pid}`);
    const proof = qualify(row, options, evidence.proofs.find(p => p.pid === row.pid));
    if (!isDeepStrictEqual(evidence.proofs.find(p => p.pid === row.pid), proof)) fail(`quiescence changed: ${row.pid}`);
  }
  return true;
}
