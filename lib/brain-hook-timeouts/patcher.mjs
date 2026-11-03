// Owner-authorized temporary mitigation for Brain #429/#513 while #3164 is diagnosed.
// Native execution, consent, verification and SessionEnd host limits remain intact.
import fs from 'node:fs';
import path from 'node:path';
import { discover as discoverBrain } from '../brain-managed-memory-boundary/discovery.mjs';
export const NAME = 'brain-hook-timeouts';
export const MARKER = 'ruflo-source-patch brain#429/#513 temporary timeout profile';
const files = ['scripts/agentdb-recall.mjs', 'scripts/session-snapshot-hook.mjs', 'hooks/hooks.json', 'hooks/codex-hooks.json'];
const recall = [
  ['export const DEFAULT_DEADLINE_MS = 1900;', `// ${MARKER}\nexport const DEFAULT_DEADLINE_MS = 10_000;`],
  ['Math.min(requested, 1900) : DEFAULT_DEADLINE_MS', 'Math.min(requested, 10_000) : DEFAULT_DEADLINE_MS'],
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
function manifest(source, reverse) {
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
    if(!ground&&!snapshot)continue;
    const before=10,after=ground?20:40;
    if(row.timeout!==(reverse?after:before))throw Error('unknown host timeout');
    let command=row.command;
    if(command.includes('timeout:Number(process.argv[1])')) {
      const inner=ground?17000:33000,outer=ground?18000:35000;
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
  if(changed!==3)throw Error('expected exactly recall, Stop and PreCompact handlers');
  return source;
}
function transform(source, reverse=false) {
  if(source.includes('export const DEFAULT_DEADLINE_MS'))return textEdits(source,recall,reverse);
  if(source.includes('export const CAPTURE_BUDGET_MS'))return textEdits(source,capture,reverse);
  return manifest(source,reverse);
}
export const hasPatch=source=>source.includes(MARKER);
export function reverseSource(source) { try{return hasPatch(source)?transform(source,true):source;}catch{return source;} }
export function isPatched(source) { try{return hasPatch(source)&&transform(transform(source,true))===source;}catch{return false;} }
export function patchSource(source) {
  if(isPatched(source))return {next:source,applied:[],missing:[]};
  try {if(hasPatch(source))throw Error('unknown timeout profile');return {next:transform(source),applied:[NAME],missing:[]};}
  catch(error){return {next:source,applied:[],missing:[error.message]};}
}
export const discover=()=>discoverBrain({includeOwned:true,allowMissingActive:true,ownedMarkers:[MARKER],ownedRelatives:files})
  .filter(x=>x.kind==='full').flatMap(x=>files.map(f=>path.join(x.root,f))).filter(f=>fs.existsSync(f));
// Explicitly remove this temporary target once original deadlines qualify again.
export const descriptor={name:NAME,atomic:true,missingIsIncomplete:true,discover,patchSource,hasPatch,isPatched,reverse:reverseSource};
