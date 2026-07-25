#!/usr/bin/env bash
#
# ruflo-add-codex.sh — Convert an EXISTING ruflo (Claude Code) project into a
# dual Claude Code + Codex project with a SINGLE SOURCE OF TRUTH (no symlinks,
# no duplicated/divergent instruction files).
#
# Model (see ruvnet/ruflo#2636, #2638):
#   AGENTS.md  = the ONE canonical instruction file (shared bulk + Codex-specific
#                notes). Codex reads it directly.
#   CLAUDE.md  = `@AGENTS.md` (Claude Code imports the shared bulk) + a small
#                Claude-Code-only overlay (SendMessage coordination, model-tier
#                routing, commit-attribution rule, Claude MCP setup).
#   -> Shared instructions live ONCE (AGENTS.md). Edit them there; both platforms
#      see the change. No drift. Each platform's unique bits live in the file only
#      it reads.
#
# Also handled:
#   * Missing @claude-flow/codex package (#2635): uses the audited
#     `npx --yes @claude-flow/codex@3.0.1`, which fetches on demand.
#   * Codex stub skills (#2634): default template only.
#   * User-owned Codex policy and MCP registrations are preserved; adapter
#     `.gitignore` edits are stripped before our narrow, marker-owned rules.
#
# NOTE (global side effect): after the adapter finishes, this script uses Codex's
# own MCP registry to add `ruflo` only when that exact entry is absent. The
# adapter never sees the real `codex` executable, so it cannot overwrite or
# remove a user-managed registration, including under --force.
#
# Revalidated against packed @claude-flow/cli@3.32.9 / @claude-flow/codex@3.0.1.
#
# Usage:
#   ruflo-add-codex.sh [PROJECT_DIR] [--template <t>] [--force] [--quiet]
#     PROJECT_DIR   Target project (default: current directory)
#     --template    Codex skills template: minimal | default  (default: default)
#                   'full'/'enterprise' emit ~100 stub skills (#2634) — avoid.
#     --force       Re-run even if AGENTS.md/CLAUDE.md already look converted
#     --quiet       Less output
#
# The existing CLAUDE.md (and AGENTS.md, if any) are backed up to *.bak before
# being replaced with the single-source versions.
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TPL_DIR="$SCRIPT_DIR/templates"

PROJECT_DIR="."
TEMPLATE="default"
FORCE=0
QUIET=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --template) TEMPLATE="${2:?--template needs a value}"; shift 2 ;;
    --force)    FORCE=1; shift ;;
    --quiet)    QUIET="--quiet"; shift ;;
    -h|--help)  sed -n '2,45p' "$0"; exit 0 ;;
    -*)         echo "Unknown option: $1" >&2; exit 2 ;;
    *)          PROJECT_DIR="$1"; shift ;;
  esac
done

say() { [[ -z "$QUIET" ]] && echo "$@" || true; }
die() { echo "error: $*" >&2; exit 1; }

# ---- preflight --------------------------------------------------------------
command -v npx >/dev/null 2>&1 || die "npx not found (need Node.js 20+)"
[[ -f "$TPL_DIR/AGENTS.md" && -f "$TPL_DIR/CLAUDE.md" ]] || die "templates not found in $TPL_DIR"
[[ -d "$PROJECT_DIR" ]] || die "project dir not found: $PROJECT_DIR"
PROJECT_DIR="$(cd "$PROJECT_DIR" && pwd -P)"
PROJECT_NAME="$(basename "$PROJECT_DIR")"

