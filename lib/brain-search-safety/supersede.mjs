// Retirement requires a marker-free active shared KB whose exact symbolRoute
// executes safely and whose two outage renderers remain loud without unproved repair.

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { reconcile } from '../plugin-compose.mjs';
import { readState } from '../cwd/state.mjs';
import { PATCH_MARKER, sourceFiles } from './patcher.mjs';
import {
  probeSymbolRouteSource,
  safeCliFailureGuidance,
  safeMcpFailureGuidance,
} from './probes.mjs';

export { probeSymbolRouteSource, safeCliFailureGuidance, safeMcpFailureGuidance };

function check() {
  const files = sourceFiles();
  if (files.length !== 3) {
    return { state: 'unknown', evidence: `expected three active shared-KB search files; found ${files.length}` };
  }

  const sources = new Map();
  for (const file of files) {
    try {
      const source = fs.readFileSync(file, 'utf8');
      if (source.includes(PATCH_MARKER)) {
        return { state: 'live', evidence: `${file} still carries the local #224/#225 patch` };
      }
      const syntax = spawnSync(process.execPath, ['--check', file], {
        encoding: 'utf8', timeout: 5000, maxBuffer: 1024 * 1024,
      });
      if (syntax.error || syntax.status !== 0) {
        return {
          state: 'unknown',
          evidence: `${file} does not pass Node syntax validation: ${syntax.error?.message || syntax.stderr || `exit ${syntax.status}`}`,
        };
      }
      sources.set(file, source);
    } catch (error) {
      return { state: 'unknown', evidence: `could not read ${file}: ${error.message}` };
    }
  }

  const routerEntry = [...sources].find(([file]) => file.endsWith('/forge-ask.mjs'));
  const mcpEntry = [...sources].find(([file]) => file.endsWith('/forge-mcp-all.mjs'));
  const cliEntry = [...sources].find(([file]) => file.endsWith('/forge-ask-all.mjs'));
  if (!routerEntry || !mcpEntry || !cliEntry) {
    return { state: 'unknown', evidence: 'active KB search file identities are incomplete' };
  }

  let shared = '';
  try { shared = fs.readFileSync(path.join(path.dirname(mcpEntry[0]), 'search-outcome.mjs'), 'utf8'); }
  catch { /* legacy KB has inline guidance instead */ }

  const route = probeSymbolRouteSource(routerEntry[1]);
  if (route.state !== 'proven') return { state: 'live', evidence: route.evidence };
  if (!safeMcpFailureGuidance(mcpEntry[1], shared)) {
    return { state: 'live', evidence: 'MCP total-failure response still permits or prescribes unproved repair' };
  }
  if (!safeCliFailureGuidance(cliEntry[1], shared)) {
    return { state: 'live', evidence: 'CLI total-failure response still permits or prescribes unproved repair' };
  }
  return {
    state: 'superseded',
    evidence: 'active shared KB executes safe own-array symbol routing and both failure paths reject automatic repair',
  };
}

export const brainSearchSafetySupersession = {
  issue: 'https://github.com/stuinfla/ruvnet-brain/issues/224',
  replacement: 'RuvNet Brain native own-array symbol routing (#224) and classified, non-mutating failure guidance (#225)',
  check,
  retire: () => {
    const remaining = readState().pluginTargets.filter((target) => target !== 'brain-search-safety');
    return reconcile(remaining, ['brain-search-safety']);
  },
};
