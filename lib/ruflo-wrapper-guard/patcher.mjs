// Upstream ruvnet/ruflo#3306: preserve ruflo while selecting the newest installed CLI.
import fs from 'node:fs';
import path from 'node:path';
import { HOME_BASE, NPX_ROOT, GLOBAL_ROOTS } from '../cwd/paths.mjs';
import { HOOK_ANCHOR, HOOK_REPLACEMENT, LEGACY_ANCHOR, LEGACY_REPLACEMENT, patchHook } from './hooks.mjs';

export const PATCH_MARKER = 'ruflo-source-patch (ruvnet/ruflo#3306)';
export const WRAPPER_SOURCE = "#!/usr/bin/env node\n// Ruflo CLI - thin wrapper around @claude-flow/cli with ruflo branding\nimport { fileURLToPath, pathToFileURL } from 'node:url';\nimport { dirname, resolve, join } from 'node:path';\nimport { existsSync, readFileSync } from 'node:fs';\n\nconst __dirname = dirname(fileURLToPath(import.meta.url));\n\n// #2256 fast path: --version / -V must NOT trigger heavy imports (the\n// downstream @claude-flow/cli dist eagerly loads ruvector + a 23 MB ONNX\n// model on cold cache, blocking 60+ s and causing SIGTERM under common\n// timeout windows: npx default, MCP stdio 30s window). Resolve version\n// from this wrapper's own package.json and exit before any heavy import.\n// (bin/cli.js has the same guard for the direct path; needed here too\n// because the wrapper imports dist/src/index.js, bypassing bin/cli.js.)\n{\n  const _argv = process.argv.slice(2);\n  if (_argv.length === 1 && (_argv[0] === '--version' || _argv[0] === '-V')) {\n    try {\n      const pkg = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf-8'));\n      process.stdout.write(`ruflo v${pkg.version || '0.0.0'}\\n`);\n    } catch {\n      process.stdout.write('ruflo v0.0.0\\n');\n    }\n    process.exit(0);\n  }\n}\n\n// Walk up from ruflo/bin/ to find @claude-flow/cli in node_modules\nfunction findCliPath() {\n  let dir = resolve(__dirname, '..');\n  for (let i = 0; i < 10; i++) {\n    const candidate = join(dir, 'node_modules', '@claude-flow', 'cli', 'bin', 'cli.js');\n    if (existsSync(candidate)) return dir;\n    const parent = dirname(dir);\n    if (parent === dir) break;\n    dir = parent;\n  }\n  return null;\n}\n\n// Convert path to file:// URL for cross-platform ESM import (Windows requires this)\nfunction toImportURL(filePath) {\n  return pathToFileURL(filePath).href;\n}\n\nconst pkgDir = findCliPath();\nconst cliBase = pkgDir\n  ? join(pkgDir, 'node_modules', '@claude-flow', 'cli')\n  : resolve(__dirname, '../../v3/@claude-flow/cli');\n\n// MCP mode: delegate to cli.js directly (branding irrelevant for JSON-RPC)\nconst cliArgs = process.argv.slice(2);\nconst isExplicitMCP = cliArgs.length >= 1 && cliArgs[0] === 'mcp' && (cliArgs.length === 1 || cliArgs[1] === 'start');\nconst isMCPMode = !process.stdin.isTTY && (process.argv.length === 2 || isExplicitMCP);\n\nif (isMCPMode) {\n  await import(toImportURL(join(cliBase, 'bin', 'cli.js')));\n} else {\n  // CLI mode: use ruflo branding\n  const { CLI } = await import(toImportURL(join(cliBase, 'dist', 'src', 'index.js')));\n  const cli = new CLI({\n    name: 'ruflo',\n    description: 'Ruflo - AI Agent Orchestration Platform',\n  });\n  cli.run()\n    .then(() => {\n      // #1641/#1653: Exit cleanly after one-shot commands.\n      // HNSW VectorDb, sql.js WASM, and ONNX worker threads keep the\n      // event loop alive after the command handler returns.\n      process.exit(0);\n    })\n    .catch((error) => {\n      console.error('Fatal error:', error.message);\n      process.exit(1);\n    });\n}\n";
export const REFUSAL_SOURCE = `#!/usr/bin/env node
// ${PATCH_MARKER}
// The original wrapper is retained only in the engine's pristine backup.
import { writeSync } from 'node:fs';
writeSync(2, '[ruflo-source-patch] REFUSING the ruflo branding wrapper (#3306). Its version can differ from the executing @claude-flow/cli.\\n'
  + 'Use the implementation explicitly: npm exec --yes --package=@claude-flow/cli@latest -- claude-flow <arguments>\\n'
  + 'For an installed implementation, invoke its claude-flow executable directly. For MCP use: claude-flow mcp start\\n'
  + 'Nothing was delegated, downloaded, or opened by this guard. https://github.com/ruvnet/ruflo/issues/3306\\n');
process.exit(1);
`;
export const RUNTIME_SOURCE = fs.readFileSync(new URL('./runtime.mjs', import.meta.url), 'utf8');

