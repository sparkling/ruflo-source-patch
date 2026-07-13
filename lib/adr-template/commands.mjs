// Dispatch for the `adr-template` target — patches the installed `ruflo-adr`
// plugin's `adr-create` skill template in place (ruvnet/ruflo#2659). See
// patcher.mjs for the actual fix and why it's needed.

import { apply, revert, status } from './patcher.mjs';

export function adrTemplateCommand(action) {
  const log = (m) => console.log(`[adr-template] ${m}`);

  if (action === 'install' || action === 'init') {
    const r = apply();
    for (const l of r.log) log(l);
    log(`patched: ${r.patched}, unchanged: ${r.unchanged}, skipped: ${r.skipped}`);
    return true;
  }
  if (action === 'uninstall' || action === 'remove') {
    const r = revert();
    for (const l of r.log) log(l);
    log(r.reverted ? `reverted ${r.reverted} file(s)` : 'nothing to revert (not installed)');
    return true;
  }
  if (action === 'status') {
    const s = status();
    for (const l of s.log) log(l);
    log(`${s.patched}/${s.files} installed copy/copies patched`);
    return true;
  }
  return false;
}
