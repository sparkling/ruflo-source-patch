// WITHDRAWN by owner: workflow instructions, not detector/guard source changes (#4861).
// Historical transforms only prove exact restoration; new installs contribute no PII bypass.
import fs from 'node:fs';
import { withdrawDescriptor } from '../ruflo-memory-entries-only/transform.mjs';
import path from 'node:path';
import { HOME_BASE } from '../cwd/paths.mjs';
import { CLI_MARKER, discoverCli, patchCli, reverseCli, isCliPatched } from './cli.mjs';
import { NATIVE, INTELLIGENCE } from './native.mjs';
export const NAME = 'ruflo-pii-policy';
export const MARKER = 'ruflo-source-patch (ruvnet/ruflo#4861): PII is informational; native secret guard retained.';
const REFUSAL = NATIVE.split('\n').find(line => line.includes('if (texts.some(hasPii))'));
const TRANSFER = INTELLIGENCE.slice(INTELLIGENCE.indexOf("  if (name === 'hooks_transfer'"), INTELLIGENCE.indexOf('  return undefined', INTELLIGENCE.indexOf("  if (name === 'hooks_transfer'")));
const GUIDANCE = "export const blocksGuidance = (screen: Screen | null): boolean => screen !== null && (screen.status === 'unsafe' || screen.status === 'pii')";
const GUIDANCE_NATIVE = "export const blocksGuidance = (screen: Screen | null): boolean => screen !== null && (screen.status === 'unsafe' || screen.secret === true)";
const CONSOLE = [
  ["import { mcpReader } from './secure'", "import { mcpReader } from './secure'\nimport { hasSecret } from './screen'"],
  ["export type Screen = { status: 'safe' | 'unsafe' | 'pii' | 'unavailable'; detail: string }", "export type Screen = { status: 'safe' | 'unsafe' | 'pii' | 'unavailable'; detail: string; secret?: boolean }"],
  ["return { status: 'pii', detail: 'personal or secret data detected' }", "return { status: 'pii', detail: 'PII informational; credentials remain guarded', secret: hasSecret(text) }"],
  [GUIDANCE, '// ' + MARKER + '\n' + GUIDANCE_NATIVE],
];
export const PATCHED = NATIVE.replace(REFUSAL, '  // ' + MARKER);
export const RETIRED = NATIVE.replace(REFUSAL + '\n', '');
const variants = [
  { native: NATIVE, patched: PATCHED, retired: RETIRED },
  { native: INTELLIGENCE, patched: INTELLIGENCE.replace(TRANSFER, '  // ' + MARKER + '\n'), retired: INTELLIGENCE.replace(TRANSFER, '') },
];
const count = (s, anchor) => s.split(anchor).length - 1;
const guidance = s => count(s, 'export const blocksGuidance =') === 1 && s.includes("export const blocksCreate = (screen: Screen | null): boolean => screen?.status === 'unsafe'");
export const hasPatch = source => source.includes(MARKER) || source.includes(CLI_MARKER);
export const historicalIsPatched = source => isCliPatched(source) || variants.some(v => source === v.patched || source === v.retired)
  || (guidance(source) && CONSOLE.every(([, next]) => count(source, next) === 1) && !source.includes(GUIDANCE));
export function historicalPatchSource(source) {
  const cli = patchCli(source); if (cli) return cli;
  if (historicalIsPatched(source)) return { next: source, applied: [], missing: [] };
  const known = variants.find(v => v.native === source);
  if (known) return { next: known.patched, applied: [NAME], missing: [] };
  if (!hasPatch(source) && guidance(source) && CONSOLE.every(([old, next]) => count(source, old) === 1 && !source.includes(next)))
    return { next: CONSOLE.reduce((s, [old, next]) => s.replace(old, next), source), applied: [NAME], missing: [] };
  return { next: source, applied: [], missing: ['reviewed-native-PII-gate'] };
}
export function reverse(source) {
  const cli = reverseCli(source); if (cli !== source) return cli;
  const known = variants.find(v => v.patched === source);
  if (known) return known.native;
  return historicalIsPatched(source) && guidance(source)
    ? [...CONSOLE].reverse().reduce((s, [old, next]) => s.replace(next, old), source) : source;
}
export const isPatched = source => !hasPatch(source) && historicalPatchSource(source).missing.length === 0;
export const patchSource = source => descriptor.patchSource(source);
export function discover() {
  const roots = [];
  for (const host of ['.claude', '.codex']) for (const plugin of ['ruflo-federation', 'ruflo-intelligence', 'ruflo-console']) {
    const base = path.join(HOME_BASE, host);
    for (const market of [path.join(base, 'plugins', 'marketplaces', 'ruflo'), path.join(base, '.tmp', 'marketplaces', 'ruflo')])
      roots.push({ root: path.join(market, 'plugins', plugin), plugin });
    const cache = path.join(base, 'plugins', 'cache', 'ruflo', plugin);
    try { for (const version of fs.readdirSync(cache)) if (/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(version)) roots.push({ root: path.join(cache, version), plugin }); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  return [...new Set([...discoverCli(), ...roots.map(({ root, plugin }) => path.join(root, 'hooks', plugin === 'ruflo-console' ? 'mission-options.ts' : 'guard.ts')).filter(file => fs.existsSync(file))])];
}
export function preflight(files = discover()) {
  const errors = [], blockedFiles = [];
  for (const file of files) try {
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink()) throw Error('unsafe guard source');
    if (file.endsWith('.ts')) {
    const manifest = JSON.parse(fs.readFileSync(path.join(path.dirname(file), '..', '.claude-plugin', 'plugin.json'), 'utf8'));
    if (!['ruflo-federation', 'ruflo-intelligence', 'ruflo-console'].includes(manifest.name)) throw Error('unverified plugin identity');
    if (manifest.name === 'ruflo-console' && !fs.readFileSync(path.join(path.dirname(file), 'screen.ts'), 'utf8').includes('export const hasSecret')) throw Error('native Console secret screen unavailable');
    }
    if (patchSource(fs.readFileSync(file, 'utf8')).missing.length) throw Error('unreviewed guard source');
  } catch (error) { errors.push(`${file}: ${error.message}`); blockedFiles.push(file); }
  return { ok: !errors.length, errors, ...(errors.length ? { blockedFiles } : {}) };
}
export const descriptor = { ...withdrawDescriptor({ name: NAME, atomic: true, missingIsIncomplete: true,
  discover, patchSource: historicalPatchSource, hasPatch, isPatched: historicalIsPatched, reverse }, isPatched), preflight, restorationOnly: true };
