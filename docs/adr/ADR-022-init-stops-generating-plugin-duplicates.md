# ADR-022: init: stop `ruflo init` generating what the plugins already provide

**Status**: accepted
**Date**: 2026-07-16
**Updated**: 2026-07-29. Ruflo #2777 is fixed upstream. #2801's initializer registration landed, so the redundant Codex lifecycle source edit has been removed. The canonical plugin still has two Codex-host defects: its manifest fails Codex's strict schema (PR #2800), and its PreToolUse shim emits Cursor-only output (#2816). `ruflo-hooks-schema` covers only those installed Codex copies. The legacy external skill-import guard remains shape-gated for older installed CLIs. `ruflo-codex-hooks` remains an explicit repair for systems initialized before v3.32.24. #2854 identifies the missing installer layer: Claude Code and Codex keep separate plugin registries, so `plugin-hosts` adds explicit Ruflo-owned dual-host install, uninstall, and additive reconciliation commands that use each host's public CLI. Cache-local command patches remain limited to their original issue-backed gaps (#2821 / Brain #56).
**Deciders**: Henrik Pettersen

**Tags**: patch-target, init, plugin, cost

## Context

`plugin-only` (ADR-012) removes, from a project, everything the installed plugins already provide: the
`.claude/{skills,commands,agents}` bundle, the double-firing hooks, and the standalone `claude-flow` MCP
registration. But `ruflo init` (and `doctor`) REGENERATE exactly that, so a single init run silently re-adds
the whole duplicate set. Cleaning after the fact is a treadmill; the durable fix is to stop the generation.

Two facts decide the shape:

- The CLI has NO notion of plugin-on vs plugin-off. `mcp.claudeFlow` is hardcoded `true` in every init
  preset, and there is no `--plugin-only` / `--no-mcp` / `--plugin-off` flag that flips it. init cannot tell
  whether a plugin already provides the server; it always writes the standalone.
- This is a PLUGIN-ALWAYS deployment. Plugin-off is not a supported configuration here, so the standalone
  registration and the bundled skills/commands/agents are never anything but duplicates.

ADR-018 deliberately left the init generators alone, reasoning that standalone registration is correct for
plugin-off setups. That reasoning does not hold on a deployment that has no plugin-off case.

Plugin-native also does not mean host-identical. Claude Code discovers `commands/*.md` as slash commands.
Codex discovers plugin skills and only migrates some command files; in Codex 0.145 a rendered command
over 4,000 bytes is silently skipped. Therefore removing the duplicated project bundle is still correct,
but command parity must be proved against each host's actual discovery surface rather than inferred from
the presence of a plugin command.

## Decision

Add an `init` patch target to `@claude-flow/cli`, patched at the callee like the other CLI targets, that
disables generation of the plugin-duplicated artifacts.
Three files, five edits:

- `init/mcp-generator.js`: disable the standalone `claude-flow` `.mcp.json` emission. The guard
  `if (config.claudeFlow)` occurs three times (config + two add-command branches), so the anchor pins the
  config emission via the unique `createMCPServerEntry` line. `ruv-swarm` / `flow-nexus` are untouched.
- `init/executor.js`: disable the three bundle copy gates (`copySkills` / `copyCommands` / `copyAgents`).
  HELPERS ARE KEPT (init writes all ~43; no plugin replaces them), exactly as `plugin-only` keeps them.
  `settings` / `statusline` / `runtime` / `claudeMd` are untouched.
