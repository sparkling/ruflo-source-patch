// Native executable proofs for #273 and #316. Isolate HOME, fake both model CLIs,
// and copy executable bytes only. Nothing selects, updates or writes a Brain generation.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { discover as stdinFiles } from '../brain-dual-host-stdin/patcher.mjs';
import { discover as stampFiles } from '../brain-grounding-evidence/patcher.mjs';
import { HOME_BASE } from '../cwd/paths.mjs';
import * as routerImports from '../brain-router-imports/patcher.mjs';

function regular(file) {
  const st = fs.lstatSync(file);
  if (!st.isFile() || st.isSymbolicLink() || !st.size) throw new Error(`unsafe or empty executable: ${file}`);
}
function pristine(file) {
  regular(file);
  const source = fs.readFileSync(file, 'utf8');
  if (!source.includes('ruflo-source-patch')) return source;
  const backup = `${file}.rsp-backup`;
  regular(backup);
  const original = fs.readFileSync(backup, 'utf8');
  if (original.includes('ruflo-source-patch')) throw new Error(`owned pristine backup: ${backup}`);
  return original;
}
function environment(home, bin) {
  return { HOME: home, PATH: `${bin}${path.delimiter}${process.env.PATH || ''}`,
    RUVNET_NODE_BIN: process.execPath, RUVNET_HOOK_HOST: 'codex',
    RUVNET_SKIP_GROUNDING_CHECK: '0', MODEL_ROUTER_PROFILE: path.join(home, 'profile.json') };
}
function child(script, env) {
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
    env, encoding: 'utf8', timeout: 15_000, maxBuffer: 2 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) throw new Error(result.error?.message || result.stderr || `exit ${result.status}`);
}
const fakeHost = `#!/usr/bin/env node
import { createHash } from 'node:crypto';
let input = ''; for await (const chunk of process.stdin) input += chunk;
const value = JSON.stringify({ bytes: Buffer.byteLength(input),
  hash: createHash('sha256').update(input).digest('hex'), args: process.argv.slice(2) });
process.stdout.write(process.argv[1].endsWith('/claude')
  ? JSON.stringify({ result: value })
  : JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: value } }));
`;

export function probeDualHostStdinReplacement({ files = stdinFiles(), brainHome = process.env.RSP_RUVNET_BRAIN_HOME
  || process.env.RUVNET_BRAIN_HOME || path.join(HOME_BASE, '.cache/ruvnet-brain') } = {}) {
  let temporary;
  try {
    if (!files.length) return { state: 'unknown', evidence: 'no installed dual-host coordinator discovered' };
    temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'rsp-native-stdin-'));
    const bin = path.join(temporary, 'bin');
    fs.mkdirSync(bin);
    for (const name of ['claude', 'codex']) fs.writeFileSync(path.join(bin, name), fakeHost, { mode: 0o755 });
    for (const [index, file] of files.entries()) {
      const dir = path.join(temporary, String(index)); fs.mkdirSync(dir);
      let source = pristine(file);
      let importRepair = false;
      for (const name of ['subscription-hosts.mjs', 'review-model-defaults.mjs']) {
        const sibling = path.join(path.dirname(file), name);
        if (name === 'review-model-defaults.mjs' && !fs.existsSync(sibling)) {
          // Retire ONLY stdin's overlay. The independently validated #341 import
          // repair must already be active; receipt durability stays pristine here.
          const live = fs.readFileSync(file, 'utf8');
          if (!routerImports.isPatched(live)) throw new Error(`missing native sibling without active #341 repair: ${sibling}`);
          const patched = routerImports.patchSource(source);
          if (patched.missing.length || !routerImports.isPatched(patched.next)) throw new Error('unproved #341 import composition');
          source = patched.next; importRepair = true;
          continue;
        }
        regular(sibling);
        fs.copyFileSync(sibling, path.join(dir, name));
      }
      fs.writeFileSync(path.join(dir, 'dual-host-deliberation.mjs'), source);
      const url = JSON.stringify(pathToFileURL(path.join(dir, 'dual-host-deliberation.mjs')).href);
      child(`import assert from 'node:assert/strict'; import { createHash } from 'node:crypto';
        const mod = await import(${url});
        const payload = { task: 'stdin-only proof', proposal: 'P'.repeat(300 * 1024) };
        const prompt = ['You are one half of a subscription-only Claude Code and Codex deliberation.',
          'Do not request or use API keys. Work read-only. Return JSON only.',
          'Stage: critique', JSON.stringify(payload)].join('\\n');
        for (const host of ['claude-code', 'codex']) {
          const result = await mod.runSubscriptionHost(host, 'critique', payload, { cwd: ${JSON.stringify(dir)} });
          assert.equal(result.ok, true, JSON.stringify(result));
          assert.equal(result.value.bytes, Buffer.byteLength(prompt));
          assert.equal(result.value.hash, createHash('sha256').update(prompt).digest('hex'));
          assert.equal(result.value.args.some(arg => arg.includes('P'.repeat(1024))), false);
        }`, { ...environment(dir, bin), ...(importRepair ? { RUVNET_BRAIN_HOME: path.resolve(brainHome) } : {}) });
    }
    return { state: 'superseded', evidence: `${files.length} native coordinators (retaining separately owned #341 import repair where required) deliver byte-exact 300 KiB prompts to both fake host CLIs exclusively over stdin` };
  } catch (error) { return { state: 'unknown', evidence: `native stdin proof failed: ${error.message}` }; }
  finally { if (temporary) fs.rmSync(temporary, { recursive: true, force: true }); }
}

