#!/usr/bin/env node
// Markdown linter. Structure first, formatting second.
//
// The rules that matter are the STRUCTURAL ones. A document whose headings you discover while writing is
// a document with no structure, and the dash is where that failure hides. `## cache / how it works` is not
// a heading with punctuation in it. It is a heading and its subheading welded into one line, because the
// hierarchy was never designed.
//
// So the dash is banned outright, and swapping in a colon is not a fix: `## cache: how it works` is the
// same failure wearing different punctuation. Ask what the two halves ARE, and give each the structure it
// deserves.
//
//   node scripts/md-lint.mjs [paths...]      (default: every README.md in the repo)

import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const REPO = path.dirname(path.dirname(url.fileURLToPath(import.meta.url)));

function findReadmes(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === '.git' || e.name === 'node_modules') continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) findReadmes(p, out);
    else if (e.name.endsWith('.md')) out.push(p);
  }
  return out;
}

const files = process.argv.length > 2
  ? process.argv.slice(2)
  : findReadmes(REPO);

// GitHub's heading-anchor algorithm, near enough: lowercase, strip punctuation, spaces to hyphens.
const slug = (h) => h.toLowerCase()
  .replace(/`/g, '')
  .replace(/[^\w\s-]/g, '')
  .trim()
  .replace(/\s+/g, '-');

const DASH = /[—–]|(?<![-\w])--(?![-\w])/;   // em-dash, en-dash, or a bare `--`

let total = 0;

for (const file of files.sort()) {
  const rel = path.relative(REPO, file);
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  const errs = [];

  // Headings, ignoring fenced code — where `# a comment` is a comment, not a heading.
  const heads = [];
  let fence = false;
  lines.forEach((l, i) => {
    if (l.startsWith('```')) { fence = !fence; return; }
    if (fence) return;
    const m = /^(#{1,6}) (.+)$/.exec(l);
    if (m) heads.push({ level: m[1].length, text: m[2], line: i + 1 });
  });
  const anchors = new Set(heads.map((h) => slug(h.text)));

  // ── 1. NO DASHES. Anywhere. ───────────────────────────────────────────────
  fence = false;
  lines.forEach((l, i) => {
    if (l.startsWith('```')) { fence = !fence; return; }
    if (fence) return;                                   // code may legitimately contain --
    if (!DASH.test(l)) return;
    const isHeading = /^#{1,6} /.test(l);
    errs.push(isHeading
      ? `${i + 1}: DASH IN A HEADING. Two headings welded into one. Give each its own level.\n        ${l.trim()}`
      : `${i + 1}: dash. Split the sentence, or make the second half a heading/list item. Do NOT swap in a colon.\n        ${l.trim().slice(0, 96)}`);
  });

  // ── 2. every internal link resolves to a heading that exists ──────────────
  lines.forEach((l, i) => {
    for (const m of l.matchAll(/\]\(#([^)]+)\)/g)) {
      if (!anchors.has(m[1])) errs.push(`${i + 1}: link #${m[1]} resolves to NO heading`);
    }
  });

  // ── 3. heading levels never skip ──────────────────────────────────────────
  let prev = 0;
  for (const h of heads) {
    if (prev && h.level > prev + 1) {
      errs.push(`${h.line}: heading level jumps ${prev} -> ${h.level}: "${h.text}"`);
    }
    prev = h.level;
  }

  // ── 4. blank lines around headings, code fences and tables ────────────────
  fence = false;
  lines.forEach((l, i) => {
    if (l.startsWith('```')) {
      if (!fence && i > 0 && lines[i - 1].trim()) errs.push(`${i + 1}: code fence with no blank line before it`);
      fence = !fence;
      return;
    }
    if (fence) return;
    if (/^#{1,6} /.test(l)) {
      if (i > 0 && lines[i - 1].trim()) errs.push(`${i + 1}: heading with no blank line before it`);
      if (i + 1 < lines.length && lines[i + 1].trim()) errs.push(`${i + 1}: heading with no blank line after it`);
    }
    if (l.startsWith('|') && i > 0 && lines[i - 1].trim() && !lines[i - 1].startsWith('|')) {
      errs.push(`${i + 1}: table with no blank line before it`);
    }
  });

  if (errs.length) {
    total += errs.length;
    console.log(`\n✘ ${rel}`);
    for (const e of errs.slice(0, 15)) console.log(`    ${e}`);
    if (errs.length > 15) console.log(`    ... and ${errs.length - 15} more`);
  } else {
    console.log(`✔ ${rel}  (${heads.length} headings)`);
  }
}

console.log(`\n${total} problem(s) across ${files.length} file(s)`);
process.exit(total ? 1 : 0);