export function patchSource(source) {
  if (source.includes('function invokeHook(')) return patchHook(source);
  if (FORMATS.some(format => source === format(RUNTIME_SOURCE))) return { next: source, applied: [], missing: [] };
  const format = FORMATS.find(format => [WRAPPER_SOURCE, REFUSAL_SOURCE].some(old => source === format(old)));
  if (!format) {
    return { next: source, applied: [], missing: ['exact-published-wrapper-source'] };
  }
  return { next: format(RUNTIME_SOURCE), applied: ['newest-installed-implementation'], missing: [] };
}
// npm may normalize just the shebang of a CRLF distribution. Preserve each exact form.
const FORMATS = [source => source, source => source.replaceAll('\n', '\r\n'),
  source => source.replaceAll('\n', '\r\n').replace('\r\n', '\n')];
export const hasPatch = (source) => source.includes(PATCH_MARKER);
export const isPatched = (source) => FORMATS.some(format => source === format(RUNTIME_SOURCE))
  || source.includes(HOOK_REPLACEMENT) || source.includes(LEGACY_REPLACEMENT);
export function reverseSource(source) {
  const format = FORMATS.find(format => [RUNTIME_SOURCE, REFUSAL_SOURCE].some(patched => source === format(patched)));
  return format ? format(WRAPPER_SOURCE)
    : source.replace(HOOK_REPLACEMENT, HOOK_ANCHOR).replace(LEGACY_REPLACEMENT, LEGACY_ANCHOR);
}

function entries(dir) {
  try { return fs.readdirSync(dir, { withFileTypes: true }); }
  catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}
function regular(file) {
  try { return fs.lstatSync(file).isFile(); } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}
export function discover() {
  const roots = [...GLOBAL_ROOTS];
  for (const entry of entries(NPX_ROOT)) {
    if (entry.isDirectory()) roots.push(path.join(NPX_ROOT, entry.name, 'node_modules'));
  }
  const files = new Set();
  for (const root of new Set(roots)) {
    for (const entry of entries(root)) {
      if (!entry.isDirectory() || !(entry.name === 'ruflo' || entry.name.startsWith('.ruflo-'))) continue;
      const pkgRoot = path.join(root, entry.name);
      const file = path.join(pkgRoot, 'bin', 'ruflo.js');
      // Package-only metadata and packages without this wrapper are not targets.
      if (!fs.existsSync(file)) continue;
      const manifest = path.join(pkgRoot, 'package.json');
      if (!regular(manifest)) throw new Error('wrapper package manifest is not a regular file: ' + manifest);
      const pkg = JSON.parse(fs.readFileSync(manifest, 'utf8'));
      if (pkg.name !== 'ruflo') continue;
      if (pkg.bin?.ruflo !== 'bin/ruflo.js') throw new Error('unknown ruflo bin contract: ' + manifest);
      if (!regular(file) || fs.realpathSync(file) !== path.join(fs.realpathSync(pkgRoot), 'bin', 'ruflo.js')) {
        throw new Error('wrapper is missing or traverses a symlink: ' + file);
      }
      files.add(file);
    }
  }
  for (const host of ['.claude', '.codex']) {
    const home = path.join(HOME_BASE, host);
    const cache = path.join(home, 'plugins', 'cache', 'ruflo', 'ruflo-core');
    const candidates = entries(cache).filter(e => e.isDirectory()).map(e => path.join(cache, e.name));
    candidates.push(path.join(home, 'plugins', 'marketplaces', 'ruflo', 'plugins', 'ruflo-core'));
    if (host === '.codex') candidates.push(path.join(home, '.tmp', 'marketplaces', 'ruflo', 'plugins', 'ruflo-core'));
    for (const root of candidates) {
      const file = path.join(root, 'scripts', 'ruflo-hook.cjs');
      if (!fs.existsSync(file)) continue;
      const manifest = path.join(root, '.claude-plugin', 'plugin.json');
      if (!regular(manifest) || JSON.parse(fs.readFileSync(manifest, 'utf8')).name !== 'ruflo-core') {
        throw new Error('unverified ruflo-core identity: ' + root);
      }
      if (!regular(file) || fs.realpathSync(file) !== path.join(fs.realpathSync(root), 'scripts', 'ruflo-hook.cjs')) {
        throw new Error('hook traverses a symlink: ' + file);
      }
      files.add(file);
    }
  }
  return [...files].sort();
}

export const descriptor = {
  name: 'ruflo-wrapper-guard', atomic: true, missingIsIncomplete: true,
  discover, patchSource, reverse: reverseSource, hasPatch, isPatched,
};
