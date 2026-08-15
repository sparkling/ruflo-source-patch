import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  apply,
  filesForEntry,
  nativeDaemonAutostartSatisfied,
  nativeDaemonCommandSatisfied,
  scanUncoveredBuilds,
} from './patch-library.mjs';
import { readState } from './state.mjs';

function probeResolver(file) {
  const program = String.raw`
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const file = process.argv[1];
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rsp-daemon-native-'));
const marker = (dir) => {
  fs.mkdirSync(path.join(dir, '.claude-flow'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.claude-flow', 'config.json'), '{}\n');
};
try {
  const mod = await import(pathToFileURL(file).href + '?rsp=' + Date.now());
  if (typeof mod.resolveDaemonProjectRoot !== 'function') process.exit(10);
  const resolve = mod.resolveDaemonProjectRoot;

  const project = path.join(root, 'project');
  const deep = path.join(project, 'packages', 'one', 'src');
  fs.mkdirSync(deep, { recursive: true });
  marker(project);
  if (resolve(deep) !== project) process.exit(11);

  const nested = path.join(project, 'packages', 'one');
  marker(nested);
  if (resolve(deep) !== nested) process.exit(12);

  const ancestor = path.join(root, 'ancestor');
  const repo = path.join(ancestor, 'repo');
  const repoDeep = path.join(repo, 'src', 'deep');
  fs.mkdirSync(path.join(repo, '.git'), { recursive: true });
  fs.mkdirSync(repoDeep, { recursive: true });
  marker(ancestor);
  if (resolve(repoDeep) !== repoDeep) process.exit(13);

  const bare = path.join(root, 'bare', 'deep');
  fs.mkdirSync(bare, { recursive: true });
  if (resolve(bare) !== bare) process.exit(14);
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
`;
  const run = spawnSync(process.execPath, ['--input-type=module', '--eval', program, file], {
    encoding: 'utf8', timeout: 10000, maxBuffer: 1024 * 1024,
  });
  if (run.error) return { ok: false, evidence: `${file}: ${run.error.message}` };
  if (run.status !== 0) {
    return {
      ok: false,
      evidence: `${file}: resolver behavior probe exited ${run.status}${run.stderr ? ` (${run.stderr.trim()})` : ''}`,
    };
  }
  return { ok: true };
}

export function checkDaemonSupersession() {
  const autostarts = filesForEntry('cwd/daemon-autostart');
  const commands = filesForEntry('daemon/command-root');
  if (!autostarts.length || !commands.length) {
    return {
      state: 'unknown',
      evidence: `cannot prove native daemon routing (autostart copies=${autostarts.length}, command copies=${commands.length})`,
    };
  }

  const uncovered = scanUncoveredBuilds();
  if (uncovered.length) {
    return { state: 'live', evidence: `runnable daemon build remains uncovered: ${uncovered.join('; ')}` };
  }

  const old = [];
  for (const file of autostarts) {
    let source;
    try { source = fs.readFileSync(file, 'utf8'); } catch (error) {
      return { state: 'unknown', evidence: `cannot read ${file}: ${error.message}` };
    }
    if (!nativeDaemonAutostartSatisfied(source)) old.push(file);
  }
  for (const file of commands) {
    let source;
    try { source = fs.readFileSync(file, 'utf8'); } catch (error) {
      return { state: 'unknown', evidence: `cannot read ${file}: ${error.message}` };
    }
    if (!nativeDaemonCommandSatisfied(source)) old.push(file);
  }
  if (old.length) {
    return {
      state: 'live',
      evidence: `${old.length}/${autostarts.length + commands.length} installed daemon copy(ies) still need local project-root routing (${old.join(', ')})`,
    };
  }

  for (const file of autostarts) {
    const probe = probeResolver(file);
    if (!probe.ok) return { state: 'unknown', evidence: probe.evidence };
  }
  return {
    state: 'superseded',
    evidence: `all ${commands.length} command and ${autostarts.length} autostart copy(ies) route daemon identity through the native nearest-project resolver; nested, independently initialized, git-boundary, and no-marker behavior passed`,
  };
}

export const daemonSupersession = {
  issue: 'https://github.com/ruvnet/ruflo/issues/2877',
  replacement: 'Ruflo\'s native resolveDaemonProjectRoot routing for autostart and every direct daemon command',
  check: checkDaemonSupersession,
  retire: () => {
    const remaining = readState().patchTargets.filter((target) => target !== 'daemon');
    return apply(remaining);
  },
};
