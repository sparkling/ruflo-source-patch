// Retirement is a local predicate, never a remote/version verdict. A closed issue may not be runnable
// here (#2666 lacked `memory purge`; #2878 still reproduces ordinary-writer loss), so every unknown keeps the patch.
// Predicates ship with the package, prove the replacement present and runnable, and fail toward the
// reversible outcome: redundant local code is safer than retiring into a silent hole.
import fs from 'node:fs';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import * as adrReindex from './adr-reindex/patcher.mjs';
import path from 'node:path';
import { discover as discoverVerifyInterface, MARKETPLACE as VI_MARKETPLACE, SCRIPT as VI_SCRIPT } from './verify-interface/patcher.mjs';
import {
  descriptor as designWallDescriptor,
  discover as discoverDesignWall,
  MARKETPLACE as DW_MARKETPLACE,
  SCRIPT as DW_SCRIPT,
  upstreamSource as designWallUpstreamSource,
  validateInstalledCopy as validateDesignWallCopy,
} from './design-wall/patcher.mjs';
import { flywheelDailySupersession } from './flywheel-daily/supersede.mjs';
import { rufloHooksSchemaSupersession } from './ruflo-hooks-schema/patcher.mjs';
import { mcpPrefixSupersession } from './mcp-prefix/supersede.mjs';
import { codexHooksSupersession } from './codex-hooks/patcher.mjs';
import { rufloCodexSkillsSupersession } from './codex-skills/patcher.mjs';
import { adrTemplateSupersession } from './adr-template/supersede.mjs';
import { adrIndexSupersession } from './adr-index/supersede.mjs';
import { brainNativeSupersessions } from './brain-native/supersede.mjs';
import { brainSearchSafetySupersession } from './brain-search-safety/supersede.mjs';
import { reconcile as reconcileComposed } from './plugin-compose.mjs';
import { retireTarget as retireTargetInState, readState } from './cwd/state.mjs';
import { HOME_BASE } from './cwd/paths.mjs';
import { daemonSupersession } from './cwd/daemon-supersede.mjs';
// Code anchors for #12/#13 and #48; lists admit equivalent inline/extracted spellings.
export const VI_FIX_MARKERS = {
  JSON_PARSE: [
    '"$NODE_BIN" -e \'',        // v3.2.9+ original: inline `node -e '…'`
    '"$NODE_BIN" "$HOOK_INPUT"', // later refactor: the shared scripts/hook-input.mjs parser
  ],
  OVERRIDE_ON_CMD: ['RUVNET_SKIP_INTERFACE_CHECK=1([[:space:]]|$)'],
  ADVISORY_ONLY: [
    `printf '%s\\n' '{"hookSpecificOutput":{"hookEventName":"PreToolUse","additionalContext":"Interface check advisory: prefer native Ruflo MCP tools. For CLI-only gaps, use ruvnet_cli_help and then ruvnet_cli_run with literal argv; raw Bash is never blocked by this notice."}}'
exit 0`,
  ],
};

/** Shared marker evaluator for the predicate and its fixtures. */
export function hasFixMarker(src, marker) {
  return (Array.isArray(marker) ? marker : [marker]).some((spelling) => src.includes(spelling));
}

/** Which independently sufficient upstream replacement this source carries. */
export function verifyInterfaceFixMode(src) {
  if (!hasFixMarker(src, VI_FIX_MARKERS.JSON_PARSE)) return null;
  if (hasFixMarker(src, VI_FIX_MARKERS.OVERRIDE_ON_CMD)) return 'command-gate';
  if (hasFixMarker(src, VI_FIX_MARKERS.ADVISORY_ONLY)
      && !/\bexit[ \t]+[1-9][0-9]*\b/.test(src)) return 'advisory-only';
  return null;
}

