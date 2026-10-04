import fs from 'node:fs';
import path from 'node:path';
import { surfaces, SPECS, hasPatch } from './patcher.mjs';
import { probeDiagnosticsBehavior } from './probe.mjs';
export function brainManagedCliDiagnosticsSupersession() {
  return { issue: 'https://github.com/stuinfla/ruvnet-brain/issues/386',
    replacement: 'native terminal evidence alongside output and redacted durable observations',
    check() {
      try {
        const selected = surfaces();
        if (!selected.length) return { state: 'unknown', evidence: 'no native terminal diagnostic bundle selected' };
        for (const surface of selected) {
          if (SPECS.some(spec => hasPatch(fs.readFileSync(path.join(surface.root, spec.relative), 'utf8')))) return { state: 'live', evidence: 'local diagnostic patch cannot prove upstream replacement' };
          const proof = probeDiagnosticsBehavior(surface.root);
          if (proof.state !== 'proven') return proof;
        }
        return { state: 'superseded', evidence: `all ${selected.length} marker-free Brain bundles pass native terminal output/outcome/redacted durable receipt proofs` };
      } catch (error) { return { state: 'unknown', evidence: error.message }; }
    } };
}
