import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { EDITS } from './patcher.mjs';
import { activeRufloAdrRoots } from '../adr-template/supersede.mjs';
import { supersessionCheck as reindexSupersession } from '../adr-reindex/patcher.mjs';
import { COMPOSE_TARGETS, composeSource } from '../plugin-compose.mjs';
import { readState } from '../cwd/state.mjs';

const IMPORTER = path.join('scripts', 'import.mjs');
const RECORDS = path.join('scripts', 'lib', 'index-records.mjs');
const INDEX_SKILL = path.join('skills', 'adr-index', 'SKILL.md');
const REINDEX_SKILL = path.join('skills', 'adr-reindex', 'SKILL.md');
const REINDEX_SCRIPT = path.join('scripts', 'reindex.mjs');
const OWN_MARKER = 'ruflo-source-patch (#2660)';

function read(file) {
  try { return { source: fs.readFileSync(file, 'utf8') }; }
  catch (error) { return { error: `could not read ${file}: ${error.message}` }; }
}

function upstreamImporter(file) {
  const current = read(file);
  if (current.error || !current.source.includes(OWN_MARKER)) return current;

  const backup = read(`${file}.rsp-backup`);
  if (backup.error) return { error: `${file} is locally patched but ${backup.error}` };
  if (!backup.source || backup.source.includes(OWN_MARKER)) {
    return { error: `${file}.rsp-backup is empty or locally patched; refusing to use it as upstream proof` };
  }
  const installed = readState().pluginTargets.filter((target) => COMPOSE_TARGETS.includes(target));
  if (composeSource(backup.source, installed) !== current.source) {
    return { error: `${file}.rsp-backup does not exactly compose to the installed bytes; refusing stale backup evidence` };
  }
  return backup;
}

function probeIndexRecords(file) {
  const program = `
import { pathToFileURL } from 'node:url';
const moduleFile = process.argv[1];
const api = await import(pathToFileURL(moduleFile).href + '?rsp=' + Date.now());
const proposed = {
  id: 'ADR-007', file: 'docs/adr/ADR-007-proof.md', title: 'Proof',
  context: 'Context', status: 'proposed', date: '2026-07-31', tags: ['agentdb'],
};
const accepted = { ...proposed, status: 'accepted', tags: ['agentdb', 'accepted'] };
const edge = { relation: 'depends-on', from: 'ADR-007', to: 'ADR-003' };
const recordArgs = api.memoryStoreArgs('adr-patterns', api.adrRecordKey(accepted), api.adrRecordValue(accepted));
const edgeArgs = api.memoryStoreArgs('adr-edges', api.edgeKey(edge), edge);
const ok = api.adrRecordKey(proposed) === api.adrRecordKey(accepted)
  && api.adrRecordValue(proposed) !== api.adrRecordValue(accepted)
  && recordArgs.filter((arg) => arg === '--upsert').length === 1
  && recordArgs.includes('--key=ADR-007::ADR-007-proof')
  && api.edgeKey(edge) === 'depends-on:ADR-007->ADR-003'
  && api.edgeKey({ ...edge }) === api.edgeKey(edge)
  && api.uniqueEdges([edge, { ...edge }]).length === 1
  && edgeArgs.includes('--upsert')
  && edgeArgs.includes('--key=depends-on:ADR-007->ADR-003');
if (!ok) process.exit(1);
`;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', program, file], {
    encoding: 'utf8', timeout: 5000, maxBuffer: 1024 * 1024,
  });
  if (result.error || result.status === null) {
    return { state: 'unknown', evidence: `${file} could not be executed: ${result.error?.message || 'no exit status'}` };
  }
  if (result.status !== 0) {
    return { state: 'live', evidence: `${file} failed the convergence probe: ${(result.stderr || result.stdout).trim() || `exit ${result.status}`}` };
  }
  return { state: 'proven' };
}

function proveCopy(root) {
  const importerFile = path.join(root, IMPORTER);
  const importer = upstreamImporter(importerFile);
  if (importer.error) return { state: 'unknown', evidence: importer.error };
  const missing = EDITS.slice(0, 4).filter((edit) => !edit.done(importer.source)).map((edit) => edit.id);
  if (missing.length) {
    return { state: 'live', evidence: `${importerFile} still lacks native #2660 behavior: ${missing.join(', ')}` };
  }

  const behavior = probeIndexRecords(path.join(root, RECORDS));
  if (behavior.state !== 'proven') return behavior;

  const files = [INDEX_SKILL, REINDEX_SKILL, REINDEX_SCRIPT].map((relative) => path.join(root, relative));
  const contents = files.map(read);
  const unreadable = contents.find((item) => item.error);
  if (unreadable) return { state: 'unknown', evidence: unreadable.error };
  const [indexSkill, reindexSkill, reindexScript] = contents.map((item) => item.source);
  const deletionRoute = indexSkill.includes('What this skill cannot do')
    && indexSkill.includes('adr-reindex')
    && reindexSkill.includes('memory purge --namespace <ns> --force')
    && reindexScript.includes("const NAMESPACES = ['adr-patterns', 'adr-edges'];")
    && reindexScript.includes('result.postCondition = {');
  if (!deletionRoute) {
    return { state: 'live', evidence: `${root} lacks the documented native adr-index -> adr-reindex deletion route` };
  }
  return { state: 'proven' };
}

export function adrIndexSupersession() {
  return {
    issue: 'https://github.com/ruvnet/ruflo/issues/2660',
    replacement: "ruflo-adr's native convergent indexer plus its documented adr-reindex deletion route",
    check() {
      const selected = activeRufloAdrRoots();
      if (selected.error) return { state: 'unknown', evidence: selected.error };
      const failures = [];
      for (const root of selected.roots) {
        const proof = proveCopy(root);
        if (proof.state === 'unknown') return proof;
        if (proof.state !== 'proven') failures.push(proof.evidence);
      }
      if (failures.length) {
        return {
          state: 'live',
          evidence: `${failures.length}/${selected.roots.length} active Claude/Codex ruflo-adr copy(ies) still need #2660 compatibility (${failures.join('; ')})`,
        };
      }
      const reindex = reindexSupersession();
      if (reindex.state !== 'superseded') {
        return {
          state: reindex.state === 'unknown' ? 'unknown' : 'live',
          evidence: `native convergence is present, but the deletion route is not runnable here: ${reindex.evidence}`,
        };
      }
      return {
        state: 'superseded',
        evidence: `all ${selected.roots.length} active Claude/Codex ruflo-adr copies execute native convergence, report stores honestly, and provide the adr-reindex deletion route`,
      };
    },
    postRetireCheck() {
      const selected = activeRufloAdrRoots();
      if (selected.error) return { ok: false, evidence: selected.error };
      for (const root of selected.roots) {
        const file = path.join(root, IMPORTER);
        const current = read(file);
        if (current.error) return { ok: false, evidence: current.error };
        if (current.source.includes(OWN_MARKER)) {
          return { ok: false, evidence: `our adr-index edit remains in ${file} after reconciliation` };
        }
      }
      return { ok: true };
    },
  };
}
