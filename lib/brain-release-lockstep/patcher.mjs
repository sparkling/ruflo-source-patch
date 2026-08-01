// Fail-closed release-version reporting for RuvNet Brain issue #77.
//
// The v4.0.3 GitHub release advanced the signed knowledge bundle while the npm package, Claude
// plugin, Codex plugin, and Stable Spine still identified themselves as 4.0.2. Brain's doctor
// detected only the Claude-vs-bundle pair, described the mismatch as normal, and still exited 0.
//
// This target deliberately does NOT relabel a cache, copy plugin bytes, invoke the updater, or
// change active.json. Those would hide or interfere with the upstream release defect. It changes
// only the read-only doctor/footprint verdict: every locally measurable product component is
// compared, drift is called incomplete convergence, and doctor exits nonzero.

import fs from 'node:fs';
import path from 'node:path';
import { GLOBAL_ROOTS, HOME_BASE, NPX_ROOT } from '../cwd/paths.mjs';

export const PATCH_MARKER = 'ruflo-source-patch (stuinfla/ruvnet-brain#77)';
const INSTALLER = ['bin', 'install.mjs'];

const DOCTOR_VERSION_ORIGINAL = `  // Two independent version streams (KB bundle vs plugin wrapper) — see checkVersionDrift()'s
  // header comment for the full story. Silent unless they've genuinely diverged.
  reportVersionDrift(cacheDir);`;

const DOCTOR_VERSION_PATCHED = `  // ${PATCH_MARKER}: one product release must resolve to one version.
  // This is read-only: never relabel, copy, promote, or otherwise mutate Brain's native update plane.
  const versionState = reportVersionDrift(cacheDir);`;

const VERSION_CHECK_ORIGINAL = `/**
 * The brain ships as TWO independently-versioned artifacts: the KB content bundle (self-updates
 * nightly via forge-update.mjs + GitHub Releases) and the Claude Code PLUGIN WRAPPER (hooks,
 * skills, slash commands), which updates ONLY when Claude Code itself pulls the marketplace git
 * clone at ~/.claude/plugins/marketplaces/ruvnet-brain — NOT AT ALL if a user's
 * ~/.claude/settings.json has "autoUpdate": false for that marketplace. They drift silently, and —
 * this is the damaging part — the version a user is SHOWN always comes from the frozen wrapper,
 * never the brain. Verified live on this machine 2026-07-20: KB SOURCE.json built today, wrapper
 * plugin.json still 3.4.18-dev, nine commits behind origin/main, because autoUpdate was false. A
 * user (Dr. Mark Allen) hit exactly this: KB current, wrapper still the June v0.5.0-dev build, and
 * nothing anywhere told him the two had diverged.
 *
 * NEVER invent or guess a version — this project's hardest rule. Either side unresolved → null, and
 * null is NEVER treated as drift: a locally-built or pre-stamping KB legitimately has no releaseTag
 * (see installedBrainVersion's own comment above), and a plugin that simply isn't installed yet is
 * a DIFFERENT, already-reported situation (wirePlugin / verifyInstall), not a version mismatch.
 * Drift is reported ONLY when BOTH sides resolved to a real value AND those values differ.
 *
 * @returns {{wrapper: string|null, kb: string|null, drift: boolean}}
 */
function checkVersionDrift(cacheDir) {
  const wrapper = wrapperVersion();
  const kbRaw = installedBrainVersion(cacheDir); // already honest — 'unknown' rather than a guess
  const kb = kbRaw === 'unknown' ? null : kbRaw;
  // COMPARE NUMBERS, NOT NAMESPACES. The two sides are written by different writers in different
  // formats: build-bundle stamps SOURCE.json.releaseTag as a git TAG (v-prefixed) while
  // sync-version writes plugin.json.version as a bare SEMVER (no prefix). A raw !== is therefore
  // ALWAYS true, so the first version of this check told every perfectly healthy user their install
  // had drifted, and handed them a fix command that could never clear it. Caught by adversarial
  // review, not by the tests — the test fixture used a v-prefixed plugin version that sync-version
  // never produces, so an impossible input was green-lighting a false claim.
  // Duplicated deliberately from scripts/version.mjs's stripTag(): this installer ships standalone
  // on npm (package.json \`files\` excludes scripts/version.mjs) and imports node builtins ONLY, so
  // it cannot import the canonical one. Same one-line rule, kept identical on purpose.
  const stripV = (v) => String(v).replace(/^v/, '');
  const drift = Boolean(wrapper && kb && stripV(wrapper) !== stripV(kb));
  return { wrapper, kb, drift };
}`;

