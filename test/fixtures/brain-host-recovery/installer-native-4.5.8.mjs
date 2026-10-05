// Exact public v4.5.8 installer boundaries; fixture does not run installation.
import { probeFreshCodexDeclarations } from '../scripts/codex-fresh-host-proof.mjs';
export function classifyHostConvergence(receipt, expectedVersion = PACKAGE_VERSION) {
  // Same 'ahead is not behind' rule as host convergence above (#123). A receipt written by a
  // NEWER generation than the installer currently running is not a version mismatch — it is a
  // machine that is further along. Only a receipt for an OLDER generation is stale.
  if (!receipt || !versionSatisfies(receipt.desiredVersion, expectedVersion)) {
    return { healthy: false, state: 'version-mismatch', action: `required version ${expectedVersion}` };
  }
  const hostStates = Object.values(receipt.hosts || {});
  // A host that is ready at the expected version and whose ONLY gap is PROVEN changed boot-level
  // declarations is converged: new sessions load the new hooks; only windows already open booted the
  // old ones (owner's Mac, 4.3.40 -> 4.4.0: a fresh `claude -p` loaded 4.4.0 and ran its hooks). That is
  // reported, not failed. An UNPROVEN boot surface (it could not be compared) still requires a restart.
  const openSessionsOnly = (host) => host?.state === 'ready' && versionSatisfies(host.version, expectedVersion)
    && host.restartRequired === true && host.restartScope === 'open-sessions';
  const openSessions = Object.entries(receipt.hosts || {}).filter(([, host]) => openSessionsOnly(host)).map(([name]) => name);
  const badHost = hostStates.find((host) => !openSessionsOnly(host) && (!['ready', 'disabled', 'absent'].includes(host?.state)
    || (host.state === 'ready' && !versionSatisfies(host.version, expectedVersion))
    || (host.state === 'ready' && host.restartRequired === true)));
  if (badHost?.restartRequired === true) {
    return { healthy: false, state: 'host-restart-required', action: badHost.sessionSafetyReason || 'restart the host, then re-run --doctor' };
  }
  if (badHost) return { healthy: false, state: 'host-pending', action: 're-run host synchronization' };
  if (receipt.consoleRuntime?.state !== 'ready') {
    const why = Array.isArray(receipt.consoleRuntime?.replacementFailures) && receipt.consoleRuntime.replacementFailures.length
      ? `the installer could not replace the running Console (${receipt.consoleRuntime.replacementFailures.join('; ')}); ` : '';
    return { healthy: false, state: receipt.consoleRuntime?.state || 'console-unproven', action: `${why}restart Console, then re-run --doctor` };
  }
  if (openSessions.length) return { healthy: true, state: 'channels-converged', openSessions, notice: openSessionsNotice(openSessions, receipt.desiredVersion) };
  return { healthy: true, state: 'channels-converged' };
}

/** Activation and host readiness */
export function reconcileFreshCodexDeclarations(recorded, proof, expectedVersion = PACKAGE_VERSION) {
  const original = classifyHostConvergence(recorded, expectedVersion);
  const codex = recorded?.hosts?.codex;
  if (!proof?.ok || proof.state !== 'fresh-declarations-ready' || proof.expectedVersion !== expectedVersion
    || recorded?.desiredVersion !== expectedVersion || codex?.version !== expectedVersion
    || codex.state !== 'ready' || codex.restartRequired !== true || codex.restartScope !== 'unproven') return original;
  // Older receipts carry the paths only in this machine-generated reason. An unknown reason,
  // body file, skill/command surface, or MCP declaration retains the historical restart refusal.
  const prefix = 'boot-level declarations changed: ';
  const reason = codex.sessionSafetyReason;
  const changed = typeof reason === 'string' && reason.startsWith(prefix) ? reason.slice(prefix.length).split(', ') : [];
  if (!changed.length || changed.some((file) => !['hooks/codex-hooks.json', 'hooks/hooks.json'].includes(file))) {
    return { ...original, freshDeclarations: proof, notice: 'Fresh Codex hook declarations are ready; executable/MCP boot readiness and existing open windows remain unproven.' };
  }
  const projected = classifyHostConvergence({ ...recorded, hosts: { ...recorded.hosts,
    codex: { ...codex, restartScope: 'open-sessions' } } }, expectedVersion);
  return { ...projected, ...(projected.healthy ? { state: 'fresh-declarations-ready' } : {}), freshDeclarations: proof,
    notice: 'Fresh Codex hook declarations are ready; hook bodies and MCP execution were not tested. Existing open windows remain unproven.' };
}

const HOST_LABELS = {};
async function doctorFixture() {
      hostConvergence = classifyHostConvergence(recorded);
      const codex = recorded.hosts?.codex;
      if (codex?.state === 'ready' && codex.restartRequired === true && codex.restartScope === 'unproven') {
        let binary = process.env.CODEX_BIN || 'codex';
        if (!process.env.CODEX_BIN) {
          try {
            const configured = JSON.parse(fs.readFileSync(path.join(path.dirname(convergencePath), 'model-routing', 'terminal-launcher-config.json'), 'utf8'));
            if (typeof configured.realCodex === 'string' && path.isAbsolute(configured.realCodex)) binary = configured.realCodex;
          } catch { /* native PATH resolution remains bounded and fail closed */ }
        }
        const fresh = await probeFreshCodexDeclarations({ binary, codexHome: codexHomeDir(), cwd: process.cwd(),
          releasedPluginRoot: path.join(REPO_ROOT, 'plugin'), expectedVersion: PACKAGE_VERSION });
        hostConvergence = reconcileFreshCodexDeclarations(recorded, fresh);
        if (fresh.ok) info('Codex fresh-declarations-ready: current trusted hook declarations only; hook bodies and MCP execution were not tested. Existing open windows remain unproven.');
        else warn(`Codex fresh declarations remain unproven: ${fresh.reason}`);
      }
      if (hostConvergence.healthy) {}
}
