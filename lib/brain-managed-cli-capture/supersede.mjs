import fs from 'node:fs';
import path from 'node:path';
import { surfaces, SPECS, hasPatch } from './patcher.mjs';
import { probeCaptureBehavior } from './probe.mjs';
export function brainManagedCliCaptureSupersession() {
  return { issue: 'https://github.com/stuinfla/ruvnet-brain/issues/382',
    replacement: 'native redacted action projection before progression no-op comparison',
    check() {
      try {
        const selected = surfaces();
        if (!selected.length) return { state: 'unknown', evidence: 'no native progression bundle to prove' };
        for (const surface of selected) {
          if (SPECS.some(spec => hasPatch(fs.readFileSync(path.join(surface.root, spec.relative), 'utf8')))) {
            return { state: 'live', evidence: 'locally projected native actions cannot prove upstream replacement' };
          }
          const proof = probeCaptureBehavior(surface.root);
          if (proof.state !== 'proven') return proof;
        }
        return { state: 'superseded', evidence: `all ${selected.length} marker-free selected Brain bundles pass the native producer/writer action, retention, redaction and exact-receipt proof` };
      } catch (error) { return { state: 'unknown', evidence: error.message }; }
    } };
}
