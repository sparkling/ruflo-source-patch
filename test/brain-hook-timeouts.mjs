import assert from 'node:assert/strict';
import vm from 'node:vm';
import { patchSource, reverseSource, isPatched, historicalPatchSource } from '../lib/brain-hook-timeouts/patcher.mjs';
import { patchSource as captureBudget, isPatched as captureBudgetApplied } from '../lib/brain-capture-budget/patcher.mjs';
const cmd=(id,ms=9000)=>`node -e "spawn({env:process.env,timeout:Number(process.argv[1])})" ${ms} ${id}`;
const row=(command,timeout=10)=>[{hooks:[{type:'command',command,timeout}]}];
for(const codex of [true,false]) {
  const command=(id,ms)=>codex?cmd(id,ms):`node "\${CLAUDE_PLUGIN_ROOT}/scripts/hook-shim.mjs" ${id} || true`;
  let source=JSON.stringify({description:'Native fixture',hooks:{
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
  if(!codex)oldManifest.hooks.SessionEnd[0].hooks[0].timeout=10;
  const old=JSON.stringify(oldManifest,null,2)+'\n';
  assert.equal(historicalPatchSource(source).next,old,'composition engine can prove exact historical bytes');
  assert.equal(patchSource(old).next,result.next,'exact prior timeout profile upgrades without losing other handlers');
  assert(patchSource(source.replace('"timeout": 10','"timeout": 99')).missing.length);
}
for(const source of [
  'export const DEFAULT_DEADLINE_MS = 1900;\nconst budget = Math.min(requested, 1900) : DEFAULT_DEADLINE_MS;',
  'export const CAPTURE_BUDGET_MS = 8_000;',
]) {const r=patchSource(source);assert.deepEqual(r.missing,[]);assert.equal(reverseSource(r.next),source);assert(isPatched(r.next));}
assert(patchSource('export const DEFAULT_DEADLINE_MS = 1901;').missing.length);
console.log('temporary hook timeouts: scoped, bounded, reversible; Codex SessionEnd and other hooks unchanged');
