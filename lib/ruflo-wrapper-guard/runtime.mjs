#!/usr/bin/env node
// ruflo-source-patch (ruvnet/ruflo#3306): newest installed stable implementation.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

function accountHome() {
  try { return os.userInfo().homedir; } catch { return os.homedir(); }
}

function versionParts(version) {
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([\da-zA-Z-]+(?:\.[\da-zA-Z-]+)*))?(?:\+[\da-zA-Z-]+(?:\.[\da-zA-Z-]+)*)?$/.exec(version);
  if (!match || match[4]?.split('.').some(id => /^0\d+$/.test(id))) {
    throw new Error('invalid implementation version: ' + version);
  }
  return { numbers: match.slice(1, 4).map(BigInt), prerelease: Boolean(match[4]) };
}

function compare(a, b) {
  for (let i = 0; i < 3; i++) {
    if (a.version.numbers[i] !== b.version.numbers[i]) {
      return a.version.numbers[i] > b.version.numbers[i] ? -1 : 1;
    }
  }
  // Equal versions prefer a top-level installation, then a deterministic path.
  return a.nested - b.nested || (a.root < b.root ? -1 : a.root > b.root ? 1 : 0);
}

export function selectCli(wrapperFile, {
  home = accountHome(), execPath = process.execPath, searchPath = process.env.PATH || '',
  prefix = process.env.NPM_CONFIG_PREFIX || process.env.npm_config_prefix,
} = {}) {
  const roots = new Set();
  const add = root => { if (path.isAbsolute(root)) roots.add(root); };
  const wrapperRoot = path.dirname(path.dirname(fs.realpathSync(wrapperFile)));
  add(path.join(wrapperRoot, 'node_modules'));
  // Only the wrapper's own install tree; never walk process.cwd() for a driver.
  let dir = path.dirname(wrapperRoot);
  for (let depth = 0; depth < 12; depth++) {
    if (path.basename(dir) === 'node_modules') { add(dir); break; }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  add(path.join(home, '.npm-global', 'lib', 'node_modules'));
  add(path.join(home, '.local', 'lib', 'node_modules'));
  add(path.join(path.dirname(path.dirname(execPath)), 'lib', 'node_modules'));
  if (prefix && path.isAbsolute(prefix)) {
    add(path.join(prefix, 'lib', 'node_modules'));
    add(path.join(prefix, 'node_modules')); // Windows npm prefix.
  }
  for (const bin of searchPath.split(path.delimiter)) {
    if (!path.isAbsolute(bin) || bin.split(path.sep).includes('node_modules')) continue;
    if (path.basename(bin) === 'bin') add(path.join(path.dirname(bin), 'lib', 'node_modules'));
    if (process.platform === 'win32') add(path.join(bin, 'node_modules'));
  }
  const candidates = new Map();
  for (const root of roots) {
    for (const candidate of [path.join(root, '@claude-flow', 'cli'),
      path.join(root, 'ruflo', 'node_modules', '@claude-flow', 'cli')]) {
      let canonical;
      try { canonical = fs.realpathSync(candidate); }
      catch (error) { if (error.code === 'ENOENT') continue; throw error; }
      if (candidates.has(canonical)) continue;
      const manifest = path.join(canonical, 'package.json');
      if (!fs.lstatSync(manifest).isFile()) throw new Error('non-regular CLI manifest: ' + manifest);
      const pkg = JSON.parse(fs.readFileSync(manifest, 'utf8'));
      if (pkg.name !== '@claude-flow/cli' || pkg.type !== 'module'
        || !['bin/cli.js', './bin/cli.js'].includes(pkg.bin?.['claude-flow'])) {
        throw new Error('unrecognized @claude-flow/cli package contract: ' + manifest);
      }
      const version = versionParts(pkg.version);
      if (version.prerelease) continue;
      candidates.set(canonical, {
        root: canonical, version, nested: candidate.split(path.sep).filter(p => p === 'node_modules').length,
      });
    }
  }
  const selected = [...candidates.values()].sort(compare)[0];
  if (!selected) throw new Error('no installed stable @claude-flow/cli found');
  const entry = path.join(selected.root, 'bin', 'cli.js');
  // A broken newest install must fail, not silently fall back to an older runtime.
  if (!fs.lstatSync(entry).isFile() || fs.realpathSync(entry) !== entry) {
    throw new Error('selected CLI entry is not a regular in-package file: ' + entry);
  }
  return entry;
}

export async function launch(options) {
  try {
    const entry = selectCli(fileURLToPath(import.meta.url), options);
    process.argv[1] = entry;
    // One process, no shell/child/network installer, no branding/version interception.
    // Native CLI owns stdin, stdout, stderr, MCP framing, signals and exit status.
    await import(pathToFileURL(entry).href);
  } catch (error) {
    fs.writeSync(2, '[ruflo-source-patch #3306] ' + error.message + '\n'
      + 'Retry through npx -y ruflo@latest <arguments>; MCP: npx -y ruflo@latest mcp start. No global installation is required.\n');
    process.exitCode = 1;
  }
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await launch();
}
