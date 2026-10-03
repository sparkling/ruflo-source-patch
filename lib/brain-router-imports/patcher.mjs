// Brain #341: installed flat router tools omitted two native helper modules.
// Read the existing native Console owner; never materialize a replacement helper.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { HOME_BASE } from '../cwd/paths.mjs';
export const PATCH_MARKER = 'ruflo-source-patch (stuinfla/ruvnet-brain#341)';

// Serialized into the owned executable import sites. All implementation and
// model/policy values still come from the native helper, including future updates.
export async function rspRouterImport(specifier, relative, from) {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const os = await import('node:os');
  const { fileURLToPath, pathToFileURL } = await import('node:url');
  const regular = (file) => {
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink() || !stat.size) throw new Error(`unsafe native router helper: ${file}`);
  };
  const local = fileURLToPath(new URL(specifier, from));
  let missing = false;
  try { regular(local); } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    missing = true;
  }
  if (!missing) return import(pathToFileURL(local).href);
  const brain = fs.realpathSync(path.resolve(process.env.RUVNET_BRAIN_HOME
    || path.join(os.homedir(), '.cache', 'ruvnet-brain')));
  const kb = fs.lstatSync(path.join(brain, 'kb'));
  if (!kb.isDirectory() || kb.isSymbolicLink()) throw new Error('unsafe native Console parent');
  const runtime = path.join(brain, 'kb', '.console-runtime');
  const dir = fs.lstatSync(runtime);
  if (!dir.isDirectory() || dir.isSymbolicLink()) throw new Error(`unsafe native Console owner: ${runtime}`);
  const manifestFile = path.join(runtime, 'package.json'); regular(manifestFile);
  const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
  if (manifest.name !== 'ruvnet-brain' || typeof manifest.version !== 'string'
      || !/^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?(?:\+[A-Za-z0-9.-]+)?$/.test(manifest.version)) {
    throw new Error(`invalid native Console identity: ${manifestFile}`);
  }
  if (!['scripts/review-model-defaults.mjs', 'plugin/scripts/runtime-preferences.mjs'].includes(relative)) {
    throw new Error('unrecognized native router helper');
  }
  const file = path.join(runtime, relative);
  let parent = runtime;
  for (const segment of relative.split('/').slice(0, -1)) {
    parent = path.join(parent, segment);
    const stat = fs.lstatSync(parent);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(`unsafe native helper directory: ${parent}`);
  }
  regular(file);
  const physical = fs.realpathSync(file);
  if (!physical.startsWith(fs.realpathSync(runtime) + path.sep)) throw new Error('native helper escapes its owner');
  return import(pathToFileURL(file).href);
}

export const SPECS = [
  { file: 'dual-host-deliberation.mjs', names: 'DUAL_HOST_MODEL_IDS',
    specifier: './review-model-defaults.mjs', relative: 'scripts/review-model-defaults.mjs' },
  { file: 'route-cheap.mjs', names: 'loadRuntimePreferences, runtimeChildEnv',
    specifier: '../plugin/scripts/runtime-preferences.mjs', relative: 'plugin/scripts/runtime-preferences.mjs' },
].map((spec) => ({ ...spec,
  anchor: `import { ${spec.names} } from '${spec.specifier}';`,
  replacement: `// ${PATCH_MARKER}: use the existing native helper when the flat install omitted it.\n${rspRouterImport.toString()}\nconst { ${spec.names} } = await rspRouterImport(${JSON.stringify(spec.specifier)}, ${JSON.stringify(spec.relative)}, import.meta.url);`,
}));
const count = (source, anchor) => source.split(anchor).length - 1;
export const hasPatch = (source) => source.includes(PATCH_MARKER);
export const isPatched = (source) => SPECS.filter((s) => count(source, s.replacement) === 1).length === 1
  && SPECS.every((s) => !source.includes(s.anchor)) && count(source, PATCH_MARKER) === 1;
