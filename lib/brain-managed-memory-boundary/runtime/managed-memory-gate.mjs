#!/usr/bin/env node
// Dedicated raw-SQLite enforcement for Brain #102/#103. Generic guidance remains advisory.
// ruflo-source-patch (stuinfla/ruvnet-brain#102/#103)
import {
  commandOf, findInvocations, parseHookEvent, preToolUseEnvelope, readStdinBounded, toolName,
} from './hook-input.mjs';
import {
  PATCH_MARKER, managedStore, pathHash, sqliteDatabaseArgument, writeAuditReceipt,
} from './managed-memory-policy.mjs';

void PATCH_MARKER;
const raw = (await readStdinBounded({ maxBytes: 65536 })).toString('utf8');
const event = parseHookEvent(raw);
if (toolName(event) !== 'Bash') process.exit(0);

const cwd = typeof event?.cwd === 'string' && event.cwd
  ? event.cwd
  : process.env.CLAUDE_PROJECT_DIR || process.cwd();
let refusal = null;
for (const invocation of findInvocations(commandOf(event), ['sqlite3'])) {
  const operand = sqliteDatabaseArgument(invocation.args);
  if (operand.state !== 'known') continue;
  const store = managedStore(operand.database, { cwd, env: process.env });
  if (store) { refusal = store; break; }
}
if (!refusal) process.exit(0);

try {
  writeAuditReceipt({
    event: 'raw-sqlite-refused',
    store: refusal.kind,
    pathHash: pathHash(refusal.path),
    host: process.env.RUVNET_HOOK_HOST === 'codex' ? 'codex' : 'claude',
  });
} catch (error) {
  process.stdout.write(preToolUseEnvelope(
    'deny',
    `[RuvNet Brain] raw SQLite access to this managed AgentDB store is refused; the audit receipt could not be written (${error.message}).`,
  ));
  process.exit(0);
}

process.stdout.write(preToolUseEnvelope(
  'deny',
  '[RuvNet Brain] raw SQLite access to this managed AgentDB store is refused. '
  + 'Use Ruflo memory MCP tools or `ruflo memory ... --path <store>`. '
  + 'For one exact storage-layer confirmation, use the audited `agentdb_diagnostic_read` MCP tool.',
));
process.exit(0);
