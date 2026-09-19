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

// ruflo-core's shim documents its own chain: a local `ruflo`/`claude-flow` binary, else
// `npx --prefer-offline ruflo@latest`, always exit 0. The `ruflo` step is the #3306 hazard
// (its nested dependency may be an older runtime than the version it reports) and a PATH
// binary is a global install the documented npx path never creates. Call the implementation
// package itself, as ruflo-core's MCP launcher and the generated project hook-handler do.
// Exit status stays upstream's: hooks are best-effort telemetry and never block a turn.
export const HOOK_REPLACEMENT = `  // ruflo-source-patch (ruvnet/ruflo#3306): the implementation package only; no wrapper, no PATH binary.
  if (process.env.RUFLO_HOOK_SKIP_NPX !== '1') {
    invokeHook('npx', ['--prefer-offline', '--yes', '@claude-flow/cli@latest'], hookSubcommand, hookArgs, stdinData);
  }
}`;

// Ruflo-core 0.2.6 renamed its read-only command probe without changing the
// unsafe selection order. Keep a distinct owned rendition for exact reversal.
export const HOOK_ANCHOR_026 = HOOK_ANCHOR.replaceAll('commandExists(', 'resolveCommandPath(');
export const HOOK_REPLACEMENT_026 = HOOK_REPLACEMENT.replace(
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
export const LEGACY_REPLACEMENT = `  // ruflo-source-patch (ruvnet/ruflo#3306): the implementation package only; no wrapper, no PATH binary.
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

export function patchHook(source) {
  for (const [replacement, prior] of [
    [HOOK_REPLACEMENT_026, HOOK_ANCHOR_026],
    [LEGACY_REPLACEMENT, PRIOR_LEGACY_REPLACEMENT],
    [HOOK_REPLACEMENT, PRIOR_HOOK_REPLACEMENT],
  ]) {
    if (source.includes(replacement)) return { next: source, applied: [], missing: [] };
    if (source.split(prior).length === 2) {
      return { next: source.replace(prior, replacement), applied: ['implementation-package-hook'], missing: [] };
    }
  }
  if (source.split(LEGACY_ANCHOR).length === 2) {
    return { next: source.replace(LEGACY_ANCHOR, LEGACY_REPLACEMENT), applied: ['implementation-package-hook'], missing: [] };
  }
  if (source.split(HOOK_ANCHOR_026).length === 2) {
    return { next: source.replace(HOOK_ANCHOR_026, HOOK_REPLACEMENT_026), applied: ['implementation-package-hook'], missing: [] };
  }
  if (source.split(HOOK_ANCHOR).length !== 2) {
    return { next: source, applied: [], missing: ['unique-hook-wrapper-selection'] };
  }
  return { next: source.replace(HOOK_ANCHOR, HOOK_REPLACEMENT), applied: ['implementation-package-hook'], missing: [] };
}
