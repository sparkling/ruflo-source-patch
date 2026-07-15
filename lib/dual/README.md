# `lib/dual/`

[← ruflo-source-patch](../../README.md)

The script targets. **These are the only things here that don't patch anything.** They fix *your projects*,
not the library. `install` just materializes them to `~/.ruflo-source-patch/<target>/`; you run them by hand.

## Contents

- [Why `status` byte-compares them](#why-status-byte-compares-them)
- [`dual`](#dual)
- [`dedupe`](#dedupe)

## Why `status` byte-compares them

No patching, no hook, nothing re-applies them. So `status` compares the installed copies against the
packaged ones byte for byte. It used to report `installed` on the entry file merely *existing*, so a copy
that had drifted from the package was indistinguishable from a current one.

## `dual`

One instruction file, two agents.

`ruflo init` writes `CLAUDE.md`. `codex init` writes `AGENTS.md`. They **diverge immediately**
([#2638](https://github.com/ruvnet/ruflo/issues/2638), [#2636](https://github.com/ruvnet/ruflo/issues/2636)).

### The model

One canonical file. No symlinks, no duplication.

- **`AGENTS.md`** is the single source of truth. Codex reads it directly.
- **`CLAUDE.md`** is literally `@AGENTS.md`, plus a short Claude-only overlay.

Edit the shared bulk once; both platforms see it. Each platform's unique bits live only in the file that
platform reads. Nothing to keep in sync, so nothing drifts.

### The scripts

| Script | For |
|---|---|
| `ruflo-new-dual.sh <dir>` | a **fresh** dual project |
| `ruflo-add-codex.sh [dir]` | converting an **existing** ruflo/Claude Code project |

`ruflo-new-dual.sh` uses the **default** `ruflo init` preset (`--with-embeddings`), not `--full`. Note the
default **still bundles** the plugin-duplicated `.claude/{skills,commands,agents}` (~196 files, verified
against `@claude-flow/cli` 3.28.0 on 2026-07-15). `--full` just adds more, and either way `dedupe` is
needed afterward. It also uses `npx --yes` so a missing `@claude-flow/codex` doesn't abort the whole init
([#2635](https://github.com/ruvnet/ruflo/issues/2635)), and gitignores the root `.env` that `ruflo init`
leaves **tracked** ([#2637](https://github.com/ruvnet/ruflo/issues/2637)).

`templates/` holds the `AGENTS.md` / `CLAUDE.md` bodies both scripts write.

## `dedupe`

Delete what the plugins already give you.

**Every** `ruflo init` bundles the `.claude/{skills,commands,agents}` files, default preset included, not
just `--full` (~**196** files on default, ~**260** on `--full`). ~**100%** of the agents and commands and
~**97%** of the skills are **already provided by the installed `ruflo/*` plugins**
([#2640](https://github.com/ruvnet/ruflo/issues/2640)). The project `settings.json` also registers lifecycle
hooks. The ones for events the plugin `hooks.json` also defines (`PreToolUse`, `PostToolUse`, `PreCompact`)
**fire twice** on POSIX, because the plugin's `ruflo-hook.sh` is authoritative and the local copies are only
the Windows-override path ([#2132](https://github.com/ruvnet/ruflo/issues/2132)).

```bash
ruflo-dedupe-bundle.sh <project-dir> [--keep-dup-hooks|--bundle-only] [--dry-run]
```

By **default** it removes the bundle **and** strips the duplicate hooks (EVENT-AWARE: only the events the
plugins actually provide). `--keep-dup-hooks` / `--bundle-only` skip the hook step.

### Conservative by construction

- A bundle item is removed **only when a plugin actually provides it**; project-unique items are kept.
- A hook is stripped **only for events the plugin `hooks.json` also defines**. `UserPromptSubmit` (routing),
  `SessionStart/End`, `Subagent*`, `Notification`, and the auto-memory hooks are **kept** (no plugin replaces them).
- **`.claude/helpers/` is never touched**. `ruflo init` writes all ~43 of them, and no plugin replaces them.
- Bundle removals are backed up first (or rely on git with `--no-backup`).
Start with `--dry-run`.
