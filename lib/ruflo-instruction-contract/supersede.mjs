// Ruflo #3153 retires only after every installed generator executes every host
// template with the shared structured-interface contract and current core schemas.

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  discoverBundles,
  discoverCodexRoots,
  instructionContractViolations,
  PATCH_MARKER,
} from './patcher.mjs';
import {
  SKILL_NAMES,
  platformContractViolations,
  platformMarkdownFromGenerator,
  skillContractViolations,
  skillNameForSource,
} from './skill-contract.mjs';
import { reconcile } from '../plugin-compose.mjs';
import { readState } from '../cwd/state.mjs';

const CLAUDE_TEMPLATES = ['minimal', 'standard', 'full', 'security', 'performance', 'solo'];
const CODEX_TEMPLATES = ['minimal', 'default', 'full', 'enterprise'];
const REQUIRED_RUFLO_TOOLS = [
  'guidance_brain', 'guidance_recommend', 'swarm_init', 'agent_spawn',
  'memory_search', 'memory_search_unified', 'memory_store', 'hooks_route',
  'hooks_pre_task', 'hooks_post_task', 'hooks_worker_dispatch',
  'performance_benchmark', 'performance_profile', 'workflow_run',
  'session_restore', 'claims_list', 'system_status',
];

const RENDER_SCRIPT = String.raw`
import { pathToFileURL } from 'node:url';
const [host, file] = process.argv.slice(1);
const api = await import(pathToFileURL(file).href + '?rsp-retire=' + Date.now());
const options = {
  runtime: {
    claudeMdTemplate: 'standard', topology: 'hierarchical', maxAgents: 8,
    memoryBackend: 'hybrid', enableHNSW: true, enableNeural: true,
  },
};
const out = {};
if (host === 'claude') {
  for (const template of ${JSON.stringify(CLAUDE_TEMPLATES)}) {
    out[template] = api.generateClaudeMd(options, template);
  }
} else if (host === 'codex') {
  for (const template of ${JSON.stringify(CODEX_TEMPLATES)}) {
    out[template] = await api.generateAgentsMd({
      template, projectName: 'retirement-proof', description: 'retirement proof',
      buildCommand: 'npm run build', testCommand: 'npm test',
    });
  }
} else {
  throw new Error('unknown host: ' + host);
}
process.stdout.write(JSON.stringify(out));
`;

function regularSource(file) {
  try {
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink()) return { error: 'not a regular file' };
    return { source: fs.readFileSync(file, 'utf8') };
  } catch (error) {
    return { error: error.message };
  }
}

