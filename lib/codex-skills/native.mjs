// Exact Codex transforms for command-derived and already-native plugin skills.

import { createHash } from 'node:crypto';

const ZERO_HASH = '0'.repeat(64);

export const marker = (issue, digest = ZERO_HASH) =>
  `<!-- ruflo-source-patch ${issue} sha256=${digest} -->`;
const digest = (src) => createHash('sha256').update(src).digest('hex');

export function stamp(src, issue) {
  const placeholder = marker(issue);
  if (!src.includes(placeholder)) throw new Error('generated skill has no ownership placeholder');
  return src.replace(placeholder, marker(issue, digest(src)));
}

export function isOwned(src, issue) {
  const escaped = issue.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = src.match(new RegExp(
    `<!-- ruflo-source-patch ${escaped} sha256=([a-f0-9]{64}) -->`,
  ));
  if (!match) return false;
  return digest(src.replace(match[0], marker(issue))) === match[1];
}

export function parseCommand(src, label) {
  const match = src.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) throw new Error(`${label}: command frontmatter is not bounded by ---`);
  const description = match[1].match(/^description:\s*(.+)$/m)?.[1];
  if (!description) throw new Error(`${label}: command has no one-line description`);
  return { frontmatter: match[1], description, body: match[2].trim() };
}

export function replaceOnce(src, before, after, label) {
  const count = src.split(before).length - 1;
  if (count !== 1) throw new Error(`${label}: expected exactly one source anchor, found ${count}`);
  return src.replace(before, after);
}

export function isNativeRufloStatus(src) {
  let parsed;
  try {
    parsed = parseCommand(src, 'native ruflo-status');
  } catch {
    return false;
  }
  if (!/^name:\s*ruflo-status$/m.test(src)) return false;
  const explicitAt = parsed.body.indexOf('## Explicit repair workflow');
  const defaultAt = parsed.body.indexOf('## Default read-only workflow');
  if (defaultAt < 0 || explicitAt <= defaultAt) return false;
  const readOnly = parsed.body.slice(defaultAt, explicitAt);
  const repair = parsed.body.slice(explicitAt);
  return readOnly.includes('npx @claude-flow/cli@latest doctor')
    && readOnly.includes('npx @claude-flow/cli@latest status')
    && readOnly.includes('Do not repair, reset, start,')
    && !readOnly.includes('doctor --fix')
    && repair.includes('Only when the user explicitly asks')
    && repair.includes('npx @claude-flow/cli@latest doctor --fix')
    && repair.includes('Never infer');
}

const sourceLookup = `Run \`codex plugin list --available --json\`, select the installed and enabled
\`ruvnet-brain@ruvnet-brain\` row, and inspect its \`source.path\`. Use that directory or its parent,
whichever contains \`scripts/onboarding-console.mjs\`. If the plugin is absent or neither path contains
the script, report that plainly; do not download, pin, mirror, or substitute Brain.`;

function brainConsoleBody() {
  return `# Brain Console

Treat \`/rvbc\`, \`/rvcb\`, \`/brain-console\`, and \`/ruvnet-brain:configure\` as equally valid names.
Never correct the user's spelling.

1. Say one short sentence: "Opening it now; it scans live while you watch."
2. ${sourceLookup}
3. Run \`node <resolved-root>/scripts/onboarding-console.mjs --serve --open\` in the background.
4. Give the URL immediately. Do not promise a duration; the page reports its own scan progress.

An already-running server is success. The Console is read-only until the user chooses an action;
every change must be explained and reversible. If the script cannot be located or the server fails,
report the exact failure plainly instead of claiming the Console opened.`;
}

