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
#       defines (EVENT-AWARE: PreToolUse/PostToolUse/PreCompact/Stop today), AND
#     * a project-local .mcp.json's standalone ruflo/claude-flow server, which the
#       ruflo-core plugin ALREADY provides (a second server on the same root =
#       two writers on one .swarm/memory.db, ruvnet/ruflo#2621). Other servers
#       (ruv-swarm, flow-nexus, ...) are KEPT; the file is deleted if it empties, AND
#     * the RUNNING standalone MCP server that registration spawned (SIGTERM), so the
#       second writer is gone now, not just after a restart. GUARDED: only a process
#       whose REAL cwd is inside the project AND whose env carries the removed entry's
#       CLAUDE_FLOW_* marker is signalled, so the plugin server (same command) is never
#       touched; if it can't be told apart, nothing is killed and it says so.
#   KEEPS everything init installs that the plugins do NOT cover: the
#   UserPromptSubmit routing hook, SessionStart/End, Subagent/Notification hooks,
#   the auto-memory hooks, and ALL .claude/helpers/ (init writes them; no plugin
#   replaces them). Helpers are never pruned.
#     --keep-dup-hooks    Don't touch settings.json hooks
#     --keep-dup-mcp      Don't touch .mcp.json (keep the standalone ruflo server)
#     --keep-server       Don't SIGTERM the standalone MCP server (leave it running)
#     --bundle-only       Only the .claude bundle (implies --keep-dup-hooks, --keep-dup-mcp, --keep-server)
#     --strip-dup-hooks   (Deprecated no-op — hook stripping is now the default)
#     --stop-server       (No-op — stopping the server is now the default; kept for scripts)
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
STRIP_MCP=1
STOP_SERVER=1
DRY=0
FORCE=0
NO_BACKUP=0
QUIET=""
PLUG_DIR="${RUFLO_PLUGIN_DIR:-$HOME/.claude/plugins/cache/ruflo}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --strip-dup-hooks) STRIP_HOOKS=1; shift ;;   # deprecated: now the default
    --keep-dup-hooks)  STRIP_HOOKS=0; shift ;;
    --keep-dup-mcp)    STRIP_MCP=0; shift ;;
    --stop-server)     STOP_SERVER=1; shift ;;   # deprecated: now the default
    --keep-server)     STOP_SERVER=0; shift ;;
    --bundle-only)     STRIP_HOOKS=0; STRIP_MCP=0; STOP_SERVER=0; shift ;;
    --dry-run)         DRY=1; shift ;;
    --force)           FORCE=1; shift ;;
    --no-backup)       NO_BACKUP=1; shift ;;   # rely on git for recovery; skip .bundle-backup
    --quiet)           QUIET="--quiet"; shift ;;
    -h|--help)         sed -n '2,44p' "$0"; exit 0 ;;
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

