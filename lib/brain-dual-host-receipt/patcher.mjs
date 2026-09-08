// RuvNet Brain #272: keep the dual-host deliberation coordinator, but never start a
// second Ruflo memory driver to persist its receipt. The helper emits a structured
// memory_store request for its MCP-aware caller and accepts only exact-key verification.

import fs from 'node:fs';
import path from 'node:path';
import { HOME_BASE } from '../cwd/paths.mjs';

export const PATCH_MARKER = 'ruflo-source-patch (stuinfla/ruvnet-brain#272)';

export const IMPORT_ANCHOR = `import { spawn, spawnSync } from 'node:child_process';`;
export const IMPORT_REPLACEMENT = `import { spawn } from 'node:child_process';`;

export const PERSIST_ANCHOR = `export async function persistDeliberationReceipt(receipt, {
  cwd = process.cwd(),
  now = Date.now,
  run = spawnSync,
} = {}) {
  const recordedAt = now();
  const value = {
    protocol: receipt.protocol,
    taskHash: receipt.taskHash,
    hosts: receipt.hosts,
    roles: receipt.roles,
    accepted: receipt.accepted === true,
    verifiedOutcome: receipt.accepted === true,
    recordedAt: new Date(recordedAt).toISOString(),
  };
  const key = \`dual-deliberation-\${recordedAt}-\${receipt.taskHash.slice(0, 12)}\`;
  const result = run('ruflo', [
    'memory', 'store',
    '-k', key,
    '--value', JSON.stringify(value),
    '--namespace', 'ruvnet-brain',
    '--path', '.swarm/memory.db',
    '--no-upsert',
    '--scan-content',
  ], {
    cwd,
    encoding: 'utf8',
    env: subscriptionOnlyEnv(),
    timeout: 15_000,
  });
  return result?.status === 0;
}`;

export const PERSIST_REPLACEMENT = `export function buildDeliberationPersistenceRequest(receipt, {
  now = Date.now,
} = {}) {
  const recordedAt = now();
  const value = {
    protocol: receipt.protocol,
    taskHash: receipt.taskHash,
    hosts: receipt.hosts,
    roles: receipt.roles,
    accepted: receipt.accepted === true,
    verifiedOutcome: receipt.accepted === true,
    recordedAt: new Date(recordedAt).toISOString(),
  };
  const key = \`dual-deliberation-\${recordedAt}-\${receipt.taskHash.slice(0, 12)}\`;
  return {
    tool: 'memory_store',
    arguments: {
      namespace: 'ruvnet-brain',
      key,
      value: JSON.stringify(value),
    },
  };
}

export async function persistDeliberationReceipt(receipt, {
  now = Date.now,
  persist,
} = {}) {
  // ${PATCH_MARKER}: the standalone coordinator cannot borrow its caller's MCP
  // transport. Emit the exact request instead of opening a competing CLI driver.
  const request = buildDeliberationPersistenceRequest(receipt, { now });
  if (typeof persist !== 'function') return { persisted: false, request };
  const proof = await persist(request);
  const persisted = proof?.stored === true
    && proof?.verified === true
    && proof?.key === request.arguments.key;
  return { persisted, request };
}`;

export const DELIBERATE_ANCHOR = `  const cwd = options.cwd ?? process.cwd();
  const persist = options.persist ?? ((receipt) => persistDeliberationReceipt(receipt, { cwd }));`;

export const DELIBERATE_REPLACEMENT = `  const cwd = options.cwd ?? process.cwd();
  const persist = options.persist;`;

export const RESULT_ANCHOR = `  const learningPersisted = accepted ? Boolean(await persist(receipt)) : false;
  return {
    status: accepted ? 'accepted' : 'unresolved',
    dual: true,
    roles,
    artifact,
    verification: verification.ok ? verification.value : undefined,
    verifiedOutcome: accepted,
    learningPersisted,
  };`;

export const RESULT_REPLACEMENT = `  const persistence = accepted
    ? await persistDeliberationReceipt(receipt, { persist, now: options.now })
    : { persisted: false, request: null };
  return {
    status: accepted ? 'accepted' : 'unresolved',
    dual: true,
    roles,
    artifact,
    verification: verification.ok ? verification.value : undefined,
    verifiedOutcome: accepted,
    learningPersisted: persistence.persisted,
    ...(persistence.request ? { learningPersistenceRequest: persistence.request } : {}),
  };`;

const EDITS = [
  ['remove-cli-import', IMPORT_ANCHOR, IMPORT_REPLACEMENT],
  ['emit-mcp-request', PERSIST_ANCHOR, PERSIST_REPLACEMENT],
  ['caller-owned-persist', DELIBERATE_ANCHOR, DELIBERATE_REPLACEMENT],
  ['truthful-persistence-result', RESULT_ANCHOR, RESULT_REPLACEMENT],
];

const occurrences = (source, needle) => source.split(needle).length - 1;

export function patchSource(pristine) {
  let next = pristine;
  const applied = [];
  const missing = [];
  for (const [id, find, replace] of EDITS) {
    if (next.includes(replace)) continue;
    const count = occurrences(next, find);
    if (count !== 1) {
      missing.push(count > 1 ? `${id}(AMBIGUOUS: anchor occurs ${count}x)` : id);
      continue;
    }
    next = next.replace(find, replace);
    applied.push(id);
  }
  return { next, applied, missing };
}

export function reverseSource(source) {
  return EDITS.reduceRight((current, [, find, replace]) => current.replace(replace, find), source);
}

export const hasPatch = (source) => source.includes(PATCH_MARKER);
export const isPatched = (source) => EDITS.every(([, , replace]) => source.includes(replace));

export function discover() {
  const brainHome = process.env.RSP_RUVNET_BRAIN_HOME
    ? path.resolve(process.env.RSP_RUVNET_BRAIN_HOME)
    : path.join(HOME_BASE, '.cache', 'ruvnet-brain');
  const candidates = [
    path.join(brainHome, 'kb', '.console-runtime', 'scripts', 'dual-host-deliberation.mjs'),
    path.join(HOME_BASE, '.claude', 'model-router', 'bin', 'dual-host-deliberation.mjs'),
  ];
  return candidates.filter((file) => {
    try {
      const stat = fs.lstatSync(file);
      return stat.isFile() && !stat.isSymbolicLink() && stat.size > 0;
    } catch { return false; }
  });
}

export const descriptor = {
  name: 'brain-dual-host-receipt',
  atomic: true,
  missingIsIncomplete: true,
  discover,
  patchSource,
  isPatched,
  hasPatch,
  reverse: reverseSource,
};
