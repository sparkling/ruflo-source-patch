// Installs the `adr-reindex` SKILL into the installed `ruflo-adr` plugin, so the rebuild is a
// `/adr-reindex` slash command sitting next to `/adr-create`, `/adr-index`, `/adr-review` and
// `/adr-verify` — where someone looking for it will actually find it.
//
// THE GAP THIS FILLS: ruvnet/ruflo#2666. ruflo-adr can ADD an ADR to the index, and once #2660 lands it
// can UPDATE one. It has no way to REMOVE one — there is no command and no code path that reconciles a
// deletion. Convergence (upsert) and reaping are different operations, and fixing #2660 does not give you
// the second. Worse, `adr-verify` then certifies the rotten graph as HEALTHY, because an orphan row has
// no dangling ref and forms no cycle. This is the only target that ADDS a command rather than fixing a
// broken one; when #2666 lands upstream, uninstall it.
//
// WHY IT HAS TO BE A PLUGIN TARGET, AND NOT A SCRIPT ONE.
//
// The script was materialized to ~/.ruflo-source-patch/adr-reindex/ and nothing else. It worked — but
// the only place it surfaced was the `ORPHANS:` line the patched importer prints, i.e. discovery at the
// exact moment of failure and nowhere else. Every other ADR operation is a slash command; this one was
// an absolute path you had to already know. So it was, functionally, invisible.
//
// Claude Code auto-discovers skills from `<plugin>/skills/<name>/SKILL.md` — the manifest does not
// enumerate them — so dropping the directory in is enough to create the command. Which is also exactly
// why this cannot be a fire-and-forget copy: the file lives INSIDE someone else's plugin, and a
// `/plugin update` re-fetches ruflo-adr wholesale and takes our skill with it. Silently. The slash
// command would simply stop existing, with no error and nothing to read.
//
// So it is a plugin patch target: recorded in state.json, re-applied by the SessionStart hook and by
// the monitor, exactly like adr-template and adr-index. Same machinery, same guarantees.
//
// ADDITIVE, NOT AN EDIT — which changes the safety rule.
//
// The other two patchers rewrite a vendor file and keep a .rsp-backup to restore. This one CREATES a
// file that upstream does not ship, so there is no pristine to preserve and nothing to re-baseline.
// The hazard runs the other way: `uninstall` must never delete a SKILL.md we did not write. If upstream
// ever ships its own `adr-reindex` skill, ours must yield to it and must not take theirs with it when
// removed. Hence MARKER: we only ever overwrite or delete a file that carries it.

import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import { HOME_BASE, GLOBAL_ROOTS, NPX_ROOT, ADR_REINDEX_DIR } from '../cwd/paths.mjs';

const MARKETPLACE = 'ruflo'; // upstream only — no legacy forks
const PLUGIN_NAME = 'ruflo-adr';
const SKILL_SUFFIX = ['skills', 'adr-reindex', 'SKILL.md'];

// Ours, and provably so. Anything without this line is upstream's and is never touched.
const MARKER = 'ruflo-source-patch';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const SKILL_SRC = path.join(__dirname, 'SKILL.md');

const skillBody = () => fs.readFileSync(SKILL_SRC, 'utf8');
const isOurs = (src) => src.includes(MARKER);

// Every installed copy of the UPSTREAM ruflo-adr:
//   cache/ruflo/ruflo-adr/<version>/skills/adr-reindex/SKILL.md
//   marketplaces/ruflo/plugins/ruflo-adr/skills/adr-reindex/SKILL.md
// Discovered by the presence of the PLUGIN (its manifest), not of our skill — we are creating that,
// so keying on it would find nothing on a fresh install and silently patch zero copies.
export function discover() {
  const found = [];

  const cacheRoot = path.join(HOME_BASE, '.claude', 'plugins', 'cache', MARKETPLACE, PLUGIN_NAME);
  try {
    for (const version of fs.readdirSync(cacheRoot)) {
      const root = path.join(cacheRoot, version);
      if (fs.existsSync(path.join(root, '.claude-plugin', 'plugin.json'))) {
        found.push(path.join(root, ...SKILL_SUFFIX));
      }
    }
  } catch { /* not installed via this cache path */ }

  const mp = path.join(HOME_BASE, '.claude', 'plugins', 'marketplaces', MARKETPLACE, 'plugins', PLUGIN_NAME);
  if (fs.existsSync(path.join(mp, '.claude-plugin', 'plugin.json'))) {
    found.push(path.join(mp, ...SKILL_SUFFIX));
  }

  return [...new Set(found)];
}

const REINDEX_SCRIPT_HINT = path.join(ADR_REINDEX_DIR, 'ruflo-adr-reindex.sh');

