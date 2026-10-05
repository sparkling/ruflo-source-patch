// Execute the reviewed native guard only against inert payloads in an isolated home.
// No project files, managed memory, update assets, host settings or trust are touched.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { discover } from './patcher.mjs';
import { HELPER_NAME, NATIVE_HELPER_ALIAS_HASH, readNativeGroundingBundle } from './native.mjs';

export function exerciseNativeGrounding({ guard, helper }, root) {
  root = fs.realpathSync(root); // macOS /var aliases must not hide the native CLI entrypoint.
  const scripts = path.join(root, 'scripts');
  fs.mkdirSync(scripts, { recursive: true });
  const script = path.join(scripts, 'ground-before-write.sh');
  const helperFile = path.join(scripts, HELPER_NAME);
  fs.writeFileSync(script, guard);
  fs.writeFileSync(helperFile, helper);
  const profile = path.join(root, '.claude/model-router/profile.json');
  fs.mkdirSync(path.dirname(profile), { recursive: true });
  fs.writeFileSync(profile, '{}');
  const env = { HOME: root, PATH: process.env.PATH || '', MODEL_ROUTER_PROFILE: profile,
    RUVNET_BRAIN_STATE_DIR: path.join(root, 'state'), RUVNET_SKIP_GROUNDING_CHECK: '0' };
  const event = (content, file = 'backup.py') => ({ tool_name: 'Write',
    tool_input: { file_path: path.join(root, file), content } });
  let assertions = 0;
  const check = (payload, expected) => {
    const result = spawnSync('/bin/bash', [script], { input: typeof payload === 'string'
      ? payload : JSON.stringify(payload), env, cwd: root, encoding: 'utf8', timeout: 5000,
      maxBuffer: 64 * 1024 });
    if (result.error) throw result.error;
    assert.equal(result.status, expected, `native replay ${assertions + 1}: ${result.stderr}`);
    if (expected === 2) assert.match(result.stderr, /BLOCKED/);
    assertions++;
  };
  const addFile = (content, file = 'backup.py') => ({ tool_name: 'Edit', tool_input: {
    file_path: path.join(root, file), new_string: `*** Begin Patch\n*** Add File: ${path.join(root, file)}\n`
      + content.trimEnd().split('\n').map(line => '+' + line).join('\n') + '\n*** End Patch' } });
  const incident = '#!/usr/bin/env python3\n"""Consistent application SQLite backup; never access Ruflo/AgentDB memory stores."""\nimport sqlite3\n';
  check(event(incident), 0);
  check(addFile(incident), 0);
  check(event('// AgentDB warning\n/* Ruflo is unrelated */\nexport const answer = 1;', 'code.mjs'), 0);
  check(event(incident + 'db = sqlite3.connect("orders.db")\n'), 0);
  for (const source of ['import agentdb\n', 'exec("agentdb")\n', 'payload = """agentdb"""\n',
    'exec(\n"""agentdb"""\n)\n', 'f"""{agentdb.run()}"""\n', '"""agentdb""".strip()\n',
    '"""unterminated agentdb', 'def backup():\n    """Never access AgentDB."""\n    return 1\n',
    '# coding: utf-7\n#+AAo-import agentdb\n', '"""agentdb"""\nexec(__doc__)\n']) {
    check(event(source), 2); check(addFile(source), 2);
  }
  for (const source of ["import 'agentdb';", "const x = 'https://host/agentdb';",
    'const x = `agentdb ${call()}`;', '/* unterminated agentdb', 'const x = /agentdb/;',
    '// harmless\u2028import agentdb;']) check(event(source, 'code.mjs'), 2);
  check(event(incident, 'agentdb-backup.py'), 2);
  check(event('echo agentdb', 'code.sh'), 2);
  check(event(incident + 'db = sqlite3.connect(".swarm/memory.db")\n'), 2);
  check(event(incident + 'db.execute("DELETE FROM memory_entries")\n'), 2);
  check({ tool_name: 'Edit', tool_input: { file_path: path.join(root, 'backup.py'),
    new_string: '# agentdb warning' } }, 2);
  check({ tool_name: 'MultiEdit', tool_input: { file_path: path.join(root, 'backup.py'),
    edits: [{ new_string: '# agentdb warning' }, { new_string: 'import agentdb' }] } }, 2);
  check(JSON.stringify(event('import agentdb')).slice(0, -1), 2);
  fs.unlinkSync(helperFile);
  check(event(incident), 2); // Missing optional projection cannot erase the original refusal.
  fs.writeFileSync(helperFile, 'process.exit(0);');
  check(event(incident), 2); // Empty successful output is not positive exemption evidence.
  fs.writeFileSync(helperFile, helper);
  const stamps = path.join(root, '.cache/ruvnet-brain/grounded');
  fs.mkdirSync(stamps, { recursive: true });
  fs.writeFileSync(path.join(stamps, 'agentdb'), '');
  check(event('import agentdb'), 0);
  check(event('import metaharness'), 2);
  fs.utimesSync(path.join(stamps, 'agentdb'), new Date(0), new Date(0));
  check(event('import agentdb'), 2);
  check(event(incident), 0);
  if (createHash('sha256').update(helper).digest('hex') === NATIVE_HELPER_ALIAS_HASH) {
    const alias = path.join(root, 'projection-alias.mjs'); fs.symlinkSync(helperFile, alias);
    const input = JSON.stringify(event(incident));
    const direct = spawnSync(process.execPath, [helperFile], { input, env, encoding: 'utf8', timeout: 5000 });
    const throughAlias = spawnSync(process.execPath, [alias], { input, env, encoding: 'utf8', timeout: 5000 });
    assert.equal(direct.status, 0, direct.stderr); assert(direct.stdout.trim());
    assert.equal(throughAlias.status, 0, throughAlias.stderr);
    assert.equal(throughAlias.stdout, direct.stdout, 'native realpath alias executes the same projection');
    assertions++;
  }
  return { assertions };
}

export function probeGroundingCodeReplacement({ files = discover() } = {}) {
  let temporary;
  try {
    if (!files.length) return { state: 'unknown', evidence: 'no installed native grounding guards' };
    const bundles = files.map(readNativeGroundingBundle);
    // Replay each distinct reviewed executable bundle; equal bytes share one proof.
    temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'rsp-native-grounding-code-'));
    let assertions = 0;
    const unique = [...new Map(bundles.map(bundle => [JSON.stringify(bundle), bundle])).values()];
    for (const [index, bundle] of unique.entries()) {
      const root = path.join(temporary, String(index)); fs.mkdirSync(root);
      assertions += exerciseNativeGrounding(bundle, root).assertions;
    }
    for (let i = 0; i < files.length; i++) assert.deepEqual(readNativeGroundingBundle(files[i]), bundles[i],
      'native grounding bundle changed during proof');
    return { state: 'superseded', evidence: `${files.length} reviewed native guard/helper bundles; ${assertions} isolated native replays preserve executable/path/managed-memory refusal, conservative uncertain-context handling, missing-helper refusal and product-specific stamp expiry while exempting the reported inert documentation` };
  } catch (error) {
    return { state: 'live', evidence: `native grounding-code replacement unproved: ${error.message}` };
  } finally { if (temporary) fs.rmSync(temporary, { recursive: true, force: true }); }
}
