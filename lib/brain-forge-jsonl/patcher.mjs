// Brain #528: JSONL records end at LF, not Unicode separators in JSON strings.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { HOME_BASE } from '../cwd/paths.mjs';
import { existingPathRelative } from '../path-containment.mjs';

export const NAME = 'brain-forge-jsonl';
export const PATCH_MARKER = 'ruflo-source-patch (stuinfla/ruvnet-brain#528)';
export const ORIGINAL = `function streamPassages(file, onLine) {
  return new Promise((resolve, reject) => {
    const rl = readline.createInterface({ input: fs.createReadStream(file, 'utf8'), crlfDelay: Infinity });
    let n = 0;
    rl.on('line', (line) => { if (!line.trim()) return; n++; try { onLine(JSON.parse(line), n); } catch { onLine(null, n); } });
    rl.on('close', () => resolve(n));
    rl.on('error', reject);
  });
}`;
export const REPLACEMENT = `// ${PATCH_MARKER}: preserve JSON string content and native validation.
async function streamPassages(file, onLine) {
  let pending = '', n = 0;
  const emit = (line) => {
    if (!line.trim()) return;
    n++;
    let value;
    try { value = JSON.parse(line); } catch { value = null; }
    onLine(value, n);
  };
  for await (const chunk of fs.createReadStream(file, { encoding: 'utf8' })) {
    pending += chunk;
    let start = 0, end;
    while ((end = pending.indexOf('\\n', start)) !== -1) {
      emit(pending.slice(start, end));
      start = end + 1;
    }
    pending = pending.slice(start);
  }
  emit(pending);
  return n;
}`;
const IMPORT = "import readline from 'node:readline';\n";
const sha = source => crypto.createHash('sha256').update(source).digest('hex');
const PRISTINE = '9b71a132eaa39ba1714078bf687375bbfb8cda3a7d2776e336f7cdc34d9914da';
export const hasPatch = source => source.includes(PATCH_MARKER);
export function reverseSource(source) {
  if (!source.includes(REPLACEMENT)) return source;
  return source.replace(REPLACEMENT, () => ORIGINAL)
    .replace("import { searchKb }", () => IMPORT + "import { searchKb }");
}
export const isPatched = source => hasPatch(source)
  && sha(reverseSource(source)) === PRISTINE;
export function patchSource(source) {
  if (isPatched(source)) return { next: source, applied: [], missing: [] };
  if (sha(source) !== PRISTINE) return { next: source, applied: [], missing: ['reviewed-forge-guard-source'] };
  return { next: source.replace(IMPORT, '').replace(ORIGINAL, () => REPLACEMENT),
    applied: ['lf-delimited-jsonl'], missing: [] };
}
const brainHome = () => path.resolve(process.env.RSP_RUVNET_BRAIN_HOME
  || path.join(HOME_BASE, '.cache/ruvnet-brain'));
export function discover() {
  const root = brainHome();
  if (!fs.existsSync(root)) return [];
  // Only installed executable code. Never scan or mutate candidate/preserved trees.
  return [path.join(root, 'kb/forge-guard.mjs')];
}
export function preflight() {
  const errors = [];
  for (const file of discover()) {
    try {
      const stat = fs.lstatSync(file);
      if (fs.realpathSync(brainHome()) !== brainHome() || !stat.isFile() || stat.isSymbolicLink()
        || existingPathRelative(brainHome(), file) !== 'kb/forge-guard.mjs') throw Error('unsafe guard path');
      if (patchSource(fs.readFileSync(file, 'utf8')).missing.length) throw Error('unreviewed forge-guard source');
    } catch (error) { errors.push(`${file}: ${error.message}`); }
  }
  return { ok: errors.length === 0, errors };
}
export function applicability() {
  if (!discover().length) return { state: 'not-applicable', reason: 'Brain home is absent' };
  const proof = preflight();
  return proof.ok ? { state: 'applicable' } : { state: 'error', reason: proof.errors.join('; ') };
}
// Retirement requires a reviewed upstream guard passing the same behavioral matrix.
// Unknown native bytes are refused, never overwritten from an old backup.
export const descriptor = { name: NAME, atomic: true, missingIsIncomplete: true,
  discover, patchSource, hasPatch, isPatched, reverse: reverseSource, preflight, applicability };
