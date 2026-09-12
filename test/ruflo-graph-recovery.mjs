// RuVector #984: read/write fidelity gate, NOT a managed-store recovery command.
// Every database opened here is a fresh, owned temporary fixture. Exit 1 means
// native recovery is NOT READY; connectivity alone must not make this gate green.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';

const args = process.argv.slice(2);
if (args.length !== 2 || args[0] !== '--native-cli' || !path.isAbsolute(args[1])) {
  console.error('Usage: node test/ruflo-graph-recovery.mjs --native-cli /absolute/CLI/package.json');
  process.exit(2);
}
const require = createRequire(args[1]);
const entry = require.resolve('@ruvector/graph-node');
const version = require('@ruvector/graph-node/package.json').version;
const scratch = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'graph-recovery-gate-')));
const expected = {
  sourceEdgeId: 'fixture-source-edge', relation: 'supports', weight: '0.8',
  metadata: JSON.stringify({ witness: 'fixture-witness', note: 'Æ → Ω' }),
};
const prelude = `import {createRequire} from 'node:module';
const {GraphDatabase} = createRequire(import.meta.url)(${JSON.stringify(entry)});
const storagePath = ${JSON.stringify(path.join(scratch, 'graph.db'))};
const db = new GraphDatabase({storagePath, dimensions:8, distanceMetric:'Cosine'});
if (!db.isPersistent() || db.getStoragePath() !== storagePath) throw Error('Unverified native persistence');
`;
const write = `const embedding = new Float32Array([1,0,0,0,0,0,0,0]);
for (const id of ['mem:a','mem:b','mem:c'])
  await db.createNode({id, embedding, properties:{diagnostic:'true'}});
const edge = {from:'mem:a',to:'mem:b',description:'supports',embedding,
  confidence:0.75,metadata:${JSON.stringify(expected)}};
await db.createEdge(edge);
await db.batchInsert({nodes:[],edges:[{...edge,to:'mem:c'}]});
`;
const read = `console.log(JSON.stringify({
  query:await db.query('MATCH (a)-[r]->(b) RETURN a,r,b'),
  neighbors:await db.kHopNeighbors('mem:a',2), stats:await db.stats()
}));`;
const snapshots = [];
for (const phase of ['writer', 'reopened-reader']) {
  const child = spawnSync(process.execPath, ['--input-type=module', '-e',
    prelude + (phase === 'writer' ? write : '') + read], {
    cwd: scratch, encoding: 'utf8', timeout: 15000,
  });
  assert.equal(child.status, 0, child.stderr || String(child.error));
  const result = JSON.parse(child.stdout.trim());
  assert.equal(result.stats.totalNodes, 3);
  assert.equal(result.stats.totalEdges, 2);
  assert.deepEqual(result.neighbors.sort(), ['mem:a', 'mem:b', 'mem:c']);
  assert.deepEqual(result.query.nodes.map(n => n.id).sort(), ['mem:a', 'mem:b', 'mem:c']);
  assert.ok(result.query.nodes.every(n => n.properties.diagnostic === 'true'));
  assert.deepEqual(result.query.edges.map(e => [e.from, e.to, e.edgeType]).sort(), [
    ['mem:a', 'mem:b', 'supports'], ['mem:a', 'mem:c', 'supports'],
  ]);
  snapshots.push({ phase, result });
}
assert.deepEqual(snapshots[0].result.query.edges.map(e => e.id).sort(),
  snapshots[1].result.query.edges.map(e => e.id).sort(), 'native edge identity survives reopen');
const failures = snapshots.flatMap(({ phase, result }) => result.query.edges.flatMap(edge =>
  Object.entries(expected).filter(([key, value]) => edge.properties[key] !== value)
    .map(([key, value]) => ({ phase, target: edge.to, key, expected: value,
      actual: edge.properties[key] ?? null }))));
console.log(JSON.stringify({
  status: failures.length ? 'NOT READY' : 'EDGE METADATA ROUND-TRIP PASSED',
  issue: 'https://github.com/ruvnet/RuVector/issues/984', nativeVersion: version,
  fixture: scratch, topologyAndReopenPassed: true, failures,
  scope: 'Disposable single/batch edge metadata gate only; no live store opened, no recovery performed.',
}, null, 2));
process.exitCode = failures.length ? 1 : 0;
