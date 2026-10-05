// Exact public tag v4.5.10, d110bf7b8a6c647a66c88172778bda81011b74df.
// Fixtures come from https://github.com/stuinfla/ruvnet-brain/tree/v4.5.10/plugin/scripts.
// Unchanged owners reuse the previously reviewed v4.5.7/9 fixtures. Every runtime
// here is inert: no host settings, managed DB, KB or updater is opened.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { nativeSatisfied as groundingNative } from '../lib/brain-grounding-code/native.mjs';
import { exerciseNativeGrounding, probeGroundingCodeReplacement } from '../lib/brain-grounding-code/probe.mjs';
import { readCapturePrivacySources, evaluateCapturePrivacy, isReviewedNativeCaptureNormalizer } from '../lib/brain-native/capture-privacy-proof.mjs';
import * as capture from '../lib/brain-managed-cli-capture/patcher.mjs';
import { probeCaptureBehavior } from '../lib/brain-managed-cli-capture/probe.mjs';
import * as diagnostics from '../lib/brain-managed-cli-diagnostics/patcher.mjs';
import { probeDiagnosticsBehavior } from '../lib/brain-managed-cli-diagnostics/probe.mjs';
import * as transition from '../lib/brain-transition-validation/patcher.mjs';
import { exerciseTransitionSource, probeTransitionValidationReplacement } from '../lib/brain-transition-validation/probe.mjs';
import * as collision from '../lib/brain-progression-collision/patcher.mjs';
import { exerciseSources, storeFixture, probeProgressionCollisionReplacement } from '../lib/brain-progression-collision/probe.mjs';
import { exerciseSuspensionSources, probeProgressionSuspensionReplacement } from '../lib/brain-progression-suspension/probe.mjs';
import * as suspension from '../lib/brain-progression-suspension/patcher.mjs';
import { composeSource } from '../lib/plugin-compose.mjs';

