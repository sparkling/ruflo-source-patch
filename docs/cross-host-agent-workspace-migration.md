# Cross-host agent workspace migration

**Status:** Reusable operational runbook

**Last verified:** 2026-08-06

**Scope:** Ruflo, AgentDB, RVF, RuvNet Brain, Claude Code, OpenAI Codex, repositories, and supporting developer state

## Purpose

This runbook describes how to move an agent-assisted software project from one computer to another without confusing source code, durable memory, session state, credentials, and disposable caches.

The intended outcome is a destination that can continue the project with:

- the exact repository contents that were selected for transfer;
- the required project and user memory;
- restored or deliberately archived agent sessions;
- host-native installations and credentials;
- no accidental replacement of useful destination state; and
- an explicit record of anything omitted.

This is a host migration procedure. The Ruflo command `ruflo migrate` is not a host migration tool. Its current implementation migrates Ruflo V2 project data and configuration to V3.

## Executive summary

Do not copy an entire home directory and call that a migration. Divide the workspace into independent data planes and choose a method for each one.

1. Copy repositories as repositories, including selected ignored and untracked project data when it is genuinely required.
2. Snapshot live SQLite or AgentDB stores with a database-aware facility. Do not copy an active WAL-mode database as one ordinary file.
3. Use logical Ruflo memory export and import when destination memory must be merged. Use a verified database snapshot when the destination is empty and an exact continuation is required.
4. Export important Ruflo sessions separately. A memory export is not a session export.
5. Transfer RVF artifacts separately from JSON memory exports and verify that the destination can open them.
6. Reinstall host-native tools, plugins, models, and caches on the destination.
7. Reauthenticate Claude, Codex, cloud CLIs, package registries, and source hosts. Do not copy authentication databases or keychains.
8. Rewrite absolute paths and replace macOS-specific launch agents with the destination platform's service mechanism.
9. Prove the result with repository hashes, database counts, exact-key memory retrieval, semantic search, session restore, and destination smoke tests.

The practical default is selective migration. In the reference workstation inventory, about 135 GiB of AI-tool state reduced to tens of MiB of essential configuration plus the deliberately selected memories and repositories. Most of the remainder was transcripts, caches, downloaded models, application bundles, and old Brain backups.

## The data planes

Treat each row as a separate migration decision.

| Data plane | Typical locations | Preferred treatment | Why |
| --- | --- | --- | --- |
| Git repository | Project root, including `.git` | Copy or clone, then reconcile local-only files | Git history alone does not contain ignored runtime data or uncommitted work |
| Project Ruflo memory | `<project>/.swarm/memory.db` | Exact snapshot for replacement, logical export for merge | It contains project decisions and embeddings |
| User Ruflo memory | `<user-home>/.claude-flow/user-memory.db` | Exact snapshot for replacement, logical export for merge | It carries reusable lessons across repositories |
| Ruflo sessions | Ruflo session store | Save, export, transfer, and import selected sessions | Sessions can include agents, tasks, and memory snapshots |
| RVF and vector artifacts | Project-specific `.rvf`, manifests, ID maps, or vector databases | Transfer as a coherent file set and verify on destination | Logical memory JSON does not serialize the vector bytes |
| Claude Code configuration | User rules, settings, skills, commands, and hooks | Merge reviewed text configuration | It is portable after path correction |
| Claude Code history | Project transcript trees and native auto-memory | Selectively archive or migrate | It is large, path-slugged, sensitive, and not equivalent to Ruflo memory |
| Codex configuration | `AGENTS.md`, user config, rules, and skills | Merge reviewed text configuration | It is portable after path correction |
| Codex history | Session JSONL and local state databases | Archive selectively | It is large, sensitive, and may contain source-host paths |
| RuvNet Brain | User-level installation, KB, models, settings, lessons, and receipts | Reinstall natively; merge only supported user state | The KB and update plane are managed and reproducible |
| Tool caches | npm cache, npx cache, downloaded models, plugin caches | Rebuild | They are large and often platform-specific |
| Credentials | Keychains, auth JSON, SSH keys, cloud and registry tokens | Reauthenticate or provision new credentials | Copying them is unsafe and often fails across operating systems |
| Local services | Private registries, databases, queues, object stores | Migrate with the service's own backup procedure | Their contents may be authoritative even though they live under the user home |

