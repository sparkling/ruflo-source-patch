// Existing hook integration must not swallow a rejected wrapper invocation.
import { accountHome, versionParts, compare, selectCli } from './runtime.mjs';
export const HOOK_ANCHOR = `  if (commandExists('ruflo')) {
    invokeHook('ruflo', [], hookSubcommand, hookArgs, stdinData);
    return;
  }
  if (commandExists('claude-flow')) {
    invokeHook('claude-flow', [], hookSubcommand, hookArgs, stdinData);
    return;
  }
  // SKIP npx when RUFLO_HOOK_SKIP_NPX=1 — used by CI smokes that test the
  // shim's *control flow* without exercising npm install network paths.
  // Without the skip, npx can take 30+s on a cold runner, exceeding a
  // smoke's timeout and producing a spurious failure even though the shim
  // itself works correctly. The bash version doesn't hit this because it
  // backgrounded the work.
  if (process.env.RUFLO_HOOK_SKIP_NPX !== '1') {
    invokeHook('npx', ['--prefer-offline', '--yes', 'ruflo@latest'], hookSubcommand, hookArgs, stdinData);
  }
}`;

// Historical npx-only rendition is retained for exact upgrade/reversal. It
// avoided branding drift but ignored installed drivers and could cold-install
// hundreds of dependencies inside the Stop hook's bounded child invocation.
export const NPX_HOOK_REPLACEMENT = `  // ruflo-source-patch (ruvnet/ruflo#3306): the implementation package only; no wrapper, no PATH binary.
  if (process.env.RUFLO_HOOK_SKIP_NPX !== '1') {
    invokeHook('npx', ['--prefer-offline', '--yes', '@claude-flow/cli@latest'], hookSubcommand, hookArgs, stdinData);
  }
}`;

// Ruflo-core 0.2.6 renamed its read-only command probe without changing the
// unsafe selection order. Keep a distinct owned rendition for exact reversal.
export const HOOK_ANCHOR_026 = HOOK_ANCHOR.replaceAll('commandExists(', 'resolveCommandPath(');
export const NPX_HOOK_REPLACEMENT_026 = NPX_HOOK_REPLACEMENT.replace(
  'the implementation package only;', '0.2.6 implementation package only;');

// The earlier revision required a `claude-flow` executable on PATH and exited 1 otherwise.
// Still recognised so an installed copy migrates in place and reverses to pristine.
export const PRIOR_HOOK_REPLACEMENT = `  // ruflo-source-patch (ruvnet/ruflo#3306): direct installed implementation only.
  if (commandExists('claude-flow')) {
    invokeHook('claude-flow', [], hookSubcommand, hookArgs, stdinData);
    return;
  }
  fs.writeSync(2, '[ruflo-source-patch] Ruflo hook unavailable: install @claude-flow/cli and expose its claude-flow executable on PATH. No wrapper or npx fallback was started. https://github.com/ruvnet/ruflo/issues/3306\\n');
  process.exit(1);
}`;

export const LEGACY_ANCHOR = "  // Priority 1: locally installed ruflo binary\n  if (commandExists('ruflo')) {\n    invokeHook('ruflo', [], hookArgs, stdinData);\n    done();\n  }\n\n  // Priority 2: locally installed claude-flow binary\n  if (commandExists('claude-flow')) {\n    invokeHook('claude-flow', [], hookArgs, stdinData);\n    done();\n  }\n\n  // Priority 3: npx --prefer-offline fallback (avoids cold registry resolve).\n  //\n  // SKIP this when RUFLO_HOOK_SKIP_NPX=1 — used by CI smokes that test\n  // the shim's *control flow* without exercising npm install network paths.\n  // Without the skip, npx can take 30+s on a cold runner (no warm cache,\n  // no offline tarball), exceeding the smoke's 15s timeout and producing\n  // a spurious failure even though the shim itself works correctly.\n  // The bash version doesn't hit this because it backgrounded the work.\n  if (process.env.RUFLO_HOOK_SKIP_NPX !== '1') {\n    invokeHook('npx', ['--prefer-offline', '--yes', 'ruflo@latest'], hookArgs, stdinData);\n  }\n\n  done();";
export const NPX_LEGACY_REPLACEMENT = `  // ruflo-source-patch (ruvnet/ruflo#3306): the implementation package only; no wrapper, no PATH binary.
  if (process.env.RUFLO_HOOK_SKIP_NPX !== '1') {
    invokeHook('npx', ['--prefer-offline', '--yes', '@claude-flow/cli@latest'], hookArgs, stdinData);
  }

  done();`;
