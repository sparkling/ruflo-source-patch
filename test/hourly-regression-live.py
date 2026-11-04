import asyncio
import importlib.util
import json
import pathlib
import sys
import unittest

sys.dont_write_bytecode = True

spec = importlib.util.spec_from_file_location('live', pathlib.Path(__file__).resolve().parents[1] / 'scripts/hourly-regression-live.py')
live = importlib.util.module_from_spec(spec)
spec.loader.exec_module(live)


class ReadOnlyProbe(unittest.TestCase):
    def test_diagnostic_deadline_is_not_native_failure(self):
        self.assertEqual(live.READ_TIMEOUT_SECONDS, 30)
        self.assertEqual(live.HOST_TIMEOUT_SECONDS, 120)
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


unittest.main()
