// v4.45 upgrade cleanup: removed #3315 must not remain in installed executables.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rsp-graph-withdrawal-'));
const file = path.join(root, 'global/@claude-flow/cli/dist/src/mcp-tools/agentdb-tools.js');
fs.mkdirSync(path.dirname(file), { recursive: true });
const pristine = 'export const upstream = true;\n';
const patched = "// ruflo-source-patch #3315: native availability is not coverage.\nconst retrievalContract = 'retained-sql-khop-v1';\n";
const env = { ...process.env, RUFLO_SOURCE_PATCH_HOME: root,
  RUFLO_GLOBAL_ROOT: path.join(root, 'global'), RUFLO_NPX_ROOT: path.join(root, 'npx') };
const library = new URL('../lib/cwd/patch-library.mjs', import.meta.url).href;
function apply() {
  const run = spawnSync(process.execPath, ['--input-type=module', '-e',
    `import {apply,PATCH_TARGETS} from ${JSON.stringify(library)};
     if(PATCH_TARGETS.some(x=>x.startsWith('ruflo-graph-')))throw Error('withdrawn target registered');
     console.log(JSON.stringify(apply([])));`], { env, encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
  return JSON.parse(run.stdout);
}
fs.writeFileSync(file, patched);
assert.equal(apply().errors, 1); // Missing backup refuses without changing bytes.
assert.equal(fs.readFileSync(file, 'utf8'), patched);
fs.writeFileSync(file + '.rsp-backup', pristine);
assert.equal(apply().restored, 1);
assert.equal(fs.readFileSync(file, 'utf8'), pristine);
assert.equal(apply().restored, 0); // Repeated monitor ticks are inert.
fs.writeFileSync(file, 'export const newerUpstream = true;\n');
fs.writeFileSync(file + '.rsp-backup', pristine);
assert.equal(apply().restored, 0); // An unmarked upstream upgrade is not reverted.
assert.equal(fs.readFileSync(file, 'utf8'), 'export const newerUpstream = true;\n');
console.log('Graph withdrawal: exact marker, pristine restoration, missing-backup refusal, idempotence and unmarked-source preservation passed.');
