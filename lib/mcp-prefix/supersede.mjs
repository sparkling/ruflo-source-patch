// Local retirement proof for ruvnet/ruflo#2685.
//
// Upstream's replacement is byte-identical to this target's substitution, so a replacement token
// alone cannot prove provenance. The installed Ruflo marketplace is a Git checkout: HEAD is the
// independent vendor truth. We prove its plugin tree has no functional bare-prefix references, then
// prove every live patched file is exactly HEAD (or an installed-target composition of HEAD) before
// rebasing stale backups and reconciling this target away.

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import {
  ANCHOR, REPLACEMENT, discover, patchOnly,
} from './patcher.mjs';
import {
  COMPOSE_TARGETS, composeSource, reconcile as reconcileComposed,
} from '../plugin-compose.mjs';
import { readState } from '../cwd/state.mjs';
import { HOME_BASE } from '../cwd/paths.mjs';
import { writeIfChanged } from '../pristine.mjs';

const MARKETPLACE = process.env.RSP_RUFLO_MARKETPLACE
  || path.join(HOME_BASE, '.claude', 'plugins', 'marketplaces', 'ruflo');
const CACHE_ROOT = path.join(HOME_BASE, '.claude', 'plugins', 'cache', 'ruflo');
const INSTALLED = path.join(HOME_BASE, '.claude', 'plugins', 'installed_plugins.json');
const ALLOWED_BARE = new Set(['plugins/ruflo-metaharness/scripts/smoke.sh']);
const REQUIRED_FIXED = [
  'plugins/ruflo-core/agents/researcher.md',
  'plugins/ruflo-core/skills/discover-plugins/SKILL.md',
];

function within(root, file) {
  const relative = path.relative(root, file);
  return relative && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)
    ? relative
    : null;
}

function git(args) {
  const result = spawnSync('git', ['-C', MARKETPLACE, ...args], {
    encoding: 'utf8',
    timeout: 20_000,
    maxBuffer: 16 * 1024 * 1024,
  });
  return {
    ok: result.status === 0,
    absent: result.status === 1,
    value: result.stdout || '',
    error: result.error?.message || (result.stderr || '').trim() || `exit ${result.status}`,
  };
}

function headFile(relative) {
  const normalized = relative.split(path.sep).join('/');
  if (!normalized || normalized.startsWith('../') || path.isAbsolute(normalized)) {
    return { error: `unbounded marketplace path: ${relative}` };
  }
  const result = git(['show', `HEAD:${normalized}`]);
  return result.ok ? { source: result.value, relative: normalized } : { error: result.error };
}

function activeCaches() {
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(INSTALLED, 'utf8'));
  } catch (err) {
    return { error: `cannot read ${INSTALLED}: ${err.message}` };
  }

  const roots = [];
  for (const [id, entries] of Object.entries(manifest?.plugins || {})) {
    if (!id.endsWith('@ruflo') || !Array.isArray(entries)) continue;
    const plugin = id.slice(0, -'@ruflo'.length);
    for (const entry of entries) {
      const active = entry?.scope === 'user'
        || (entry?.scope === 'project'
          && typeof entry.projectPath === 'string'
          && fs.existsSync(entry.projectPath));
      if (!active || typeof entry.installPath !== 'string' || !path.isAbsolute(entry.installPath)) continue;
      const relative = within(CACHE_ROOT, entry.installPath);
      if (!relative || relative.split(path.sep)[0] !== plugin) {
        return { error: `active ${id} installPath is outside its bounded Ruflo cache: ${entry.installPath}` };
      }
      roots.push({ root: path.resolve(entry.installPath), plugin });
    }
  }
  return { roots };
}

function canonicalFor(file, active) {
  const marketplaceRelative = within(MARKETPLACE, file);
  if (marketplaceRelative) return headFile(marketplaceRelative);

  for (const entry of active) {
    const pluginRelative = within(entry.root, file);
    if (!pluginRelative) continue;
    return headFile(path.join('plugins', entry.plugin, pluginRelative));
  }
  return null;
}