// Scope to the active cache named by installed_plugins.json plus the marketplace checkout.
// Any registry/read mismatch falls back to every discovered copy.
function activeVerifyInterfaceCopies() {
  const all = discoverVerifyInterface();
  try {
    const marketplaceFile = path.join(HOME_BASE, '.claude', 'plugins', 'marketplaces', VI_MARKETPLACE, 'plugin', ...VI_SCRIPT);
    const manifest = JSON.parse(fs.readFileSync(path.join(HOME_BASE, '.claude', 'plugins', 'installed_plugins.json'), 'utf8'));
    const entries = manifest?.plugins?.[`${VI_MARKETPLACE}@${VI_MARKETPLACE}`];
    const installPath = Array.isArray(entries) && entries[0]?.installPath;
    if (typeof installPath !== 'string' || !installPath) return all;
    const activeCache = path.join(installPath, ...VI_SCRIPT);
    const scoped = all.filter((f) => f === marketplaceFile || f === activeCache);
    return scoped.length ? scoped : all;
  } catch {
    return all;
  }
}

function activeDesignWallCopies() {
  const all = discoverDesignWall();
  const manifestFile = path.join(HOME_BASE, '.claude', 'plugins', 'installed_plugins.json');
  if (!fs.existsSync(manifestFile)) {
    return { copies: [], error: 'installed_plugins.json is absent — cannot identify the active ruvnet-brain copy' };
  }

  try {
    const marketplaceFile = path.join(HOME_BASE, '.claude', 'plugins', 'marketplaces', DW_MARKETPLACE, 'plugin', ...DW_SCRIPT);
    const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
    const entries = manifest?.plugins?.[`${DW_MARKETPLACE}@${DW_MARKETPLACE}`];
    if (entries === undefined) {
      return { copies: [], error: 'installed_plugins.json has no active ruvnet-brain entry' };
    }
    if (!Array.isArray(entries)) {
      return { copies: [], error: 'installed_plugins.json has an unexpected ruvnet-brain entry shape' };
    }
    if (!entries.length) {
      return { copies: [], error: 'installed_plugins.json has an empty ruvnet-brain entry list' };
    }

    // Never execute a path supplied only by the manifest. It must also be one of the files discovered
    // under the bounded ruvnet-brain plugin roots.
    const discovered = new Map(all.map((f) => [path.resolve(f), f]));
    const scoped = all.filter((f) => f === marketplaceFile);
    for (const entry of entries) {
      const installPath = entry?.installPath;
      if (typeof installPath !== 'string' || !path.isAbsolute(installPath)) {
        return { copies: [], error: 'installed_plugins.json does not name an absolute active ruvnet-brain installPath' };
      }
      const activeCache = path.resolve(installPath, ...DW_SCRIPT);
      const activeFile = discovered.get(activeCache);
      if (!activeFile) {
        return { copies: [], error: `installed_plugins.json names an active design-wall copy that is absent or outside the discovered plugin roots: ${activeCache}` };
      }
      scoped.push(activeFile);
    }
    return { copies: [...new Set(scoped)] };
  } catch (err) {
    return { copies: [], error: `could not resolve active design-wall copies: ${err.message}` };
  }
}

// Functional anchors from ruvnet-brain's own issue #17 fix. The fix identifies the repository from
// its plugin manifest (with a structure-based fallback) and exits before any design-wall surface
// checks when the project is not ruvnet-brain. Our older origin-name wrapper is deliberately NOT a
// marker: finding our own edit must never be accepted as evidence that upstream superseded it.
export const DW_FIX_MARKERS = [
  'IS_RUVNET_BRAIN=0',
  'plugin/.claude-plugin/plugin.json',
  '"name"[[:space:]]*:[[:space:]]*"ruvnet-brain"',
  '[ "$IS_RUVNET_BRAIN" = "1" ] || exit 0',
];