export function renderNativeAdditive(command, skill, src, issue) {
  const parsed = parseCommand(src, command);
  let body = parsed.body;

  if (command === 'ruflo-status') {
    if (!body.startsWith('$ARGUMENTS\n')) {
      throw new Error('ruflo-status: expected the Claude-only $ARGUMENTS prelude');
    }
    body = body.slice('$ARGUMENTS\n'.length);
    if (!body.includes('doctor') || !body.includes('status') || !body.includes('doctor --fix')) {
      throw new Error('ruflo-status: read-only doctor/status contract changed');
    }
  }

  if (command === 'brain-console') body = brainConsoleBody();

  if (command === 'rvbc') {
    body = replaceOnce(body,
      `## 2. Find the repo

Prefer \`~/Code/ruvnet-brain\`. If \`$CLAUDE_PLUGIN_ROOT\` is set, the repo may be its parent
directory. Use whichever path actually contains \`scripts/onboarding-console.mjs\`.`,
      `## 2. Find the installed source

${sourceLookup}`,
      'rvbc');
  }

  if (command === 'whats-new') {
    body = replaceOnce(body,
      `**First, ground — never recite this from memory (it drifts every release):**
1. Read the running version from \`\${CLAUDE_PLUGIN_ROOT}/.claude-plugin/plugin.json\`. State it honestly.`,
      `**First, ground — never recite this from memory (it drifts every release):**
1. Run \`codex plugin list --available --json\`, select the installed and enabled
   \`ruvnet-brain@ruvnet-brain\` row, and read the running version from
   \`<source.path>/.claude-plugin/plugin.json\`. State it honestly.`,
      'whats-new plugin root');
    body = replaceOnce(body,
      `2. Read \`docs/RELEASE-NOTES-4.0.md\` (the curated highlights + its VERSION STATUS banner). Its content is`,
      `2. Read \`docs/RELEASE-NOTES-4.0.md\` from \`source.path\` or its parent, whichever contains it
   (the curated highlights + its VERSION STATUS banner). Its content is`,
      'whats-new notes path');
    body = replaceOnce(body,
      `If they say yes, follow \`rvbc.md\` in this same directory exactly (including the
warm heads-up about the ~20s scan).`,
      `If they say yes, use the \`ruvnet-brain:rvbc\` skill. Do not invent a duration; the Console
reports its own scan progress.`,
      'whats-new console handoff');
  }

  if (body.includes('CLAUDE_PLUGIN_ROOT') || body.includes('rvbc.md` in this same directory')) {
    throw new Error(`${command}: Claude-only path survived the Codex transform`);
  }

  return stamp(`---
name: ${skill}
description: ${parsed.description}
---
${marker(issue)}

${body}
`, issue);
}

export function renderNativeBrainEdit(command, skill, src, issue) {
  const parsed = parseCommand(src, `native ${command}`);
  if (!new RegExp(`^name:\\s*${skill}$`, 'm').test(parsed.frontmatter)) {
    throw new Error(`${command}: native skill name changed`);
  }
  let body = parsed.body;

  if (command === 'brain-console' || command === 'rvbc') {
    body = replaceOnce(body,
      `2. Locate \`scripts/onboarding-console.mjs\` from the current repository. If it is not present,
   check \`~/Code/ruvnet-brain/scripts/onboarding-console.mjs\`. Do not invent another path.`,
      `2. ${sourceLookup}`,
      `${command} native source`);
  } else if (command === 'whats-new') {
    body = replaceOnce(body,
      `1. Read the installed plugin version from \`.codex-plugin/plugin.json\` relative to this skill's
   plugin root. If that is unavailable, read the current checkout's \`plugin/.codex-plugin/plugin.json\`.`,
      `1. Run \`codex plugin list --available --json\`, select the installed and enabled
   \`ruvnet-brain@ruvnet-brain\` row, and read the installed version from
   \`<source.path>/.claude-plugin/plugin.json\`.`,
      'whats-new native version');
    body = replaceOnce(body,
      `2. Locate \`docs/RELEASE-NOTES-4.0.md\` in the current repository, then
   \`~/Code/ruvnet-brain/docs/RELEASE-NOTES-4.0.md\`. Read it before summarizing.`,
      `2. Read \`docs/RELEASE-NOTES-4.0.md\` from \`source.path\` or its parent, whichever contains it.
   If neither contains it, report that the installed notes are unavailable.`,
      'whats-new native notes');
  } else {
    throw new Error(`${command}: no native Brain edit`);
  }

  return stamp(`---
${parsed.frontmatter}
---
${marker(issue)}

${body}
`, issue);
}

export function isNativeBrainReady(command, src) {
  let parsed;
  try {
    parsed = parseCommand(src, `native ${command}`);
  } catch {
    return false;
  }
  const body = parsed.body;
  return body.includes('codex plugin list --available --json')
    && body.includes('ruvnet-brain@ruvnet-brain')
    && body.includes('source.path')
    && !body.includes('~/Code/ruvnet-brain')
    && !body.includes('current repository');
}
