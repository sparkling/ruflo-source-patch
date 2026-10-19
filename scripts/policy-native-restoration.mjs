// Explicit operator conversion of our legacy segments through their existing native owner.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export async function restoreNativePolicy({ project, destination, oldCliRoot, newCliRoot }) {
  if (![project, destination, oldCliRoot, newCliRoot].every(p => typeof p === 'string' && path.isAbsolute(p)))
    throw Error('Absolute project, recovery and installed CLI paths required');
  project = fs.realpathSync(project);
  destination = path.join(fs.realpathSync(path.dirname(destination)), path.basename(destination));
  if (!destination.startsWith(project + '/.local/two-store-restoration/') || fs.existsSync(destination))
    throw Error('Use a new project recovery directory; never overwrite an original');
  const modulePath = root => path.join(root, 'dist/src/services/policy-runtime.js');
  for (const root of [oldCliRoot, newCliRoot]) {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
    if (pkg.name !== '@claude-flow/cli') throw Error('Installed @claude-flow/cli owner required');
  }
  const oldSource = fs.readFileSync(modulePath(oldCliRoot), 'utf8');
  if (!oldSource.includes('function rspExpandLedger(') || !oldSource.includes('options.compact === true'))
    throw Error('Verified legacy segment owner required');
  const nextSource = fs.readFileSync(modulePath(newCliRoot), 'utf8');
  if (!nextSource.includes('verifyFullPolicyLedger') || !nextSource.includes('engine.pruneReceipts('))
    throw Error('Native full-history audit and pruning owner required');
  const old = await import(pathToFileURL(modulePath(oldCliRoot)));
  const next = await import(pathToFileURL(modulePath(newCliRoot)));
  const security = await import(pathToFileURL(createRequire(modulePath(newCliRoot)).resolve('@claude-flow/security')));
  const { policyTrustRoot } = await import(pathToFileURL(path.join(oldCliRoot, 'dist/src/services/policy-ledger-anchor.js')));
  const receipt = { schema: 'ruflo-native-policy-restoration/v1', project, oldCliRoot, newCliRoot,
    status: 'preparing', at: new Date().toISOString(), qualification: 'No policy decisions, signatures, receipts or trust anchors are reset. Legacy owner expands verified history under its native writer lock.' };
  fs.mkdirSync(destination, { mode: 0o700 });
  const save = () => fs.writeFileSync(path.join(destination, 'receipt.json'), JSON.stringify(receipt, null, 2) + '\n', { mode: 0o600 });
  save();
  try {
    await old.withPolicyTransaction(project, engine => {
      const compact = old.loadPolicyState(project, { compact: true });
      if (!compact.policyArchive || compact.policyLedgerMode !== 'segmented-v1')
        throw Error('Project has no recognized legacy segmented policy state');
      // loadPolicyState verifies segment MACs, the complete historical receipt chain,
      // signatures and the existing native state/secondary trust anchors.
      const expanded = old.loadPolicyState(project);
      if (expanded.policyArchive || expanded.policyLedgerMode || !Array.isArray(expanded.receipts)
        || expanded.receipts.length !== compact.policyArchive.length + compact.receipts.length)
        throw Error('Legacy full-history expansion is incomplete');
      receipt.expandedSha256 = digest(expanded); receipt.receipts = expanded.receipts.length;
      receipt.ledgerHead = expanded.ledgerHead;
      const accepted = security.AgenticPolicyEngine.fromState(expanded, {
        signingKey: process.env.CLAUDE_FLOW_POLICY_SIGNING_KEY, keyId: process.env.CLAUDE_FLOW_POLICY_KEY_ID,
      }).verifyLedger();
      if (!accepted.valid || accepted.length !== receipt.receipts)
        throw Error('Native engine refuses original history: ' + JSON.stringify(accepted));
      fs.cpSync(path.join(project, '.claude-flow/policy'), path.join(destination, 'original-policy'), { recursive: true });
      const trust = path.join(policyTrustRoot(), createHash('sha256').update(project).digest('hex'));
      fs.cpSync(trust, path.join(destination, 'original-trust'), { recursive: true });
      receipt.status = 'backed-up'; save();
      engine.state = structuredClone(expanded);
    });
    // No synthetic evaluation or new decision is needed for this conversion.
    const current = next.loadPolicyState(project);
    if (digest(current) !== receipt.expandedSha256) throw Error('Native expanded state differs from verified original history');
    const verified = await next.verifyPolicyLedger(project, { full: true });
    if (!verified.valid || verified.length < receipt.receipts) throw Error('Native full-history verification failed: ' + JSON.stringify(verified));
    receipt.concurrentAppendsAfterExactRead = verified.length - receipt.receipts;
    receipt.status = 'verified'; receipt.nativeVerification = verified;
    receipt.completedAt = new Date().toISOString(); save(); return receipt;
  } catch (error) { receipt.status = 'failed'; receipt.error = error.message; save(); throw error; }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [project, destination, oldCliRoot, newCliRoot] = process.argv.slice(2);
  if (process.argv.length !== 6) throw Error('Usage: policy-native-restoration.mjs <project> <new-recovery-directory> <legacy-cli-root> <native-cli-root>');
  const r = await restoreNativePolicy({ project, destination, oldCliRoot, newCliRoot });
  console.log(JSON.stringify({ project, status: r.status, receipts: r.receipts, expandedSha256: r.expandedSha256 }));
}
