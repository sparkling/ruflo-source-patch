// Operator-only activation after native host transport drain. Originals are archived, never deleted.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { nativeDriver, inspectSnapshot } from './two-store-recovery.mjs';

export function assertNoHolders(files) {
  try {
    const output = execFileSync('lsof', ['-n', '-P', ...files], { encoding: 'utf8', timeout: 15000 });
    if (output.trim()) throw Error('Live database handles remain; owning host must drain them');
  } catch (error) {
    if (String(error.stdout ?? '').trim()) throw Error('Live database handles remain; owning host must drain them');
    if (error.status === 1 && !String(error.stdout ?? '').trim() && !String(error.stderr ?? '').trim()) return;
    throw error;
  }
}

const view = value => ({ integrity: value.integrity, schemaSha256: value.schemaSha256,
  tables: value.tables, foreignKeyViolations: value.foreignKeyViolations, complete: value.complete });
const equal = (a, b) => JSON.stringify(view(a)) === JSON.stringify(view(b));

export async function activateAgentDb({ project, staged, finalReceipt, destination, cliRoot }) {
  if (![project, staged, finalReceipt, destination, cliRoot].every(v => typeof v === 'string' && path.isAbsolute(v)))
    throw Error('All maintenance paths must be absolute');
  project = fs.realpathSync(project);
  destination = path.join(fs.realpathSync(path.dirname(destination)), path.basename(destination));
  staged = fs.realpathSync(staged);
  if (!destination.startsWith(project + '/.local/two-store-restoration/')) throw Error('Archive must stay within the project recovery area');
  if (fs.existsSync(destination)) throw Error('Cutover destination already exists; inspect its receipt, never repeat blindly');
  const baseline = JSON.parse(fs.readFileSync(finalReceipt, 'utf8'));
  if (baseline.status !== 'verified' || baseline.project !== project) throw Error('Verified final project recovery receipt required');
  const sources = ['memory.db', 'agentdb-memory.db'].map(name => path.join(project, '.swarm', name));
  assertNoHolders(sources);
  const { Database, version } = await nativeDriver(cliRoot);
  const stagedStat = fs.statSync(staged);
  if (!stagedStat.isFile() || (stagedStat.mode & 0o222)) throw Error('Use an immutable verified staging file');
  const expected = inspectSnapshot(Database, staged);
  if (!expected.complete || expected.foreignKeyViolations.length) throw Error('Staged integrity/FK proof incomplete');
  // Detect final-delta writes or changed aliases before making any cutover artifact.
  const verified = new Set();
  for (const store of baseline.stores) {
    const physical = fs.realpathSync(store.source);
    if (physical !== store.realpath) throw Error('Final source changed; original alias/owner no longer matches');
    if (store.aliasOf) continue;
    if (!equal(inspectSnapshot(Database, physical, { nativeOwner: true }), store))
      throw Error('Final source changed; take a new native snapshot and reconcile the delta');
    verified.add(store.name);
  }
  if (!verified.has('memory.db') || !baseline.stores.some(s => s.name === 'agentdb-memory.db'))
    throw Error('Both scoped source owners require a final receipt');
  assertNoHolders(sources);
  for (const file of sources) for (const suffix of ['-wal', '-shm'])
    if (fs.existsSync(file + suffix)) throw Error('Database sidecar remains after native owner retirement; activation refused');
  fs.mkdirSync(destination, { recursive: true, mode: 0o700 });
  if (fs.statSync(destination).dev !== fs.statSync(path.dirname(sources[1])).dev) throw Error('Archive must share the source filesystem');
  const temporary = path.join(path.dirname(sources[1]), '.rsp-agentdb-cutover-' + process.pid + '-' + Date.now() + '.db');
  const original = path.join(destination, 'original-agentdb-memory.db');
  const stat = fs.lstatSync(sources[1]);
  const receipt = { schema: 'ruflo-two-store-cutover/v1', project, staged, finalReceipt, cliVersion: version,
    startedAt: new Date().toISOString(), status: 'preparing', source: sources[1], original, temporary,
    originalAlias: stat.isSymbolicLink() ? fs.readlinkSync(sources[1]) : null,
    expected, qualification: 'Independent active AgentDB owner; memory.db and all originals retained. Installation/host reconnect remains separately verified.' };
  const save = () => fs.writeFileSync(path.join(destination, 'receipt.json'), JSON.stringify(receipt, null, 2) + '\n', { mode: 0o600 });
  save(); let archived = false, activated = false;
  try {
    const db = new Database(staged, { readonly: true, fileMustExist: true });
    try { await db.backup(temporary); } finally { db.close(); }
    fs.chmodSync(temporary, 0o600);
    if (!equal(inspectSnapshot(Database, temporary, { nativeOwner: true }), expected)) throw Error('Prepared native target differs from verified stage');
    assertNoHolders(sources);
    for (const file of [...sources, temporary]) for (const suffix of ['-wal', '-shm'])
      if (fs.existsSync(file + suffix)) throw Error('Refusing activation while a sidecar exists');
    receipt.status = 'prepared'; save();
    fs.renameSync(sources[1], original); archived = true;
    fs.renameSync(temporary, sources[1]); activated = true;
    if (fs.statSync(sources[0]).ino === fs.statSync(sources[1]).ino) throw Error('Active owner files are still aliases');
    receipt.after = inspectSnapshot(Database, sources[1], { nativeOwner: true });
    if (!equal(receipt.after, expected)) throw Error('Activated native target differs from verified stage');
    receipt.status = 'activated'; receipt.completedAt = new Date().toISOString(); save(); return receipt;
  } catch (error) {
    // No clients may reconnect until this operator-only operation has a receipt.
    if (archived && !activated && !fs.existsSync(sources[1])) {
      fs.renameSync(original, sources[1]); receipt.rollback = 'original owner restored';
    }
    receipt.status = activated ? 'activated-verification-failed' : 'failed'; receipt.error = error.message; save(); throw error;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [project, staged, finalReceipt, destination, cliRoot] = process.argv.slice(2);
  if (process.argv.length !== 7) throw Error('Usage: two-store-cutover.mjs <project> <immutable-stage> <final-receipt> <new-archive-directory> <cli-root>');
  const r = await activateAgentDb({ project, staged, finalReceipt, destination, cliRoot });
  console.log(JSON.stringify({ project, status: r.status, original: r.original, originalAlias: r.originalAlias,
    integrity: r.after.integrity, tables: r.after.tables.length, foreignKeyViolations: r.after.foreignKeyViolations.length }));
}