# ---- prune the duplicate ruflo/claude-flow MCP registration (DEFAULT) --------
# The ruflo-core plugin ALREADY provides the ruflo MCP server (under plugin
# loading it is namespaced mcp__plugin_ruflo-core_ruflo__*). A project-local
# .mcp.json that ALSO registers a standalone `ruflo mcp start` /
# `@claude-flow/cli … mcp start` server spawns a SECOND server against the same
# project root: two writers on one .swarm/memory.db (ruvnet/ruflo#2621). Remove
# ONLY that server — keyed `claude-flow` OR `ruflo`, matched by COMMAND SIGNATURE
# not by key, so an unrelated server keyed `ruflo` is never touched — and keep
# every other server. Delete the file if it empties. Acts ONLY when the plugin
# set genuinely provides a ruflo MCP server, mirroring the "provided?" gate the
# skills/commands/agents prune uses; otherwise the standalone registration is not
# a duplicate and is left alone.
mcp_note=""; mcp_empty=0; MCP_MARKERS=()
if [[ $STRIP_MCP -eq 1 && -f "$PROJECT_DIR/.mcp.json" ]]; then
  # Does the plugin set ship a ruflo MCP server at all? The plugin's own server is
  # `npx @claude-flow/cli@latest` with mcp mode via env (CLAUDE_FLOW_MCP_TRANSPORT),
  # NOT explicit `mcp start` args — so this gate matches on the ruflo/claude-flow
  # reference alone, not on "mcp"/"start" (that stricter shape is the PROJECT side).
  PLUG_PROVIDES_MCP=0
  while IFS= read -r mf; do
    if node -e 'const j=require(process.argv[1]);const s=j.mcpServers||{};process.exit(Object.values(s).some(v=>/(ruflo|@claude-flow\/cli)/.test(String(v&&v.command||"")+" "+((v&&v.args)||[]).join(" ")))?0:1)' "$mf" 2>/dev/null; then
      PLUG_PROVIDES_MCP=1; break
    fi
  done < <(find "$PLUG_DIR" -name '.mcp.json' 2>/dev/null)
  if [[ $PLUG_PROVIDES_MCP -eq 0 ]]; then
    say "  (no ruflo MCP server provided by plugins under $PLUG_DIR — .mcp.json left alone, not a duplicate)"
  else
    [[ $DRY -eq 0 && $NO_BACKUP -eq 0 ]] && cp "$PROJECT_DIR/.mcp.json" "$BK/.mcp.json"
    DRY=$DRY node -e '
      const fs=require("fs");
      const p=process.argv[1];
      let j; try{ j=JSON.parse(fs.readFileSync(p,"utf8")); }catch{ console.error("MCP_REMOVED=0"); process.exit(0); }
      const s=(j&&j.mcpServers)||{}; const removed=[]; const markers=[];
      const isRufloStandalone=(v)=>{ const a=(v&&v.args||[]).join(" "); return /\bmcp\b/.test(a)&&/\bstart\b/.test(a)&&/(ruflo|@claude-flow\/cli)/.test(String(v&&v.command||"")+" "+a); };
      for(const k of Object.keys(s)){ if(isRufloStandalone(s[k])){
        removed.push(k);
        // Env markers that identify THIS entry\x27s server process and distinguish it from the plugin
        // server (which sets CLAUDE_FLOW_MCP_TRANSPORT, never these). Only CLAUDE_FLOW_* pairs qualify.
        const e=(s[k].env)||{}; for(const [ek,ev] of Object.entries(e)){ if(/^CLAUDE_FLOW_/.test(ek)&&ek!=="CLAUDE_FLOW_MCP_TRANSPORT"&&ev) markers.push(ek+"="+ev); }
        delete s[k];
      } }
      if(removed.length===0){ console.error("MCP_REMOVED=0"); process.exit(0); }
      const empty=Object.keys(s).length===0;
      if(process.env.DRY!=="1"){ if(empty) fs.unlinkSync(p); else fs.writeFileSync(p, JSON.stringify(j,null,2)+"\n"); }
      console.error("MCP_REMOVED="+removed.length+" MCP_KEYS="+removed.join(",")+(empty?" MCP_EMPTIED=1":""));
      for(const m of markers) console.error("MCP_MARKER="+m);
    ' "$PROJECT_DIR/.mcp.json" 2>/tmp/.ddb-mcp.$$ || true
    mcp_note="$(grep -o 'MCP_REMOVED=[0-9]*' /tmp/.ddb-mcp.$$ 2>/dev/null | cut -d= -f2)"
    grep -q 'MCP_EMPTIED=1' /tmp/.ddb-mcp.$$ 2>/dev/null && mcp_empty=1 || true
    MCP_MARKERS=(); while IFS= read -r mk; do [[ -n "$mk" ]] && MCP_MARKERS+=("$mk"); done < <(sed -n 's/^MCP_MARKER=//p' /tmp/.ddb-mcp.$$ 2>/dev/null)
    rm -f /tmp/.ddb-mcp.$$
  fi
fi

