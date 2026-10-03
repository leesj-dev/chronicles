import json
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from adapters import (
    create_adapters, ScanResult, AntigravityAdapter, CopilotAdapter,
    CursorAdapter, GrokAdapter, OpenCodeAdapter, CodexAdapter, ClaudeAdapter,
)
from server import Collector


class AdapterTests(unittest.TestCase):
    def test_all_history_providers_share_scan_result_and_independent_caches(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            adapters = [CodexAdapter([root]), ClaudeAdapter([root]),
                        AntigravityAdapter(root), CopilotAdapter(root),
                        CursorAdapter(root/'none.csv', account=False),
                        GrokAdapter(root), OpenCodeAdapter(root)]
            self.assertEqual(len({adapter.provider for adapter in adapters}), 7)
            self.assertEqual(len({id(adapter.cache) for adapter in adapters}), 7)
            for adapter in adapters:
                with self.subTest(provider=adapter.provider):
                    result = adapter.scan()
                    self.assertIsInstance(result, ScanResult)
                    self.assertEqual(result.events, [])
                    self.assertEqual(result.files, 0)
                    self.assertEqual(result.errors, [])

    def test_collector_merges_adapter_metadata_and_keeps_cached_values_unmodified(self):
        tokens = dict(input=10, output=5, cacheRead=0, cacheWrite=0)
        event = (('claude', 'same'), 'claude', '2026-01-01T12:00:00Z', 'sonnet', tokens)
        missing = dict(id='missing', provider='copilot', timestamp='2026-01-01T12:00:00Z', model='sonnet', rounds=2)
        first = ScanResult(events=[event], files=2, skipped=1, legacy_ids=['old'])
        second = ScanResult(events=[event[:-1] + (tokens | {'output': 8},)], files=3,
                            errors=['example'], missing=[missing], legacy_ids=['old'])
        collector = Collector(roots=[])
        collector.adapters = [SimpleNamespace(scan=lambda: first), SimpleNamespace(scan=lambda: second)]
        report = collector.collect()
        self.assertEqual(report['files'], 5)
        self.assertEqual(report['events'], 1)
        self.assertEqual(report['rows'][0]['total'], 18)
        self.assertEqual(report['skipped'], 1)
        self.assertEqual(report['legacyAntigravity'], 1)
        self.assertEqual(report['errors'], ['example'])
        self.assertEqual(report['missing'][0]['rounds'], 2)
        self.assertEqual(tokens['output'], 5)

    def test_adapter_file_cache_refreshes_and_prunes_removed_files(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            path = root/'usage.jsonl'
            def record(output):
                return json.dumps(dict(timestamp='2026-01-01T12:00:00Z', message=dict(
                    id='m', model='sonnet', usage=dict(input_tokens=10, output_tokens=output))))
            path.write_text(record(5))
            adapter = ClaudeAdapter([root])
            with patch('adapters.jsonl.parse_log', wraps=__import__('adapters.jsonl', fromlist=['parse_log']).parse_log) as parse:
                self.assertEqual(adapter.scan().events[0][-1]['output'], 5)
                adapter.scan()
                self.assertEqual(parse.call_count, 1)
                path.write_text(record(100))
                self.assertEqual(adapter.scan().events[0][-1]['output'], 100)
                self.assertEqual(parse.call_count, 2)
                path.unlink()
                self.assertEqual(adapter.scan().files, 0)
                self.assertEqual(adapter.cache, {})

    def test_private_data_stays_in_repository_root(self):
        from adapters.cursor_account import CursorAccountHistory
        from paths import ROOT, SRC
        self.assertEqual(SRC, ROOT/'src')
        self.assertEqual(CursorAdapter(account=False).csv_path, ROOT/'.local/imports/cursor.csv')
        self.assertEqual(CursorAccountHistory(CursorAdapter.parse).cache_path, ROOT/'.local/cursor-history.json')
        self.assertEqual(Collector().import_path, ROOT/'.local/imports/macmini.json')

    def test_registry_groups_codex_roots_into_one_adapter(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            adapters = create_adapters([('codex', root/'sessions'), ('codex', root/'archived'), ('claude', root/'projects')])
            self.assertEqual([a.provider for a in adapters], ['codex', 'claude'])
            self.assertEqual(adapters[0].roots, [root/'sessions', root/'archived'])
