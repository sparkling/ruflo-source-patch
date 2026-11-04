// Published MCP 3.1.5/3.1.6 omit the request-local legacy session boundary.
// Reuse PR #3268's AsyncLocalStorage + validated credential fingerprint design;
// retain the published 2025-11-25 protocol and native SessionManager lifecycle.
import fs from 'node:fs';
import path from 'node:path';
import { discover as discoverPackages } from '../cwd/package-discovery.mjs';
import { makeSurface, makeDescriptor } from '../ruflo-memory-entries-only/transform.mjs';
export const NAME = 'ruflo-http-sessions';
export const MARKER = 'ruflo-source-patch (ruflo#3294): request-local native HTTP sessions';
const edit = (id, old, next) => ({ id, old, new: next });
const serverSurface = (recovery = false) => makeSurface({ id: 'server', identity: 'export class MCPServer extends EventEmitter {', edits: [
  edit('scope-import', "import { EventEmitter } from 'events';", `import { EventEmitter } from 'events';\nimport { AsyncLocalStorage } from 'node:async_hooks';\n// ${MARKER}`),
  edit('scope', '    currentSession;', `    httpSessionContext = new AsyncLocalStorage();
    httpSessionPrincipals = new WeakMap();
    unscopedSession;
    get currentSession() {
        const scope = this.httpSessionContext.getStore();
        return scope ? scope.session : this.unscopedSession;
    }
    set currentSession(session) {
        const scope = this.httpSessionContext.getStore();
        if (!scope) { this.unscopedSession = session; return; }
        scope.session = session;
        if (session) this.httpSessionPrincipals.set(session, scope.principal);
    }
    async withHttpSession(message, context, dispatch) {
        if (!context) return dispatch(); // Existing stdio/WebSocket/direct API.
        const session = context.sessionId ? this.sessionManager.getSession(context.sessionId) : undefined;
        if (message.method === 'initialize' ? !!context.sessionId
            : !session?.isInitialized || this.httpSessionPrincipals.get(session) !== context.principal) {
            context.reply.status = context.sessionId && message.method !== 'initialize' ? 404 : 400;
            ${recovery ? 'const refusal =' : 'return'} this.createErrorResponse(message.id ?? null, ErrorCodes.SERVER_NOT_INITIALIZED,
                'HTTP session is absent, expired or belongs to another principal; initialize a new session');${recovery ? `
            if (context.sessionId && !session && message.method === 'tools/call' && context.principal.startsWith('token:'))
                refusal.error.data = { protocol: 'ruflo/http-session', version: 1, reason: 'session-not-found', dispatched: false };
            return refusal;` : ''}
        }
        const scope = { session, principal: context.principal };
        return this.httpSessionContext.run(scope, async () => {
            const response = await dispatch();
            if (message.method === 'initialize' && response?.result && scope.session)
                context.reply.sessionId = scope.session.id;
            return response;
        });
    }`),
  edit('request-context', 'transport.onRequest(async (request) => await this.handleRequest(request));',
    'transport.onRequest(async (request, context) => this.withHttpSession(request, context, () => this.handleRequest(request)));'),
  edit('notification-context', 'transport.onNotification(async (notification) => {\n                    await this.handleNotification(notification);\n                });',
    'transport.onNotification(async (notification, context) => this.withHttpSession(notification, context, () => this.handleNotification(notification)));'),
] });
const server = serverSurface(true), legacyServer = serverSurface();
const http = makeSurface({ id: 'http', identity: 'export class HttpTransport extends EventEmitter {', edits: [
  edit('principal', '    sseClients = new Map();', `    sseClients = new Map();
    // ${MARKER}
    sseContexts = new WeakMap();
    requestPrincipal(req) {
        // Called only after native authentication; metadata never grants authority.
        return this.config.auth && this.config.auth.enabled !== false
            ? 'token:' + createHash('sha256').update(bearerToken(req.headers.authorization)).digest('hex')
            : 'anonymous';
    }`),
  edit('cors', "allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-ID'],",
    "allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-ID', 'Mcp-Session-Id', 'MCP-Protocol-Version'],\n                exposedHeaders: ['Mcp-Session-Id'],"),
  edit('legacy-sse-principal', '            this.sseClients.set(sessionId, res);',
    '            this.sseClients.set(sessionId, res);\n            this.sseContexts.set(res, { principal: this.requestPrincipal(req) });'),
  edit('http-context', '        const sseResponse = sseSessionId ? this.sseClients.get(sseSessionId) : undefined;', `        const sseResponse = sseSessionId ? this.sseClients.get(sseSessionId) : undefined;
        const principal = this.requestPrincipal(req);
        const legacy = sseResponse ? this.sseContexts.get(sseResponse) : undefined;
        const header = req.headers['mcp-session-id'];
        if ((header !== undefined && (typeof header !== 'string' || !/^[!-~]{1,256}$/.test(header)))
            || (sseSessionId && (!legacy || legacy.principal !== principal))) {
            res.status(sseSessionId ? 404 : 400).json({ jsonrpc: '2.0', id: message.id ?? null,
                error: { code: -32002, message: 'Invalid HTTP session' } });
            return;
        }
        const context = Object.freeze({ principal, sessionId: header ?? legacy?.sessionId, reply: {} });`),
  edit('http-notification', '                await this.notificationHandler(message);\n            }\n            if (res.headersSent',
    `                let response;
                try { response = await this.notificationHandler(message, context); }
                catch (error) {
                    this.logger.warn('Native HTTP notification rejected', {
                        method: ['notifications/ruflo/memory-owner-release', 'notifications/cancelled', 'notifications/initialized', 'initialized'].includes(message.method) ? message.method : 'other',
                        reason: ['Invalid native owner client retirement', 'Invalid one-call owner retirement'].includes(error?.message) ? error.message : 'handler-error',
                    });
                    if (!res.headersSent && !res.writableEnded && !res.destroyed)
                        res.status(500).json({ jsonrpc: '2.0', id: null,
                            error: { code: -32603, message: 'Native notification rejected' } });
                    return;
                }
                if (context.reply.status && !res.headersSent && !res.writableEnded && !res.destroyed) {
                    res.status(context.reply.status).json(response); return;
                }
            }
            if (res.headersSent`),
  edit('http-request', '                const response = await this.requestHandler(message);\n                // A timed-out request',
    '                const response = await this.requestHandler(message, context);\n                // A timed-out request'),
  edit('http-response', '                if (sseResponse) {\n                    sseResponse.write', `                if (context.reply.status) {
                    res.status(context.reply.status).json(response); return;
                }
                if (context.reply.sessionId) {
                    res.setHeader('Mcp-Session-Id', context.reply.sessionId);
                    if (legacy) legacy.sessionId = context.reply.sessionId;
                }
                if (sseResponse) {
                    sseResponse.write`),
  edit('delete', "        this.app.get('/info', (req, res) => {", `        // Session deletion is optional. Existing owner completion retirement remains authoritative.
        this.app.delete('/mcp', (_req, res) => res.status(405).end());
        this.app.get('/info', (req, res) => {`),
] });
export const discover = () => ['server.js', 'transport/http.js'].flatMap(file =>
  discoverPackages(['@claude-flow', 'mcp', 'dist', ...file.split('/')]).filter(location => {
    let manifest;
    try { manifest = JSON.parse(fs.readFileSync(path.resolve(location, ...Array(file.split('/').length + 1).fill('..'), 'package.json'), 'utf8')); }
    catch { return false; }
    const [major, minor, patch] = String(manifest?.version).split('.').map(Number);
    return manifest?.name === '@claude-flow/mcp' && (major > 3 || major === 3 && (minor > 1 || minor === 1 && patch >= 5));
  }));
