// #3306: published 3.56.0+ exact-version wrapper. Retain native bytes only after
// exercising version, CLI/MCP delegation and mismatch visibility in isolation.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
const reviewed = 'ecdd8a8f7ee482fa8a1e0f0c479d2cab1e6f77e99b15d5890e2a20e623a0b2fe';
let proven;
export function nativeWrapperSatisfied(source) {
    const normalized = source.replaceAll('\r\n', '\n');
    if (createHash('sha256').update(normalized).digest('hex') !== reviewed) return false;
    if (proven !== undefined) return proven;
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rsp-native-wrapper-'));
    const write = (file, body) => {
        fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, body);
    };
    try {
        const wrapper = path.join(root, 'node_modules/ruflo');
        const cli = path.join(root, 'node_modules/@claude-flow/cli');
        write(path.join(wrapper, 'package.json'), JSON.stringify({ type: 'module', version: '3.56.3',
            dependencies: { '@claude-flow/cli': '3.56.3' } }));
        write(path.join(cli, 'package.json'), JSON.stringify({ type: 'module', version: '3.56.3' }));
        write(path.join(wrapper, 'bin/ruflo.js'), source);
        write(path.join(cli, 'bin/cli.js'), 'console.log(JSON.stringify(process.argv.slice(2)));');
        write(path.join(cli, 'dist/src/index.js'),
            'export class CLI { async run() { console.log(JSON.stringify(process.argv.slice(2))); } }');
        const run = args => spawnSync(process.execPath, [path.join(wrapper, 'bin/ruflo.js'), ...args],
            { encoding: 'utf8', timeout: 5000, env: { HOME: root, PATH: process.env.PATH } });
        const version = run(['--version']), mcp = run(['mcp', 'start']);
        const command = run(['memory', 'search', 'literal words']);
        write(path.join(cli, 'package.json'), '{"type":"module","version":"3.54.1"}');
        const mismatch = run(['mcp', 'start']);
        proven = version.status === 0 && version.stdout.trim() === 'ruflo v3.56.3'
            && mcp.status === 0 && mcp.stdout.trim() === '["mcp","start"]'
            && command.status === 0 && command.stdout.trim() === '["memory","search","literal words"]'
            && mismatch.status === 0 && mismatch.stderr.includes('expects @claude-flow/cli v3.56.3')
            && mismatch.stderr.includes('resolved v3.54.1');
        return proven;
    } catch { return false; }
    finally { fs.rmSync(root, { recursive: true, force: true }); }
}
