// Atomic installed-source patch for stuinfla/ruvnet-brain#102 and #103.
// Native activation remains authoritative: discover active.json first, then patch only executable
// bytes in that selected generation, matching host copies, and the native persistent MCP shell.

import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { discover, surfaceFiles } from './discovery.mjs';
import { PATCH_MARKER, isPatched } from './transforms.mjs';

export { PATCH_MARKER } from './transforms.mjs';
export { discover } from './discovery.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const runtimeRoot = path.join(here, 'runtime');
const ADDITIVES = Object.freeze({
  'scripts/managed-memory-policy.mjs': { source: 'managed-memory-policy.mjs', mode: 0o644 },
  'scripts/managed-memory-gate.mjs': { source: 'managed-memory-gate.mjs', mode: 0o755 },
  'mcp/managed-memory-diagnostic.mjs': { source: 'managed-memory-diagnostic.mjs', mode: 0o644 },
});

function bodyFor(relative) {
  const spec = ADDITIVES[relative];
  if (!spec) throw new Error(`unknown additive artifact ${relative}`);
  const body = fs.readFileSync(path.join(runtimeRoot, spec.source), 'utf8');
  if (!body.includes(PATCH_MARKER)) throw new Error(`packaged ${spec.source} has no ownership marker`);
  return { body, mode: spec.mode };
}

function safePath(root, file, { allowMissing = false } = {}) {
  const rootStat = fs.lstatSync(root);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
    throw new Error(`Brain surface root is not a regular directory: ${root}`);
  }
  const relative = path.relative(root, file);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`target escapes Brain surface: ${file}`);
  }
  let cursor = root;
  for (const part of relative.split(path.sep)) {
    cursor = path.join(cursor, part);
    if (!fs.existsSync(cursor)) {
      if (allowMissing) return;
      throw new Error(`required file is missing: ${cursor}`);
    }
    const stat = fs.lstatSync(cursor);
    if (stat.isSymbolicLink()) throw new Error(`refusing symlinked Brain path: ${cursor}`);
    if (cursor !== file && !stat.isDirectory()) throw new Error(`Brain path parent is not a directory: ${cursor}`);
  }
}

function readRegular(root, file) {
  safePath(root, file);
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.size === 0) throw new Error(`required file is empty or not regular: ${file}`);
  return { body: fs.readFileSync(file, 'utf8'), mode: stat.mode & 0o7777 };
}

function transformed(spec, pristine, file) {
  const result = spec.patch(pristine);
  if (result.missing.length || result.applied.length !== spec.edits) {
    throw new Error(`${file}: exact patch anchors incomplete (${result.missing.join(', ') || `${result.applied.length}/${spec.edits}`})`);
  }
  if (!isPatched(spec.id, result.next)) throw new Error(`${file}: transformed bytes failed the patch recognizer`);
  return result.next;
}

function operation(file, expected, desired, mode, label, component = true) {
  return { file, expected, desired, mode, label, component };
}