const fixture = fileURLToPath(new URL('./fixtures/brain-native-4510/', import.meta.url));
const prior = fileURLToPath(new URL('./fixtures/brain-managed-cli-native-457/', import.meta.url));
const temporary = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'rsp-native4510-test-')));
const read = file => fs.readFileSync(file, 'utf8');
const fixtureRead = relative => read(path.join(fixture, relative));
const digest = source => crypto.createHash('sha256').update(source).digest('hex');
const checked = {
  'grounding-code-projection.mjs': '5f97aeb864027a2522a817cc16c5bde52bdd52e0166860095668fab91770d663',
  'turn-capture-privacy.mjs': 'd495620afc8396eeabf9f23dbcbf85705213e8c05f7ae364bd58618871daf3d4',
  'project-progression-hook.mjs': 'a2a2264c69889b36200059292a91d92406fc8c7d8c5179f29f21d33331b2f40c',
  'project-progression-producer.mjs': 'f38f543368ccdd050c2cdf2b31c1d228aa0f69b617477e2557d8cc2d28ebd501',
  'project-transition-hook.mjs': '53d522f20fed253a31f7563f7a38a1f33670d86612bf28f4e0833425ddda305c',
  'session-snapshot-hook.mjs': '60d36796e129d1a9a52417b1b9ad96b990164848ee0cbbc5b855f58aaf8db390',
};
try {
  for (const [name, hash] of Object.entries(checked)) assert.equal(digest(fixtureRead('scripts/' + name)), hash, name);
  const root = path.join(temporary, 'bundle');
  fs.cpSync(prior, root, { recursive: true });
  fs.cpSync(fixture, root, { recursive: true });
  // Assemble the exact full public parser from bounded fixtures. Its later prose
  // mentions our binary; a prefix-only fixture concealed the ownership refusal.
  const fullNormalizer = ['hook-input.mjs', 'hook-input-body-a.txt', 'hook-input-body-b.txt']
    .map(name => fixtureRead('scripts/' + name)).join('');
  assert(isReviewedNativeCaptureNormalizer(fullNormalizer));
  fs.writeFileSync(path.join(root, 'scripts/hook-input.mjs'), fullNormalizer);
  const nativeRead = relative => read(path.join(root, relative));
  const privacySources = readCapturePrivacySources(nativeRead);
  const privacy = evaluateCapturePrivacy(privacySources);
  assert.throws(() => privacy.contentPathExcludes(['../unsafe']), /must be rooted/);
  assert.throws(() => privacy.contentPathExcludes(['/x/../y']), /overly complex/);
  assert.throws(() => evaluateCapturePrivacy({ ...privacySources, privacy: privacySources.privacy + '\n// drift' }), /not reviewed/);
  const excluded = path.join(root, 'private'); fs.mkdirSync(excluded);
  const alias = path.join(root, 'alias'); fs.symlinkSync(excluded, alias);
  assert(privacy.pathIsExcluded(path.join(alias, 'not-yet-created.txt'), [excluded], root), 'physical aliases cannot escape exclusions');
  assert(privacy.pathIsExcluded('private/relative.txt', [excluded], root));
  assert(!privacy.pathIsExcluded(path.join(root, 'private-neighbour/file.txt'), [excluded], root));
  assert.throws(() => privacy.privateProgressionState({ plan: [{ id: path.join(excluded, 'immutable-plan') }] }, [excluded], root), /immutable progression binding/);

  for (const target of [capture, diagnostics, transition, collision, suspension]) {
    for (const spec of target.SPECS || [{ relative: 'scripts/project-transition-hook.mjs' }]) {
      if (!fs.existsSync(path.join(root, spec.relative))) continue;
      const source = nativeRead(spec.relative);
      assert(target.nativeSatisfied(source), target.NAME + ':' + spec.relative);
      assert.deepEqual(target.patchSource(source), { next: source, applied: [], missing: [] });
      assert(!target.nativeSatisfied(source + source), 'ambiguous native boundary refuses acceptance');
    }
  }
  for (const relative of ['scripts/project-progression-hook.mjs', 'scripts/project-progression-producer.mjs']) {
    const source = nativeRead(relative);
    assert.equal(composeSource(source, [capture.NAME, diagnostics.NAME, collision.NAME]), source,
      'legacy action, diagnostics and dedup overlays must not replace native privacy code');
  }
  const captureProof = probeCaptureBehavior(root), diagnosticsProof = probeDiagnosticsBehavior(root);
  assert.equal(captureProof.state, 'proven', captureProof.evidence);
  assert.equal(diagnosticsProof.state, 'proven', diagnosticsProof.evidence);
  const contract = nativeRead('scripts/project-progression-contract.mjs');
  const transitionSource = nativeRead('scripts/project-transition-hook.mjs');
  exerciseTransitionSource(transitionSource, contract, { privacySources });
  assert.equal(probeTransitionValidationReplacement({ files: [path.join(root, 'scripts/project-transition-hook.mjs')], installed: [] }).state, 'superseded');
  const bypassed = transitionSource.replace('if (policy.skipped) throw new Error(policy.skipped);', '/* consent bypassed */');
  assert(!transition.nativeSatisfied(bypassed));
  assert.throws(() => exerciseTransitionSource(bypassed, contract, { privacySources }), undefined,
    'removed policy refusal cannot prove the native replacement');
  for (const mutation of [
    source => source.replace('if (privateSource) {', 'if (false) {'),
    source => source.replace("if (privacy.skipped) throw new Error(`progression capture suspended: ${privacy.skipped}`);", '/* consent bypassed */'),
    source => source.replace('if (recoverFrozen && digestCanonical(protectedState) !== digestCanonical(observed))', 'if (false)'),
  ]) {
    const changed = mutation(nativeRead('scripts/project-progression-hook.mjs'));
    assert(!capture.nativeSatisfied(changed) || !collision.nativeSatisfied(changed));
    fs.writeFileSync(path.join(root, 'scripts/project-progression-hook.mjs'), changed);
    assert.notEqual(probeCaptureBehavior(root).state, 'proven', 'privacy mutation cannot prove native replacement');
  }
  fs.writeFileSync(path.join(root, 'scripts/project-progression-hook.mjs'), fixtureRead('scripts/project-progression-hook.mjs'));
  const collisionFixture = name => read(fileURLToPath(new URL('./fixtures/brain-progression-collision/' + name, import.meta.url)));
  const sources = { hook: nativeRead('scripts/project-progression-hook.mjs'), producer: nativeRead('scripts/project-progression-producer.mjs'),
    contract, store: collisionFixture('native-4.5.7-store.mjs'), queue: collisionFixture('native-4.5.7-queue.mjs'),
    redactor: nativeRead('scripts/continuity-events.mjs'),
    outbox: read(fileURLToPath(new URL('./fixtures/brain-outbox-streaming/native-4.5.7.mjs', import.meta.url))), ...privacySources };
  await exerciseSources({ ...sources, store: storeFixture(sources.store) }, path.join(temporary, 'collision'));
  for (const [name, source] of Object.entries(sources).filter(([name]) => ['store', 'outbox'].includes(name)))
    fs.writeFileSync(path.join(root, `scripts/project-progression-${name}.mjs`), source);
  fs.writeFileSync(path.join(root, 'scripts/project-capture-queue.mjs'), sources.queue);
  const collisionOptions = { files: collision.SPECS.map(spec => path.join(root, spec.relative)), installed: [] };
  const collisionProof = probeProgressionCollisionReplacement(collisionOptions);
  assert.equal(collisionProof.state, 'superseded', collisionProof.evidence);
  const normalizerFile = path.join(root, 'scripts/hook-input.mjs');
  for (const changed of [fullNormalizer + '\n// unreviewed bytes\n',
    fullNormalizer.replace('`ruflo-source-patch`', '`ruflo-source-patch (stuinfla/ruvnet-brain#383)`')]) {
    assert(!isReviewedNativeCaptureNormalizer(changed));
    fs.writeFileSync(normalizerFile, changed);
    assert.notEqual(probeProgressionCollisionReplacement(collisionOptions).state, 'superseded',
      'unreviewed bytes or an ownership marker cannot inherit the native prose exception');
  }
  fs.writeFileSync(normalizerFile, fullNormalizer);
  fs.renameSync(normalizerFile, normalizerFile + '.real'); fs.symlinkSync(normalizerFile + '.real', normalizerFile);
  assert.notEqual(probeProgressionCollisionReplacement(collisionOptions).state, 'superseded',
    'an exact source digest cannot override regular-file containment');
  fs.unlinkSync(normalizerFile); fs.renameSync(normalizerFile + '.real', normalizerFile);

  const suspensionFixture = fileURLToPath(new URL('./fixtures/brain-progression-suspension/native/', import.meta.url));
  const suspensionRoot = path.join(temporary, 'suspension'); fs.cpSync(suspensionFixture, suspensionRoot, { recursive: true });
  for (const name of ['project-transition-hook.mjs', 'session-snapshot-hook.mjs'])
    fs.writeFileSync(path.join(suspensionRoot, 'scripts', name), fixtureRead('scripts/' + name));
  const suspensionSources = {};
  for (const directory of ['scripts', 'mcp']) for (const name of fs.readdirSync(path.join(suspensionRoot, directory)))
    suspensionSources[directory + '/' + name] = read(path.join(suspensionRoot, directory, name));
  const suspensionExercise = path.join(temporary, 'suspension-exercise'); fs.mkdirSync(suspensionExercise);
  await exerciseSuspensionSources(suspensionSources, suspensionExercise);
  const suspensionProof = probeProgressionSuspensionReplacement({ surfaces: [{ root: suspensionRoot, kind: 'full' }], installed: [] });
  assert.equal(suspensionProof.state, 'superseded', suspensionProof.evidence);

  const guard = read(fileURLToPath(new URL('./fixtures/brain-grounding-code/native-4.5.9.sh', import.meta.url)));
  assert(groundingNative(guard));
  const groundingRoot = path.join(temporary, 'grounding'); fs.mkdirSync(groundingRoot);
  const helper = fixtureRead('scripts/grounding-code-projection.mjs');
  const grounding = exerciseNativeGrounding({ guard, helper }, groundingRoot);
  assert.equal(grounding.assertions, 44);
  const helperFile = path.join(groundingRoot, 'scripts/grounding-code-projection.mjs');
  const helperAlias = path.join(groundingRoot, 'alias.mjs'); fs.symlinkSync(helperFile, helperAlias);
  const projectionInput = JSON.stringify({ tool_name: 'Write', tool_input: { file_path: 'backup.py', content: '# agentdb warning\nimport sqlite3\n' } });
  const aliasResult = spawnSync(process.execPath, [helperAlias], { input: projectionInput, encoding: 'utf8', timeout: 5000,
    env: { HOME: groundingRoot, PATH: process.env.PATH || '' } });
  assert.equal(aliasResult.status, 0, aliasResult.stderr); assert(aliasResult.stdout.trim(), 'realpath alias executes the native helper entrypoint');
  const groundingProof = probeGroundingCodeReplacement({ files: [path.join(groundingRoot, 'scripts/ground-before-write.sh')] });
  assert.equal(groundingProof.state, 'superseded', groundingProof.evidence);
  console.log('PASS Brain 4.5.10: six native proof families, privacy/consent/frozen refusal, immutable recovery, dedup, suspension, conservative grounding and alias entrypoint');
} finally { fs.rmSync(temporary, { recursive: true, force: true }); }
