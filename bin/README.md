# `bin/`

`cli.mjs` — the whole CLI. One file, zero dependencies.

```
npx github:sparkling/ruflo-source-patch <target> <action>
```

**The first argument is the target, the second the action.** There is no `all` and no bare-action default:
an `all` that silently meant "the three patch targets, but not the monitor and not the script targets" was
a lie in the name, and a default that installs things you didn't ask for is worse than typing three words.

## Two things it does before dispatching

**Refreshes the stable copy — but only on *mutating* actions.** `~/.ruflo-source-patch/lib` is what the
SessionStart hook and the monitor actually execute, and it was written only by an `install`, so upgrading
the package changed nothing about what either of them ran.

`status` and `check` are **excluded on purpose**. They exist to tell you what is *true*, and a command that
heals the drift on its way to looking for it can only ever report `none` — the STALE-LIB gate would be
unreachable, a check that cannot fail. **Read-only commands observe; mutating commands repair.**

**Exit codes mean something.** A failed install, a monitor that could not schedule, a `cleanup` that
refused or failed — all exit nonzero. They all used to exit 0.
