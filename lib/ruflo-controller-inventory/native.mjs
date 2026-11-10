// #4707/#4712: accept the complete published native inventory, never mix its
// cursor/status contract with the historical offset/state compatibility layer.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
const hashes = {
  tools: 'cdcb0165919d73fd696f9635706e14876fba3d782261acf400afbcd4eaa72f5a',
  hierarchical: 'a9bd34ea4f20f51e8399396f5765b189a652d1ba2466bcd03245007f35ea1bcd',
  helper: '8d9e895c72c59261c80e762f3482ab20387cd8ea78c9b343984c82d333ac095a',
  bridge: 'be3da53abcd1406b59b794c52777f6c30f62d05da2030211f52e7a342975b111',
  tier: '64cd1a7156a86fda5490a97166e39cdacd8363fbe885bbcbb536b57eac839555',
};
const digest = source => createHash('sha256').update(source).digest('hex');
const once = (source, text) => source.split(text).length === 2;
const read = file => {
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || !stat.size) throw Error('unsafe inventory dependency');
  return fs.readFileSync(file, 'utf8');
};
const exactRegion = (source, start, end, hash) => {
  const a = source.indexOf(start), b = source.indexOf(end, a);
  return a >= 0 && b > a && once(source, start) && digest(source.slice(a, b)) === hash;
};
export const nativeInventoryPresent = source => /agentdbInventoryTools|agentdbHierarchicalInventoryTools|withInventoryController|listPersistedEntries/.test(source);
export function nativeTierInventory(source, file) {
  if (!file || source.includes('ruflo-source-patch (controller-inventory')) return false;
  const start = source.indexOf('    listEntries(options) {');
  const end = source.indexOf('    /** Load persisted rows', start);
  return start >= 0 && end > start && once(source, '    listEntries(options) {')
    && once(source, '    getEntry(id, options) {')
    && once(source, "import { getPersistedEntry, listPersistedEntries, TieredMemoryUnsupportedError, } from './tiered-memory-inventory.js';")
    && once(source, 'const INVENTORY_DEPS = {\n    decode: rowToEntry,\n    isValid: isTemporallyValid,\n    validTiers: VALID_TIERS,\n};')
    && once(source, "const VALID_TIERS = ['working', 'episodic', 'semantic'];")
    && exactRegion(source, 'function rowToEntry(row) {', 'const VALID_TIERS =', '37d283f894fdc73122b4ab74a16d4105f3c4d67ba71bbec1d85fb447b1edc5f3')
    && exactRegion(source, 'export function isTemporallyValid(', 'const INVENTORY_DEPS =', '33ae3adc76a92dc8db5cd6716f940e8b26397e24b8e016a2f95375b4620bfd21')
    && exactRegion(source, '    countPersisted() {', '    /**\n     * Page through every PERSISTED entry', '9998ee75d2514857744bfacfb7084275d18fb66756651d0d42282a49b7015fc3')
    // Native statistics, or exactly that method with the independently tested
    // memory-coherence claimant's refresh. Neither permits arbitrary drift.
    && ['5273b78520addc456163e18a77d1109ba8d16b68865c907675dd639f041b4b5c',
      'bd1f7ef5794957bca5bbb38a85759b9ed2f909ae6117b7c0e692ea742b6911d8']
      .some(hash => exactRegion(source, '    getTierStats() {', '    findActive(idOrKey) {', hash))
    && digest(source.slice(start, end)) === hashes.tier
    && digest(read(path.join(path.dirname(file), 'tiered-memory-inventory.js'))) === hashes.helper;
}
function registration(source) {
  return ['agentdbInventoryTools', 'agentdbHierarchicalInventoryTools'].every((name, i) =>
    once(source, `import { ${name} } from './${i ? 'agentdb-hierarchical-inventory-tools' : 'agentdb-inventory-tools'}.js';`)
    && once(source, `    ...${name},`)
    && source.split(name).length === 3)
    && !/name:\s*['"]agentdb_(?:pattern-list|skill-list|skill-get|hierarchical-stats|hierarchical-list|hierarchical-get)['"]/.test(source);
}
function nativeControllers(tier) {
  const root = path.join(path.dirname(createRequire(tier).resolve('agentdb')), 'controllers');
  if (digest(read(path.join(root, 'crud-helpers.js'))) !== '2ff148ed1506bcb55d6c264b7893d97c706e0133e139505779891aa781f14231'
      || !exactRegion(read(path.join(root, '../security/input-validation.js')),
        'export class ValidationError extends Error {', '\n}\n', '97b1d7df418807b2d538fa7b706432455b60c64f8eac7608f46692be00520604')) return false;
  return [
    ['ReasoningBank', '    listPatterns(options = {}) {', '    /**\n     * Delete pattern by ID', '72e96e8cf5eebeb317facfefb7090e7381e7d7f79372a3e1f1eb32ad37495438'],
    ['SkillLibrary', '    assertSqlAddressable(op) {', '    /**\n     * Update a skill in place', 'ea2d88314b9c7cb24742940fc90f77911137edd67174f3d256d0d2fa4a3b0228'],
  ].every(([name, start, end, hash]) => {
    const source = read(path.join(root, name + '.js'));
    const imported = name === 'ReasoningBank'
      ? 'assertMetadata, assertTags, embeddingBlob, inTransaction, mergeMetadata, toPage, toRecordId, CrudValidationError,'
      : 'assertMetadata, embeddingBlob, inTransaction, mergeMetadata, toPage, toRecordId, CrudValidationError';
    return once(source, `import { ${imported} } from './crud-helpers.js';`)
      && exactRegion(source, 'function safeJsonParse(value, fallback) {', '\n}\n', '8abdbc64c80385f4ea7392f014b0e3352f51b0f52b663bad74e91dc49810a385')
      && exactRegion(source, start, end, hash);
  });
}
// Source hashes cover the small, behavior-tested native modules/boundary only;
// sibling changes elsewhere in agentdb-tools and memory-bridge remain composable.
export function nativeInventory(source, file) {
  try {
    if (!file) return false;
    if (path.basename(file) === 'tiered-memory.js') return nativeTierInventory(source, file);
    const root = path.resolve(path.dirname(file), '..');
    const tools = path.join(root, 'mcp-tools/agentdb-tools.js');
    const bridge = path.join(root, 'memory/memory-bridge.js');
    const toolSource = file === tools ? source : read(tools);
    const bridgeSource = file === bridge ? source : read(bridge);
    const marker = '// ===== #4712: persisted inventory of the hierarchical (tiered) store =====';
    if (!registration(toolSource) || !once(bridgeSource, marker)
        || digest(bridgeSource.slice(bridgeSource.indexOf(marker))) !== hashes.bridge) return false;
    const tier = path.join(path.dirname(createRequire(tools).resolve('@claude-flow/memory')), 'tiered-memory.js');
    return digest(read(path.join(root, 'mcp-tools/agentdb-inventory-tools.js'))) === hashes.tools
      && digest(read(path.join(root, 'mcp-tools/agentdb-hierarchical-inventory-tools.js'))) === hashes.hierarchical
      && nativeTierInventory(read(tier), tier) && nativeControllers(tier);
  } catch { return false; }
}
