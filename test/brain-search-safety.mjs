// RuvNet Brain #224/#225: source symbol routing must ignore inherited/malformed
// table entries, and a generic retrieval failure must never prescribe an
// unproved npm install or GitHub download. Exercise exact-anchor composition,
// executable routing behavior, mutation refusal, CLI lifecycle, and retirement.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const input = process.argv[2] || fs.mkdtempSync(path.join(os.tmpdir(), 'brain-search-safety-'));
fs.mkdirSync(input, { recursive: true });
const SANDBOX = fs.realpathSync(input);
const BRAIN_HOME = path.join(SANDBOX, '.cache', 'ruvnet-brain');
const KB = path.join(BRAIN_HOME, 'kb');
process.env.RUFLO_SOURCE_PATCH_HOME = SANDBOX;
process.env.RSP_RUVNET_BRAIN_HOME = BRAIN_HOME;
process.env.RSP_RUVNET_BRAIN_KB = KB;
process.env.RSP_NO_LAUNCHCTL = '1';
process.env.RSP_NO_SELF_UPDATE = '1';

const patcher = await import('../lib/brain-search-safety/patcher.mjs');
const supersede = await import('../lib/brain-search-safety/supersede.mjs');
const { applyComposed, reconcile, statusComposed } = await import('../lib/plugin-compose.mjs');

let fail = 0;
const check = (description, condition) => {
  console.log(`${condition ? '✓' : '✘'} ${description}`);
  if (!condition) fail = 1;
};

const ROUTER_VENDOR = `#!/usr/bin/env node
const SYM_STOP = new Set(['does','data','code','what','where','which','this','that','with','from','into','your','their','how','the','and','for','project','package','implement','implemented','implementation','source','file','files','work','works','used','uses','using','support','system','store','stores','recall','persist']);
function symbolRoute(query, sym) {
  const out = new Set();
  if (!sym) return out;
  const q = query.toLowerCase();
  const ids = q.match(/[a-z][a-z0-9_]+/g) || [];
  const snake = ids.filter((t) => t.includes('_') && t.length >= 5);
  const words = ids.filter((t) => !t.includes('_') && t.length >= 4 && !SYM_STOP.has(t));
  const pkgs = (q.match(/@[\\w-]+\\/([\\w-]+)/g) || []).map((s) => s.split('/')[1].toLowerCase());
${patcher.ROUTE_ANCHOR}
  return out;
}
const VENDORED_DEP_RE = /patches/;
`;

const MCP_VENDOR = `#!/usr/bin/env node
function outage(id, repos, firstErr) {
          const body =
            \`🚨🚨🚨 RUVNET BRAIN IS DOWN — ALL \${repos.length} repos failed to search. 🚨🚨🚨\\n\\n\`
            + \`This is NOT an empty result. Retrieval itself is broken; no RuvNet grounding is possible right now.\\n\`
            + \`First error: \${firstErr}\\n\\n\`
            + \`Most likely fix:  cd ~/.cache/ruvnet-brain/kb && npm i\\n\`
            + \`Then verify:      npx github:stuinfla/ruvnet-brain --doctor\\n\\n\`
            + \`➡ INSTRUCTION TO THE MODEL: tell the user PLAINLY and PROMINENTLY, before anything else, \`
            + \`that the RuvNet Brain is broken and needs the fix above. Do NOT answer RuvNet questions \`
            + \`from memory, and do NOT proceed as if this were a normal empty search.\`;
  return { id, content: [{ type: 'text', text: body }], isError: true };
}
`;

const CLI_VENDOR = `#!/usr/bin/env node
function outage(failed) {
  console.error('First error: ' + failed[0][1]);
${patcher.CLI_GUIDANCE_ANCHOR}
  process.exit(1);
}
`;

fs.mkdirSync(KB, { recursive: true });
fs.writeFileSync(path.join(KB, 'package.json'), '{"name":"ruvnet-brain-kb","version":"fixture"}\n');
const files = {
  router: path.join(KB, 'forge-ask.mjs'),
  mcp: path.join(KB, 'forge-mcp-all.mjs'),
  cli: path.join(KB, 'forge-ask-all.mjs'),
};
fs.writeFileSync(files.router, ROUTER_VENDOR);
fs.writeFileSync(files.mcp, MCP_VENDOR);
fs.writeFileSync(files.cli, CLI_VENDOR);

const applied = applyComposed(['brain-search-safety']);
const patched = Object.fromEntries(Object.entries(files).map(([key, file]) => [key, fs.readFileSync(file, 'utf8')]));
check('BSS1 all three active shared-KB executable files are patched atomically per file',
  applied.patched === 3
    && Object.values(patched).every((source) => source.includes(patcher.PATCH_MARKER)));
check('BSS2 every vendor file has one exact pristine backup',
  fs.readFileSync(`${files.router}.rsp-backup`, 'utf8') === ROUTER_VENDOR
    && fs.readFileSync(`${files.mcp}.rsp-backup`, 'utf8') === MCP_VENDOR
    && fs.readFileSync(`${files.cli}.rsp-backup`, 'utf8') === CLI_VENDOR);

const routeProof = supersede.probeSymbolRouteSource(patched.router);
check('BSS3 constructor, own constructor, and malformed values pass the executable routing proof',
  routeProof.state === 'proven');
