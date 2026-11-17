import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { VENDOR_SPECS } from '../lib/brain-managed-memory-boundary/transforms.mjs';
import { patchSource, reverseSource, isPatched, historicalPatchSource, preflight } from '../lib/brain-hook-timeouts/patcher.mjs';
import { patchSource as captureBudget, isPatched as captureBudgetApplied } from '../lib/brain-capture-budget/patcher.mjs';
const cmd=(id,ms=9000)=>`node -e "spawn({env:process.env,timeout:Number(process.argv[1])})" ${ms} ${id}`;
const row=(command,timeout=10)=>[{hooks:[{type:'command',command,timeout}]}];
const nativeBudget=fs.readFileSync(new URL('./fixtures/brain-session-start-budget-4.7.28.mjs',import.meta.url),'utf8');
const budgetPatch=patchSource(nativeBudget);assert.deepEqual(budgetPatch.missing,[]);
assert.equal(reverseSource(budgetPatch.next),nativeBudget);
const manifests={};
for(const codex of [true,false]) {
  const command=(id,ms)=>codex?cmd(id,ms):`node "\${CLAUDE_PLUGIN_ROOT}/scripts/hook-shim.mjs" ${id} || true`;
  let source=JSON.stringify({description:'Native fixture',hooks:{
    SessionStart:row(command('session-start',7500),8),
    UserPromptSubmit:row(command('ground-ruvnet')),Stop:row(command('session-snapshot Stop')),
    PreCompact:row(command('session-snapshot PreCompact')),SessionEnd:row(command('session-snapshot SessionEnd',2500),codex?3:10),
    PreToolUse:row(command('decision-gate write'),5),PostToolUse:row(command('session-snapshot PostToolUse')),
  }},null,2)+'\n';
  const pristine=source;
  manifests[codex?'codex-hooks.json':'hooks.json']=pristine;
  if(codex)source=captureBudget(source).next;
  const result=patchSource(source);assert.deepEqual(result.missing,[]);
  if(codex) {
    const directory=fs.mkdtempSync(path.join(os.tmpdir(),'brain-timeout-preflight-'));
    const file=path.join(directory,'hooks','codex-hooks.json');
    fs.mkdirSync(path.dirname(file));
    try {
      assert(patchSource(pristine).missing.length,'actual timeout transform still requires capture composition');
      for(const bytes of [pristine,source,result.next]) {
        fs.writeFileSync(file,bytes);
        assert.deepEqual(preflight([file]),{ok:true,errors:[]});
        assert.equal(fs.readFileSync(file,'utf8'),bytes,'preflight never writes');
      }
      for(const mutate of [
        d=>{d.hooks.Stop[0].hooks[0].timeout=11;},
        d=>{d.hooks.PreCompact[0].hooks[0].command=cmd('session-snapshot PreCompact',9001);},
        d=>{d.hooks.Stop[0].hooks[0].command=d.hooks.Stop[0].hooks[0].command.replace('env:process.env,','env:{},');},
        d=>{delete d.hooks.PreCompact;},
      ]) {
        const malformed=JSON.parse(pristine);mutate(malformed);
        fs.writeFileSync(file,JSON.stringify(malformed));
        assert.equal(preflight([file]).ok,false);
      }
      fs.unlinkSync(file);
      assert.equal(preflight([file]).ok,false,'missing member refuses');
      const target=path.join(directory,'original.json');fs.writeFileSync(target,pristine);
      fs.symlinkSync(target,file);
      assert.equal(preflight([file]).ok,false,'symlink refuses');
    } finally {fs.rmSync(directory,{recursive:true,force:true});}
  }
  assert.equal(reverseSource(result.next),source);assert(isPatched(result.next));
  assert.equal(patchSource(result.next).next,result.next);
  const before=JSON.parse(source),after=JSON.parse(result.next);
  for(const event of ['PreToolUse','PostToolUse',...(codex?['SessionEnd']:[])])assert.deepEqual(after.hooks[event],before.hooks[event]);
  assert.equal(after.hooks.UserPromptSubmit[0].hooks[0].timeout,40);
  assert.equal(after.hooks.SessionStart[0].hooks[0].timeout,16);
  if(codex)assert(after.hooks.SessionStart[0].hooks[0].command.includes('" 15500 session-start'));
  // Execute the native derived-sum/deadline functions against the changed manifest.
  // No native runtime import, project resolver or managed store enters this VM.
  const budget=vm.runInNewContext(budgetPatch.next.slice(budgetPatch.next.indexOf('export function sessionStartTimeoutMs'))
    .replaceAll('export ','')+'\n({STAGE_BUDGETS_MS,sumBudgetsMs,sessionStartDeadlineAt,MEASURED_NODE_BOOT_MS})',
    {fs:{readFileSync:()=>JSON.stringify(after)},path,HERE:'/isolated/scripts',HOOKS_JSON_PATH:'/isolated/hooks.json'});
  assert.equal(budget.STAGE_BUDGETS_MS.restore,10000);
  assert.equal(budget.sumBudgetsMs()+budget.MEASURED_NODE_BOOT_MS,13400);
  const options={host:codex?'codex':'claude',env:{},startedAt:1000};
  const deadline=budget.sessionStartDeadlineAt(options);
  assert.equal(deadline,1000+(codex?15250:15750));
  assert(deadline-1000>budget.sumBudgetsMs());
  assert.equal(budget.sessionStartDeadlineAt({...options,env:{RUVNET_SESSION_START_DEADLINE_AT:'4500'}}),4500,
    'shorter inherited absolute deadline still wins');
  for(const event of ['Stop','PreCompact',...(codex?[]:['SessionEnd'])])assert.equal(after.hooks[event][0].hooks[0].timeout,40);
  if(codex){
    assert(captureBudgetApplied(result.next),'prior capture patch remains exactly recognizable');
    for(const [event,outer,inner] of [['UserPromptSubmit',36000,'34000'],['Stop',35000,'33000']]){
      const c=after.hooks[event][0].hooks[0].command;let observed;
      vm.runInNewContext(c.split('"')[1],{process:{env:{},argv:['node',String(outer)]},spawn:x=>observed=x});
      assert.equal(observed.timeout,outer);assert.equal(observed.env.RUVNET_CODEX_HOOK_TIMEOUT_MS,inner);
      assert(c.includes(`" ${outer} `));
    }
  }
  const legacy=result.next.replace(/'34000'/g,"'17000'").replace(/\" 36000 /g,'\" 18000 ');
  const oldManifest=JSON.parse(legacy);
  oldManifest.hooks.UserPromptSubmit[0].hooks[0].timeout=20;
  oldManifest.hooks.SessionStart=before.hooks.SessionStart;
  if(!codex)oldManifest.hooks.SessionEnd[0].hooks[0].timeout=10;
  const old=JSON.stringify(oldManifest,null,2)+'\n';
  assert.equal(historicalPatchSource(source).next,old,'composition engine can prove exact historical bytes');
  assert.equal(patchSource(old).next,result.next,'exact prior timeout profile upgrades without losing other handlers');
  const released158=structuredClone(after);released158.hooks.SessionStart=before.hooks.SessionStart;
  const released158Source=JSON.stringify(released158,null,2)+'\n';
  assert.equal(patchSource(released158Source).next,result.next,'release158 profile upgrades exactly');
  assert.equal(historicalPatchSource(source,released158Source).next,released158Source,'composer proves actual158 source');
  assert(patchSource(source.replace('"timeout": 10','"timeout": 99')).missing.length);
}
for(const source of [
  'export const DEFAULT_DEADLINE_MS = 1900;\nconst budget = Math.min(requested, 1900) : DEFAULT_DEADLINE_MS;',
  'export const CAPTURE_BUDGET_MS = 8_000;',
  'export const STAGE_BUDGETS_MS = {\n  restore: 3500,\n};',
]) {const r=patchSource(source);assert.deepEqual(r.missing,[]);assert.equal(reverseSource(r.next),source);assert(isPatched(r.next));}
assert(patchSource('export const DEFAULT_DEADLINE_MS = 1901;').missing.length);
assert(patchSource('export const STAGE_BUDGETS_MS = {\n  restore: 3501,\n};').missing.length);
// Retained bundle ownership must carry its composition prerequisite across native promotion.
const home=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'brain-timeout-generations-')));
try {
  const brain=path.join(home,'brain');
  const write=(file,bytes)=>{fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,bytes);};
  for(const version of ['4.7.27','4.7.28','4.7.30']) {
    const root=path.join(brain,'versions',version);
    for(const relative of [...VENDOR_SPECS.map(s=>s.relative),'scripts/hook-input.mjs'])write(path.join(root,relative),'// native fixture\n');
    write(path.join(root,'.claude-plugin/plugin.json'),JSON.stringify({name:'ruvnet-brain',version}));
    for(const [name,bytes] of Object.entries(manifests))write(path.join(root,'hooks',name),bytes);
    const recall='export const DEFAULT_DEADLINE_MS = 1900;\nconst budget = Math.min(requested, 1900) : DEFAULT_DEADLINE_MS;';
    write(path.join(root,'scripts/agentdb-recall.mjs'),version==='4.7.28'?patchSource(recall).next:recall);
    write(path.join(root,'scripts/session-snapshot-hook.mjs'),'export const CAPTURE_BUDGET_MS = 8_000;');
    write(path.join(root,'scripts/session-start-budget.mjs'),nativeBudget);
  }
  const active=JSON.stringify({version:'4.7.30',codeRoot:'versions/4.7.30'});
  write(path.join(brain,'active.json'),active);
  const capture=fileURLToPath(new URL('../lib/brain-capture-budget/patcher.mjs',import.meta.url));
  const compose=fileURLToPath(new URL('../lib/plugin-compose.mjs',import.meta.url));
  const code=`import assert from 'node:assert/strict';import fs from 'node:fs';
    import {discover} from ${JSON.stringify(capture)};import {applyComposed} from ${JSON.stringify(compose)};
    const files=discover();assert(files.some(f=>f.includes('/4.7.28/')));assert(!files.some(f=>f.includes('/4.7.27/')));
    const targets=['brain-capture-budget','brain-hook-timeouts'];
    const first=applyComposed(targets,{cliTargets:[]});assert.equal(first.errors,0,JSON.stringify(first));assert.equal(first.incomplete,0,JSON.stringify(first));
    const second=applyComposed(targets,{cliTargets:[]});assert.equal(second.patched,0,JSON.stringify(second));assert.equal(second.incomplete,0,JSON.stringify(second));
    assert.equal(fs.readFileSync(${JSON.stringify(path.join(brain,'active.json'))},'utf8'),${JSON.stringify(active)});`;
  const result=spawnSync(process.execPath,['--input-type=module','-e',code],{encoding:'utf8',env:{...process.env,
    RUFLO_SOURCE_PATCH_HOME:home,RSP_RUVNET_BRAIN_HOME:brain,RSP_CODEX_HOME:path.join(home,'codex'),
    RSP_RUVNET_BRAIN_MARKETPLACE:path.join(home,'empty-marketplace'),RSP_RUVNET_BRAIN_RUNTIME:path.join(home,'empty-runtime'),
    RUFLO_GLOBAL_ROOT:path.join(home,'empty-global'),RUFLO_NPX_ROOT:path.join(home,'empty-npx')}});
  assert.equal(result.status,0,result.stderr);
} finally {fs.rmSync(home,{recursive:true,force:true});}
console.log('temporary hook timeouts: scoped, bounded, reversible; restore10000/host16000/Codex15500; SessionEnd and other hooks unchanged');
