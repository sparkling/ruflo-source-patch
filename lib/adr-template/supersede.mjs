import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { HOME_BASE } from '../cwd/paths.mjs';

const PLUGIN = 'ruflo-adr';
const PARSER = ['scripts', 'lib', 'parse-adrs.mjs'];
const CLAUDE_CACHE_ROOT = path.join(HOME_BASE, '.claude', 'plugins', 'cache', 'ruflo', PLUGIN);
const CLAUDE_MARKETPLACE_ROOT = path.join(
  HOME_BASE, '.claude', 'plugins', 'marketplaces', 'ruflo', 'plugins', PLUGIN,
);
const CODEX_HOME = process.env.CODEX_HOME || path.join(HOME_BASE, '.codex');
const CODEX_MARKETPLACE_ROOT = path.join(
  CODEX_HOME, '.tmp', 'marketplaces', 'ruflo', 'plugins', PLUGIN,
);
const CODEX_CACHE_ROOT = path.join(CODEX_HOME, 'plugins', 'cache', 'ruflo', PLUGIN);

function within(root, candidate) {
  const rel = path.relative(path.resolve(root), path.resolve(candidate));
  return rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel);
}

function activeClaudeRoots() {
  const manifestFile = path.join(HOME_BASE, '.claude', 'plugins', 'installed_plugins.json');
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
  } catch (error) {
    return { error: `could not read Claude's installed plugin registry: ${error.message}` };
  }
  const entries = manifest?.plugins?.[`${PLUGIN}@ruflo`];
  if (!Array.isArray(entries)) {
    return { error: "Claude's registry has no user-scoped ruflo-adr install" };
  }
  const active = entries.filter((entry) => entry?.scope === 'user'
    || (entry?.enabled !== false
      && ['project', 'local'].includes(entry?.scope)
      && typeof entry?.projectPath === 'string'
      && path.isAbsolute(entry.projectPath)
      && fs.existsSync(entry.projectPath)
      && fs.lstatSync(entry.projectPath).isDirectory()));
  if (!active.some((entry) => entry?.scope === 'user')) {
    return { error: "Claude's registry has no user-scoped ruflo-adr install" };
  }
  for (const entry of active) {
    if (typeof entry?.installPath !== 'string' || !path.isAbsolute(entry.installPath)
        || !within(CLAUDE_CACHE_ROOT, entry.installPath)) {
      return { error: `Claude's active ruflo-adr installPath is absent or outside its bounded cache root: ${String(entry?.installPath)}` };
    }
  }
  return { roots: [...new Set(active.map((entry) => entry.installPath))] };
}

function activeCodexRoot() {
  const manifestFile = path.join(CODEX_MARKETPLACE_ROOT, '.claude-plugin', 'plugin.json');
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
  } catch (error) {
    return { error: `could not read Codex's ruflo-adr marketplace manifest: ${error.message}` };
  }
  const version = manifest?.version;
  if (typeof version !== 'string' || !/^[0-9A-Za-z][0-9A-Za-z._+-]*$/.test(version)) {
    return { error: `Codex's ruflo-adr manifest has an unsafe or absent version: ${String(version)}` };
  }
  const root = path.join(CODEX_CACHE_ROOT, version);
  if (!within(CODEX_CACHE_ROOT, root)) {
    return { error: `Codex's ruflo-adr cache path escaped its bounded root: ${root}` };
  }
  return { root };
}

export function activeRufloAdrRoots() {
  const claude = activeClaudeRoots();
  if (claude.error) return { roots: [], error: claude.error };
  const codex = activeCodexRoot();
  if (codex.error) return { roots: [], error: codex.error };

  return { roots: [...new Set([
    CLAUDE_MARKETPLACE_ROOT,
    ...claude.roots,
    CODEX_MARKETPLACE_ROOT,
    codex.root,
  ])] };
}

export function activeParserCopies() {
  const selected = activeRufloAdrRoots();
  if (selected.error) return { copies: [], error: selected.error };
  const copies = selected.roots.map((root) => path.join(root, ...PARSER));
  const missing = copies.filter((file) => !fs.existsSync(file));
  if (missing.length) {
    return { copies: [], error: `active ruflo-adr parser copy/copies are absent: ${missing.join(', ')}` };
  }
  return { copies: [...new Set(copies)] };
}

function probeParser(file) {
  let root;
  try {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'rsp-adr-template-proof-'));
    const adrDir = path.join(root, 'docs', 'adr');
    const adr = path.join(adrDir, 'ADR-007-bullet-contract.md');
    fs.mkdirSync(adrDir, { recursive: true });
    fs.writeFileSync(adr, `# ADR-007: Bullet contract

- **Status**: accepted
- **Date**: 2026-07-29
- **Tags**: agentdb, lifecycle, graph
- **Supersedes**: ADR-006
- **Amends**: ADR-005
- **Related**: ADR-004
- **Depends-on**: ADR-003

## Context

The creator and parser agree.
`);
    const program = `
import { pathToFileURL } from 'node:url';
const [parser, adr, root] = process.argv.slice(1);
const { parseAdr } = await import(pathToFileURL(parser).href + '?rsp=' + Date.now());
const parsed = parseAdr(adr, root);
const links = new Set(parsed.links.map(({ from, to, relation }) => \`${'${relation}:${from}->${to}'}\`));
const ok = parsed.status === 'accepted'
  && parsed.date === '2026-07-29'
  && JSON.stringify(parsed.tags) === JSON.stringify(['agentdb', 'lifecycle', 'graph'])
  && ['supersedes:ADR-006->ADR-007', 'amends:ADR-007->ADR-005',
      'related:ADR-007->ADR-004', 'depends-on:ADR-007->ADR-003'].every((edge) => links.has(edge));
if (!ok) { console.error(JSON.stringify(parsed)); process.exit(1); }
`;
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', program, file, adr, root], {
      encoding: 'utf8', timeout: 5000, maxBuffer: 1024 * 1024,
    });
    if (result.error || result.status === null) {
      return { state: 'unknown', evidence: `${file} could not be executed: ${result.error?.message || 'no exit status'}` };
    }
    if (result.status !== 0) {
      return { state: 'live', evidence: `${file} failed the creator/parser round-trip: ${(result.stderr || result.stdout).trim() || `exit ${result.status}`}` };
    }
    return { state: 'proven' };
  } catch (error) {
    return { state: 'unknown', evidence: `${file} probe setup failed: ${error.message}` };
  } finally {
    if (root) fs.rmSync(root, { recursive: true, force: true });
  }
}

export function adrTemplateSupersession() {
  return {
    issue: 'https://github.com/ruvnet/ruflo/issues/2659',
    replacement: "ruflo-adr's native parser for list-prefixed creator metadata and relationships",
    check() {
      const selected = activeParserCopies();
      if (selected.error) return { state: 'unknown', evidence: selected.error };
      const failures = [];
      for (const file of selected.copies) {
        const probe = probeParser(file);
        if (probe.state === 'unknown') return probe;
        if (probe.state !== 'proven') failures.push(probe.evidence);
      }
      if (failures.length) {
        return {
          state: 'live',
          evidence: `${failures.length}/${selected.copies.length} active Claude/Codex parser copy(ies) still fail #2659 (${failures.join('; ')})`,
        };
      }
      return {
        state: 'superseded',
        evidence: `all ${selected.copies.length} active Claude/Codex marketplace and cache parser copies pass the creator metadata/relationship round-trip`,
      };
    },
  };
}