const VERSION_CHECK_PATCHED = `/**
 * ${PATCH_MARKER}: a public Brain release is one product, not independent version streams.
 * Compare every locally measurable release-bearing component without mutating any of them.
 * Unknown or absent components remain null and are handled by their existing availability checks.
 */
function checkVersionDrift(cacheDir) {
  const valid = (value) => /^[A-Za-z0-9._-]{1,32}$/.test(String(value || ''))
    ? String(value) : null;
  const kbRaw = installedBrainVersion(cacheDir);
  const home = process.env.RUVNET_BRAIN_HOME || path.join(os.homedir(), '.cache', 'ruvnet-brain');
  let spine = null;
  try { spine = valid(JSON.parse(fs.readFileSync(path.join(home, 'active.json'), 'utf8')).version); }
  catch { /* absent or unreadable Stable Spine is reported by its own health path */ }

  const codexState = codexPluginStatus();
  const components = {
    bundle: kbRaw === 'unknown' ? null : valid(kbRaw),
    package: valid(PACKAGE_VERSION),
    spine,
    claude: valid(wrapperVersion()),
    codex: codexState.installed ? valid(codexState.version) : null,
  };
  const resolved = Object.entries(components).filter(([, version]) => version);
  const stripV = (value) => String(value).replace(/^v/, '');
  const drift = new Set(resolved.map(([, version]) => stripV(version))).size > 1;
  return { ...components, resolved, drift };
}`;

const VERSION_REPORT_ORIGINAL = `/**
 * Shared narration for --doctor and --what-changed (via printFootprint). Silent whenever there is
 * nothing actionable to say — matched versions, or either side not comparable — so this never adds
 * noise to a healthy machine or a not-yet-fully-installed one. Speaks up only when the two
 * artifacts have genuinely diverged, in plain, warm, non-alarming language (neither artifact is
 * broken — they just update on different schedules), and always hands over the exact command to
 * fix it — verified live against \`claude plugin marketplace --help\` (2026-07-20) before ever being
 * printed here.
 */
function reportVersionDrift(cacheDir) {
  const state = checkVersionDrift(cacheDir);
  if (!state.drift) return state;
  warn(\`the brain (\${c.bold(state.kb)}) and the Claude Code plugin (\${c.bold(state.wrapper)}) have drifted apart —\`);
  info(\`that's normal (they update on separate schedules) and neither one is broken. To bring the\`);
  info(\`plugin up to date:  \${c.bold('claude plugin marketplace update ruvnet-brain')}  \${c.dim('(then restart Claude Code)')}\`);
  return state;
}`;

const VERSION_REPORT_PATCHED = `/**
 * ${PATCH_MARKER}: shared fail-closed narration for doctor and what-changed.
 * A release mismatch has no safe downstream repair: only matching upstream artifacts can converge it.
 */
function reportVersionDrift(cacheDir) {
  const state = checkVersionDrift(cacheDir);
  if (!state.drift) return state;
  warn('Brain release components are NOT in version lockstep — convergence is incomplete:');
  for (const [name, version] of state.resolved) info(\`  \${name}: \${c.bold(version)}\`);
  warn('this is a release-integrity failure, not a normal difference in update schedules.');
  info('No local relabel or cache copy can create the missing published artifact. Wait for a matching');
  info('upstream release, then restart Claude Code and Codex so their supported lifecycle can converge.');
  return state;
}`;