## Choose the migration mode

### Exact continuation

Use an exact snapshot when the destination store is empty, the source and destination use compatible Ruflo and AgentDB versions, and preserving IDs, timestamps, embeddings, and access metadata matters.

An exact continuation preserves more state, but it must not overwrite an active or useful destination database. Stage the snapshot, verify it, and install it only during a coordinated pause in writes.

### Logical merge

Use logical export and import when the destination already contains useful memory or when database compatibility is uncertain.

The current `ruflo-memory-export/v1` payload contains keys, namespaces, values, timestamps, access counts, an embedding-presence flag, and size metadata. It does not contain the embedding vectors themselves. Import stores the values again and regenerates embeddings. It can therefore preserve knowledge while changing IDs, vector bytes, timestamps, access metadata, or conflict outcomes.

### Archive only

Use archive-only treatment for old transcripts, historical sessions, diagnostic logs, and application support directories that are useful for reference but do not need to become live state on the destination.

Keep archives encrypted, access-controlled, and outside the active runtime directories. Transcripts often contain source, prompts, tool output, paths, and occasionally credentials.

## Phase 1: define the migration contract

Record the following before moving bytes:

- source host, operating system, architecture, user, and canonical home path;
- destination host, operating system, architecture, user, and canonical home path;
- each repository's canonical source and destination paths;
- whether the destination is empty or already in use;
- the required recovery point and acceptable interruption;
- every data plane to copy, merge, rebuild, archive, or omit;
- the installed Ruflo, AgentDB, Claude, Codex, Brain, Node, and package-manager versions;
- the credentials that will be reissued rather than copied; and
- the person responsible for accepting the destination and retaining the source.

Resolve symlinks on both hosts. Record both the friendly path and the canonical path. A path such as `~/source` may be a symlink to a different storage volume, and hardcoded configuration must use the intended destination path.

## Phase 2: inventory without exposing secrets

Inventory names, sizes, counts, modification times, and checksums. Do not print file contents from credential locations.

```bash
SOURCE_USER_HOME=/absolute/source/home
SOURCE_PROJECT=/absolute/source/project

du -sh "$SOURCE_PROJECT" \
  "$SOURCE_USER_HOME/.claude-flow" \
  "$SOURCE_USER_HOME/.claude" \
  "$SOURCE_USER_HOME/.codex" \
  "$SOURCE_USER_HOME/.cache/ruvnet-brain" 2>/dev/null

git -C "$SOURCE_PROJECT" status --short --branch
git -C "$SOURCE_PROJECT" rev-parse HEAD
find "$SOURCE_PROJECT" -type f | wc -l
```

Also inspect, without reading secret values:

- `~/.ssh`, `~/.aws`, `~/.gnupg`, cloud CLI configuration, and keychains;
- `.npmrc` and other package-manager configuration;
- local private registry or package storage;
- user-created scripts in `~/.local/bin`;
- shell and Git configuration with source-host paths;
- launchd, cron, systemd user services, and running daemons; and
- all databases with `-wal` or `-shm` sidecars.

Do not indiscriminately kill daemons. Identify the owner of each process and use its supported pause or stop procedure only when a consistent cutover requires it.

## Phase 3: prepare recovery points

Keep the source unchanged until the destination passes validation. On a used destination, first create a destination-side recovery point for every file or database that may be replaced.

For a Ruflo memory database, use the implemented WAL-safe backup command:

