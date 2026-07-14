# `test/`

`npm test` — three suites, no framework, no dependencies.

| Suite | Covers |
|---|---|
| `sequence-fuzz.mjs` | **Any** sequence of `<target> <action>` leaves the library exactly "pristine + the installed entry set". 60 random sequences × 8 steps, invariants checked after **every** step. |
| `plugin-notify.mjs` | The plugin patches, the notifier, and the monitor's own liveness. |
| `reporting.mjs` | **Every path where a failure could be mistaken for success** — which, for a package that is almost entirely notification paths, is the only thing that matters. |
| `fixtures.mjs` | Where the suites get their **pristine** vendor bytes. |

## Two rules, both learned the hard way

**1. A test that cannot fail is worth nothing.**

Every regression is **mutation-tested**: the guard is removed and the test *confirmed to fail*. That has
now caught three vacuous tests — ones that passed with the guard deleted, and were therefore proving
nothing. Fixing the first exposed a live bug (`restore()` bypassed every guard, making `uninstall` the most
destructive command in the tool). Writing `S3` exposed that `monitor check` **healed the drift on its way
to checking for it**. `V1` caught itself: the gate exits early with no model-router profile, so the sandbox
was allowing everything and every assertion below was passing for the wrong reason.

**2. Never fabricate a baseline.**

`fixtures.mjs` refuses a **patched** vendor file that has no `.rsp-backup`. The old fallback
(`exists(backup) ? backup : file`) quietly adopted a patched file as the pristine baseline on any machine
where the patch was installed and the backup cleaned away — and then the two central invariants asserted
the patch **against itself** and passed.

Paths, npx cache hashes and plugin versions are **discovered, never written down**: the npx hash is
content-addressed and changes whenever the dependency set does.
