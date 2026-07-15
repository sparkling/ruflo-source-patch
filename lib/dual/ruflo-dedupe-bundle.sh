#!/usr/bin/env bash
#
# ruflo-dedupe-bundle.sh — Clean up a project after `ruflo init --full` (or any
# preset) by removing the `.claude/{skills,commands,agents}` entries that are
# DUPLICATED by the installed ruflo/* plugins, and (optionally) the settings.json
# hooks that DOUBLE-FIRE against the plugin hooks. See ruvnet/ruflo#2640.
#
# Rationale: `ruflo init --full` bundles ~260 skill/command/agent files, of which
# ~100% of agents/commands and 97% of skills are ALSO provided by the installed
# ruflo/* plugins (only project-unique items like `dual-mode` are kept). Plus the
# project settings.json registers lifecycle hooks that duplicate the plugin
# hooks (post-edit/session-end run twice). This script defers to the plugins.
#
# SAFE: only removes an item when a plugin actually provides it; backs everything
# up first; keeps project-only items. Nothing is pruned if no plugins are found.
#
# Usage:
#   ruflo-dedupe-bundle.sh <project-dir> [--keep-dup-hooks] [--bundle-only]
#                          [--dry-run] [--force] [--quiet]
#     <project-dir>       Project with a .claude/ bundle to slim
#
#   By DEFAULT removes what the installed ruflo/* plugins already provide:
#     * the .claude/{skills,commands,agents} bundle, AND
#     * settings.json lifecycle hooks for events the plugin hooks.json ALSO
#       defines (EVENT-AWARE: PreToolUse/PostToolUse/PreCompact/Stop today).
#   KEEPS everything init installs that the plugins do NOT cover: the
#   UserPromptSubmit routing hook, SessionStart/End, Subagent/Notification hooks,
#   the auto-memory hooks, and ALL .claude/helpers/ (init writes them; no plugin
#   replaces them). Helpers are never pruned.
#     --keep-dup-hooks    Don't touch settings.json hooks (bundle only)
#     --bundle-only       Alias for --keep-dup-hooks
#     --strip-dup-hooks   (Deprecated no-op — hook stripping is now the default)
#     --dry-run           Report what WOULD be removed; change nothing
#     --force             Overwrite an existing backup dir
#     --quiet             Less output
#
# Plugin source: $RUFLO_PLUGIN_DIR, else ~/.claude/plugins/cache/ruflo
# (the ruflo/* marketplace plugins; sparkleideas/* are ignored by default).
#
set -euo pipefail

PROJECT_DIR=""
STRIP_HOOKS=1
DRY=0
FORCE=0
NO_BACKUP=0
QUIET=""
PLUG_DIR="${RUFLO_PLUGIN_DIR:-$HOME/.claude/plugins/cache/ruflo}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --strip-dup-hooks) STRIP_HOOKS=1; shift ;;   # deprecated: now the default
    --keep-dup-hooks)  STRIP_HOOKS=0; shift ;;
    --bundle-only)     STRIP_HOOKS=0; shift ;;
    --dry-run)         DRY=1; shift ;;
    --force)           FORCE=1; shift ;;
    --no-backup)       NO_BACKUP=1; shift ;;   # rely on git for recovery; skip .bundle-backup
    --quiet)           QUIET="--quiet"; shift ;;
    -h|--help)         sed -n '2,30p' "$0"; exit 0 ;;
    -*)                echo "Unknown option: $1" >&2; exit 2 ;;
    *)                 PROJECT_DIR="$1"; shift ;;
  esac
done

say() { [[ -z "$QUIET" ]] && echo "$@" || true; }
die() { echo "error: $*" >&2; exit 1; }

[[ -n "$PROJECT_DIR" ]] || die "usage: ruflo-dedupe-bundle.sh <project-dir> [--strip-dup-hooks] [--dry-run] [--force] [--quiet]"
[[ -d "$PROJECT_DIR/.claude" ]] || die "$PROJECT_DIR has no .claude/ (not a ruflo project?)"
[[ -d "$PLUG_DIR" ]] || die "plugin dir not found: $PLUG_DIR (set RUFLO_PLUGIN_DIR). Refusing to prune without a plugin source."
PROJECT_DIR="$(cd "$PROJECT_DIR" && pwd)"
CL="$PROJECT_DIR/.claude"

