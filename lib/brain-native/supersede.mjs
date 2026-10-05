// Brain targets whose native replacements are shipped and executable on the active installation.
// Each check is local and fail-closed; GitHub closure and version presence are documentation only.

import fs from 'node:fs';
import { brainContinuitySummarySupersession } from '../brain-continuity-summary/probe.mjs';
import { brainOutboxStreamingSupersession } from '../brain-outbox-streaming/supersede.mjs';
import { brainManagedCliDiagnosticsSupersession } from '../brain-managed-cli-diagnostics/supersede.mjs';
import { brainProgressionSuspensionSupersession, prepareNativeProgressionSuspensionRetirement } from '../brain-progression-suspension/probe.mjs';
import { probeProgressionCollisionReplacement } from '../brain-progression-collision/probe.mjs';
import { probeManagedCliGenerationReplacement } from '../brain-managed-cli-generation/probe.mjs';
import { brainManagedCliCaptureSupersession } from '../brain-managed-cli-capture/supersede.mjs';
import { probeTransitionNoticeReplacement } from '../brain-transition-notice/probe.mjs';
import { probeTransitionValidationReplacement } from '../brain-transition-validation/probe.mjs';
import { probeGroundingCodeReplacement } from '../brain-grounding-code/probe.mjs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { resolveActive, restore as restoreCodexSkill } from '../codex-skills/patcher.mjs';
import { isNativeBrainReady } from '../codex-skills/native.mjs';
import { reconcile as reconcileComposed } from '../plugin-compose.mjs';
import { readState } from '../cwd/state.mjs';
import {
  probeMemoryDoctorRootsReplacement, probeProviderCatalogReplacement,
} from './probes.mjs';

const BRAIN_SPEC = {
  pluginId: 'ruvnet-brain@ruvnet-brain', marketplace: 'ruvnet-brain', plugin: 'ruvnet-brain',
};

function runWhatsNew(file) {
  const env = {};
  for (const key of ['PATH', 'LANG', 'LC_ALL', 'LC_CTYPE', 'TMPDIR', 'TMP', 'TEMP', 'SYSTEMROOT', 'ComSpec', 'PATHEXT']) {
    if (process.env[key] !== undefined) env[key] = process.env[key];
  }
  const run = spawnSync(process.execPath, [file], {
    env, encoding: 'utf8', timeout: 10_000, maxBuffer: 4 * 1024 * 1024,
  });
  return { status: run.status, error: run.error, stdout: run.stdout || '', stderr: run.stderr || '' };
}

function proveWhatsNew() {
  let root;
  try { root = resolveActive(BRAIN_SPEC); }
  catch (error) { return { state: 'unknown', evidence: error.message }; }
  const skill = path.join(root, 'skills', 'whats-new', 'SKILL.md');
  const executable = path.join(root, 'scripts', 'whats-new.mjs');
  const notes = path.join(root, 'docs', 'RELEASE-NOTES-4.0.md');
  const manifest = path.join(root, '.claude-plugin', 'plugin.json');
  try {
    const source = fs.readFileSync(skill, 'utf8');
    if (!isNativeBrainReady('whats-new', source)) {
      return { state: 'live', evidence: 'the active whats-new skill does not require its immutable installed executable and assets' };
    }
    const version = JSON.parse(fs.readFileSync(manifest, 'utf8')).version;
    for (const file of [skill, executable, notes, manifest]) {
      const stat = fs.lstatSync(file);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size === 0) {
        return { state: 'live', evidence: `required native whats-new asset is unsafe, empty, or absent: ${file}` };
      }
    }
    const positive = runWhatsNew(executable);
    if (positive.error || positive.status !== 0
        || !positive.stdout.startsWith(`RuvNet Brain ${version}\n\n`)
        || positive.stdout.trim().split('\n').length < 4) {
      return { state: 'live', evidence: 'the installed whats-new executable did not return exact-version curated notes' };
    }

    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'rsp-brain-whats-new-'));
    try {
      for (const relative of [
        ['scripts', 'whats-new.mjs'], ['docs', 'RELEASE-NOTES-4.0.md'],
        ['.claude-plugin', 'plugin.json'],
      ]) {
        const target = path.join(temporary, ...relative);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.copyFileSync(path.join(root, ...relative), target);
      }
      fs.rmSync(path.join(temporary, 'docs', 'RELEASE-NOTES-4.0.md'));
      const negative = runWhatsNew(path.join(temporary, 'scripts', 'whats-new.mjs'));
      if (negative.error || negative.status === 0 || !negative.stderr.includes('installed release notes are missing')) {
        return { state: 'live', evidence: 'the installed whats-new boundary does not fail closed when its curated notes are absent' };
      }
    } finally { fs.rmSync(temporary, { recursive: true, force: true }); }

    return {
      state: 'superseded',
      evidence: `active Brain ${version} executes exact-version notes from one immutable installed payload and fails closed when the notes are absent`,
    };
  } catch (error) {
    return { state: 'unknown', evidence: `could not execute the native whats-new proof: ${error.message}` };
  }
}

