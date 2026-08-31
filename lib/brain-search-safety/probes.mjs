// Executable/native retirement probes for RuvNet Brain #224/#225.

import vm from 'node:vm';

const extract = (source, startNeedle, endNeedle) => {
  const start = source.indexOf(startNeedle);
  const end = start < 0 ? -1 : source.indexOf(endNeedle, start);
  return start >= 0 && end > start ? source.slice(start, end) : null;
};

export function probeSymbolRouteSource(source) {
  const stop = extract(source, 'const SYM_STOP =', '\nfunction symbolRoute');
  const route = extract(source, 'function symbolRoute', '\nconst VENDORED_DEP_RE');
  if (!stop || !route) {
    return { state: 'unknown', evidence: 'could not isolate SYM_STOP + symbolRoute from forge-ask.mjs' };
  }

  const program = `${stop}\n${route}\n(() => {
    const empty = { bySymbol: {}, byStem: {}, byPackage: {} };
    const missing = [...symbolRoute('HarnessKernel constructor worker', empty)];

    const inherited = { inheritedroute: ['must/not/route.ts'] };
    const inheritedTables = {
      bySymbol: Object.create(inherited),
      byStem: Object.create(inherited),
      byPackage: Object.create(inherited),
    };
    const inheritedHits = [...symbolRoute('inheritedroute', inheritedTables)];

    const own = {
      bySymbol: { constructor: ['packages/harness/src/kernel.ts'] },
      byStem: {},
      byPackage: {},
    };
    const ownHits = [...symbolRoute('constructor', own)];

    const malformed = {
      bySymbol: { constructor: { path: 'wrong-shape' } },
      byStem: { constructor: 7 },
      byPackage: { constructor: 'wrong-shape' },
    };
    const malformedHits = [...symbolRoute('constructor', malformed)];
    return { missing, inheritedHits, ownHits, malformedHits };
  })()`;

  try {
    const result = new vm.Script(program, { filename: 'forge-ask-symbol-route-proof.mjs' })
      .runInNewContext({}, { timeout: 1000 });
    const valid = result.missing.length === 0
      && result.inheritedHits.length === 0
      && result.ownHits.length === 1
      && result.ownHits[0] === 'packages/harness/src/kernel.ts'
      && result.malformedHits.length === 0;
    return valid
      ? { state: 'proven', evidence: 'constructor/inherited/malformed values ignored; own array routed' }
      : { state: 'live', evidence: `symbolRoute behavior mismatch: ${JSON.stringify(result)}` };
  } catch (error) {
    return { state: 'live', evidence: `symbolRoute executable probe failed: ${error.name}: ${error.message}` };
  }
}

const hasForbiddenRepair = (source) => source.includes('cd ~/.cache/ruvnet-brain/kb && npm i')
  || source.includes('npx github:stuinfla/ruvnet-brain');

export function safeMcpFailureGuidance(source) {
  return source.includes('RUVNET BRAIN IS DOWN')
    && source.includes('First error: ${firstErr}')
    && source.includes('isError: true')
    && !hasForbiddenRepair(source)
    && /do not[^\n]*(?:repair|mutate|install|download|reinstall)/i.test(source);
}

export function safeCliFailureGuidance(source) {
  return source.includes("console.error('First error: ' + failed[0][1])")
    && source.includes('process.exit(1)')
    && !hasForbiddenRepair(source)
    && /(?:no automatic repair|do not[^\n]*(?:repair|mutate|install|download|reinstall))/i.test(source);
}
