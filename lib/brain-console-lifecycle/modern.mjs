// Native receipt format and whole-runtime identity are owned by Brain's console inspector.
export const MODERN_MARKER = 'brain-console-lifecycle:structured-doctor';
const HELPER = `async function consoleRuntimeStatus(cacheDir) {
  const entry = path.join(cacheDir, '.console-runtime', 'scripts', 'onboarding-console.mjs');
  try {
    const native = await import(pathToFileURL(entry).href);
    if (typeof native.inspectConsoleRuntime !== 'function') return { state: 'missing-inspector', healthy: false };
    const home = process.env.RUVNET_BRAIN_HOME || path.join(os.homedir(), '.cache', 'ruvnet-brain');
    const dir = path.join(home, 'console-instances');
    const scopes = new Set([process.cwd()]);
    let names = [];
    try { names = fs.readdirSync(dir).filter((name) => name.endsWith('.json')); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (names.length > 100) return { state: 'receipt-limit', healthy: false };
    for (const name of names) {
      const file = path.join(dir, name), stat = fs.lstatSync(file);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 16384) return { state: 'receipt-invalid', healthy: false };
      const receipt = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (receipt.product !== 'ruvnet-brain-console' || receipt.schema !== 1
        || typeof receipt.scope !== 'string' || !path.isAbsolute(receipt.scope)) return { state: 'receipt-invalid', healthy: false };
      scopes.add(receipt.scope);
    }
    let instances = 0;
    for (const cwd of scopes) {
      const status = await native.inspectConsoleRuntime({ cwd });
      if (!['current', 'not-running', 'foreign-port'].includes(status.state)) return { ...status, healthy: false };
      if (status.state === 'foreign-port' && Number.isInteger(status.port)) {
        for (const route of ['/api/runtime', '/']) {
          try {
            const response = await fetch('http://127.0.0.1:' + status.port + route, { signal: AbortSignal.timeout(800) });
            const reader = response.body.getReader();
            let text = '', bytes = 0;
            try {
              while (bytes < 8192) {
                const chunk = await reader.read(); if (chunk.done) break;
                const remaining = 8192 - bytes;
                text += new TextDecoder().decode(chunk.value.subarray(0, remaining));
                bytes += chunk.value.length;
              }
            } finally { await reader.cancel(); }
            if ((route === '/api/runtime' && JSON.parse(text)?.product === 'ruvnet-brain-console')
              || (route === '/' && /RuvNet Brain/.test(text))) return { state: 'legacy-unowned', healthy: false, port: status.port };
          } catch { /* no Brain identity was observed; preserve the foreign listener */ }
        }
      }
      if (status.state === 'current') instances++;
    }
    return { state: instances ? 'current' : 'stopped', healthy: true, instances };
  } catch (error) { return { state: 'console-unproven', healthy: false, reason: error.message }; }
}`;
export function modernInstallerEdits(marker, anchor, outputOriginal, outputPatched) {
  const helper = `// ${marker}: ${MODERN_MARKER}.\n${HELPER}\n\n${anchor}`;
  const verdict = "    check('host-convergence', 'Hosts sync', !hostConvergence.healthy, hostConvergence.state, 'npx ruvnet-brain --update'),";
  const gated = `${verdict}\n    check('console-runtime', 'Console runtime', !consoleRuntime.healthy, consoleRuntime.state,\n      'Launch /rvbc to activate the current runtime safely'),`;
  return [
    ['doctor-native-classifier', anchor, helper, (source) => source.includes(helper)],
    ['doctor-output', outputOriginal, outputPatched, (source) => source.includes(outputPatched)],
    ['doctor-structured-gate', verdict, gated, (source) => source.includes(gated)],
  ];
}
