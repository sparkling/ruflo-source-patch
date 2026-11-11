import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'rsp-discovery-'));
process.env.RUFLO_SOURCE_PATCH_HOME = sandbox;
process.env.RUFLO_NPX_ROOT = path.join(sandbox, 'npx');
process.env.RUFLO_GLOBAL_ROOT = path.join(sandbox, 'global');
const { discover } = await import('../lib/cwd/package-discovery.mjs');
function pkg(root, name) {
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name }));
  return path.join(root, 'package.json');
}
try {
  const nm = path.join(process.env.RUFLO_NPX_ROOT, 'fixture', 'node_modules');
  const hoisted = pkg(path.join(nm, '@claude-flow/cli'), '@claude-flow/cli');
  const wrapper = path.join(nm, 'ruflo');
  pkg(wrapper, 'ruflo');
  const nestedRoot = path.join(wrapper, 'node_modules/@claude-flow/cli');
  const nested = pkg(nestedRoot, '@claude-flow/cli');
  const dependency = pkg(path.join(nestedRoot, 'node_modules/agentdb'), 'agentdb');
  const global = pkg(path.join(process.env.RUFLO_GLOBAL_ROOT,
    'ruflo/node_modules/@claude-flow/cli'), '@claude-flow/cli');
  pkg(path.join(nm, 'unrelated/node_modules/@claude-flow/cli'), '@claude-flow/cli');
  assert.deepEqual(new Set(discover(['@claude-flow', 'cli', 'package.json'])),
    new Set([hoisted, nested, global]), 'cover both wrapper-selected and hoisted CLI copies only');
  assert.ok(discover(['agentdb', 'package.json']).includes(dependency),
    'nested CLI native dependencies must also be inventoried');
  console.log('Bounded npx/global wrapper package discovery passed');
} finally {
  fs.rmSync(sandbox, { recursive: true, force: true });
}
