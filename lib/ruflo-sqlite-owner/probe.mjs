// Execute candidate native source against isolated dependency identities. Never
// load an installed registry, native database, service, or managed store.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { discover } from '../cwd/package-discovery.mjs';
import { ISSUE, MARKER, SQLITE_OWNER_ENTRIES } from './patcher.mjs';

function write(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text);
}
function pkg(root, name, source) {
  write(path.join(root, 'package.json'), JSON.stringify({ name, main: 'index.cjs' }));
  write(path.join(root, 'index.cjs'), source);
}
const OWNER = `module.exports = class Owned {
  constructor(file) { this.file = file; this.closed = false; }
  pragma() {} exec() {} close() { this.closed = true; }
  prepare() { return { run() { return { changes: 1 }; }, get() { return { n: 1 }; } }; }
};`;

export function exerciseSqliteOwnerSources({ bridge, graph, initializer }) {
  let scratch;
  try {
    if ([bridge, graph, initializer].some(s => typeof s !== 'string' || s.includes(MARKER)))
      throw new Error('source is missing or still carries the local SQLite-owner patch');
    if (graph.includes("const mod = 'better-sqlite3';") || initializer.includes("const mod = 'better-sqlite3';")
        || bridge.includes("cjsRequire('better-sqlite3')")) throw new Error('independent SQLite binding remains');
    // Recover and repair keep their published catches. Prove both known constructor
    // assignments, not a dead helper or an unrelated comment elsewhere in the file.
    const blocks = ['recoverMemoryDatabase', 'repairVectorIndexes'].map(name => {
      const start = initializer.indexOf(`export async function ${name}(dbPath, opts = {}) {`);
      const end = initializer.indexOf('\n    const ts =', start);
      const stop = name === 'recoverMemoryDatabase' ? end : initializer.indexOf('\n    let db;', start);
      const region = initializer.slice(start, stop);
      if (start < 0 || stop < start) throw new Error('native initializer function boundary absent');
      const matches = [...region.matchAll(/const \{ loadAgentDbSqlite \} = await import\('\.\/memory-bridge\.js'\);\n        Database = loadAgentDbSqlite\(\);/g)];
      if (matches.length !== 1) throw new Error(`${name} lacks a unique owned constructor invocation`);
      return matches[0][0];
    });
    scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'rsp-sqlite-native-proof-'));
    write(path.join(scratch, 'package.json'), '{"type":"module"}');
    const memory = path.join(scratch, 'node_modules', '@claude-flow', 'memory');
    pkg(memory, '@claude-flow/memory', 'module.exports = {};');
    const agent = path.join(memory, 'node_modules', 'agentdb');
    pkg(agent, 'agentdb', 'module.exports = {};');
    pkg(path.join(agent, 'node_modules', 'better-sqlite3'), 'better-sqlite3', OWNER);
    for (const root of [path.join(scratch, 'node_modules', 'better-sqlite3'),
      path.join(scratch, 'node_modules', 'agentdb', 'node_modules', 'better-sqlite3')]) {
      pkg(root, 'better-sqlite3', 'throw new Error("foreign SQLite library loaded");');
    }
    pkg(path.join(scratch, 'node_modules', 'agentdb'), 'agentdb', 'module.exports = {};');
    write(path.join(scratch, 'memory-bridge.js'), bridge);
    write(path.join(scratch, 'graph-edge-writer.js'), graph);
    write(path.join(scratch, 'memory-initializer.js'), `export function getMemoryRoot() { return ${JSON.stringify(scratch)}; }\n`
      + blocks.map((block, i) => `export async function constructor${i}() { let Database; ${block} return Database; }`).join('\n'));
    for (const [file, name] of [['live-memory-row.js', 'liveMemoryRowSql'], ['feedback-patterns.js', 'validateFeedbackPatterns'],
      ['embedding-quantization.js', 'encodeEmbedding']]) {
      write(path.join(scratch, file), `export function ${name}() { throw new Error('unrelated helper called'); }`);
    }
    const child = spawnSync(process.execPath, ['--input-type=module', '-e', `
import assert from 'node:assert/strict'; import fs from 'node:fs'; import { createRequire } from 'node:module';
const root=process.argv[1];
const b=await import('./memory-bridge.js'); const g=await import('./graph-edge-writer.js');
const init=await import('./memory-initializer.js');
const memory=createRequire(import.meta.url).resolve('@claude-flow/memory');
const agent=createRequire(memory).resolve('agentdb'); const req=createRequire(agent);
const Native=req('better-sqlite3'); assert.equal(b.loadAgentDbSqlite(),Native);
assert.equal(await init.constructor0(),Native); assert.equal(await init.constructor1(),Native);
const file=root+'/synthetic.fixture'; fs.writeFileSync(file,'fixture');
const holder=new Native(file); const writer=await g.getBridgeDb(file);
assert.ok(writer instanceof Native); assert.notEqual(holder,writer);
assert.equal(await g.insertGraphEdge({sourceId:'a',targetId:'b',relation:'rel',dbPath:file}),true);
assert.equal(g.releaseBridgeDb(file),true); assert.equal(holder.closed,false); assert.equal(writer.closed,true);
// A missing authoritative binding must never pick the direct CLI/decoy copy.
const nativeFile=req.resolve('better-sqlite3'); delete req.cache[nativeFile]; fs.unlinkSync(nativeFile);
assert.throws(()=>b.loadAgentDbSqlite()); assert.equal(await g.getBridgeDb(file),null);
console.log('owned-native-sqlite-proof');
`, scratch], {
      cwd: scratch, env: { PATH: process.env.PATH || '', HOME: scratch },
      encoding: 'utf8', timeout: 6000, maxBuffer: 128 * 1024,
    });
    if (child.error || child.status !== 0 || !child.stdout.includes('owned-native-sqlite-proof'))
      throw new Error(child.error?.message || child.stderr || child.stdout || 'native source proof failed');
    return { ok: true };
  } catch (error) { return { ok: false, evidence: error.message }; }
  finally { if (scratch) fs.rmSync(scratch, { recursive: true, force: true }); }
}

export function probeSqliteOwnerReplacement({ roots } = {}) {
  const candidates = roots || [...new Set(discover(SQLITE_OWNER_ENTRIES[0].suffix).map(file => path.dirname(file)))];
  if (!candidates.length) return { state: 'unknown', evidence: 'no installed CLI native memory source found' };
  for (const root of candidates) {
    try {
      const sources = {};
      for (const [kind, file] of [['bridge', 'memory-bridge.js'], ['graph', 'graph-edge-writer.js'], ['initializer', 'memory-initializer.js']]) {
        const full = path.join(root, file); const stat = fs.lstatSync(full);
        if (!stat.isFile() || stat.isSymbolicLink() || !stat.size) throw new Error('source is not a nonempty regular file');
        sources[kind] = fs.readFileSync(full, 'utf8');
      }
      const proof = exerciseSqliteOwnerSources(sources);
      if (!proof.ok) return { state: 'live', evidence: `${root}: ${proof.evidence}` };
    } catch (error) { return { state: 'unknown', evidence: `${root}: ${error.message}` }; }
  }
  return { state: 'superseded', evidence: `${candidates.length} native bundles execute one actual AgentDB dependency owner, preserve handle ownership and refuse missing native bindings (${ISSUE})` };
}