// A source marker plus `bash -n` is necessary and not sufficient: all four strings can survive in
// comments or dead code while the gate again blocks unrelated repositories (or stops protecting its
// own). Probe the installed script through the same JSON-on-stdin interface Claude Code uses.
function probeDesignWallBehavior(file, source) {
  let root;
  try {
    root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'rsp-design-wall-proof-')));
    const scriptDir = path.join(root, 'script');
    const probeFile = path.join(scriptDir, 'design-wall.sh');
    const probeHome = path.join(root, 'home');
    const unrelated = path.join(root, 'unrelated');
    const own = path.join(root, 'ruvnet-brain');
    fs.mkdirSync(scriptDir, { recursive: true });
    fs.mkdirSync(probeHome, { recursive: true });
    fs.writeFileSync(probeFile, source);
    fs.chmodSync(probeFile, 0o755);
    for (const sibling of ['hook-input.mjs', 'gate-receipt.sh']) {
      const from = path.join(path.dirname(file), sibling);
      if (fs.existsSync(from)) fs.copyFileSync(from, path.join(scriptDir, sibling));
    }

    const makeRepo = (dir, { manifest = false, origin }) => {
      fs.mkdirSync(dir, { recursive: true });
      const init = spawnSync('git', ['init', '-q'], { cwd: dir, encoding: 'utf8', timeout: 5000 });
      if (init.error || init.status !== 0) throw new Error(`git init failed (${init.error?.message || `exit ${init.status}`})`);
      fs.writeFileSync(path.join(dir, 'README.md'), '# design-wall retirement probe\n');
      if (manifest) {
        const manifestDir = path.join(dir, 'plugin', '.claude-plugin');
        fs.mkdirSync(manifestDir, { recursive: true });
        fs.writeFileSync(path.join(manifestDir, 'plugin.json'), '{"name":"ruvnet-brain"}\n');
      }
      if (origin) {
        const remote = spawnSync('git', ['remote', 'add', 'origin', origin], {
          cwd: dir,
          encoding: 'utf8',
          timeout: 5000,
        });
        if (remote.error || remote.status !== 0) throw new Error(`git remote add failed (${remote.error?.message || `exit ${remote.status}`})`);
      }
      const add = spawnSync('git', ['add', 'README.md'], { cwd: dir, encoding: 'utf8', timeout: 5000 });
      if (add.error || add.status !== 0) throw new Error(`git add failed (${add.error?.message || `exit ${add.status}`})`);
    };
    // Deliberately anti-correlate the old and new identity signals. The unrelated repo has a
    // ruvnet-brain-looking origin but no manifest; the own repo has the manifest but no matching
    // origin. The legacy origin heuristic therefore cannot masquerade as the stronger upstream fix.
    makeRepo(unrelated, { origin: 'https://github.com/stuinfla/ruvnet-brain.git' });
    makeRepo(own, { manifest: true });

    const runGate = (projectDir) => {
      const command = 'git commit -m "docs: update README"';
      const payload = JSON.stringify({ tool_name: 'Bash', command, tool_input: { command } });
      const env = {};
      for (const key of ['PATH', 'LANG', 'LC_ALL', 'LC_CTYPE', 'TMPDIR', 'TMP', 'TEMP', 'SYSTEMROOT', 'ComSpec', 'PATHEXT']) {
        if (process.env[key] !== undefined) env[key] = process.env[key];
      }
      return spawnSync('bash', [probeFile], {
        input: payload,
        encoding: 'utf8',
        timeout: 5000,
        maxBuffer: 1024 * 1024,
        env: {
          ...env,
          HOME: probeHome,
          CLAUDE_PROJECT_DIR: projectDir,
          RUVNET_SKIP_DESIGN_WALL: '',
        },
      });
    };

    const outside = runGate(unrelated);
    const inside = runGate(own);
    if (outside.error || inside.error || outside.status === null || inside.status === null) {
      return {
        state: 'unknown',
        evidence: `could not execute the design-wall behavior probe for ${file}: ${outside.error?.message || inside.error?.message || 'no exit status'}`,
      };
    }
    if (outside.status === 0 && inside.status === 2) return { state: 'proven' };
    if ((outside.status === 0 || outside.status === 2) && (inside.status === 0 || inside.status === 2)) {
      return {
        state: 'live',
        evidence: `${file} failed the behavior proof (unrelated repo exit ${outside.status}, ruvnet-brain repo exit ${inside.status}; expected 0 and 2)`,
      };
    }
    return {
      state: 'unknown',
      evidence: `${file} could not be behaviorally classified (unrelated repo exit ${outside.status}, ruvnet-brain repo exit ${inside.status})`,
    };
  } catch (err) {
    return { state: 'unknown', evidence: `could not set up the design-wall behavior probe for ${file}: ${err.message}` };
  } finally {
    if (root) {
      try { fs.rmSync(root, { recursive: true, force: true }); } catch { /* best-effort probe cleanup */ }
    }
  }
}

