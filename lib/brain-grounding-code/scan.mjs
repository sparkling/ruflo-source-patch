// #46: lexical filtering only; keep strings and uncertain syntax intact.
export function codeContext(event) {
  const input = event?.tool_input;
  if (!input || typeof input.file_path !== 'string') return null;
  const pieces = [];
  if (typeof input.content === 'string') pieces.push({ text: input.content, full: event.tool_name === 'Write' });
  if (typeof input.new_string === 'string') {
    if (input.new_string.startsWith('*** Begin Patch\n')) {
      // The native Codex adapter puts the complete raw patch in new_string and
      // invokes the policy for each file. Inspect only that file's operation.
      let operation = null;
      const operations = [];
      for (const line of input.new_string.split(/\r?\n/)) {
        const header = /^\*\*\* (Add|Update|Delete) File: (.+)$/.exec(line);
        if (header) {
          operation = { kind: header[1], file: header[2].trim(), lines: [] };
          operations.push(operation);
        } else if (line === '*** End Patch') operation = null;
        else if (operation && !line.startsWith('*** ')) operation.lines.push(line);
      }
      const match = operations.filter((op) => op.file === input.file_path);
      if (match.length !== 1 || match[0].kind !== 'Add'
          || match[0].lines.some((line) => !line.startsWith('+'))) return null;
      pieces.push({ text: match[0].lines.map((line) => line.slice(1)).join('\n'), full: true });
    } else pieces.push({ text: input.new_string, full: false });
  }
  if (Array.isArray(input.edits)) {
    for (const edit of input.edits) {
      if (typeof edit?.new_string !== 'string') return null;
      pieces.push({ text: edit.new_string, full: false });
    }
  }
  if (!pieces.length) return null;
  const python = /\.py$/i.test(input.file_path);
  const js = /\.(?:mjs|cjs|js|jsx|ts|tsx)$/i.test(input.file_path);
  if (!python && !js) return null;
  function filter({ text, full }) {
    if (!full) return text; // A fragment may be inserted inside a string.
    let out = '';
    for (let i = 0; i < text.length;) {
      const char = text[i];
      if ((python && char === '#') || (js && text.slice(i, i + 2) === '//')) {
        const end = text.indexOf('\n', i);
        if (end < 0) break;
        out += '\n'; i = end + 1; continue;
      }
      if (js && text.slice(i, i + 2) === '/*') {
        const end = text.indexOf('*/', i + 2);
        if (end < 0) return text;
        out += ' '; i = end + 2; continue;
      }
      if (js && char === '/') return text; // Regex/division syntax is uncertain.
      if (char === '"' || char === "'" || (js && char === '`')) {
        const triple = python && text.slice(i, i + 3) === char.repeat(3);
        const delimiter = triple ? char.repeat(3) : char;
        let end = i + delimiter.length;
        for (; end < text.length; end++) {
          if (text[end] === '\\') { end++; continue; }
          if (text.slice(end, end + delimiter.length) === delimiter) break;
        }
        if (end >= text.length) return text;
        const after = end + delimiter.length;
        const prefix = text.slice(text.lastIndexOf('\n', i - 1) + 1, i);
        // Only standalone triple-quoted Python prose. Assigned strings, call
        // arguments, f-strings and attribute/call continuations remain code.
        const before = out.trim().replace(/[rRuU]$/, '').trim();
        const docPosition = !before || /(?:^|\n)[ \t]*(?:async[ \t]+)?(?:def|class)[^\n]+:[ \t]*$/.test(before);
        const prose = full && triple && docPosition && /^\s*[rRuU]?$/.test(prefix)
          && /^[ \t]*(?:\r?\n|#|$)/.test(text.slice(after));
        out += prose ? ' ' : text.slice(i, after);
        i = after; continue;
      }
      out += char; i++;
    }
    return out;
  }
  return [input.file_path, ...pieces.map(filter)].join('\n');
}
