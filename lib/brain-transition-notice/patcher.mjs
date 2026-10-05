// Brain #380: bounded per-session notices for durable pending transitions.
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { HOME_BASE } from '../cwd/paths.mjs';
import { discover as discoverBrain } from '../brain-managed-memory-boundary/discovery.mjs';
import { existingPathRelative } from '../path-containment.mjs';
export const PATCH_MARKER = 'ruflo-source-patch (stuinfla/ruvnet-brain#380)';
export const NOTICE_ANCHOR = `export function stopNotice({ journal, status, session }) {
  if (!status?.stuck || !status.problem) return '';
  const file = path.join(journal.swarm, NOTICE_STATE);
  let state = {};
  try { state = JSON.parse(fs.readFileSync(file, 'utf8')) || {}; } catch { /* first notice */ }
  const id = String(session || 'unknown');
  const shown = Array.isArray(state[id]?.conditions) ? state[id].conditions : [];
  if (shown.includes(status.problem)) return '';
  state[id] = { at: new Date(journal.now()).toISOString(), conditions: [...shown, status.problem] };
  const recent = Object.entries(state).sort((a, b) => String(b[1]?.at).localeCompare(String(a[1]?.at))).slice(0, 20);
  try { fs.writeFileSync(file, JSON.stringify(Object.fromEntries(recent)), { mode: 0o600 }); } catch { /* still show it once */ }
  return \`[RuvNet Brain] \${recordingLine(status, journal.now())}\`;
}`;
export const NOTICE_REPLACEMENT = `export function stopNotice({ journal, status, session, condition, message }) {
  // ruflo-source-patch (stuinfla/ruvnet-brain#380): reuse the native bounded notice ledger.
  const explicit = typeof condition === 'string' && condition.length > 0
    && typeof message === 'string' && message.length > 0;
  const problem = explicit ? condition : status?.stuck ? status.problem : null;
  if (!problem) return '';
  const file = path.join(journal.swarm, NOTICE_STATE);
  let state = {};
  try { state = JSON.parse(fs.readFileSync(file, 'utf8')) || {}; } catch { /* first notice */ }
  const id = String(session || 'unknown');
  const shown = Array.isArray(state[id]?.conditions) ? state[id].conditions : [];
  if (shown.includes(problem)) return '';
  state[id] = { at: new Date(journal.now()).toISOString(), conditions: [...shown, problem] };
  const recent = Object.entries(state).sort((a, b) => String(b[1]?.at).localeCompare(String(a[1]?.at))).slice(0, 20);
  try { fs.writeFileSync(file, JSON.stringify(Object.fromEntries(recent)), { mode: 0o600 }); } catch { /* still show it once */ }
  return explicit ? message : \`[RuvNet Brain] \${recordingLine(status, journal.now())}\`;
}`;
export const COMPAT_ANCHOR = `    if (result.state === 'pending') process.stdout.write(JSON.stringify({ systemMessage: 'Project memory transition remains pending; exact readback was not verified.' }));`;
export const COMPAT_REPLACEMENT = `    if (result.state === 'pending') {
      // ruflo-source-patch (stuinfla/ruvnet-brain#380): pending is not a new failure at every boundary.
      const message = stopNotice({
        journal: { swarm: path.dirname(resolveProjectStore({ projectDir: payload.cwd || projectDirectory() }).canonicalAgentDbPath), now: Date.now },
        session: payload.session_id, condition: 'project-transition-pending',
        message: 'Project memory transition remains pending; exact readback was not verified.',
      });
      if (message) process.stdout.write(JSON.stringify({ systemMessage: message }));
    }`;
export const DIRECT_ANCHOR = `    if (result.state === 'pending') process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: process.argv[2], additionalContext: 'Project memory transition is pending; exact AgentDB readback was not verified at this boundary.' } }));`;
export const DIRECT_REPLACEMENT = `    if (result.state === 'pending') {
      // ruflo-source-patch (stuinfla/ruvnet-brain#380): pending is not a new failure at every boundary.
      const message = stopNotice({
        journal: { swarm: path.dirname(resolveProjectStore({ projectDir: payload.cwd || process.env.CLAUDE_PROJECT_DIR || process.cwd() }).canonicalAgentDbPath), now: Date.now },
        session: payload.session_id, condition: 'project-transition-pending',
        message: 'Project memory transition is pending; exact AgentDB readback was not verified at this boundary.',
      });
      if (message) process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: process.argv[2], additionalContext: message } }));
    }`;
