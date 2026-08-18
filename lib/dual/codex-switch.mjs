#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { constants as fsConstants } from "node:fs";
import { access, chmod, mkdir, open, readFile, unlink } from "node:fs/promises";
import path from "node:path";
import {
  CODEX_HOME,
  STATE_HOME,
  analyzeRollout,
  assertSafeRollout,
  canonicalCwd,
  exists,
  readState,
  resolveRollout,
  restoreBackup,
  sameVisibleRecords,
  sanitizeRollout,
  sessionIdFromPath,
  writeState,
} from "./codex-switch-core.mjs";

const VERSION = "3.1.0";
const PROVIDERS = new Set(["openai", "copilot"]);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const FLOCK_BIN = process.env.CODEX_FLOCK_BIN || "/usr/bin/flock";
const FLOCK_CONFLICT = 73;

function usage(exitCode = 0) {
  console.log(`codex-switch ${VERSION}

Continue one Codex resume ID while changing provider.

Usage:
  codex-switch openai  [--session UUID] [--force-boundary] [--prepare-only] [--dry-run] [--safe] [-- CODEX_ARGS...]
  codex-switch copilot [--session UUID] [--force-boundary] [--prepare-only] [--dry-run] [--safe] [-- CODEX_ARGS...]
  codex-switch status

The current project is pinned after first use. OpenAI uses the subscription account;
Copilot uses --profile copilot. The same UUID and durable conversation/tool history
are retained. Provider-private reasoning is backed up, then removed at a boundary.
An active Codex session is never rewritten. Default launch mode is --yolo.`);
  process.exit(exitCode);
}

