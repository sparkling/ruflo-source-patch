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

const releaseNotesLookup = `Look first for \`docs/RELEASE-NOTES-4.0.md\` beneath the installed
\`source.path\`, then at
\`\${RUVNET_BRAIN_KB:-$HOME/.cache/ruvnet-brain/kb}/.console-runtime/docs/RELEASE-NOTES-4.0.md\`.
If neither installed path exists, validate that the manifest version matches
\`^[0-9]+\\.[0-9]+\\.[0-9]+(?:-[0-9A-Za-z.-]+)?$\`, then retrieve only that exact tag with:
\`gh api --method GET -H "Accept: application/vnd.github.raw+json" "repos/stuinfla/ruvnet-brain/contents/docs/RELEASE-NOTES-4.0.md?ref=v<installed-version>"\`.
Never use \`latest\`, another version, npm/npx, a checkout, or a guessed \`~/Code\` path. If the
installed paths and exact-tag document are unavailable, report that plainly instead of fabricating
release highlights.`;

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
      `2. Read \`docs/RELEASE-NOTES-4.0.md\` (the curated highlights + its VERSION STATUS banner). Its content is
the source of truth.`,
      `2. ${releaseNotesLookup}
The exact-version document is the source of truth.`,
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

  if (command === 'whats-new') {
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
      `2. ${releaseNotesLookup}`,
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
  if (command !== 'whats-new') return false;
  let parsed;
  try {
    parsed = parseCommand(src, `native ${command}`);
  } catch {
    return false;
  }
  const body = parsed.body;
  const installedVersion = body.includes('codex plugin list --available --json')
    && body.includes('ruvnet-brain@ruvnet-brain')
    && body.includes('source.path');
  const installedNotes = body.includes('.console-runtime/docs/RELEASE-NOTES-4.0.md');
  const exactTagNotes = body.includes('application/vnd.github.raw+json')
    && body.includes('RELEASE-NOTES-4.0.md?ref=v<installed-version>')
    && body.includes('Never use `latest`');
  return installedVersion
    && (installedNotes || exactTagNotes)
    && !body.includes('~/Code/ruvnet-brain')
    && !body.includes('current repository');
}
