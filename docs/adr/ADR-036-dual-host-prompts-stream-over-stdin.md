# ADR-036: Dual-host prompts stream over stdin

**Status**: Implemented

**Date**: 2026-09-08

**Authors**: ruflo-source-patch maintainers

**Related**: ADR-020, ADR-035

## Context

RuvNet Brain 4.3.11 builds each dual-host stage prompt by serializing its full payload. Proposal prompts
are normally small enough for argv. Cross-critique includes the other host's complete proposal, so a
detailed planning artifact can exceed Linux `MAX_ARG_STRLEN`.

On the affected Hetzner host, `ARG_MAX` is 2,097,152 bytes and the page size is 4,096 bytes. Linux caps
one argument at 32 pages, approximately 131,072 bytes. The coordinator placed the complete prompt in one
positional argument for both Claude and Codex. `spawn()` therefore failed with `E2BIG` before critique,
synthesis, verification, or receipt generation.

[Brain issue #273](https://github.com/stuinfla/ruvnet-brain/issues/273) records the upstream defect and
acceptance contract.

## Decision

Add the composed, monitored `brain-dual-host-stdin` target for the persistent runtime and deployed helper.
The target:

- removes the positional prompt from Claude and Codex argv;
- changes child stdin from ignored to piped;
- writes the complete UTF-8 prompt to stdin and closes it;
- retains Claude's plan mode, read-only tool list, high effort, and non-persistent session;
- retains Codex's ephemeral read-only JSON execution, model, and reasoning effort;
- preserves subscription-only environment filtering, cwd, stdout/stderr parsing, and truthful failure; and
- never truncates the artifact or writes a plaintext prompt file.

The target composes with ADR-035's receipt-boundary patch from one pristine vendor backup. Each target can
be installed or removed independently without overwriting the other's changes.

## Consequences

- Prompt size is bounded by the native host/model input limits rather than the operating system's argv
  representation limit.
- Full proposals reach cross-critique; evidence is not silently summarized or discarded.
- Prompt content no longer appears in process argv inspection.
- A stdin stream error remains a host failure and cannot be reported as a successful deliberation.
- No Brain updater, version selection, authentication, model execution policy, database, or WAL is changed.

## Verification and retirement

The executable regression sends a 300 KiB proposal through fake Claude and Codex subscription CLIs. Each
returns the byte length, SHA-256 digest, and argv. The test requires an exact stdin digest, proves no prompt
fragment appears in argv, checks atomic two-copy composition and CLI status, then restores vendor bytes.

Retire only when a marker-free active helper passes the same >256 KiB test on Linux and preserves the full
dual-host protocol and both host security boundaries.
