// Reuse native credential patterns; keep the original scan verdict as evidence.
import { createHash } from 'node:crypto';
import { discover as packages } from '../cwd/package-discovery.mjs';
export const CLI_MARKER = 'ruflo-source-patch (ruvnet/ruflo#4861): native credential selector';
const factory = `        hasPII(input) {
            return detectionService.detectPII(input);
        },`;
const service = `    detectPII(input) {`;
const builtin = `        quickScan(input) {
            const threat = scan(input)[0];`;
const admission = 'const safe = result.safe && !result.piiFound;';
const start = `        const scanTime = performance.now() - startTime;
        spinner.stop();
        // JSON output`;
const profiles = [
  { key: 'factory', find: [[factory, `${factory}
        // ${CLI_MARKER}
        hasCredentials(input) { return detectionService.detectCredentials(input); },`]] },
  { key: 'service', find: [[service, `    // ${CLI_MARKER}
    detectCredentials(input) {
        return PII_PATTERNS.some(pii => ['api_key', 'password'].includes(pii.type)
            && new RegExp(pii.pattern.source, pii.pattern.flags).test(input));
    }
${service}`]] },
  { key: 'builtin', find: [[builtin, `        // ${CLI_MARKER}
        hasCredentials(input) {
            return PII_PATTERNS.slice(2).some(pattern => new RegExp(pattern.source, pattern.flags).test(input));
        },
${builtin}`]] },
  { key: 'command', find: [[start, `${start.replace('        // JSON output', '')}        // ${CLI_MARKER}
        const rspPiiOnly = result.piiFound === true && Array.isArray(result.threats) && result.threats.length === 0;
        const rspAdmissionSafe = (result.safe === true || (result.safe === false && rspPiiOnly))
            && (quickMode || !defender.hasCredentials(textToScan));
        // JSON output`], [admission, 'const safe = rspAdmissionSafe;', 2]] },
];
const count = (s,a) => s.split(a).length - 1;
const identify = s => s.includes('const defendCommand =') ? profiles[3]
  : s.includes('export function createBuiltinAIDefence()') ? profiles[2]
  : s.includes('const PII_PATTERNS = [') && s.includes('    detectPII(input) {') ? profiles[1]
  : s.includes('export function createAIDefence(config = {})') ? profiles[0] : null;
function qualified(source, profile) {
  if (profile.key !== 'service') return true;
  const at = source.indexOf('const PII_PATTERNS = [');
  const block = source.slice(at, source.indexOf('\n];', at) + 3);
  return ['1e4241209c30f5b4a64c547bcb35f6700407139c367b4914e5fdb73caf77067e',
    '673a08689e5f82587ab6d938f4ca51273fb617eca490faf01187df99f5f4f615']
    .includes(createHash('sha256').update(block).digest('hex'));
}
export const isCliPatched = source => {
  const p = identify(source);
  return !!p && qualified(source,p) && p.find.every(([,next,n=1]) => count(source,next) === n);
};
export function patchCli(source) {
  const p = identify(source); if (!p) return null;
  if (isCliPatched(source)) return { next: source, applied: [], missing: [] };
  if (!qualified(source,p) || source.includes(CLI_MARKER) || !p.find.every(([old,,n=1]) => count(source,old) === n))
    return { next: source, applied: [], missing: ['native-credential-selector-'+p.key] };
  if (p.key === 'builtin') {
    const block=source.slice(source.indexOf('const PII_PATTERNS = ['),source.indexOf('export function createBuiltinAIDefence'));
    if (block !== BUILTIN_PII) return { next: source, applied: [], missing: ['native-builtin-credential-patterns'] };
  }
  return { next: p.find.reduce((s,[old,next]) => s.split(old).join(next), source), applied: ['ruflo-pii-policy'], missing: [] };
}
export function reverseCli(source) {
  const p = identify(source);
  return p && isCliPatched(source) ? [...p.find].reverse().reduce((s,[old,next]) => s.split(next).join(old),source) : source;
}
export const discoverCli = () => [
  ...packages(['@claude-flow','cli','dist','src','commands','security.js']),
  ...packages(['@claude-flow','cli','dist','src','security','builtin-aidefence.js']),
  ...packages(['@claude-flow','aidefence','dist','index.js']),
  ...packages(['@claude-flow','aidefence','dist','domain','services','threat-detection-service.js']),
];

const BUILTIN_PII = "const PII_PATTERNS = [\n    /\\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\\.[A-Z]{2,}\\b/i,\n    /\\b\\d{3}-\\d{2}-\\d{4}\\b/,\n    /\\b(?:sk-|ghp_|xox[baprs]-)[A-Za-z0-9_-]{16,}\\b/,\n    /\\bAKIA[A-Z0-9]{16}\\b/,\n];\n";
