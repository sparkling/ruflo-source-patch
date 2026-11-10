import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { NATIVE, INTELLIGENCE } from '../lib/ruflo-pii-policy/native.mjs';
import { historicalPatchSource as patchSource, reverse, historicalIsPatched as isPatched, RETIRED, patchSource as withdraw, isPatched as isWithdrawn } from '../lib/ruflo-pii-policy/patcher.mjs';
// Pure functions only: no MCP, detector, stores, HOME resolution or learning.
function guard(source) {
  const js = stripTypeScriptTypes(source.replace(/^import .*\n/gm, '')).replace('export function verdict', 'function verdict');
  return new Function('hasSecret', 'textsOf', 'bare', 'namespaceOf', js + '\nreturn verdict;')(
    t => t.includes('fixture-secret') || t === 'screen-incomplete',
    input => [JSON.stringify(input)], n => n.replace(/^mcp__[^_]+__/, ''), input => input.namespace || '');
}
for (const native of [NATIVE, INTELLIGENCE]) {
  const result = patchSource(native);
  assert.deepEqual(result.missing, []); assert(isPatched(result.next));
  assert.equal(reverse(result.next), native);
  assert.equal(patchSource(result.next).next, result.next);
  assert.equal(withdraw(result.next).next, native); assert(isWithdrawn(native)); assert.equal(withdraw(native).next,native);
  assert(patchSource(native + '// changed').missing.length);
  assert(patchSource(native + native).missing.length);
  const before = guard(native), after = guard(result.next);
  const cases = native === NATIVE ? [
    ['x_federation_publish', { content: '123-45-6789' }],
    ['memory_store', { namespace: 'federation', value: '4111111111111111' }],
  ] : [['hooks_transfer', { content: 'research@example.org' }]];
  for (const [tool, input] of cases) {
    assert(before(tool, input, { confirmReset: true }));
    assert.equal(after(tool, input, { confirmReset: true }), undefined);
    assert.match(after(tool, { ...input, value: 'fixture-secret' }, { confirmReset: true }), /secret/);
  }
  if (native === INTELLIGENCE) assert.match(after('hooks_intelligence_reset', {}, { confirmReset: true }), /Ask the user/);
}
assert(isPatched(RETIRED)); assert.equal(patchSource(RETIRED).next, RETIRED);
const guidance = "import { mcpReader } from './secure'\nexport type Screen = { status: 'safe' | 'unsafe' | 'pii' | 'unavailable'; detail: string }\nexport const blocksGuidance = (screen: Screen | null): boolean => screen !== null && (screen.status === 'unsafe' || screen.status === 'pii')\nexport const blocksCreate = (screen: Screen | null): boolean => screen?.status === 'unsafe'\nfunction pii() { return { status: 'pii', detail: 'personal or secret data detected' } }";
const next = patchSource(guidance).next;
assert.equal(reverse(next), guidance);
const js = stripTypeScriptTypes(next.replace(/^import .*\n/gm, '')).replaceAll('export const', 'const');
const block = new Function(js + ';return blocksGuidance;')();
assert.equal(block({ status: 'pii' }), false); assert.equal(block({ status: 'pii', secret: true }), true); assert.equal(block({ status: 'unsafe' }), true);
assert.equal(block(null), false); assert.equal(block({ status: 'unavailable' }), false, 'existing error semantics unchanged');
assert(patchSource(guidance + '\n' + guidance).missing.length);
// Exact upstream bytes at 4184c5cc24f27d5831f871e6d7160e2a9322cbbb;
// no downstream guard rewrite.
const modern = ['federation-0.4.0.ts', 'intelligence-0.5.0.ts', 'console-native-options.ts']
  .map(name => readFileSync(new URL('./fixtures/pii-policy/' + name, import.meta.url), 'utf8'));
