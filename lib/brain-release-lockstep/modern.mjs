// The native 4.5.2 doctor has one structured verdict, so gate that verdict directly.
export const MODERN_MARKER = 'brain-release-lockstep:structured-doctor';
export function modernEdits(legacy, marker) {
  const version = legacy.find((edit) => edit.id === 'doctor-version-state');
  const compare = legacy.find((edit) => edit.id === 'all-component-version-check');
  const report = legacy.find((edit) => edit.id === 'fail-closed-version-report');
  const currentReport = report.find
    .replace("that's normal (they update on separate schedules) and neither one is broken. To bring the",
      'they update on separate schedules; this comparison does not prove either is healthy. To bring the')
    .replace('(then restart Claude Code)', '(body updates go live without a restart; boot-surface changes are called out)');
  const health = '  const allGreen = v.repos > 0 && v.reader && v.mcp;';
  const gatedHealth = `  // ${marker}: ${MODERN_MARKER}.\n  const allGreen = v.repos > 0 && v.reader && v.mcp && !versionState.drift;`;
  const verdict = "    check('identity', 'Identity', !installedIdentity.healthy, installedIdentity.healthy ? 'search engine, validator and archive manifest agree'";
  const gatedVerdict = `    check('release-lockstep', 'Release lockstep', versionState.drift,\n      versionState.drift ? versionState.resolved.map(([name, version]) => name + ': ' + version).join('; ') : 'resolved components agree',\n      'Wait for a matching upstream release, then restart the hosts through their native lifecycle'),\n${verdict}`;
  return [version, compare, { ...report, find: currentReport },
    { id: 'doctor-health-gate', find: health, replace: gatedHealth, done: (source) => source.includes(gatedHealth) },
    { id: 'doctor-structured-verdict', find: verdict, replace: gatedVerdict, done: (source) => source.includes(gatedVerdict) }];
}
