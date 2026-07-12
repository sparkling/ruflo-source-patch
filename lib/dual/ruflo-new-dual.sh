#!/usr/bin/env bash
#
# ruflo-new-dual.sh — Create a FRESH single-source dual (Claude Code + Codex)
# ruflo project from scratch.
#
# Two steps:
#   1. `ruflo init --with-embeddings [--start-all]`  (the Claude Code side:
#      .claude/, .mcp.json, embeddings). Uses the DEFAULT preset, NOT --full:
#      --full bundles ~260 skill/command/agent files that 97-100% DUPLICATE the
#      installed ruflo/* plugins and double-fire hooks (ruvnet/ruflo#2640). The
#      default preset is leaner. To strip the remaining plugin-duplicated bundle,
#      run the sibling `ruflo-dedupe-bundle.sh` afterward.
#   2. Convert to single-source dual via the sibling `ruflo-add-codex.sh` (adds
#      Codex tooling + the merged AGENTS.md canonical / CLAUDE.md=@AGENTS.md model,
#      #2635/#2636/#2637/#2638 all handled there).
#
# --start-all is OPT-IN (default OFF): it launches ruflo's background DAEMON, which
# runs interval workers that spawn headless sessions and consume tokens continuously.
# Pass --start-all to include it (memory + swarm + daemon). Without it, the project
# is fully set up; start services on demand.
#
# Usage:
#   ruflo-new-dual.sh <project-dir> [--start-all] [--template <t>] [--force] [--quiet]
#     <project-dir>  Where to create the project (must be empty or new, unless --force)
#     --start-all    Also start daemon + memory + swarm (token-burning daemon; opt-in)
#     --template     Codex skills template: minimal | default  (default: default)
#     --force        Init into a non-empty dir / overwrite existing config
#     --quiet        Less output
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ADD_CODEX="$SCRIPT_DIR/ruflo-add-codex.sh"

PROJECT_DIR=""
START_ALL=0
TEMPLATE="default"
FORCE=0
QUIET=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --start-all) START_ALL=1; shift ;;
    --template)  TEMPLATE="${2:?--template needs a value}"; shift 2 ;;
    --force)     FORCE=1; shift ;;
    --quiet)     QUIET="--quiet"; shift ;;
    -h|--help)   sed -n '2,33p' "$0"; exit 0 ;;
    -*)          echo "Unknown option: $1" >&2; exit 2 ;;
    *)           PROJECT_DIR="$1"; shift ;;
  esac
done

say() { [[ -z "$QUIET" ]] && echo "$@" || true; }
die() { echo "error: $*" >&2; exit 1; }

# ---- preflight --------------------------------------------------------------
[[ -n "$PROJECT_DIR" ]] || die "usage: ruflo-new-dual.sh <project-dir> [--start-all] [--template <t>] [--force] [--quiet]"
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

# ---- 1. ruflo init (Claude Code side) ---------------------------------------
INIT_FLAGS=(--with-embeddings)   # default preset, NOT --full (see #2640)
[[ $START_ALL -eq 1 ]] && INIT_FLAGS+=(--start-all)
[[ $FORCE -eq 1 ]]     && INIT_FLAGS+=(--force)
say "==> ruflo init ${INIT_FLAGS[*]}   (in $PROJECT_DIR)"
if ! ( cd "$PROJECT_DIR" && npx --yes ruflo init "${INIT_FLAGS[@]}" $QUIET ); then
  die "ruflo init failed. See output above."
fi

# ---- 2. convert to single-source dual (reuses the sibling script) -----------
CONV_FLAGS=(--template "$TEMPLATE")
[[ $FORCE -eq 1 ]]  && CONV_FLAGS+=(--force)
[[ -n "$QUIET" ]]   && CONV_FLAGS+=(--quiet)
say "==> converting to single-source dual (Codex + merged templates)"
"$ADD_CODEX" "$PROJECT_DIR" "${CONV_FLAGS[@]}"

say ""
say "Fresh single-source dual project ready: $PROJECT_DIR"
[[ $START_ALL -eq 0 ]] && say "(daemon NOT started — pass --start-all to launch daemon+memory+swarm)"
