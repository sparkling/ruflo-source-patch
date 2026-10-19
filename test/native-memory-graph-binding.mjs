// Opt-in end-to-end proof against a disposable installed CLI package.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { nativeDriver } from '../scripts/two-store-recovery.mjs';

const cliRoot = fs.realpathSync(process.argv[2]);
assert(cliRoot.startsWith(fs.realpathSync(os.tmpdir()) + path.sep), 'qualify a disposable package, never patch the live runtime from this test');
const { Database, version } = await nativeDriver(cliRoot);
const require = createRequire(path.join(cliRoot, 'package.json'));
const { Client } = await import(pathToFileURL(require.resolve('@modelcontextprotocol/sdk/client/index.js')));
const { StdioClientTransport } = await import(pathToFileURL(require.resolve('@modelcontextprotocol/sdk/client/stdio.js')));
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'rsp-native-graph-path-'));
const stores = path.join(scratch, '.swarm'); fs.mkdirSync(stores);
try {
  for (const [name, target] of [['memory.db', 'entity:default-store'], ['agentdb-memory.db', 'entity:research-store']]) {
    const db = new Database(path.join(stores, name));
    db.exec('CREATE TABLE graph_edges(id TEXT PRIMARY KEY,source_id TEXT,target_id TEXT,relation TEXT,weight REAL,metadata TEXT,last_reinforced TEXT)');
    db.prepare('INSERT INTO graph_edges VALUES(?,?,?,?,?,?,?)').run('edge', 'entity:probe', target, 'links', 1, '{}', null); db.close();
  }
  async function query(configured) {
    const env = { ...process.env, CLAUDE_FLOW_MEMORY_PATH: stores,
      CLAUDE_FLOW_DISABLE_NATIVE_ROUTER: '1', RUFLO_DAEMON_AUTOSTART: '0', RUFLO_DAEMON_AI_WORKERS: '0',
      RUFLO_HARNESS_LOOP: '0', RUFLO_FLYWHEEL_LEGACY_APPLY: '0' };
    delete env.CLAUDE_FLOW_DB_PATH;
    if (configured) env.CLAUDE_FLOW_DB_PATH = configured;
    const transport = new StdioClientTransport({ command: process.execPath,
      args: [path.join(cliRoot, 'bin/cli.js'), 'mcp', 'start'], cwd: scratch, env, stderr: 'pipe' });
    transport.stderr?.on('data', () => {});
    const client = new Client({ name: 'synthetic-graph-binding-proof', version: '1.0.0' });
    try {
      await client.connect(transport);
      const result = await client.callTool({ name: 'agentdb_graph-query', arguments: { nodeId: 'entity:probe', mode: 'k-hop', depth: 1 } }, undefined, { timeout: 30000 });
      return result.structuredContent ?? JSON.parse(result.content.filter(c => c.type === 'text').map(c => c.text).join('\n'));
    } finally { await client.close(); }
  }
  const research = path.join(stores, 'agentdb-memory.db');
  assert.deepEqual((await query(research)).results?.map(r => r.nodeId), ['entity:research-store']);
  assert.deepEqual((await query(undefined)).results?.map(r => r.nodeId), ['entity:default-store']);
  const absent = await query(path.join(stores, 'absent.db'));
  assert.equal(absent.success, false); assert(!JSON.stringify(absent).includes('entity:default-store'));
  const encrypted = path.join(stores, 'encrypted.db'); fs.writeFileSync(encrypted, 'RFE1' + 'x'.repeat(100));
  const refused = await query(encrypted); assert.equal(refused.success, false);
  assert(!JSON.stringify(refused).includes('entity:default-store'));
  assert.equal(fs.readFileSync(encrypted, 'utf8'), 'RFE1' + 'x'.repeat(100));
  console.log(JSON.stringify({ verified: true, version, checks: 4,
    scope: 'fresh native MCP graph respects explicit research file; ordinary default unchanged; missing/encrypted explicit sources refuse without default-store fallback; synthetic stores only' }));
} finally { fs.rmSync(scratch, { recursive: true, force: true }); }
