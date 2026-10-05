import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { HOME_BASE } from '../lib/cwd/paths.mjs';
import { connectNativeMetadata } from '../lib/hook-failure-log/native-client.mjs';
assert.match(path.basename(HOME_BASE), /^rsp-hook-log-test-/);
const codexHome = path.join(HOME_BASE, '.codex'), audit = path.join(HOME_BASE, 'stdio-requests.jsonl');
function binary(mode = '') {
  const executable = path.join(HOME_BASE, 'fake-native-codex-' + (mode || 'normal') + '.mjs');
  fs.writeFileSync(executable, `#!${process.execPath}
import fs from 'node:fs';
const mode = ${JSON.stringify(mode)}, audit = ${JSON.stringify(audit)};
let buffer = '';
process.stdin.on('data', chunk => {
  buffer += chunk;
  while (buffer.includes('\\n')) {
    const end = buffer.indexOf('\\n'), message = JSON.parse(buffer.slice(0, end)); buffer = buffer.slice(end + 1);
    fs.appendFileSync(audit, JSON.stringify({ method: message.method, argv: process.argv.slice(2), codexHome: process.env.CODEX_HOME }) + '\\n');
    if (!('id' in message) || mode === 'stall') continue;
    if (mode === 'malformed') { process.stdout.write('not native JSON\\n'); continue; }
    process.stdout.write(JSON.stringify({method:'unrelated/notification'}) + '\\n');
    const response = mode === 'error' && message.method !== 'initialize'
      ? {id:message.id,error:{message:'PRIVATE_NATIVE_ERROR'}}
      : {id:message.id,result:{pid:process.pid,private:'PRIVATE_CONFIG_VALUE'}};
    process.stdout.write(JSON.stringify(response) + '\\n');
  }
});
process.stdin.on('end', () => process.exit(0));
`, { mode: 0o700 });
  return executable;
}
const options = { socketPath: path.join(HOME_BASE, 'absent-control.sock'), codexHome, cwd: HOME_BASE,
  nativeBinary: binary(), timeoutMs: 1500 };
let client = await connectNativeMetadata(options), pid;
try {
  assert.equal(client.transport, 'fresh-metadata-stdio');
  const result = await client.rpc('hooks/list', { cwds: [HOME_BASE] }); pid = result.pid;
  assert.equal(result.private, 'PRIVATE_CONFIG_VALUE');
  await assert.rejects(client.rpc('thread/start', {}), /method refused/);
  await assert.rejects(client.rpc('config/batchWrite', { filePath: path.join(codexHome, 'config.toml'),
    expectedVersion: 'fixture', reloadUserConfig: true, edits: [{ keyPath: 'model', value: 'changed', mergeStrategy: 'replace' }] }), /method refused/);
  await client.rpc('config/batchWrite', { filePath: path.join(codexHome, 'config.toml'), expectedVersion: 'fixture',
    reloadUserConfig: true, edits: [{ keyPath: 'hooks.state."ruflo-core@ruflo:hooks/hooks.json:stop:0:0".trusted_hash',
      value: 'sha256:' + 'a'.repeat(64), mergeStrategy: 'replace' }] });
} finally { await client.close(); }
assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
const rows = fs.readFileSync(audit, 'utf8').trim().split('\n').map(JSON.parse);
assert.deepEqual(rows.filter(row => row.method !== 'initialized').map(row => row.method), ['initialize', 'hooks/list', 'config/batchWrite']);
assert.ok(rows.every(row => row.codexHome === codexHome));
assert.ok(rows.every(row => JSON.stringify(row.argv) === JSON.stringify(['app-server', '--listen', 'stdio://'])));
for (const mode of ['stall', 'malformed', 'error']) {
  client = null;
  try {
    await assert.rejects(async () => {
      client = await connectNativeMetadata({ ...options, nativeBinary: binary(mode), timeoutMs: mode === 'stall' ? 80 : 1500 });
      await client.rpc('config/read', {});
    }, error => { assert.equal(error.message.includes('PRIVATE_NATIVE_ERROR'), false); return true; });
  } finally { await client?.close(); }
}
console.log('native metadata stdio: isolated account, fixed app-server argv, no thread/turn calls, exact trust-write boundary, deadlines and owned graceful exit passed');