```bash
ruflo memory backup \
  --db /absolute/path/to/memory.db \
  --dir /absolute/path/to/migration-staging/memory-backups \
  --keep 3 \
  --verbose
```

The implementation uses the SQLite online backup API when available. This produces a consistent snapshot while the source database is in WAL mode. The command defaults to `<project>/.swarm/memory.db`, stores snapshots under the database directory's `backups` folder, and keeps the newest seven unless overridden.

Verify that each snapshot exists, is non-empty, and is readable before relying on it. Keep the source snapshot and any destination pre-change snapshot separate.

## Phase 4: transfer the repository

Clone from the canonical Git remote when the repository contains everything needed. Use an exact directory transfer when the migration must also retain uncommitted, untracked, ignored, or local-only files.

Transfer into a new staging directory. Do not use a delete-mirroring option against an established destination during the first pass.

```bash
SOURCE_PROJECT=/absolute/source/project
DESTINATION_HOST=example-host
DESTINATION_STAGE=/absolute/destination/staging/project

rsync -a --info=progress2 \
  "$SOURCE_PROJECT/" \
  "$DESTINATION_HOST:$DESTINATION_STAGE/"
```

Database snapshots should be transferred as snapshots, not by relying on a possibly live database file swept up by the repository copy.

Compare at least:

- Git HEAD, branch, remotes, and worktree status;
- regular-file and symlink counts;
- a checksum manifest for stable files;
- expected ignored and untracked paths; and
- exclusions caused by sockets, device files, extended attributes, or permissions.

macOS extended attributes, Finder metadata, ownership IDs, and some symlink mode details are normally safe to omit when moving to Linux. Record the omissions.

## Phase 5: migrate Ruflo memory

### Project memory

The default project database is `<project>/.swarm/memory.db`. Check configuration before assuming the default. Current path precedence is:

1. the memory command's explicit `--path` option;
2. `CLAUDE_FLOW_DB_PATH` for a full database-file override;
3. `CLAUDE_FLOW_MEMORY_PATH`, the project memory configuration, or the default `<current-project>/.swarm/memory.db`.

For an empty destination, install a verified snapshot during a pause in destination writes. Preserve the destination's pre-change database separately.

For a merge, export and import logically:

```bash
CLAUDE_FLOW_DB_PATH=/absolute/source/project/.swarm/memory.db \
  ruflo memory export -o /absolute/staging/project-memory.json

CLAUDE_FLOW_DB_PATH=/absolute/destination/project/.swarm/memory.db \
  ruflo memory import -i /absolute/staging/project-memory.json --merge
```

### User memory

Apply the same choice to the user-level database. Use its absolute path on both hosts so the operation cannot silently target a project database.

```bash
CLAUDE_FLOW_DB_PATH=/absolute/source/home/.claude-flow/user-memory.db \
  ruflo memory export -o /absolute/staging/user-memory.json

CLAUDE_FLOW_DB_PATH=/absolute/destination/home/.claude-flow/user-memory.db \
  ruflo memory import -i /absolute/staging/user-memory.json --merge
```

Namespace counts, exact keys, and conflict policy must be recorded before and after import. A semantic search result alone is not proof that an exact entry survived.

### Current export limitations

As verified in Ruflo source on 2026-08-06:

- `--include-vectors` is advisory; vectors are not serialized;
- the exported `hasEmbedding` field reports presence, not vector contents;
- import re-embeds values;
- CSV currently falls back to JSON; and
- logical import does not provide an exact database clone.

Recheck `ruflo memory export --help`, the active implementation, and a sample payload when migrating a later version.

## Phase 6: migrate sessions and Claude native memory

Save a named Ruflo checkpoint for work that must resume:

```bash
ruflo session save \
  --name migration-checkpoint \
  --description "Checkpoint before host migration" \
  --include-memory \
  --include-agents \
  --include-tasks

ruflo session list
ruflo session export -o /absolute/staging/ruflo-session.json
```

