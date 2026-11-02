// ADR-089/098 supersede unconditional equality for the current structured doctor.
// Read only same-package executable evidence; never import the installer/update plane.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { existingPathRelative } from '../path-containment.mjs';
import { exerciseNativeDoctor } from './probe.mjs';

const fn = name => [`function ${name}(`, '\n}'];
const decl = name => [`const ${name} =`, ';\n'];
export const SOURCE_PARTS = {
  'bin/install.mjs': [['const versionSatisfies =', '\n};'], fn('classifyHostConvergence'), fn('openSessionsNotice')],
  'scripts/installed-brain-health.mjs': [decl('SEARCH_FILES'), decl('version'), fn('inspectInstalledBrain')],
  'kb/corpus-release-identity.mjs': [decl('CORPUS_TAG_PATTERN'), decl('INSTALLED_RUNTIME_FILE'),
    decl('RUNTIME_PINNED_EXECUTABLES'), fn('isCorpusReleaseTag'), fn('fileIdentity'), fn('readInstalledRuntime')],
  'plugin/scripts/developer-update-policy.mjs': [fn('cmpVersion')],
  'scripts/approved-runtime.mjs': [decl('RUNTIME_EXTENSIONS'), decl('RUNTIME_EXACT_NAMES'), fn('isRuntimeFile')],
  'plugin/scripts/brain-confirmation.mjs': [fn('doctorVerdict')],
};
// Exact reviewed function/declaration slices, exercised without reading any installed data.
export const REVIEWED = {
  'bin/install.mjs': '1106e1846676afb126be597ff3301bf09085de4e50bb0b90710f917fe2c7bc0e',
  'scripts/installed-brain-health.mjs': '4fe50494af9243c36c4eb397c21c5f5c634b2178beeee752db265e01bee32f1f',
  'kb/corpus-release-identity.mjs': '94f373067ad6034ccf8b812ca5502318ab7160c4c9792fb5b2b0c32ece861cde',
  'plugin/scripts/developer-update-policy.mjs': '852425a8409d3d45afc49f2f5b0f7a64aaf378f926cd381a193e59989ab3efe5',
  'scripts/approved-runtime.mjs': '8189728e79808a79d5e6c9fba222d85040acc65f11074409eb0c97f1622c9a1a',
  'plugin/scripts/brain-confirmation.mjs': '656d8502a5cde3ac2b87fcfef6d09b437829a056bd8f3fb43f11f86f78928350',
};
// Include the complete calls: an added advisory option changes doctor health semantics.
export const DOCTOR_CHECK_PARTS = [
  ['  const check = (id, label, failedNow, detail, fix,', ';\n'],
  ["    check('identity',", '),\n'],
  ["    check('host-convergence',", '),\n'],
];
export const REVIEWED_CHECKS = '9dbed961ff6667638c962037bcff67cc3b67df5f0817b8c6eeefc10f602071c6';
export const LINKS = {
  'scripts/installed-brain-health.mjs': [
    "import { readInstalledRuntime, isCorpusReleaseTag } from '../kb/corpus-release-identity.mjs';",
    "import { cmpVersion } from './stack-sync.mjs';",
    "import { isRuntimeFile } from './approved-runtime.mjs';",
  ],
  'scripts/stack-sync.mjs': [
    "export { FAMILY, PLUGIN_MARKETPLACES, cmpVersion, pickTargetTag, normalizeNpmDistTags } from '../plugin/scripts/developer-update-policy.mjs';",
  ],
};
export const WIRING = [
  "} from '../scripts/installed-brain-health.mjs';",
  "} from '../plugin/scripts/brain-confirmation.mjs';",
  "import { cmpVersion } from '../scripts/stack-sync.mjs';",
  '  const installedIdentity = inspectInstalledBrain(cacheDir, PACKAGE_VERSION);',
  '      hostConvergence = classifyHostConvergence(recorded);',
  "    check('identity', 'Identity', !installedIdentity.healthy, installedIdentity.healthy ? 'search engine, validator and archive manifest agree'",
  "    check('host-convergence', 'Hosts sync', !hostConvergence.healthy, hostConvergence.state, 'npx ruvnet-brain --update'),",
  '  const verdict = doctorVerdict(confirmation, checks);',
  '  return verdict.exitCode;\n}\n\n// ── the post-install self-check',
  'if (FLAG_DOCTOR) { process.exitCode = await doctor({ json: FLAG_JSON }); return; }',
];
// The host classifier also exists in legacy installers without the structured doctor.
export const nativeCandidate = source => source.includes("'../scripts/installed-brain-health.mjs'")
  || source.includes('const installedIdentity = inspectInstalledBrain(')
  || (source.includes('function classifyHostConvergence(') && source.includes('doctorVerdict('));
const digest = source => createHash('sha256').update(source).digest('hex');
export function extractParts(source, specs) {
  return specs.map(([start, end]) => {
    if (source.split(start).length !== 2) throw Error(`native doctor boundary is absent or ambiguous: ${start}`);
    const at = source.indexOf(start), stop = source.indexOf(end, at);
    if (stop < at) throw Error(`native doctor boundary is incomplete: ${start}`);
    return source.slice(at, stop + end.length);
  }).join('\n');
}
export function readNativeSources(source, file) {
  if (!file || !path.isAbsolute(file)) throw Error('native doctor requires its installed file identity');
  if (source.includes('ruflo-source-patch (stuinfla/ruvnet-brain#77)')) throw Error('local release gate remains');
  for (const anchor of WIRING) if (source.split(anchor).length !== 2) throw Error('native doctor verdict wiring changed');
  const root = path.dirname(path.dirname(file));
  const sources = {};
  for (const relative of new Set([...Object.keys(SOURCE_PARTS), ...Object.keys(LINKS)])) {
    let text = source;
    if (relative !== 'bin/install.mjs') {
      const candidate = path.join(root, relative), stat = fs.lstatSync(candidate);
      if (!stat.isFile() || stat.isSymbolicLink() || !stat.size
          || existingPathRelative(root, candidate) === null) throw Error(`unsafe native doctor helper: ${relative}`);
      text = fs.readFileSync(candidate, 'utf8');
    }
    for (const anchor of LINKS[relative] || []) if (text.split(anchor).length !== 2)
      throw Error(`native doctor dependency changed: ${relative}`);
    if (!SOURCE_PARTS[relative]) continue;
    const excerpt = extractParts(text, SOURCE_PARTS[relative]);
    if (digest(excerpt) !== REVIEWED[relative]) throw Error(`native doctor helper is not reviewed: ${relative}`);
    sources[relative] = excerpt;
  }
  const doctorChecks = DOCTOR_CHECK_PARTS.map(spec => extractParts(source, [spec]));
  if (digest(doctorChecks.join('\n')) !== REVIEWED_CHECKS) throw Error('native doctor check assembly is not reviewed');
  return { sources, doctorChecks };
}
export function proveNativeDoctor(source, file) {
  try {
    const sources = readNativeSources(source, file);
    const result = exerciseNativeDoctor(sources);
    return { ok: true, evidence: `${result.assertions} isolated native identity, host-convergence and verdict cases` };
  } catch (error) { return { ok: false, evidence: error.message }; }
}
