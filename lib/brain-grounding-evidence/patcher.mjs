// Brain #316: turn-level search evidence must not depend on the narrower write-product list.
import fs from 'node:fs';
import path from 'node:path';
import { HOME_BASE } from '../cwd/paths.mjs';
import { discover as discoverBrain } from '../brain-managed-memory-boundary/discovery.mjs';

export const PATCH_MARKER = 'ruflo-source-patch (stuinfla/ruvnet-brain#316)';
export const SUCCESS_ANCHOR = `case "$INPUT" in
  *"Searched "*"RuvNet repos"*) ;;
  *) exit 0 ;;
esac`;
export const SUCCESS_REPLACEMENT = `# ${PATCH_MARKER}: the card lane also returns cited search evidence.
RSP_GROUNDING_CARD_ONLY=0
case "$INPUT" in
  *"Searched "*"RuvNet repos"*) ;;
  *"FAST LANE — zero-ML keyword match ("*"evidence=curated-capability-card"*"path : "*"----- grounded summary -----"*) RSP_GROUNDING_CARD_ONLY=1 ;;
  *) exit 0 ;;
esac`;
export const ANCHOR = `mkdir -p "$DIR" 2>/dev/null || exit 0

# Same product-term list as ground-before-write.sh`;
export const REPLACEMENT = `mkdir -p "$DIR" 2>/dev/null || exit 0

# ${PATCH_MARKER}: successful search evidence for the Stop gate.
# Keep product-specific write authorization below unchanged. All existing result/query
# checks above must pass before recording this non-product stamp.
: > "$DIR/search_ruvnet" 2>/dev/null || true
# Card evidence satisfies the turn-level consultation check, not the existing write gate.
[ "$RSP_GROUNDING_CARD_ONLY" = "1" ] && exit 0

# Same product-term list as ground-before-write.sh`;

export const hasPatch = (source) => source.includes(PATCH_MARKER);
const EDITS = [[SUCCESS_ANCHOR, SUCCESS_REPLACEMENT], [ANCHOR, REPLACEMENT]];
export const isPatched = (source) => EDITS.every(([, replacement]) => source.split(replacement).length === 2);
export function patchSource(source) {
  if (isPatched(source) && EDITS.every(([anchor]) => !source.includes(anchor))) {
    return { next: source, applied: [], missing: [] };
  }
  if (EDITS.some(([anchor]) => source.split(anchor).length !== 2) || hasPatch(source)) {
    return { next: source, applied: [], missing: ['successful-search-evidence (absent, ambiguous or modified anchor)'] };
  }
  return { next: EDITS.reduce((next, [anchor, replacement]) => next.replace(anchor, replacement), source),
    applied: ['successful-search-evidence'], missing: [] };
}
export const reverseSource = (source) => EDITS.reduceRight((next, [anchor, replacement]) => next.replace(replacement, anchor), source);

export function discover() {
  const brainHome = path.resolve(process.env.RSP_RUVNET_BRAIN_HOME
    || path.join(HOME_BASE, '.cache', 'ruvnet-brain'));
  if (!fs.existsSync(path.join(brainHome, 'active.json'))) return [];
  // Reuse native-generation identity/containment checks; never select or promote a release.
  return discoverBrain({ includeOwned: false }).filter((surface) => surface.kind === 'full')
    .map((surface) => path.join(surface.root, 'scripts', 'grounding-stamp.sh'));
}

export const descriptor = {
  name: 'brain-grounding-evidence', atomic: true, missingIsIncomplete: true,
  discover, patchSource, hasPatch, isPatched, reverse: reverseSource,
};
