// Native #79 launcher readiness. This intentionally covers only the process identity/replacement
// half: doctor still needs the downstream live-listener probe, so this is not a retirement signal.

export function isNativeConsoleLifecycleSource(source) {
  return source.includes("from './console-runtime-identity.mjs'")
    && source.includes('const RUNTIME_SOURCE_SHA256 = consoleRuntimeDigest(REPO);')
    && source.includes("path: '/api/runtime/shutdown'")
    && source.includes("url === '/api/runtime'")
    && source.includes("url === '/api/runtime/shutdown'")
    && source.includes("state: current ? 'current' : 'stale-running'")
    && source.includes("? { state: 'foreign-port'")
    && source.includes("? { state: 'legacy-unowned'")
    && source.includes('requestRuntimeShutdown(receipt.port, receipt.controlToken)')
    && source.includes('await waitForRuntimeToStop(receipt.port)')
    && source.includes('sourceSha256: RUNTIME_SOURCE_SHA256')
    && source.includes("'scriptRealpath', 'runtimeVersion', 'sourceSha256'")
    && source.includes('export { inspectConsoleRuntime, launchConsole, runtimeReceiptPath, startServer };')
    && !source.includes("update(fs.readFileSync(RUNTIME_SCRIPT)).digest('hex')");
}
