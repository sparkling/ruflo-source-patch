#!/usr/bin/env python3
"""Read-only composition of the existing owning app-server WebSocket protocol.
Only initialize/initialized and existing-thread ruflo list/retrieve are sent.
Values, namespace/key pairs, thread IDs and native error text never leave workers.
"""
import asyncio
import hashlib
import json
import pathlib
import re
import shlex
import stat
import sys
import time

MAX_BYTES = 1024 * 1024


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
            if len(texts) != 1:
                raise Refused('ambiguous-or-missing-result')
            value = texts[0]
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


def validate_targets(targets):
    if not isinstance(targets, list) or not 1 <= len(targets) <= 4:
        raise Refused('invalid-target-config')
    for target in targets:
        if (not isinstance(target, dict) or target.get('host') not in ('local', 'hz')
                or not re.fullmatch(r'[a-zA-Z0-9_-]{1,40}', target.get('label', ''))
                or not re.fullmatch(r'[0-9a-f-]{36}', target.get('threadId', ''))):
            raise Refused('invalid-target-config')
    return targets


async def worker(targets):
    import websockets
    results = []
    socket = str(pathlib.Path.home() / '.codex/app-server-control/app-server-control.sock')
    for target in validate_targets(targets):
        started = time.monotonic()
        row = {'target': target['label'], 'status': 'not-verified'}
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
                    return await asyncio.wait_for(receive(), 5)

                await call('initialize', {'clientInfo': {'name': 'rsp-hourly-readonly', 'version': '1'},
                                          'capabilities': {'experimentalApi': True}})
                await ws.send(json.dumps({'method': 'initialized'}))

                async def tool(name, arguments):
                    return await call('mcpServer/tool/call', {'threadId': target['threadId'],
                                      'server': 'ruflo', 'tool': name, 'arguments': arguments})
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
            row.update(error=type(error).__name__)
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
        stdout, _ = await asyncio.wait_for(process.communicate(json.dumps(targets).encode()), 40)
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
        category = error.category if isinstance(error, Refused) else type(error).__name__
        return [{'target': t['label'], 'status': 'not-verified', 'error': category,
                 'elapsedMs': round((time.monotonic() - started) * 1000)} for t in targets]


async def main():
    if sys.argv[1:] == ['--worker']:
        targets = json.loads(sys.stdin.buffer.read(65537))
        try:
            result = await asyncio.wait_for(worker(targets), 35)
        except Exception as error:
            result = [{'target': t['label'], 'status': 'not-verified', 'error': type(error).__name__}
                      for t in validate_targets(targets)]
        print(json.dumps(result))
        return 0
    if len(sys.argv) != 2:
        raise Refused('expected-private-config-path')
    config = pathlib.Path(sys.argv[1])
    info = config.lstat()
    if not stat.S_ISREG(info.st_mode) or info.st_uid != __import__('os').getuid() or info.st_mode & 0o077 or info.st_size > 65536:
        raise Refused('config-must-be-private-owned-file')
    targets = validate_targets(json.loads(config.read_text()).get('targets'))
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
        print(json.dumps({'status': 'not-verified', 'error': error.category if isinstance(error, Refused) else type(error).__name__}))
        sys.exit(1)