for (const source of modern) {
  assert(isWithdrawn(source), 'recognize reviewed native PII option source');
  assert.deepEqual(withdraw(source), { next: source, applied: [], missing: [] });
  assert.equal(reverse(source), source);
  assert(!isPatched(source), 'native option is not ownership of the withdrawn bypass');
  for (const foreign of [source + '// unknown change\n', source.replace('piiGuard', 'piiBypass')]) {
    assert(!isWithdrawn(foreign), 'unknown source still requires review');
    assert(withdraw(foreign).missing.length);
    assert.equal(withdraw(foreign).next, foreign);
  }
}
for (const [index, source] of modern.slice(0, 2).entries()) {
  const native = guard(source), tool = index ? 'hooks_transfer' : 'x_federation_publish';
  const input = { content: index ? 'research@example.org' : '123-45-6789' };
  assert(native(tool, input, { piiGuard: true, confirmReset: true }));
  assert.equal(native(tool, input, { piiGuard: false, confirmReset: true }), undefined);
  assert.match(native(tool, { content: 'fixture-secret' }, { piiGuard: false }), /secret/);
  if (index) assert.match(native('hooks_intelligence_reset', {}, { piiGuard: false, confirmReset: true }), /Ask the user/);
}
const consoleJs = stripTypeScriptTypes(modern[2].replace(/^import .*\n/gm, ''))
  .replaceAll('export ', '');
const consoleNative = new Function('plain', 'chunksOf', 'ARGV_TEXT_MAX', 'LONG_TEXT_MAX',
  'CLI_PREFIXES', 'GOALS_PLUGIN', 'mcpReader', 'jsonAfter', 'hasSecret', consoleJs +
  '\nreturn { screenText, blocksGuidance, blocksCreate };')(
  text => text, text => [text], 10000, 100000, { ruflo: ['ruflo'] }, 'ruflo-goals',
  () => stdout => [stdout], JSON.parse, text => text === 'fixture-secret');
const screen = async (piiGuard, text, safe = 'SAFE', pii = true) => consoleNative.screenText(
  { options: { piiGuard, cli: 'ruflo' } }, { run: async argv => ({ stdout:
    argv.includes('aidefence_is_safe') ? safe : JSON.stringify({ hasPII: pii }), stderr: '' }) }, text);
assert.equal((await screen(true, 'research@example.org')).status, 'pii');
const informational = await screen(false, 'research@example.org');
assert.equal(informational.status, 'safe'); assert.match(informational.detail, /personal data detected/);
assert.equal(consoleNative.blocksGuidance(informational), false);
for (const [text, safe, expected] of [['fixture-secret', 'SAFE', 'secret'], ['injection', 'UNSAFE', 'unsafe']]) {
  const result = await screen(false, text, safe); assert.equal(result.status, expected);
  assert(consoleNative.blocksGuidance(result));
}
assert.equal((await screen(false, 'text', 'unreadable')).status, 'unavailable');
assert.equal((await screen(false, 'fixture-secret', 'unreadable')).status, 'secret');
console.log('PASS historical PII transforms reverse exactly; native guards restored; drift refusal retained');

