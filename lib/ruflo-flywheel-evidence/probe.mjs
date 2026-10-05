import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { discover } from './patcher.mjs';
import { readState } from '../cwd/state.mjs';
import { composeSource } from '../plugin-compose.mjs';
export { exerciseFlywheelEvidence } from './exercise.mjs';
export function probeFlywheelEvidenceReplacement({ files = discover(), installed = readState().pluginTargets } = {}) {
  let temporary;
  try {
    if (!files.length) return { state: 'unknown', evidence: 'no installed native receipt module capability' };
    temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'rsp-flywheel-evidence-'));
    for (const [index, file] of files.entries()) {
      const read = candidate => {
        const stat = fs.lstatSync(candidate);
        if (!stat.isFile() || stat.isSymbolicLink() || !stat.size) throw new Error('unsafe native receipt source');
        return fs.readFileSync(candidate, 'utf8');
      };
      let source = read(file);
      if (source.includes('ruflo-source-patch')) {
        const pristine = read(file + '.rsp-backup');
        if (pristine.includes('ruflo-source-patch') || composeSource(pristine, installed, { file }) !== source)
          throw new Error('unproved pristine composition');
        source = pristine;
      }
      const fixture = path.join(temporary, `${index}.js`); fs.writeFileSync(fixture, source);
      const dependency = path.join(temporary, `${index}-dependency.js`);
      fs.writeFileSync(dependency, read(path.join(path.dirname(file), 'flywheel-sequential-evidence.js')));
      const child = spawnSync(process.execPath, ['--input-type=module', '-e',
        `import fs from 'node:fs'; import { exerciseFlywheelEvidence } from ${JSON.stringify(new URL('./exercise.mjs', import.meta.url).href)};
        try { await exerciseFlywheelEvidence(fs.readFileSync(process.argv[1], 'utf8'), fs.readFileSync(process.argv[2], 'utf8')); } catch (error) { console.error(error.message); process.exitCode = 1; }`, fixture, dependency],
      { encoding: 'utf8', timeout: 6000, maxBuffer: 1024 * 1024, env: { HOME: temporary, PATH: process.env.PATH || '' } });
      if (child.error || child.status !== 0) throw new Error(child.error?.message || child.stderr || 'native receipt proof failed');
    }
    return { state: 'superseded', evidence: `${files.length} pristine native receipt modules encode nested fractional evidence before identity/signing and preserve strict number, signature, field and tamper verification` };
  } catch (error) { return { state: 'live', evidence: `native flywheel evidence proof failed: ${error.message}` }; }
  finally { if (temporary) fs.rmSync(temporary, { recursive: true, force: true }); }
}