# ---- --stop-server: SIGTERM the now-orphaned standalone MCP server(s) --------
# This is the ONLY part of dedupe that signals a process, so it carries cleanup's
# (ADR-013) discipline. A killed candidate must pass BOTH guards, and any doubt skips:
#   (1) CONTAINMENT — its REAL (symlink-resolved) cwd is the project root or beneath it;
#   (2) DISTINGUISHABILITY — its env carries a CLAUDE_FLOW_* marker from the REMOVED
#       entry. The plugin server runs the SAME `npx … mcp start` command, so command
#       matching alone is not enough; the marker is what tells them apart. A removed
#       entry with no such env yields no marker -> nothing is killed, and it says so.
# --dry-run signals nothing; it reports what it WOULD stop. $HOME / / are refused.
stop_note=""
if [[ $STOP_SERVER -eq 1 && "${mcp_note:-0}" -gt 0 ]]; then
  if [[ ${#MCP_MARKERS[@]} -eq 0 ]]; then
    stop_note="skip:no-marker"
  else
    ROOT_REAL="$(cd "$PROJECT_DIR" && pwd -P)"
    case "$ROOT_REAL" in "$HOME"|"/"|"") die "refusing --stop-server against '$ROOT_REAL' (too broad)";; esac
    stopped=0
    for pid in $(pgrep -f 'ruflo mcp start|@claude-flow/cli.*mcp|cli\.js mcp' 2>/dev/null || true); do
      pcwd="$(lsof -a -d cwd -p "$pid" -Fn 2>/dev/null | sed -n 's/^n//p' | head -1)"
      [[ -z "$pcwd" && -r "/proc/$pid/cwd" ]] && pcwd="$(readlink -f "/proc/$pid/cwd" 2>/dev/null || true)"
      [[ -n "$pcwd" ]] || continue
      pcwd_real="$(cd "$pcwd" 2>/dev/null && pwd -P || true)"; [[ -n "$pcwd_real" ]] || continue
      case "$pcwd_real" in "$ROOT_REAL"|"$ROOT_REAL"/*) : ;; *) continue ;; esac   # (1) containment
      penv="$(ps eww -o command= -p "$pid" 2>/dev/null || true)"
      [[ -z "$penv" && -r "/proc/$pid/environ" ]] && penv="$(tr '\0' ' ' < "/proc/$pid/environ" 2>/dev/null || true)"
      match=0; for mk in "${MCP_MARKERS[@]}"; do case "$penv" in *"$mk"*) match=1; break;; esac; done
      [[ $match -eq 1 ]] || continue                                              # (2) distinguishability
      if [[ $DRY -eq 1 ]]; then
        say "  would SIGTERM pid $pid — orphaned standalone MCP server (cwd $pcwd_real)"
      else
        kill "$pid" 2>/dev/null && say "  SIGTERM pid $pid — orphaned standalone MCP server (cwd $pcwd_real)" || true
      fi
      stopped=$((stopped+1))
    done
    stop_note="$stopped"
  fi
fi

# ---- report -----------------------------------------------------------------

# ---- report -----------------------------------------------------------------
say ""
say "$([[ $DRY -eq 1 ]] && echo '[DRY-RUN] would remove' || echo 'Removed') plugin-duplicated bundle entries:"
say "  skills:   $removed_s removed, $kept_s kept (project-only)"
say "  commands: $removed_c removed, $kept_c kept"
say "  agents:   $removed_a removed, $kept_a kept"
[[ $STRIP_HOOKS -eq 1 ]] && say "  hooks:    ${hooks_note:-0} plugin-covered hook entries $([[ $DRY -eq 1 ]] && echo 'would be' || echo '') removed (routing/session/subagent/auto-memory KEPT)"
[[ $STRIP_MCP -eq 1 ]] && say "  mcp:      ${mcp_note:-0} standalone ruflo/claude-flow server(s) $([[ $DRY -eq 1 ]] && echo 'would be' || echo '') removed from .mcp.json$([[ $mcp_empty -eq 1 ]] && echo " (file $([[ $DRY -eq 1 ]] && echo 'would be ' || echo '')deleted — now empty)" || echo "; other servers KEPT")"
if [[ $STOP_SERVER -eq 1 ]]; then
  if [[ "$stop_note" == "skip:no-marker" ]]; then
    say "  server:   NOT stopped — the removed registration set no distinctive CLAUDE_FLOW_* env, so its process can't be told apart from the plugin server; restart Claude Code to drop it"
  else
    say "  server:   ${stop_note:-0} orphaned standalone MCP server process(es) $([[ $DRY -eq 1 ]] && echo 'would be ' || echo '')stopped (cwd inside the project + env match; plugin server untouched)"
  fi
fi
if [[ $DRY -eq 0 && $NO_BACKUP -eq 0 ]]; then
  say ""; say "Backup: $BK  (restore with: cp -R \"$BK\"/* \"$CL\"/)."
elif [[ $DRY -eq 0 && $NO_BACKUP -eq 1 ]]; then
  say ""; say "No backup written (--no-backup): recover via git if the bundle was committed."
fi
if [[ $STRIP_HOOKS -eq 0 ]]; then
  say ""; say "Note: --keep-dup-hooks/--bundle-only set — plugin-covered hook events may DOUBLE-FIRE (project + plugin)."
fi
if [[ $STRIP_MCP -eq 0 ]]; then
  say ""; say "Note: --keep-dup-mcp/--bundle-only set — a standalone ruflo .mcp.json server may run ALONGSIDE the plugin's (two writers on one memory.db, #2621)."
fi
if [[ $STOP_SERVER -eq 0 && $STRIP_MCP -eq 1 ]]; then
  say ""; say "Note: --keep-server/--bundle-only set — the standalone MCP server keeps running until you restart Claude Code (a second writer on memory.db until then, #2621)."
fi
exit 0
