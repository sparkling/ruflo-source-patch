import asyncio
import importlib.util
import json
import pathlib
import sys
import tempfile
import types
import unittest
from unittest.mock import patch

sys.dont_write_bytecode = True

spec = importlib.util.spec_from_file_location('live', pathlib.Path(__file__).resolve().parents[1] / 'scripts/hourly-regression-live.py')
live = importlib.util.module_from_spec(spec)
spec.loader.exec_module(live)


class ReadOnlyProbe(unittest.TestCase):
    def test_source_requires_private_opt_in(self):
        target = {'host': 'hz', 'label': 'fixture', 'threadId': '00000000-0000-0000-0000-000000000000'}
        original = [dict(target, label=f'memory-{i}') for i in range(4)]
        self.assertEqual(len(live.configured_targets({'targets': original})), 4)
        candidate = original + [dict(target, label='source', kind='knowledge-source', expectedSourceRoot='/tmp')]
        self.refused('unexpected-target-count-or-unapproved-source', lambda: live.configured_targets({'targets': candidate}))
        self.assertEqual(len(live.configured_targets({'targets': candidate, 'enableSource': True})), 5)

    def test_diagnostic_deadline_is_not_native_failure(self):
        self.assertEqual(live.READ_TIMEOUT_SECONDS, 30)
        self.assertEqual(live.HOST_TIMEOUT_SECONDS, 120)
        self.assertEqual(live.SOURCE_TIMEOUT_SECONDS, 180)
        self.assertEqual(live.host_timeout([{'kind': 'knowledge-source'}]), 310)
        self.assertEqual(live.error_category(asyncio.TimeoutError()), 'monitor-deadline-completion-unknown')
        self.assertEqual(live.error_category(live.Refused('native-error')), 'native-error')

    def setUp(self):
        self.entry = {'key': 'disposable', 'namespace': 'fixture', 'value': {'text': 'complete'}}
        self.page = {'entries': [self.entry]}
        self.read = {**self.entry, 'found': True}

    def refused(self, category, fn):
        with self.assertRaises(live.Refused) as error:
            fn()
        self.assertEqual(error.exception.category, category)

    def test_actual_nested_shapes(self):
        # Actual local response: content/text -> JSON. HZ can encode the envelope twice.
        envelope = {'content': [{'type': 'text', 'text': json.dumps(self.page)}], 'isError': False}
        self.assertEqual(live.body(envelope, 'entries'), self.page)
        self.assertEqual(live.body(json.dumps(json.dumps(envelope)), 'entries'), self.page)
        nested = {'content': [{'type': 'text', 'text': json.dumps(envelope)}]}
        self.assertEqual(live.body(nested, 'entries'), self.page)
        self.refused('truncated-result', lambda: live.body({**envelope, 'truncated': True}, 'entries'))
        self.assertEqual(live.verify(self.page, self.read)['valueComparison'], 'matched')
        self.assertNotIn('complete', json.dumps(live.verify(self.page, self.read)))
        metadata_only = {'entries': [{k: self.entry[k] for k in ('namespace', 'key')}]}
        self.assertEqual(live.verify(metadata_only, self.read)['valueComparison'], 'not-listed')

    def test_backend_errors_never_empty_healthy(self):
        for result in ({'isError': True, 'content': []}, {'error': 'private retained value'},
                       {'success': False, 'entries': []}):
            self.refused('native-error', lambda: live.body(result, 'entries'))
        self.refused('empty-or-invalid-list', lambda: live.verify({'entries': []}, self.read))
        self.refused('listed-key-not-found', lambda: live.verify(self.page, {**self.read, 'found': False}))
        self.refused('malformed-result', lambda: live.body('truncated {', 'entries'))

    def test_exact_complete_read_required(self):
        self.refused('exact-identity-mismatch', lambda: live.verify(self.page, {**self.read, 'key': 'different'}))
        self.refused('retained-value-mismatch', lambda: live.verify(self.page, {**self.read, 'value': 'different'}))
        self.refused('missing-or-truncated-read-value', lambda: live.verify(self.page, {**self.read, 'truncated': True}))
        partial = {'entries': [{**self.entry, 'value': 'preview', 'valueTruncated': True}]}
        self.assertEqual(live.verify(partial, self.read)['valueComparison'], 'list-truncated')
        self.refused('response-too-large', lambda: live.body('x' * (live.MAX_BYTES + 1), 'entries'))
        with self.assertRaises(live.Refused) as error:
            live.body({'isError': True, 'content': [{'text': 'never print this'}]}, 'entries')
        self.assertNotIn('never print this', str(error.exception))

    def test_source_completeness_and_private_output(self):
        with tempfile.TemporaryDirectory() as root:
            result = {'question': 'PRIVATE QUESTION', 'results': [{'body': 'PRIVATE RETAINED BODY'}], 'gaps': [],
                      'retrievedAt': '2020-01-01T00:00:00Z',
                      'coverage': {'memory': {'complete': True, 'failedNamespaces': [],
                       'snapshot': {'mode': 'live-local-native-store', 'sourceRoot': root},
                       'inventory': {'research': {'enumerated': 10, 'admitted': 8, 'excluded': 2, 'complete': True,
                                                 'checkedAt': '2020-01-01T00:00:00Z'}}}}}
            verified = live.verify_source(live.body({'structuredContent': result}, 'coverage'), root)
            self.assertEqual(verified['coverage']['memoryComplete'], 1)
            self.assertEqual(verified['coverage']['enumerated'], 10)
            self.assertGreater(verified['coverage']['retrievedAtAgeMs'], 0)
            self.assertEqual(verified['coverage']['resultRetrievedAtEpochMs'], 1577836800000)
            self.assertEqual(verified['coverage']['cachedResponse'], 1)
            during = live.verify_source(result, root, 1577836799000)
            self.assertEqual(during['coverage']['cachedResponse'], 0)
            self.assertEqual(verified['coverage']['inventoryAgeKnownNamespaces'], 1)
            self.assertNotIn('PRIVATE', json.dumps(verified))
            self.assertNotIn(root, json.dumps(verified))
            calls = []
            class Socket:
                async def __aenter__(self): return self
                async def __aexit__(self, *_args): pass
                async def send(self, text):
                    self.last = json.loads(text)
                    calls.append(self.last)
                async def recv(self):
                    return json.dumps({'id': self.last['id'], 'result': {} if self.last['method'] == 'initialize'
                                       else {'structuredContent': result, 'isError': False}})
            with patch.dict(sys.modules, {'websockets': types.SimpleNamespace(unix_connect=lambda *_a, **_k: Socket())}):
                rows = asyncio.run(live.worker([{'kind': 'knowledge-source', 'host': 'hz', 'label': 'source',
                    'threadId': '00000000-0000-0000-0000-000000000000', 'expectedSourceRoot': root}]))
            self.assertEqual(rows[0]['status'], 'not-verified', 'cached route proof is not fresh inventory proof')
            self.assertEqual(rows[0]['error'], 'cached-source-response-no-fresh-inventory-proof')
            tool_calls = [call['params'] for call in calls if call['method'] == 'mcpServer/tool/call']
            self.assertEqual(len(tool_calls), 1, 'one source call, no retry or cache bypass')
            self.assertEqual(tool_calls[0]['server'], 'knowledge_ai_ba')
            self.assertEqual(tool_calls[0]['tool'], 'search_knowledge')
            self.assertEqual(tool_calls[0]['arguments'], {'question': 'ADR091 research reconciliation synthesis', 'offset': 0, 'limit': 4})
            self.refused('unexpected-source-root', lambda: live.verify_source(result, root + '-other'))
            result['gaps'] = ['private error']
            self.refused('source-coverage-gaps', lambda: live.verify_source(result, root))
            result['gaps'] = []
            result['coverage']['memory']['complete'] = False
            self.refused('incomplete-source-memory', lambda: live.verify_source(result, root))


unittest.main()
