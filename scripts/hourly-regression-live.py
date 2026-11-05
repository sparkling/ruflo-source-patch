#!/usr/bin/env python3
"""Read-only composition of the existing owning app-server WebSocket protocol.
Only initialize/initialized and existing-thread read-only MCP tools are sent.
Values, namespace/key pairs, thread IDs and native error text never leave workers.
"""
import asyncio
import datetime
import hashlib
import json
import pathlib
import os
import re
import shlex
import stat
import sys
import time

MAX_BYTES = 1024 * 1024
READ_TIMEOUT_SECONDS = 30
HOST_TIMEOUT_SECONDS = 120
SOURCE_TIMEOUT_SECONDS = 180
SOURCE_ARGUMENTS = {'question': 'ADR091 research reconciliation synthesis', 'offset': 0, 'limit': 4}


def host_timeout(targets):
    return HOST_TIMEOUT_SECONDS + (SOURCE_TIMEOUT_SECONDS + 10 if any(t.get('kind') == 'knowledge-source' for t in targets) else 0)


def error_category(error):
    if isinstance(error, (asyncio.TimeoutError, TimeoutError)):
        return 'monitor-deadline-completion-unknown'
    return error.category if isinstance(error, Refused) else type(error).__name__


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(',', ':'),
                                     ensure_ascii=False, allow_nan=False).encode()).hexdigest()


class Refused(Exception):
    def __init__(self, category, evidence=None):
        super().__init__(category)
        self.category = category
        self.evidence = digest(evidence) if evidence is not None else None


def body(value, expected):
    """Decode bounded MCP envelopes, including JSON strings inside text envelopes."""
    for _ in range(10):
        if isinstance(value, str):
            if len(value.encode()) > MAX_BYTES:
                raise Refused('response-too-large')
            try:
                value = json.loads(value)
            except (ValueError, TypeError):
                raise Refused('malformed-result')
            continue
        if not isinstance(value, dict):
            raise Refused('malformed-result')
        if value.get('isError') is True or value.get('success') is False or value.get('error'):
            raise Refused('native-error', value)
        if truncated(value):
            raise Refused('truncated-result')
        if expected in value:
            return value
        if 'structuredContent' in value:
            value = value['structuredContent']
        elif 'content' in value:
            content = value['content']
            texts = [row['text'] for row in content if isinstance(row, dict)
                     and row.get('type') == 'text' and isinstance(row.get('text'), str)] if isinstance(content, list) else []
            if not texts:
                raise Refused('ambiguous-or-missing-result')
            value = '\n'.join(texts)
        elif 'result' in value:
            value = value['result']
        else:
            raise Refused('missing-result')
    raise Refused('excessive-result-encoding')


def truncated(value):
    return any(value.get(key) is True for key in ('truncated', 'valueTruncated', 'isTruncated'))


def verify(page, read):
    entries = page.get('entries')
    if not isinstance(entries, list) or len(entries) != 1:
        raise Refused('empty-or-invalid-list')
    entry = entries[0]
    if read.get('found') is not True:
        raise Refused('listed-key-not-found')
    if read.get('key') != entry.get('key') or read.get('namespace') != entry.get('namespace'):
        raise Refused('exact-identity-mismatch')
    if 'value' not in read or truncated(read):
        raise Refused('missing-or-truncated-read-value')
    comparison = 'not-listed'
    if 'value' in entry:
        comparison = 'list-truncated' if truncated(entry) or truncated(page) else 'matched'
        if comparison == 'matched' and digest(entry['value']) != digest(read['value']):
            raise Refused('retained-value-mismatch')
    return {'valueDigest': digest(read['value']), 'valueComparison': comparison}


def verify_native_health(value):
    if value.get('agentdbInitError') or value.get('bridgeFailureReason'):
        raise Refused('native-backend-initialization-error', value)
    if value.get('available') is not True:
        raise Refused('native-backend-unavailable', value)
    controllers = value.get('controllers')
    if not isinstance(controllers, list):
        raise Refused('invalid-native-health', value)
    local_bank = any(isinstance(row, dict) and row.get('name') == 'reasoningBank'
                     and row.get('enabled') is True and row.get('level') == -1 for row in controllers)
    tier = value.get('hierarchicalMemory')
    if local_bank or (isinstance(tier, dict) and tier.get('fallbackFrom') == 'agentdb-unavailable'):
        raise Refused('native-backend-fallback', value)
    # Optional controllers and empty research are not failures. The durable
    # SQLite tier composed when AgentDB lacks an export remains a native owner.
    return {'nativeBackendAvailable': True, 'nativeHealthDigest': digest(value)}


