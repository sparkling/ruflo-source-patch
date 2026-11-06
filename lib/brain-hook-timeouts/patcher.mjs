// Owner-authorized temporary mitigation for Brain #429/#513 while #3164 is diagnosed.
// SessionStart incident021: https://github.com/stuinfla/ruvnet-brain/issues/523
// Native execution, consent, verification and Codex SessionEnd host limits remain intact.
import fs from 'node:fs';
import path from 'node:path';
import { discover as discoverBrain } from '../brain-managed-memory-boundary/discovery.mjs';
export const NAME = 'brain-hook-timeouts';
export const MARKER = 'ruflo-source-patch brain#429/#513 temporary timeout profile';
const files = ['scripts/agentdb-recall.mjs', 'scripts/session-snapshot-hook.mjs', 'scripts/session-start-budget.mjs', 'hooks/hooks.json', 'hooks/codex-hooks.json'];
const restore = [['  restore: 3500,', `  // ${MARKER}: Brain #523 operator-authorized incident021 mitigation, not a latency fix.\n  restore: 10_000,`]];
const recall = (legacy = false) => [
  ['export const DEFAULT_DEADLINE_MS = 1900;', `// ${MARKER}\nexport const DEFAULT_DEADLINE_MS = ${legacy ? '10_000' : '20_000'};`],
  ['Math.min(requested, 1900) : DEFAULT_DEADLINE_MS', `Math.min(requested, ${legacy ? '10_000' : '20_000'}) : DEFAULT_DEADLINE_MS`],
];
const capture = [['export const CAPTURE_BUDGET_MS = 8_000;', `// ${MARKER}\nexport const CAPTURE_BUDGET_MS = 30_000;`]];
const count = (s, text) => s.split(text).length - 1;
function textEdits(source, changes, reverse) {
  for (const pair of changes) {
    const [from,to] = reverse ? [...pair].reverse() : pair;
    if(count(source,from)!==1)throw Error('timeout source anchor missing or ambiguous');
    source=source.replace(from,()=>to);
  }
  return source;
}
function manifest(source, reverse, legacy = false, captureEnd = true, restoreStart = true) {
  const parsed=JSON.parse(source);
  if(typeof parsed.description!=='string'||!parsed.hooks)throw Error('unknown hook manifest');
  const suffix=` [${MARKER}]`;
  if(reverse ? !parsed.description.endsWith(suffix) : parsed.description.includes(MARKER))throw Error('unknown timeout description');
  const description=reverse?parsed.description.slice(0,-suffix.length):parsed.description+suffix;
  source=source.replace(JSON.stringify(parsed.description),JSON.stringify(description));
  let changed=0;
  for(const [event,groups] of Object.entries(parsed.hooks))for(const group of groups)for(const row of group.hooks||[]) {
    if(row.type!=='command')continue;
    const ground=event==='UserPromptSubmit'&&/ground-ruvnet(?: \|\| true)?$/.test(row.command);
    const snapshot=['Stop','PreCompact'].includes(event)&&new RegExp(`session-snapshot ${event}(?: \\|\\| true)?$`).test(row.command);
    const sessionEnd=captureEnd&&event==='SessionEnd'&&!row.command.includes('timeout:Number(process.argv[1])')&&/session-snapshot SessionEnd(?: \|\| true)?$/.test(row.command);
    const sessionStart=restoreStart&&event==='SessionStart'&&/session-start(?: \|\| true)?$/.test(row.command);
    if(!ground&&!snapshot&&!sessionEnd&&!sessionStart)continue;
    const before=sessionStart?8:10,after=sessionStart?16:ground&&legacy?20:40;
    if(row.timeout!==(reverse?after:before))throw Error('unknown host timeout');
    let command=row.command;
    if(sessionStart&&command.includes('timeout:Number(process.argv[1])')) {
      command=textEdits(command,[[`\" 7500 session-start`,`\" 15500 session-start`]],reverse);
    } else if(command.includes('timeout:Number(process.argv[1])')) {
      const inner=ground?(legacy?17000:34000):33000,outer=ground?(legacy?18000:36000):35000;
      const from=ground?'env:process.env,':"env:{...process.env,RUVNET_CODEX_HOOK_TIMEOUT_MS:process.env.RUVNET_CODEX_HOOK_TIMEOUT_MS??'8500'},/* ruflo-source-patch brain#513 */";
      const to=`env:{...process.env,RUVNET_CODEX_HOOK_TIMEOUT_MS:process.env.RUVNET_CODEX_HOOK_TIMEOUT_MS??'${inner}'},/* ${MARKER} */`;
      command=textEdits(command,[[from,to],[`\" 9000 `,`\" ${outer} `]],reverse);
    }
    const encoded=JSON.stringify(row.command);
    const position=source.indexOf(encoded);
    if(position<0||source.indexOf(encoded,position+encoded.length)!==-1)throw Error('ambiguous hook command');
    const tail=source.slice(position+encoded.length);
    const pattern=new RegExp(`^(\\s*,\\s*"timeout"\\s*:\\s*)${reverse?after:before}(?=\\D)`);
    if(!pattern.test(tail))throw Error('unknown hook timeout layout');
    source=source.slice(0,position)+JSON.stringify(command)+tail.replace(pattern,(_,prefix)=>prefix+(reverse?before:after));
    changed++;
  }
  const expected=(captureEnd&&!source.includes('timeout:Number(process.argv[1])')?4:3)+(restoreStart?1:0);
  if(changed!==expected)throw Error('unexpected timeout handler count');
  return source;
}
function transform(source, reverse=false, legacy=false, captureEnd=true, restoreStart=true) {
  if(source.includes('export const DEFAULT_DEADLINE_MS'))return textEdits(source,recall(legacy),reverse);
  if(source.includes('export const CAPTURE_BUDGET_MS'))return textEdits(source,capture,reverse);
  if(source.includes('export const STAGE_BUDGETS_MS'))return textEdits(source,restore,reverse);
  return manifest(source,reverse,legacy,captureEnd,restoreStart);
}
export const hasPatch=source=>source.includes(MARKER);
export function reverseSource(source) {
  if (!hasPatch(source)) return source;
  for (const [legacy,captureEnd,restoreStart] of [[false,true,true],[false,true,false],[false,false,false],[true,false,false]]) {
    try { return transform(source,true,legacy,captureEnd,restoreStart); } catch {}
  }
  return source;
}
export function isPatched(source) { try{return hasPatch(source)&&transform(transform(source,true))===source;}catch{return false;} }
export function patchSource(source) {
  if(isPatched(source))return {next:source,applied:[],missing:[]};
  try {
    // Upgrade only the exact previously owned profile; never accept an unknown marker.
    if(hasPatch(source)) {
      const base=reverseSource(source);
      if(base===source)throw Error('unknown timeout profile');
      return {next:transform(base),applied:[NAME],missing:[]};
    }
    return {next:transform(source),applied:[NAME],missing:[]};
  }
  catch(error){return {next:source,applied:[],missing:[error.message]};}
}
export const discover=()=>discoverBrain({includeOwned:true,allowMissingActive:true,ownedMarkers:[MARKER],ownedRelatives:files})
  .filter(x=>x.kind==='full').flatMap(x=>files.map(f=>path.join(x.root,f)));
export function preflight() {
  const errors=[];
  for(const file of discover())try {
    const stat=fs.lstatSync(file);
    if(!stat.isFile()||stat.isSymbolicLink()||patchSource(fs.readFileSync(file,'utf8')).missing.length)
      throw Error('unproved complete native timeout profile');
  } catch(error){errors.push(`${file}: ${error.message}`);}
  return {ok:!errors.length,errors};
}
// Explicitly remove this temporary target once original deadlines qualify again.
export function historicalPatchSource(source, current) {
  if(typeof current==='string')for(const [legacy,captureEnd] of [[false,true],[false,false],[true,false]])try {
    const next=transform(source,false,legacy,captureEnd,false);
    if(next===current)return {next,applied:[NAME],missing:[]};
  } catch {}
  try { return { next: transform(source, false, true, false, false), applied: [NAME], missing: [] }; }
  catch { return { next: source, applied: [], missing: ['not the exact prior timeout profile'] }; }
}
export const descriptor={name:NAME,atomic:true,missingIsIncomplete:true,discover,preflight,patchSource,hasPatch,isPatched,reverse:reverseSource,historicalPatchSource};
