/**
 * Security MCP Tools - AIDefence Integration
 *
 * Provides MCP tools for AI manipulation defense:
 * - aidefence_scan: Scan input for threats
 * - aidefence_analyze: Deep analysis of threats
 * - aidefence_stats: Get detection statistics
 * - aidefence_learn: Learn from detection feedback
 *
 * Created with ❤️ by ruv.io
 */
import { validateText, validateIdentifier } from './validate-input.js';
import { autoInstallPackage } from './auto-install.js';
import { createRequire } from 'module';
import { findKnownMiss, recordKnownMiss } from './aidefence-known-misses.js';
// Create require for resolving module paths
const require = createRequire(import.meta.url);
// Lazy-loaded AIDefence instance
let aidefenceInstance = null;
// Track if we've attempted install this session
let installAttempted = false;
// ADR-093 follow-up: wrapper-level counters for the lightweight aidefence
// tools (has_pii, is_safe, scan-quick) that bypass the package's own
// stats tracking. The audit flagged that aidefence_stats stayed at zero
// regardless of detections from these paths. Stats now combine the
// underlying defender.getStats() with our wrapper counters so the user
// sees a true reflection of how often each tool category fired.
const wrapperStats = {
    hasPiiCalls: 0,
    hasPiiHits: 0,
    isSafeCalls: 0,
    isSafeUnsafeVerdicts: 0,
    quickScanCalls: 0,
    quickScanThreats: 0,
};
/**
 * Get or create AIDefence instance (throws if unavailable)
 */
async function getAIDefence() {
    if (aidefenceInstance) {
        return aidefenceInstance;
    }
    const packageName = '@claude-flow/aidefence';
    // First attempt - try to load via dynamic import (ESM)
    try {
        const aidefence = await import(packageName);
        const instance = aidefence.createAIDefence({ enableLearning: true });
        if (!instance) {
            throw new Error('createAIDefence returned null');
        }
        aidefenceInstance = instance;
        return instance;
    }
    catch (e) {
        // Package not found or failed to load
        const error = e;
        if (!error.message?.includes('Cannot find package') && !error.message?.includes('ERR_MODULE_NOT_FOUND')) {
            // Different error - might be a real issue
            throw new Error(`AIDefence failed to load: ${error.message}`);
        }
    }
    // Don't attempt install more than once per session
    if (installAttempted) {
        throw new Error('AIDefence package not available. Install with: npm install @claude-flow/aidefence');
    }
    installAttempted = true;
    // Second attempt - auto-install and retry
    console.error(`[claude-flow] ${packageName} not found, attempting auto-install...`);
    const installed = await autoInstallPackage(packageName);
    if (!installed) {
        throw new Error('AIDefence package not available. Install with: npm install @claude-flow/aidefence');
    }
    // #1807 — auto-install lands the package somewhere Node's standard
    // resolver couldn't find on the FIRST attempt (npm-global installs are
    // a common offender). Try Node's resolver again first (it may have
    // picked up the new node_modules directory), then fall back to the
    // file:// + cache-bust import dance, then surface a clearly actionable
    // error if everything still fails.
    // Plain re-import (covers project-local installs that landed where Node
    // looks). This often succeeds where the first attempt failed because
    // the module cache is stable across the await boundary.
    try {
        const aidefence = await import(packageName);
        const instance = aidefence.createAIDefence({ enableLearning: true });
        if (instance) {
            aidefenceInstance = instance;
            console.error(`[claude-flow] ${packageName} loaded after install (resolver path)`);
            return instance;
        }
    }
    catch { /* fall through to file:// attempt */ }
    // file:// + cache-bust attempt (covers globally-installed packages whose
    // path the standard resolver missed but require.resolve can locate).
    try {
        const modulePath = require.resolve(packageName);
        const cacheBust = `?t=${Date.now()}`;
        const aidefence = await import(`file://${modulePath}${cacheBust}`);
        const instance = aidefence.createAIDefence({ enableLearning: true });
        if (!instance) {
            throw new Error('createAIDefence returned null after install');
        }
        aidefenceInstance = instance;
        console.error(`[claude-flow] ${packageName} loaded after install (file:// path)`);
        return instance;
    }
    catch (retryError) {
        throw new Error(`AIDefence installed but failed to load: ${retryError}.\n` +
            `This usually means npm installed the package somewhere Node's module resolver doesn't search ` +
            `(common with global installs of \`claude-flow\`). Recovery options:\n` +
            `  1. Run \`npm install --save @claude-flow/aidefence\` in your project's working directory.\n` +
            `  2. Or run \`npx ruflo@latest mcp start\` from a directory whose node_modules contains the package.\n` +
            `  3. Or restart the MCP server after the install completes.`);
    }
}
