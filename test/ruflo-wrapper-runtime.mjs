import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { selectCli } from '../lib/ruflo-wrapper-guard/runtime.mjs';

if (!process.argv[2] || !path.isAbsolute(process.argv[2])) throw new Error('absolute isolated fixture root required');
const root = fs.realpathSync(process.argv[2]);
const wrapper = path.join(root, 'install/node_modules/ruflo/bin/ruflo.js');
function write(file, data) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, data); }
write(wrapper, '');
const options = { home: path.join(root, 'home'), execPath: path.join(root, 'node/bin/node'), searchPath: '', prefix: '' };
const own = path.join(root, 'install/node_modules');
const global = path.join(options.home, '.npm-global/lib/node_modules');
const custom = path.join(root, 'custom/lib/node_modules');
function cli(modules, version, overrides = {}) {
  const pkg = path.join(modules, '@claude-flow/cli');
  write(path.join(pkg, 'package.json'), JSON.stringify({
    name: '@claude-flow/cli', type: 'module', version, bin: { 'claude-flow': 'bin/cli.js' }, ...overrides,
  }));
  write(path.join(pkg, 'bin/cli.js'), '// fixture only');
  return path.join(pkg, 'bin/cli.js');
}
const select = (extra = {}) => selectCli(wrapper, { ...options, ...extra });
assert.throws(() => select(), /no installed stable/);
const nested = cli(path.join(own, 'ruflo/node_modules'), '3.9.99');
assert.equal(select(), nested);
const direct = cli(global, '3.10.0');
assert.equal(select(), direct, 'numeric semver, not lexicographic or first match');
cli(global, '3.10.0+build.99');
assert.equal(select(), direct);
const newest = cli(custom, '4.0.0');
assert.equal(select({ searchPath: path.join(root, 'custom/bin') }), newest);
assert.equal(select({ prefix: path.join(root, 'custom') }), newest);
cli(custom, '9.0.0-beta.1');
assert.equal(select({ prefix: path.join(root, 'custom') }), direct, 'do not silently opt into prereleases');
cli(custom, '3.10.0');
assert.equal(select({ searchPath: [path.join(root, 'custom/bin'), path.join(root, 'home/.npm-global/bin')].join(path.delimiter) }),
  select({ searchPath: [path.join(root, 'home/.npm-global/bin'), path.join(root, 'custom/bin')].join(path.delimiter) }));
// A project .bin on PATH and relative PATH entries cannot select a second driver.
const project = path.join(root, 'unrelated-project');
cli(path.join(project, 'node_modules'), '999.0.0');
const oldCwd = process.cwd();
process.chdir(project);
try { assert.equal(select({ searchPath: ['.', 'node_modules/.bin', path.join(project, 'node_modules/.bin')].join(path.delimiter) }), direct); }
finally { process.chdir(oldCwd); }
for (const version of ['3.010.0', '3.10', '3.10.0-beta.01', 'garbage']) {
  cli(custom, version);
  assert.throws(() => select({ prefix: path.join(root, 'custom') }), /invalid implementation version/);
}
cli(custom, '9.0.0', { name: 'impostor' });
assert.throws(() => select({ prefix: path.join(root, 'custom') }), /unrecognized/);
cli(custom, '9.0.0', { bin: { 'claude-flow': '../outside.js' } });
assert.throws(() => select({ prefix: path.join(root, 'custom') }), /unrecognized/);
cli(custom, '9.0.0');
fs.unlinkSync(newest);
assert.throws(() => select({ prefix: path.join(root, 'custom') }), /ENOENT/, 'broken newest must not fall back');
fs.symlinkSync(direct, newest);
assert.throws(() => select({ prefix: path.join(root, 'custom') }), /not a regular/);
fs.unlinkSync(newest);
write(newest, '');
const manifest = path.join(path.dirname(path.dirname(newest)), 'package.json');
fs.unlinkSync(manifest);
fs.symlinkSync(path.join(path.dirname(path.dirname(direct)), 'package.json'), manifest);
assert.throws(() => select({ prefix: path.join(root, 'custom') }), /non-regular CLI manifest/);
console.log('✓ wrapper selection: semver, global/custom/nested, stable-only, deterministic ties, cwd exclusion, malformed/broken/symlink refusal');