const success = 'Searched 1 RuvNet repos (ruvnet-brain).\n#1  repo=ruvnet-brain\npath : plugin/scripts/grounding-stamp.sh';
const card = '⚡ FAST LANE — zero-ML keyword match (named directly)\n#1  repo=ruflo  evidence=curated-capability-card\npath : ruflo/kb/capability-cards.md#ruflo\n----- grounded summary -----\nCited summary.';
export function probeGroundingEvidenceReplacement({ files = stampFiles() } = {}) {
  let temporary;
  try {
    if (!files.length) return { state: 'unknown', evidence: 'no installed grounding stamp discovered' };
    temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'rsp-native-stamp-'));
    for (const [index, file] of files.entries()) {
      const scripts = path.join(temporary, String(index)); fs.mkdirSync(scripts);
      fs.writeFileSync(path.join(scripts, 'grounding-stamp.sh'), pristine(file));
      const answer = path.join(path.dirname(file), 'grounding-answer.mjs'); regular(answer);
      fs.copyFileSync(answer, path.join(scripts, 'grounding-answer.mjs'));
      if (fs.readFileSync(answer, 'utf8').includes("from './continuity-events.mjs'")) {
        for (const name of ['continuity-events.mjs', 'project-progression-contract.mjs']) {
          const dependency = path.join(path.dirname(file), name); regular(dependency);
          fs.writeFileSync(path.join(scripts, name), pristine(dependency));
        }
        // Only pure outcome normalization runs; resolving live project memory is forbidden.
        fs.writeFileSync(path.join(scripts, 'project-store-resolver.mjs'),
          "export function resolveProjectStore(){throw Error('unexpected memory resolution in grounding proof');}\n");
      }
      fs.writeFileSync(path.join(scripts, 'ground-before-write.sh'),
        pristine(path.join(path.dirname(file), 'ground-before-write.sh')));
      // Import the real Stop consumer, with isolated HOME and without invoking its CLI.
      const gate = path.join(path.dirname(file), 'grounding-turn-gate.mjs'); regular(gate);
      let caseId = 0;
      const runCase = (query, response, expected, forged = false) => {
        const home = path.join(scripts, `case-${caseId++}`); fs.mkdirSync(home);
        fs.writeFileSync(path.join(home, 'profile.json'), '{}');
        const env = environment(home, scripts);
        const before = Date.now();
        const payload = { tool_input: { query }, tool_response: forged
          ? { answer: 'NO SEARCH WAS RUN', retrieval: { query: success } }
          : { content: [{ type: 'text', text: response }] } };
        const result = spawnSync('bash', [path.join(scripts, 'grounding-stamp.sh')], {
          input: JSON.stringify(payload), encoding: 'utf8', env, timeout: 10_000,
        });
        if (result.error || result.status !== 0) throw new Error(result.error?.message || result.stderr);
        const dir = path.join(home, '.cache/ruvnet-brain/grounded');
        const terms = fs.existsSync(dir) ? fs.readdirSync(dir).sort() : [];
        if (JSON.stringify(terms) !== JSON.stringify([...expected].sort())) {
          throw new Error(`unexpected stamps for ${query}: ${JSON.stringify(terms)}`);
        }
        const unrelated = query.toLowerCase().includes('agentdb') ? 'ruflo' : 'agentdb';
        const write = spawnSync('bash', [path.join(scripts, 'ground-before-write.sh')], {
          input: JSON.stringify({ tool_name: 'Write', tool_input: {
            file_path: path.join(home, 'code.mjs'), content: `import '${unrelated}';` } }),
          encoding: 'utf8', env, cwd: home, timeout: 10_000,
        });
        if (write.error || write.status !== 2 || !new RegExp('BLOCKED[\\s\\S]*' + unrelated).test(write.stderr + write.stdout)) {
          throw new Error('native write gate did not explicitly refuse an unrelated AgentDB write');
        }
        const markerModule = path.join(path.dirname(file), 'grounding-turn-mark.mjs');
        const boundNative = fs.readFileSync(gate, 'utf8').includes('sameGroundingIdentity(searchEvidence, marker)');
        if (boundNative) {
          child(`import assert from 'node:assert/strict';
            const gate = await import(${JSON.stringify(pathToFileURL(gate).href)});
            const mark = await import(${JSON.stringify(pathToFileURL(markerModule).href)});
            const input = { ...${JSON.stringify(payload)}, session_id:'fixture-session', turn_id:'fixture-turn',
              cwd:process.env.HOME, tool_name:'mcp__ruvnet_brain__search_ruvnet', last_assistant_message:'AgentDB provides vector search.' };
            const file = mark.markerPathFor(input.session_id,mark.MARKER_DIR,'codex');
            const marker = mark.writeArm(file,{gate1:true,assert:false,subjects:[],groundingScope:'all'},mark.groundingIdentity(input));
            mark.recordSearchEvidence(input);
            const evidence = mark.readSearchEvidence(file,marker);
            assert.equal(Boolean(evidence),${JSON.stringify(expected.length > 0)});
            const decide = (hookInput=input,searchEvidence=evidence) => gate.decide({hookInput,marker,
              markerMs:${before},searchEvidence,env:process.env});
            assert.equal(decide() === null,${JSON.stringify(expected.length > 0 && query.toLowerCase().includes('agentdb'))});
            assert.notEqual(decide({...input,turn_id:'other-turn'}),null);
            assert.notEqual(decide(input,evidence ? {...evidence,nonce:'foreign'} : null),null);`, env);
        } else {
        child(`import assert from 'node:assert/strict';
          const gate = await import(${JSON.stringify(pathToFileURL(gate).href)});
          const correction = gate.decide({ hookInput: { last_assistant_message: 'AgentDB provides vector search.' },
            marker: { gate1: true, assert: false }, markerMs: ${before}, env: process.env });
          assert.equal(correction === null, ${JSON.stringify(expected.length > 0)});`, env);
        if (expected.length) {
          for (const term of terms) fs.utimesSync(path.join(dir, term), new Date(0), new Date(0));
          child(`import assert from 'node:assert/strict';
            const gate = await import(${JSON.stringify(pathToFileURL(gate).href)});
            assert.notEqual(gate.decide({ hookInput: { last_assistant_message: 'AgentDB provides vector search.' },
              marker: { gate1: true, assert: false }, markerMs: ${before}, env: process.env }), null);`, env);
        }
        }
      };
      runCase('how should handoffs stay consistent', success, ['.any-search']);
      runCase('ruvnet grounding', card, ['.any-search', 'ruv', 'ruvnet']);
      runCase('ruflo grounding', card, ['.any-search', 'ruflo']);
      // The result mentions a product, but only the query may authorize that product.
      runCase('generic guidance', card, ['.any-search']);
      runCase('agentdb grounding', success, ['.any-search', 'agentdb']);
      runCase('agentdb grounding', 'search_ruvnet error: unavailable', []);
      runCase(`agentdb ${success}`, 'NO SEARCH WAS RUN', [], true);
      runCase('agentdb grounding', '', []);
      runCase('agentdb grounding', 'Searched 1 RuvNet repos (agentdb).\n(no results — the search ran but nothing matched)', []);
    }
    return { state: 'superseded', evidence: `${files.length} native stamp/Stop pairs accept ordinary and curated answers, reject empty/forged/failed responses, preserve native turn binding where required, and never stamp unrelated product write authorization` };
  } catch (error) { return { state: 'unknown', evidence: `native grounding-evidence proof failed: ${error.message}` }; }
  finally { if (temporary) fs.rmSync(temporary, { recursive: true, force: true }); }
}
