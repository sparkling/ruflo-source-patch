// Behavioral retirement coverage for ruflo/ruflo#2659.
// The compatibility template edit stays for stale parsers and retires only when
// every active Claude/Codex marketplace + cache parser passes the real round trip.

import fs from 'node:fs';
import path from 'node:path';

const SB = path.resolve(process.argv[2]);
const HOME = path.join(SB, 'home');
const CODEX_HOME = path.join(SB, 'codex');
process.env.RUFLO_SOURCE_PATCH_HOME = HOME;
process.env.CODEX_HOME = CODEX_HOME;
process.env.RUFLO_NPX_ROOT = path.join(SB, 'npx');
process.env.RUFLO_GLOBAL_ROOT = path.join(SB, 'global');

const { applyComposed } = await import('../lib/plugin-compose.mjs');
const { evaluate, retireSuperseded } = await import('../lib/supersede.mjs');
const state = await import('../lib/cwd/state.mjs');

let failures = 0;
function check(name, condition, detail = '') {
  if (condition) console.log(`  ✓ ${name}`);
  else {
    failures++;
    console.log(`  ✘ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}
function write(file, body) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, body);
  return file;
}

const claudeMarketplace = path.join(
  HOME, '.claude', 'plugins', 'marketplaces', 'ruflo', 'plugins', 'ruflo-adr',
);
const claudeCache = path.join(HOME, '.claude', 'plugins', 'cache', 'ruflo', 'ruflo-adr', '0.4.1');
const claudeProjectCache = path.join(HOME, '.claude', 'plugins', 'cache', 'ruflo', 'ruflo-adr', '0.3.0');
const projectPath = path.join(SB, 'project');
const codexMarketplace = path.join(
  CODEX_HOME, '.tmp', 'marketplaces', 'ruflo', 'plugins', 'ruflo-adr',
);
const codexCache = path.join(CODEX_HOME, 'plugins', 'cache', 'ruflo', 'ruflo-adr', '0.4.1');
const parserSuffix = path.join('scripts', 'lib', 'parse-adrs.mjs');
const skillSuffix = path.join('skills', 'adr-create', 'SKILL.md');

write(path.join(HOME, '.claude', 'plugins', 'installed_plugins.json'), `${JSON.stringify({
  plugins: {
    'ruflo-adr@ruflo': [
      { scope: 'user', installPath: claudeCache, version: '0.4.1' },
      {
        scope: 'project', enabled: true, projectPath,
        installPath: claudeProjectCache, version: '0.3.0',
      },
    ],
  },
}, null, 2)}\n`);
write(path.join(codexMarketplace, '.claude-plugin', 'plugin.json'),
  '{"name":"ruflo-adr","version":"0.4.1"}\n');

const template = '# ADR create\n\n'
  + '   - **Status**: proposed\n'
  + "   - **Date**: <today's date YYYY-MM-DD>\n"
  + '   - **Deciders**: <leave blank for author to fill>\n'
  + '   - **Tags**: <leave blank>\n';
const claudeSkills = [
  write(path.join(claudeMarketplace, skillSuffix), template),
  write(path.join(claudeCache, skillSuffix), template),
  write(path.join(claudeProjectCache, skillSuffix), template),
];

const brokenParser = `
import { readFileSync } from 'node:fs';
export function parseAdr(file) {
  readFileSync(file, 'utf8');
  return { status: 'Unknown', date: '', tags: [], links: [] };
}
`;
const fixedParser = `
import { readFileSync } from 'node:fs';
export function parseAdr(file) {
  const text = readFileSync(file, 'utf8');
  const id = 'ADR-007';
  const value = (name) => new RegExp('^[-*+]?\\\\s*\\\\*\\\\*' + name + '\\?\\\\*\\\\*:\\?\\\\s*(.+)$', 'mi').exec(text)?.[1];
  const ref = (name, relation, reverse = false) => {
    const raw = value(name);
    if (!raw) return [];
    const target = /ADR-?([0-9]+)/i.exec(raw)?.[1].padStart(3, '0');
    return target ? [{ from: reverse ? 'ADR-' + target : id, to: reverse ? id : 'ADR-' + target, relation }] : [];
  };
  return {
    status: value('Status'),
    date: value('Date'),
    tags: value('Tags').split(',').map((tag) => tag.trim()),
    links: [
      ...ref('Supersedes', 'supersedes', true),
      ...ref('Amends', 'amends'),
      ...ref('Related', 'related'),
      ...ref('Depends-on', 'depends-on'),
    ],
  };
}
`;
const parsers = [
  path.join(claudeMarketplace, parserSuffix),
  path.join(claudeCache, parserSuffix),
  path.join(codexMarketplace, parserSuffix),
  path.join(codexCache, parserSuffix),
];
for (const parser of parsers) write(parser, fixedParser);
const projectParser = write(path.join(claudeProjectCache, parserSuffix), brokenParser);

console.log('\nADR template retirement');
const applied = applyComposed(['adr-template']);
state.writeState({ patchTargets: [], pluginTargets: ['adr-template'], retired: {} });
check('AT1 compatibility patch applies to every Claude cache/marketplace copy',
  applied.incomplete === 0 && claudeSkills.every((file) =>
    fs.readFileSync(file, 'utf8').includes('   **Status**: proposed')));

write(parsers[3], brokenParser);
const stale = evaluate('adr-template');
check('AT2 one stale active parser keeps the patch live',
  stale.state === 'live' && /1\/4 active/.test(stale.evidence), JSON.stringify(stale));
const refused = retireSuperseded(state.readState());
check('AT3 a failed behavior proof cannot retire or mutate the patch',
  refused.retired === 0
    && state.readState().pluginTargets.includes('adr-template')
    && claudeSkills.every((file) => fs.existsSync(`${file}.rsp-backup`)));

write(parsers[3], fixedParser);
const inactive = evaluate('adr-template');
check('AT4 an orphaned project registry entry is not treated as runnable',
  inactive.state === 'superseded' && /all 4 active/.test(inactive.evidence), JSON.stringify(inactive));
fs.mkdirSync(projectPath, { recursive: true });
const activeStale = evaluate('adr-template');
check('AT5 a stale parser blocks retirement when its registered project becomes active',
  activeStale.state === 'live' && /1\/5 active/.test(activeStale.evidence), JSON.stringify(activeStale));
write(projectParser, fixedParser);
const ready = evaluate('adr-template');
check('AT6 every active scoped parser copy proves the replacement',
  ready.state === 'superseded' && /all 5 active/.test(ready.evidence), JSON.stringify(ready));
const retired = retireSuperseded(state.readState());
const after = state.readState();
check('AT7 retirement restores vendor templates and records terminal evidence',
  retired.retired === 1
    && !after.pluginTargets.includes('adr-template')
    && /all 5 active/.test(after.retired['adr-template']?.evidence || '')
    && claudeSkills.every((file) => fs.readFileSync(file, 'utf8') === template)
    && claudeSkills.every((file) => !fs.existsSync(`${file}.rsp-backup`)),
  JSON.stringify({ retired, state: after }));

if (failures) {
  console.error(`\n${failures} adr-template retirement test(s) failed`);
  process.exit(1);
}
console.log('\nAll adr-template retirement tests passed');
