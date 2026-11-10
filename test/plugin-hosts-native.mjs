// Reuse the full host behavior regression matrix with the native 3.75 host group.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const run = spawnSync(process.execPath, [fileURLToPath(new URL('./plugin-hosts.mjs', import.meta.url)), process.argv[2], 'native-host'], { stdio:'inherit', env:process.env });
if (run.error) throw run.error;
process.exit(run.status ?? 1);