export const IMPORT_ANCHOR = `import { normalizeHostEvent } from './hook-input.mjs';`;
export const IMPORT_REPLACEMENT = `import { normalizeHostEvent } from './hook-input.mjs';
// ruflo-source-patch (stuinfla/ruvnet-brain#380): share native notice ownership.
import { stopNotice } from './continuity-journal.mjs';`;
export const SPECS = [
  { relative: 'scripts/continuity-journal.mjs', edits: [[NOTICE_ANCHOR, NOTICE_REPLACEMENT]] },
  { relative: 'scripts/session-snapshot-hook.mjs', edits: [[COMPAT_ANCHOR, COMPAT_REPLACEMENT]] },
  { relative: 'scripts/project-transition-hook.mjs', edits: [[IMPORT_ANCHOR, IMPORT_REPLACEMENT], [DIRECT_ANCHOR, DIRECT_REPLACEMENT]] },
];
// Exact reviewed v4.5.7 notice boundaries; all three execute together in retirement proof.
const NATIVE_BOUNDARIES = [
  ['export function conditionNotice(', 'function defaultStore(', 'e6adde24f58366b7f64e261fe0825dbfb565875a4879b7613556e2dffda9b3d4'],
  ['// Compatibility entrypoint uses the same minimized transition producer', '})();', '02f55fd105de83420b7e48999d53bff6d0b7c9d444e1d2bf9ee6d98da55ebf60'],
  ['export function transitionPendingNotice(', null, '1ae9a784751da766b5e1a29cfeaf69783a166268bc8b46f84c425f14ca23f92e'],
];
export function nativeSatisfied(source) {
  if (hasPatch(source)) return false;
  return NATIVE_BOUNDARIES.some(([start, finish, digest]) => {
    if (source.split(start).length !== 2) return false;
    const begin = source.indexOf(start), end = finish ? source.indexOf(finish, begin) : source.length;
    return begin >= 0 && end > begin && crypto.createHash('sha256')
      .update(source.slice(begin, end + (finish === '})();' ? 5 : 0))).digest('hex') === digest;
  });
}
const count = (s, needle) => s.split(needle).length - 1;
const specOf = (s) => SPECS.find(spec => spec.edits.some(([a, b]) => s.includes(a) || s.includes(b)));
export const hasPatch = s => s.includes(PATCH_MARKER);
export const isPatched = s => {
  if (nativeSatisfied(s)) return true;
  const spec = specOf(s);
  return Boolean(spec && spec.edits.every(([a, b]) => count(s, b) === 1 && !s.replace(b, '').includes(a)));
};
export function patchSource(source) {
  const spec = specOf(source);
  if (isPatched(source)) return { next: source, applied: [], missing: [] };
  if (!spec || hasPatch(source) || spec.edits.some(([a]) => count(source, a) !== 1)) {
    return { next: source, applied: [], missing: ['transition-notice (absent, ambiguous or modified anchor)'] };
  }
  return { next: spec.edits.reduce((next, [a, b]) => next.replace(a, b), source),
    applied: ['transition-notice'], missing: [] };
}
export const reverseSource = source => SPECS.flatMap(s => s.edits)
  .reduceRight((next, [a, b]) => next.replace(b, a), source);
function surfaces() {
  const home = path.resolve(process.env.RSP_RUVNET_BRAIN_HOME || path.join(HOME_BASE, '.cache', 'ruvnet-brain'));
  if (!fs.existsSync(path.join(home, 'active.json'))) return [];
  return discoverBrain({ includeOwned: false }).filter(s => s.kind === 'full');
}
export const discover = () => surfaces().flatMap(s => SPECS.map(spec => path.join(s.root, spec.relative)));
export function preflight() {
  const errors = [];
  for (const file of discover()) {
    try {
      const st = fs.lstatSync(file);
      if (!st.isFile() || st.isSymbolicLink() || !st.size) throw new Error('unsafe or empty script');
      if (existingPathRelative(path.dirname(path.dirname(file)), file) === null) throw new Error('script escapes native owner');
      if (patchSource(fs.readFileSync(file, 'utf8')).missing.length) throw new Error('unproved exact transition-notice bundle');
    } catch (error) { errors.push(`${file}: ${error.message}`); }
  }
  return { ok: errors.length === 0, errors };
}
export const descriptor = {
  name: 'brain-transition-notice', atomic: true, missingIsIncomplete: true,
  discover, preflight, patchSource, hasPatch, isPatched, reverse: reverseSource,
};