const HEALTH_ORIGINAL = `  const v = verifyInstall(cacheDir);
  const smoke = await smokeQuery(cacheDir);
  const allGreen = v.repos > 0 && v.reader && v.mcp;`;

const HEALTH_PATCHED = `  const v = verifyInstall(cacheDir);
  const smoke = await smokeQuery(cacheDir);
  // ${PATCH_MARKER}: a split release cannot be reported Healthy or exit zero.
  const allGreen = v.repos > 0 && v.reader && v.mcp && !versionState.drift;`;

const DOCTOR_GUIDANCE_ORIGINAL = `      allGreen ? 'The brain is installed and reachable.' : 'Re-run the installer to fix the warnings above.'`;

const DOCTOR_GUIDANCE_PATCHED = `      allGreen
        ? 'The brain is installed and reachable.'
        : versionState.drift
          ? 'Release artifacts are split upstream; wait for a matching release, then restart Claude Code and Codex.'
          : 'Re-run the installer to fix the warnings above.'`;

const DOCTOR_VERDICT_ORIGINAL = `    console.log(\`  \${c.red('✗ FAILING')} — the warnings above are real. Re-run  \${c.bold('npx ruvnet-brain')}  to repair.\`);`;

const DOCTOR_VERDICT_PATCHED = `    console.log(versionState.drift
      ? \`  \${c.red('✗ FAILING')} — release artifacts are split upstream; this cannot be repaired locally.\`
      : \`  \${c.red('✗ FAILING')} — the warnings above are real. Re-run  \${c.bold('npx ruvnet-brain')}  to repair.\`);`;

const FEEDBACK_HEALTH_ORIGINAL = `  const allGreen = s.repos > 0 && s.reader && s.mcp;`;

const FEEDBACK_HEALTH_PATCHED = `  // ${PATCH_MARKER}: the feedback surface must not call a split release healthy.
  const versionState = checkVersionDrift(cacheDir);
  const allGreen = s.repos > 0 && s.reader && s.mcp && !versionState.drift;`;

const FEEDBACK_VERDICT_ORIGINAL = `    allGreen ? 'verdict: Healthy — installed and reachable' : 'verdict: Needs attention — re-run npx ruvnet-brain',`;

const FEEDBACK_VERDICT_PATCHED = `    allGreen
      ? 'verdict: Healthy — installed and reachable'
      : versionState.drift
        ? 'verdict: Needs attention — release artifacts are not in version lockstep'
        : 'verdict: Needs attention — re-run npx ruvnet-brain',`;

const EDITS = [
  {
    id: 'doctor-version-state',
    find: DOCTOR_VERSION_ORIGINAL,
    replace: DOCTOR_VERSION_PATCHED,
    done: (source) => source.includes(DOCTOR_VERSION_PATCHED),
  },
  {
    id: 'all-component-version-check',
    find: VERSION_CHECK_ORIGINAL,
    replace: VERSION_CHECK_PATCHED,
    done: (source) => source.includes(VERSION_CHECK_PATCHED),
  },
  {
    id: 'fail-closed-version-report',
    find: VERSION_REPORT_ORIGINAL,
    replace: VERSION_REPORT_PATCHED,
    done: (source) => source.includes(VERSION_REPORT_PATCHED),
  },
  {
    id: 'doctor-health-gate',
    find: HEALTH_ORIGINAL,
    replace: HEALTH_PATCHED,
    done: (source) => source.includes(HEALTH_PATCHED),
  },
  {
    id: 'doctor-actionable-guidance',
    find: DOCTOR_GUIDANCE_ORIGINAL,
    replace: DOCTOR_GUIDANCE_PATCHED,
    done: (source) => source.includes(DOCTOR_GUIDANCE_PATCHED),
  },
  {
    id: 'doctor-final-verdict',
    find: DOCTOR_VERDICT_ORIGINAL,
    replace: DOCTOR_VERDICT_PATCHED,
    done: (source) => source.includes(DOCTOR_VERDICT_PATCHED),
  },
  {
    id: 'feedback-health-gate',
    find: FEEDBACK_HEALTH_ORIGINAL,
    replace: FEEDBACK_HEALTH_PATCHED,
    done: (source) => source.includes(FEEDBACK_HEALTH_PATCHED),
  },
  {
    id: 'feedback-actionable-verdict',
    find: FEEDBACK_VERDICT_ORIGINAL,
    replace: FEEDBACK_VERDICT_PATCHED,
    done: (source) => source.includes(FEEDBACK_VERDICT_PATCHED),
  },
];

