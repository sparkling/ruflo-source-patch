// Test preload: fixtures may read installed source, never mutate the user's runtime.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { syncBuiltinESMExports } from 'node:module';

const home = os.userInfo().homedir;
const roots = ['.npm', '.npm-global', '.claude', '.codex', '.ruflo-source-patch',
  '.cache/ruvnet-brain', '.config/ruvnet-brain', '.local/share/mise']
  .map(name => path.join(home, name));
const realpath = fs.realpathSync;
function guard(value) {
  if (typeof value !== 'string' && !(value instanceof URL) && !Buffer.isBuffer(value)) return;
  const resolved = path.resolve(value instanceof URL ? fileURLToPath(value) : String(value));
  const paths = [resolved];
  let parent = resolved;
  for (;;) {
    try { paths.push(realpath(parent)); break; }
    catch { const next = path.dirname(parent); if (next === parent) break; parent = next; }
  }
  if (paths.some(candidate => roots.some(root => candidate === root || candidate.startsWith(root + path.sep)))) {
    const error = new Error('RSP_TEST_PROTECTED_RUNTIME: refusing fixture mutation of ' + resolved);
    error.code = 'RSP_TEST_PROTECTED_RUNTIME';
    console.error(error.stack);
    throw error;
  }
}
for (const [name, indices] of Object.entries({
  writeFileSync: [0], appendFileSync: [0], rmSync: [0], unlinkSync: [0],
  renameSync: [0, 1], copyFileSync: [1], cpSync: [1], mkdirSync: [0],
  rmdirSync: [0], chmodSync: [0], utimesSync: [0], truncateSync: [0],
})) {
  const original = fs[name];
  fs[name] = (...args) => { indices.forEach(index => guard(args[index])); return original(...args); };
}
const originalOpen = fs.openSync;
fs.openSync = (file, flags, ...args) => {
  if (typeof flags === 'string' ? /[wa+]/.test(flags) : flags & (fs.constants.O_WRONLY | fs.constants.O_RDWR | fs.constants.O_CREAT | fs.constants.O_TRUNC)) guard(file);
  return originalOpen(file, flags, ...args);
};
for (const [name, indices] of Object.entries({ writeFile: [0], appendFile: [0],
  rm: [0], unlink: [0], rename: [0, 1], copyFile: [1], cp: [1], mkdir: [0],
  rmdir: [0], chmod: [0], utimes: [0], truncate: [0] })) {
  const original = fs.promises[name];
  fs.promises[name] = async (...args) => { indices.forEach(index => guard(args[index])); return original(...args); };
}
syncBuiltinESMExports();
