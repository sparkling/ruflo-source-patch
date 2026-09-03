# Handover: revalidate the Ruflo and ruvnet-brain dist patches

**Date:** 2026-07-25
**Active repository:** `/Users/henrik/source/ruflo-source-patch`
**Branch at handover:** `main`
**Committed base:** `18d9ca735f5181b9f80e584420ccd7c0d453f41a`
**Remote:** `https://github.com/sparkling/ruflo-source-patch.git`

## Start here

Do not continue from the conclusions in this document as if they were proven.

This work crossed an earlier Claude session and a later Codex session. A substantial
working tree exists, but part of the Codex session initially targeted upstream source
repositories instead of this downstream dist-patch repository. Those upstream changes
were useful as experiments, but they are not the requested deliverable and were never
pushed.

The next session must independently revalidate:

1. the bugs against the actual packed/installed npm artifacts;
2. the intended behavior of the consuming host, not just source-tree strings;
3. every current working-tree change in this repository;
4. the tests by proving the relevant tests fail when their guards are removed; and
5. the final staged diff before committing or pushing.

The governing boundary is:

> We maintain a downstream tool that patches installed npm/plugin files. We do not
> maintain, merge, or push the upstream Ruflo or ruvnet-brain repositories.

## User decisions that are not open questions

- `/Users/henrik/source/ruflo-source-patch` is the active project.
- `/Users/henrik/source/ruflo-patch` is deprecated and is being archived intact under
  `/Users/henrik/source/deprecated/ruflo-patch`.
- The implementation belongs in this repository and must act on installed npm/plugin
  output. An upstream source checkout is evidence and a prototyping surface only.
- The user is not an upstream maintainer and has no authority to push to
  `ruvnet/ruflo` or `stuinfla/ruvnet-brain`.
- Do not push either local upstream prototype branch.
- The user owns the issue reports and asked for their **bodies** to be rewritten.
  Do not append another long comment. Make each body a short maintainer instruction:
  confirmed defect, exact change, and acceptance checks.
- Do not make the maintainer read the audit trail to discover the requested action.
- The earlier instruction `drop 1` excluded token revocation. Do not revive that task.
- Do not sweep generated/runtime files into a commit.

## What this repository actually does

Read `AGENTS.md`, `README.md`, `lib/README.md`, `test/README.md`, and the relevant ADRs
before changing anything.

This package is a zero-dependency Node CLI that:

- discovers installed `@claude-flow/cli` files in npx caches and global npm roots;
- discovers installed `ruflo-adr` and `ruvnet-brain` plugin files;
- patches exact literal anchors in those installed files;
- retains pristine vendor bytes in adjacent `.rsp-backup` files;
- rebuilds shared files from pristine bytes when several targets compose;
- refuses missing or ambiguous anchors rather than guessing;
- copies the executable implementation to `~/.ruflo-source-patch`;
- reapplies installed targets through SessionStart and a scheduled monitor; and
- reports any condition in which a failure could otherwise look like success.

There are three target classes:

| Class | Examples | Mutates | Reapplied by |
|---|---|---|---|
| CLI patch | `cwd`, `daemon`, `memory`, `init` | installed `@claude-flow/cli` | hook + monitor |
| Plugin patch | `adr-index`, `verify-interface`, `design-wall` | installed plugin files | hook + monitor |
| Script target | `dual`, `plugin-only` | a user-selected project | only an explicit run |

The `dual` work below is a script-target change. It is not itself an installed
`@claude-flow/codex` patch. Do not describe it as one.

## Repository rules retrieved from memory

These are process requirements, not proof that the implementation satisfies them:

- Verify host discovery/configuration from the **effective packed artifact**. Source-tree
  presence and binary strings are clues only. Exercise producer to consumer end to end.
- If commands mutate desired state and then write shared vendor files, one fail-closed
  cross-process lock must cover state mutation plus all derived filesystem effects.
- A target retires only on a locally evaluated predicate. An issue being closed is not
  evidence that the installed replacement is present or runnable.
