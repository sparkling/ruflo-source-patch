import assert from 'node:assert/strict';
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
console.log('PASS PII-only federation/intelligence/console gates removed; secret, reset, threat guards retained; drift refusal, idempotence, pristine restoration and bounded native retirement');

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
  }
  console.log('PASS withdrawn target install/status/uninstall restores native and never reapplies PII bypass');
} finally { fs.rmSync(scratch, { recursive: true, force: true }); }
