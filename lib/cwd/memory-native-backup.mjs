// #4287: migration recovery must never acknowledge a raw fallback as an online snapshot.
// Keep upstream encrypted-image compatibility unless the caller explicitly requires native backup.
export const BACKUP_IMPORT = `    let Database;
    try {
        const mod = 'better-sqlite3';
        Database = (await import(mod)).default;`;
export const BACKUP_IMPORT_FIXED = `    let Database;
    try {
        // ruflo-source-patch: backup uses the registry's SQLite owner (#4287/#3693).
        Database = await loadBetterSqlite3();`;
export const BACKUP_FAILURE = '        // #2798 — under CLAUDE_FLOW_ENCRYPT_AT_REST the source is an RFE1';
export const BACKUP_FAILURE_FIXED = `        // ruflo-source-patch: native-only backup refuses image-copy fallback (#4287).
        if (opts.nativeOnly === true)
            return { backedUp: false, skipped: 'native-online-backup-failed', error: String(e?.message ?? e) };
${BACKUP_FAILURE}`;
export const BACKUP_SUCCESS = '    return { backedUp: true, path: destPath, sizeBytes, rotatedAway, gcsUri };';
export const BACKUP_SUCCESS_FIXED = '    return { backedUp: true, method: \'sqlite-online-backup\', path: destPath, sizeBytes, rotatedAway, gcsUri };';
export const BACKUP_OPTION = "        { name: 'verbose', short: 'v', description: 'Verbose logging', type: 'boolean' },";
export const BACKUP_OPTION_FIXED = `        { name: 'native-only', description: 'Require a native online snapshot; refuse image-copy fallback', type: 'boolean' },
${BACKUP_OPTION}`;
export const BACKUP_FORWARD = '            verbose: ctx.flags.verbose === true,';
export const BACKUP_FORWARD_FIXED = `            nativeOnly: ctx.flags['native-only'] === true,
${BACKUP_FORWARD}`;
export const MEMORY_NATIVE_BACKUP_ENTRIES = [
  { id: 'memory/native-online-backup', target: 'memory',
    suffix: ['@claude-flow', 'cli', 'dist', 'src', 'services', 'memory-backup.js'],
    appliesWhen: 'export async function backupMemoryDb(',
    edits: [
      { find: BACKUP_IMPORT, replace: BACKUP_IMPORT_FIXED },
      { find: BACKUP_FAILURE, replace: BACKUP_FAILURE_FIXED },
      { find: BACKUP_SUCCESS, replace: BACKUP_SUCCESS_FIXED },
    ] },
  { id: 'memory/native-backup-command', target: 'memory',
    suffix: ['@claude-flow', 'cli', 'dist', 'src', 'commands', 'memory-backup.js'],
    appliesWhen: 'export const backupCommand =',
    edits: [
      { find: BACKUP_OPTION, replace: BACKUP_OPTION_FIXED },
      { find: BACKUP_FORWARD, replace: BACKUP_FORWARD_FIXED },
    ] },
];