Transfer the export and import it on the destination:

```bash
ruflo session import /absolute/staging/ruflo-session.json \
  --name migrated-session \
  --activate
```

The session facility serializes the saved session record. It is not the same as Claude Code's conversation transcript store or Codex's JSONL session store. It is also not a substitute for migrating `<project>/.swarm/memory.db`: the implementation inspected on 2026-08-06 loaded session memory from the legacy `.claude-flow/memory/store.json` path.

Use JSON without `--compress` for the verified version. Its CLI source selected a `.gz` suffix without actually compressing the content. Source inspection also found an interface mismatch to test before cutover: the CLI import handler passed parsed `data`, while the MCP import tool expected an `inputPath`. Keep the source session and export until an end-to-end destination import and restore succeeds. Always check the active command help and effective source because session interfaces have changed across Ruflo versions.

Ruflo's `memory_import_claude` MCP tool can ingest Claude Code memory files into AgentDB and regenerate embeddings. That is useful for searchable continuity, but it does not recreate Claude Code's native transcript history or its project-path slug. Preserve native Claude memory separately only when that native behavior is required.

## Phase 7: handle RVF and vector artifacts

Memory JSON export does not include RVF files or embedding vectors. Inventory each project's actual vector artifacts and their companions, which may include:

- `.rvf` data;
- manifest or metadata files;
- ID maps;
- locks that must not be treated as durable content; and
- separate SQLite or RuVector databases.

Transfer a stable, coherent artifact set byte for byte. Do not copy active lock files as authoritative state. Record hashes on both hosts, then open or query the artifact with the destination's supported RuVector or Ruflo interface.

RVF-related documentation describes portable, file-based storage, but a file's existence and matching checksum prove only transfer integrity. Compatibility is proven when the destination implementation can load and query it. Do not infer that an AgentDB SQLite database and an RVF file are interchangeable.

Downloaded embedding models under `~/.ruvector` or cache directories are normally reproducible and should be downloaded for the destination architecture instead of migrated.

## Phase 8: rebuild the host environment

### Ruflo and RuvNet Brain

Install Ruflo, plugins, MCP registrations, and RuvNet Brain through their native installers on the destination. Run the Brain doctor after installation:

```bash
npx github:stuinfla/ruvnet-brain --doctor
```

Do not copy Brain's managed KB, version-selection files, backup generations, downloaded models, or updater state over an existing destination installation. Let Brain's native lifecycle establish the current generation. Review and merge only documented user-owned settings or lessons whose schema is compatible.

Ruflo's `~/.ruflo` and npm or npx trees are predominantly executables, caches, logs, and resolver state. Rebuild them. Do not make a source-host cache the destination's package supply chain.

### Claude Code and Codex

Merge user-authored text configuration, including:

- canonical instruction files;
- settings without credentials;
- user-created skills, rules, commands, hooks, and templates; and
- MCP definitions after replacing source-host paths.

Do not blindly copy plugin caches, native binaries, temporary directories, application support bundles, or model downloads. Install destination-native versions.

Treat Claude and Codex histories as optional sensitive archives. If live history migration is required, test it with a copied subset first. Project paths are encoded in some history directories, and host-native state databases can contain absolute paths and version-specific schemas.

### Other developer services

Audit local package registries before classifying them as caches. A Verdaccio store, for example, may contain unpublished packages and therefore be authoritative. Back it up and restore it with a service-consistent procedure, then compare package names, versions, and package hashes.

Reinstall language runtimes and package-manager caches. Preserve only explicit custom scripts and configuration that cannot be reconstructed.

## Phase 9: credentials and identity

Do not transfer these as ordinary files:

- Claude or Codex authentication JSON;
- macOS Keychain data;
- cloud CLI access-token databases;
- package registry tokens;
- browser profiles or cookies;
- SSH private keys without an explicit key-management decision; or
- secret environment files.