// Retire only after executable native proof of per-principal legacy isolation,
// expired-ID 404 before dispatch, restart/reinitialize and completion retirement.
export const descriptor = makeDescriptor({ name: NAME, surfaces: [server, http], discover });
const currentPatch = descriptor.patchSource, currentReverse = descriptor.reverse, currentHas = descriptor.hasPatch;
descriptor.patchSource = source => legacyServer.patched(source)
  ? currentPatch(legacyServer.reverse(source)) : currentPatch(source);
descriptor.reverse = source => legacyServer.patched(source) ? legacyServer.reverse(source) : currentReverse(source);
descriptor.hasPatch = source => currentHas(source) || legacyServer.patched(source);
descriptor.historicalPatchSource = source => source.includes(server.identity) ? legacyServer.patch(source) : http.patch(source);
descriptor.preflight = () => {
  const roots = new Set(discover().map(file => file.slice(0, file.lastIndexOf(path.sep + 'dist' + path.sep))));
  const errors = [];
  for (const root of roots) for (const relative of ['server.js', 'transport/http.js']) {
    const file = path.join(root, 'dist', relative);
    try {
      const stat = fs.lstatSync(file);
      if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('unsafe HTTP session source');
      const result = descriptor.patchSource(fs.readFileSync(file, 'utf8'));
      if (result.missing.length) throw new Error(result.missing.join('; '));
    } catch (error) { errors.push(file + ': ' + error.message); }
  }
  return { ok: errors.length === 0, errors };
};
export const { patchSource, reverse, hasPatch, isPatched } = descriptor;