function parseArgs(argv) {
  if (argv.length === 0 || argv.includes("--help") || argv.includes("-h")) usage();
  if (argv[0] === "status") return { command: "status" };
  const provider = argv.shift();
  if (!PROVIDERS.has(provider)) throw new Error("First argument must be openai, copilot, or status.");
  const options = { command: "switch", provider, sessionId: undefined, forceBoundary: false, dryRun: false, prepareOnly: false, yolo: true, passthrough: [] };
  while (argv.length > 0) {
    const arg = argv.shift();
    if (arg === "--") {
      options.passthrough.push(...argv);
      break;
    }
    if (arg === "--session") {
      const value = argv.shift();
      if (!value || !UUID_RE.test(value)) throw new Error("--session requires a valid UUID.");
      options.sessionId = value.toLowerCase();
    } else if (arg === "--dry-run") options.dryRun = true;
    else if (arg === "--force-boundary") options.forceBoundary = true;
    else if (arg === "--prepare-only") options.prepareOnly = true;
    else if (arg === "--safe") options.yolo = false;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (options.passthrough.some((arg) => arg === "--profile" || arg.startsWith("--profile="))) {
    throw new Error("Do not override --profile; choose openai or copilot with the first argument.");
  }
  if (options.dryRun) options.prepareOnly = true;
  return options;
}

function copilotProfile() {
  return process.env.CODEX_COPILOT_PROFILE || "copilot";
}

// Codex is resolved from PATH rather than one absolute install prefix. The host this script was
// written on has since moved its own `codex` to a different prefix, so a baked-in path silently
// pointed at a stale second installation.
async function resolveCodexBinary() {
  if (process.env.CODEX_BIN) return process.env.CODEX_BIN;
  for (const directory of (process.env.PATH || "").split(path.delimiter)) {
    if (!directory) continue;
    const candidate = path.join(directory, "codex");
    try {
      await access(candidate, fsConstants.X_OK);
      return candidate;
    } catch {
      // Not this PATH entry; keep looking.
    }
  }
  throw new Error("Codex executable was not found on PATH; set CODEX_BIN to its absolute path.");
}

// Codex does NOT fail on an undefined `--profile`: it silently falls back to the default provider.
// A copilot switch against a profile that does not exist would therefore run on the SUBSCRIPTION
// account while reporting a Copilot switch — a failure that looks like success. Refuse instead, and
// refuse BEFORE anything is prepared, so a missing profile never costs a rollout rewrite.
async function assertProfileDefined(profile) {
  const profileConfig = path.join(CODEX_HOME, `${profile}.config.toml`);
  if (await exists(profileConfig)) return;
  const rootConfig = path.join(CODEX_HOME, "config.toml");
  const source = await readFile(rootConfig, "utf8").catch((error) => {
    if (error?.code === "ENOENT") return "";
    throw error;
  });
  const escaped = profile.replaceAll(/[.*+?^${}()|[\]\\]/gu, String.raw`\$&`);
  if (new RegExp(String.raw`^[\t ]*\[profiles\.${escaped}\]`, "mu").test(source)) return;
  throw new Error(
    `Codex profile "${profile}" is not defined: neither ${profileConfig} nor a [profiles.${profile}] ` +
      `table in ${rootConfig} exists. Codex ignores an unknown --profile silently, so this would run on ` +
      "the subscription account. Nothing was changed.",
  );
}

async function acquireFallbackLock(sessionId) {
  const directory = path.join(CODEX_HOME, "thread-writer-locks");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const file = path.join(directory, `${sessionId}.lock`);
  const handle = await open(file, "wx", 0o600).catch((error) => {
    if (error?.code === "EEXIST") throw new Error(`Session ${sessionId} has an active writer lock. Exit Codex before switching; nothing was changed.`);
    throw error;
  });
  return async () => {
    await handle.close();
    await unlink(file).catch((error) => {
      if (error?.code !== "ENOENT") throw error;
    });
  };
}

function runUnderFlock(lockFile, extraEnv) {
  const child = spawnSync(
    FLOCK_BIN,
    ["--exclusive", "--nonblock", "--conflict-exit-code", String(FLOCK_CONFLICT), lockFile, process.execPath, process.argv[1], ...process.argv.slice(2)],
    { stdio: "inherit", env: { ...process.env, ...extraEnv } },
  );
  if (child.error) throw child.error;
  return child.status ?? 1;
}

async function makeLockFile(file) {
  const handle = await open(file, "a", 0o600);
  await handle.close();
  await chmod(file, 0o600);
}

async function enterLocks(sessionId) {
  if (!(await exists(FLOCK_BIN))) return false;
  const common = { CODEX_SWITCH_SESSION_ID: sessionId };
  if (process.env.CODEX_SWITCH_WRAPPER_LOCKED !== "1") {
    const directory = path.join(STATE_HOME, "locks");
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const file = path.join(directory, `${sessionId}.lock`);
    await makeLockFile(file);
    const status = runUnderFlock(file, { ...common, CODEX_SWITCH_WRAPPER_LOCKED: "1" });
    if (status === FLOCK_CONFLICT) throw new Error(`Another provider switch already controls session ${sessionId}.`);
    process.exit(status);
  }
  if (process.env.CODEX_SWITCH_WRITER_LOCKED !== "1") {
    const directory = path.join(CODEX_HOME, "thread-writer-locks");
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const file = path.join(directory, `${sessionId}.lock`);
    await makeLockFile(file);
    const status = runUnderFlock(file, { ...common, CODEX_SWITCH_WRITER_LOCKED: "1", CODEX_SWITCH_PREPARE_CHILD: "1" });
    if (status === FLOCK_CONFLICT) throw new Error(`Session ${sessionId} is active. Exit that Codex session before switching providers; nothing was changed.`);
    if (status !== 0) process.exit(status);
    return true;
  }
  return false;
}

function chooseObservedProvider(analysis, sessionState) {
  if (sessionState?.lastProvider) return sessionState.lastProvider;
  if (analysis.providers.size === 1) return [...analysis.providers][0];
  return analysis.originProvider === "copilot_api" ? "copilot" : analysis.originProvider === "openai" ? "openai" : undefined;
}

async function showStatus(cwd, state) {
  const sessionId = state.lastSessionByCwd[cwd];
  const pinned = sessionId ? state.sessions[sessionId] : undefined;
  if (!pinned) return console.log(`No session is pinned for ${cwd}.`);
  console.log(`Project:  ${cwd}\nSession:  ${sessionId}\nProvider: ${pinned.lastProvider || "unknown"}\nRollout:  ${pinned.rolloutPath}`);
}

async function prepare(options, cwd, state, rolloutPath, sessionId) {
  console.log(`Inspecting ${sessionId} without changing its identity...`);
  await assertSafeRollout(rolloutPath);
  const before = await analyzeRollout(rolloutPath);
  if (before.firstRecordType !== "session_meta" || before.sessionMetaCount < 1) throw new Error("Rollout must begin with a session_meta record.");
  if (before.sessionId !== sessionId) throw new Error(`Session metadata ID ${before.sessionId} does not match filename ID ${sessionId}.`);
  if (before.alternateSessionId && before.alternateSessionId !== sessionId) throw new Error(`Session metadata session_id ${before.alternateSessionId} does not match filename ID ${sessionId}.`);
  if (before.unknownEncryptedLocations > 0) throw new Error(`Found ${before.unknownEncryptedLocations} encrypted item(s) outside supported protocol locations; nothing was changed.`);
  const sessionState = state.sessions[sessionId];
  const observedProvider = chooseObservedProvider(before, sessionState);
  const changed = Boolean(observedProvider && observedProvider !== options.provider);
  const needsRewrite = before.replayItems > 0 && (!sessionState || changed || options.forceBoundary);
  console.log(`Provider: ${observedProvider || "unknown"} -> ${options.provider}; encrypted replay items: ${before.replayItems}.`);
  let result = { backup: undefined };
  if (needsRewrite) {
    result = await sanitizeRollout(rolloutPath, before, options.dryRun);
    if (options.dryRun) console.log(`Dry run: would remove ${before.replayItems} provider-bound replay item(s).`);
    else {
      try {
        await assertSafeRollout(rolloutPath);
        const after = await analyzeRollout(rolloutPath);
        if (after.sessionId !== before.sessionId) throw new Error("session UUID changed");
        if (after.replayItems !== 0 || after.unknownEncryptedLocations !== 0) throw new Error("provider-bound encrypted replay state remains");
        if (after.protectedMessageBlocks !== before.protectedMessageBlocks) throw new Error("protected assistant-message history changed");
        if (!sameVisibleRecords(before.visibleRecords, after.visibleRecords)) throw new Error("visible message/tool record counts changed");
        if (after.retainedHash !== before.retainedHash) throw new Error("retained conversation/tool history hash changed");
      } catch (error) {
        await restoreBackup(result.backup, rolloutPath, result.sourceMode);
        throw new Error(`Post-write verification failed and the original was restored: ${error.message}`);
      }
      console.log(`Prepared the same session UUID; exact backup: ${result.backup}`);
    }
  } else console.log("No cross-provider encrypted replay state requires removal.");
  if (!options.dryRun) {
    state.sessions[sessionId] = {
      rolloutPath,
      lastCwd: cwd,
      lastProvider: options.provider,
      lastBackup: result.backup || sessionState?.lastBackup,
      originalSha256: result.originalHash || sessionState?.originalSha256,
      updatedAt: new Date().toISOString(),
    };
    state.lastSessionByCwd[cwd] = sessionId;
    await writeState(state);
  }
}

async function launchCodex(options, sessionId) {
  const binary = await resolveCodexBinary();
  if (!(await exists(binary))) throw new Error(`Codex executable not found: ${binary}`);
  const args = options.provider === "copilot"
    ? ["--profile", copilotProfile()]
    : ["--config", 'model_provider="openai"'];
  args.push("resume", sessionId);
  if (options.yolo) args.push("--yolo");
  args.push(...options.passthrough);
  const childEnv = { ...process.env };
  if (options.provider === "openai") delete childEnv.OPENAI_API_KEY;
  const child = spawnSync(binary, args, { stdio: "inherit", env: childEnv });
  if (child.error) throw child.error;
  process.exit(child.status ?? 1);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (process.env.CODEX_SWITCH_SESSION_ID) options.sessionId = process.env.CODEX_SWITCH_SESSION_ID;
  if (process.env.CODEX_SWITCH_PREPARE_CHILD === "1") options.prepareOnly = true;
  if (options.provider === "copilot") await assertProfileDefined(copilotProfile());
  const cwd = await canonicalCwd();
  const state = await readState();
  if (options.command === "status") return showStatus(cwd, state);
  const rolloutPath = await resolveRollout(options, cwd, state);
  const sessionId = sessionIdFromPath(rolloutPath);
  if (!sessionId) throw new Error(`Cannot derive a session UUID from ${rolloutPath}.`);
  const preparedByChild = await enterLocks(sessionId);
  if (preparedByChild) return options.prepareOnly ? undefined : launchCodex(options, sessionId);
  const release = process.env.CODEX_SWITCH_WRITER_LOCKED === "1" ? async () => {} : await acquireFallbackLock(sessionId);
  try {
    await prepare(options, cwd, state, rolloutPath, sessionId);
  } finally {
    await release();
  }
  if (!options.prepareOnly) return launchCodex(options, sessionId);
}

main().catch((error) => {
  console.error(`codex-switch: ${error.message}`);
  process.exit(1);
});