Prefer new destination credentials, hardware-backed keys, workload identity, or a secret manager. Reauthenticate each native client. Verify identity and access without printing tokens or secret values.

If an SSH key must be retained, treat that as a separate security migration with encrypted transport, restrictive permissions, an inventory, and a rotation plan.

## Phase 10: rewrite host-specific configuration

Search reviewed text files for the old home, project, and executable paths:

```bash
OLD_HOME=/absolute/source/home
DESTINATION_PROJECT=/absolute/destination/project

rg -n --hidden --fixed-strings "$OLD_HOME" "$DESTINATION_PROJECT" \
  -g '!node_modules/**' \
  -g '!.git/**'
```

Review every hit. Common corrections include:

- MCP server executable paths;
- memory database paths;
- workspace trust entries;
- script shebangs and local binary paths;
- launchd jobs replaced by systemd user units or cron;
- macOS application paths;
- case-sensitive filename differences; and
- symlink targets.

Do not mechanically rewrite binary databases, transcript archives, or checksums.

## Destination proof

The migration is complete only when the following checks pass.

### Repository proof

- expected Git commit and branch;
- expected dirty-worktree entries;
- stable-file checksum comparison;
- expected ignored and untracked content;
- dependency installation and the project's normal build and test commands; and
- no unexplained source-host paths in active configuration.

### Memory proof

- Ruflo reports the intended absolute database path;
- database and namespace counts match the chosen snapshot or merge contract;
- one unique probe key can be stored and retrieved from that exact path;
- the exact row is confirmed through the approved AgentDB diagnostic boundary;
- representative pre-migration keys return their full expected values;
- semantic search returns representative concepts; and
- the probe is removed after verification.

Use an exact-key check as well as semantic search. Search ranking can miss a healthy row, and a successful command message does not by itself prove that the intended database was written.

### Session and vector proof

- selected sessions appear in `ruflo session list`;
- one imported session restores the expected task, agent, and memory summary;
- transferred RVF or vector artifacts match source hashes;
- the destination opens and queries those artifacts; and
- regenerated embeddings are counted and searchable after logical import.

### Tool and access proof

- Ruflo and Brain diagnostics pass;
- Claude and Codex use native authenticated accounts;
- MCP registrations resolve destination paths;
- Git, package registry, cloud, and deployment access are tested read-only first;
- scheduled services use the destination platform; and
- no source credential files were placed in repository or migration staging.

## Rollback and retention

Retain the source and its snapshots until the destination has been used successfully for an agreed observation period.

Rollback consists of:

1. stopping new writes through the owning application's supported mechanism;
2. moving the failed destination state aside without deleting it;
3. restoring the destination pre-change snapshot or returning work to the source;
4. validating exact keys, repository state, and service health; and
5. recording why cutover failed before another attempt.

Do not use a broad recursive deletion, a home-directory mirror with deletion, or an unreviewed overwrite as a rollback mechanism.

## What remains outside Ruflo migration facilities

After Ruflo memory and session facilities have been used, these user-home items still require an explicit decision:

| Item | Normal decision |
| --- | --- |
| Claude and Codex user-authored configuration | Review, path-correct, and merge |
| Claude and Codex transcript history | Archive or migrate a tested subset |
| Claude native auto-memory | Preserve natively or ingest separately into AgentDB |
| Ruflo neural, policy, metrics, and other non-memory state | Inventory by feature; migrate only documented durable state |
| Brain user settings and validated lessons | Merge only through a compatible supported path |
| Brain KB, versions, backups, models, and updater state | Rebuild through Brain's native lifecycle |
| SSH, cloud, registry, and model-provider credentials | Reissue or reauthenticate |
| Git, shell, editor, and package-manager configuration | Review and merge without secrets |
| User-created scripts | Copy, inspect shebangs and paths, then test |
| Private registry or local service data | Use the service's backup and restore method |
| npm, npx, plugin, model, and application caches | Rebuild |

