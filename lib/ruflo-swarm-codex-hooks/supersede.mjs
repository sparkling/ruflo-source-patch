import { probeNativeSwarmHooksReplacement } from './patcher.mjs';
export function rufloSwarmCodexHooksSupersession() {
  return { issue: 'https://github.com/ruvnet/ruflo/issues/3688',
    replacement: 'host-native Codex swarm command-hook manifest without Claude Code function modules',
    check: probeNativeSwarmHooksReplacement };
}
