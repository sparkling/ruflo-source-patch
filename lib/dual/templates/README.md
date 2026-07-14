# `templates/`

[← ruflo-source-patch](../../../README.md)

The instruction-file bodies that [`../ruflo-new-dual.sh`](../ruflo-new-dual.sh) and
[`../ruflo-add-codex.sh`](../ruflo-add-codex.sh) write into a project.

| File | Becomes | Contains |
|---|---|---|
| `AGENTS.md` | the project's `AGENTS.md` | **The single source of truth**, holding every shared instruction. Codex reads it directly; Claude Code imports it. |
| `CLAUDE.md` | the project's `CLAUDE.md` | `@AGENTS.md` (the import), **plus a Claude-Code-only overlay**: SendMessage coordination, model-tier routing, the commit-attribution rule. |

## The whole point is the asymmetry

`CLAUDE.md` must stay thin. Anything that belongs to both platforms goes in `AGENTS.md`, or it will drift,
and that drift is the bug the `dual` target exists to prevent
([#2638](https://github.com/ruvnet/ruflo/issues/2638)).

## What an edit here reaches

Editing these changes what **new** projects get. It does not touch projects already converted.
