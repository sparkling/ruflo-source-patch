import { apply } from '../cwd/patch-library.mjs';
import { readState } from '../cwd/state.mjs';
import { ISSUE } from './patcher.mjs';
import { probeSqliteOwnerReplacement } from './probe.mjs';

export const rufloSqliteOwnerSupersession = {
  issue: ISSUE,
  replacement: 'one actual ControllerRegistry/AgentDB native SQLite dependency identity for graph, repair and recovery handles',
  check: probeSqliteOwnerReplacement,
  retire: ({ retiring = new Set() } = {}) => apply(readState().patchTargets
    .filter(target => target !== 'ruflo-sqlite-owner' && !retiring.has(target))),
};
