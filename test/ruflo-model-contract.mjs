import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

const input = process.argv[2] || fs.mkdtempSync(path.join(os.tmpdir(), 'ruflo-model-contract-'));
fs.mkdirSync(input, { recursive: true });
const SANDBOX = fs.realpathSync(input);
const NODE_MODULES = path.join(SANDBOX, 'node_modules');
const CLI_ROOT = path.join(NODE_MODULES, 'ruflo', 'node_modules', '@claude-flow', 'cli');
const TOOL_ROOT = path.join(CLI_ROOT, 'dist', 'src', 'mcp-tools');
process.env.RUFLO_SOURCE_PATCH_HOME = SANDBOX;
process.env.RUFLO_GLOBAL_ROOT = NODE_MODULES;
process.env.RUFLO_NPX_ROOT = path.join(SANDBOX, 'empty-npx');
process.env.RSP_NO_LAUNCHCTL = '1';
process.env.RSP_NO_SELF_UPDATE = '1';

const patcher = await import('../lib/ruflo-model-contract/patcher.mjs');
const supersede = await import('../lib/ruflo-model-contract/supersede.mjs');
const { apply, inspect } = await import('../lib/cwd/patch-library.mjs');

let fail = 0;
const check = (description, condition) => {
  console.log(`${condition ? '✓' : '✘'} ${description}`);
  if (!condition) fail = 1;
};

const AGENT_VENDOR = `export const agentTools = [{
    name: 'agent_spawn',
    inputSchema: {
        type: 'object',
        properties: {
            agentType: { type: 'string' },
${patcher.AGENT_MODEL_ANCHOR}
            task: { type: 'string' },
        },
        required: ['agentType'],
    },
    handler: async (input) => {
        const config = input.config || {};
        if (input.model) {
            config.model = input.model;
        }
        const explicitModel = config.model;
        const routingResult = ['haiku', 'sonnet', 'opus', 'opus-4.7', 'inherit'].includes(explicitModel)
            ? { model: explicitModel, routedBy: 'explicit' }
            : (() => { return { model: 'sonnet', routedBy: 'explicit', modelId: explicitModel }; })();
        return { model: routingResult.model, modelId: routingResult.modelId, config };
    },
}];
`;

const HOOKS_VENDOR = `export const hooksModelRoute = {
    name: 'hooks_model-route',
${patcher.ROUTE_DESCRIPTION_ANCHOR}
    inputSchema: { type: 'object', properties: { task: { type: 'string' } }, required: ['task'] },
    handler: async (params) => {
        if (params.fallback) {
            const complexity = 0.8;
            return {
${patcher.FALLBACK_MODEL_ANCHOR}
                confidence: 0.7,
            };
        }
        const result = { model: 'sonnet', confidence: 0.9 };
        return {
${patcher.ROUTER_MODEL_ANCHOR}
        };
    },
};
`;

fs.mkdirSync(TOOL_ROOT, { recursive: true });
fs.writeFileSync(path.join(NODE_MODULES, 'ruflo', 'package.json'), '{"name":"ruflo","version":"fixture"}\n');
fs.writeFileSync(path.join(CLI_ROOT, 'package.json'), '{"name":"@claude-flow/cli","version":"fixture","type":"module"}\n');
const agentFile = path.join(TOOL_ROOT, 'agent-tools.js');
const hooksFile = path.join(TOOL_ROOT, 'hooks-tools.js');
fs.writeFileSync(agentFile, AGENT_VENDOR);
fs.writeFileSync(hooksFile, HOOKS_VENDOR);

const applied = apply(['ruflo-model-contract']);
const agentPatched = fs.readFileSync(agentFile, 'utf8');
const hooksPatched = fs.readFileSync(hooksFile, 'utf8');
check('RMC1 the two-file model contract applies through shared CLI composition',
  applied.patched === 2 && applied.incomplete === 0
    && patcher.isPatched(agentPatched) && patcher.isPatched(hooksPatched));
check('RMC2 exact vendor bytes are backed up once',
  fs.readFileSync(`${agentFile}.rsp-backup`, 'utf8') === AGENT_VENDOR
    && fs.readFileSync(`${hooksFile}.rsp-backup`, 'utf8') === HOOKS_VENDOR);

const agentApi = await import(`${pathToFileURL(agentFile).href}?patched=${Date.now()}`);
const hooksApi = await import(`${pathToFileURL(hooksFile).href}?patched=${Date.now()}`);
const schema = agentApi.agentTools[0].inputSchema.properties.model;
const accepts = (value) => value.length >= schema.minLength && value.length <= schema.maxLength
  && new RegExp(schema.pattern).test(value);
const astra = await agentApi.agentTools[0].handler({ agentType: 'architect', model: 'gpt-6-astra' });
const fable = await agentApi.agentTools[0].handler({ agentType: 'reviewer', model: 'claude-fable-5' });
const fallback = await hooksApi.hooksModelRoute.handler({ task: 'hard', fallback: true });
const routed = await hooksApi.hooksModelRoute.handler({ task: 'medium' });
check('RMC3 public schema and handler preserve exact Astra/Fable identities',
  schema.type === 'string' && schema.enum === undefined
    && accepts('gpt-6-astra') && accepts('claude-fable-5')
    && !accepts('') && !accepts('not a model')
    && astra.modelId === 'gpt-6-astra' && fable.modelId === 'claude-fable-5');
check('RMC4 both router paths disclose legacy tier and caller-owned allocation',
  fallback.routingTier === 'opus' && fallback.allocationOwner === 'caller'
    && routed.routingTier === 'sonnet' && routed.allocationOwner === 'caller');

const second = apply(['ruflo-model-contract']);
check('RMC5 reapply is idempotent and status covers both files',
  second.patched === 0 && second.unchanged === 2
    && inspect()['ruflo-model-contract'].patched === 2);
