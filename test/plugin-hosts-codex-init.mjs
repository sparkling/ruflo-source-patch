// Behavioral proof for Ruflo's bundled Codex initializer executable boundary (#2854).

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SB = path.resolve(process.argv[2]);
const REPO = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const HOME = path.join(SB, 'home');
const NPX = path.join(SB, 'npx');
const BIN = path.join(SB, 'host-bin');
const CALLS = path.join(SB, 'codex-calls.jsonl');
const CODEX_ROOT = path.join(
  NPX, 'fixture', 'node_modules', '@claude-flow', 'cli', 'node_modules',
  '@claude-flow', 'codex',
);
const INITIALIZER = path.join(CODEX_ROOT, 'dist', 'initializer.js');
let failures = 0;

function check(name, condition, detail = '') {
  if (condition) console.log(`  ✓ ${name}`);
  else {
    failures++;
    console.log(`  ✘ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

function write(file, body, mode = 0o644) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, body);
  fs.chmodSync(file, mode);
}

const pristine = `import { getRufloMcpAddCommand } from './mcp-config.js';
export class CodexInitializer {
    async registerMCPServer() {
        try {
            const { execSync } = await import('child_process');
            try {
                execSync('which codex', { stdio: 'pipe' });
            }
            catch {
                return { registered: false, warning: \`Run: \${getRufloMcpAddCommand()}\` };
            }
            try {
                const listJson = execSync('codex mcp list --json 2>&1', { encoding: 'utf-8' });
                const parsed = JSON.parse(listJson);
                const servers = Array.isArray(parsed) ? parsed : null;
                if (servers?.some((server) => server?.name === 'ruflo')) return { registered: true };
            }
            catch {
                try {
                    const list = execSync('codex mcp list 2>&1', { encoding: 'utf-8' });
                    if (list.includes('ruflo')) return { registered: true };
                }
                catch {}
            }
            try {
                execSync(getRufloMcpAddCommand(), {
                    stdio: 'pipe',
                    timeout: 10000,
                });
                return { registered: true };
            }
            catch (error) {
                return { registered: false, warning: String(error) };
            }
        }
        catch (error) {
            return { registered: false, warning: String(error) };
        }
    }
    async installRufloCorePlugin() {
        try {
            const { execSync } = await import('child_process');
            try {
                execSync('which codex', { stdio: 'pipe' });
            }
            catch {
                return { installed: false };
            }
            try {
                const listJson = execSync('codex plugin list --json 2>&1', { encoding: 'utf-8' });
                const parsed = JSON.parse(listJson);
                if (Array.isArray(parsed) && parsed.some((plugin) => plugin?.name === 'ruflo-core')) {
                    return { installed: true };
                }
            }
            catch {
                try {
                    const list = execSync('codex plugin list 2>&1', { encoding: 'utf-8' });
                    if (list.includes('ruflo-core')) return { installed: true };
                }
                catch {}
            }
            try {
                execSync('codex plugin marketplace add ruvnet/ruflo --ref main', { stdio: 'pipe', timeout: 20000 });
            }
            catch {}
            try {
                execSync('codex plugin add ruflo-core@ruflo', { stdio: 'pipe', timeout: 20000 });
                return { installed: true };
            }
            catch (error) {
                return { installed: false, warning: String(error) };
            }
        }
        catch (error) {
            return { installed: false, warning: String(error) };
        }
    }
}
`;

fs.rmSync(SB, { recursive: true, force: true });
write(path.join(HOME, '.claude', 'settings.json'), '{}\n');
write(path.join(CODEX_ROOT, 'package.json'), '{"name":"@claude-flow/codex","type":"module"}\n');
write(INITIALIZER, pristine);
write(path.join(CODEX_ROOT, 'dist', 'mcp-config.js'), `
export const getRufloMcpAddCommand = () => 'manual fallback';
export const getRufloMcpServerConfig = () => ({
  command: 'npx', args: ['-y', 'ruflo@latest', 'mcp', 'start'],
});
`);
write(path.join(BIN, 'codex'), `#!${process.execPath}
const fs = require('node:fs');
const args = process.argv.slice(2);
fs.appendFileSync(process.env.RSP_CODEX_CALLS, JSON.stringify(args) + '\\n');
if (args.join(' ') === 'mcp list --json' || args.join(' ') === 'plugin list --json') {
  process.stdout.write('[]');
}
`, 0o755);

const env = {
  ...process.env,
  HOME,
  RUFLO_SOURCE_PATCH_HOME: HOME,
  RUFLO_NPX_ROOT: NPX,
  RUFLO_GLOBAL_ROOT: '',
  RSP_NO_HOST_AUTO_UPDATE: '1',
  RSP_NO_LAUNCHCTL: '1',
};
const cli = (...args) => spawnSync(
  process.execPath, [path.join(REPO, 'bin', 'cli.mjs'), ...args],
  { env, encoding: 'utf8' },
);

console.log('\nBundled Codex initializer host boundary');
const installed = cli('plugin-hosts', 'install');
const patched = fs.readFileSync(INITIALIZER, 'utf8');
check('PHCI1 the bundled initializer patch installs from exact anchors',
  installed.status === 0
    && patched.includes('const __RSP_HOST_DISCOVERY_REVISION = "2026-08-17.3";')
    && !patched.includes("execSync('which codex'")
    && !patched.includes("execSync('codex"),
  `${installed.stdout}${installed.stderr}`);
check('PHCI2 the pristine initializer has an exact restoration image',
  fs.readFileSync(`${INITIALIZER}.rsp-backup`, 'utf8') === pristine);

Object.assign(process.env, {
  PATH: '/usr/bin:/bin',
  XDG_BIN_HOME: BIN,
  RSP_CODEX_CALLS: CALLS,
});
const { CodexInitializer } = await import(`${pathToFileURL(INITIALIZER).href}?t=${Date.now()}`);
const initializer = new CodexInitializer();
const mcp = await initializer.registerMCPServer();
const plugin = await initializer.installRufloCorePlugin();
const calls = fs.readFileSync(CALLS, 'utf8').trim().split('\n').map((line) => JSON.parse(line));
const has = (...argv) => calls.some((call) => JSON.stringify(call) === JSON.stringify(argv));
check('PHCI3 narrow-PATH MCP registration uses the resolved Codex executable and literal argv',
  mcp.registered
    && has('mcp', 'list', '--json')
    && has('mcp', 'add', 'ruflo', '--', 'npx', '-y', 'ruflo@latest', 'mcp', 'start'),
  JSON.stringify({ mcp, calls }));
check('PHCI4 plugin installation uses literal marketplace and plugin argv',
  plugin.installed
    && has('plugin', 'list', '--json')
    && has('plugin', 'marketplace', 'add', 'ruvnet/ruflo', '--ref', 'main')
    && has('plugin', 'add', 'ruflo-core@ruflo'),
  JSON.stringify({ plugin, calls }));

const uninstalled = cli('plugin-hosts', 'uninstall');
check('PHCI5 uninstall is byte-perfect',
  uninstalled.status === 0 && fs.readFileSync(INITIALIZER, 'utf8') === pristine,
  `${uninstalled.stdout}${uninstalled.stderr}`);

if (failures) {
  console.error(`\n${failures} bundled Codex initializer test(s) failed`);
  process.exit(1);
}
console.log('\nAll bundled Codex initializer tests passed');
