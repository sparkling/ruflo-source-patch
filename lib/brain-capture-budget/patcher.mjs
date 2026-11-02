// Brain #513: use the native override inside the existing 9s capture launcher.
import fs from 'node:fs';
import path from 'node:path';
import { discover as discoverBrain } from '../brain-managed-memory-boundary/discovery.mjs';
export const NAME = 'brain-capture-budget';
export const PATCH_MARKER = '/* ruflo-source-patch brain#513 */';
const FROM = 'env:process.env,timeout:Number(process.argv[1])';
const TO = `env:{...process.env,RUVNET_CODEX_HOOK_TIMEOUT_MS:process.env.RUVNET_CODEX_HOOK_TIMEOUT_MS??'8500'},${PATCH_MARKER}timeout:Number(process.argv[1])`;
const LEGACY_TO = TO.replace("process.env.RUVNET_CODEX_HOOK_TIMEOUT_MS??", '');
function commands(source) {
  const hooks = JSON.parse(source).hooks;
  return ['Stop', 'PreCompact'].map(event => {
    const rows = (hooks?.[event] || []).flatMap(group => group.hooks || [])
      .filter(row => row.type === 'command' && row.command?.endsWith(`9000 session-snapshot ${event}`));
    if (rows.length !== 1 || rows[0].timeout !== 10) throw Error(`unrecognised ${event} capture launcher`);
    return rows[0].command;
  });
}
export const hasPatch = source => source.includes(PATCH_MARKER);
export function isPatched(source) {
  try { return commands(source).every(command => command.includes(TO) && !command.includes(FROM)); }
  catch { return false; }
}
export function patchSource(source) {
  if (isPatched(source)) return { next: source, applied: [], missing: [] };
  try {
    const selected = commands(source);
    if (hasPatch(source) || selected.some(command => command.split(FROM).length !== 2)) throw Error('capture budget anchors drifted');
    let next = source;
    for (const command of selected) next = next.replace(JSON.stringify(command), JSON.stringify(command.replace(FROM, TO)));
    return { next, applied: ['stop-precompact-native-budget'], missing: [] };
  } catch { return { next: source, applied: [], missing: ['native-capture-launcher-budget'] }; }
}
export function reverseSource(source) {
  try {
    for (const command of commands(source)) source = source.replace(JSON.stringify(command), JSON.stringify(command.replace(TO, FROM).replace(LEGACY_TO, FROM)));
  } catch { /* unrecognised bytes are never rewritten */ }
  return source;
}
export const discover = () => discoverBrain({ includeOwned: true, allowMissingActive: true,
  ownedMarkers: [PATCH_MARKER], ownedRelatives: ['hooks/codex-hooks.json'],
}).filter(surface => surface.kind === 'full').map(surface => path.join(surface.root, 'hooks/codex-hooks.json'))
  .filter(file => fs.existsSync(file));
// Retire when native Stop/PreCompact supplies this budget with unchanged SessionEnd.
export const descriptor = { name: NAME, atomic: true, missingIsIncomplete: true,
  discover, patchSource, hasPatch, isPatched, reverse: reverseSource,
  historicalPatchSource: source => { const r = patchSource(source); return { ...r, next: r.next.replaceAll(TO, LEGACY_TO) }; } };