There is no safe single command for this remainder because it crosses security boundaries, host-native formats, independent products, and potentially authoritative local services.

## Reference inventory from one migration

The 2026-08-06 reference inventory illustrates why selective migration matters. Values are approximate and will drift while tools are running.

| Area | Approximate size | Main contents | Treatment |
| --- | --- | --- | --- |
| Codex home | 73.4 GiB | 69.1 GiB of sessions, temporary plugin data, logs, small portable config | Archive selected sessions; merge config; reinstall runtime |
| Claude home | 8.1 GiB | 5.5 GiB of projects and transcripts, 2.3 GiB of plugins, small native memory | Archive selectively; merge config; reinstall plugins |
| Ruflo user state | 33.5 MiB | user memory, learned patterns, policy state, metrics, backups | Migrate memory; review other durable state |
| Ruflo resolver home | 350 MiB | npx cache and logs | Rebuild |
| RuVector home | 86.7 MiB | downloaded embedding models | Rebuild |
| Brain cache | 34.7 GiB | current KB, many backup generations, models | Reinstall and let native lifecycle rebuild |
| Brain configuration and selected learning | about 1.3 MiB | settings, lessons, evidence, receipts | Review and merge only compatible user state |
| Claude desktop support | 13.7 GiB | VM bundle, browser state, and caches | Do not migrate to a Linux CLI host |
| npm home | 62 GiB | content and npx caches | Rebuild |
| Local shared data | 19 GiB | runtimes plus about 12 GiB of Verdaccio storage | Rebuild runtimes; audit registry as possibly authoritative |

In that case, the essential non-Ruflo portable configuration was roughly 35 to 40 MiB before any selected history archives. The project repositories and their chosen data stores were handled separately.

## Migration manifest template

Create one manifest per migration and store it outside secret-bearing staging.

| Field                                | Value                               |
| ------------------------------------ | ----------------------------------- |
| Migration identifier                 | `<project>-<date>`                  |
| Source host and platform             |                                     |
| Destination host and platform        |                                     |
| Source canonical project path        |                                     |
| Destination canonical project path   |                                     |
| Source Git HEAD and branch           |                                     |
| Destination pre-existing state       | empty, merge, or replace            |
| Project memory mode                  | exact snapshot, logical merge, omit |
| User memory mode                     | exact snapshot, logical merge, omit |
| Sessions selected                    |                                     |
| RVF or vector artifacts selected     |                                     |
| Claude and Codex history policy      | archive, subset, omit               |
| Local services selected              |                                     |
| Credentials to reissue               | names only, never values            |
| Source-host paths to rewrite         |                                     |
| File counts and checksum manifest    |                                     |
| Explicit exclusions                  |                                     |
| Validation results                   |                                     |
| Rollback location and retention date |                                     |
| Approver and cutover time            |                                     |

## Implementation evidence

The Ruflo-specific statements in this runbook were checked against these upstream implementation files on 2026-08-06:

- `ruflo/v3/@claude-flow/cli/src/commands/memory-backup.ts`;
- `ruflo/v3/@claude-flow/cli/src/services/memory-backup.ts`;
- `ruflo/v3/@claude-flow/cli/src/commands/memory.ts`;
- `ruflo/v3/@claude-flow/cli/src/mcp-tools/memory-tools.ts`;
- `ruflo/v3/@claude-flow/cli/src/memory/memory-initializer.ts`;
- `ruflo/v3/@claude-flow/cli/src/commands/session.ts`;
- `ruflo/v3/@claude-flow/cli/src/mcp-tools/session-tools.ts`; and
- `ruflo/v3/@claude-flow/cli/src/commands/migrate.ts`.

The RuvNet Brain installation boundary was checked against `ruvnet-brain/bin/install.mjs`. Recheck the installed command help and effective source before a future migration because interfaces and storage schemas can change.
