import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

// Brain 4.5.4 resolves the native runner from the host's CODEX_HOME. Full all-mode
// adoption must prove this replacement rather than reinstall the obsolete hooks.
const discoverySource = "const f=require('node:fs'),o=require('node:os'),p=require('node:path'),c=require('node:child_process'),d=process.env.CODEX_HOME||p.join(o.homedir(),'.codex'),b=process.env.RUVNET_BRAIN_HOME||p.join(p.dirname(d),'.cache','ruvnet-brain'),w=p.join(b,'codex-hook.mjs');let s;try{s=f.statSync(w)}catch{}if(!s?.isFile())process.exit(0);const r=c.spawnSync(process.execPath,[w,...process.argv.slice(2)],{stdio:['inherit','pipe','pipe'],encoding:'utf8',env:process.env,timeout:Number(process.argv[1]),killSignal:'SIGKILL'});if(r.status===0||r.status===2){if(r.stdout)process.stdout.write(r.stdout);if(r.stderr)process.stderr.write(r.stderr)}process.exit(r.status===2?2:0)";
const eventArguments = {
  SessionStart: ['session-start'],
  Stop: ['continuation-gate', 'session-snapshot Stop', 'grounding-turn-gate'],
  PreToolUse: ['session-snapshot PreToolUse', 'decision-gate write'],
  PostToolUse: ['session-snapshot PostToolUse', 'grounding-stamp'],
  UserPromptSubmit: ['session-snapshot UserPromptSubmit', 'unprompted-speech UserPromptSubmit',
    'ground-ruvnet', 'capacity-aware-parallel-work', 'grounding-turn-mark'],
  SessionEnd: ['session-snapshot SessionEnd'],
  SubagentStop: ['session-snapshot SubagentStop'],
};

function proveDiscovery(source, timeout, args) {
  // Execute only the exact audited native source, with fake fs/process/child
  // boundaries. Never invoke a real hook, resolve an active release, or change KB.
  if (source !== discoverySource) return false;
  for (const env of [{}, { CODEX_HOME: '/proof/custom-codex' },
    { CODEX_HOME: '/proof/custom-codex', RUVNET_BRAIN_HOME: '/proof/native-brain' }]) {
    const runner = path.join(env.RUVNET_BRAIN_HOME
      || path.join(path.dirname(env.CODEX_HOME || '/proof/home/.codex'), '.cache', 'ruvnet-brain'),
    'codex-hook.mjs');
    for (const status of [0, 2, 1, 'missing']) {
      let statPath, call, exit, stdout = '', stderr = '';
      const ended = {};
      const proc = {
        env, execPath: '/proof/node', argv: ['/proof/node', String(timeout), ...args],
        stdout: { write: (value) => { stdout += value; } },
        stderr: { write: (value) => { stderr += value; } },
        exit: (code) => { exit = code; throw ended; },
      };
      const modules = {
        'node:fs': { statSync: (file) => { statPath = file;
          if (status === 'missing') throw new Error('absent');
          return { isFile: () => true }; } },
        'node:os': { homedir: () => '/proof/home' },
        'node:path': path,
        'node:child_process': { spawnSync: (executable, argv, options) => {
          call = { executable, argv, options };
          return { status, stdout: 'native-output', stderr: 'native-diagnostic' };
        } },
      };
      try {
        vm.runInNewContext(source, { process: proc, require: (name) => {
          if (!Object.hasOwn(modules, name)) throw new Error('unexpected import');
          return modules[name];
        } }, { timeout: 100 });
        return false;
      } catch (error) { if (error !== ended) return false; }
      if (statPath !== runner || exit !== (status === 2 ? 2 : 0)) return false;
      if (status === 'missing') { if (call || stdout || stderr) return false; continue; }
      if (call?.executable !== proc.execPath
        || JSON.stringify(call.argv) !== JSON.stringify([runner, ...args])
        || JSON.stringify(call.options.stdio) !== JSON.stringify(['inherit', 'pipe', 'pipe'])
        || call.options.env !== env || call.options.encoding !== 'utf8'
        || call.options.timeout !== timeout || call.options.killSignal !== 'SIGKILL'
        || stdout !== (status === 1 ? '' : 'native-output')
        || stderr !== (status === 1 ? '' : 'native-diagnostic')) return false;
    }
  }
  return true;
}

function nativeCommand(event, hook) {
  if (hook?.type !== 'command' || typeof hook.command !== 'string') return false;
  const legacy = 'node "$HOME/.cache/ruvnet-brain/codex-hook.mjs" ';
  if (hook.command.startsWith(legacy)) {
    return eventArguments[event]?.includes(hook.command.slice(legacy.length)) === true;
  }
  const match = /^node -e "([^"\r\n]+)" ([1-9][0-9]*) ([A-Za-z0-9-]+(?: [A-Za-z0-9-]+)*)$/.exec(hook.command);
  if (!match || !eventArguments[event]?.includes(match[3])) return false;
  const timeout = Number(match[2]);
  if (!Number.isSafeInteger(timeout) || timeout > 120_000
    || !Number.isFinite(hook.timeout) || hook.timeout <= 0 || timeout >= hook.timeout * 1000) return false;
  return proveDiscovery(match[1], timeout, match[3].split(' '));
}

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

