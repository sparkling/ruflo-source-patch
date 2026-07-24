# ADR-022: init: stop `ruflo init` generating what the plugins already provide

**Status**: accepted
**Date**: 2026-07-16
**Updated**: 2026-07-25. Third edit added, suppressing the skills.sh registration, which imports the whole `ruvnet/ruflo` repo into `.agents/skills/` (97MB, 384 `SKILL.md`) and exhausts the host agent's skill budget ([#2777](https://github.com/ruvnet/ruflo/issues/2777)). Same principle in a new file (`commands/init.js`), so it belongs to this target rather than a new one.
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

## Decision

Add an `init` patch target to `@claude-flow/cli`, patched at the callee like the other CLI targets, that
disables generation of the plugin-duplicated artifacts. Three files, five edits:

- `init/mcp-generator.js`: disable the standalone `claude-flow` `.mcp.json` emission. The guard
  `if (config.claudeFlow)` occurs three times (config + two add-command branches), so the anchor pins the
  config emission via the unique `createMCPServerEntry` line. `ruv-swarm` / `flow-nexus` are untouched.
- `init/executor.js`: disable the three bundle copy gates (`copySkills` / `copyCommands` / `copyAgents`).
  HELPERS ARE KEPT (init writes all ~43; no plugin replaces them), exactly as `plugin-only` keeps them.
  `settings` / `statusline` / `runtime` / `claudeMd` are untouched.
- `commands/init.js` (added 2026-07-25, [#2777](https://github.com/ruvnet/ruflo/issues/2777)): suppress
  `maybeInstallSkillsSh()`, which runs `npx --yes skills add ruvnet/ruflo --skill ruflo --yes`. Upstream's own
  fix commit (`23abe26b9`) claims it "installs ONLY the platform skill (~1 file)"; measured, it lands **97MB
  and 384 `SKILL.md`**, which is the whole repository. `vercel-labs/skills` copies `dirname(SKILL.md)`
  recursively and ruflo's canonical `SKILL.md` sits at the repo root. Codex then truncates every skill
  description to fit its 2% skills budget, so the project's own skills are degraded to host a copy of ruflo.
  Deleting the import is not a remedy: upstream's idempotency gate keys on `.agents/skills/ruflo` existing, so
  the next `init` re-clones it. Independently, it is an **unpinned `npx --yes` fetch-and-execute** of a
  dependency declared in no `package.json`, with both consent prompts pre-answered. Anchored on the first
  guard inside the `try`, not the function signature, because a signature is one rename from drifting.

The edits are `if (X)` → `if (false && X)` (and, for the skills.sh guard, an unconditional early
`return`), which keeps the referenced symbol used, is a minimal unique
anchor, and reverts to byte-identical on uninstall. It composes into `all` like any patch target, so a
plugin-always machine that installed `all` adopts it on the next tick (ADR-019).

## Consequences

### Positive

- `ruflo init` / `doctor` stop re-adding the duplicates, so `plugin-only` is a one-time cleanup rather than
  a recurring chore. The two are complements: `plugin-only` removes what exists, `init` stops it recurring.
- Verified against real vendor bytes (II1 to II3): the emission and all three bundle gates are disabled,
  helpers stay enabled, both files still parse, and uninstall restores byte-for-byte.

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

## Links

- [ADR-012](ADR-012-dedupe-bundle-strip-duplicated-skills.md) (`plugin-only`, the after-the-fact removal this complements)
- [ADR-018](ADR-018-mcp-prefix-plugin-namespaced-tools.md) (whose "generators out of scope" this revises), [ADR-019](ADR-019-all-mode-adopts-new-targets.md)
- Upstream: [ruvnet/ruflo#2640](https://github.com/ruvnet/ruflo/issues/2640) (the bundle), [#2685](https://github.com/ruvnet/ruflo/issues/2685) (the standalone MCP registration)
- `lib/cwd/patch-library.mjs` (target `init`)
