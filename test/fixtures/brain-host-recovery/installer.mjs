// Upstream 4.5.5 bin/install.mjs excerpts; execution harness supplies native dependencies.
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


async function doctorProbe(recorded) {
      hostConvergence = classifyHostConvergence(recorded);
}
function doctorChecks() {
  const checks = [
    check('host-convergence', 'Hosts sync', !hostConvergence.healthy, hostConvergence.state, 'npx ruvnet-brain --update'),
  ];
  return checks;
}