export function inspectNativeLifecycle({ root, brainHome, isOurs }) {
  const manifestFile = path.join(root, 'plugin', '.codex-plugin', 'plugin.json');
  const hooksFile = path.join(root, 'plugin', 'hooks', 'codex-hooks.json');
  const adapterFile = path.join(root, 'plugin', 'scripts', 'codex-hook-adapter.mjs');
  const nativeWrapper = path.join(brainHome, 'codex-hook.mjs');
  const manifestBody = (() => { try { return fs.readFileSync(manifestFile, 'utf8'); } catch { return ''; } })();
  const hooksBody = (() => { try { return fs.readFileSync(hooksFile, 'utf8'); } catch { return ''; } })();
  const adapterBody = (() => { try { return fs.readFileSync(adapterFile, 'utf8'); } catch { return ''; } })();
  const manifest = readJson(manifestFile);
  const hooks = readJson(hooksFile);
  // Brain 4.3.10 deliberately retired automatic host hooks. This is an
  // explicit native replacement for the old six-event lifecycle, not a
  // partially installed manifest to be repaired with compatibility hooks.
  const retired = Boolean(manifestBody) && !isOurs(manifestBody)
    && manifest?.name === 'ruvnet-brain'
    && manifest?.hooks === './hooks/codex-hooks.json'
    && !isOurs(hooksBody)
    && hooks?.description === 'RuvNet Brain automatic host hooks are intentionally retired. This schema-valid empty registry is shipped so install and update converge old hook-bearing generations to zero implicit lifecycle handlers.'
    && hooks?.hooks && typeof hooks.hooks === 'object'
    && !Array.isArray(hooks.hooks) && Object.keys(hooks.hooks).length === 0;
  const requiredEvents = ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'SessionEnd', 'Stop'];
  const entries = Object.entries(hooks?.hooks || {});
  const commands = entries.flatMap(([event, groups]) => Array.isArray(groups)
    ? groups.flatMap((group) => Array.isArray(group?.hooks)
      ? group.hooks.map((hook) => ({ event, hook })) : []) : []);
  const active = readJson(path.join(brainHome, 'active.json'));
  const activeRoot = typeof active?.codeRoot === 'string'
    ? (path.isAbsolute(active.codeRoot) ? active.codeRoot : path.join(brainHome, active.codeRoot))
    : null;
  const activeAdapter = activeRoot && path.join(activeRoot, 'scripts', 'codex-hook-adapter.mjs');
  const activeAdapterBody = (() => {
    try { return activeAdapter ? fs.readFileSync(activeAdapter, 'utf8') : ''; } catch { return ''; }
  })();
  const wrapperBody = (() => { try { return fs.readFileSync(nativeWrapper, 'utf8'); } catch { return ''; } })();

  const checks = [
    {
      label: 'upstream Codex plugin manifest',
      ok: Boolean(manifestBody)
        && !isOurs(manifestBody)
        && manifest?.name === 'ruvnet-brain'
        && manifest?.hooks === './hooks/codex-hooks.json',
    },
    {
      label: 'upstream Codex lifecycle manifest',
      ok: Boolean(hooksBody)
        && !isOurs(hooksBody)
        && requiredEvents.every((event) => commands.some((item) => item.event === event))
        && entries.every(([, groups]) => Array.isArray(groups) && groups.length > 0
          && groups.every((group) => Array.isArray(group?.hooks) && group.hooks.length > 0))
        && commands.length >= requiredEvents.length
        && commands.every(({ event, hook }) => nativeCommand(event, hook)),
    },
    {
      label: 'upstream Codex hook adapter',
      ok: Boolean(adapterBody)
        && !isOurs(adapterBody)
        && adapterBody.includes("RUVNET_HOOK_HOST: 'codex'")
        && adapterBody.includes('hook-shim.mjs'),
    },
    {
      label: 'installed stable wrapper and active adapter',
      ok: Boolean(wrapperBody)
        && wrapperBody.includes('active.json')
        && wrapperBody.includes('codex-hook-adapter.mjs')
        && Boolean(activeAdapterBody)
        && activeAdapterBody === adapterBody,
    },
  ];
  return {
    surface: Boolean(
      (manifestBody && !isOurs(manifestBody))
      || (hooksBody && !isOurs(hooksBody))
      || (adapterBody && !isOurs(adapterBody)),
    ),
    ready: checks.every((check) => check.ok),
    retired,
    checks,
  };
}