# Refuse protected file paths whose current type would make the adapter or our
# restoration follow a link or traverse a non-directory ancestor. This check
# runs before legacy cleanup and is repeated immediately before the adapter.
_protected_dirs=(
  ".agents"
  ".codex"
)
_protected_files=(
  ".agents/config.toml"
  ".codex/AGENTS.override.md"
  ".codex/config.toml"
  ".gitignore"
  "AGENTS.md"
  "CLAUDE.md"
)
_backup_files=("AGENTS.md.bak" "CLAUDE.md.bak")
_assert_protected_paths() {
  local _rel _path
  for _rel in "${_protected_dirs[@]}"; do
    _path="$PROJECT_DIR/$_rel"
    if [[ -L "$_path" || ( -e "$_path" && ! -d "$_path" ) ]]; then
      die "refusing non-directory or symlinked protected ancestor: $_path"
    fi
  done
  for _rel in "${_protected_files[@]}"; do
    _path="$PROJECT_DIR/$_rel"
    if [[ -L "$_path" || ( -e "$_path" && ! -f "$_path" ) ]]; then
      die "refusing non-regular or symlinked protected path: $_path"
    fi
  done
  for _rel in "${_backup_files[@]}"; do
    _path="$PROJECT_DIR/$_rel"
    if [[ -L "$_path" || ( -e "$_path" && ! -f "$_path" ) ]]; then
      die "refusing non-regular or symlinked instruction backup path: $_path"
    fi
  done
}
_assert_protected_paths

