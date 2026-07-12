# ruflo-source-patch

[![npm](https://img.shields.io/npm/v/@sparkleideas/ruflo-source-patch.svg)](https://www.npmjs.com/package/@sparkleideas/ruflo-source-patch)

Local workarounds for [ruflo](https://github.com/ruvnet/ruflo) / `@claude-flow/cli`
rough edges, packaged as one CLI with per-**target** subcommands:

```bash
npx @sparkleideas/ruflo-source-patch <target> <action>
```

| Target | What it does | Actions |
|--------|--------------|---------|
| **`cwd`** | Patches `@claude-flow/cli`'s `process.cwd()` anchoring ([ruvnet/ruflo#2633](https://github.com/ruvnet/ruflo/issues/2633)) at source, so `.claude-flow`/`.swarm` folders and daemons stop proliferating under Claude Code working-directory drift. | `install`\|`init` · `uninstall`\|`remove` · `patch` · `revert` · `status` |
| **`dual-codex-claude`** | Installs the single-source dual (Claude Code + Codex) project toolkit — scripts that create/convert a project so `AGENTS.md` is canonical and `CLAUDE.md` = `@AGENTS.md` (no duplication or drift). | `install`\|`init` · `uninstall`\|`remove` · `status` |

> A bare action with no target (`npx … install`) defaults to the **`cwd`** target.

Requirements: Node.js ≥ 18, Claude Code with ruflo / `@claude-flow/cli` used via `npx`.

---

## Target: `cwd` — source patch for the folder/daemon sprawl

`@claude-flow/cli` anchors its state to raw `process.cwd()`. Under Claude Code's
working-directory drift (sub-agents, git worktrees, `cd` inside Bash steps), `cwd`
is frequently a subdirectory rather than the project root — so a fresh
`.claude-flow` folder (and its own background daemon) is created in every visited
directory, and memory is scattered across stray `.swarm/memory.db` files.

Caller-side interception can't reach every path — ruflo's own bundled plugin
hooks invoke the CLI with a drifted cwd. Patching the **callee** fixes every
caller at once. Three functions are rewritten to resolve the nearest ancestor
`.git` (worktree-safe) before using cwd:

| Function | File |
|----------|------|
| `ensureDaemonRunning` | `@claude-flow/cli/dist/src/services/daemon-autostart.js` |
| `getMemoryRoot` | `@claude-flow/cli/dist/src/memory/memory-initializer.js` |
| `getProjectCwd` | `@claude-flow/cli-core/dist/src/mcp-tools/types.js` |

```bash
npx @sparkleideas/ruflo-source-patch cwd install     # or: cwd init
npx @sparkleideas/ruflo-source-patch cwd uninstall   # or: cwd remove
npx @sparkleideas/ruflo-source-patch cwd patch | revert | status
```

`install` patches every `@claude-flow/cli` copy in the npx cache, copies its
runtime to `~/.ruflo-source-patch/lib`, and registers a Claude Code
`SessionStart` hook that re-applies the patch each session (so newly-`npx`-fetched
copies get patched too — same reapply model as `patch-package`).

**Safety:** reversible (per-file `.rsp-backup`, restored byte-for-byte on
`uninstall`/`revert`), idempotent (`/* ruflo-source-patch:patched */` marker),
and safe-fail on version drift (each anchor string is checked before any write;
a moved anchor is skipped, never a partial write).

## Target: `dual-codex-claude` — single-source dual project toolkit

`ruflo init --dual`/`--codex` doesn't produce a working dual Claude Code + Codex
project. This target installs a small toolkit that does:

```bash
npx @sparkleideas/ruflo-source-patch dual-codex-claude install     # copies scripts to ~/.ruflo-source-patch/dual
npx @sparkleideas/ruflo-source-patch dual-codex-claude uninstall   # removes them
```

Installed scripts (run directly against a project):

| Script | Purpose |
|--------|---------|
| `ruflo-add-codex.sh <project>` | Convert an existing ruflo (Claude Code) project into single-source dual |
| `ruflo-new-dual.sh <project>` | Create a fresh single-source dual project |
| `ruflo-dedupe-bundle.sh <project>` | Strip the `.claude` bundle content the installed ruflo plugins already provide |

Design: `AGENTS.md` is the one canonical instruction file (shared content +
Codex-only overlay); `CLAUDE.md` is `@AGENTS.md` (Claude Code's memory import) +
a small Claude-only overlay — no symlink, no duplication, no drift. Related:
ruvnet/ruflo [#2634](https://github.com/ruvnet/ruflo/issues/2634)–[#2638](https://github.com/ruvnet/ruflo/issues/2638),
[#2640](https://github.com/ruvnet/ruflo/issues/2640).

`install` copies the scripts to `~/.ruflo-source-patch/dual/` (marked executable);
`uninstall` removes that directory. No Claude Code hook is registered for this
target — the scripts are run on demand.

---

## Caveat

These are **workarounds**, not substitutes for the upstream fixes. For `cwd`, a
copy fetched by `npx` mid-session is unpatched until the next session start.
Remove everything with the per-target `uninstall`, then delete
`~/.ruflo-source-patch/` to fully clean up.

## License

MIT © sparkling