export const PRIOR_LEGACY_REPLACEMENT = `  // ruflo-source-patch (ruvnet/ruflo#3306): direct installed implementation only.
  if (commandExists('claude-flow')) {
    invokeHook('claude-flow', [], hookArgs, stdinData);
    done();
  }
  fs.writeSync(2, '[ruflo-source-patch] Ruflo hook unavailable: install @claude-flow/cli and expose its claude-flow executable on PATH. No wrapper or npx fallback was started. https://github.com/ruvnet/ruflo/issues/3306\\n');
  process.exit(1);`;

// Serialize the shared wrapper selector into installed CJS hook bytes. There
// is one maintained resolver; neither branded PATH commands nor a second
// independently implemented version/package policy is introduced here.
const selection = `  const rspInstalledCli = (() => {
    const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
${[accountHome, versionParts, compare, selectCli].map(fn => fn.toString()).join('\n')}
    try { return selectCli(__filename); }
    catch (error) {
      if (error.message === 'no installed stable @claude-flow/cli found') return null;
      fs.writeSync(2, '[ruflo-source-patch #3306] Native hook implementation refused: ' + error.message + '\\n');
      return false;
    }
  })();`;
function replacement({ legacy = false, version = '' } = {}) {
  const args = legacy ? 'hookArgs, stdinData' : 'hookSubcommand, hookArgs, stdinData';
  const stop = legacy ? 'done();' : 'return;';
  return `  // ruflo-source-patch (ruvnet/ruflo#3306): ${version}verified installed implementation before npx.
${selection}
  if (rspInstalledCli) {
    invokeHook(process.execPath, [rspInstalledCli], ${args});
    ${stop}
  }
  if (rspInstalledCli === false) { ${stop} }
  if (process.env.RUFLO_HOOK_SKIP_NPX !== '1') {
    invokeHook('npx', ['--prefer-offline', '--yes', '@claude-flow/cli@latest'], ${args});
  }
${legacy ? '\n  done();' : '}'}`;
}
export const HOOK_REPLACEMENT = replacement();
export const HOOK_REPLACEMENT_026 = replacement({ version: '0.2.6 ' });
export const LEGACY_REPLACEMENT = replacement({ legacy: true });

export function patchHook(source) {
  const variants = [
    [HOOK_REPLACEMENT_026, [NPX_HOOK_REPLACEMENT_026, HOOK_ANCHOR_026]],
    [LEGACY_REPLACEMENT, [NPX_LEGACY_REPLACEMENT, PRIOR_LEGACY_REPLACEMENT, LEGACY_ANCHOR]],
    [HOOK_REPLACEMENT, [NPX_HOOK_REPLACEMENT, PRIOR_HOOK_REPLACEMENT, HOOK_ANCHOR]],
  ];
  const current = variants.filter(([replacement]) => source.includes(replacement));
  if (current.length === 1 && source.split(current[0][0]).length === 2
      && source.split('ruflo-source-patch (ruvnet/ruflo#3306)').length === 2) {
    return { next: source, applied: [], missing: [] };
  }
  if (current.length) return { next: source, applied: [], missing: ['unique-hook-wrapper-selection'] };
  const matching = variants.flatMap(([replacement, priors]) => priors
    .filter(prior => source.includes(prior)).map(prior => ({ replacement, prior })));
  if (matching.length !== 1 || source.split(matching[0].prior).length !== 2) {
    return { next: source, applied: [], missing: ['unique-hook-wrapper-selection'] };
  }
  return { next: source.replace(matching[0].prior, matching[0].replacement),
    applied: ['installed-implementation-hook'], missing: [] };
}