function planApplySurface(surface) {
  const operations = [];
  const logs = [];
  let components = 0;
  const { vendor, additive } = surfaceFiles(surface);

  for (const spec of vendor) {
    components++;
    const file = path.join(surface.root, spec.relative);
    const current = readRegular(surface.root, file);
    const backup = `${file}.rsp-backup`;
    safePath(surface.root, backup, { allowMissing: true });
    if (fs.existsSync(backup)) {
      const saved = readRegular(surface.root, backup);
      if (saved.body.includes(PATCH_MARKER)) throw new Error(`${backup}: pristine backup contains the patch marker`);
      const expected = transformed(spec, saved.body, file);
      if (current.body === expected) continue;
      if (current.body === saved.body) {
        operations.push(operation(file, current.body, expected, current.mode, `${surface.label}: ${spec.relative}`));
        continue;
      }
      if (current.body.includes(PATCH_MARKER) || isPatched(spec.id, current.body)) {
        throw new Error(`${file}: patched-looking live bytes do not derive from their pristine backup`);
      }
      const rebased = transformed(spec, current.body, file);
      operations.push(operation(backup, saved.body, current.body, current.mode,
        `${surface.label}: re-baseline ${spec.relative}`, false));
      operations.push(operation(file, current.body, rebased, current.mode, `${surface.label}: ${spec.relative}`));
      logs.push(`re-baselined ${file} from a completed native/external replacement`);
      continue;
    }
    if (current.body.includes(PATCH_MARKER) || isPatched(spec.id, current.body)) {
      throw new Error(`${file}: patch marker exists without a pristine backup`);
    }
    const desired = transformed(spec, current.body, file);
    operations.push(operation(backup, null, current.body, current.mode,
      `${surface.label}: pristine ${spec.relative}`, false));
    operations.push(operation(file, current.body, desired, current.mode, `${surface.label}: ${spec.relative}`));
  }

  for (const relative of additive) {
    components++;
    const file = path.join(surface.root, relative);
    safePath(surface.root, file, { allowMissing: true });
    const desired = bodyFor(relative);
    if (!fs.existsSync(file)) {
      operations.push(operation(file, null, desired.body, desired.mode, `${surface.label}: ${relative}`));
      continue;
    }
    const current = readRegular(surface.root, file);
    if (current.body === desired.body && current.mode === desired.mode) continue;
    if (!current.body.includes(PATCH_MARKER)) {
      throw new Error(`${file}: additive path is already owned by non-patch bytes`);
    }
    operations.push(operation(file, current.body, desired.body, desired.mode, `${surface.label}: ${relative}`));
  }
  return { operations, logs, components };
}

function planRestoreSurface(surface) {
  const operations = [];
  const logs = [];
  let components = 0;
  const { vendor, additive } = surfaceFiles(surface);
  for (const spec of vendor) {
    components++;
    const file = path.join(surface.root, spec.relative);
    const current = readRegular(surface.root, file);
    const backup = `${file}.rsp-backup`;
    safePath(surface.root, backup, { allowMissing: true });
    if (!fs.existsSync(backup)) {
      if (current.body.includes(PATCH_MARKER) || isPatched(spec.id, current.body)) {
        throw new Error(`${file}: patched bytes remain but the pristine backup is missing`);
      }
      continue;
    }
    const saved = readRegular(surface.root, backup);
    if (saved.body.includes(PATCH_MARKER)) throw new Error(`${backup}: pristine backup contains the patch marker`);
    const expected = transformed(spec, saved.body, file);
    if (current.body === expected) {
      operations.push(operation(file, current.body, saved.body, saved.mode, `${surface.label}: restore ${spec.relative}`));
      operations.push(operation(backup, saved.body, null, null, `${surface.label}: remove backup`, false));
    } else if (current.body === saved.body) {
      operations.push(operation(backup, saved.body, null, null, `${surface.label}: remove stale backup`, false));
    } else if (current.body.includes(PATCH_MARKER) || isPatched(spec.id, current.body)) {
      throw new Error(`${file}: patched-looking live bytes are not the exact owned transform`);
    } else {
      operations.push(operation(backup, saved.body, null, null, `${surface.label}: discard stale backup`, false));
      logs.push(`preserved external replacement ${file}; removed only its stale patch backup`);
    }
  }

  for (const relative of additive) {
    components++;
    const file = path.join(surface.root, relative);
    safePath(surface.root, file, { allowMissing: true });
    if (!fs.existsSync(file)) continue;
    const current = readRegular(surface.root, file);
    if (!current.body.includes(PATCH_MARKER)) {
      logs.push(`preserved non-patch additive path ${file}`);
      continue;
    }
    operations.push(operation(file, current.body, null, null, `${surface.label}: remove ${relative}`));
  }
  return { operations, logs, components };
}

function currentBody(file) {
  try { return fs.readFileSync(file, 'utf8'); }
  catch (error) { if (error?.code === 'ENOENT') return null; throw error; }
}

function atomicWrite(file, body, mode) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = path.join(path.dirname(file), `.${path.basename(file)}.rsp-tmp-${process.pid}-${randomUUID()}`);
  let fd;
  try {
    fd = fs.openSync(tmp, 'wx', mode ?? 0o644);
    fs.writeFileSync(fd, body);
    if (mode !== null && mode !== undefined) fs.fchmodSync(fd, mode);
    fs.fsyncSync(fd);
    fs.closeSync(fd); fd = undefined;
    fs.renameSync(tmp, file);
  } finally {
    if (fd !== undefined) { try { fs.closeSync(fd); } catch {} }
    try { fs.rmSync(tmp, { force: true }); } catch {}
  }
}