def verify_source(result, expected_root, requested_at_ms=None):
    """Prove current document discovery only, never a native-memory census."""
    coverage = result.get('coverage')
    private = coverage.get('privateDocuments') if isinstance(coverage, dict) else None
    if not isinstance(coverage, dict) or not isinstance(private, dict):
        raise Refused('missing-document-coverage')
    if coverage.get('failures') != [] or private.get('failures') != []:
        raise Refused('source-coverage-gaps')
    root = private.get('authorityRoot')
    if (not isinstance(root, str) or not os.path.isabs(root) or not pathlib.Path(root).is_dir()
            or os.path.realpath(root) != os.path.realpath(expected_root)):
        raise Refused('unexpected-source-root')
    rows = result.get('results')
    counts = {field: coverage.get(field) for field in ('textUnits', 'excludedUnits')}
    if (not isinstance(rows, list) or type(result.get('total')) is not int
            or result['total'] < len(rows)
            or any(type(value) is not int or value < 0 for value in counts.values())):
        raise Refused('invalid-document-count')
    try:
        observed = round(datetime.datetime.fromisoformat(coverage['indexedAt'].replace('Z', '+00:00')).timestamp() * 1000)
    except (KeyError, AttributeError, TypeError, ValueError, OverflowError):
        observed = -1
    now = round(time.time() * 1000)
    requested = now if requested_at_ms is None else requested_at_ms
    return {'resultDigest': digest(result), 'sourceRootDigest': digest(os.path.realpath(root)),
            'scope': 'document-discovery; no complete native-memory inventory or exact-body proof',
            'coverage': {**counts, 'returned': len(rows), 'totalMatches': result['total'],
                         'gapCount': 0, 'sourceObservedAtEpochMs': observed,
                         'requestStartedAtEpochMs': int(requested),
                         'observedAgeMs': max(0, now - observed) if observed >= 0 else -1,
                         'cachedResponse': int(observed < int(requested)) if observed >= 0 else -1}}


def validate_targets(targets):
    if not isinstance(targets, list) or not 1 <= len(targets) <= 5:
        raise Refused('invalid-target-config')
    for target in targets:
        if (not isinstance(target, dict) or target.get('host') not in ('local', 'hz')
                or not re.fullmatch(r'[a-zA-Z0-9_-]{1,40}', target.get('label', ''))
                or not re.fullmatch(r'[0-9a-f-]{36}', target.get('threadId', ''))):
            raise Refused('invalid-target-config')
        if target.get('kind', 'memory') not in ('memory', 'knowledge-source'):
            raise Refused('invalid-target-kind')
        if target.get('kind') == 'knowledge-source' and (target['host'] != 'hz'
                or not isinstance(target.get('expectedSourceRoot'), str)
                or not os.path.isabs(target['expectedSourceRoot'])):
            raise Refused('invalid-source-target')
    return targets


def configured_targets(configuration):
    targets = validate_targets(configuration.get('targets'))
    sources = sum(t.get('kind') == 'knowledge-source' for t in targets)
    enabled = configuration.get('enableSource') is True
    if len(targets) != (5 if enabled else 4) or sources != (1 if enabled else 0):
        raise Refused('unexpected-target-count-or-unapproved-source')
    return targets


