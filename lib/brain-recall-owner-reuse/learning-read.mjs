// Brain #521: reuse its existing bounded public-memory reader for exact observations.
// The strict store, consent checks, constructor, deadlines and final comparison stay native.
function readLearningThroughNativeProcess(binary, args, db, options) {
  if (args.length !== 9 || args[0] !== 'memory' || args[1] !== 'retrieve'
      || args[2] !== '--key' || !/^workflow-[a-f0-9]{64}$/.test(args[3])
      || args[4] !== '--namespace' || args[5] !== 'learning-observations'
      || args[6] !== '--value-only' || args[7] !== '--path' || args[8] !== db) return null;
  const target = resolveBatchTarget(binary, { env: options.env, deadlineAt: options.deadline });
  if (!target) return null; // Qualification only: no operation has been dispatched.
  const timeout = Math.min(options.maxStepMs, options.deadline - Date.now());
  if (timeout <= 0) return { status: 1, stderr: 'learning deadline exhausted before native read' };
  const result = spawnSync(target.node,
    [fileURLToPath(new URL('./agentdb-recall-reader.mjs', import.meta.url)), '--session', db, target.moduleUrl], {
      cwd: options.cwd, env: { ...options.env, RUFLO_DAEMON_AUTOSTART: '0', CLAUDE_FLOW_AUTO_UPDATE: 'false' },
      input: JSON.stringify({ id: 1, op: 'get', key: args[3], namespace: args[5] }) + '\n',
      encoding: 'utf8', shell: false, timeout, killSignal: 'SIGKILL', maxBuffer: options.maxBuffer, windowsHide: true,
    });
  if (result.error || result.signal || result.status !== 0) return result;
  try {
    const rows = String(result.stdout || '').trim().split('\n').map(line => JSON.parse(line));
    if (rows.length === 1 && rows[0].ready === false) return null; // Reader refused capability before accepting input.
    if (rows.length !== 2 || rows[0].ready !== true || rows[1].id !== 1
        || rows[1].state !== 'ok' || typeof rows[1].value !== 'string')
      return { status: 1, stderr: 'Native exact observation read unavailable' };
    return { status: 0, stdout: rows[1].value, stderr: result.stderr };
  } catch { return { status: 1, stderr: 'Invalid native exact observation read response' }; }
}

export const learningSpec = { relative: 'scripts/learning-store.mjs', edits: [
  ['learning-reader-imports', "import { spawnSync } from 'node:child_process';",
    "import { spawnSync } from 'node:child_process';\nimport { fileURLToPath } from 'node:url';\nimport { resolveBatchTarget } from './agentdb-recall-process.mjs';"],
  ['learning-reader-helper', 'export function runLearningRuflo(binary, args, db,',
    `// ruflo-source-patch brain#429 owner-reuse: Brain #521 exact learning reads reuse the native reader.\n${readLearningThroughNativeProcess.toString()}\n\nexport function runLearningRuflo(binary, args, db,`],
  ['learning-reader-deadline', '  const remaining = deadline - Date.now();',
    '  let remaining = deadline - Date.now();'],
  ['learning-reader-dispatch', '    const invocation = rufloInvocation(binary, args);',
    `    const read = readLearningThroughNativeProcess(binary, args, db, { env, deadline, maxStepMs, maxBuffer, cwd });
    if (read !== null) return read;
    remaining = deadline - Date.now();
    if (remaining <= 0) throw new Error('learning deadline exhausted');
    const invocation = rufloInvocation(binary, args);`],
] };

export const readerDrainEdits = [
  ['reader-flush-reply', "  const reply = (row) => write(JSON.stringify(row) + '\\n');",
    "  const reply = row => new Promise((resolve, reject) => write(JSON.stringify(row) + '\\n', error => error ? reject(error) : resolve()));"],
  ['reader-unavailable-flush', '    reply({ ready: false }); process.exit(0);',
    '    await reply({ ready: false }); process.exit(0);'],
  ['reader-pending', "  readline.createInterface({ input: process.stdin }).on('line', (line) => {",
    "  const pendingReads = new Set();\n  readline.createInterface({ input: process.stdin }).on('line', (line) => {"],
  ['reader-drain', "    run(request).catch(() => ({ state: 'unavailable' })).then((out) => reply({ id: request.id, ...out }));\n  }).on('close', () => process.exit(0));",
    `    const task = run(request).catch(() => ({ state: 'unavailable' })).then(out => reply({ id: request.id, ...out }));
    pendingReads.add(task);
    task.then(() => pendingReads.delete(task), () => { pendingReads.delete(task); process.exitCode = 1; });
  }).on('close', async () => {
    await Promise.allSettled([...pendingReads]);
    process.exit(process.exitCode || 0);
  });`],
];
