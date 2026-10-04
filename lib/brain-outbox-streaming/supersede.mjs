import fs from 'node:fs';
import { discover, hasPatch } from './patcher.mjs';
import { probeOutboxStreamingBehavior } from './probe.mjs';
export function brainOutboxStreamingSupersession() {
  return { issue: 'https://github.com/stuinfla/ruvnet-brain/issues/387',
    replacement: 'native bounded JSONL and final-record reads preserving complete outbox evidence',
    check() {
      try {
        const files = discover();
        if (!files.length) return { state: 'unknown', evidence: 'no native outbox module selected' };
        for (const file of files) {
          if (hasPatch(fs.readFileSync(file, 'utf8'))) return { state: 'live', evidence: 'local streaming patch cannot prove native replacement' };
          const proof = probeOutboxStreamingBehavior(file); if (proof.state !== 'proven') return proof;
        }
        return { state: 'superseded', evidence: `all ${files.length} marker-free native outboxes pass bounded reads and exact native durability/quarantine behavior` };
      } catch (error) { return { state: 'unknown', evidence: error.message }; }
    } };
}