// A predicate returns one of:
//   { state: 'superseded', evidence }  the replacement is present AND runnable HERE. Retire.
//   { state: 'live',       evidence }  we are still doing something no one else is. Keep.
//   { state: 'unknown',    evidence }  we could not tell. Keep, and say why.
export const SUPERSEDED_BY = {
  ...brainNativeSupersessions,
  'brain-search-safety': brainSearchSafetySupersession,
  daemon: daemonSupersession,
  'adr-template': {
    ...adrTemplateSupersession(),
    retire: () => {
      const remaining = readState().pluginTargets.filter((t) => t !== 'adr-template');
      return reconcileComposed(remaining, ['adr-template']);
    },
  },
  'adr-index': {
    ...adrIndexSupersession(),
    retire: () => {
      const remaining = readState().pluginTargets.filter((t) => t !== 'adr-index');
      return reconcileComposed(remaining, ['adr-index']);
    },
  },
  'flywheel-daily': flywheelDailySupersession,
  'ruflo-hooks-schema': rufloHooksSchemaSupersession,
  'codex-hooks': codexHooksSupersession,
  'ruflo-codex-skills': rufloCodexSkillsSupersession,
  'mcp-prefix': mcpPrefixSupersession,
  'adr-reindex': {
    issue: 'https://github.com/ruvnet/ruflo/issues/2666',
    replacement: "ruflo-adr's own /adr-reindex, plus the `memory purge` hard-delete it calls",
    // How this target stands down. restore() only ever removes files carrying OUR marker; it refuses to
    // touch upstream's (skip:not-ours), so retiring cannot delete the replacement it is standing down for.
    retire: () => adrReindex.restore(),
    check: adrReindex.supersessionCheck,
  },

  'verify-interface': {
    issue: 'https://github.com/stuinfla/ruvnet-brain/issues/12',
    replacement: "ruvnet-brain's own scripts/verify-interface.sh replacement: either the v3.2.9+ "
      + 'JSON/command-position gate with reachable override, or issue #48\'s advisory-only raw-Bash '
      + 'hook backed by structured ruvnet_cli_help/run enforcement',
    // Only ever touches files carrying OUR marker (reconcile -> restoreFromBackup, guarded the same
    // way adr-reindex's restore() is), so it cannot destroy upstream's replacement.
    retire: () => {
      const remaining = readState().pluginTargets.filter((t) => t !== 'verify-interface');
      return reconcileComposed(remaining, ['verify-interface']);
    },
    check() {
      // Every copy this target could be patching: the marketplace checkout plus each cached version.
      // A leftover pre-fix cache dir Claude Code could still load must keep this LIVE, so ALL of them
      // must show the fix — not merely the currently-active one.
      const copies = activeVerifyInterfaceCopies();
      if (!copies.length) {
        return { state: 'unknown', evidence: 'no verify-interface.sh found under ruvnet-brain — cannot confirm the replacement is even present' };
      }

      const unfixed = [];
      const modes = [];
      for (const f of copies) {
        let src;
        try { src = fs.readFileSync(f, 'utf8'); } catch (err) { return { state: 'unknown', evidence: `could not read ${f}: ${err.message}` }; }
        const mode = verifyInterfaceFixMode(src);
        if (mode) modes.push(mode);
        else unfixed.push(f);
      }

      if (unfixed.length) {
        return {
          state: 'live',
          evidence: `${unfixed.length}/${copies.length} installed copy(ies) still lack the fix (${unfixed.join(', ')}) `
            + '— our patch is still needed there',
        };
      }

      return {
        state: 'superseded',
        evidence: `all ${copies.length} installed copy(ies) carry a complete upstream replacement: `
          + `${modes.filter((mode) => mode === 'command-gate').length} fixed command gate(s), `
          + `${modes.filter((mode) => mode === 'advisory-only').length} advisory-only structured-boundary hook(s)`,
      };
    },
  },

  'design-wall': {
    issue: 'https://github.com/stuinfla/ruvnet-brain/issues/17',
    replacement: "ruvnet-brain's own repository-identity gate in scripts/design-wall.sh "
      + '(plugin-manifest identity with a structure-based fallback)',
    retire: () => {
      const remaining = readState().pluginTargets.filter((t) => t !== 'design-wall');
      return reconcileComposed(remaining, ['design-wall']);
    },
    postRetireCheck() {
      const selected = activeDesignWallCopies();
      if (selected.error) return { ok: false, evidence: selected.error };
      for (const selectedFile of selected.copies) {
        const validated = validateDesignWallCopy(selectedFile);
        if (validated.error) return { ok: false, evidence: validated.error };
        const f = validated.file;
        let src;
        try { src = fs.readFileSync(f, 'utf8'); } catch (err) { return { ok: false, evidence: `could not read ${f} after reconciliation: ${err.message}` }; }
        if (designWallDescriptor.isPatched(src)) {
          return { ok: false, evidence: `our design-wall edit is still present in ${f} after reconciliation` };
        }
      }
      return { ok: true };
    },
    check() {
      const selected = activeDesignWallCopies();
      if (selected.error) return { state: 'unknown', evidence: selected.error };
      const { copies } = selected;
      if (!copies.length) {
        return { state: 'unknown', evidence: 'no design-wall.sh found under ruvnet-brain — cannot confirm the replacement is present' };
      }

      const unfixed = [];
      for (const selectedFile of copies) {
        const validated = validateDesignWallCopy(selectedFile);
        if (validated.error) return { state: 'unknown', evidence: validated.error };
        const f = validated.file;
        let src;
        try {
          src = fs.readFileSync(f, 'utf8');
        } catch (err) {
          return { state: 'unknown', evidence: `could not read ${f}: ${err.message}` };
        }
        const candidate = designWallUpstreamSource(f, src);
        if (candidate.error) return { state: 'unknown', evidence: `${f}: ${candidate.error}` };
        const hasIdentityGate = DW_FIX_MARKERS.every((marker) => candidate.source.includes(marker));
        if (!hasIdentityGate) { unfixed.push(`${f} (identity markers absent)`); continue; }
        const syntax = spawnSync('bash', ['-n'], { input: candidate.source, stdio: ['pipe', 'ignore', 'ignore'] });
        if (syntax.error || syntax.status === null) {
          return { state: 'unknown', evidence: `could not syntax-check ${f}: ${syntax.error?.message || 'no exit status'}` };
        }
        if (syntax.status !== 0) { unfixed.push(`${f} (shell syntax invalid)`); continue; }

        const behavior = probeDesignWallBehavior(f, candidate.source);
        if (behavior.state === 'unknown') return { state: 'unknown', evidence: behavior.evidence };
        if (behavior.state !== 'proven') unfixed.push(`${f} (behavior proof failed: ${behavior.evidence})`);
      }

      if (unfixed.length) {
        return {
          state: 'live',
          evidence: `${unfixed.length}/${copies.length} installed copy(ies) still lack a parseable upstream repository-identity gate `
            + `(${unfixed.join(', ')}) — our patch is still needed there`,
        };
      }

      return {
        state: 'superseded',
        evidence: `all ${copies.length} active installed copy(ies) carry a parseable repository-identity gate and behaviorally `
          + 'allow an unrelated README commit while still blocking ruvnet-brain\'s own',
      };
    },
  },
};

