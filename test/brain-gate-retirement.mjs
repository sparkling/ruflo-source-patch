// Native fixtures: Brain 4.5.2 executable bytes; consumer fake isolates retirement
// regression tests. Live proof imports the installed real Stop consumer.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
const root = fs.realpathSync(process.argv[2] || fs.mkdtempSync(path.join(os.tmpdir(), 'rsp-gate-test-')));
process.env.RUFLO_SOURCE_PATCH_HOME = root;
const { probeDualHostStdinReplacement, probeGroundingEvidenceReplacement } = await import('../lib/brain-native/gate-probes.mjs');
const write = (file, source) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, source); };
const dual = path.join(root, 'dual'); fs.mkdirSync(dual);
for (const name of ['dual-host-deliberation.mjs', 'subscription-hosts.mjs', 'review-model-defaults.mjs']) {
  fs.copyFileSync(new URL(`./fixtures/brain-dual-host-native/${name}`, import.meta.url), path.join(dual, name));
}
const file = path.join(dual, 'dual-host-deliberation.mjs');
assert.equal(probeDualHostStdinReplacement({ files: [file] }).state, 'superseded');
const original = fs.readFileSync(file, 'utf8');
write(file, original.replace('child.stdin.end(input);', "child.stdin.end('');"));
assert.equal(probeDualHostStdinReplacement({ files: [file] }).state, 'unknown', 'lost prompt cannot retire');
write(file, original);
fs.unlinkSync(path.join(dual, 'review-model-defaults.mjs'));
assert.match(probeDualHostStdinReplacement({ files: [file] }).evidence, /review-model-defaults/);
assert.equal(probeDualHostStdinReplacement({ files: [] }).state, 'unknown');

const ground = path.join(root, 'ground'); fs.mkdirSync(ground);
for (const name of ['grounding-stamp.sh', 'grounding-answer.mjs']) {
  fs.copyFileSync(new URL(`./fixtures/brain-grounding-native/${name}`, import.meta.url), path.join(ground, name));
}
// Small injectable consumer fixture for test isolation, matching real native's
// marker/mtime decision. The real installed consumer is exercised separately.
write(path.join(ground, 'grounding-turn-gate.mjs'), `import fs from 'node:fs'; import path from 'node:path'; import os from 'node:os';
export function decide({ markerMs }) { const dir = path.join(os.homedir(), '.cache/ruvnet-brain/grounded');
  let newest = null; try { for (const file of fs.readdirSync(dir)) { const ms = fs.statSync(path.join(dir,file)).mtimeMs;
    newest = newest === null ? ms : Math.max(newest, ms); } } catch {}
  return newest !== null && newest >= markerMs - 1500 ? null : 'no successful search'; }
`);
const stamp = path.join(ground, 'grounding-stamp.sh');
const nativeStamp = fs.readFileSync(stamp, 'utf8');
fs.copyFileSync(new URL('./fixtures/brain-grounding-evidence/ground-before-write.sh', import.meta.url),
  path.join(ground, 'ground-before-write.sh'));
assert.equal(probeGroundingEvidenceReplacement({ files: [stamp] }).state, 'superseded');
write(stamp, nativeStamp.replace(': > "$DIR/.any-search"', 'true # removed any-search evidence'));
assert.equal(probeGroundingEvidenceReplacement({ files: [stamp] }).state, 'unknown', 'generic success must leave evidence');
write(stamp, nativeStamp.replace('for t in $WRITE_GATE_TERMS $GATE1_ONLY_TERMS; do', ': > "$DIR/agentdb"\nfor t in $WRITE_GATE_TERMS $GATE1_ONLY_TERMS; do'));
assert.equal(probeGroundingEvidenceReplacement({ files: [stamp] }).state, 'unknown', 'generic success cannot authorize unrelated product');
write(stamp, nativeStamp);
const answerFile = path.join(ground, 'grounding-answer.mjs');
const answer = fs.readFileSync(answerFile, 'utf8');
write(answerFile, answer.replace("return answerTextAnswered(answerOf(response));", 'return true;'));
assert.equal(probeGroundingEvidenceReplacement({ files: [stamp] }).state, 'unknown', 'forged and failed results cannot retire');
write(answerFile, answer);
assert.equal(probeGroundingEvidenceReplacement({ files: [] }).state, 'unknown');
console.log('✓ brain gate retirement: native 300 KiB stdin, parsed-result turn evidence, scoped stamps, broken dependencies and deliberate regressions');
