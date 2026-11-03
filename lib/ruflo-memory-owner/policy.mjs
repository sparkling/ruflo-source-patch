// Reuse the native request-construction/evaluator seam. Metadata is a consistency
// assertion, never an authorization or a replacement for native policy evaluation.
export async function createOwnerPolicyProtocol(moduleUrl) {
  const { AsyncLocalStorage } = await import('node:async_hooks');
  const { realpathSync } = await import('node:fs');
  const { resolve } = await import('node:path');
  const scope = new AsyncLocalStorage();
  const key = 'ruflo/native-owner-policy';
  const authorityKeys = ['CLAUDE_FLOW_PRINCIPAL_ID', 'CLAUDE_FLOW_CAPABILITY_ENVELOPE',
    'CLAUDE_FLOW_MCP_CALLER_AUTH', 'CLAUDE_FLOW_MCP_INVOCATION_TOKEN', 'CLAUDE_FLOW_MCP_CALLER_PUBKEY',
    'CLAUDE_FLOW_POLICY_SIGNING_KEY', 'CLAUDE_FLOW_POLICY_KEY_ID', 'CLAUDE_FLOW_POLICY_EVIDENCE_KEYS'];
  const eligible = (context = {}) => !authorityKeys.some(name => Object.hasOwn(process.env, name))
    && (context.serverId === undefined || context.serverId === 'ruflo') && context.environment === undefined;
  const fail = () => { throw new Error('policy-owner-projection-mismatch'); };
  const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  const exactKeys = (value, keys) => object(value) && Object.keys(value).every(name => keys.includes(name));
  async function authority(root = process.cwd()) {
    if (!eligible()) return undefined;
    const { policyTrustRoot } = await import(new URL('./services/policy-ledger-anchor.js', moduleUrl));
    return { version: 1, root: realpathSync(root), trustRoot: resolve(policyTrustRoot()) };
  }
  async function advertise() {
    // Absence is a compatibility result, never permission to skip a check.
    try { return await authority(); } catch { return undefined; }
  }
  function validate(value) {
    if (!exactKeys(value, ['authority', 'request']) || !object(value.authority) || !object(value.request)
        || value.authority.version !== 1 || Buffer.byteLength(JSON.stringify(value)) > 65536) fail();
    const request = value.request;
    if (request.identity?.id !== 'legacy-cli' || request.identity?.type !== 'legacy'
        || request.action?.server !== 'ruflo' || request.action?.environment !== undefined
        || request.context?.envelope !== undefined) fail();
    const context = request.context;
    if (!object(context) || (context.approvalIds !== undefined
        && (!Array.isArray(context.approvalIds) || context.approvalIds.some(id => typeof id !== 'string')))
        || (context.evidence !== undefined && !Array.isArray(context.evidence))) fail();
    return value;
  }
  async function project(name, input, context, owner) {
    if (!eligible(context)) return undefined;
    const { authorizeMcpTool, classifyMcpTool } = await import(new URL('./services/policy-runtime.js', moduleUrl));
    // Native construction still validates identity/envelope and derives the root.
    const projection = await authorizeMcpTool(name, input, context, classifyMcpTool(name),
      async (request, root) => ({ request, authority: await authority(root) }));
    if (projection.authority.root !== realpathSync(owner.cwd)) return undefined;
    return validate(projection);
  }
  const matches = (a, b) => a?.version === 1 && b?.version === 1
    && a.root === b.root && a.trustRoot === b.trustRoot;
  function run(request, next) {
    const value = request.params?._meta?.[key];
    if (value === undefined) return scope.run(undefined, next);
    if (request.method !== 'tools/call') fail();
    return scope.run(structuredClone(validate(value)), next);
  }
  function context(nativeContext) {
    const value = scope.getStore();
    if (!value) return nativeContext;
    if (nativeContext?.transport !== 'http' || !eligible(nativeContext)) fail();
    // Identity, root, server and environment stay native owner values. Only IDs
    // and evidence pass to the native scoped approval/evidence verifiers.
    return { ...nativeContext, approvalIds: value.request.context.approvalIds,
      evidence: value.request.context.evidence };
  }
  async function verify(request, root) {
    const value = scope.getStore();
    if (!value) return 'owner';
    if (!eligible() || !matches(value.authority, await authority(root))) fail();
    const { canonicalizePolicy } = await import('@claude-flow/security/policy/index');
    if (canonicalizePolicy(value.request) !== canonicalizePolicy(request)) fail();
    return 'owner-coalesced';
  }
  return { key, eligible, advertise, project, matches, run, context, verify };
}