async def worker(targets):
    import websockets
    results = []
    socket = str(pathlib.Path.home() / '.codex/app-server-control/app-server-control.sock')
    # Give the source its full native allowance before the bounded memory checks.
    for target in sorted(validate_targets(targets), key=lambda t: t.get('kind') != 'knowledge-source'):
        started = time.monotonic()
        row = {'target': target['label'], 'kind': target.get('kind', 'memory'), 'status': 'not-verified'}
        try:
            async with websockets.unix_connect(socket, uri='ws://localhost/', max_size=MAX_BYTES,
                                               open_timeout=5, close_timeout=1) as ws:
                seq = 0

                async def call(method, params):
                    nonlocal seq
                    seq += 1
                    identifier = seq
                    await ws.send(json.dumps({'id': identifier, 'method': method, 'params': params}))
                    # A wall deadline covers notifications too; receiving them cannot extend it.
                    async def receive():
                        while True:
                            response = json.loads(await ws.recv())
                            if response.get('id') == identifier:
                                if 'error' in response:
                                    raise Refused('app-server-error', response['error'])
                                return response['result']
                    allowance = (SOURCE_TIMEOUT_SECONDS if target.get('kind') == 'knowledge-source'
                                 else READ_TIMEOUT_SECONDS) if method == 'mcpServer/tool/call' else 5
                    return await asyncio.wait_for(receive(), allowance)

                await call('initialize', {'clientInfo': {'name': 'rsp-hourly-readonly', 'version': '1'},
                                          'capabilities': {'experimentalApi': True}})
                await ws.send(json.dumps({'method': 'initialized'}))

                async def tool(name, arguments):
                    return await call('mcpServer/tool/call', {'threadId': target['threadId'],
                                      'server': 'knowledge_ai_ba' if target.get('kind') == 'knowledge-source' else 'ruflo',
                                      'tool': name, 'arguments': arguments})
                if target.get('kind') == 'knowledge-source':
                    requested_at_ms = time.time() * 1000
                    result = body(await tool('search_documents', SOURCE_ARGUMENTS), 'coverage')
                    row.update(verify_source(result, target['expectedSourceRoot'], requested_at_ms))
                    cached = row['coverage']['cachedResponse']
                    row.update(status='verified' if cached == 0 else 'not-verified',
                               elapsedMs=round((time.monotonic() - started) * 1000))
                    if cached != 0:
                        row['error'] = 'cached-source-response-no-fresh-document-proof' if cached == 1 else 'source-freshness-unknown'
                    results.append(row)
                    continue
                registry = await call('mcpServerStatus/list', {'threadId': target['threadId'],
                                      'serverName': 'ruflo', 'detail': 'toolsAndAuthOnly', 'limit': 1})
                servers = registry.get('data')
                tools = servers[0].get('tools', {}) if isinstance(servers, list) and len(servers) == 1 else {}
                health = tools.get('agentdb_health', {}).get('inputSchema', {})
                if health.get('type') != 'object' or health.get('required'):
                    raise Refused('native-health-tool-unavailable', registry)
                row.update(verify_native_health(body(await tool('agentdb_health', {}), 'available')))
                page = body(await tool('memory_list', {'limit': 1}), 'entries')
                entries = page.get('entries')
                if not isinstance(entries, list) or len(entries) != 1 or not isinstance(entries[0], dict):
                    raise Refused('empty-or-invalid-list')
                entry = entries[0]
                if any(not isinstance(entry.get(k), str) or not 0 < len(entry[k]) <= 4096
                       for k in ('namespace', 'key')):
                    raise Refused('missing-listed-identity')
                read = body(await tool('memory_retrieve', {k: entry[k] for k in ('namespace', 'key')}), 'found')
                row.update(verify(page, read))
                row['status'] = 'verified'
        except Refused as error:
            row.update(error=error.category, errorDigest=error.evidence)
        except Exception as error:
            # Exception messages can contain response data or authentication material.
            row.update(error=error_category(error))
        row['elapsedMs'] = round((time.monotonic() - started) * 1000)
        results.append(row)
    return results


async def host_probe(host, targets):
    started = time.monotonic()
    if host == 'local':
        command = [sys.executable, str(pathlib.Path(__file__).resolve()), '--worker']
    else:
        # Ship this static read-only composition; no remote files or configuration are changed.
        source = pathlib.Path(__file__).read_text()
        command = ['ssh', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=5', '-o', 'ConnectionAttempts=1',
                   'hz', '/usr/bin/python3 -c ' + shlex.quote(source) + ' --worker']
    process = await asyncio.create_subprocess_exec(*command, stdin=asyncio.subprocess.PIPE,
                stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.DEVNULL)
    try:
        stdout, _ = await asyncio.wait_for(process.communicate(json.dumps(targets).encode()), host_timeout(targets))
        if process.returncode != 0 or len(stdout) > 65536:
            raise Refused('worker-failed')
        result = json.loads(stdout)
        if not isinstance(result, list) or len(result) != len(targets):
            raise Refused('invalid-worker-result')
        return result
    except Exception as error:
        if process.returncode is None:
            process.kill()
            await process.wait()
        category = error_category(error)
        return [{'target': t['label'], 'status': 'not-verified', 'error': category,
                 'elapsedMs': round((time.monotonic() - started) * 1000)} for t in targets]


async def main():
    if sys.argv[1:] == ['--worker']:
        targets = json.loads(sys.stdin.buffer.read(65537))
        try:
            result = await asyncio.wait_for(worker(targets), host_timeout(targets) - 2)
        except Exception as error:
            result = [{'target': t['label'], 'status': 'not-verified', 'error': error_category(error)}
                      for t in validate_targets(targets)]
        print(json.dumps(result))
        return 0
    if len(sys.argv) != 2:
        raise Refused('expected-private-config-path')
    config = pathlib.Path(sys.argv[1])
    info = config.lstat()
    if not stat.S_ISREG(info.st_mode) or info.st_uid != __import__('os').getuid() or info.st_mode & 0o077 or info.st_size > 65536:
        raise Refused('config-must-be-private-owned-file')
    targets = configured_targets(json.loads(config.read_text()))
    results = await asyncio.gather(*(host_probe(host, [t for t in targets if t['host'] == host])
                 for host in ('local', 'hz') if any(t['host'] == host for t in targets)))
    rows = [row for group in results for row in group]
    ok = all(row['status'] == 'verified' for row in rows)
    print(json.dumps({'status': 'verified' if ok else 'not-verified', 'targets': rows}))
    return 0 if ok else 1


if __name__ == '__main__':
    try:
        sys.exit(asyncio.run(main()))
    except Exception as error:
        print(json.dumps({'status': 'not-verified', 'error': error_category(error)}))
        sys.exit(1)