// Public composition lifecycle in a fully isolated account layout.
const fs = await import('node:fs'), os = await import('node:os'), path = await import('node:path');
const { spawnSync } = await import('node:child_process');
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'rsp-pii-policy-'));
try {
  const home = path.join(scratch, 'home');
  const root = path.join(home, '.claude/plugins/cache/ruflo/ruflo-federation/0.3.7');
  fs.mkdirSync(path.join(root, 'hooks'), { recursive: true });
  fs.mkdirSync(path.join(root, '.claude-plugin'), { recursive: true });
  fs.writeFileSync(path.join(root, '.claude-plugin/plugin.json'), JSON.stringify({ name: 'ruflo-federation' }));
  const file = path.join(root, 'hooks/guard.ts'); fs.writeFileSync(file, patchSource(NATIVE).next); fs.writeFileSync(file + '.rsp-backup', NATIVE);
  fs.writeFileSync(path.join(home, '.claude/settings.json'), '{}');
  const env = { PATH: process.env.PATH, HOME: home, RUFLO_SOURCE_PATCH_HOME: home,
    RUFLO_GLOBAL_ROOT: path.join(scratch, 'global'), RUFLO_NPX_ROOT: path.join(scratch, 'npx'),
    RSP_CODEX_HOME: path.join(home, '.codex'), RSP_NO_SELF_UPDATE: '1', RSP_NO_LAUNCHCTL: '1',
    RSP_NO_MONITOR_RECOVER: '1', RSP_NO_STALE_WRITER_KILL: '1', RSP_NO_HOST_AUTO_UPDATE: '1' };
  for (const action of ['install', 'status', 'uninstall']) {
    const result = spawnSync(process.execPath, [new URL('../bin/cli.mjs', import.meta.url).pathname, 'ruflo-pii-policy', action], { cwd: scratch, env, encoding: 'utf8', timeout: 30000 });
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.equal(fs.readFileSync(file, 'utf8'), NATIVE);
    if (action === 'status') {
      assert.match(result.stdout, /1\/1 file\(s\) native restoration verified/);
      assert.match(result.stdout, /WITHDRAWN/);
      assert.doesNotMatch(result.stdout, /file\(s\) patched|run `ruflo-pii-policy install`/);
    }
  }
  fs.writeFileSync(file, patchSource(NATIVE).next);
  const unresolved = spawnSync(process.execPath, [new URL('../bin/cli.mjs', import.meta.url).pathname, 'ruflo-pii-policy', 'status'], { cwd: scratch, env, encoding: 'utf8', timeout: 30000 });
  assert.equal(unresolved.status, 1, unresolved.stdout + unresolved.stderr);
  assert.match(unresolved.stdout, /0\/1 file\(s\) native restoration verified/);
  assert.match(unresolved.stdout, /WITHDRAWN/);
  assert.doesNotMatch(unresolved.stdout, /run `ruflo-pii-policy install`/);
  assert.equal(fs.readFileSync(file, 'utf8'), patchSource(NATIVE).next, 'status must not restore or mutate source');
  fs.unlinkSync(file);
  const absent = spawnSync(process.execPath, [new URL('../bin/cli.mjs', import.meta.url).pathname, 'ruflo-pii-policy', 'status'], { cwd: scratch, env, encoding: 'utf8', timeout: 30000 });
  assert.equal(absent.status, 1, absent.stdout + absent.stderr);
  assert.match(absent.stdout, /0\/0 file\(s\) native restoration verified/);
  assert.doesNotMatch(absent.stdout, /run `ruflo-pii-policy install`/);
  const nativeFiles = modern.map((source, index) => {
    const plugin = ['ruflo-federation', 'ruflo-intelligence', 'ruflo-console'][index];
    const nativeRoot = path.join(home, '.codex/plugins/cache/ruflo', plugin, '0.5.0');
    const nativeFile = path.join(nativeRoot, 'hooks', index === 2 ? 'mission-options.ts' : 'guard.ts');
    fs.mkdirSync(path.dirname(nativeFile), { recursive: true });
    fs.mkdirSync(path.join(nativeRoot, '.claude-plugin'), { recursive: true });
    fs.writeFileSync(path.join(nativeRoot, '.claude-plugin/plugin.json'), JSON.stringify({ name: plugin }));
    fs.writeFileSync(nativeFile, source);
    if (index === 2) fs.writeFileSync(path.join(nativeRoot, 'hooks/screen.ts'), 'export const hasSecret = () => true;');
    return { file: nativeFile, source, ino: fs.statSync(nativeFile).ino };
  });
  for (const action of ['install', 'status', 'uninstall']) {
    const result = spawnSync(process.execPath, [new URL('../bin/cli.mjs', import.meta.url).pathname,
      'ruflo-pii-policy', action], { cwd: scratch, env, encoding: 'utf8', timeout: 30000 });
    assert.equal(result.status, 0, result.stdout + result.stderr);
    if (action === 'status') assert.match(result.stdout, /3\/3 file\(s\) native restoration verified/);
    for (const native of nativeFiles) {
      assert.equal(fs.readFileSync(native.file, 'utf8'), native.source);
      assert.equal(fs.statSync(native.file).ino, native.ino, 'native file is not rewritten');
      if (fs.existsSync(native.file + '.rsp-backup')) assert.equal(
        fs.readFileSync(native.file + '.rsp-backup', 'utf8'), native.source, 'any pristine remains exact native bytes');
    }
  }
  console.log('PASS withdrawn target install/status/uninstall restores native and never reapplies PII bypass');
} finally { fs.rmSync(scratch, { recursive: true, force: true }); }