// Does the INSTALLED CLI actually provide `memory purge`, the command upstream's own /adr-reindex is
// built on? Read it off the shipped code rather than running the CLI: spawning it costs seconds, and a
// missing subcommand exits 0 anyway, so the exit code could not answer this question even if we paid
// for it.
//
// Subcommands appear in `commands/memory.js` as quoted literals ('store', 'delete', 'cleanup', ...).
// In every published build to date, 'purge' appears zero times.
//
// Errs toward "not available": if no CLI can be found at all, we keep our own script installed. The
// cost of being wrong that way is a redundant slash command. The cost of being wrong the other way is
// an ADR index that reports a successful reconcile and reconciles nothing.
function upstreamPurgeAvailable() {
  const SUFFIX = ['@claude-flow', 'cli', 'dist', 'src', 'commands', 'memory.js'];
  const roots = [];
  for (const g of GLOBAL_ROOTS) roots.push(g);
  try {
    for (const d of fs.readdirSync(NPX_ROOT)) roots.push(path.join(NPX_ROOT, d, 'node_modules'));
  } catch { /* no npx cache */ }

  for (const root of roots) {
    const f = path.join(root, ...SUFFIX);
    try {
      if (/['"]purge['"]/.test(fs.readFileSync(f, 'utf8'))) return true;
    } catch { /* not this root */ }
  }
  return false;
}

export function apply() {
  const result = {
    patched: 0, unchanged: 0, skipped: 0, incomplete: 0, errors: 0, log: [],
  };
  let body;
  try {
    body = skillBody();
  } catch (err) {
    result.errors++;
    result.log.push(`error cannot read the packaged skill (${SKILL_SRC}): ${err.message}`);
    return result;
  }

  for (const file of discover()) {
    try {
      if (fs.existsSync(file)) {
        const cur = fs.readFileSync(file, 'utf8');
        // Upstream shipped its own adr-reindex skill. Theirs wins — ours exists only because theirs
        // did not, and silently overwriting a vendor skill is precisely what this package is against.
        //
        // But "upstream owns the file" is NOT the same as "upstream's version works", and this target
        // told me to uninstall it on exactly that conflation. `ruflo-adr` 0.4.0 ships an /adr-reindex
        // whose reindex.mjs shells out to `memory purge --namespace <ns> --force` — a CLI command that
        // is merged to ruflo's main but NOT PUBLISHED: no released @claude-flow/cli (3.25.x, 3.26.0,
        // 3.28.0) registers a `purge` subcommand. An unknown subcommand prints the help text and EXITS
        // 0, and their reindex.mjs gates on `status !== 0`, so it reports `adr-patterns: purged` having
        // purged nothing. (Its post-condition does then catch the mismatch and exit 1, but blames a
        // phantom concurrent writer and tells you to re-run, which can never help.)
        //
        // So we report which of the two is TRUE, rather than assuming the newer file is the better one.
        if (!isOurs(cur)) {
          result.skipped++;
          result.log.push(
            upstreamPurgeAvailable()
              ? `skip:upstream-owns-it ${file} — ruflo-adr ships its own adr-reindex AND the installed CLI has \`memory purge\`, so theirs works. Uninstall this target.`
              : `skip:upstream-owns-it ${file} — ruflo-adr ships its own adr-reindex, but it calls \`memory purge\`, which NO published @claude-flow/cli provides (unknown subcommand prints help and exits 0, so it reports "purged" having purged nothing: ruvnet/ruflo#2666). Leaving their file alone. OUR script still reconciles, with raw SQL and no CLI dependency: ${REINDEX_SCRIPT_HINT}. Do NOT uninstall this target until \`memory purge\` ships.`,
          );
          continue;
        }
        if (cur === body) { result.unchanged++; continue; }
      }
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, body);
      result.patched++;
      result.log.push(`patched ${file} (installed the /adr-reindex skill)`);
    } catch (err) {
      result.errors++;
      result.log.push(`error ${file}: ${err.message}`);
    }
  }
  return result;
}

export function restore() {
  const result = { restored: 0, log: [] };
  for (const file of discover()) {
    try {
      if (!fs.existsSync(file)) continue;
      // NEVER delete a skill we did not write. There is no backup to fall back on here — the file is
      // ours or it is upstream's, and getting that wrong destroys someone else's work outright.
      if (!isOurs(fs.readFileSync(file, 'utf8'))) {
        result.log.push(`skip:not-ours ${file} — no ruflo-source-patch marker; refusing to delete a skill we did not write`);
        continue;
      }
      fs.rmSync(file, { force: true });
      // Take the directory too, but only if our removal emptied it.
      try { fs.rmdirSync(path.dirname(file)); } catch { /* not empty — leave it */ }
      result.restored++;
      result.log.push(`restored ${file} (removed the /adr-reindex skill)`);
    } catch (err) {
      result.log.push(`error ${file}: ${err.message}`);
    }
  }
  return result;
}

export function status() {
  const out = { files: 0, patched: 0, log: [] };
  let body = null;
  try { body = skillBody(); } catch { /* reported per-file below */ }

  for (const file of discover()) {
    out.files++;
    if (!fs.existsSync(file)) {
      out.log.push(`not-patched ${file} — the /adr-reindex skill is not installed`);
      continue;
    }
    let cur;
    try { cur = fs.readFileSync(file, 'utf8'); } catch { out.log.push(`unreadable ${file}`); continue; }

    if (!isOurs(cur)) {
      out.log.push(`not-patched ${file} — a skill exists but is NOT ours (upstream ships one now?)`);
      continue;
    }
    // Present AND current. A stale copy of our own skill is still a patched copy, but say so: it means
    // the packaged skill moved on and this install has not caught up.
    out.patched++;
    out.log.push(body !== null && cur !== body
      ? `patched ${file} (STALE — the packaged skill has changed; re-run install)`
      : `patched ${file}`);
  }
  return out;
}
