import fs from 'node:fs';
import path from 'node:path';

const sandbox = process.argv[2];
if (!sandbox) throw new Error('sandbox path required');

const home = path.join(sandbox, 'home');
const settingsPath = path.join(home, '.claude', 'settings.json');
process.env.RUFLO_SOURCE_PATCH_HOME = home;
fs.mkdirSync(path.dirname(settingsPath), { recursive: true });

const { installHook, removeHook } = await import('../lib/cwd/hooks.mjs');

const currentStart = `node "${path.join(home, '.ruflo-source-patch', 'lib', 'cwd', 'session-start.mjs')}"`;
const currentNotify = `node "${path.join(home, '.ruflo-source-patch', 'lib', 'cwd', 'notify.mjs')}"`;
const migratedStart = 'node "/Users/henrik/.ruflo-source-patch/lib/cwd/session-start.mjs"';
const migratedNotify = 'node "/Users/henrik/.ruflo-source-patch/lib/cwd/notify.mjs"';
const foreignStart = 'node "/opt/company/session-start.mjs"';
const foreignNotify = 'node "/opt/company/notify.mjs"';

const group = (hook) => ({ hooks: [hook] });
fs.writeFileSync(settingsPath, `${JSON.stringify({
  hooks: {
    SessionStart: [
      group({ type: 'command', command: migratedStart }),
      group({ type: 'command', command: currentStart }),
      group({ type: 'command', command: migratedStart, _rufloSourcePatch: true }),
      group({ type: 'command', command: currentStart, _rufloSourcePatch: true }),
      group({ type: 'command', command: foreignStart }),
    ],
    UserPromptSubmit: [
      group({ type: 'command', command: migratedNotify }),
      group({ type: 'command', command: currentNotify }),
      group({ type: 'command', command: migratedNotify, _rufloSourcePatchNotify: true }),
      group({ type: 'command', command: currentNotify, _rufloSourcePatchNotify: true }),
      group({ type: 'command', command: foreignNotify }),
    ],
  },
}, null, 2)}\n`);

const hooks = (event) => (JSON.parse(fs.readFileSync(settingsPath, 'utf8')).hooks[event] || [])
  .flatMap((entry) => entry.hooks || []);
const check = (condition, label) => {
  if (!condition) throw new Error(label);
  console.log(`✓ ${label}`);
};

const installed = installHook(settingsPath);
const starts = hooks('SessionStart');
const prompts = hooks('UserPromptSubmit');
check(installed.reaped === 6, 'HM1 migrated, unmarked-current, and duplicate-marked hooks are reaped');
check(installed.updated === 2 && installed.count === 0, 'HM2 one marked hook per event is refreshed, not re-added');
check(starts.filter((hook) => hook._rufloSourcePatch === true).length === 1,
  'HM3 exactly one marked SessionStart hook remains');
check(prompts.filter((hook) => hook._rufloSourcePatchNotify === true).length === 1,
  'HM4 exactly one marked UserPromptSubmit hook remains');
check(starts.some((hook) => hook.command === currentStart) && !starts.some((hook) => hook.command === migratedStart),
  'HM5 SessionStart points only at the current host home');
check(prompts.some((hook) => hook.command === currentNotify) && !prompts.some((hook) => hook.command === migratedNotify),
  'HM6 UserPromptSubmit points only at the current host home');
check(starts.some((hook) => hook.command === foreignStart) && prompts.some((hook) => hook.command === foreignNotify),
  'HM7 unrelated hooks survive reconciliation');

const repeated = installHook(settingsPath);
check(repeated.count === 0 && repeated.updated === 0 && repeated.reaped === 0,
  'HM8 a second install is byte-idempotent');

const removed = removeHook(settingsPath);
check(removed.removed === 2, 'HM9 uninstall removes the two canonical marked hooks');
check(hooks('SessionStart').length === 1 && hooks('SessionStart')[0].command === foreignStart
  && hooks('UserPromptSubmit').length === 1 && hooks('UserPromptSubmit')[0].command === foreignNotify,
  'HM10 uninstall leaves only unrelated hooks');

console.log('\nAll hook migration tests passed');