export function retireComposed(target, context = {}) {
  const retiring = context.retiring || new Set([target]);
  const remaining = readState().pluginTargets.filter((item) => !retiring.has(item));
  return reconcileComposed(remaining, [target]);
}

export const brainNativeSupersessions = {
  'brain-grounding-code': {
    issue: 'https://github.com/stuinfla/ruvnet-brain/issues/46',
    replacement: 'native conservative inert-code projection (#373), retaining strict executable and uncertain-context grounding',
    check: probeGroundingCodeReplacement,
    retire: context => retireComposed('brain-grounding-code', context),
  },
  'brain-host-recovery': {
    issue: 'https://github.com/stuinfla/ruvnet-brain/issues/391',
    replacement: 'native current-host proof and causal refresh failure attribution',
    check: () => ({ state: 'live', evidence: 'retire after native fresh-host proof rejects missing, stale and untrusted hooks and preserves historical failures' }),
    retire: context => retireComposed('brain-host-recovery', context),
  },
  'brain-progression-suspension': {
    ...brainProgressionSuspensionSupersession(),
    retire: context => {
      const prepared = prepareNativeProgressionSuspensionRetirement();
      if (prepared.errors.length) throw Error(prepared.errors.join('; '));
      const result = retireComposed('brain-progression-suspension', context);
      return { ...result, log: [...prepared.log, ...result.log] };
    },
  },
  'brain-continuity-summary': {
    ...brainContinuitySummarySupersession(),
    retire: context => retireComposed('brain-continuity-summary', context),
  },
  'brain-outbox-streaming': {
    ...brainOutboxStreamingSupersession(),
    retire: context => retireComposed('brain-outbox-streaming', context),
  },
  'brain-managed-cli-diagnostics': {
    ...brainManagedCliDiagnosticsSupersession(),
    retire: context => retireComposed('brain-managed-cli-diagnostics', context),
  },
  'brain-managed-cli-generation': {
    issue: 'https://github.com/stuinfla/ruvnet-brain/issues/384',
    replacement: 'native managed CLI dispatch from the validated active generation with generation-scoped successful help authorization',
    check: probeManagedCliGenerationReplacement,
    retire: context => retireComposed('brain-managed-cli-generation', context),
  },
  'brain-managed-cli-capture': {
    ...brainManagedCliCaptureSupersession(),
    retire: context => retireComposed('brain-managed-cli-capture', context),
  },
  'brain-progression-collision': {
    issue: 'https://github.com/stuinfla/ruvnet-brain/issues/383',
    replacement: 'native collision-safe frozen capture identities with exact existing-row proof and retained evidence',
    check: probeProgressionCollisionReplacement,
    retire: context => retireComposed('brain-progression-collision', context),
  },
  'brain-transition-notice': {
    issue: 'https://github.com/stuinfla/ruvnet-brain/issues/380',
    replacement: 'native per-session pending-transition notices with unchanged capture and failure reporting',
    check: probeTransitionNoticeReplacement,
    retire: (context) => retireComposed('brain-transition-notice', context),
  },
  'brain-transition-validation': {
    issue: 'https://github.com/stuinfla/ruvnet-brain/issues/385',
    replacement: 'one verified native restore per normalized transition with unchanged public validation and persistence boundaries',
    check: probeTransitionValidationReplacement,
    retire: context => retireComposed('brain-transition-validation', context),
  },
  'brain-codex-skills': {
    issue: 'https://github.com/stuinfla/ruvnet-brain/issues/76',
    replacement: "Brain's immutable installed What's New executable, manifest, and curated notes",
    retire: () => restoreCodexSkill('brain-codex-skills'),
    check: proveWhatsNew,
  },
  'brain-console-provider-keys': {
    issue: 'https://github.com/stuinfla/ruvnet-brain/issues/86',
    replacement: "Brain's staged provider catalog, verified credential read-model, and explicit degraded state",
    retire: (context) => retireComposed('brain-console-provider-keys', context),
    check: probeProviderCatalogReplacement,
  },
  'brain-memory-doctor-roots': {
    issue: 'https://github.com/stuinfla/ruvnet-brain/issues/81',
    replacement: "Brain's shared common/configured-root memory-doctor discovery",
    retire: (context) => retireComposed('brain-memory-doctor-roots', context),
    check: probeMemoryDoctorRootsReplacement,
  },
};