# ---- build the "provided by plugins" name sets ------------------------------
PS=/tmp/.ddb-pskills.$$; PC=/tmp/.ddb-pcmds.$$; PA=/tmp/.ddb-pagents.$$
trap 'rm -f "$PS" "$PC" "$PA"' EXIT
find "$PLUG_DIR" -path '*/skills/*/SKILL.md' 2>/dev/null | sed -E 's#.*/skills/([^/]+)/SKILL.md#\1#' | sort -u > "$PS"
find "$PLUG_DIR" -path '*/commands/*.md'     2>/dev/null | sed -E 's#.*/##; s#\.md$##'              | sort -u > "$PC"
find "$PLUG_DIR" -path '*/agents/*.md'       2>/dev/null | sed -E 's#.*/##; s#\.md$##'              | sort -u > "$PA"
[[ -s "$PS" || -s "$PC" || -s "$PA" ]] || die "no plugin skills/commands/agents found under $PLUG_DIR — refusing to prune."
say "plugin catalog: $(wc -l < "$PS") skills, $(wc -l < "$PC") commands, $(wc -l < "$PA") agents"

provided() { grep -qxF "$1" "$2"; }   # provided <name> <set-file>

# ---- backup (unless dry-run) ------------------------------------------------
BK="$CL/.bundle-backup"
if [[ $DRY -eq 0 && $NO_BACKUP -eq 0 ]]; then
  if [[ -e "$BK" && $FORCE -eq 0 ]]; then die "backup already exists ($BK). Use --force to overwrite."; fi
  rm -rf "$BK"; mkdir -p "$BK"
  for d in skills commands agents; do [[ -d "$CL/$d" ]] && cp -R "$CL/$d" "$BK/$d"; done
  # keep the backup out of git
  GI="$PROJECT_DIR/.gitignore"; [[ -f "$GI" ]] || : > "$GI"
  grep -qxF ".claude/.bundle-backup/" "$GI" || printf '%s\n' ".claude/.bundle-backup/" >> "$GI"
  say "backed up .claude/{skills,commands,agents} -> $BK"
elif [[ $DRY -eq 0 && $NO_BACKUP -eq 1 ]]; then
  say "--no-backup: NOT backing up (recovery relies on git)"
fi

removed_s=0 kept_s=0 removed_c=0 kept_c=0 removed_a=0 kept_a=0

