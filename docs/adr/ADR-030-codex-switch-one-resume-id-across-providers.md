# ADR-030: codex-switch: one resume ID, two accounts, no rewritten history

**Status**: accepted
**Date**: 2026-08-18
**Deciders**: Henrik Pettersen
**Tags**: script-target, codex, copilot, provider

## Context

A long-running Codex thread is pinned to the account that created it. Codex offers no way to continue
that exact thread on a different account, meaning either the ChatGPT subscription (`openai`) or a GitHub
Copilot seat reached through a local Copilot-compatible Responses proxy (`copilot`). The thread's
rollout contains provider-private encrypted replay items (`reasoning`, `compaction`,
`context_compaction`), and the other provider rejects them: the visible symptom is a stream that closes
before `response.completed`, not a useful error.

The naive fixes are both wrong. Starting a fresh session on the other account discards the thread.
Rewriting the rollout to "translate" it across the boundary destroys durable history that the user
cannot get back.

This capability was built and proven on `hz` (host `gene`, user `claude`) between 2026-08-07 and
2026-08-08, and has been running there since as `~/.local/bin/codex-switch`. It was never committed. It
exists on exactly one machine, with no test, no ADR, and no way for a second host to acquire it. That is
the drift this ADR closes.

## Decision

Ship it as a **script target**, `codex-switch`. It patches nothing and registers no hook; it operates on
the user's own Codex session state, so it belongs with `dual` and `ruflo-codex-hooks` rather than with
the source patchers.

```bash
npx github:sparkling/ruflo-source-patch codex-switch run status
npx github:sparkling/ruflo-source-patch codex-switch run copilot   # from the project directory
npx github:sparkling/ruflo-source-patch codex-switch run openai
```

The rules it enforces:

- **The UUID never changes.** The same resume ID continues on the other account. The project is pinned
  to its session after first use, so subsequent switches need no `--session`.
- **Only provider-private replay items are removed**, and only at a boundary. A boundary means the
  provider actually changes, or `--force-boundary` is given. Visible messages, tool calls, protected
  assistant-message `encrypted_content` blocks, and the session's own metadata are retained, and the
  retained content is hashed before and after: a mismatch restores the original and aborts.
- **The original bytes survive.** The pre-switch rollout is copied to a backup whose SHA-256 must equal
  the original's before the rewrite is allowed to land; the rewrite itself is a temp-file-plus-rename,
  and a failed post-write verification restores the backup.
- **An active session is never rewritten.** A held writer lock refuses the switch and changes nothing.
- **Encrypted content in an unrecognised location aborts.** The switcher only understands the protocol
  locations it was written against; anything else means "do not touch this file".

Two changes were made to the hz original as part of vendoring it, both because it was written for one
machine and is now shipped to any:

1. **Codex is resolved from `PATH`** (`CODEX_BIN` still overrides). The baked-in
   `/home/claude/.npm-global/bin/codex` had already gone stale on the very host it was written for.
   That host's `codex` now resolves elsewhere, so the constant pointed at a second, older installation.
2. **An undefined Copilot profile is refused, before anything is prepared.** Codex does **not** error on
   an unknown `--profile`; it silently falls back to the default provider. Verified on hz 2026-08-18:
   `codex --profile bogus exec` ran normally against the subscription. Without this gate, a `copilot`
   switch on a host with no profile would rewrite the rollout, launch, bill the **subscription** account
   and report success. The gate accepts either supported shape. One is `~/.codex/<profile>.config.toml`,
   which is what the audited build actually reads; there is no `[profiles.*]` table anywhere in hz's
   Codex config. The other is a `[profiles.<profile>]` table in `~/.codex/config.toml`.

The `copilot` profile itself is shipped as a template, `codex-switch-profile.toml`, not installed: it is
user-level Codex configuration naming a proxy endpoint, and project config cannot redirect providers.
The proxy it points at stays the user's to run: copilot-api, pinned to an exact version, because it
holds credentials and sits between every request and response. On hz it is a user systemd unit,
`copilot-api.service`, on `127.0.0.1:4141`.

## Consequences

### Positive

- The capability exists in more than one place, with an owner, a test suite, and a retirement condition.
- A second host can acquire it in one command instead of by copying an 11KB file out of `~/.local/bin`.
- The fail-open that made a subscription charge look like a Copilot switch is closed.

### Negative

- The switcher understands today's rollout protocol. A Codex release that moves encrypted state to a new
  location will abort rather than corrupt. That is the correct behaviour, but it is a stop, and clearing
  it needs a code change.
- The proxy remains a prerequisite this repo documents but does not install or supervise.

### Retirement

Retire when Codex itself can continue a resume ID across providers. At that point the boundary handling
belongs upstream and this target should be removed, not maintained. Until then it stays, because the
alternative is losing the thread.

## Verification

`test/codex-switch.mjs` (10 behaviours, mutation-tested): the undefined-profile refusal changes no bytes
and launches nothing; both supported profile shapes are accepted; UUID, visible records and protected
blocks survive a switch while the replay item does not; the backup matches the original byte for byte;
Codex is resolved from `PATH` and launched with the profile; the return switch pins
`model_provider="openai"` and never uses a profile; a held writer lock refuses; `--dry-run` touches
nothing; a passthrough `--profile` is refused.

End-to-end on hz, 2026-08-18: `codex --profile copilot exec` against the live proxy logged
`POST /responses 200` with `model: gpt-5.6-sol`, confirming the profile reaches copilot-api rather than
the subscription.
