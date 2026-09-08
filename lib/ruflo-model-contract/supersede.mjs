import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { discoverPairs, nativeAgentContract, nativeHooksContract, PATCH_MARKER } from './patcher.mjs';
import { apply } from '../cwd/patch-library.mjs';
import { readState } from '../cwd/state.mjs';

const PROBE = String.raw`
const [agentFile, hooksFile] = process.argv.slice(1);
const agentModule = await import(agentFile + '?proof=' + Date.now());
const hooksModule = await import(hooksFile + '?proof=' + Date.now());
const tool = agentModule.agentTools.find((item) => item.name === 'agent_spawn');
const schema = tool?.inputSchema?.properties?.model;
const accepts = (value) => schema?.type === 'string'
  && (schema.minLength === undefined || value.length >= schema.minLength)
  && (schema.maxLength === undefined || value.length <= schema.maxLength)
  && (!Array.isArray(schema.enum) || schema.enum.includes(value))
  && (!schema.pattern || new RegExp(schema.pattern).test(value));
const route = hooksModule.hooksModelRoute;
process.stdout.write(JSON.stringify({
  astra: accepts('gpt-6-astra'),
  fable: accepts('claude-fable-5'),
  emptyRejected: !accepts(''),
  whitespaceRejected: !accepts('not a model'),
  tierDescription: /tier/i.test(route?.description || ''),
}));
`;

function provePair(pair) {
  let agent;
  let hooks;
  try {
    agent = fs.readFileSync(pair.agent, 'utf8');
    hooks = fs.readFileSync(pair.hooks, 'utf8');
  } catch (error) { return { ok: false, evidence: error.message }; }
  if (agent.includes(PATCH_MARKER) || hooks.includes(PATCH_MARKER)) {
    return { ok: false, evidence: `${pair.cliRoot} still carries the local #3215 patch` };
  }
  if (!nativeAgentContract(agent) || !nativeHooksContract(hooks)) {
    return { ok: false, evidence: `${pair.cliRoot} lacks the complete marker-free exact-ID/tier-boundary contract` };
  }
  const run = spawnSync(process.execPath, ['--input-type=module', '-e', PROBE,
    pathToFileURL(pair.agent).href, pathToFileURL(pair.hooks).href], {
    encoding: 'utf8', timeout: 10000, maxBuffer: 1024 * 1024,
  });
  if (run.error || run.status !== 0) {
    return { ok: false, evidence: `${pair.cliRoot} schema import failed: ${run.error?.message || run.stderr || `exit ${run.status}`}` };
  }
  try {
    const proof = JSON.parse(run.stdout);
    if (proof.astra && proof.fable && proof.emptyRejected && proof.whitespaceRejected
      && proof.tierDescription) return { ok: true };
    return { ok: false, evidence: `${pair.cliRoot} runtime schema proof failed: ${run.stdout}` };
  } catch { return { ok: false, evidence: `${pair.cliRoot} returned malformed schema proof` }; }
}

export const rufloModelContractSupersession = {
  issue: 'https://github.com/ruvnet/ruflo/issues/3215',
  replacement: 'a host-neutral exact-model coordination schema plus an explicit tier-versus-allocation boundary',
  retire: ({ retiring = new Set() } = {}) => {
    const remaining = readState().patchTargets
      .filter((target) => target !== 'ruflo-model-contract' && !retiring.has(target));
    return apply(remaining);
  },
  check() {
    const pairs = discoverPairs();
    if (!pairs.length) return { state: 'unknown', evidence: 'no authenticated @claude-flow/cli installation found' };
    const failures = pairs.map(provePair).filter((proof) => !proof.ok);
    return failures.length
      ? { state: 'live', evidence: failures[0].evidence }
      : { state: 'superseded', evidence: `${pairs.length} installed Ruflo CLI copies accept Astra/Fable exact IDs and expose routing as a caller-allocated tier contract` };
  },
};
