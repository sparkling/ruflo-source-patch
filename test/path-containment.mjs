import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { existingPathRelative } from '../lib/path-containment.mjs';

const sandbox = process.argv[2] || fs.mkdtempSync(path.join(os.tmpdir(), 'rsp-containment-'));
const home = path.join(sandbox, 'physical-home');
const alias = path.join(sandbox, 'home-alias');
fs.mkdirSync(home, { recursive: true });
fs.symlinkSync(home, alias, 'dir');
process.env.RUFLO_SOURCE_PATCH_HOME = home;
process.env.CODEX_HOME = path.join(alias, '.codex');
process.env.RUFLO_NPX_ROOT = path.join(sandbox, 'npx');
process.env.RUFLO_GLOBAL_ROOT = path.join(sandbox, 'global');
process.env.RSP_NO_SELF_UPDATE = '1';
process.env.RSP_NO_HOST_AUTO_UPDATE = '1';
process.env.RSP_NO_LAUNCHCTL = '1';
process.env.RSP_NO_STALE_WRITER_KILL = '1';

function write(file, source) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, source);
  return file;
}
const owner = path.join(home, 'owner');
const file = write(path.join(owner, 'inside.mjs'), '// inside\n');
const outside = write(path.join(home, 'outside.mjs'), '// outside\n');
fs.symlinkSync(file, path.join(owner, 'inside-alias.mjs'));
fs.symlinkSync(outside, path.join(owner, 'escape.mjs'));
fs.symlinkSync(path.join(home, 'missing'), path.join(owner, 'dangling.mjs'));
assert.equal(existingPathRelative(owner, path.join(alias, 'owner', 'inside.mjs')), 'inside.mjs');
assert.equal(existingPathRelative(path.join(alias, 'owner'), file), 'inside.mjs');
assert.equal(existingPathRelative(owner, path.join(owner, 'inside-alias.mjs')), 'inside.mjs');
assert.equal(existingPathRelative(owner, owner), '');
for (const candidate of [home, outside, path.join(owner, 'escape.mjs'),
  path.join(owner, 'dangling.mjs'), path.join(owner, 'missing.mjs')]) {
  assert.equal(existingPathRelative(owner, candidate), null, candidate);
}
assert.equal(existingPathRelative(path.join(home, 'missing'), file), null);
assert.equal(existingPathRelative(file, file), null);
assert.equal(existingPathRelative(owner, 'inside.mjs'), null);
assert.equal(existingPathRelative(owner, null), null);

const marketplace = path.join(home, '.claude', 'plugins', 'marketplaces', 'ruflo');
const claudeMarket = path.join(marketplace, 'plugins', 'ruflo-adr');
const cacheBoundary = path.join(home, '.claude', 'plugins', 'cache', 'ruflo', 'ruflo-adr');
const claudeCache = path.join(cacheBoundary, '0.4.1');
const codexMarket = path.join(home, '.codex', '.tmp', 'marketplaces', 'ruflo', 'plugins', 'ruflo-adr');
const codexCache = path.join(home, '.codex', 'plugins', 'cache', 'ruflo', 'ruflo-adr', '0.4.1');
const roots = [claudeMarket, claudeCache, codexMarket, codexCache];
const parser = path.join('scripts', 'lib', 'parse-adrs.mjs');
for (const root of roots) {
  write(path.join(root, '.claude-plugin', 'plugin.json'), '{"name":"ruflo-adr","version":"0.4.1"}\n');
  write(path.join(root, parser), '// parser selection fixture\n');
}
const registry = path.join(home, '.claude', 'plugins', 'installed_plugins.json');
function register(installPath) {
  write(registry, JSON.stringify({ plugins: {
    'ruflo-adr@ruflo': [{ scope: 'user', installPath, version: '0.4.1' }],
  } }));
}
register(path.join(alias, '.claude', 'plugins', 'cache', 'ruflo', 'ruflo-adr', '0.4.1'));
const { activeRufloAdrRoots, activeParserCopies } = await import('../lib/adr-template/supersede.mjs');
const { activeRoots } = await import('../lib/adr-io-safety/patcher.mjs');
assert.equal(activeRufloAdrRoots().error, undefined);
assert.equal(activeParserCopies().copies.length, 4);
assert.deepEqual(new Set(activeRoots()), new Set(roots.map((root) => fs.realpathSync(root))));

// Exercise the real MCP-prefix provenance selector against an independent Git
// HEAD, with a registry spelling different from the physical account home.
const replacement = 'mcp__plugin_ruflo-core_ruflo__';
write(path.join(marketplace, 'plugins', 'ruflo-core', 'agents', 'researcher.md'), replacement + 'memory_search\n');
write(path.join(marketplace, 'plugins', 'ruflo-core', 'skills', 'discover-plugins', 'SKILL.md'), replacement + 'memory_list\n');
execFileSync('git', ['init', '--initial-branch=main', '--quiet'], { cwd: marketplace });
execFileSync('git', ['add', 'plugins'], { cwd: marketplace });
execFileSync('git', ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid',
  '-c', 'commit.gpgsign=false', 'commit', '--quiet', '-m', 'fixture'], { cwd: marketplace });
const { mcpPrefixSupersession } = await import('../lib/mcp-prefix/supersede.mjs');
const prefix = mcpPrefixSupersession.check();
assert.equal(prefix.state, 'superseded', JSON.stringify(prefix));

const foreign = path.join(home, 'foreign-plugin');
write(path.join(foreign, '.claude-plugin', 'plugin.json'), '{"name":"ruflo-adr","version":"0.4.1"}\n');
const escaped = path.join(cacheBoundary, 'escape');
fs.symlinkSync(foreign, escaped, 'dir');
register(escaped);
assert.match(activeRufloAdrRoots().error, /outside its bounded cache/);
assert.equal(activeRoots().includes(fs.realpathSync(foreign)), false);
assert.equal(mcpPrefixSupersession.check().state, 'unknown');
register(path.join(cacheBoundary, 'absent'));
assert.ok(activeRufloAdrRoots().error);
assert.equal(activeRoots().includes(path.join(cacheBoundary, 'absent')), false);
register(claudeCache);

// A valid root cannot grant execution to a parser symlink outside its owner.
const cacheParser = path.join(claudeCache, parser);
fs.unlinkSync(cacheParser);
fs.symlinkSync(outside, cacheParser);
assert.equal(activeParserCopies().copies.length, 0);
assert.match(activeParserCopies().error, /absent/);
console.log('Canonical path containment and ADR/MCP selector regressions passed');
