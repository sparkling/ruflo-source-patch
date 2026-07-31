# ADR-022: init: stop `ruflo init` generating what the plugins already provide

**Status**: accepted
**Date**: 2026-07-16
**Updated**: 2026-07-31. Ruflo #2777 and #2801 are fixed upstream. Ruflo 3.32.39 /
`ruflo-core` 0.2.6 finally ships a version-bumped strict hook manifest and host-aware PreToolUse
output (PR #2857), and its native read-only status skill closes #2821; the corresponding three
local targets retire on installed behavior. #2640 remains open despite atomic hook-event claims:
the generated bundle and standalone MCP duplication remain. #2854 remains open, so
`plugin-hosts` still supplies dual-host marketplace reconciliation. #2870 proves three current
plugin versions were reused for different source trees. The target now updates every installed,
enabled Ruflo plugin automatically during patch installation/self-update, using host-native commands
and exact refreshed-marketplace comparisons rather than writing either cache itself. Brain 4.0.2
completes #56's discovery/Console scope; focused #76 remains because only the native Codex
`whats-new` skill cannot locate its curated notes from a supported persistent install.
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
- Ruflo v3.32.24 / `@claude-flow/codex` 3.0.2 installs the canonical lifecycle plugin itself.
  Ruflo 3.32.39 / `ruflo-core` 0.2.6 then completed the strict manifest and Codex PreToolUse
  contract in PR #2857. `ruflo-hooks-schema` now retires after probing both real handler branches;
  `ruflo-codex-hooks` remains only a one-shot registration repair for older systems.
- `plugin-hosts` patches Ruflo's existing plugin command layer, not either host cache. Its
  `host-install`, `host-uninstall`, `host-sync`, and `host-update` commands validate exact `*@ruflo` identities,
  delegate through literal argv to `claude plugin` / `codex plugin`, preserve disabled and
  target-only state, and report partial completion as failure. Patch installation and patch-system
  self-update invoke `host-update` automatically: versioned changes use Claude's native update or
  Codex's supported remove/add path only when the installed tree differs from the refreshed source;
  identical copies are no-ops. The same tree proof catches #2870's unchanged-version collisions.
  `host-refresh` remains an explicit, three-identity recovery command. Neither path copies cache
  bytes, changes disabled plugins, follows an unregistered source, or changes Brain's operating plane.
- Ruflo 3.32.39 natively supplies the read-only status surface, so `ruflo-codex-skills` retires.
  `brain-codex-skills` remains as a one-file #76 compatibility target. Brain 4.0.2 natively fixes
  the Console/rvbc workflows and all three aliases. Its `whats-new` skill still searches a checkout
  for notes that are not persisted into the Stable Spine/plugin payload. The target edits only that
  active Codex skill: installed paths first, then the official exact installed Git tag as a docs-only
  fallback. It never uses `latest`, npm/npx, a checkout, or Brain's shared source, updater, immutable
  versions, cache/KB, MCP, hooks, or self-learning runtime.
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
- Upstream: [ruvnet/ruflo#2640](https://github.com/ruvnet/ruflo/issues/2640) (the bundle),
  [#2685](https://github.com/ruvnet/ruflo/issues/2685), [#2777](https://github.com/ruvnet/ruflo/issues/2777),
  [#2801](https://github.com/ruvnet/ruflo/issues/2801), [#2816](https://github.com/ruvnet/ruflo/issues/2816),
  [#2821](https://github.com/ruvnet/ruflo/issues/2821), [PR #2857](https://github.com/ruvnet/ruflo/pull/2857),
  [#2854](https://github.com/ruvnet/ruflo/issues/2854),
  [#2870](https://github.com/ruvnet/ruflo/issues/2870), and
  [stuinfla/ruvnet-brain#56](https://github.com/stuinfla/ruvnet-brain/issues/56),
  [#76](https://github.com/stuinfla/ruvnet-brain/issues/76)
- `lib/cwd/patch-library.mjs` (target `init`)
