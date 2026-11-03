// Large native catalogs still require an exact installed, enabled cache identity.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(process.argv[2]);
const home = path.join(root, 'home');
const codexHome = path.join(home, '.codex');
const plugin = path.join(codexHome, 'plugins/cache/ruflo/ruflo-core/0.2.13');
const rows = path.join(root, 'rows.json');
const codex = path.join(root, 'codex');
fs.mkdirSync(path.join(plugin, '.claude-plugin'), { recursive: true });
fs.writeFileSync(path.join(plugin, '.claude-plugin/plugin.json'), JSON.stringify({ name: 'ruflo-core', version: '0.2.13' }));
fs.writeFileSync(codex, `#!${process.execPath}
if (process.argv.slice(2).join(' ') !== 'plugin list --available --json') process.exit(2);
require('node:fs').writeFileSync(1, require('node:fs').readFileSync(${JSON.stringify(rows)}));
`, { mode: 0o755 });
process.env.RUFLO_SOURCE_PATCH_HOME = home;
process.env.RSP_CODEX_HOME = codexHome;
process.env.RSP_CODEX_BIN = codex;
const { resolveActive } = await import('../lib/codex-skills/patcher.mjs');
const spec = { pluginId: 'ruflo-core@ruflo', plugin: 'ruflo-core', marketplace: 'ruflo' };
const installed = { pluginId: spec.pluginId, name: spec.plugin, marketplaceName: spec.marketplace,
  version: '0.2.13', installed: true, enabled: true, source: { path: plugin } };
function writeRows(bytes, item = installed) {
  fs.writeFileSync(rows, JSON.stringify({ installed: [item], available: [{ description: 'x'.repeat(bytes) }] }));
}
writeRows(5 * 1024 * 1024);
assert.ok(fs.statSync(rows).size > 5 * 1024 * 1024);
assert.equal(resolveActive(spec), plugin, 'a catalog above the former 4MiB limit resolves the exact cache');
writeRows(5 * 1024 * 1024, { ...installed, enabled: false });
assert.throws(() => resolveActive(spec), /not installed and enabled/, 'larger catalogs do not relax authority');
writeRows(17 * 1024 * 1024);
assert.throws(() => resolveActive(spec), /cannot run Codex:.*ENOBUFS/, 'the new buffer remains bounded');
console.log('Large Codex plugin registry proof passed');