# Validate the user-selected mutation boundary before even marker-gated legacy
# cleanup. A non-ruflo directory must remain byte-identical on refusal.
if [[ ! -e "$PROJECT_DIR/CLAUDE.md" && ! -d "$PROJECT_DIR/.claude" && ! -e "$PROJECT_DIR/.mcp.json" ]]; then
  die "'$PROJECT_DIR' doesn't look like a ruflo/Claude project (no CLAUDE.md, .claude/, or .mcp.json).
       Run 'npx ruflo init --with-embeddings' there first, then re-run this script.
       (Or, for a fresh dual project, use ruflo-new-dual.sh instead — it does this step for you.)
       Avoid 'ruflo init --full': it bundles ~260 files the ruflo/* plugins already provide (#2640)."
fi

# v4.31.0 briefly installed four inferred skill.toml dispatch manifests. Remove
# only the exact historical bytes this package shipped; preserve customized,
# extra, and symlinked content. This runs before the idempotency exit so an
# already-converted project is repaired without needing --force.
_legacy_skill_names=(
  "ruflo-memory-search"
  "ruflo-memory-store"
  "ruflo-swarm-init"
  "search-ruvnet"
)
_legacy_skills_removed=0
_legacy_skills_root="$PROJECT_DIR/.codex/skills"
if [[ ! -L "$_legacy_skills_root" \
    && ! ( -e "$_legacy_skills_root" && ! -d "$_legacy_skills_root" ) ]]; then
  for _name in "${_legacy_skill_names[@]}"; do
    _dir="$_legacy_skills_root/$_name"
    _file="$_dir/skill.toml"
    if [[ -L "$_dir" || ( -e "$_dir" && ! -d "$_dir" ) \
        || -L "$_file" || ( -e "$_file" && ! -f "$_file" ) ]]; then
      continue
    fi
    case "$_name" in
      ruflo-memory-search) _expected_hash="b1d1b857abe1206928f68c6ec56627137aad396795e64fcaaaf2c11854909774" ;;
      ruflo-memory-store)  _expected_hash="b12e5625d1eef733961cad0894b210ee5c5528c40a7cbaba85cc1cf8d3ea43bd" ;;
      ruflo-swarm-init)    _expected_hash="3714f7abded01d7d6b198025a05bd4d9104f2c623d8e11be59813dfcd5978a2a" ;;
      search-ruvnet)       _expected_hash="97f11bd390f439e041230a91e894d9ee1efc9f0562442dd24942f0730446e917" ;;
    esac
    _actual_hash=""
    if [[ -f "$_file" ]]; then
      _actual_hash="$(node -e '
        const fs = require("fs");
        const crypto = require("crypto");
        process.stdout.write(crypto.createHash("sha256").update(fs.readFileSync(process.argv[1])).digest("hex"));
      ' "$_file" 2>/dev/null || true)"
    fi
    if [[ -n "$_actual_hash" && "$_actual_hash" == "$_expected_hash" ]]; then
      rm -f -- "$_file"
      rmdir "$_dir" 2>/dev/null || true
      _legacy_skills_removed=$((_legacy_skills_removed + 1))
    fi
  done
  rmdir "$_legacy_skills_root" 2>/dev/null || true
fi
[[ $_legacy_skills_removed -eq 0 ]] \
  || say "    removed $_legacy_skills_removed obsolete package-owned Codex skill manifest(s)"

if [[ "$TEMPLATE" == "full" || "$TEMPLATE" == "enterprise" ]]; then
  echo "warning: codex template '$TEMPLATE' emits ~100 placeholder stub skills (ruvnet/ruflo#2634)." >&2
  echo "         Recommended: --template default. Continuing anyway." >&2
fi

# Idempotency: our CLAUDE.md starts with the import line.
if [[ -f "$PROJECT_DIR/CLAUDE.md" ]] && head -1 "$PROJECT_DIR/CLAUDE.md" | grep -q '^@AGENTS.md' && [[ $FORCE -eq 0 ]]; then
  say "Already converted to single-source dual (CLAUDE.md imports AGENTS.md). Use --force to redo."
  exit 0
fi

say "==> Converting to single-source dual (Claude Code + Codex): $PROJECT_DIR"
_codex_files_existed=0
[[ -f "$PROJECT_DIR/AGENTS.md" || -d "$PROJECT_DIR/.agents" ]] && _codex_files_existed=1

# ---- 1. Back up existing instruction files FIRST (BUG FIX) ------------------
# Must precede codex init: codex init writes/overwrites AGENTS.md, so backing up
# AFTER it would capture codex's boilerplate instead of the user's original
# (silent data loss for any pre-existing AGENTS.md).
_assert_protected_paths
for f in CLAUDE.md AGENTS.md; do
  if [[ -f "$PROJECT_DIR/$f" ]]; then
    cp "$PROJECT_DIR/$f" "$PROJECT_DIR/$f.bak"
    say "    backed up $f -> $f.bak"
  fi
done

# ---- 2. Codex functional setup (AGENTS.md / .agents/skills / global MCP) ----
# Pin the exact adapter release audited by this package. `latest` would silently
# change both the files and the side effects this guard is meant to contain.
#
# --force is passed through ONLY when the script's own --force is set, so a
# re-run never silently clobbers customized .agents/skills/.
#
# Adapter 3.0.1 writes three false/unsafe project surfaces:
# `.agents/config.toml` is not a Codex config location,
# `.codex/AGENTS.override.md` is not an instruction-discovery location, and
# `.codex/config.toml` silently sets approval_policy=never +
# sandbox_mode=danger-full-access. It also invokes `codex mcp add ruflo`.
#
# One isolated guard directory contains both byte-for-byte snapshots and a
# failing `codex` shim. The adapter sees the shim, never the real executable.
# Afterward the snapshots are restored (or adapter-created files removed), then
# the original executable is called explicitly for non-overwriting registry
# operations. EXIT is the single cleanup path, including INT/TERM/HUP.
_real_codex="$(type -P codex 2>/dev/null || true)"
if [[ -n "$_real_codex" && "$_real_codex" != /* ]]; then
  _real_codex="$(cd "$(dirname "$_real_codex")" && pwd -P)/$(basename "$_real_codex")"
fi
_codex_guard_dir="$(mktemp -d "${TMPDIR:-/tmp}/ruflo-codex-guard.XXXXXX")"
_codex_guard_pending=0
_codex_guard_files=("${_protected_files[@]}")

_restore_codex_guard() {
  [[ ${_codex_guard_pending:-0} -eq 1 ]] || return 0
  local _failed=0 _tmp _path
  for _rel in "${_protected_dirs[@]}"; do
    _path="$PROJECT_DIR/$_rel"
    if [[ -L "$_path" || ( -e "$_path" && ! -d "$_path" ) ]]; then
      echo "error: adapter replaced protected ancestor with a non-directory or symlink: $_path" >&2
      _failed=1
    fi
  done
  [[ $_failed -eq 0 ]] || return 1
  for _rel in "${_codex_guard_files[@]}"; do
    if [[ -f "$_codex_guard_dir/snapshot/$_rel" ]]; then
      mkdir -p "$PROJECT_DIR/$(dirname "$_rel")" || { _failed=1; continue; }
      _tmp="$(mktemp "$PROJECT_DIR/$(dirname "$_rel")/.rsp-restore.XXXXXX")" \
        || { _failed=1; continue; }
      if ! cp -p "$_codex_guard_dir/snapshot/$_rel" "$_tmp" \
          || ! mv -f "$_tmp" "$PROJECT_DIR/$_rel"; then
        rm -f -- "$_tmp"
        _failed=1
      fi
    else
      if [[ -d "$PROJECT_DIR/$_rel" && ! -L "$PROJECT_DIR/$_rel" ]]; then
        echo "error: adapter created a directory at protected file path $PROJECT_DIR/$_rel; refusing recursive removal" >&2
        _failed=1
      else
        rm -f -- "$PROJECT_DIR/$_rel" || _failed=1
      fi
    fi
  done
  [[ $_failed -eq 0 ]] || return 1
  _codex_guard_pending=0
}

_codex_guard_exit() {
  local _status=$?
  trap - EXIT
  set +e
  _restore_codex_guard
  local _restore_status=$?
  if [[ $_restore_status -eq 0 ]]; then
    [[ -z ${_codex_guard_dir:-} || ! -d "$_codex_guard_dir" ]] \
      || rm -rf -- "$_codex_guard_dir"
  else
    echo "error: protected-file restoration failed; snapshots retained at $_codex_guard_dir/snapshot" >&2
    _status=1
  fi
  exit "$_status"
}
_codex_adapter_pid=""
_codex_adapter_pgid=""
_codex_wrapper_pgid="$(ps -o pgid= -p "$$" 2>/dev/null | tr -d '[:space:]' || true)"
_stop_codex_adapter() {
  local _pid="${_codex_adapter_pid:-}" _pgid="${_codex_adapter_pgid:-}" _i
  [[ -n "$_pid" ]] || return 0
  if [[ "$_pgid" =~ ^[0-9]+$ && "$_pgid" != "$_codex_wrapper_pgid" ]]; then
    kill -TERM -- "-$_pgid" 2>/dev/null || true
    for _i in {1..20}; do
      kill -0 -- "-$_pgid" 2>/dev/null || break
      sleep 0.05
    done
    kill -KILL -- "-$_pgid" 2>/dev/null || true
  else
    kill -TERM "$_pid" 2>/dev/null || true
    for _i in {1..20}; do
      kill -0 "$_pid" 2>/dev/null || break
      sleep 0.05
    done
    kill -KILL "$_pid" 2>/dev/null || true
  fi
  wait "$_pid" 2>/dev/null || true
  _codex_adapter_pid=""
  _codex_adapter_pgid=""
}
_codex_signal_exit() {
  local _status="$1"
  _stop_codex_adapter
  exit "$_status"
}
trap _codex_guard_exit EXIT
trap '_codex_signal_exit 130' INT
trap '_codex_signal_exit 143' TERM
trap '_codex_signal_exit 129' HUP

_assert_protected_paths
for _rel in "${_codex_guard_files[@]}"; do
  _src="$PROJECT_DIR/$_rel"
  if [[ -f "$_src" ]]; then
    mkdir -p "$_codex_guard_dir/snapshot/$(dirname "$_rel")"
    cp -p "$_src" "$_codex_guard_dir/snapshot/$_rel"
  fi
done
_codex_guard_pending=1

mkdir -p "$_codex_guard_dir/bin"
printf '%s\n' '#!/usr/bin/env sh' \
  'echo "codex registry access intentionally blocked during adapter init" >&2' \
  'exit 73' > "$_codex_guard_dir/bin/codex"
chmod 0755 "$_codex_guard_dir/bin/codex"

CODEX_FORCE=""; [[ $FORCE -eq 1 ]] && CODEX_FORCE="--force"
set -m
PATH="$_codex_guard_dir/bin:$PATH" \
  npx --yes @claude-flow/codex@3.0.1 init \
    --path "$PROJECT_DIR" --template "$TEMPLATE" $CODEX_FORCE $QUIET &
_codex_adapter_pid=$!
_codex_adapter_pgid="$(ps -o pgid= -p "$_codex_adapter_pid" 2>/dev/null | tr -d '[:space:]' || true)"
set +m
if wait "$_codex_adapter_pid"; then
  _codex_status=0
else
  _codex_status=$?
fi
_codex_adapter_pid=""
_codex_adapter_pgid=""
if ! _restore_codex_guard; then
  die "failed to restore files protected from the Codex adapter; recovery snapshots are retained under $_codex_guard_dir"
fi
rm -rf -- "$_codex_guard_dir"
_codex_guard_dir=""
trap - EXIT INT TERM HUP

if [[ $_codex_status -ne 0 ]]; then
  if [[ $FORCE -eq 0 && $_codex_files_existed -eq 1 ]]; then
    die "Codex files already exist here (AGENTS.md / .agents/). codex init won't overwrite them
         without --force. Re-run with --force to convert. (Originals backed up at *.bak.)"
  fi
  die "codex init failed (network / npx fetch / adapter?). Protected instructions, policy, and
       ignore bytes were restored (backups at *.bak); supported .agents/skills written before the
       adapter failed may remain. Resolve the issue and re-run."
fi

# The adapter's registry write was intentionally blocked. Now use the exact
# executable resolved before the shim. Only Codex's explicit "not found"
# response permits an add; a parse/permission/config failure is UNKNOWN and
# must never be converted into permission to overwrite.
_codex_mcp_get() {
  local _name="$1" _result _status
  if _result="$("$_real_codex" -C "$PROJECT_DIR" mcp get "$_name" --json 2>&1)"; then
    return 0
  else
    _status=$?
  fi
  if [[ "$_result" == *"No MCP server named '$_name' found."* ]]; then
    return 1
  fi
  echo "warning: could not determine whether Codex MCP '$_name' exists (exit $_status); preserving registry state" >&2
  return 2
}

if [[ -z "$_real_codex" ]]; then
  echo "warning: Codex CLI not installed; ruflo MCP registration skipped" >&2
else
  if _codex_mcp_get ruflo; then
    say "    ruflo MCP already registered for Codex, preserving it"
  else
    _mcp_state=$?
    if [[ $_mcp_state -eq 1 ]]; then
      if "$_real_codex" -C "$PROJECT_DIR" mcp add ruflo -- npx -y ruflo@latest mcp start >/dev/null 2>&1; then
        say "    registered ruflo MCP for Codex"
      else
        echo "warning: could not register the absent ruflo MCP entry; existing Codex registry content was not overwritten" >&2
      fi
    fi
  fi
fi

# ---- 2b. Legacy fallback: register ruvnet-brain's MCP server for Codex -------
# Current Brain installers own this registration (stuinfla/ruvnet-brain#42).
# This is compatibility for older marketplace installs only. It can use the
# stable marketplace server file when that file is actually packaged; it cannot
# repair an npm artifact that omitted plugin/mcp/server.mjs.
#
# Its own plugin/.mcp.json cannot be copied verbatim: it uses `${CLAUDE_PLUGIN_ROOT}`, a Claude Code
# variable Codex does not expand. We resolve the absolute path instead.
#
# The MARKETPLACE checkout is preferred over plugins/cache/<version>/: the cache path changes on
# every /plugin update, which would leave a stale absolute path in config.toml after each upgrade.
# Idempotent, and skipped entirely when the plugin isn't installed. Never fatal — a project that
# converts fine without the brain must not fail because the brain is absent.
BRAIN_MCP="$HOME/.claude/plugins/marketplaces/ruvnet-brain/plugin/mcp/server.mjs"
[[ -f "$BRAIN_MCP" ]] || BRAIN_MCP=""
if [[ -n "$BRAIN_MCP" ]]; then
  if [[ -n "$_real_codex" ]]; then
    if _codex_mcp_get ruvnet-brain; then
      say "    ruvnet-brain MCP already registered for Codex, skipping"
    else
      _mcp_state=$?
      if [[ $_mcp_state -eq 1 ]]; then
        if "$_real_codex" -C "$PROJECT_DIR" mcp add ruvnet-brain -- node "$BRAIN_MCP" >/dev/null 2>&1; then
          say "    registered legacy ruvnet-brain MCP path for Codex (#42)"
        else
          echo "warning: ruvnet-brain MCP registration failed; existing registry content was not overwritten" >&2
        fi
      fi
    fi
  fi
fi

# ---- 3. Install the single-source instruction files -------------------------
# Substitute __PROJECT__ via Node's replaceAll with a FUNCTION replacer, which is
# truly literal for any project name. (sed AND bash `${//}` both treat `&` in the
# replacement as "the matched text" — bash 5.1+ — so neither is safe here.)
# NOTE: Codex caps AGENTS.md at 32 KiB — keep the shared instructions under that
# (this template is ~4 KB).
render_template() {   # $1 = template path, $2 = destination path
  PROJECT_NAME="$PROJECT_NAME" node -e '
    const fs = require("fs");
    const out = fs.readFileSync(process.argv[1], "utf8")
                  .replaceAll("__PROJECT__", () => process.env.PROJECT_NAME);
    fs.writeFileSync(process.argv[2], out);
  ' "$1" "$2"
}
render_template "$TPL_DIR/AGENTS.md" "$PROJECT_DIR/AGENTS.md"   # canonical (shared + Codex notes); overwrites codex boilerplate
render_template "$TPL_DIR/CLAUDE.md" "$PROJECT_DIR/CLAUDE.md"   # @AGENTS.md import + Claude-only overlay
say "    wrote AGENTS.md (canonical, shared source of truth)"
say "    wrote CLAUDE.md (@AGENTS.md import + Claude-only overlay)"

# ---- 4. Extend repository-owned ignore policy with our narrow rules ---------
# The adapter's arbitrary rewrite was already removed/restored. Preserve every
# user byte, then append only this script's marker-owned secret/runtime rules.
GI="$PROJECT_DIR/.gitignore"
[[ -f "$GI" ]] || : > "$GI"
grep -q "ruflo-add-codex:gitignore" "$GI" \
  || printf '\n# ruflo-add-codex:gitignore — secrets + runtime\n' >> "$GI"
for pat in ".env" ".env.local" ".env.*.local" ".claude-flow/data/" ".claude-flow/logs/" ".claude-flow/sessions/" "*.bak"; do
  grep -qxF "$pat" "$GI" || printf '%s\n' "$pat" >> "$GI"
done
say "    .gitignore: preserved existing rules; added .env + runtime dirs + *.bak"

# ---- verify Claude tooling survived -----------------------------------------
for keep in .claude .mcp.json; do
  [[ -e "$PROJECT_DIR/$keep" ]] && say "    ok: $keep intact"
done

say ""
say "Done. Single-source dual project:"
say "  AGENTS.md            = canonical shared instructions (Codex reads this)"
say "  CLAUDE.md            = @AGENTS.md + Claude-only overlay (Claude Code reads this)"
say "  .claude/ + .mcp.json = Claude Code tooling (unchanged)"
say "  .agents/skills/       = Codex skills; approval/sandbox policy remains user-owned"
say ""
say "Edit SHARED instructions in AGENTS.md — both platforms pick them up. No drift."
say "Originals saved as CLAUDE.md.bak / AGENTS.md.bak (migrate any custom edits, then delete)."
