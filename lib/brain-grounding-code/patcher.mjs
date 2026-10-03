// #46's wall should inspect code, not a warning about the code it prohibits.
import fs from 'node:fs';
import path from 'node:path';
import { HOME_BASE } from '../cwd/paths.mjs';
import { discover as discoverBrain } from '../brain-managed-memory-boundary/discovery.mjs';
import { codeContext } from './scan.mjs';

export const PATCH_MARKER = 'ruflo-source-patch (stuinfla/ruvnet-brain#46 code-only grounding)';
export const ANCHOR = `# Scan the WHOLE tool input (path + content + new_string) — where the code mentions the
# product is where the hand-roll hides.
MISSING=""
SEEN=""
for t in agentdb metaharness ruvector aidefence agentic-flow agentic-qe ruv-swarm rvf ruflo; do
  [[ $INPUT == *"$t"* ]] || continue`;
// Reuse the native parser; unavailable dependencies retain the original scan.
const PROGRAM = `import { pathToFileURL } from 'node:url';
import fs from 'node:fs';
const { parseHookEvent } = await import(pathToFileURL(process.argv[1]).href);
${codeContext.toString()}
const raw = fs.readFileSync(0, 'utf8');
process.stdout.write(codeContext(parseHookEvent(raw)) ?? raw);`;
const shellQuote = (text) => `'${text.replaceAll("'", "'\\''")}'`;
export const REPLACEMENT = `# ${PATCH_MARKER}: prose-only mentions do not require a stamp.
RSP_CODE_INPUT="$INPUT"
RSP_SCAN_NODE="\${RUVNET_NODE_BIN:-}"
[ -n "$RSP_SCAN_NODE" ] && [ -x "$RSP_SCAN_NODE" ] || RSP_SCAN_NODE="$(command -v node 2>/dev/null)"
if [ -n "$RSP_SCAN_NODE" ]; then
  RSP_SCAN_PARSER="$(dirname "\${BASH_SOURCE[0]}")/hook-input.mjs"
  if [ -f "$RSP_SCAN_PARSER" ]; then
    RSP_SCAN_OUTPUT=$(printf '%s' "$INPUT" | "$RSP_SCAN_NODE" --input-type=module -e ${shellQuote(PROGRAM)} "$RSP_SCAN_PARSER" 2>/dev/null)
    [ "$?" = "0" ] && RSP_CODE_INPUT="$RSP_SCAN_OUTPUT"
  fi
fi
MISSING=""
SEEN=""
for t in agentdb metaharness ruvector aidefence agentic-flow agentic-qe ruv-swarm rvf ruflo; do
  [[ $RSP_CODE_INPUT == *"$t"* ]] || continue`;
const count = (text, part) => text.split(part).length - 1;
export const hasPatch = (source) => source.includes(PATCH_MARKER);
export const isPatched = (source) => count(source, REPLACEMENT) === 1 && !source.includes(ANCHOR);
export function patchSource(source) {
  if (isPatched(source)) return { next: source, applied: [], missing: [] };
  if (count(source, ANCHOR) !== 1 || hasPatch(source)) {
    return { next: source, applied: [], missing: ['code-only-grounding (absent, ambiguous or modified anchor)'] };
  }
  return { next: source.replace(ANCHOR, REPLACEMENT), applied: ['code-only-grounding'], missing: [] };
}
export const reverseSource = (source) => source.replace(REPLACEMENT, ANCHOR);
export function discover() {
  const brainHome = process.env.RSP_RUVNET_BRAIN_HOME || path.join(HOME_BASE, '.cache', 'ruvnet-brain');
  if (!fs.existsSync(path.join(brainHome, 'active.json'))) return [];
  return discoverBrain({ includeOwned: false }).filter((s) => s.kind === 'full')
    .map((s) => path.join(s.root, 'scripts/ground-before-write.sh'))
    .filter((file) => fs.existsSync(file));
}
export const descriptor = {
  name: 'brain-grounding-code', atomic: true, missingIsIncomplete: true,
  discover, patchSource, hasPatch, isPatched, reverse: reverseSource,
};
