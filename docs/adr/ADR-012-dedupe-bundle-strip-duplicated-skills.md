# ADR-012: dedupe-bundle: strip the init bundle that duplicates the installed plugins

**Status**: accepted
**Date**: 2026-07-14
**Updated**: 2026-07-16: dedupe now also reaps a project-local `.mcp.json`'s standalone ruflo/claude-flow MCP server, which the `ruflo-core` plugin already provides (SH4); the SAME registration in `~/.claude.json` `projects[<dir>].mcpServers`, the second channel, keeping non-ruflo and `ssh`-remote servers (SH6); and by DEFAULT SIGTERMs the now-orphaned server process under cleanup's containment discipline (`--keep-server` opts out) (SH5). Same "defer to the plugins" thesis, extended from files/hooks to the MCP registration (both channels) and its running process.
**Deciders**: Henrik Pettersen
**Tags**: script-target, hygiene

## Context

`ruflo init --full` writes roughly 260 skill, command and agent files into the project. They duplicate the
installed `ruflo/*` plugins by 97 to 100 percent.

The cost is not only clutter: duplicated hooks DOUBLE-FIRE, and a project-local copy of a skill shadows the
plugin's own, so a plugin update silently stops taking effect for anything the bundle shadowed.

The same failure shape appears one level up, in `.mcp.json`. `ruflo init` writes a project-local standalone
registration of the ruflo MCP server (keyed `claude-flow` or `ruflo`, `npx … ruflo mcp start`). The
`ruflo-core` plugin ALREADY provides that server (namespaced `mcp__plugin_ruflo-core_ruflo__*`), so under
plugin loading the project registration is a duplicate that spawns a SECOND server against the same project
root: two writers on one `.swarm/memory.db` (#2621, the exact race the `memory` target guards, ADR-006).

There are TWO places that registration can live, and both are cleaned: the project's own `.mcp.json`, and
`~/.claude.json` under `projects[<dir>].mcpServers` (Claude Code's per-project MCP config in the shared global
file). A REMOTE entry there (command `ssh`, e.g. a server on another host) is a real capability, not a local
duplicate, so the global prune matches only a LOCAL `npx` invocation and leaves remotes alone.

## Decision

A script that removes the bundled files which duplicate an installed plugin, and keeps anything
project-unique. Never a blanket delete: a `--dry-run` is the default posture, and a file with no plugin
counterpart is left alone.

It also reaps the duplicate MCP registration, by the SAME "only remove what a plugin provides" rule the
file prune uses: only when the plugin set genuinely ships a ruflo MCP server does it strip the project's
standalone one, matched by COMMAND SIGNATURE not key name (so an unrelated server keyed `ruflo` is never
touched), keeping every other server (`ruv-swarm`, `flow-nexus`), and deleting `.mcp.json` only if it
empties. `--keep-dup-mcp` opts out; `--bundle-only` skips both hooks and MCP. This lives in `dedupe` rather
than a new script or a patch target because it mutates a PROJECT file the way `dedupe` already does, not a
vendor one. The thesis is unchanged: defer to the plugin, remove the duplicate.

Removing the registration leaves the standalone server still RUNNING until the next Claude Code restart, a
second writer on the same `memory.db`. So by default `dedupe` also SIGTERMs it (`--keep-server` opts out):
removing the duplicate but leaving its process running would be a half-measure. This is the only part of
`dedupe` that signals a process, so it carries `cleanup`'s discipline (ADR-013): a candidate is killed only
if it passes BOTH guards, and any doubt spares it. (1) CONTAINMENT: its real, symlink-resolved cwd is the
project root or beneath it. (2) DISTINGUISHABILITY: its env carries a `CLAUDE_FLOW_*` marker from the
REMOVED entry. The plugin server runs the SAME `npx @claude-flow/cli` command (it selects MCP mode by env,
not by an `mcp start` arg), so command matching alone cannot tell them apart; the env marker is the only
honest distinguisher. A removed entry with no distinctive env yields no marker, so nothing is killed and the
report SAYS SO rather than guessing. `--dry-run` names what it would stop and signals nothing; `$HOME` / `/`
are refused.

## Consequences

### Positive

- Hooks stop firing twice.
- A plugin update takes effect, instead of being shadowed by a stale project copy.
- The repo stops carrying hundreds of files nobody wrote.
- The duplicate MCP server is gone, so the project stops running a second writer against its own
  `memory.db`. One command makes a project plugin-only for files, hooks AND MCP.

### Negative

- Deleting project files is inherently destructive, so this is the one script that must never guess. It is
  tested against a project-unique skill, which must survive.
- The MCP prune edits (and may delete) `.mcp.json`, a config file. It is gated on the plugin actually
  providing the server and matched by command signature, and SH4 mutation-tests both the keep-others and
  the "provided?" gate, but it is still a destructive edit backed only by the `.bundle-backup` copy and git.
- Stopping the server is DEFAULT, and it signals a process, the most dangerous act in the toolkit. That
  default is defensible only because it acts solely when it just removed that exact registration, and the
  two guards spare everything else; `--keep-server` and `--dry-run` are the escape hatches. `ps` exposing a
  target's env is what makes the distinguishability guard work. On macOS
  `ps e` shows env for real servers but NOT for a synthetic test process, so the live-kill test (SH5c) runs
  on Linux via `/proc` and is announced-as-skipped on Darwin; the guards were validated by hand against the
  real running server. If a future upstream stopped setting a distinctive `CLAUDE_FLOW_*` env on the
  standalone server, `--stop-server` would correctly refuse to act (no marker) rather than risk the plugin.

### Neutral

- The alternative (init with the default preset rather than `--full`) avoids most of the bundle in the first
  place, and `ruflo-new-dual.sh` does exactly that.

## Links

- Upstream: [ruvnet/ruflo#2640](https://github.com/ruvnet/ruflo/issues/2640), [#2685](https://github.com/ruvnet/ruflo/issues/2685) (the plugin-namespaced server the MCP prune defers to)
- [ADR-006](ADR-006-memory-write-lock-and-wal-coherent-reads.md) (#2621, the two-writers race the MCP prune closes), [ADR-013](ADR-013-cleanup-repair-a-sprawled-project.md) (the process-signaling discipline `--stop-server` reuses)
- [ADR-022](ADR-022-init-stops-generating-plugin-duplicates.md) (the `init` target: the durable complement that stops `ruflo init` regenerating what this removes)
- `lib/dual/ruflo-dedupe-bundle.sh`
