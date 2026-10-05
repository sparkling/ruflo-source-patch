// Execute the actual protocol shell with synthetic immutable generations.
// Fixture modules record literal dispatch; no updater, CLI workload or DB opens.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { spawn, spawnSync } from 'node:child_process';
import { discover, hasPatch, nativeSatisfied } from './patcher.mjs';
import { composeSource, isOurs } from '../plugin-compose.mjs';
import { readState } from '../cwd/state.mjs';
import { existingPathRelative } from '../path-containment.mjs';

const MANAGED = `import fs from 'node:fs';import {fileURLToPath} from 'node:url';
export const MANAGED_CLI_TOOLS=[];
export function helpKey(executable,argv){if(typeof executable!=='string'||!Array.isArray(argv)||argv.some(x=>typeof x!=='string'))throw Error('invalid literal argv');return [executable,...argv.filter(x=>/^[a-z][a-z0-9-]*$/.test(x)).slice(0,2)].join('.');}
export function stampKeysForHelp(executable,argv){if(argv.length>2||argv.some(x=>!(/^[a-z][a-z0-9-]*$/.test(x))))throw Error('invalid help');return [helpKey(executable,argv),...(argv.length===2?[[executable,argv[0]].join('.')]:[])];}
export async function callManagedCli(name,args){
 const owner=fileURLToPath(new URL('../',import.meta.url));
 const manifest=JSON.parse(fs.readFileSync(new URL('../.claude-plugin/plugin.json',import.meta.url),'utf8'));
 fs.appendFileSync(process.env.RSP_FIXTURE_CALLS,JSON.stringify({owner,name,args})+'\\n');
 if(args?.argv?.[0]==='fail')return {isError:true,content:[{type:'text',text:'native help failed'}]};
 if(args?.argv?.[0]==='slow')await new Promise(r=>setTimeout(r,80));
 return {isError:false,content:[{type:'text',text:JSON.stringify({owner,version:manifest.version,name,args})}]};
}
`;
const write = (file, value) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, value); };
export async function exerciseGenerationServer(source, root) {
  fs.mkdirSync(root, { recursive: true });
  root = fs.realpathSync(root);
  const home = path.join(root, 'brain'), active = path.join(home, 'active.json');
  const shell = path.join(root, 'persistent');
  write(path.join(shell, 'mcp/server.mjs'), source);
  write(path.join(shell, 'mcp/managed-cli-interface.mjs'), MANAGED);
  write(path.join(shell, 'scripts/mcp-readiness.mjs'), 'export const writeOwn=()=>{};');
  write(path.join(shell, 'scripts/brain-location.mjs'), 'export const unmountedNotice=()=>null;');
  write(path.join(shell, 'mcp/managed-memory-diagnostic.mjs'), 'export const MANAGED_MEMORY_DIAGNOSTIC_TOOL={name:"fixture"};export const callManagedMemoryDiagnostic=()=>({});');
  const generation = version => {
    const selected = path.join(home, 'versions', version);
    write(path.join(selected, '.claude-plugin/plugin.json'), JSON.stringify({ name: 'ruvnet-brain', version }));
    write(path.join(selected, 'mcp/managed-cli-interface.mjs'), MANAGED);
    return selected;
  };
  const a = generation('4.5.4'), b = generation('4.5.5');
  const select = (version, codeRoot = 'versions/' + version) => write(active, JSON.stringify({ version, codeRoot }));
  select('4.5.4');
  const callsFile = path.join(root, 'calls.jsonl');
  const child = spawn(process.execPath, [path.join(shell, 'mcp/server.mjs')], {
    cwd: root, env: { HOME: root, PATH: process.env.PATH || '', RUVNET_BRAIN_HOME: home, RSP_FIXTURE_CALLS: callsFile },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const waiting = new Map(); let seq = 0, stderr = '';
  child.stderr.on('data', chunk => { stderr += chunk; });
  const lines = readline.createInterface({ input: child.stdout });
  lines.on('line', line => { const reply = JSON.parse(line); const item = waiting.get(reply.id); if (item) { clearTimeout(item.timer); waiting.delete(reply.id); item.resolve(reply); } });
  const rpc = (name, args = { executable: 'ruflo', argv: ['status'] }) => new Promise((resolve, reject) => {
    const id = ++seq, timer = setTimeout(() => { waiting.delete(id); reject(Error('fixture MCP deadline: ' + stderr)); }, 1500);
    waiting.set(id, { resolve, timer }); child.stdin.write(JSON.stringify({ id, method: 'tools/call', params: { name, arguments: args } }) + '\n');
  });
  const calls = () => fs.existsSync(callsFile) ? fs.readFileSync(callsFile, 'utf8').trim().split('\n').map(JSON.parse) : [];
  const refused = reply => assert.equal(reply.result?.isError, true, JSON.stringify(reply));
  const ok = reply => { assert.equal(reply.result?.isError, false, JSON.stringify(reply)); return JSON.parse(reply.result.content[0].text); };
  try {
    refused(await rpc('ruvnet_cli_run')); assert.equal(calls().length, 0, 'missing current help never reaches native execution');
    const help = ok(await rpc('ruvnet_cli_help')); assert.equal(help.owner, a + path.sep);
    const args = { executable: 'ruflo', argv: ['status', '--literal', '$(not-a-shell)', 'space value'], extra: { preserved: true } };
    assert.deepEqual(ok(await rpc('ruvnet_cli_run', args)).args, args, 'literal arguments and extras are preserved');
    const activeBytes = fs.readFileSync(active, 'utf8');
    select('4.5.5'); refused(await rpc('ruvnet_cli_run')); assert.equal(calls().filter(x => x.name === 'ruvnet_cli_run').length, 1);
    assert.equal(ok(await rpc('ruvnet_cli_help')).owner, b + path.sep);
    assert.equal(ok(await rpc('ruvnet_cli_run')).version, '4.5.5');
    const failed = { executable: 'ruflo', argv: ['fail'] };
    refused(await rpc('ruvnet_cli_help', failed)); const afterFailedHelp = calls().length;
    refused(await rpc('ruvnet_cli_run', failed)); assert.equal(calls().length, afterFailedHelp, 'failed help grants no execution authorization');
    const slow = rpc('ruvnet_cli_help', { executable: 'ruflo', argv: ['slow'] });
    await new Promise(resolve => setTimeout(resolve, 20)); select('4.5.4');
    assert.equal(ok(await rpc('ruvnet_cli_help')).version, '4.5.4'); await slow;
    refused(await rpc('ruvnet_cli_run', { executable: 'ruflo', argv: ['slow'] }), 'old in-flight help cannot authorize the new owner');
    assert.equal(ok(await rpc('ruvnet_registry_latest')).owner, a + path.sep, 'registry uses selected native owner too');
    const count = calls().length;
    for (const invalid of [null, { version: '4.5.4', codeRoot: '../persistent' }, { version: 'wrong', codeRoot: 'versions/4.5.4' }]) {
      write(active, JSON.stringify(invalid)); refused(await rpc('ruvnet_cli_help'));
    }
    select('4.5.4'); const manifest = path.join(a, '.claude-plugin/plugin.json');
    const original = fs.readFileSync(manifest, 'utf8'); fs.rmSync(manifest); refused(await rpc('ruvnet_cli_help'));
    write(manifest, JSON.stringify({ name: 'other-brain', version: '4.5.4' })); refused(await rpc('ruvnet_cli_help')); write(manifest, original);
    const external = path.join(root, 'external.mjs'); write(external, MANAGED);
    const member = path.join(a, 'mcp/managed-cli-interface.mjs'); fs.rmSync(member); fs.symlinkSync(external, member); refused(await rpc('ruvnet_cli_help'));
    fs.rmSync(member); write(member, MANAGED);
    const mcp = path.join(a, 'mcp'); fs.renameSync(mcp, path.join(root, 'external-mcp')); fs.symlinkSync(path.join(root, 'external-mcp'), mcp); refused(await rpc('ruvnet_cli_help'));
    assert.equal(calls().length, count, 'invalid identities never reach any handler');
    assert.equal(calls().every(call => call.owner === a + path.sep || call.owner === b + path.sep), true);
    assert.equal(activeBytes, JSON.stringify({ version: '4.5.4', codeRoot: 'versions/4.5.4' }), 'selector writes are fixture-controlled only');
    return { selectedNativeOwner: true, missingManifestRefused: true, escapedMemberRefused: true, promotionReauthorizes: true, literalArgs: true, calls: calls().length };
  } finally { child.stdin.end(); await new Promise(resolve => child.once('exit', resolve)); lines.close(); }
}

export function probeManagedCliGenerationReplacement({ files = discover(), installed } = {}) {
  let temporary;
  try {
    if (!files.length) return { state: 'unknown', evidence: 'no native Brain protocol shells selected' };
    temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'rsp-managed-generation-proof-'));
    const state = readState(); installed ??= [...new Set([...state.patchTargets, ...state.pluginTargets])];
    for (let index = 0; index < files.length; index++) {
      const file = files[index], root = path.dirname(path.dirname(file));
      const regular = candidate => { const stat = fs.lstatSync(candidate); if (!stat.isFile() || stat.isSymbolicLink() || !stat.size || existingPathRelative(root, candidate) === null) throw Error('unsafe native shell or backup'); };
      regular(file); const current = fs.readFileSync(file, 'utf8'); let source = current;
      if (hasPatch(current)) return { state: 'live', evidence: 'local generation dispatch cannot prove upstream replacement' };
      if (isOurs(current, installed)) {
        const backup = file + '.rsp-backup'; regular(backup); source = fs.readFileSync(backup, 'utf8');
        if (source.includes('ruflo-source-patch') || composeSource(source, installed, { file }) !== current) throw Error('unproved native shell composition');
      } else if (current.includes('ruflo-source-patch')) throw Error('untracked native shell modification');
      const modular = nativeSatisfied(source);
      const fixture = path.join(temporary, 'source-' + index + '.json');
      let input = source;
      if (modular) {
        const readMember = relative => { const member = path.join(root, relative); regular(member); return fs.readFileSync(member, 'utf8'); };
        input = { server: source, dispatcher: readMember('mcp/managed-cli-generation.mjs'), managed: readMember('mcp/managed-cli-interface.mjs') };
      }
      fs.writeFileSync(fixture, JSON.stringify(input));
      const proofModule = modular ? new URL('./native-probe.mjs', import.meta.url).href : import.meta.url;
      const proofFunction = modular ? 'exerciseNativeGeneration' : 'exerciseGenerationServer';
      const result = spawnSync(process.execPath, ['--input-type=module', '-e',
        `import fs from 'node:fs';import {${proofFunction}} from ${JSON.stringify(proofModule)};await ${proofFunction}(JSON.parse(fs.readFileSync(process.argv[1],'utf8')),process.argv[2]);`,
        fixture, path.join(temporary, String(index))], { encoding: 'utf8', timeout: 6000, env: { HOME: temporary, PATH: process.env.PATH || '' } });
      if (result.error || result.status !== 0) return { state: 'live', evidence: 'native managed generation proof failed: ' + (result.error?.message || result.stderr || result.status) };
    }
    return { state: 'superseded', evidence: `${files.length} pristine native shells pass actual generation ownership, current successful help, concurrent promotion and strict manifest/path refusal` };
  } catch (error) { return { state: 'unknown', evidence: error.message }; }
  finally { if (temporary) fs.rmSync(temporary, { recursive: true, force: true }); }
}