const occurrences = (source, needle) => {
  let count = 0;
  let offset = 0;
  while ((offset = source.indexOf(needle, offset)) !== -1) {
    count++;
    offset += needle.length;
  }
  return count;
};

function installerAt(root) {
  const manifest = path.join(root, 'package.json');
  const file = path.join(root, ...INSTALLER);
  try {
    if (!fs.lstatSync(file).isFile() || fs.lstatSync(file).isSymbolicLink()) return null;
    if (JSON.parse(fs.readFileSync(manifest, 'utf8')).name !== 'ruvnet-brain') return null;
    const source = fs.readFileSync(file, 'utf8');
    return source.includes(PATCH_MARKER)
      || source.includes(DOCTOR_VERSION_ORIGINAL)
      || source.includes(VERSION_CHECK_ORIGINAL)
      ? file : null;
  } catch {
    return null;
  }
}

export function discover() {
  const found = [];
  for (const root of GLOBAL_ROOTS) {
    const file = installerAt(path.join(root, 'ruvnet-brain'));
    if (file) found.push(file);
  }
  try {
    for (const hash of fs.readdirSync(NPX_ROOT)) {
      const file = installerAt(path.join(NPX_ROOT, hash, 'node_modules', 'ruvnet-brain'));
      if (file) found.push(file);
    }
  } catch { /* no npx cache */ }

  const brainHome = process.env.RSP_RUVNET_BRAIN_HOME
    || path.join(HOME_BASE, '.cache', 'ruvnet-brain');
  const persistent = installerAt(path.join(brainHome, 'kb', '.console-runtime'));
  if (persistent) found.push(persistent);
  return [...new Set(found)];
}

export function patchSource(pristine) {
  let next = pristine;
  const applied = [];
  const missing = [];
  for (const edit of EDITS) {
    if (edit.done(next)) continue;
    const count = occurrences(next, edit.find);
    if (count === 1) {
      next = next.replace(edit.find, edit.replace);
      applied.push(edit.id);
    } else {
      missing.push(count > 1 ? `${edit.id}(AMBIGUOUS: anchor occurs ${count}x)` : edit.id);
    }
  }
  return { next, applied, missing };
}

// Target revisions can add a new exact edit while an older revision is already installed. Recognise
// those earlier outputs and reconstruct the vendor source only by a byte-exact reverse/forward proof;
// otherwise the composition engine could mistake our previous output for a new upstream baseline.
export const hasPatch = (source) => source.includes(PATCH_MARKER);

export function reverseSource(patched) {
  let candidate = patched;
  for (const edit of [...EDITS].reverse()) {
    if (occurrences(candidate, edit.replace) === 1) {
      candidate = candidate.replace(edit.replace, edit.find);
    }
  }
  return candidate;
}

export const isPatched = (source) => EDITS.every((edit) => edit.done(source));

export const descriptor = {
  name: 'brain-release-lockstep',
  atomic: true,
  editCount: EDITS.length,
  discover,
  patchSource,
  hasPatch,
  reverse: reverseSource,
  isPatched,
};

export const fixtureSource = () => EDITS.map((edit) => edit.find).join('\n\n');