- A green test that cannot fail is a defect. Remove or stub each new guard and confirm
  the corresponding regression test becomes red.
- The primary artifact is the working downstream patch. Test machinery and audit prose
  are supporting evidence, not substitutes for it.

## Git state at handover

The active repository is on `main` at `18d9ca7`. The intended implementation is
**uncommitted**.

### Candidate implementation paths

These paths appear to belong to the current Ruflo/Brain correction. Inspect every diff
before staging; this list is not permission to stage blindly.

```text
AGENTS.md
README.md
bin/cli.mjs
docs/adr/ADR-011-dual-codex-claude-single-source.md
docs/adr/ADR-024-design-wall-scope-to-ruvnet-brains-own-repo.md
lib/cwd/README.md
lib/cwd/commands.mjs
lib/cwd/monitor.mjs
lib/cwd/state.mjs
lib/design-wall/README.md
lib/design-wall/commands.mjs
lib/design-wall/patcher.mjs
lib/dual/README.md
lib/dual/codex-skills/ruflo-memory-search/skill.toml        (deleted)
lib/dual/codex-skills/ruflo-memory-store/skill.toml         (deleted)
lib/dual/codex-skills/ruflo-swarm-init/skill.toml           (deleted)
lib/dual/codex-skills/search-ruvnet/skill.toml               (deleted)
lib/dual/commands.mjs
lib/dual/ruflo-add-codex.sh
lib/dual/templates/AGENTS.md
lib/plugin-registry.mjs
lib/supersede.mjs
test/concurrency.mjs
test/design-wall.mjs
test/monitor-internals.mjs
```

This handover file is also intentional:

```text
docs/handover/2026-07-25-ruflo-brain-dist-patch-revalidation.md
```

### Dirty files that are not part of this change

Preserve these files and do not stage them with the implementation:

```text
.claude/helpers/.helpers-version
.claude/helpers/helpers.manifest.json
.claude/helpers/statusline.cjs
.ruvnet-brain/token-ledger.jsonl
agentdb.rvf.lock
```

`git diff --check` currently reports CRLF/trailing-whitespace noise in the unrelated
`.claude/helpers/statusline.cjs`. Run scoped checks against intended paths rather than
rewriting that user-owned/generated file.

## What the current uncommitted implementation is trying to do

Everything in this section is a proposal awaiting clean revalidation.

### 1. Stop the dual adapter from changing Codex security policy

`lib/dual/ruflo-add-codex.sh` currently wraps
`npx --yes @claude-flow/codex init`.

The proposed wrapper:

- snapshots any existing `.agents/config.toml`,
  `.codex/AGENTS.override.md`, and `.codex/config.toml`;
- runs the adapter;
- restores pre-existing files byte for byte, including under `--force`;
- removes those paths only when they did not exist before the run and the adapter created
  them; and
- uses a trap so interruption still restores the user's files.

Why: adapter releases inspected during the audit generated an inert
`.agents/config.toml`, an undiscovered `.codex/AGENTS.override.md`, and a project
`.codex/config.toml` setting:

```toml
approval_policy = "never"
sandbox_mode = "danger-full-access"
```

Revalidate the exact currently installed adapter before retaining this workaround.
The acceptance condition is byte-for-byte preservation of user-owned policy and absence
of newly created unsupported policy files.

### 2. Remove unsupported `skill.toml` delivery

Commit `18d9ca7` added four `.codex/skills/*/skill.toml` dispatch manifests. The current
working tree deletes them and removes the copy loop.

The earlier audit found that current Codex skill discovery uses `SKILL.md`, not these
dispatch manifests. That finding must be reproduced with current official documentation
and effective host diagnostics. Do not rely solely on binary string counts.

### 3. Use Codex's MCP registry instead of appending TOML

The proposed `dual` fallback uses:

```bash
codex mcp get ruvnet-brain
codex mcp add ruvnet-brain -- node "$BRAIN_MCP"
```

It no longer appends a TOML table directly to Codex's user-global registry. It is explicitly a fallback for an older
ruvnet-brain installation; current ruvnet-brain source intends to own its registration.