/** Evaluate one target's supersession predicate. A target with no entry is never superseded. */
export function evaluate(target) {
  const entry = SUPERSEDED_BY[target];
  if (!entry) return { state: 'live', evidence: 'no supersession predicate' };
  try {
    return { ...entry.check(), issue: entry.issue, replacement: entry.replacement };
  } catch (err) {
    // A throwing predicate must never retire anything.
    return { state: 'unknown', evidence: `predicate threw: ${err.message}`, issue: entry.issue };
  }
}

/**
 * Which of the INSTALLED targets are superseded here, right now?
 * Pure: reads the world, mutates nothing. Both the read-only and the mutating paths call this — they
 * differ only in what they DO with the answer.
 */
export function supersededAmong(installed = []) {
  const out = [];
  for (const t of installed) {
    if (!SUPERSEDED_BY[t]) continue;
    const r = evaluate(t);
    if (r.state === 'superseded') out.push({ target: t, ...r });
  }
  return out;
}

/**
 * MUTATING. Retire every installed target whose replacement is present and runnable HERE.
 *
 * Called only from paths that already repair (`install`, `monitor run`, the SessionStart hook). The
 * read-only paths (`status`, `monitor check`) call supersededAmong() and merely SAY so — the standing
 * rule in this package is that read-only actions observe and mutating actions repair, and a `check`
 * that quietly uninstalls things would be the worst possible violation of it.
 *
 * Announces once. After this, the target is out of state.json and marked retired, so the SessionStart
 * hook stops re-applying it and the banner stops firing. That is the point: a warning that repeats every
 * session and never resolves is a warning people train themselves to scroll past, which is how the NEXT
 * real one gets missed.
 */
