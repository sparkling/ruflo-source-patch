// Invoked by adr-io-safety.mjs to reuse its isolated CLI/state harness.
// Native helper copied verbatim from ruflo-adr 0.5.8 scripts/lib/ruflo-cli.mjs.
// Source: https://github.com/ruvnet/ruflo/blob/main/plugins/ruflo-adr/scripts/lib/ruflo-cli.mjs
// SHA-256 e4407e063e326e8521495d14a77bfb4aea0da45fbac23fb4cea2b38de1d49fc2
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { patchSource, historicalPatchSource, isPatched } from '../lib/adr-io-safety/patcher.mjs';
import { NATIVE_VERIFY_READ } from '../lib/adr-io-safety/modern.mjs';
import { applyComposed, reconcile } from '../lib/plugin-compose.mjs';

export async function testNativeAdr(harness) {
  const { check, run, reset, calls, operation, SCRIPTS, BIN, ALT_ROOT, REINDEX_VENDOR, RECORDS_VENDOR } = harness;
  const helper = fs.readFileSync(path.join(SCRIPTS, 'lib', 'ruflo-cli.mjs'), 'utf8');
  check('AIN1 native resolver fixture is exact upstream 0.5.8 source',
    createHash('sha256').update(helper).digest('hex') === 'e4407e063e326e8521495d14a77bfb4aea0da45fbac23fb4cea2b38de1d49fc2');
  const native = source => source.replace("import { spawnSync } from 'node:child_process';", "import { spawnCliSync } from './lib/ruflo-cli.mjs';")
    .replaceAll("spawnSync('npx', [", 'spawnCliSync([')
    .replace("spawnSync('npx', memoryStoreArgs(", 'spawnCliSync(memoryStoreArgs(');
  const vendors = Object.fromEntries(['verify.mjs', 'import.mjs'].map(name => [name,
    native(fs.readFileSync(new URL('./fixtures/adr-io-safety-0.4.1/' + name, import.meta.url), 'utf8'))]));
  vendors['reindex.mjs'] = native(REINDEX_VENDOR);
  vendors['lib/index-records.mjs'] = RECORDS_VENDOR;
  for (const [name, vendor] of Object.entries(vendors)) {
    const outcome = patchSource(vendor);
    check('AIN2 native ' + name + ' patches idempotently', !outcome.missing.length && isPatched(outcome.next)
      && patchSource(outcome.next).next === outcome.next);
    fs.writeFileSync(path.join(SCRIPTS, name), outcome.next);
  }
  const verify = fs.readFileSync(path.join(SCRIPTS, 'verify.mjs'), 'utf8');
  const nativeValidation = NATIVE_VERIFY_READ.slice(NATIVE_VERIFY_READ.indexOf('  const fail ='));
  check('AIN3 native fail-closed validation, cap and timeout remain byte-identical',
    verify.includes(nativeValidation) && verify.includes('const MAX_ROWS = 10_000;')
    && verify.includes('Number(process.env.ADR_VERIFY_TIMEOUT_MS) || 60_000')
    && !verify.includes('function memoryListComplete') && !verify.includes('const MANAGED_CLI ='));
  for (const name of ['verify.mjs', 'import.mjs', 'reindex.mjs']) {
    const source = fs.readFileSync(path.join(SCRIPTS, name), 'utf8');
    check('AIN3 native ' + name + ' retains shared resolver dispatch', source.includes("import { spawnCliSync } from './lib/ruflo-cli.mjs';")
      && !source.includes("import { spawnSync } from 'node:child_process';") && !source.includes('const MANAGED_CLI ='));
  }
  const verifyRun = extra => run('verify.mjs', { VERIFY_FORMAT: 'json', RUFLO_PLUGIN_SKIP_LOCAL_CLI: '1', ...extra });
  for (const mode of ['nonzero', 'signal', 'malformed', 'nonarray', 'bad-entry', 'wrong-namespace', 'timeout']) {
    reset();
    const result = verifyRun({ FAKE_MEMORY_MODE: mode, ADR_VERIFY_TIMEOUT_MS: '100' });
    check('AIN4 retained native verifier rejects ' + mode, result.status !== 0 && result.stdout.includes('readErrors'));
  }
  const ruflo = path.join(BIN, 'ruflo'), cliSource = fs.readFileSync(ruflo, 'utf8');
  try {
    fs.writeFileSync(ruflo, '#!/missing/ruflo-test-interpreter\n');
    reset();
    const result = verifyRun({});
    check('AIN4 retained native verifier rejects spawn error', result.status !== 0
      && result.stdout.includes('memory list failed:') && calls().length === 0);
  } finally { fs.writeFileSync(ruflo, cliSource); }
  reset();
  let result = verifyRun({ RUFLO_PLUGIN_SKIP_PATH_CLI: '1' });
  check('AIN4 missing installed owner refuses native npx fallback before dispatch', result.status !== 0
    && result.stdout.includes('No installed Ruflo CLI resolves') && calls().length === 0);
  const crowded = Object.fromEntries(Array.from({ length: 10001 }, (_, i) => [`ADR-${i}::x.md`, '{}']));
  reset({ 'adr-patterns': crowded, 'adr-edges': {}, listCalls: 0 });
  result = verifyRun({});
  check('AIN4 retained native 10001-row boundary refuses incomplete graph', result.status !== 0
    && result.stdout.includes('reached 10001 rows; completeness cannot be proven'));
  reset();
  result = verifyRun({ ADR_DB_ROOT: ALT_ROOT });
  check('AIN5 native reads bind exact explicit store despite nested scan root', result.status === 0 && calls().length === 2
    && calls().every(call => call.cwd === ALT_ROOT && call.args.includes('--path=' + path.join(ALT_ROOT, '.swarm', 'memory.db'))));
  reset();
  result = run('import.mjs', { IMPORT_FORMAT: 'json', ADR_DB_PATH: path.join(ALT_ROOT, '.swarm', 'memory.db') });
  check('AIN5 native importer retains exact readback on explicit path', result.status === 0
    && JSON.parse(result.stdout).verifiedWrites === 3 && calls().filter(call => operation(call) === 'retrieve').length === 3
    && calls().every(call => call.args.includes('--path=' + path.join(ALT_ROOT, '.swarm', 'memory.db'))));
  for (const mode of ['false-success', 'readback-mismatch', 'wrong-final']) {
    reset();
    result = run('import.mjs', { IMPORT_FORMAT: 'json', FAKE_MEMORY_MODE: mode });
    check('AIN5 native importer preserves ' + mode + ' failure', result.status !== 0 && JSON.parse(result.stdout).errors.length > 0);
  }
  reset({ 'adr-patterns': { 'ADR-001::x.md': '{}', 'ADR-002::x.md': '{}' },
    'adr-edges': { 'depends-on:ADR-001:ADR-002': JSON.stringify({ relation: 'depends-on', from: 'ADR-001', to: 'ADR-003' }) }, listCalls: 0 });
  result = verifyRun({});
  check('AIN5 native read safety retains residual edge-value identity proof', result.status !== 0
    && result.stderr.includes('edge value does not match key identity'));
  reset();
  result = run('reindex.mjs', { REINDEX_FORMAT: 'json' });
  check('AIN5 native reindex refuses before any purge or write', result.status !== 0 && calls().length === 0
    && JSON.parse(result.stdout).errors[0].includes('REFUSING'));
  const changedNative = vendors['verify.mjs'].replace("if (r.signal) return fail", "if (false && r.signal) return fail");
  check('AIN6 unknown native verifier change is refused', patchSource(changedNative).missing.length > 0);
  for (const [name, vendor] of Object.entries(vendors)) {
    const file = path.join(SCRIPTS, name);
    fs.writeFileSync(file + '.rsp-backup', vendor);
    fs.writeFileSync(file, historicalPatchSource(vendor).next);
  }
  const upgraded = applyComposed(['adr-io-safety']);
  check('AIN7 exact old native compositions upgrade without rebaselining', upgraded.errors === 0 && upgraded.incomplete === 0
    && upgraded.patched === 3 && upgraded.rebaselined === 0
    && Object.entries(vendors).every(([name, vendor]) => fs.readFileSync(path.join(SCRIPTS, name) + '.rsp-backup', 'utf8') === vendor));
  const unchanged = applyComposed(['adr-io-safety']);
  check('AIN7 narrowed compositions reapply byte-idempotently', unchanged.patched === 0 && unchanged.unchanged === 4);
  const restored = reconcile([], ['adr-io-safety']);
  check('AIN7 uninstall restores exact native originals and never edits shared helper', restored.errors === 0
    && Object.entries(vendors).every(([name, vendor]) => fs.readFileSync(path.join(SCRIPTS, name), 'utf8') === vendor)
    && fs.readFileSync(path.join(SCRIPTS, 'lib', 'ruflo-cli.mjs'), 'utf8') === helper);
  // Prove direct removal of the previous version, independent of an upgrade.
  for (const [name, vendor] of Object.entries(vendors)) {
    fs.writeFileSync(path.join(SCRIPTS, name) + '.rsp-backup', vendor);
    fs.writeFileSync(path.join(SCRIPTS, name), historicalPatchSource(vendor).next);
  }
  const removedOld = reconcile([], ['adr-io-safety']);
  check('AIN7 historical compositions uninstall directly to exact native originals', removedOld.errors === 0
    && Object.entries(vendors).every(([name, vendor]) => fs.readFileSync(path.join(SCRIPTS, name), 'utf8') === vendor));
  // A marker-bearing external modification cannot borrow historical provenance.
  const verifyFile = path.join(SCRIPTS, 'verify.mjs');
  fs.writeFileSync(verifyFile + '.rsp-backup', vendors['verify.mjs']);
  fs.writeFileSync(verifyFile, historicalPatchSource(vendors['verify.mjs']).next + '\n// foreign edit\n');
  const foreign = fs.readFileSync(verifyFile, 'utf8');
  const refused = applyComposed(['adr-io-safety']);
  check('AIN8 foreign historical bytes are refused without rewriting originals', (refused.errors > 0 || refused.incomplete > 0)
    && fs.readFileSync(verifyFile, 'utf8') === foreign
    && fs.readFileSync(verifyFile + '.rsp-backup', 'utf8') === vendors['verify.mjs']);
}
