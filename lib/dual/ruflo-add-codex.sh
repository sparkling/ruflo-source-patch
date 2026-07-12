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
#   * Missing @claude-flow/codex package (#2635): uses `npx --yes @claude-flow/codex`,
#     which fetches on demand — no `npm install`, no abort.
#   * Codex stub skills (#2634): default template only.
#   * Root .gitignore / .env not ignored (#2637): guaranteed explicitly.
#
# NOTE (global side effect): `codex init` runs `codex mcp add ruflo`, which
# registers the MCP server in the user's GLOBAL ~/.codex/config.toml
# (machine-wide, NOT just this project). That is Codex's own convention — this
# script does not control it. If `codex` isn't installed, codex init only warns.
#
# Verified against @claude-flow/cli@3.25.6 / @claude-flow/codex@3.0.0-alpha.12.
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
PROJECT_DIR="$(cd "$PROJECT_DIR" && pwd)"
PROJECT_NAME="$(basename "$PROJECT_DIR")"

if [[ "$TEMPLATE" == "full" || "$TEMPLATE" == "enterprise" ]]; then
  echo "warning: codex template '$TEMPLATE' emits ~100 placeholder stub skills (ruvnet/ruflo#2634)." >&2
  echo "         Recommended: --template default. Continuing anyway." >&2
fi

# Must be a ruflo/Claude project already.
if [[ ! -e "$PROJECT_DIR/CLAUDE.md" && ! -d "$PROJECT_DIR/.claude" && ! -e "$PROJECT_DIR/.mcp.json" ]]; then
  die "'$PROJECT_DIR' doesn't look like a ruflo/Claude project (no CLAUDE.md, .claude/, or .mcp.json).
       Run 'npx ruflo init --full' there first, then re-run this script."
fi

# Idempotency: our CLAUDE.md starts with the import line.
if [[ -f "$PROJECT_DIR/CLAUDE.md" ]] && head -1 "$PROJECT_DIR/CLAUDE.md" | grep -q '^@AGENTS.md' && [[ $FORCE -eq 0 ]]; then
  say "Already converted to single-source dual (CLAUDE.md imports AGENTS.md). Use --force to redo."
  exit 0
fi

say "==> Converting to single-source dual (Claude Code + Codex): $PROJECT_DIR"

# ---- 1. Back up existing instruction files FIRST (BUG FIX) ------------------
# Must precede codex init: codex init writes/overwrites AGENTS.md, so backing up
# AFTER it would capture codex's boilerplate instead of the user's original
# (silent data loss for any pre-existing AGENTS.md).
for f in CLAUDE.md AGENTS.md; do
  if [[ -f "$PROJECT_DIR/$f" ]]; then
    cp "$PROJECT_DIR/$f" "$PROJECT_DIR/$f.bak"
    say "    backed up $f -> $f.bak"
  fi
done

# ---- 2. Codex functional setup (.agents/.codex/config.toml/MCP) -------------
# npx --yes fetches @claude-flow/codex on demand (dodges the #2635 abort).
# --force is passed through ONLY when the script's own --force is set, so a
# re-run never silently clobbers customized .agents/skills/.
CODEX_FORCE=""; [[ $FORCE -eq 1 ]] && CODEX_FORCE="--force"
if ! npx --yes @claude-flow/codex init --path "$PROJECT_DIR" --template "$TEMPLATE" $CODEX_FORCE $QUIET; then
  if [[ $FORCE -eq 0 && ( -f "$PROJECT_DIR/AGENTS.md" || -f "$PROJECT_DIR/.agents/config.toml" ) ]]; then
    die "Codex files already exist here (AGENTS.md / .agents/). codex init won't overwrite them
         without --force. Re-run with --force to convert. (Originals backed up at *.bak.)"
  fi
  die "codex init failed (network / npx fetch / codex CLI?). Originals untouched (backups at
       *.bak). Resolve the issue and re-run."
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

# ---- 4. Guarantee .gitignore covers .env + runtime (#2637) ------------------
GI="$PROJECT_DIR/.gitignore"
[[ -f "$GI" ]] || : > "$GI"
grep -q "ruflo-add-codex:gitignore" "$GI" || printf '\n# ruflo-add-codex:gitignore — secrets + runtime\n' >> "$GI"
for pat in ".env" ".env.local" ".env.*.local" ".claude-flow/data/" ".claude-flow/logs/" ".claude-flow/sessions/" ".codex/" "*.bak"; do
  grep -qxF "$pat" "$GI" || printf '%s\n' "$pat" >> "$GI"
done
say "    .gitignore: .env + runtime dirs + *.bak ignored"

# ---- verify Claude tooling survived -----------------------------------------
for keep in .claude .mcp.json; do
  [[ -e "$PROJECT_DIR/$keep" ]] && say "    ok: $keep intact"
done

say ""
say "Done. Single-source dual project:"
say "  AGENTS.md            = canonical shared instructions (Codex reads this)"
say "  CLAUDE.md            = @AGENTS.md + Claude-only overlay (Claude Code reads this)"
say "  .claude/ + .mcp.json = Claude Code tooling (unchanged)"
say "  .agents/ + .codex/   = Codex tooling + skills"
say ""
say "Edit SHARED instructions in AGENTS.md — both platforms pick them up. No drift."
say "Originals saved as CLAUDE.md.bak / AGENTS.md.bak (migrate any custom edits, then delete)."
