// The source patcher: rewrites the three cwd-anchoring functions in the
// installed @claude-flow/cli + @claude-flow/cli-core packages to resolve the
// project root (nearest ancestor .git) instead of raw process.cwd().
//
// Idempotent (PATCH_MARKER), reversible (per-file .rrg-backup), safe-fail on
// version drift (exact-anchor check before any write).

import fs from 'node:fs';
import path from 'node:path';
import { NPX_ROOT, PATCH_MARKER } from './paths.mjs';

const MARKER = PATCH_MARKER;

// Injected resolver (ESM form — uses createRequire since the targets are ESM).
const RESOLVER_SRC_ESM = `${MARKER}
import { createRequire as __rufloCreateRequire } from 'module';
const __rufloReq = __rufloCreateRequire(import.meta.url);
function __rufloResolveRoot(startDir) {
  try {
    const fs = __rufloReq('fs'); const path = __rufloReq('path');
    let dir = path.resolve(startDir || process.cwd());
    for (let i = 0; i < 40; i++) {
      if (fs.existsSync(path.join(dir, '.git'))) return dir;
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  } catch { /* fall through */ }
  return startDir || process.cwd();
}
`;

const TARGETS = [
  {
    label: 'daemon-autostart',
    suffix: ['@claude-flow', 'cli', 'dist', 'src', 'services', 'daemon-autostart.js'],
    edits: [
      {
        find: "        if (autostartDisabled())\n            return { started: false, reason: 'disabled (RUFLO_DAEMON_AUTOSTART=0)' };",
        replace: "        if (autostartDisabled())\n            return { started: false, reason: 'disabled (RUFLO_DAEMON_AUTOSTART=0)' };\n        projectRoot = __rufloResolveRoot(projectRoot);",
      },
    ],
  },
  {
    label: 'memory-initializer',
    suffix: ['@claude-flow', 'cli', 'dist', 'src', 'memory', 'memory-initializer.js'],
    edits: [
      {
        find: "        path.resolve(process.cwd(), 'claude-flow.config.json'),",
        replace: "        path.resolve(__rufloResolveRoot(process.cwd()), 'claude-flow.config.json'),",
      },
      {
        find: "        path.resolve(process.cwd(), '.claude-flow', 'config.json'),",
        replace: "        path.resolve(__rufloResolveRoot(process.cwd()), '.claude-flow', 'config.json'),",
      },
      {
        find: "    _memoryRootCache = path.resolve(process.cwd(), '.swarm');",
        replace: "    _memoryRootCache = path.resolve(__rufloResolveRoot(process.cwd()), '.swarm');",
      },
    ],
  },
  {
    label: 'cli-core getProjectCwd',
    suffix: ['@claude-flow', 'cli-core', 'dist', 'src', 'mcp-tools', 'types.js'],
    edits: [
      {
        find: "    return process.cwd();",
        replace: "    return __rufloResolveRoot(process.cwd());",
      },
    ],
  },
];

function discover(suffix) {
  const found = [];
  let hashes;
  try { hashes = fs.readdirSync(NPX_ROOT); } catch { return found; }
  for (const h of hashes) {
    const full = path.join(NPX_ROOT, h, 'node_modules', ...suffix);
    if (fs.existsSync(full)) found.push(full);
  }
  return found;
}

function patchFile(file, target) {
  const backup = `${file}.rrg-backup`;
  let src = fs.readFileSync(file, 'utf8');
  if (src.includes(MARKER)) return 'already-patched';
  for (const e of target.edits) {
    if (!src.includes(e.find)) return `skip:anchor-not-found`;
  }
  if (!fs.existsSync(backup)) fs.copyFileSync(file, backup);
  src = RESOLVER_SRC_ESM + '\n' + src;
  for (const e of target.edits) src = src.replace(e.find, e.replace);
  fs.writeFileSync(file, src);
  return 'patched';
}

function revertFile(file) {
  const backup = `${file}.rrg-backup`;
  if (!fs.existsSync(backup)) return 'no-backup';
  fs.copyFileSync(backup, file);
  fs.unlinkSync(backup);
  return 'reverted';
}

// Programmatic API. Returns { patched, skipped, reverted, log[] }.
export function run({ revert = false } = {}) {
  const result = { patched: 0, skipped: 0, reverted: 0, log: [] };
  for (const target of TARGETS) {
    for (const file of discover(target.suffix)) {
      try {
        if (revert) {
          if (revertFile(file) === 'reverted') { result.reverted++; result.log.push(`reverted ${target.label}: ${file}`); }
        } else {
          const r = patchFile(file, target);
          if (r === 'patched') { result.patched++; result.log.push(`patched ${target.label}: ${file}`); }
          else if (r.startsWith('skip')) { result.skipped++; result.log.push(`${r} (${target.label}): ${file}`); }
        }
      } catch (err) {
        result.log.push(`error ${file}: ${err.message}`);
      }
    }
  }
  return result;
}
