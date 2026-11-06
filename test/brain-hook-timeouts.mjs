import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import { patchSource, reverseSource, isPatched, historicalPatchSource } from '../lib/brain-hook-timeouts/patcher.mjs';
import { patchSource as captureBudget, isPatched as captureBudgetApplied } from '../lib/brain-capture-budget/patcher.mjs';
const cmd=(id,ms=9000)=>`node -e "spawn({env:process.env,timeout:Number(process.argv[1])})" ${ms} ${id}`;
const row=(command,timeout=10)=>[{hooks:[{type:'command',command,timeout}]}];
const nativeBudget=fs.readFileSync(new URL('./fixtures/brain-session-start-budget-4.7.28.mjs',import.meta.url),'utf8');
const budgetPatch=patchSource(nativeBudget);assert.deepEqual(budgetPatch.missing,[]);
assert.equal(reverseSource(budgetPatch.next),nativeBudget);
for(const codex of [true,false]) {
  const command=(id,ms)=>codex?cmd(id,ms):`node "\${CLAUDE_PLUGIN_ROOT}/scripts/hook-shim.mjs" ${id} || true`;
  let source=JSON.stringify({description:'Native fixture',hooks:{
    SessionStart:row(command('session-start',7500),8),
    UserPromptSubmit:row(command('ground-ruvnet')),Stop:row(command('session-snapshot Stop')),
    PreCompact:row(command('session-snapshot PreCompact')),SessionEnd:row(command('session-snapshot SessionEnd',2500),codex?3:10),
    PreToolUse:row(command('decision-gate write'),5),PostToolUse:row(command('session-snapshot PostToolUse')),
  }},null,2)+'\n';
  if(codex)source=captureBudget(source).next;
  const result=patchSource(source);assert.deepEqual(result.missing,[]);
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
console.log('temporary hook timeouts: scoped, bounded, reversible; restore10000/host16000/Codex15500; SessionEnd and other hooks unchanged');
