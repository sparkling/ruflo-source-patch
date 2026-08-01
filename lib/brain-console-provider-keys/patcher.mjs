// RuvNet Brain #86: the packaged Console omits data/model-catalog.json. Its catalog load then
// throws, and the catch path silently leaves every provider key except OpenRouter absent. Reuse
// Brain's own subscription detector on that degraded path; never read or expose credential values.

import path from 'node:path';
import { discover as discoverConsoleSurfaces } from '../brain-console-lifecycle/discovery.mjs';

export const PATCH_MARKER = 'ruflo-source-patch (stuinfla/ruvnet-brain#86)';

const ORIGINAL = `  } catch { house = { provider: cfg.provider && cfg.provider !== 'auto' ? cfg.provider : 'anthropic', source: 'default' }; }`;
const PATCHED = `  } catch {
    house = { provider: cfg.provider && cfg.provider !== 'auto' ? cfg.provider : 'anthropic', source: 'default' };
    // ${PATCH_MARKER}: a missing packaged catalog must not look like missing credentials.
    providerKeys = Object.fromEntries(
      Object.entries(detectSubscriptions()).map(([name, status]) => [name, Boolean(status?.apiKey)]),
    );
  }`;

const occurrences = (source, needle) => {
  let count = 0;
  let offset = 0;
  while ((offset = source.indexOf(needle, offset)) !== -1) {
    count++;
    offset += needle.length;
  }
  return count;
};

export function patchSource(source) {
  if (occurrences(source, PATCHED) === 1) return { next: source, applied: [], missing: [] };
  const count = occurrences(source, ORIGINAL);
  if (count !== 1) {
    return {
      next: source,
      applied: [],
      missing: [count > 1 ? `catalog-fallback(AMBIGUOUS: anchor occurs ${count}x)` : 'catalog-fallback'],
    };
  }
  return { next: source.replace(ORIGINAL, PATCHED), applied: ['catalog-fallback'], missing: [] };
}

export function reverseSource(source) {
  return occurrences(source, PATCHED) === 1 ? source.replace(PATCHED, ORIGINAL) : source;
}

export const hasPatch = (source) => source.includes(PATCH_MARKER);
export const isPatched = (source) => occurrences(source, PATCHED) === 1;

export function discover() {
  return discoverConsoleSurfaces().filter((file) => path.basename(file) === 'onboarding-console.mjs');
}

export const fixtureSource = () => `const cfg = {};
function loadCatalog() { throw new Error('missing data/model-catalog.json'); }
function detectProvider() { return { provider: 'anthropic', source: 'catalog' }; }
export function detectSubscriptions() {
  const openai = Boolean(process.env.OPENAI_API_KEY);
  return {
    anthropic: { apiKey: Boolean(process.env.ANTHROPIC_API_KEY) },
    openai: { apiKey: openai },
    codex: { apiKey: openai },
    google: { apiKey: Boolean(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY) },
    xai: { apiKey: Boolean(process.env.XAI_API_KEY) },
  };
}

export function gatherRouterEngine() {
  let openrouterKey = Boolean(process.env.OPENROUTER_API_KEY);
  let house, providerKeys = {};
  try {
    const hcat = loadCatalog();
    house = detectProvider(hcat, { provider: cfg.provider });
    const IGNORE_ENV = new Set(['CLAUDECODE', 'CLAUDE_CODE_ENTRYPOINT']);
    for (const [name, p] of Object.entries(hcat.providers || {})) {
      providerKeys[name] = (p.detect_env || []).some((key) => !IGNORE_ENV.has(key) && Boolean(process.env[key]));
    }
  } catch { house = { provider: cfg.provider && cfg.provider !== 'auto' ? cfg.provider : 'anthropic', source: 'default' }; }
  return {
    keys: { openrouter: openrouterKey, ...providerKeys },
    subscriptions: detectSubscriptions(),
    house,
  };
}
`;

export const descriptor = {
  name: 'brain-console-provider-keys',
  atomic: true,
  editCount: 1,
  discover,
  patchSource,
  hasPatch,
  reverse: reverseSource,
  isPatched,
};
