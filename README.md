# ruflo-source-patch

Patches [ruflo](https://github.com/ruvnet/ruflo) / `@claude-flow/cli`'s
working-directory-anchoring defect ([ruvnet/ruflo#2633](https://github.com/ruvnet/ruflo/issues/2633))
**at its source in the installed npm library** — stopping the `.claude-flow` /
`.swarm` folder and background-daemon proliferation that Claude Code's cwd drift
otherwise causes.

## The problem

`@claude-flow/cli` anchors its state to raw `process.cwd()`. Under Claude Code's
working-directory drift (sub-agents, git worktrees, `cd` in Bash steps), `cwd`
is often a subdirectory rather than the project root — so a fresh `.claude-flow`
folder (and its own background daemon) gets created in every visited directory,
and memory is scattered across stray `.swarm/memory.db` files that nothing reads
back.

## Why patch at the source

Caller-side interception (wrapping the MCP launch, or rewriting `npx ruflo` Bash
commands) can't reach every path — in particular ruflo's own bundled plugin
hooks invoke the CLI with a drifted cwd, and no external interception sees that.
Patching the **callee** fixes every caller at once: the Bash tool, the MCP
server, and the plugin hooks.

Three functions are rewritten to resolve the nearest ancestor `.git` (worktree-safe)
before using cwd:

| Function | File |
|----------|------|
| `ensureDaemonRunning` | `@claude-flow/cli/dist/src/services/daemon-autostart.js` |
| `getMemoryRoot` | `@claude-flow/cli/dist/src/memory/memory-initializer.js` |
| `getProjectCwd` | `@claude-flow/cli-core/dist/src/mcp-tools/types.js` |

## Usage

```bash
# install: patch every @claude-flow/cli copy in the npx cache, and register a
# Claude Code SessionStart hook that re-applies the patch every session (so
# newly npx-fetched copies get patched too)
npx ruflo-source-patch install

# revert every patched file byte-for-byte and remove the hook
npx ruflo-source-patch uninstall

# one-off operations (no hook change)
npx ruflo-source-patch patch
npx ruflo-source-patch revert
npx ruflo-source-patch status
```

`install` copies its runtime to `~/.ruflo-source-patch/` and points the hook
there, so the always-firing hook never depends on the volatile npx cache.

## Safety

- **Reversible** — each file gets a one-time `.rrg-backup`; `uninstall` /
  `revert` restores it byte-for-byte and deletes the backup.
- **Idempotent** — a `/* ruflo-source-patch:patched */` marker means re-runs
  skip already-patched files.
- **Safe-fail on version drift** — each edit's exact anchor string is checked
  before any write; if a future `@claude-flow/cli` version changes the code and
  an anchor is gone, that file is skipped and logged — never a partial or
  corrupt write.
- Only ever writes to the `@claude-flow` packages in the npx cache,
  `~/.claude/settings.json`, and `~/.ruflo-source-patch/`.

## Caveat

This is a **workaround**, not a substitute for the upstream fix. A copy fetched
by `npx` mid-session is unpatched until the next session start (the reapply
point). Remove it with `npx ruflo-source-patch uninstall` once #2633 is fixed
upstream.

## License

MIT
