#!/usr/bin/env bash
#
# ruflo-new-dual.sh — Create a FRESH single-source dual (Claude Code + Codex)
# ruflo project from scratch.
#
# Four steps, in this order deliberately:
#   1. `ruflo init --with-embeddings`  (the Claude Code side: .claude/,
#      .mcp.json, embeddings). Uses the DEFAULT preset, NOT --full: --full
#      bundles ~260 skill/command/agent files that 97-100% DUPLICATE the
#      installed ruflo/* plugins and double-fire hooks (ruvnet/ruflo#2640).
#      The default preset is leaner. To strip the remaining plugin-duplicated
#      bundle, run the sibling `ruflo-dedupe-bundle.sh` afterward. Never pass
#      --start-all to this step — see step 3 for why.
#   2. `ruflo memory init --force` — ALWAYS runs. Creates the memory database and
#      the HNSW index (`.swarm/memory.db`, `.claude/memory.db`, `ruvector.db`).
#      `--force` is harmless immediately after a fresh init (nothing real to lose).
#
#      NOTE, corrected 2026-07-14 against @claude-flow/cli 3.29.0. This used to
#      claim `memory init` creates `agentdb.rvf`, and built an elaborate ordering
#      rule around that file. TWO THINGS WERE WRONG WITH THAT.
#
#      1. 3.29.0 does not create `agentdb.rvf` at all. Verified clean-room: fresh
#         project, no daemon alive, `memory init --force` -> no `.rvf` anywhere.
#      2. MORE IMPORTANTLY, ITS PRESENCE NEVER PROVED ANYTHING. Older CLIs did
#         write one, and every such file on this machine is 162 BYTES: the `SFVR`
#         magic header, a version, and nothing else. Byte-identical across every
#         project. An empty stub. It would sit there looking like success whether
#         memory worked or not, while the real store (`.swarm/memory.db`, tens of
#         MB) lived elsewhere entirely.
#
#      That is the exact failure this package exists to hunt: a check whose
#      success condition has no relationship to the thing it claims to verify.
#
#      VERIFY MEMORY BY EXERCISING IT, NOT BY LOOKING FOR A FILE:
#        ruflo memory store --key probe --value hello --namespace patterns
#        ruflo memory search --query hello --namespace patterns      # must return it
#      A store/search round-trip is the only thing that proves memory works.
#   3. If start-all (default ON): `ruflo swarm init` then `ruflo daemon start`
#      (backgrounds itself). Kept SEPARATE from step 1's `ruflo init` and run
#      AFTER step 2's memory init. The ordering is retained deliberately: memory
#      init before the daemon is harmless, and a daemon that owns the memory
#      lifecycle before init has run is a race we have no reason to invite.
#   4. Convert to single-source dual via the sibling `ruflo-add-codex.sh` (adds
#      Codex tooling + the merged AGENTS.md canonical / CLAUDE.md=@AGENTS.md model,
#      #2635/#2636/#2637/#2638 all handled there).
#   5. Sweep the plugin-duplicated bundle via `ruflo-dedupe-bundle.sh` (ON by default,
#      --no-dedupe to skip). `ruflo init` writes plugin-covered HOOK entries even when the
#      `init` patch target is applied — that target scopes itself to the .mcp.json server and
#      the skills/commands/agents bundle — so without this step a FRESH scaffold ships hooks
#      that double-fire against the plugins' own hooks.json (#2640). This used to be a sentence
#      in this comment block telling you to run it yourself, which is not a step, it is a hope.
#
# start-all is ON BY DEFAULT: it launches ruflo's background DAEMON, which
# runs interval workers that spawn headless sessions and consume tokens
# continuously, plus a swarm. Pass --no-start-all to opt out of the
# daemon/swarm (memory still gets initialized regardless, via step 2 above).
#
# Usage:
#   ruflo-new-dual.sh <project-dir> [--no-start-all] [--no-dedupe] [--template <t>] [--force] [--quiet]
#     <project-dir>  Where to create the project (must be empty or new, unless --force)
#     --no-start-all Skip daemon + swarm auto-start (token-burning daemon; default is ON)
#     --no-dedupe    Skip step 5's plugin-duplication sweep (default is ON — see step 5)
#     --template     Codex skills template: minimal | default  (default: default)
#     --force        Init into a non-empty dir / overwrite existing config
#     --quiet        Less output
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ADD_CODEX="$SCRIPT_DIR/ruflo-add-codex.sh"
# Step 5 (see header). TWO layouts, both real, so resolve rather than assume: in-repo the dedupe
# script is a SIBLING in lib/dual/, but `install` materializes the two targets into SEPARATE dirs
# (~/.ruflo-source-patch/dual/ and .../dedupe-bundle/). Hard-coding either one silently disables
# step 5 in the other layout — the same class of miss as anchoring on one spelling of a fix.
DEDUPE=""
for _c in "$SCRIPT_DIR/ruflo-dedupe-bundle.sh" "$SCRIPT_DIR/../dedupe-bundle/ruflo-dedupe-bundle.sh"; do
  [[ -f "$_c" ]] && { DEDUPE="$_c"; break; }
done