# ---- prune SKILLS (dir per skill) -------------------------------------------
# Iterate ALL entries (incl. symlinks) — a symlinked skill is a custom, shared
# skill (e.g. diagramming skills symlinked from .agents/skills/); NEVER touch it.
# Only a REAL directory whose name a plugin provides is removed.
if [[ -d "$CL/skills" ]]; then
  for e in "$CL"/skills/*; do
    [[ -e "$e" || -L "$e" ]] || continue
    name="$(basename "$e")"
    if [[ -L "$e" ]]; then
      kept_s=$((kept_s+1)); continue          # symlinked custom skill — preserve
    fi
    [[ -d "$e" ]] || continue
    if provided "$name" "$PS"; then
      say "  skill  - $name (plugin-provided)"; [[ $DRY -eq 1 ]] || rm -rf "$e"; removed_s=$((removed_s+1))
    else
      kept_s=$((kept_s+1))   # project-only real dir, e.g. dual-mode
    fi
  done
fi

# ---- prune COMMANDS (files, in category subdirs) ----------------------------
if [[ -d "$CL/commands" ]]; then
  while IFS= read -r f; do
    name="$(basename "$f" .md)"
    if provided "$name" "$PC"; then
      [[ $DRY -eq 0 ]] && rm -f "$f"; removed_c=$((removed_c+1))
    else
      kept_c=$((kept_c+1))
    fi
  done < <(find "$CL/commands" -type f -name '*.md')
  [[ $DRY -eq 0 ]] && find "$CL/commands" -type d -empty -delete 2>/dev/null || true
fi

# ---- prune AGENTS (files) ---------------------------------------------------
if [[ -d "$CL/agents" ]]; then
  while IFS= read -r f; do
    name="$(basename "$f" .md)"
    if provided "$name" "$PA"; then
      [[ $DRY -eq 0 ]] && rm -f "$f"; removed_a=$((removed_a+1))
    else
      kept_a=$((kept_a+1))
    fi
  done < <(find "$CL/agents" -type f -name '*.md')
  [[ $DRY -eq 0 ]] && find "$CL/agents" -type d -empty -delete 2>/dev/null || true
fi

# ---- strip duplicate lifecycle hooks (DEFAULT; EVENT-AWARE) ------------------
# Remove a project hook-handler.cjs entry ONLY for events the installed plugins'
# hooks.json also define (PreToolUse/PostToolUse/PreCompact/Stop today). Events
# the plugins do NOT provide (UserPromptSubmit routing, SessionStart/End,
# Subagent*, Notification) and the auto-memory hooks are KEPT — not duplicates.
# On POSIX the plugin's ruflo-hook.sh is authoritative for the shared events; the
# local settings.json copies are the Windows-override path (#2132) -> redundant.
hooks_note=""
if [[ $STRIP_HOOKS -eq 1 && -f "$CL/settings.json" ]]; then
  PLUG_HOOKS=()
  while IFS= read -r hf; do PLUG_HOOKS+=("$hf"); done < <(find "$PLUG_DIR" -path '*/hooks/hooks.json' 2>/dev/null)
  if [[ ${#PLUG_HOOKS[@]} -eq 0 ]]; then
    say "  (no plugin hooks.json under $PLUG_DIR — skipping hook strip, nothing to dedupe against)"
  else
    if [[ $DRY -eq 0 ]]; then cp "$CL/settings.json" "$CL/settings.json.bak"; fi
    DRY=$DRY node -e '
      const fs=require("fs");
      const [settingsPath, ...plugFiles]=process.argv.slice(1);
      const events=new Set();
      for(const f of plugFiles){ try{ const j=JSON.parse(fs.readFileSync(f,"utf8")); if(j&&j.hooks) for(const ev of Object.keys(j.hooks)) events.add(ev); }catch{} }
      const s=JSON.parse(fs.readFileSync(settingsPath,"utf8"));
      const h=s.hooks||{}; let removed=0;
      for(const ev of Object.keys(h)){
        if(!events.has(ev)) continue;               // plugin does not provide this event -> keep
        const arr=h[ev]; if(!Array.isArray(arr)) continue;
        for(const m of arr){ if(!Array.isArray(m.hooks)) continue;
          const before=m.hooks.length;
          m.hooks=m.hooks.filter(hk=>!String(hk.command||"").includes("hook-handler.cjs"));
          removed+=before-m.hooks.length;
        }
        h[ev]=arr.filter(m=>Array.isArray(m.hooks)?m.hooks.length>0:true);
        if(h[ev].length===0) delete h[ev];
      }
      if(process.env.DRY!=="1") fs.writeFileSync(settingsPath, JSON.stringify(s,null,2));
      console.error("HOOKS_REMOVED="+removed);
    ' "$CL/settings.json" "${PLUG_HOOKS[@]}" 2>/tmp/.ddb-hooks.$$ || true
    hooks_note="$(grep -o 'HOOKS_REMOVED=[0-9]*' /tmp/.ddb-hooks.$$ 2>/dev/null | cut -d= -f2)"; rm -f /tmp/.ddb-hooks.$$
  fi
fi

# ---- report -----------------------------------------------------------------
say ""
say "$([[ $DRY -eq 1 ]] && echo '[DRY-RUN] would remove' || echo 'Removed') plugin-duplicated bundle entries:"
say "  skills:   $removed_s removed, $kept_s kept (project-only)"
say "  commands: $removed_c removed, $kept_c kept"
say "  agents:   $removed_a removed, $kept_a kept"
[[ $STRIP_HOOKS -eq 1 ]] && say "  hooks:    ${hooks_note:-0} plugin-covered hook entries $([[ $DRY -eq 1 ]] && echo 'would be' || echo '') removed (routing/session/subagent/auto-memory KEPT)"
if [[ $DRY -eq 0 && $NO_BACKUP -eq 0 ]]; then
  say ""; say "Backup: $BK  (restore with: cp -R \"$BK\"/* \"$CL\"/)."
elif [[ $DRY -eq 0 && $NO_BACKUP -eq 1 ]]; then
  say ""; say "No backup written (--no-backup): recover via git if the bundle was committed."
fi
if [[ $STRIP_HOOKS -eq 0 ]]; then
  say ""; say "Note: --keep-dup-hooks/--bundle-only set — plugin-covered hook events may DOUBLE-FIRE (project + plugin)."
fi
exit 0
