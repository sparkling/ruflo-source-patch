// Host executable discovery injected into Ruflo's compiled plugin command.
//
// A SessionStart hook, cron task, SSH command, or migrated shell snapshot may
// carry a deliberately narrow or stale PATH/HOME. Resolve only bounded,
// validated executable candidates and keep the effective OS account home as an
// independent authority from the environment-provided HOME.

export function __rspHostAccountHomes(os) {
  const homes = [];
  const add = (home) => {
    if (typeof home === 'string' && home && !homes.includes(home)) homes.push(home);
  };
  try { add(os.userInfo().homedir); } catch {}
  try { add(os.homedir()); } catch {}
  return homes;
}

export function __rspHostExecutableDirs(env, accountHomes, path) {
  const dirs = [];
  const add = (dir) => {
    if (typeof dir === 'string' && path.isAbsolute(dir) && !dirs.includes(dir)) dirs.push(dir);
  };
  for (const dir of String(env.PATH || '').split(path.delimiter)) add(dir);
  add(env.XDG_BIN_HOME);
  add(env.PNPM_HOME);
  if (env.VOLTA_HOME) add(path.join(env.VOLTA_HOME, 'bin'));
  if (env.BUN_INSTALL) add(path.join(env.BUN_INSTALL, 'bin'));
  if (env.MISE_DATA_DIR) add(path.join(env.MISE_DATA_DIR, 'shims'));
  if (env.ASDF_DATA_DIR) add(path.join(env.ASDF_DATA_DIR, 'shims'));
  for (const home of [env.HOME, ...(Array.isArray(accountHomes) ? accountHomes : [])]) {
    if (typeof home !== 'string' || !path.isAbsolute(home)) continue;
    for (const relative of [
      ['.local', 'bin'], ['.npm-global', 'bin'], ['.volta', 'bin'], ['.bun', 'bin'],
      ['.local', 'share', 'mise', 'shims'], ['.asdf', 'shims'], ['Library', 'pnpm'],
    ]) add(path.join(home, ...relative));
  }
  if (env.NPM_CONFIG_PREFIX) add(path.join(env.NPM_CONFIG_PREFIX, 'bin'));
  add('/usr/local/bin');
  add('/opt/homebrew/bin');
  return dirs;
}

export function __rspHostExecutableNames(command, platform, pathExt = '') {
  if (platform !== 'win32') return [command];
  const suffixes = String(pathExt || '.COM;.EXE;.CMD;.BAT')
    .split(';').map((value) => value.trim().toLowerCase()).filter(Boolean);
  return [...new Set([...suffixes.map((suffix) => `${command}${suffix}`), command])];
}

export async function __rspResolveHostExecutable(command) {
  if (!/^[a-z0-9-]+$/.test(command)) {
    throw new Error(`invalid host executable: ${command}`);
  }
  const [{ default: fs }, { default: os }, { default: path }] = await Promise.all([
    import('node:fs'), import('node:os'), import('node:path'),
  ]);
  const dirs = __rspHostExecutableDirs(process.env, __rspHostAccountHomes(os), path);

  const names = __rspHostExecutableNames(command, process.platform, process.env.PATHEXT);
  for (const dir of dirs) {
    for (const name of names) {
      const candidate = path.join(dir, name);
      try {
        fs.accessSync(candidate, fs.constants.X_OK);
        const real = fs.realpathSync(candidate);
        if (fs.statSync(real).isFile()) return real;
      } catch {}
    }
  }
  throw new Error(`${command} unavailable: not found on PATH or in a supported user install root`);
}

export function __rspWindowsHostInvocation(command, resolved, args, fs, path, nodeExecutable) {
  if (!/\.(?:cmd|bat)$/i.test(resolved)) return { executable: resolved, argv: args };
  if (!/\.cmd$/i.test(resolved)) {
    throw new Error(`${command} unavailable: arbitrary batch wrappers are not supported`);
  }
  const packageParts = command === 'codex'
    ? ['@openai', 'codex']
    : command === 'claude' ? ['@anthropic-ai', 'claude-code'] : null;
  if (!packageParts) throw new Error(`${command} unavailable: unknown npm command wrapper`);
  const wrapperDir = path.dirname(resolved);
  const roots = [path.join(wrapperDir, 'node_modules', ...packageParts)];
  if (path.basename(wrapperDir).toLowerCase() === '.bin') {
    roots.push(path.join(path.dirname(wrapperDir), ...packageParts));
  }
  const expectedName = packageParts.join('/');
  for (const root of roots) {
    try {
      const meta = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
      if (meta.name !== expectedName) continue;
      const declared = typeof meta.bin === 'string' ? meta.bin : meta.bin?.[command];
      if (typeof declared !== 'string' || !declared) continue;
      const target = path.resolve(root, declared);
      const relative = path.relative(root, target);
      if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) continue;
      if (!fs.statSync(target).isFile()) continue;
      return { executable: nodeExecutable, argv: [target, ...args] };
    } catch {}
  }
  throw new Error(`${command} unavailable: npm wrapper package identity could not be proven`);
}

export async function __rspHostExec(command, args, options = {}) {
  const [{ default: fs }, { default: path }, { spawnSync }] = await Promise.all([
    import('node:fs'), import('node:path'), import('node:child_process'),
  ]);
  const resolved = await __rspResolveHostExecutable(command);
  const invocation = process.platform === 'win32'
    ? __rspWindowsHostInvocation(command, resolved, args, fs, path, process.execPath)
    : { executable: resolved, argv: args };
  const { executable, argv } = invocation;
  const run = spawnSync(executable, argv, {
    encoding: 'utf8',
    timeout: 120000,
    maxBuffer: 16 * 1024 * 1024,
    shell: false,
    ...(options.cwd ? { cwd: options.cwd } : {}),
  });
  if (run.error) throw new Error(`${command} unavailable: ${run.error.message}`);
  if (run.status !== 0) {
    const detail = String(run.stderr || run.stdout || '').trim();
    throw new Error(`${command} ${args.join(' ')} exited ${run.status}${detail ? `: ${detail}` : ''}`);
  }
  return String(run.stdout || '');
}

export async function __rspHostJson(command, args) {
  const source = await __rspHostExec(command, args);
  try {
    return JSON.parse(source);
  } catch (error) {
    throw new Error(`${command} returned invalid JSON: ${error.message}`);
  }
}

export const HOST_DISCOVERY_FUNCTIONS = [
  __rspHostAccountHomes,
  __rspHostExecutableDirs,
  __rspHostExecutableNames,
  __rspResolveHostExecutable,
  __rspWindowsHostInvocation,
  __rspHostExec,
  __rspHostJson,
];

export const HOST_DISCOVERY_REVISION = '2026-08-17.3';
export const HOST_DISCOVERY_FRAGMENT = [
  `const __RSP_HOST_DISCOVERY_REVISION = ${JSON.stringify(HOST_DISCOVERY_REVISION)};`,
  ...HOST_DISCOVERY_FUNCTIONS.map((fn) => fn.toString()),
].join('\n');