PROJECT_DIR=""
START_ALL=1
DEDUPE_ON=1
TEMPLATE="default"
FORCE=0
QUIET=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --start-all)    START_ALL=1; shift ;;   # accepted for back-compat; already the default
    --no-start-all) START_ALL=0; shift ;;
    --dedupe)       DEDUPE_ON=1; shift ;;   # accepted for symmetry; already the default
    --no-dedupe)    DEDUPE_ON=0; shift ;;
    --template)     TEMPLATE="${2:?--template needs a value}"; shift 2 ;;
    --force)        FORCE=1; shift ;;
    --quiet)        QUIET="--quiet"; shift ;;
    -h|--help)      sed -n '2,45p' "$0"; exit 0 ;;
    -*)             echo "Unknown option: $1" >&2; exit 2 ;;
    *)              PROJECT_DIR="$1"; shift ;;
  esac
done

say() { [[ -z "$QUIET" ]] && echo "$@" || true; }
die() { echo "error: $*" >&2; exit 1; }

# ---- preflight --------------------------------------------------------------
[[ -n "$PROJECT_DIR" ]] || die "usage: ruflo-new-dual.sh <project-dir> [--no-start-all] [--template <t>] [--force] [--quiet]"
command -v npx >/dev/null 2>&1 || die "npx not found (need Node.js 20+)"
[[ -f "$ADD_CODEX" ]] || die "sibling script not found: $ADD_CODEX"

# Refuse to init into a non-empty existing dir unless --force.
if [[ -e "$PROJECT_DIR" ]]; then
  [[ -d "$PROJECT_DIR" ]] || die "$PROJECT_DIR exists and is not a directory."
  if [[ -n "$(ls -A "$PROJECT_DIR" 2>/dev/null)" && $FORCE -eq 0 ]]; then
    die "$PROJECT_DIR is not empty. Use --force to init here anyway, or pick a new path."
  fi
else
  mkdir -p "$PROJECT_DIR"
fi
PROJECT_DIR="$(cd "$PROJECT_DIR" && pwd)"

# ---- 1. ruflo init (Claude Code side) — NEVER pass --start-all here ---------
INIT_FLAGS=(--with-embeddings)   # default preset, NOT --full (see #2640)
[[ $FORCE -eq 1 ]] && INIT_FLAGS+=(--force)
say "==> ruflo init ${INIT_FLAGS[*]}   (in $PROJECT_DIR)"
if ! ( cd "$PROJECT_DIR" && npx --yes ruflo init "${INIT_FLAGS[@]}" $QUIET ); then
  die "ruflo init failed. See output above."
fi

# ---- 2. ruflo memory init --force (always, BEFORE any daemon exists) -------
say "==> ruflo memory init --force   (in $PROJECT_DIR)"
if ! ( cd "$PROJECT_DIR" && npx --yes ruflo memory init --force $QUIET ); then
  die "ruflo memory init failed. See output above."
fi

# ---- 3. swarm + daemon (opt-out via --no-start-all), AFTER memory init -----
if [[ $START_ALL -eq 1 ]]; then
  say "==> ruflo swarm init   (in $PROJECT_DIR)"
  if ! ( cd "$PROJECT_DIR" && npx --yes ruflo swarm init $QUIET ); then
    die "ruflo swarm init failed. See output above."
  fi
  say "==> ruflo daemon start   (in $PROJECT_DIR)"
  if ! ( cd "$PROJECT_DIR" && npx --yes ruflo daemon start $QUIET ); then
    die "ruflo daemon start failed. See output above."
  fi
fi

# ---- 4. convert to single-source dual (reuses the sibling script) ----------
CONV_FLAGS=(--template "$TEMPLATE")
[[ $FORCE -eq 1 ]]  && CONV_FLAGS+=(--force)
[[ -n "$QUIET" ]]   && CONV_FLAGS+=(--quiet)
say "==> converting to single-source dual (Codex + merged templates)"
"$ADD_CODEX" "$PROJECT_DIR" "${CONV_FLAGS[@]}"

# ---- 5. sweep the plugin-duplicated bundle (#2640) --------------------------
# This used to be a SENTENCE IN A COMMENT — "run the sibling ruflo-dedupe-bundle.sh afterward" —
# which is not a step, it is a hope. A script whose entire job is "produce a correct fresh dual
# project" cannot knowingly leave duplication behind and document the remedy where no user will
# read it: `ruflo init` still writes plugin-covered HOOK entries even with the `init` patch applied
# (that target scopes itself to the .mcp.json server and the skills/commands/agents bundle), so a
# fresh scaffold double-fired every one of them against the plugins' own hooks.json. Default ON,
# --no-dedupe to opt out: on a project this script created seconds ago there is nothing of the
# user's to lose, and the sweep keeps routing/session/subagent/auto-memory hooks regardless.
if [[ $DEDUPE_ON -eq 1 ]]; then
  if [[ -n "$DEDUPE" ]]; then
    say "==> sweeping plugin-duplicated bundle entries (#2640)"
    DD_FLAGS=(); [[ -n "$QUIET" ]] && DD_FLAGS+=(--quiet)
    # Non-fatal: the project is already usable, and a failed sweep must not read as a failed scaffold.
    bash "$DEDUPE" "$PROJECT_DIR" "${DD_FLAGS[@]}" || say "warning: dedupe sweep failed — project is usable; run \`plugin-only run $PROJECT_DIR\` by hand"
  else
    say "warning: dedupe script not found next to $SCRIPT_DIR — run \`ruflo-source-patch plugin-only run $PROJECT_DIR\` to strip plugin-duplicated hooks"
  fi
fi

say ""
say "Fresh single-source dual project ready: $PROJECT_DIR"
if [[ $START_ALL -eq 1 ]]; then
  say "(daemon + swarm started, memory initialized — pass --no-start-all next time to skip the daemon+swarm)"
else
  say "(daemon/swarm NOT started — memory was still initialized; drop --no-start-all to also launch them)"
fi
