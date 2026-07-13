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
#   2. `ruflo memory init --force` — ALWAYS runs. Creates the AgentDB/hybrid
#      memory database (`agentdb.rvf`, `.swarm/memory.db`, `.claude/memory.db`).
#      `--force` is used because it's harmless immediately after a fresh init
#      (nothing real to lose yet) and is sometimes needed to actually complete
#      (see step 3 ordering note).
#   3. If start-all (default ON — see below): `ruflo swarm init` then
#      `ruflo daemon start` (backgrounds itself by default). Kept SEPARATE
#      from step 1's `ruflo init` and run AFTER step 2's memory init, not
#      folded into `ruflo init --start-all`. Confirmed 2026-07-13 by direct
#      test, twice:
#        (a) neither `init --with-embeddings` alone NOR `init --with-embeddings
#            --start-all` creates `agentdb.rvf` — both leave only a baseline
#            `ruvector.db`. `--start-all`'s own "Initializing memory
#            database... ✓ Memory initialized" step is a DIFFERENT, more
#            limited init than the standalone `ruflo memory init` CLI command.
#        (b) once a daemon from `--start-all` is already running against the
#            project, a SUBSEQUENT `ruflo memory init --force` still does not
#            produce `agentdb.rvf` (the daemon appears to hold/own the AgentDB
#            lifecycle at that point) — even though the identical command
#            reliably creates `agentdb.rvf` when run BEFORE any daemon exists.
#      Net effect: memory init must complete before the daemon starts, not
#      folded into the same `ruflo init --start-all` call and not run after.
#   4. Convert to single-source dual via the sibling `ruflo-add-codex.sh` (adds
#      Codex tooling + the merged AGENTS.md canonical / CLAUDE.md=@AGENTS.md model,
#      #2635/#2636/#2637/#2638 all handled there).
#
# start-all is ON BY DEFAULT: it launches ruflo's background DAEMON, which
# runs interval workers that spawn headless sessions and consume tokens
# continuously, plus a swarm. Pass --no-start-all to opt out of the
# daemon/swarm (memory still gets initialized regardless, via step 2 above).
#
# Usage:
#   ruflo-new-dual.sh <project-dir> [--no-start-all] [--template <t>] [--force] [--quiet]
#     <project-dir>  Where to create the project (must be empty or new, unless --force)
#     --no-start-all Skip daemon + swarm auto-start (token-burning daemon; default is ON)
#     --template     Codex skills template: minimal | default  (default: default)
#     --force        Init into a non-empty dir / overwrite existing config
#     --quiet        Less output
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ADD_CODEX="$SCRIPT_DIR/ruflo-add-codex.sh"

PROJECT_DIR=""
START_ALL=1
TEMPLATE="default"
FORCE=0
QUIET=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --start-all)    START_ALL=1; shift ;;   # accepted for back-compat; already the default
    --no-start-all) START_ALL=0; shift ;;
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

say ""
say "Fresh single-source dual project ready: $PROJECT_DIR"
if [[ $START_ALL -eq 1 ]]; then
  say "(daemon + swarm started, memory initialized — pass --no-start-all next time to skip the daemon+swarm)"
else
  say "(daemon/swarm NOT started — memory was still initialized; drop --no-start-all to also launch them)"
fi
