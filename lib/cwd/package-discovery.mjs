// Shared physical package inventory; no patch-engine imports or mutations.
import fs from 'node:fs';
import path from 'node:path';
import { GLOBAL_ROOTS, NPX_ROOT } from './paths.mjs';

// Every node_modules dir we patch across: one per npx cache hash, plus each global
// install root. npx nests an extra <hash>/node_modules; a global root IS node_modules.
// Missing roots (no npx cache, no global install) are simply absent — the "skip if it
// doesn't exist" behaviour is inherent: nothing to iterate, nothing to patch.
export function nodeModulesDirs() {
  const dirs = [];
  try {
    for (const h of fs.readdirSync(NPX_ROOT)) dirs.push(path.join(NPX_ROOT, h, 'node_modules'));
  } catch { /* no npx cache */ }
  for (const g of GLOBAL_ROOTS) {
    dirs.push(g); // direct `npm install -g @claude-flow/cli`
    // The public `ruflo` package is a thin global wrapper whose real CLI is a
    // dependency, so npm nests it one node_modules deeper. Without this candidate
    // a global `npm install -g ruflo` is silently outside the monitor's coverage.
    dirs.push(path.join(g, 'ruflo', 'node_modules'));
  }
  return [...new Set(dirs)];
}

// npm/npx installs a SECOND, full copy of a package under a content-addressed "hidden" alias dir
// (`@claude-flow/.cli-YaBvWJZO`, `@claude-flow/.cli-core-wzeVoLs2`) whenever more than one version
// must coexist in one tree. It is a complete package — same `commands/daemon.js`, same anchors — and
// a literal `@scope/pkg` suffix join never finds it, so it ships UNPATCHED and, worse, silently: the
// daemon it can spawn is exactly the sprawl this tool exists to stop. Measured live: a `.cli-core-*`
// copy with types.js at 0 __rufloResolveRoot while the sibling `cli-core/` was fully patched.
function scopedAliasPaths(nm, suffix) {
  if (!suffix[0]?.startsWith('@') || suffix.length < 2) return [];
  const [scope, pkg, ...rest] = suffix;
  const prefix = `.${pkg}-`;
  let siblings;
  try { siblings = fs.readdirSync(path.join(nm, scope)); } catch { return []; }
  const out = [];
  for (const s of siblings) {
    if (!s.startsWith(prefix)) continue;
    // Disambiguate by the package's OWN name, never the prefix: `.cli-core-<hash>` also starts with
    // `.cli-`, so a prefix-only match would patch cli-core when asked for cli. package.json is the
    // authoritative identity — trust it, not the directory string.
    const aliasRoot = path.join(nm, scope, s);
    let meta;
    try { meta = JSON.parse(fs.readFileSync(path.join(aliasRoot, 'package.json'), 'utf8')); } catch { continue; }
    if (meta.name !== `${scope}/${pkg}`) continue;
    const full = path.join(aliasRoot, ...rest);
    if (fs.existsSync(full)) out.push(full);
  }
  return out;
}

export function discover(suffix) {
  const found = [];
  for (const nm of nodeModulesDirs()) {
    const full = path.join(nm, ...suffix);
    if (fs.existsSync(full)) found.push(full);
    found.push(...scopedAliasPaths(nm, suffix));
  }
  return found;
}