function upstreamProof() {
  const root = git(['rev-parse', '--show-toplevel']);
  if (!root.ok) return { state: 'unknown', evidence: `Ruflo marketplace is not a readable Git checkout: ${root.error}` };
  let actualRoot;
  let expectedRoot;
  try {
    actualRoot = fs.realpathSync(root.value.trim());
    expectedRoot = fs.realpathSync(MARKETPLACE);
  } catch (err) {
    return { state: 'unknown', evidence: `could not canonicalize the Ruflo marketplace: ${err.message}` };
  }
  if (actualRoot !== expectedRoot) {
    return { state: 'unknown', evidence: `Ruflo marketplace Git root is not ${MARKETPLACE}` };
  }

  const bare = git(['grep', '-l', '--fixed-strings', ANCHOR, 'HEAD', '--', 'plugins']);
  if (!bare.ok && !bare.absent) {
    return { state: 'unknown', evidence: `could not inspect Ruflo HEAD for legacy prefixes: ${bare.error}` };
  }
  const bareFiles = bare.value.trim().split('\n').filter(Boolean)
    .map((file) => file.startsWith('HEAD:') ? file.slice('HEAD:'.length) : file);
  const unexpected = bareFiles.filter((file) => !ALLOWED_BARE.has(file));
  if (unexpected.length) {
    return {
      state: 'live',
      evidence: `${unexpected.length} upstream plugin file(s) still carry functional ${ANCHOR} refs (${unexpected.slice(0, 3).join(', ')})`,
    };
  }

  for (const relative of REQUIRED_FIXED) {
    const current = headFile(relative);
    if (current.error) return { state: 'unknown', evidence: `${relative}: ${current.error}` };
    if (!current.source.includes(REPLACEMENT) || current.source.includes(ANCHOR)) {
      return { state: 'live', evidence: `${relative} still lacks upstream's independent namespace migration` };
    }
  }
  return { state: 'proven', allowedBare: bareFiles };
}

function buildPlan() {
  const active = activeCaches();
  if (active.error) return { error: active.error };
  const state = readState();
  const installed = state.pluginTargets.filter((target) => COMPOSE_TARGETS.includes(target));
  const remaining = installed.filter((target) => target !== 'mcp-prefix');
  const items = [];

  for (const file of discover()) {
    let current;
    try { current = fs.readFileSync(file, 'utf8'); } catch (err) {
      return { error: `cannot read ${file}: ${err.message}` };
    }
    const canonical = canonicalFor(file, active.roots);
    if (canonical?.error) return { error: `${file}: ${canonical.error}` };

    if (canonical) {
      const before = composeSource(canonical.source, installed);
      const after = composeSource(canonical.source, remaining);
      if (current !== before && current !== after) {
        return { error: `${file} is neither current upstream nor an exact installed-target composition of it` };
      }
      if (canonical.relative.startsWith('plugins/')
          && current.includes(ANCHOR)
          && !ALLOWED_BARE.has(canonical.relative)) {
        return { error: `${file} still carries a functional legacy prefix` };
      }
      items.push({ file, canonical: canonical.source });
      continue;
    }

    const backup = `${file}.rsp-backup`;
    let saved;
    try { saved = fs.readFileSync(backup, 'utf8'); } catch (err) {
      // After a successful reconciliation, an inactive historical cache is restored to its own
      // legacy vendor bytes and its backup is deliberately removed. It is not loadable, carries no
      // local replacement, and therefore is already clean. Accept that terminal shape so the
      // mandatory post-retirement proof does not require a recovery file cleanup just consumed.
      if (err?.code === 'ENOENT' && current.includes(ANCHOR) && !current.includes(REPLACEMENT)) {
        continue;
      }
      return { error: `inactive historical copy ${file} has no readable pristine backup: ${err.message}` };
    }
    if (!saved.length) return { error: `inactive historical copy ${file} has an empty pristine backup` };
    const before = composeSource(saved, installed);
    const after = composeSource(saved, remaining);
    if (current !== before && current !== after && current !== patchOnly(saved) && current !== saved) {
      return { error: `inactive historical copy ${file} is not an exact known composition of its backup` };
    }
    items.push({ file, canonical: null });
  }
  return { items, remaining };
}

function retire() {
  const plan = buildPlan();
  if (plan.error) return { errors: 1, log: [`error mcp-prefix retirement preflight: ${plan.error}`] };

  // Only after every file passes the read-only proof: replace stale baselines with the independently
  // verified marketplace HEAD bytes. reconcileComposed then preserves sibling-target edits and
  // restores the few standalone/test references this broad historical sweep should never have changed.
  for (const item of plan.items) {
    if (item.canonical !== null) writeIfChanged(`${item.file}.rsp-backup`, item.canonical);
  }
  return reconcileComposed(plan.remaining, ['mcp-prefix']);
}

export const mcpPrefixSupersession = {
  issue: 'https://github.com/ruvnet/ruflo/issues/2685',
  replacement: 'Ruflo plugin content natively using the plugin-qualified MCP namespace (stable v3.32.2+)',
  retire,
  check() {
    const upstream = upstreamProof();
    if (upstream.state !== 'proven') return upstream;
    const plan = buildPlan();
    if (plan.error) return { state: 'unknown', evidence: plan.error };
    return {
      state: 'superseded',
      evidence: `Ruflo HEAD has no functional legacy plugin prefixes; ${plan.items.length} local file(s) match exact before/after compositions and are safe to reconcile`,
    };
  },
};
