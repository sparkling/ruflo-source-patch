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

    def memory_worker(self, health, registered=True):
        calls = []
        responses = {'agentdb_health': health, 'memory_list': self.page, 'memory_retrieve': self.read}
        class Socket:
            async def __aenter__(self): return self
            async def __aexit__(self, *_args): pass
            async def send(self, text):
                self.last = json.loads(text)
                calls.append(self.last)
            async def recv(self):
                request = self.last
                if request['method'] == 'initialize':
                    result = {}
                elif request['method'] == 'mcpServerStatus/list':
                    tools = {'agentdb_health': {'inputSchema': {'type': 'object', 'properties': {}}}} if registered else {}
                    result = {'data': [{'name': 'ruflo', 'tools': tools}]}
                else:
                    result = {'content': [{'type': 'text', 'text': json.dumps(responses[request['params']['tool']])}]}
                return json.dumps({'id': request['id'], 'result': result})
        with patch.dict(sys.modules, {'websockets': types.SimpleNamespace(unix_connect=lambda *_a, **_k: Socket())}):
            rows = asyncio.run(live.worker([{'host': 'hz', 'label': 'memory',
                'threadId': '00000000-0000-0000-0000-000000000000'}]))
        return rows[0], calls

    def test_native_health_refuses_degraded_backend_before_successful_reads(self):
        # Reduced observed Product health: failed native open still advertised a local
        # ReasoningBank; list/exact success alone cannot establish native readiness.
        failures = [
            ({'available': False, 'agentdbInitError': 'PRIVATE active WAL refusal',
              'bridgeFailureReason': 'PRIVATE active WAL refusal',
              'controllers': [{'name': 'reasoningBank', 'enabled': True, 'level': -1}]},
             'native-backend-initialization-error'),
            ({'available': False, 'controllers': []}, 'native-backend-unavailable'),
            ({'available': True, 'controllers': [{'name': 'reasoningBank', 'enabled': True, 'level': -1}]},
             'native-backend-fallback'),
            ({'available': True, 'controllers': [], 'hierarchicalMemory': {
                'fallbackFrom': 'agentdb-unavailable', 'durable': False, 'persistence': 'volatile'}},
             'native-backend-fallback'),
            ({'available': True, 'controllers': [], 'bridgeFailureReason': 'PRIVATE native failure'},
             'native-backend-initialization-error'),
        ]
        for health, category in failures:
            with self.subTest(category=category, health=health):
                row, calls = self.memory_worker(health)
                self.assertEqual(row['status'], 'not-verified')
                self.assertEqual(row['error'], category)
                self.assertEqual(row['errorDigest'], live.digest(health))
                self.assertEqual([c['params']['tool'] for c in calls if c['method'] == 'mcpServer/tool/call'],
                                 ['agentdb_health'], 'failed health must not replay or continue memory operations')
                self.assertNotIn('PRIVATE', json.dumps(row))

    def test_native_health_accepts_empty_research_and_durable_tier_composition(self):
        # Reduced recovered Product response: optional controllers can be disabled,
        # and the documented durable SQLite tier is not an unavailable-AgentDB fallback.
        health = {'available': True, 'agentdbInitError': None, 'bridgeFailureReason': None,
                  'controllers': [{'name': 'reasoningBank', 'enabled': True, 'level': 1},
                                  {'name': 'mutationGuard', 'enabled': False, 'level': 2}],
                  'patternCount': 0, 'hierarchicalMemory': {'fallbackFrom': 'agentdb-export-missing',
                      'durable': True, 'persistence': 'sqlite', 'persistedRows': 0}}
        row, calls = self.memory_worker(health)
        self.assertEqual(row['status'], 'verified')
        self.assertEqual(row['nativeHealthDigest'], live.digest(health))
        self.assertTrue(row['nativeBackendAvailable'])
        self.assertEqual([c['params']['tool'] for c in calls if c['method'] == 'mcpServer/tool/call'],
                         ['agentdb_health', 'memory_list', 'memory_retrieve'])
        discovery = next(c for c in calls if c['method'] == 'mcpServerStatus/list')
        self.assertEqual(discovery['params']['serverName'], 'ruflo')
        self.assertEqual(discovery['params']['detail'], 'toolsAndAuthOnly')
        self.assertNotIn('disposable', json.dumps(row))

    def test_native_health_requires_registered_tool_and_preserves_private_error_digest(self):
        row, calls = self.memory_worker({'available': True}, registered=False)
        self.assertEqual(row['status'], 'not-verified')
        self.assertEqual(row['error'], 'native-health-tool-unavailable')
        self.assertFalse(any(c['method'] == 'mcpServer/tool/call' for c in calls))
        error = {'isError': True, 'content': [{'type': 'text', 'text': 'PRIVATE authorization: Bearer secret'}]}
        row, _ = self.memory_worker(error)
        self.assertEqual(row['status'], 'not-verified')
        self.assertEqual(row['error'], 'native-error')
        self.assertEqual(row['errorDigest'], live.digest(error))
        self.assertNotIn('PRIVATE', json.dumps(row))
        self.assertNotIn('secret', json.dumps(row))

    def test_source_document_scope_and_private_output(self):
        with tempfile.TemporaryDirectory() as root:
            result = {'question': 'PRIVATE QUESTION', 'results': [{'body': 'PRIVATE RETAINED BODY'}],
                      'total': 1, 'coverage': {'textUnits': 10, 'excludedUnits': 2, 'failures': [],
                      'indexedAt': '2020-01-01T00:00:00Z',
                      'privateDocuments': {'authorityRoot': root, 'failures': []}}}
            verified = live.verify_source(live.body({'structuredContent': result}, 'coverage'), root)
            self.assertEqual(verified['coverage']['textUnits'], 10)
            self.assertNotIn('memoryComplete', verified['coverage'])
            self.assertIn('document-discovery', verified['scope'])
            self.assertGreater(verified['coverage']['observedAgeMs'], 0)
            self.assertEqual(verified['coverage']['sourceObservedAtEpochMs'], 1577836800000)
            self.assertEqual(verified['coverage']['cachedResponse'], 1)
            during = live.verify_source(result, root, 1577836799000)
            self.assertEqual(during['coverage']['cachedResponse'], 0)
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
            self.assertEqual(rows[0]['status'], 'not-verified', 'cached proof is not fresh document discovery')
            self.assertEqual(rows[0]['error'], 'cached-source-response-no-fresh-document-proof')
            tool_calls = [call['params'] for call in calls if call['method'] == 'mcpServer/tool/call']
            self.assertEqual(len(tool_calls), 1, 'one source call, no retry or cache bypass')
            self.assertEqual(tool_calls[0]['server'], 'knowledge_ai_ba')
            self.assertEqual(tool_calls[0]['tool'], 'search_documents')
            self.assertEqual(tool_calls[0]['arguments'], live.SOURCE_ARGUMENTS)
            self.refused('unexpected-source-root', lambda: live.verify_source(result, root + '-other'))
            result['coverage']['failures'] = ['private error']
            self.refused('source-coverage-gaps', lambda: live.verify_source(result, root))
            result['coverage']['failures'] = []
            result['coverage']['privateDocuments']['failures'] = ['private error']
            self.refused('source-coverage-gaps', lambda: live.verify_source(result, root))
            result['coverage']['privateDocuments']['failures'] = []
            result['total'] = 0
            self.refused('invalid-document-count', lambda: live.verify_source(result, root))
            result['results'] = []
            self.assertEqual(live.verify_source(result, root)['coverage']['totalMatches'], 0)
            result['coverage']['textUnits'] = -1
            self.refused('invalid-document-count', lambda: live.verify_source(result, root))


unittest.main()
