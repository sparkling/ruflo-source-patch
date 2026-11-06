// https://github.com/ruvnet/ruflo/issues/4851
import fs from 'node:fs';
import path from 'node:path';
import { discover as discoverCli } from '../cwd/package-discovery.mjs';
import { runAutoMemoryHook } from './runtime.mjs';

export const NAME = 'ruflo-worktree-memory';
export const MARKER = 'ruflo-source-patch (ruflo#4851 worktree-memory)';
export const RETIREMENT = 'Retire only after pristine native startup and migration pass missing/stale external dependency binding, ordered import, user/project helper trust and data roots, missing helper/export/write refusal, and managed-launch preparation tests. Unknown upstream bytes fail closed pending qualification.';
const command = `const rspAutoMemoryHookCommand = {
    name: 'auto-memory-hook',
    description: 'Prepare the native memory package binding and run the signed AutoMemory helper',
    options: [
        { name: 'action', description: 'prepare, import or sync', type: 'string', default: 'prepare' },
        { name: 'scope', description: 'project or user helper scope', type: 'string', default: 'project' },
    ],
    action: async (ctx) => {
        try {
            const { runAutoMemoryHook } = await import('../init/memory-package-resolver.js');
            const result = await runAutoMemoryHook(ctx.flags.action, ctx.flags.scope);
            if (ctx.flags.action === 'prepare') output.writeln(JSON.stringify(result));
            return result;
        } catch (error) {
            output.writeln(JSON.stringify({ success: false, exitCode: 1, error: error.message }));
            return { success: false, exitCode: 1 };
        }
    },
};`;
const generator = `export function helperHookCommand(script, subcommand, scope, windows = IS_WINDOWS) {
    if (script === '.claude/helpers/auto-memory-hook.mjs' && ['import', 'sync'].includes(subcommand)) {
        if (!['project', 'user'].includes(scope)) throw new Error('Invalid AutoMemory helper scope');
        return \`ruflo hooks auto-memory-hook --action \${subcommand} --scope \${scope}\`;
    }
    return directHelperHookCommand(script, subcommand, scope, windows);
}
export function migrateAutoMemoryHookCommand(command, scope) {
    for (const sub of ['import', 'sync']) {
        if (generatedForms('.claude/helpers/auto-memory-hook.mjs', sub).includes(command))
            return helperHookCommand('.claude/helpers/auto-memory-hook.mjs', sub, scope);
    }
    return null;
}
function directHelperHookCommand(script, subcommand, scope, windows = IS_WINDOWS) {`;
export const EDITS = {
    'memory-package-resolver.js': [
        ['//# sourceMappingURL=memory-package-resolver.js.map', `// ${MARKER}: reuse the native resolver before the signed helper.\nexport ${runAutoMemoryHook.toString()}\n//# sourceMappingURL=memory-package-resolver.js.map`],
    ],
    'hooks.js': [
        ['// Main hooks command\nexport const hooksCommand = {', `// ${MARKER}: ordered preparation and execution.\n${command}\n// Main hooks command\nexport const hooksCommand = {`],
        ['    subcommands: [\n        preEditCommand,', '    subcommands: [\n        rspAutoMemoryHookCommand,\n        preEditCommand,'],
    ],
    'helper-commands.js': [
        ['export function helperHookCommand(script, subcommand, scope, windows = IS_WINDOWS) {', `// ${MARKER}: preserve direct legacy forms for exact migration.\n${generator}`],
        ["...['project', 'user'].flatMap((scope) => [helperHookCommand(script, sub, scope, false), helperHookCommand(script, sub, scope, true)]),", "...['project', 'user'].flatMap((scope) => [helperHookCommand(script, sub, scope, false), helperHookCommand(script, sub, scope, true), directHelperHookCommand(script, sub, scope, false), directHelperHookCommand(script, sub, scope, true)]),"],
        ['export function pinToUserHelpers(command, windows = IS_WINDOWS) {', "export function pinToUserHelpers(command, windows = IS_WINDOWS) {\n    const prepared = migrateAutoMemoryHookCommand(command, 'user');\n    if (prepared) return prepared;"],
    ],
    'executor.js': [
        ["import { recordMemoryPackagePath } from './memory-package-resolver.js';", `import { recordMemoryPackagePath } from './memory-package-resolver.js';\n// ${MARKER}: only exact native hook forms are migrated.\nimport { migrateAutoMemoryHookCommand } from './helper-commands.js';`],
        ["                    // A user-level probe ruflo generated earlier is re-pinned to HOME.", "                    const preparedMemory = migrateAutoMemoryHookCommand(h.command, scope);\n                    if (preparedMemory) { h.command = preparedMemory; return true; }\n                    // A user-level probe ruflo generated earlier is re-pinned to HOME."],
    ],
};
const count = (source, part) => source.split(part).length - 1;
const editsFor = source => Object.values(EDITS).find(edits => source.includes(edits[0][0]) || source.includes(edits[0][1]));
export const hasPatch = source => source.includes(MARKER);
export function isPatched(source) {
    const edits = editsFor(source);
    return !!edits && count(source, MARKER) === 1 && edits.every(([, replacement]) => count(source, replacement) === 1);
}
export function patchSource(source) {
    if (isPatched(source)) return { next: source, applied: [], missing: [] };
    const edits = editsFor(source);
    if (hasPatch(source) || !edits || edits.some(([anchor]) => count(source, anchor) !== 1))
        return { next: source, applied: [], missing: ['unproved-native-worktree-memory-anchors'] };
    let next = source;
    for (const [anchor, replacement] of edits) next = next.replace(anchor, replacement);
    return { next, applied: [NAME], missing: [] };
}
export function reverse(source) {
    if (!isPatched(source)) return source;
    for (const [anchor, replacement] of [...editsFor(source)].reverse()) source = source.replace(replacement, anchor);
    return source;
}
export const discover = () => [...discoverCli(['@claude-flow', 'cli', 'dist', 'src', 'init', 'memory-package-resolver.js'])]
    .flatMap(file => [file, path.join(path.dirname(file), 'helper-commands.js'), path.join(path.dirname(file), 'executor.js'), path.join(path.dirname(file), '..', 'commands', 'hooks.js')]);
export function preflight(files = discover()) {
    const errors = [];
    for (const file of files) try {
        const stat = fs.lstatSync(file);
        if (!stat.isFile() || stat.isSymbolicLink() || !stat.size) throw Error('unsafe native source');
        if (patchSource(fs.readFileSync(file, 'utf8')).missing.length) throw Error('unproved worktree startup anchors');
    } catch (error) { errors.push(`${file}: ${error.message}`); }
    return { ok: !errors.length, errors };
}
export const descriptor = { name: NAME, atomic: true, missingIsIncomplete: true,
    discover, preflight, patchSource, hasPatch, isPatched, reverse };
