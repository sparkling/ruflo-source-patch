import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const temporary = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'rsp-learning-composition-')));
process.env.RUFLO_SOURCE_PATCH_HOME = temporary;
process.env.RUFLO_GLOBAL_ROOT = path.join(temporary, 'global');
process.env.RUFLO_NPX_ROOT = path.join(temporary, 'npx');
process.env.RSP_CODEX_HOME = path.join(temporary, '.codex');
const patch = await import('../lib/ruflo-learning-persistence/patcher.mjs');
const compose = await import('../lib/plugin-compose.mjs');
const fixture = n => fs.readFileSync(new URL(`./fixtures/ruflo-learning-persistence/${n}.js`, import.meta.url), 'utf8');
const sources = { 'memory/intelligence.js': fixture('intelligence'),
  'memory/memory-bridge.js': fixture('bridge-pattern'),
  'mcp-tools/hooks-tools.js': fixture('post-command') + '\n' + fixture('other-callers') };
try {
  const paths = Object.entries(sources).map(([relative, source]) => {
    const file = path.join(process.env.RUFLO_GLOBAL_ROOT, '@claude-flow/cli/dist/src', relative);
    fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, source);
    return [file, source];
  });
  assert.equal(patch.discover().length, 3);
  assert.equal(patch.preflight().ok, true);
  const installed = compose.applyComposed([patch.NAME]);
  assert.equal(installed.errors, 0, JSON.stringify(installed));
  assert.equal(installed.incomplete, 0, JSON.stringify(installed));
  assert.equal(installed.patched, 3);
  assert.equal(compose.applyComposed([patch.NAME]).patched, 0);
  for (const [file, source] of paths) {
    assert.equal(fs.readFileSync(file + '.rsp-backup', 'utf8'), source);
    assert(patch.isPatched(fs.readFileSync(file, 'utf8')));
  }
  assert.equal(compose.reconcile([], [patch.NAME]).errors, 0);
  for (const [file, source] of paths) assert.equal(fs.readFileSync(file, 'utf8'), source);
  console.log('PASS learning persistence composition: private installation, idempotence, exact pristine restoration');
} finally { fs.rmSync(temporary, { recursive: true, force: true }); }
