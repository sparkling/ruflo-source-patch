// #377: execute upstream producer/consumer bodies with inert persistence.
import fs from 'node:fs';
import vm from 'node:vm';
import { discover, hasPatch } from './patcher.mjs';

export function nativeLearningReceipts(source) {
  if (hasPatch(source)) return false;
  const parent = source.match(/export function captureLearning\([\s\S]*?\n\}/)?.[0];
  const child = source.match(/function runDetached\([\s\S]*?\n\}/)?.[0];
  if (!parent || !child) return false;
  try {
    for (const enabled of [true, false]) {
      for (const fails of [true, false]) {
        const events = [];
        const context = vm.createContext({
          process: { env: { RUVNET_LEARN_OBSERVATION: JSON.stringify({ tool: 'Bash', action: 'git status' }), RUVNET_LEARN_SLOT: 'slot' } },
          learningContext: () => ({ enabled }), resolveRuflo: () => 'inert',
          defaultBrainHome: () => '/inert', safeAction: () => 'git status',
          observationKey: () => 'key', recentlyCaptured: () => false,
          captureInFlight: () => false, acquireObserveSlot: () => 'slot',
          markInFlight: () => events.push('pending'),
          detachLearning: () => { events.push('detach'); return true; },
          markCaptured: () => events.push('captured'),
          clearInFlight: () => events.push('clear'), releaseObserveSlot: () => events.push('release'),
          recordHookFailure: () => events.push('failure'), shedObservation: () => false,
          recordLearningObservation: () => { events.push('readback'); if (fails) throw Error('unverified write'); },
          distillObservations: () => { throw Error('unexpected distillation'); },
        });
        vm.runInContext(parent.replace('export ', '') + '\n' + child, context, { timeout: 100 });
        const run = expression => vm.runInContext(expression, context, { timeout: 100 });
        run("captureLearning({tool_name:'Bash'}, {detach:true})");
        if (events.includes('captured') || events.includes('readback')) return false;
        if (enabled !== events.includes('detach')) return false;
        events.length = 0;
        run("runDetached('--observe')");
        if (events.includes('captured') !== (enabled && !fails)) return false;
        if (enabled && !events.includes('readback')) return false;
        if (enabled && fails && !events.includes('failure')) return false;
        if (enabled && !events.includes('clear')) return false;
        if (!events.includes('release')) return false;
        if (enabled && !fails && events.indexOf('captured') < events.indexOf('readback')) return false;
        events.length = 0;
        run("captureLearning({tool_name:'Bash'}, {detach:false})");
        if (events.includes('captured') !== (enabled && !fails)) return false;
      }
    }
    return true;
  } catch { return false; }
}

export function learningReceiptsSupersession() {
  return { issue: 'https://github.com/stuinfla/ruvnet-brain/issues/377',
    replacement: 'native capture acknowledgement after exact readback, with separate in-flight coalescing',
    check() {
      try {
        const files = discover();
        if (!files.length) return { state: 'unknown', evidence: 'no installed learning capture source' };
        for (const file of files) {
          if (!fs.lstatSync(file).isFile() || !nativeLearningReceipts(fs.readFileSync(file, 'utf8')))
            return { state: 'live', evidence: 'native producer/child receipt proof failed' };
        }
        return { state: 'superseded', evidence: `${files.length} native capture modules pass deferred, synchronous, failed-readback and withdrawn-consent probes without a memory driver` };
      } catch (error) { return { state: 'unknown', evidence: error.message }; }
    } };
}
