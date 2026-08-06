// Brain targets whose native replacements are shipped and executable on the active installation.
// Each check is local and fail-closed; GitHub closure and version presence are documentation only.

import fs from 'node:fs';
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

function retireComposed(target, context = {}) {
  const retiring = context.retiring || new Set([target]);
  const remaining = readState().pluginTargets.filter((item) => !retiring.has(item));
  return reconcileComposed(remaining, [target]);
}

export const brainNativeSupersessions = {
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
