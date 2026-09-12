// Existing hook integration must not swallow a rejected wrapper invocation.
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

export const HOOK_REPLACEMENT = `  // ruflo-source-patch (ruvnet/ruflo#3306): direct installed implementation only.
  if (commandExists('claude-flow')) {
    invokeHook('claude-flow', [], hookSubcommand, hookArgs, stdinData);
    return;
  }
  fs.writeSync(2, '[ruflo-source-patch] Ruflo hook unavailable: install @claude-flow/cli and expose its claude-flow executable on PATH. No wrapper or npx fallback was started. https://github.com/ruvnet/ruflo/issues/3306\\n');
  process.exit(1);
}`;

export const LEGACY_ANCHOR = "  // Priority 1: locally installed ruflo binary\n  if (commandExists('ruflo')) {\n    invokeHook('ruflo', [], hookArgs, stdinData);\n    done();\n  }\n\n  // Priority 2: locally installed claude-flow binary\n  if (commandExists('claude-flow')) {\n    invokeHook('claude-flow', [], hookArgs, stdinData);\n    done();\n  }\n\n  // Priority 3: npx --prefer-offline fallback (avoids cold registry resolve).\n  //\n  // SKIP this when RUFLO_HOOK_SKIP_NPX=1 — used by CI smokes that test\n  // the shim's *control flow* without exercising npm install network paths.\n  // Without the skip, npx can take 30+s on a cold runner (no warm cache,\n  // no offline tarball), exceeding the smoke's 15s timeout and producing\n  // a spurious failure even though the shim itself works correctly.\n  // The bash version doesn't hit this because it backgrounded the work.\n  if (process.env.RUFLO_HOOK_SKIP_NPX !== '1') {\n    invokeHook('npx', ['--prefer-offline', '--yes', 'ruflo@latest'], hookArgs, stdinData);\n  }\n\n  done();";
export const LEGACY_REPLACEMENT = `  // ruflo-source-patch (ruvnet/ruflo#3306): direct installed implementation only.
  if (commandExists('claude-flow')) {
    invokeHook('claude-flow', [], hookArgs, stdinData);
    done();
  }
  fs.writeSync(2, '[ruflo-source-patch] Ruflo hook unavailable: install @claude-flow/cli and expose its claude-flow executable on PATH. No wrapper or npx fallback was started. https://github.com/ruvnet/ruflo/issues/3306\\n');
  process.exit(1);`;

export function patchHook(source) {
  if (source.includes(LEGACY_REPLACEMENT)) return { next: source, applied: [], missing: [] };
  if (source.split(LEGACY_ANCHOR).length === 2) {
    return { next: source.replace(LEGACY_ANCHOR, LEGACY_REPLACEMENT), applied: ['legacy-direct-hook'], missing: [] };
  }
  if (source.includes(HOOK_REPLACEMENT)) return { next: source, applied: [], missing: [] };
  if (source.split(HOOK_ANCHOR).length !== 2) {
    return { next: source, applied: [], missing: ['unique-hook-wrapper-selection'] };
  }
  return { next: source.replace(HOOK_ANCHOR, HOOK_REPLACEMENT), applied: ['direct-hook-implementation'], missing: [] };
}