export function patchSource(source) {
  if (isPatched(source)) return { next: source, applied: [], missing: [] };
  const matching = SPECS.filter((s) => source.includes(s.anchor));
  if (matching.length !== 1 || count(source, matching[0].anchor) !== 1 || hasPatch(source)) {
    return { next: source, applied: [], missing: ['native-router-helper-import (absent, ambiguous or modified anchor)'] };
  }
  const spec = matching[0];
  return { next: source.replace(spec.anchor, spec.replacement), applied: [spec.file], missing: [] };
}
export const reverseSource = (source) => SPECS.reduce((s, spec) => s.replace(spec.replacement, spec.anchor), source);
export function discover() {
  // Own only the flat executable deployment. Native runtime imports are already
  // correctly adjacent; leave its source and installer/update plane unchanged.
  return SPECS.map((s) => path.join(HOME_BASE, '.claude/model-router/bin', s.file)).filter((file) => {
    try { const stat = fs.lstatSync(file); return stat.isFile() && !stat.isSymbolicLink() && stat.size > 0; }
    catch { return false; }
  });
}
export const descriptor = { name: 'brain-router-imports', atomic: true, missingIsIncomplete: true,
  discover, patchSource, hasPatch, isPatched, reverse: reverseSource };

// Retirement proves the unmodified installed import graph, never our bridge.
// The deployed flat owner must contain both helpers itself after an upstream fix.
export function probeRouterImportsReplacement({ files = discover() } = {}) {
  let temporary;
  try {
    if (files.length !== SPECS.length) return { state: 'unknown', evidence: 'both installed flat router import sites are required' };
    temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'rsp-native-router-imports-'));
    for (const [index, file] of files.entries()) {
      const spec = SPECS.find((item) => item.file === path.basename(file));
      if (!spec) throw new Error(`unknown router import site: ${file}`);
      const sourceFile = fs.readFileSync(file, 'utf8').includes('ruflo-source-patch') ? `${file}.rsp-backup` : file;
      const source = fs.readFileSync(sourceFile, 'utf8');
      if (source.includes('ruflo-source-patch') || count(source, spec.anchor) !== 1) throw new Error('unrecognized pristine native router import');
      const own = path.dirname(path.dirname(file));
      const staged = path.join(temporary, String(index));
      const copy = (from, body = null, seen = new Set()) => {
        if (seen.has(from)) return;
        if (seen.size >= 128) throw new Error('native router import graph exceeds proof bound');
        seen.add(from);
        const physical = fs.realpathSync(from);
        if (!physical.startsWith(fs.realpathSync(own) + path.sep)) throw new Error('native router dependency escapes its installed owner');
        const stat = fs.lstatSync(from);
        if (!stat.isFile() || stat.isSymbolicLink() || !stat.size) throw new Error(`unsafe installed router dependency: ${from}`);
        const source = body ?? fs.readFileSync(from, 'utf8');
        if (source.includes('ruflo-source-patch')) throw new Error('patched dependency cannot prove native delivery');
        const to = path.join(staged, path.relative(own, from));
        fs.mkdirSync(path.dirname(to), { recursive: true }); fs.writeFileSync(to, source);
        const imports = [...source.matchAll(/\bimport\s[\s\S]*?\bfrom\s*['"]([^'"]+)['"]/g)];
        for (const match of imports) {
          if (match[1].startsWith('.')) copy(path.resolve(path.dirname(from), match[1]), null, seen);
        }
      };
      const expected = path.resolve(path.dirname(file), spec.specifier);
      if (!fs.existsSync(expected)) return { state: 'live', evidence: `native flat router still omits ${expected}` };
      copy(file, source);
      const url = pathToFileURL(path.join(staged, path.relative(own, file))).href;
      const result = spawnSync(process.execPath, ['--input-type=module', '-e', `await import(${JSON.stringify(url)});`], {
        env: { HOME: staged, PATH: process.env.PATH }, encoding: 'utf8', timeout: 10_000,
      });
      if (result.error || result.status !== 0) throw new Error(result.error?.message || result.stderr || 'native router import failed');
    }
    return { state: 'superseded', evidence: 'both pristine installed flat router tools load their own regular native static dependency graphs without the #341 bridge' };
  } catch (error) { return { state: 'unknown', evidence: `native router-import delivery proof failed: ${error.message}` }; }
  finally { if (temporary) fs.rmSync(temporary, { recursive: true, force: true }); }
}