- `commands/init.js` (legacy compatibility for [#2777](https://github.com/ruvnet/ruflo/issues/2777)):
  suppress `maybeInstallSkillsSh()` only when the vendor bytes still execute
  `npx --yes skills add ruvnet/ruflo --skill ruflo --yes`, which imported 97MB and 384 `SKILL.md`.
  Ruflo 3.32.10+'s bounded in-process platform-skill materialization does not contain that feature
  gate, so the local edit stands down per file and leaves the upstream repair untouched.

The suppression edits are `if (X)` → `if (false && X)` (and, on legacy #2777 bytes, an unconditional
early `return`). Every edit reverts to byte-identical on uninstall. It composes into `all` like any patch target, so a
plugin-always machine that installed `all` adopts it on the next tick (ADR-019).

## Consequences

### Positive

- `ruflo init` / `doctor` stop re-adding the duplicates, so `plugin-only` is a one-time cleanup rather than
  a recurring chore. The two are complements: `plugin-only` removes what exists, `init` stops it recurring.
- Ruflo v3.32.24 / `@claude-flow/codex` 3.0.2 now installs the canonical lifecycle plugin itself,
  so the redundant #2801 initializer edit is retired. The separate `ruflo-hooks-schema` target
  normalizes the rejected manifest header (PR #2800) and silences the Cursor-only bare PreToolUse
  verdict (#2816) only in Codex's installed copies. It preserves the seven registrations and Ruflo
  telemetry call. `ruflo-codex-hooks` remains the one-shot registration repair for older systems.
- `plugin-hosts` patches Ruflo's existing plugin command layer, not either host cache. Its
  `host-install`, `host-uninstall`, and `host-sync` commands validate exact `*@ruflo` identities,
  delegate through literal argv to `claude plugin` / `codex plugin`, preserve disabled and
  target-only state, and report partial completion as failure. Raw host installers remain
  host-specific; sync is additive and dry-run is mutation-free.
- `ruflo-codex-skills` adds Ruflo's missing read-only status surface, while
  `brain-codex-skills` adds Brain's skipped `rvbc` / `whats-new` surfaces and repairs the three
  incomplete migrated aliases. Both target only the active Codex cache. They do not restore the
  project bundle, alter Claude Code, or touch Brain's shared source/updater plane.
- Verified against real vendor bytes (II1 to II4): the emission and all three bundle gates are disabled,
  legacy #2777 bytes are suppressed while bounded upstream bytes remain active, all files still parse,
  and uninstall restores byte-for-byte.

### Negative

- This REVERSES ADR-018's "leave the generators alone" scope. It is correct ONLY on a plugin-always
  deployment; on a genuine plugin-off machine it would suppress a registration that is actually needed.
  The predicate for that is "do you run plugins?", which no probe can answer, so it is a stated deployment
  assumption rather than a measured one, unlike the anchor checks.
- It disables the bundle wholesale, so the roughly 0 to 3% of init-written items with no plugin counterpart are no
  longer generated either. On a plugin-always setup the plugins (and the `dual` template) cover these.

### Neutral

- Superseded if upstream gives init a real plugin-aware mode (a flag or detection that skips the standalone
  and the bundle when a plugin provides them); the anchors stop matching and `status` reports `0` to patch.
- Codex exposes these workflows through `/skills` and `$plugin:skill`; it does not provide Claude-style
  third-party root slash-command namespaces.

## Links

- [ADR-012](ADR-012-dedupe-bundle-strip-duplicated-skills.md) (`plugin-only`, the after-the-fact removal this complements)
- [ADR-018](ADR-018-mcp-prefix-plugin-namespaced-tools.md) (whose "generators out of scope" this revises), [ADR-019](ADR-019-all-mode-adopts-new-targets.md)
- Upstream: [ruvnet/ruflo#2640](https://github.com/ruvnet/ruflo/issues/2640) (the bundle), [#2685](https://github.com/ruvnet/ruflo/issues/2685) (the standalone MCP registration), [#2777](https://github.com/ruvnet/ruflo/issues/2777), [#2801](https://github.com/ruvnet/ruflo/issues/2801) (registration landed; handler-load acceptance still false), [PR #2800](https://github.com/ruvnet/ruflo/pull/2800) (strict hook-manifest schema), [#2816](https://github.com/ruvnet/ruflo/issues/2816) (Codex PreToolUse output), [#2821](https://github.com/ruvnet/ruflo/issues/2821) (missing Ruflo status skill), [#2854](https://github.com/ruvnet/ruflo/issues/2854) (dual-host marketplace installer), and [stuinfla/ruvnet-brain#56](https://github.com/stuinfla/ruvnet-brain/issues/56) (dropped/incomplete Brain command migrations)
- `lib/cwd/patch-library.mjs` (target `init`)