check('BSS4 generic MCP/CLI failures stay loud without npm/GitHub repair instructions',
  supersede.safeMcpFailureGuidance(patched.mcp)
    && supersede.safeCliFailureGuidance(patched.cli)
    && !patched.mcp.includes('cd ~/.cache/ruvnet-brain/kb && npm i')
    && !patched.mcp.includes('npx github:stuinfla/ruvnet-brain')
    && !patched.cli.includes('cd ~/.cache/ruvnet-brain/kb && npm i')
    && !patched.cli.includes('npx github:stuinfla/ruvnet-brain'));
const second = applyComposed(['brain-search-safety']);
check('BSS5 re-apply is idempotent and status covers all three files',
  second.patched === 0
    && second.unchanged === 3
    && statusComposed()['brain-search-safety'].patched === 3);

const restored = reconcile([], ['brain-search-safety']);
check('BSS6 uninstall restores every executable byte-for-byte',
  restored.errors === 0
    && fs.readFileSync(files.router, 'utf8') === ROUTER_VENDOR
    && fs.readFileSync(files.mcp, 'utf8') === MCP_VENDOR
    && fs.readFileSync(files.cli, 'utf8') === CLI_VENDOR);

const mutation = ROUTER_VENDOR.replace(
  'push(sym.byStem[t]);',
  'push(sym.byStem?.[t]);',
);
fs.writeFileSync(files.router, mutation);
const refused = applyComposed(['brain-search-safety']);
check('BSS7 an anchor drift that leaves constructor vulnerable is refused without a partial write',
  refused.incomplete === 1
    && fs.readFileSync(files.router, 'utf8') === mutation
    && supersede.probeSymbolRouteSource(mutation).state !== 'proven');
fs.writeFileSync(files.router, ROUTER_VENDOR);

fs.mkdirSync(path.join(SANDBOX, '.claude'), { recursive: true });
fs.writeFileSync(path.join(SANDBOX, '.claude', 'settings.json'), '{}\n');
const cli = path.resolve('bin/cli.mjs');
const cliEnv = {
  ...process.env,
  RUFLO_SOURCE_PATCH_HOME: SANDBOX,
  RSP_RUVNET_BRAIN_HOME: BRAIN_HOME,
  RSP_RUVNET_BRAIN_KB: KB,
  RSP_NO_LAUNCHCTL: '1',
  RSP_NO_SELF_UPDATE: '1',
};
const install = spawnSync(process.execPath, [cli, 'brain-search-safety', 'install'], {
  env: cliEnv, encoding: 'utf8',
});
const status = spawnSync(process.execPath, [cli, 'brain-search-safety', 'status'], {
  env: cliEnv, encoding: 'utf8',
});
const uninstall = spawnSync(process.execPath, [cli, 'brain-search-safety', 'uninstall'], {
  env: cliEnv, encoding: 'utf8',
});
check('BSS8 public install/status/uninstall tracks, reports, and restores the target',
  install.status === 0
    && status.status === 0
    && status.stdout.includes('3/3 file(s) patched')
    && status.stdout.includes('tracked')
    && uninstall.status === 0
    && fs.readFileSync(files.router, 'utf8') === ROUTER_VENDOR
    && fs.readFileSync(files.mcp, 'utf8') === MCP_VENDOR
    && fs.readFileSync(files.cli, 'utf8') === CLI_VENDOR);
if (install.status !== 0 || status.status !== 0 || uninstall.status !== 0) {
  console.log(JSON.stringify({ install, status, uninstall }, null, 2));
}

const nativeRouter = patcher.patchSource(ROUTER_VENDOR).next.replace(`${patcher.PATCH_MARKER}: `, 'upstream: ');
const nativeMcp = patcher.patchSource(MCP_VENDOR).next.replace(`${patcher.PATCH_MARKER}: `, 'upstream: ');
const nativeCli = patcher.patchSource(CLI_VENDOR).next.replace(`${patcher.PATCH_MARKER}: `, 'upstream: ');
fs.writeFileSync(files.router, nativeRouter);
fs.writeFileSync(files.mcp, nativeMcp);
fs.writeFileSync(files.cli, nativeCli);
const nativeVerdict = supersede.brainSearchSafetySupersession.check();
check('BSS9 marker-free native equivalents pass behavior and guidance retirement proof',
  nativeVerdict.state === 'superseded');

const inheritedRegression = nativeRouter.replace(
  'Object.hasOwn(table, key)',
  'table[key]',
);
fs.writeFileSync(files.router, inheritedRegression);
check('BSS10 a constructor regression cannot retire on safe-looking text alone',
  supersede.brainSearchSafetySupersession.check().state !== 'superseded');
fs.writeFileSync(files.router, nativeRouter);

const { writeState, readState } = await import('../lib/cwd/state.mjs');
const { retireSuperseded } = await import('../lib/supersede.mjs');
writeState({ patchTargets: [], pluginTargets: ['brain-search-safety'], retired: {}, all: false });
const retirement = retireSuperseded(readState());
const retiredState = readState();
check('BSS11 proven native replacement retires terminally and preserves upstream bytes',
  retirement.retired === 1
    && !retiredState.pluginTargets.includes('brain-search-safety')
    && retiredState.retired['brain-search-safety']?.issue
      === 'https://github.com/stuinfla/ruvnet-brain/issues/224'
    && fs.readFileSync(files.router, 'utf8') === nativeRouter
    && fs.readFileSync(files.mcp, 'utf8') === nativeMcp
    && fs.readFileSync(files.cli, 'utf8') === nativeCli);
if (retirement.retired !== 1 || retiredState.pluginTargets.includes('brain-search-safety')) {
  console.log(JSON.stringify({ retirement, retiredState, after: supersede.brainSearchSafetySupersession.check() }, null, 2));
}

process.exit(fail);