Revalidate ownership behavior. A downstream fallback must never overwrite or silently
take ownership of a user-managed registration.

### 4. Serialize state and vendor writes as one mutation

The existing smaller lock protects a single `state.json` read-modify-write. The proposed
outer lock in `lib/cwd/state.mjs` also spans the vendor-file rebuild and backup writes.

The intended behavior is:

- exclusive cross-process creation;
- re-entrant use within one process;
- fail closed on timeout;
- remove only a lock whose token still belongs to this process;
- recover a lock only when its owner is provably dead;
- include monitor and SessionStart reapply paths; and
- leave final state, final vendor bytes, backups, and lock cleanup consistent after
  real concurrent processes.

This was added after a reported race in which state updates serialized but subsequent
shared file and `.rsp-backup` writes did not. Reproduce the failure or construct a
deterministic adversarial test before accepting the implementation.

### 5. Retire the legacy design-wall patch only on local proof

The working tree adds a supersession predicate for ruvnet-brain issue #17.

It looks for every active `design-wall.sh`, verifies upstream's repository-identity
anchors, runs `bash -n`, restores the redundant local edit, and records retirement only
when all active copies pass.

Revalidate the installed script's semantics, not only the four marker strings. The
predicate must remain `unknown` or `live` when any copy is absent, unreadable, malformed,
old, or behaviorally wrong.

## Upstream issue audit

The audit covered these issue reports:

| Issue | Current audit conclusion | Maintainer action the issue body should request |
|---|---|---|
| [ruflo #2765](https://github.com/ruvnet/ruflo/issues/2765) | Mixed report; the dangling references and wrong helper paths were reproduced, but discovery/location claims require host-level proof. | Generate each built-in from one canonical skill definition; keep helper references skill-relative; remove or ship every referenced asset; add a test that resolves every local path in every generated `SKILL.md`. |
| [ruflo #2777](https://github.com/ruvnet/ruflo/issues/2777) | Core bug valid. A root `SKILL.md` makes the installer materialize the repository directory, not one bounded skill payload. | Move the installable Ruflo skill into its own directory, install that bounded directory, pin the installer version, detect the historical whole-repo copy, and require an explicit quarantining repair. |
| [ruvnet-brain #41](https://github.com/stuinfla/ruvnet-brain/issues/41) | The false positive was real. The merged quote masker can create false negatives because shell syntax is not a flat quoted string. | Parse executable command nodes, including compound commands and substitutions; check each invocation independently; fail open for dynamic executable names; retain the unread-interface block for definite tool invocations. |
| [ruvnet-brain #42](https://github.com/stuinfla/ruvnet-brain/issues/42) | Missing Codex MCP registration was valid. The earlier `skill.toml` recommendation was not. | Own only the MCP registration, preserve user-owned entries, and verify the registered server with a real MCP initialize/tools handshake. Do not add unsupported `skill.toml` or hook surfaces. |
| [ruvnet-brain #43](https://github.com/stuinfla/ruvnet-brain/issues/43) | Valid packaging blocker. Source wiring points at `plugin/mcp/server.mjs`, but the npm whitelist omitted it. | Ship exactly the MCP server file in the npm artifact; run installer tests from an unpacked `npm pack`; write server/config atomically; prove initialize plus the required `search_ruvnet` input schema. |

These conclusions are a starting hypothesis. Reproduce each against current artifacts before
editing its body.

### Required issue-edit style

Edit the issue body; do not add another explanatory comment. A suitable body is short:

```markdown
## Confirmed problem

One paragraph naming the observable failure and affected artifact/version.

## Required change

- Exact producer file or package boundary to change.
- Exact ownership/safety constraint.
- Any part of the original proposal that must not be implemented.

## Acceptance

- A focused reproduction that fails before the change.
- An installed/packed-artifact check that passes afterward.
- A preservation or negative check for the dangerous edge case.
```

Do not change labels, milestones, assignees, or issue state without separate authority.

## Local upstream prototypes: research only

Two source-level prototype commits were created in isolated worktrees during the Codex
session. They were not pushed.

### Ruflo

```text
worktree: /Users/henrik/source/.worktrees/ruflo-codex-audit-20260725
branch:   fix/codex-integration-audit-20260725
commit:   81d5a54eca0b937152c7f456ab849707f7590a4e
base:     ruvnet/ruflo main at 26c35b59b
subject:  fix(codex): harden init and canonicalize skills
```

This prototype is useful for inspecting a possible upstream-maintainer implementation of
#2765/#2777 and the unsafe generated Codex files. Do not merge it and do not push it.

### ruvnet-brain

```text
worktree: /Users/henrik/source/.worktrees/brain-codex-audit-20260725
branch:   fix/codex-integration-audit-20260725
commit:   fb0f45d165e06cb4d2ef5ed2a3bc7e5f72f47720
base:     stuinfla/ruvnet-brain main at 4e30900
subject:  fix(codex): verify packaged MCP wiring
```

This prototype is useful for inspecting a possible upstream-maintainer implementation of
#41/#42/#43. Do not merge it and do not push it.

These prototypes must not be used as proof that this downstream package patches an npm
installation correctly.

## Evidence ledger: useful, but not trusted acceptance

No durable machine-readable test receipt was committed. Treat all counts below as claims
to reproduce.

### Downstream repository

The Codex session reported a complete `npm test` pass after the current working-tree
changes. That command runs the parallel suites listed in `scripts/run-tests.sh` and then
the Markdown linter.

Re-run it. In particular, verify:

- `test/concurrency.mjs` CC3 checks final state, final vendor bytes, non-empty backups,
  and outer-lock cleanup;
- `test/monitor-internals.mjs` preserves a sentinel `.codex/config.toml` under
  `dual --force` and rejects newly created unsupported policy files; and
- `test/design-wall.mjs` exercises the shared hook-input parser and the upstream
  replacement behavior before accepting retirement.

### Ruflo source prototype

The upstream-source prototype reportedly passed:

- the Ruflo Codex package suite: 202 total tests;
- a TypeScript build;
- four new CLI repair tests; and
- an `npm pack` inspection containing 70 packaged files and excluding source/tests.

Clarification: 202 was the total suite, not tests created. The Codex suite reportedly
went from 196 to 202 textual test cases, plus four new CLI cases: ten net new Ruflo
regression cases. “70 files” was the tarball content count, not a test count.

This validates only the source prototype. It does not validate this downstream patch.

### ruvnet-brain source prototype

The source prototype reportedly passed:

- 1,696 unit tests;
- 176 integration tests;
- 51 plugin tests; and
- claims/status/version gates, with declared artifact-dependent skips.

Again, this is source-prototype evidence, not downstream installed-artifact acceptance.

## Mandatory revalidation sequence

### Phase 0: establish safety and scope

1. Run `pwd`; it must be `/Users/henrik/source/ruflo-source-patch`.
2. Read `AGENTS.md` in full.
3. Search repository-local `patterns` memory and user-level `user-patterns`.
4. Record `git status --short`, `git diff --name-status`, and the current remote.
5. Confirm no upstream remote will be pushed.
6. Confirm the five unrelated dirty paths above remain outside every staged diff.

### Phase 1: capture real artifacts

Use a fresh temporary directory and isolated home/config roots.

1. Discover the exact installed versions and paths the patcher currently sees.
2. Obtain the exact npm tarballs or `npm pack` outputs for the affected packages.
3. Unpack them and inspect the files in the artifact, not the upstream checkout.
4. For host-discovery claims, consult current official Codex documentation and use
   effective diagnostics where available.
5. Record whether ruvnet-brain's server file exists in the artifact and whether its
   installer points to that exact packaged path.

Do not reuse a patched file as a pristine fixture. If a file has a patch marker but no
valid `.rsp-backup`, stop and reinstall the package instead of guessing.

### Phase 2: reproduce before accepting a workaround

For each issue or policy claim:

1. demonstrate the failure on pristine packed/installed bytes;
2. identify the exact downstream surface that can safely work around it;
3. demonstrate that the current proposed transform changes that behavior;
4. demonstrate the negative/preservation case; and
5. remove the transform or guard and confirm the test becomes red.

If a defect cannot be reproduced on the current artifact, do not silently retain a stale
patch. Either implement a local supersession predicate or remove the candidate change.

### Phase 3: assess whether this working tree is complete

The current working tree clearly addresses:

- unsafe/inert files created during the `dual` script's adapter invocation;
- removal of the unsupported downstream `skill.toml` files;
- safer legacy MCP registration;
- the state-plus-vendor mutation race; and
- local-proof retirement of `design-wall`.

It does **not yet prove** that all of #2765, #2777, #41, #42, and #43 are worked around
for arbitrary installed npm artifacts. In particular:

- `dual` is an explicit project script, not a persistent patch of
  `@claude-flow/codex`;
- suppressing the Ruflo skills installer may contain #2777 but does not automatically
  repair #2765's generated built-in skill assets;
- using a marketplace MCP server as a fallback does not put a missing server into the
  ruvnet-brain npm tarball; and
- the retired `verify-interface` target does not prove every currently distributed
  ruvnet-brain hook has the corrected shell-command semantics.

Decide from current artifacts whether new exact-anchor patch targets are needed. Do not
port the entire upstream source prototype into this repository by reflex.

### Phase 4: execute the downstream acceptance suite

At minimum:

```bash
npm test
npm pack --dry-run
git diff --check -- \
  AGENTS.md README.md bin docs/adr docs/handover lib test
```

Also run focused installed-artifact scenarios in isolated directories for every retained
Ruflo/Brain workaround. The package's ordinary test suite is necessary but is not
sufficient evidence for package-boundary defects.

### Phase 5: commit and publish safely

1. Fetch `origin/main`.
2. Inspect divergence before integrating.
3. Stage only the reviewed implementation paths and this handover.
4. Inspect `git diff --cached --stat`, `--name-status`, and `--check`.
5. Commit on this repository's `main` only after revalidation.
6. Push only `sparkling/ruflo-source-patch`.
7. Leave the local upstream prototype branches unpushed.

### Phase 6: rewrite owned issue bodies

After the downstream commit exists, re-open every issue from GitHub, verify that the user
is the author and can edit it, and replace the body with the concise structure above.

The issue body should tell an upstream maintainer what to change in upstream source. It
may link the downstream workaround as a reproduction or compatibility reference, but it
must not imply that the user can merge an upstream fix.

## Deprecated repository archive

The prior project is deprecated:

```text
old: /Users/henrik/source/ruflo-patch
new: /Users/henrik/source/deprecated/ruflo-patch
head: b03d9ff5b2a485d9c9560487d0a0259b43cd165a
```

It is deliberately moved with its dirty working tree intact. Relevant archived material:

```text
docs/handover/2026-07-25-handover-to-codex.md
docs/reviews/2026-07-25-ruflo-ruvnet-brain-upstream-audit.html
```

The archived handover contains earlier machine/upstream context and the HTML file contains
the long-form audit. They are evidence sources, not the active project and not acceptance
receipts. Do not commit or push from the deprecated repository.

At the time of archival it also contained unrelated modified fixture/package files and
generated `.claude-flow`, `.claude`, `.ruvnet-brain`, AgentDB, and ruvector artifacts.
The archive preserves them; do not interpret them as part of this implementation.

## Definition of done

This programme is done only when all of the following are true:

- every retained bug/workaround is reproduced against a current packed/installed artifact;
- the downstream implementation acts at the correct dist/plugin boundary;
- tests go red when each relevant guard is removed;
- user-owned Codex policy and MCP registrations are preserved;
- concurrent mutations leave correct state, files, backups, and no lock;
- stale targets retire only on local behavioral proof;
- the active repository's complete test and package checks pass;
- the staged diff excludes generated/runtime files;
- only `sparkling/ruflo-source-patch` is pushed; and
- each owned upstream issue body gives the maintainer a short, actionable fix and
  acceptance checklist.