if (second.patched !== 0 || second.unchanged !== 2 || inspect()['ruflo-model-contract'].patched !== 2) {
  console.log(JSON.stringify({ second, inspected: inspect()['ruflo-model-contract'] }, null, 2));
}
const restored = apply([]);
check('RMC6 uninstall restores both vendor files byte-for-byte',
  restored.errors === 0 && fs.readFileSync(agentFile, 'utf8') === AGENT_VENDOR
    && fs.readFileSync(hooksFile, 'utf8') === HOOKS_VENDOR);
if (restored.errors !== 0 || fs.readFileSync(agentFile, 'utf8') !== AGENT_VENDOR
  || fs.readFileSync(hooksFile, 'utf8') !== HOOKS_VENDOR) {
  console.log(JSON.stringify({ restored }, null, 2));
}

apply(['ruflo-model-contract']);
const RECOVERY_ROOT = path.join(NODE_MODULES, 'ruflo', 'node_modules', '@claude-flow', '.cli-recovery');
const RECOVERY_TOOLS = path.join(RECOVERY_ROOT, 'dist', 'src', 'mcp-tools');
fs.mkdirSync(RECOVERY_TOOLS, { recursive: true });
fs.writeFileSync(path.join(RECOVERY_ROOT, 'package.json'),
  '{"name":"@claude-flow/cli","version":"fixture","type":"module"}\n');
const recoveryAgentFile = path.join(RECOVERY_TOOLS, 'agent-tools.js');
const recoveryHooksFile = path.join(RECOVERY_TOOLS, 'hooks-tools.js');
fs.writeFileSync(recoveryAgentFile, AGENT_VENDOR);
fs.writeFileSync(recoveryHooksFile, HOOKS_VENDOR);
fs.rmSync(`${hooksFile}.rsp-backup`, { force: true });
const recovered = apply(['ruflo-model-contract']);
check('RMC7 a missing pristine is recovered only by exact same-version composition proof',
  recovered.incomplete === 0
    && recovered.log.some((line) => line.startsWith(`recovered-pristine ${hooksFile} from ${recoveryHooksFile}`))
    && fs.readFileSync(`${hooksFile}.rsp-backup`, 'utf8') === HOOKS_VENDOR
    && patcher.isPatched(fs.readFileSync(hooksFile, 'utf8')));
apply([]);

const mutation = AGENT_VENDOR.replace("enum: ['haiku', 'sonnet', 'opus', 'opus-4.7', 'inherit'],",
  "enum: ['haiku', 'sonnet', 'opus'],");
fs.writeFileSync(agentFile, mutation);
const refused = apply(['ruflo-model-contract']);
check('RMC8 an unknown restricted schema is refused and makes the target incomplete',
  refused.incomplete > 0 && fs.readFileSync(agentFile, 'utf8') === mutation);
apply([]);
fs.writeFileSync(agentFile, AGENT_VENDOR);
fs.writeFileSync(hooksFile, HOOKS_VENDOR);

fs.mkdirSync(path.join(SANDBOX, '.claude'), { recursive: true });
fs.writeFileSync(path.join(SANDBOX, '.claude', 'settings.json'), '{}\n');
const cli = path.resolve('bin/cli.mjs');
const cliEnv = { ...process.env, RSP_NO_HOST_AUTO_UPDATE: '1' };
const install = spawnSync(process.execPath, [cli, 'ruflo-model-contract', 'install'], { env: cliEnv, encoding: 'utf8' });
const status = spawnSync(process.execPath, [cli, 'ruflo-model-contract', 'status'], { env: cliEnv, encoding: 'utf8' });
const uninstall = spawnSync(process.execPath, [cli, 'ruflo-model-contract', 'uninstall'], { env: cliEnv, encoding: 'utf8' });
const lifecycleOk =
  install.status === 0 && status.status === 0 && uninstall.status === 0
    && status.stdout.includes('4/4 file(s) satisfied')
    && fs.readFileSync(agentFile, 'utf8') === AGENT_VENDOR
    && fs.readFileSync(hooksFile, 'utf8') === HOOKS_VENDOR;
check('RMC9 public install/status/uninstall tracks and restores the target', lifecycleOk);
if (!lifecycleOk) console.log(JSON.stringify({ install, status, uninstall }, null, 2));

const nativeAgent = patcher.patchSource(AGENT_VENDOR).next.replaceAll(patcher.PATCH_MARKER, 'upstream contract');
const nativeHooks = patcher.patchSource(HOOKS_VENDOR).next.replaceAll(patcher.PATCH_MARKER, 'upstream contract');
fs.writeFileSync(agentFile, nativeAgent);
fs.writeFileSync(hooksFile, nativeHooks);
const native = supersede.rufloModelContractSupersession.check();
check('RMC10 marker-free native behavior retires the patch', native.state === 'superseded');
fs.writeFileSync(hooksFile, nativeHooks.replaceAll("allocationOwner: 'caller'", "allocationOwner: 'ruflo'"));
check('RMC11 a regression that reclaims allocation cannot retire',
  supersede.rufloModelContractSupersession.check().state !== 'superseded');

const unrelatedClaims = nativeHooks
  .replaceAll("allocationOwner: 'caller'", "allocationOwner: 'ruflo'")
  + "\nexport const unrelated = [{ allocationOwner: 'caller', routingTier: 'opus' }, { allocationOwner: 'caller', routingTier: 'sonnet' }];\n";
fs.writeFileSync(hooksFile, unrelatedClaims);
check('RMC12 unrelated allocation fields cannot satisfy the hooks_model-route retirement proof',
  supersede.rufloModelContractSupersession.check().state !== 'superseded');

process.exit(fail);
