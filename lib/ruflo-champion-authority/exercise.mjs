import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

export async function exerciseChampionAuthority(source) {
  const temporary = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'rsp-champion-proof-')));
  const key = '__rspChampionProof_' + randomUUID();
  let beforeWrite;
  let beforeRead;
  globalThis[key] = { ...fs,
    readFileSync(...args) { beforeRead?.(...args); return fs.readFileSync(...args); },
    writeFileSync(...args) { beforeWrite?.(...args); return fs.writeFileSync(...args); },
  };
  try {
    const imports = source.match(/import \* as fs from ['"](?:node:)?fs['"];?/g) || [];
    assert.equal(imports.length, 1, 'one native filesystem owner');
    const file = path.join(temporary, 'applier.mjs');
    fs.writeFileSync(file, source.replace(imports[0], `const fs = globalThis[${JSON.stringify(key)}];`));
    const api = await import(pathToFileURL(file).href);
    const root = path.join(temporary, 'project');
    const flow = path.join(root, '.claude-flow');
    const dir = path.join(flow, 'flywheel-v1');
    const active = path.join(flow, 'harness-active-policy.json');
    const state = path.join(dir, 'transaction-state.json');
    const lock = path.join(dir, 'transaction-state.lock');
    const adopted = path.join(root, '.claude', 'proven-config.json');
    const write = (f, value) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, typeof value === 'string' ? value : JSON.stringify(value)); };
    const snapshot = f => fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : null;
    const empty = () => ({ version: 1, activeChampionRef: null, activePolicy: null, activeGateVersion: null,
      activePolicySchemaVersion: null, activeSafetyEnvelopeRef: null, ledgerHead: 'sha256:' + '0'.repeat(64),
      servingEpoch: 0, materializedServingEpoch: 0, servedChampionRef: null, receiptStates: {}, commits: [] });
    const adopt = id => write(adopted, { championId: id, manifest: { layer: 'framework/node-cli', policy: { value: { alpha: 0.3 } } } });
    const assertRefused = (input = root) => {
      const policy = snapshot(active), authority = snapshot(state);
      const result = api.applyChampion(input);
      assert.equal(result.applied, false, `framework auto-apply must refuse: ${JSON.stringify(result)}`);
      assert.equal(snapshot(active), policy, 'serving policy bytes preserved');
      assert.equal(snapshot(state), authority, 'promotion authority bytes preserved');
      return result;
    };
    write(path.join(root, 'CLAUDE.md'), '# Isolated test project');
    fs.mkdirSync(path.dirname(adopted), { recursive: true });
    assert.equal(api.applyChampion(root).applied, false, 'no adopted champion remains a no-op');
    adopt('framework-one');
    assert.equal(api.applyChampion(root, { now: 1 }).applied, true, 'native initial baseline is retained');
    assert.deepEqual(JSON.parse(snapshot(active)).params, { alpha: 0.3 });
    assert.equal(api.applyChampion(root).applied, false, 'native idempotency is retained');
    adopt('framework-two');
    assert.equal(api.applyChampion(root).applied, true, 'framework update remains enabled without a local owner');
    assert.equal(JSON.parse(snapshot(active)).previous, 'framework-one');
    write(state, { ...empty(), receiptStates: { pendingEvaluation: { status: 'evaluated' } } });
    adopt('framework-three');
    assert.equal(api.applyChampion(root).applied, true, 'evaluation receipts alone do not own the policy');
    const owned = { ...empty(), activeChampionRef: 'local-one', activePolicy: { alpha: 0.6 },
      servingEpoch: 1, materializedServingEpoch: 1, servedChampionRef: 'local-one', commits: [{ candidateId: 'local-one', servingEpoch: 1 }] };
    write(state, owned);
    assert.equal(api.applyChampionParams(root, { championId: 'local-one', params: { alpha: 0.6 }, layer: 'repo/local' }).applied, true);
    const nested = path.join(root, 'nested'); fs.mkdirSync(nested);
    const nestedRefusal = assertRefused(source.includes('__rufloResolveRoot') ? nested : root);
    assert.match(nestedRefusal.reason, /flywheel promotion owns/, 'normalized root owns authority refusal');
    assert.equal(fs.existsSync(path.join(nested, '.claude-flow')), false, 'no nested lock or policy root');
    assert.equal(fs.existsSync(lock), false, 'owned lock is released on authority refusal');
    for (const invalid of [
      { ...owned, materializedServingEpoch: 0, servedChampionRef: null },
      { ...empty(), activeChampionRef: 'baseline-under-test' },
      { ...empty(), activeGateVersion: 'incomplete-owner' }, { ...empty(), ledgerHead: 'invalid' },
      { ...empty(), version: 2 }, { ...empty(), commits: null }, { ...empty(), receiptStates: [] },
      { version: 1 }, '{broken',
    ]) { write(state, invalid); assertRefused(); assert.equal(fs.existsSync(lock), false); }
    fs.unlinkSync(active); write(state, owned); assertRefused();
    assert.equal(fs.existsSync(active), false, 'pending materialization never invents a framework fallback');
    assert.equal(api.applyChampionParams(root, { championId: 'local-two', params: { alpha: 0.7 }, layer: 'repo/local' }).applied, true,
      'explicit native promotion writer remains unchanged');
    write(state, empty());
    write(lock, { pid: process.pid, at: 1 });
    fs.utimesSync(lock, new Date(0), new Date(0));
    const foreign = snapshot(lock), foreignStat = fs.statSync(lock);
    assertRefused(); assert.equal(snapshot(lock), foreign); assert.equal(fs.statSync(lock).ino, foreignStat.ino, 'never remove even an old foreign lock');
    fs.unlinkSync(lock);
    const external = path.join(temporary, 'external.json'); write(external, empty());
    fs.unlinkSync(state); fs.symlinkSync(external, state); assertRefused();
    assert.equal(fs.lstatSync(state).isSymbolicLink(), true); fs.unlinkSync(state);
    fs.symlinkSync(external, lock); assertRefused(); assert.equal(fs.lstatSync(lock).isSymbolicLink(), true); fs.unlinkSync(lock);
    write(state, empty());
    beforeRead = f => { if (f === state) throw Object.assign(new Error('unreadable state'), { code: 'EACCES' }); };
    const unreadable = api.applyChampion(root); beforeRead = undefined;
    assert.equal(unreadable.applied, false); assert.equal(fs.existsSync(lock), false);
    // Observe the shared native lock precisely at the active-policy write, including another process.
    beforeWrite = f => {
      if (f !== active) return;
      const owner = JSON.parse(fs.readFileSync(lock, 'utf8'));
      assert.equal(owner.pid, process.pid); assert.ok(Number.isFinite(owner.at));
      const child = spawnSync(process.execPath, ['-e',
        'try{require("fs").openSync(process.argv[1],"wx");process.exit(9)}catch(e){process.exit(e.code==="EEXIST"?0:8)}', lock],
      { timeout: 2000, encoding: 'utf8' });
      assert.equal(child.status, 0, 'native promotion cannot enter during startup check/write');
    };
    assert.equal(api.applyChampion(source.includes('__rufloResolveRoot') ? nested : root).applied, true);
    beforeWrite = undefined; assert.equal(fs.existsSync(lock), false);
    adopt('framework-four');
    beforeWrite = f => { if (f === active) throw new Error('write failed'); };
    assert.equal(api.applyChampion(root).applied, false); beforeWrite = undefined;
    assert.equal(fs.existsSync(lock), false, 'write failure releases only this invocation lock');
    beforeWrite = f => { if (f === active) { fs.renameSync(lock, lock + '.old'); write(lock, 'replacement'); } };
    assert.equal(api.applyChampion(root).applied, true); beforeWrite = undefined;
    assert.equal(snapshot(lock), 'replacement', 'replacement lock survives finally');
    return { preservedFrameworkBaseline: true, preservedModernAuthority: true, nativeLockSerialized: true };
  } finally {
    delete globalThis[key]; fs.rmSync(temporary, { recursive: true, force: true });
  }
}
