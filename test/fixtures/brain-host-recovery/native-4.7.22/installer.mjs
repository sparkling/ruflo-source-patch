// Exact public Brain 4.7.22 host-recovery boundaries; never runs installation.
import { probeFreshCodexDeclarations } from '../scripts/codex-fresh-host-proof.mjs';
import { proveCodexBootSurface, parseChangedPaths } from '../scripts/codex-boot-surface-proof.mjs';
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
export function reconcileFreshCodexDeclarations(recorded, proof, expectedVersion = PACKAGE_VERSION, bootSurface = null) {
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
  const hookFilesOnly = changed.length > 0 && changed.every((file) => ['hooks/codex-hooks.json', 'hooks/hooks.json'].includes(file));
  // #391: every changed path proven by the boot-surface proof (same list as the receipt names) clears the unproven
  // scope. The proof's own existingWindows:'unproven' and hostRelaunch:'not-observed' stay on the result.
  const bootProven = !hookFilesOnly && bootSurface?.ok === true && bootSurface.state === 'boot-surface-ready'
    && bootSurface.changed?.length === changed.length && changed.every((file) => bootSurface.changed.includes(file));
  if (!hookFilesOnly && !bootProven) {
    return { ...original, freshDeclarations: proof, ...(bootSurface ? { bootSurface } : {}),
      notice: bootSurface?.reason ? `Fresh Codex hook declarations are ready; boot surface unproven — ${bootSurface.reason}. Existing open windows remain unproven.`
        : 'Fresh Codex hook declarations are ready; executable/MCP boot readiness and existing open windows remain unproven.' };
  }
  const projected = classifyHostConvergence({ ...recorded, hosts: { ...recorded.hosts,
    codex: { ...codex, restartScope: 'open-sessions' } } }, expectedVersion);
  if (bootProven) {
    return { ...projected, ...(projected.healthy ? { state: 'boot-surface-ready' } : {}), freshDeclarations: proof, bootSurface,
      notice: 'Fresh Codex boot surface is proven for new sessions (hook shim run, MCP initialize + tools/list); existing open windows remain unproven and a host relaunch was not observed.' };
  }
  return { ...projected, ...(projected.healthy ? { state: 'fresh-declarations-ready' } : {}), freshDeclarations: proof,
    notice: 'Fresh Codex hook declarations are ready; hook bodies and MCP execution were not tested. Existing open windows remain unproven.' };
}

/** Prove the changed Codex boot paths against the plugin tree Codex loads. Read-only; `declarations` is a fresh-declarations probe. */
async function proveCodexBootSurfaceHere(changedPaths, declarations) {
  const codexHome = codexHomeDir();
  let installedPluginRoot = declarations?.pluginRoot || null;
  if (!installedPluginRoot) { try { installedPluginRoot = codexInstalledPluginRoot({ codexHome }); } catch { installedPluginRoot = null; } }
  return await proveCodexBootSurface({ changedPaths, declarations, installedPluginRoot,
    releasedPluginRoot: path.join(REPO_ROOT, 'plugin') });
}

async function proveCodexBootSurfaceDefault({ changedPaths }) {
  let declarations;
  try {
    declarations = await probeFreshCodexDeclarations({ binary: codexAdministrativeProbeBinary(), codexHome: codexHomeDir(), cwd: process.cwd(),
      releasedPluginRoot: path.join(REPO_ROOT, 'plugin'), expectedVersion: PACKAGE_VERSION });
  } catch (error) { declarations = { ok: false, reason: error?.message || String(error) }; }
  return await proveCodexBootSurfaceHere(changedPaths, declarations);
}

const HOST_LABELS = {};
export function codexAdministrativeProbeBinary() {
  if (process.env.CODEX_BIN) return process.env.CODEX_BIN;
  try {
    const brainHome = process.env.RUVNET_BRAIN_HOME || path.join(os.homedir(), '.cache', 'ruvnet-brain');
    const configured = JSON.parse(fs.readFileSync(path.join(brainHome, 'model-routing', 'terminal-launcher-config.json'), 'utf8'));
    if (typeof configured.realCodex === 'string' && path.isAbsolute(configured.realCodex)) return configured.realCodex;
  } catch { /* absent or malformed configuration retains the ordinary bounded PATH probe */ }
  return 'codex';
}

function codexHooksList() {}
async function doctorFixture() {
      hostConvergence = classifyHostConvergence(recorded);
      const codex = recorded.hosts?.codex;
      if (codex?.state === 'ready' && codex.restartRequired === true && codex.restartScope === 'unproven') {
        const binary = codexAdministrativeProbeBinary();
        const fresh = await probeFreshCodexDeclarations({ binary, codexHome: codexHomeDir(), cwd: process.cwd(),
          releasedPluginRoot: path.join(REPO_ROOT, 'plugin'), expectedVersion: PACKAGE_VERSION });
        // Issue #391: a receipt that names the hook shim, MCP server or skills/ as changed is proven path by path
        // (scripts/codex-boot-surface-proof.mjs). Doctor only READS: the receipt on disk is never rewritten here.
        const changedPaths = parseChangedPaths(codex.sessionSafetyReason);
        const needsBootProof = changedPaths.some((file) => !['hooks/codex-hooks.json', 'hooks/hooks.json'].includes(file));
        const bootSurface = needsBootProof ? await proveCodexBootSurfaceHere(changedPaths, fresh) : null;
        hostConvergence = reconcileFreshCodexDeclarations(recorded, fresh, PACKAGE_VERSION, bootSurface);
        if (bootSurface?.ok) info(`Codex boot-surface-ready: ${bootSurface.proven.map((p) => p.path).join(', ')} proven for NEW sessions (real shim run, real MCP initialize + tools/list). Existing open windows remain unproven; a host relaunch was not observed.`);
        else if (bootSurface) warn(`Codex boot surface remains unproven: ${bootSurface.reason}`);
        else if (fresh.ok) info('Codex fresh-declarations-ready: current trusted hook declarations only; hook bodies and MCP execution were not tested. Existing open windows remain unproven.');
        else warn(`Codex fresh declarations remain unproven: ${fresh.reason}`);
      }
      if (hostConvergence.healthy) {}
}