function liveToolProof(cliRoot) {
  const dir = path.join(cliRoot, 'dist', 'src', 'mcp-tools');
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
  catch (error) { return { error: `cannot read live MCP registry: ${error.message}` }; }
  const sources = [];
  const names = new Set();
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.js') || entry.name.endsWith('.rsp-backup')) continue;
    const file = path.join(dir, entry.name);
    const source = fs.readFileSync(file, 'utf8');
    sources.push(source);
    for (const match of source.matchAll(/name:\s*['"]([A-Za-z0-9_-]+)['"]/g)) {
      names.add(match[1].replaceAll('-', '_'));
    }
  }
  const missing = REQUIRED_RUFLO_TOOLS.filter((name) => !names.has(name));
  if (missing.length) return { error: `live MCP registry lacks: ${missing.join(', ')}` };
  const joined = sources.join('\n');
  if (!/name:\s*['"]agent_spawn['"][\s\S]*?required:\s*\[['"]agentType['"]\]/.test(joined)) {
    return { error: 'agent_spawn does not prove required agentType schema' };
  }
  if (!/name:\s*['"]performance_benchmark['"][\s\S]*?suite:\s*\{[^}]*enum:\s*\[['"]all['"]/.test(joined)) {
    return { error: 'performance_benchmark does not prove suite=all schema' };
  }
  return { ok: true };
}

export function probeBundle(bundle) {
  const surfaces = [['Claude', bundle.claude, CLAUDE_TEMPLATES]];
  if (bundle.codex) surfaces.push(['Codex', bundle.codex, CODEX_TEMPLATES]);
  for (const [host, file] of surfaces) {
    const read = regularSource(file);
    if (read.error) return { state: 'unknown', evidence: `${host} generator ${file}: ${read.error}` };
    if (read.source.includes(PATCH_MARKER)) {
      return { state: 'live', evidence: `${file} still carries the local #3153 patch` };
    }
    const syntax = spawnSync(process.execPath, ['--check', file], {
      encoding: 'utf8', timeout: 5000, maxBuffer: 1024 * 1024,
    });
    if (syntax.error || syntax.status !== 0) {
      return { state: 'unknown', evidence: `${file} failed syntax proof: ${syntax.error?.message || syntax.stderr || `exit ${syntax.status}`}` };
    }
  }

  if (bundle.platform) {
    const read = regularSource(bundle.platform);
    if (read.error) return { state: 'unknown', evidence: `platform generator ${bundle.platform}: ${read.error}` };
    if (read.source.includes(PATCH_MARKER)) {
      return { state: 'live', evidence: `${bundle.platform} still carries the local #3153 patch` };
    }
    const markdown = platformMarkdownFromGenerator(read.source);
    if (!markdown) return { state: 'unknown', evidence: `${bundle.platform}: cannot extract the generated ruflo skill` };
    const errors = platformContractViolations(markdown, { requireMarker: false });
    if (errors.length) return { state: 'live', evidence: `platform skill violates the contract: ${errors.join('; ')}` };
  }

  const registry = liveToolProof(bundle.cliRoot);
  if (registry.error) return { state: 'live', evidence: `${bundle.cliRoot}: ${registry.error}` };
  for (const [host, file, templates] of surfaces) {
    const rendered = spawnSync(process.execPath, [
      '--input-type=module', '--eval', RENDER_SCRIPT, host.toLowerCase(), file,
    ], { encoding: 'utf8', timeout: 15000, maxBuffer: 8 * 1024 * 1024 });
    if (rendered.error || rendered.status !== 0) {
      return {
        state: 'unknown',
        evidence: `could not execute ${host} templates in ${bundle.cliRoot}: ${rendered.error?.message || rendered.stderr || `exit ${rendered.status}`}`,
      };
    }
    let group;
    try { group = JSON.parse(rendered.stdout); }
    catch (error) { return { state: 'unknown', evidence: `${host} template proof returned invalid JSON: ${error.message}` }; }
    for (const template of templates) {
      if (typeof group?.[template] !== 'string') {
        return { state: 'live', evidence: `${host} ${template} did not render a string` };
      }
      const errors = instructionContractViolations(group[template]);
      if (errors.length) {
        return { state: 'live', evidence: `${host} ${template} violates the contract: ${errors.join('; ')}` };
      }
    }
    if (host === 'Codex' && (!/Governance Scaffold \(Not an Implemented Control\)/.test(group.enterprise)
        || !/Service Levels \(Unconfigured\)/.test(group.enterprise))) {
      return { state: 'live', evidence: 'Codex enterprise template still presents unproved governance or service levels as implemented' };
    }
  }
  return {
    state: 'superseded',
    evidence: bundle.codex
      ? 'all six Claude and four Codex templates execute the structured contract against the live core registry and schemas'
      : 'all six standalone Claude templates execute the structured contract against the live core registry and schemas',
  };
}

function probeCodexRoot(root) {
  const generator = path.join(root, 'dist', 'generators', 'agents-md.js');
  const read = regularSource(generator);
  if (read.error) return { state: 'unknown', evidence: `Codex generator ${generator}: ${read.error}` };
  if (read.source.includes(PATCH_MARKER)) {
    return { state: 'live', evidence: `${generator} still carries the local #3153 patch` };
  }
  const rendered = spawnSync(process.execPath, [
    '--input-type=module', '--eval', RENDER_SCRIPT, 'codex', generator,
  ], { encoding: 'utf8', timeout: 15000, maxBuffer: 8 * 1024 * 1024 });
  if (rendered.error || rendered.status !== 0) {
    return { state: 'unknown', evidence: `could not execute Codex templates in ${root}: ${rendered.error?.message || rendered.stderr || `exit ${rendered.status}`}` };
  }
  let group;
  try { group = JSON.parse(rendered.stdout); }
  catch (error) { return { state: 'unknown', evidence: `Codex template proof returned invalid JSON: ${error.message}` }; }
  for (const template of CODEX_TEMPLATES) {
    if (typeof group?.[template] !== 'string') return { state: 'live', evidence: `Codex ${template} did not render a string` };
    const errors = instructionContractViolations(group[template]);
    if (errors.length) return { state: 'live', evidence: `Codex ${template} violates the contract: ${errors.join('; ')}` };
  }

  const required = new Set(['memory-management', 'swarm-orchestration', 'sparc-methodology', 'security-audit']);
  for (const name of SKILL_NAMES) {
    const file = path.join(root, '.agents', 'skills', name, 'SKILL.md');
    const skill = regularSource(file);
    if (skill.error) {
      if (required.has(name)) return { state: 'unknown', evidence: `${file}: ${skill.error}` };
      continue;
    }
    if (skill.source.includes(PATCH_MARKER)) {
      return { state: 'live', evidence: `${file} still carries the local #3153 patch` };
    }
    if (skillNameForSource(skill.source) !== name) return { state: 'live', evidence: `${file}: built-in skill identity drifted` };
    const errors = skillContractViolations(skill.source, name, { requireMarker: false });
    if (errors.length) return { state: 'live', evidence: `${file}: ${errors.join('; ')}` };
  }
  return { state: 'superseded', evidence: 'all Codex templates and present built-in skills use the native structured-interface contract' };
}

function check() {
  const bundles = discoverBundles();
  const codexRoots = discoverCodexRoots();
  if (!bundles.length) return { state: 'unknown', evidence: 'no authenticated Ruflo generator bundle found' };
  let claudeSurfaces = 0;
  let codexSurfaces = 0;
  for (const bundle of bundles) {
    if (bundle.claude) claudeSurfaces++;
    if (bundle.codex) codexSurfaces++;
    const verdict = probeBundle(bundle);
    if (verdict.state !== 'superseded') return verdict;
  }
  for (const root of codexRoots) {
    const verdict = probeCodexRoot(root);
    if (verdict.state !== 'superseded') return verdict;
  }
  if (!claudeSurfaces || !codexSurfaces || !codexRoots.length) {
    return {
      state: 'unknown',
      evidence: `native retirement needs both host surfaces and Codex skill assets; found Claude=${claudeSurfaces}, Codex=${codexSurfaces}, Codex packages=${codexRoots.length}`,
    };
  }
  return {
    state: 'superseded',
    evidence: `all ${bundles.length} installed generator bundle(s) and ${codexRoots.length} Codex package(s) prove native root, platform-skill, and built-in-skill contracts`,
  };
}

export const rufloInstructionContractSupersession = {
  issue: 'https://github.com/ruvnet/ruflo/issues/3153',
  replacement: 'Ruflo native shared Claude/Codex structured-interface renderer with all-template schema proof',
  check,
  retire: () => {
    const remaining = readState().pluginTargets.filter((target) => target !== 'ruflo-instruction-contract');
    return reconcile(remaining, ['ruflo-instruction-contract']);
  },
};