function execute(operations) {
  for (const op of operations) {
    if (currentBody(op.file) !== op.expected) {
      throw new Error(`concurrent native/update change detected before write: ${op.file}`);
    }
  }
  const snapshots = new Map();
  try {
    for (const op of operations) {
      if (!snapshots.has(op.file)) {
        snapshots.set(op.file, fs.existsSync(op.file)
          ? { body: fs.readFileSync(op.file, 'utf8'), mode: fs.statSync(op.file).mode & 0o7777 }
          : null);
      }
      if (op.desired === null) fs.rmSync(op.file, { force: true });
      else atomicWrite(op.file, op.desired, op.mode);
    }
    for (const op of operations) {
      if (currentBody(op.file) !== op.desired) throw new Error(`post-write verification failed: ${op.file}`);
    }
  } catch (error) {
    const rollbackErrors = [];
    for (const [file, before] of [...snapshots].reverse()) {
      try {
        if (before === null) fs.rmSync(file, { force: true });
        else atomicWrite(file, before.body, before.mode);
      } catch (rollback) { rollbackErrors.push(`${file}: ${rollback.message}`); }
    }
    if (rollbackErrors.length) {
      throw new Error(`${error.message}; ROLLBACK INCOMPLETE: ${rollbackErrors.join('; ')}`);
    }
    throw error;
  }
}

function runPlan(kind) {
  const result = {
    patched: 0, unchanged: 0, restored: 0, incomplete: 0, errors: 0, log: [],
  };
  let surfaces;
  try { surfaces = discover({ includeOwned: true }); }
  catch (error) {
    result.incomplete++;
    result.log.push(`INCOMPLETE ${error.message}`);
    return result;
  }
  const plans = [];
  try {
    for (const surface of surfaces) {
      const plan = kind === 'apply' ? planApplySurface(surface) : planRestoreSurface(surface);
      plans.push(plan);
      result.log.push(...plan.logs);
    }
  } catch (error) {
    result.incomplete++;
    result.log.push(`INCOMPLETE — NOTHING WRITTEN: ${error.message}`);
    return result;
  }
  const operations = plans.flatMap((plan) => plan.operations);
  try { execute(operations); }
  catch (error) {
    result.errors++;
    result.log.push(`error — transaction rolled back: ${error.message}`);
    return result;
  }
  const changedComponents = operations.filter((op) => op.component).length;
  const components = plans.reduce((sum, plan) => sum + plan.components, 0);
  if (kind === 'apply') result.patched = changedComponents;
  else result.restored = changedComponents;
  result.unchanged = Math.max(0, components - changedComponents);
  for (const op of operations.filter((item) => item.component)) result.log.push(`${kind === 'apply' ? 'patched' : 'restored'} ${op.file}`);
  return result;
}

export const apply = () => runPlan('apply');
export const restore = () => runPlan('restore');

export function status() {
  const out = { files: 0, patched: 0, log: [] };
  let surfaces;
  try { surfaces = discover({ includeOwned: true }); }
  catch (error) { out.files = 6; out.log.push(`not-patched ${error.message}`); return out; }
  for (const surface of surfaces) {
    const { vendor, additive } = surfaceFiles(surface);
    for (const spec of vendor) {
      out.files++;
      const file = path.join(surface.root, spec.relative);
      try {
        const saved = fs.readFileSync(`${file}.rsp-backup`, 'utf8');
        const current = fs.readFileSync(file, 'utf8');
        if (transformed(spec, saved, file) === current) out.patched++;
        else out.log.push(`not-patched ${file}`);
      } catch { out.log.push(`not-patched ${file}`); }
    }
    for (const relative of additive) {
      out.files++;
      const file = path.join(surface.root, relative);
      try {
        const desired = bodyFor(relative);
        const stat = fs.statSync(file);
        if (fs.readFileSync(file, 'utf8') === desired.body && (stat.mode & 0o7777) === desired.mode) out.patched++;
        else out.log.push(`not-patched ${file}`);
      } catch { out.log.push(`not-patched ${file}`); }
    }
  }
  return out;
}