export function retireSuperseded(state) {
  const out = { retired: 0, log: [] };
  const installed = [...state.patchTargets, ...state.pluginTargets];
  const candidates = supersededAmong(installed);
  const retiring = new Set(candidates.map(({ target }) => target));

  for (const { target, evidence, issue, replacement } of candidates) {
    try {
      const entry = SUPERSEDED_BY[target];
      const r = entry.retire({ retiring });
      for (const l of (r?.log ?? [])) out.log.push(`${target}: ${l}`);
      if ((r?.errors || 0) > 0 || (r?.incomplete || 0) > 0 || (r?.unresolved || 0) > 0) {
        throw new Error(`reconciliation did not complete cleanly (errors=${r?.errors || 0}, incomplete=${r?.incomplete || 0}, unresolved=${r?.unresolved || 0})`);
      }

      // Re-prove the replacement AFTER reconciliation. This catches the exact stale-backup hazard:
      // if cleanup restored old vendor bytes over the replacement, the predicate must no longer pass
      // and terminal state must not be written.
      const after = entry.check();
      if (after.state !== 'superseded') {
        throw new Error(`replacement failed the post-reconciliation proof (${after.state}: ${after.evidence})`);
      }
      if (entry.postRetireCheck) {
        const post = entry.postRetireCheck();
        if (!post?.ok) throw new Error(`retirement postcondition failed: ${post?.evidence || 'unknown reason'}`);
      }
      const verifiedEvidence = after.evidence || evidence;

      retireTargetInState(target, {
        reason: `superseded by ${replacement}`,
        evidence: verifiedEvidence,
        issue,
      });

      out.retired++;
      out.log.push(
        `retired ${target} — ${verifiedEvidence}. Removed ours and recorded it; the SessionStart hook will not `
        + `re-apply it. This is not a failure: upstream now does this job. (${issue})`,
      );
    } catch (err) {
      // A retirement that half-happened is worse than one that did not: the file could be gone while
      // state still lists the target, so the next tick would try to "repair" it. Say so, loudly, and
      // leave state alone — the target stays installed and the next tick re-applies it.
      out.log.push(`error retiring ${target}: ${err.message} — left it installed`);
    }
  }
  return out;
}
