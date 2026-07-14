# `lib/dual/` — the script targets

[← ruflo-source-patch](../../README.md)

**These are the only things here that don't patch anything.** They fix *your projects*, not the library.
`install` just materializes them to `~/.ruflo-source-patch/<target>/`; you run them by hand.

No patching, no hook, nothing re-applies them — which is exactly why `status` **byte-compares** the
installed copies against the packaged ones. It used to report `installed` on the entry file merely
*existing*, so a copy that had drifted from the package was indistinguishable from a current one.

## `dual` — one instruction file, two agents

`ruflo init` writes `CLAUDE.md`. `codex init` writes `AGENTS.md`. They **diverge immediately**
([#2638](https://github.com/ruvnet/ruflo/issues/2638), [#2636](https://github.com/ruvnet/ruflo/issues/2636)).

The model is **one canonical file, no symlinks, no duplication**:

- **`AGENTS.md`** — the single source of truth. Codex reads it directly.
- **`CLAUDE.md`** — literally `@AGENTS.md`, plus a short Claude-only overlay.

Edit the shared bulk once; both platforms see it. Each platform's unique bits live only in the file that
platform reads. Nothing to keep in sync, so nothing drifts.

| Script | For |
|---|---|
| `ruflo-new-dual.sh <dir>` | a **fresh** dual project |
| `ruflo-add-codex.sh [dir]` | converting an **existing** ruflo/Claude Code project |

`ruflo-new-dual.sh` uses the **default** `ruflo init` preset deliberately — not `--full`, which bundles the
~260 duplicate files `dedupe` exists to remove. It also uses `npx --yes` so a missing `@claude-flow/codex`
doesn't abort the whole init ([#2635](https://github.com/ruvnet/ruflo/issues/2635)), and gitignores the
root `.env` that `ruflo init` leaves **tracked** ([#2637](https://github.com/ruvnet/ruflo/issues/2637)).

`templates/` holds the `AGENTS.md` / `CLAUDE.md` bodies both scripts write.

## `dedupe` — delete what the plugins already give you

`ruflo init --full` bundles ~**260** skill/command/agent files. ~**100%** of the agents and commands and
~**97%** of the skills are **already provided by the installed `ruflo/*` plugins**
([#2640](https://github.com/ruvnet/ruflo/issues/2640)). The project `settings.json` also registers hooks
that duplicate the plugin hooks, so `post-edit` and `session-end` **fire twice**.

```bash
ruflo-dedupe-bundle.sh <project-dir> [--strip-dup-hooks] [--dry-run]
```

**Conservative by construction:** an item is removed **only when a plugin actually provides it**, so
anything project-unique is kept. Everything removed is backed up first. `--strip-dup-hooks` is opt-in
because it edits `settings.json`. Start with `--dry-run`.
