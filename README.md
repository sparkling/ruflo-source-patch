# ruflo-source-patch

[![npm](https://img.shields.io/npm/v/@sparkleideas/ruflo-source-patch.svg)](https://www.npmjs.com/package/@sparkleideas/ruflo-source-patch)

Patches [ruflo](https://github.com/ruvnet/ruflo) / `@claude-flow/cli`'s
working-directory-anchoring defect ([ruvnet/ruflo#2633](https://github.com/ruvnet/ruflo/issues/2633))
**at its source in the installed npm library** — stopping the `.claude-flow` /
`.swarm` folder and background-daemon proliferation that Claude Code's
working-directory drift otherwise causes.

## The problem

`@claude-flow/cli` anchors its state to raw `process.cwd()`. Under Claude Code's
working-directory drift (sub-agents, git worktrees, `cd` inside Bash steps), `cwd`
is frequently a subdirectory rather than the project root — so a fresh
`.claude-flow` folder (and its own background daemon) is created in every visited
directory, and memory is scattered across stray `.swarm/memory.db` files that
nothing reads back. On a multi-repo machine this compounds into dozens of stray
folders and daemons.

## Why patch at the source

Caller-side interception (wrapping the MCP-server launch, or rewriting `npx ruflo`
Bash commands) can't reach every path — in particular ruflo's own bundled plugin
hooks (`plugins/ruflo-core/hooks/hooks.json` → `ruflo-hook.sh`) invoke the CLI
with a drifted cwd, and no interception outside `@claude-flow/cli` can see that.

Patching the **callee** fixes every caller at once — the Bash tool, the MCP
server, and the plugin hooks. Three functions are rewritten to resolve the
nearest ancestor `.git` (worktree-safe) before using cwd:

| Function | File |
|----------|------|
| `ensureDaemonRunning` | `@claude-flow/cli/dist/src/services/daemon-autostart.js` |
| `getMemoryRoot` | `@claude-flow/cli/dist/src/memory/memory-initializer.js` |
| `getProjectCwd` | `@claude-flow/cli-core/dist/src/mcp-tools/types.js` |

## Requirements

- Node.js ≥ 18
- [Claude Code](https://claude.com/claude-code) with ruflo / `@claude-flow/cli`
  used via `npx`

## Usage

```bash
# install: patch every @claude-flow/cli copy in the npx cache, and register a
# Claude Code SessionStart hook that re-applies the patch every session (so
# newly npx-fetched copies get patched too).  `init` is an alias for `install`.
npx @sparkleideas/ruflo-source-patch install
npx @sparkleideas/ruflo-source-patch init        # same thing

# revert every patched file byte-for-byte and remove the hook (`remove` = alias)
npx @sparkleideas/ruflo-source-patch uninstall

# one-off operations (no hook change)
npx @sparkleideas/ruflo-source-patch patch
npx @sparkleideas/ruflo-source-patch revert
npx @sparkleideas/ruflo-source-patch status
```

`install` copies its runtime to `~/.ruflo-source-patch/` and points the
SessionStart hook there, so the always-firing hook never depends on the volatile
npx cache. Installing from a private registry / mirror? Add
`--registry <url>` to the `npx` command.

## How it stays applied

The npx cache is volatile — `npx` fetches new copies on version/tag changes, and
`npm cache clean` wipes them. The `SessionStart` hook re-runs the patcher
(silently) on every session start, so any newly-fetched copy gets patched. This
is the same reapply model as `patch-package`, triggered by session start rather
than `npm install`.

## Safety

- **Reversible** — each file gets a one-time `.rrg-backup`; `uninstall` /
  `revert` restores it byte-for-byte and deletes the backup.
- **Idempotent** — a `/* ruflo-source-patch:patched */` marker means re-runs skip
  already-patched files.
- **Safe-fail on version drift** — each edit's exact anchor string is checked
  before any write; if a future `@claude-flow/cli` version changes the code and
  an anchor is gone, that file is skipped and logged — never a partial or corrupt
  write.
- Only ever writes to the `@claude-flow` packages in the npx cache,
  `~/.claude/settings.json`, and `~/.ruflo-source-patch/`.

## Caveat

This is a **workaround**, not a substitute for the upstream fix. A copy fetched
by `npx` mid-session is unpatched until the next session start (the reapply
point). Remove it with `npx @sparkleideas/ruflo-source-patch uninstall` once
[#2633](https://github.com/ruvnet/ruflo/issues/2633) is fixed upstream.

## License

MIT © sparkling
