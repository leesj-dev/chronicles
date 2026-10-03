import json
import tempfile
import unittest
from pathlib import Path
from server import Collector, day
from unittest.mock import patch
from zoneinfo import ZoneInfo


class UsageTests(unittest.TestCase):
    def test_korean_midnight(self):
        with patch('server.KST', ZoneInfo('Asia/Seoul')):
            self.assertEqual(day('2026-10-01T15:00:00Z'), '2026-10-02')
            self.assertEqual(day('2026-10-01T14:59:59Z'), '2026-10-01')

    def test_codex_cumulative_repeated_and_fork_copies(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            def usage(t, total, last):
                return dict(timestamp=t, type='event_msg', payload=dict(type='token_count', info=dict(total_token_usage=total, last_token_usage=last)))
            first = dict(input_tokens=100, cached_input_tokens=30, output_tokens=20, total_tokens=120)
            second = dict(input_tokens=150, cached_input_tokens=40, output_tokens=30, total_tokens=180)
            records = [dict(type='turn_context', payload=dict(model='model-a')),usage('2026-10-01T15:00:00Z', first, first),usage('2026-10-01T15:00:01Z', first, first),usage('2026-10-01T15:01:00Z', second, dict(input_tokens=50,cached_input_tokens=10,output_tokens=10,total_tokens=60))]
            text = '\n'.join(map(json.dumps, records))+'\n'
            (root/'parent.jsonl').write_text(text)
            (root/'fork.jsonl').write_text(text)
            collector = Collector([('codex',root)])
            result = collector.collect()
            self.assertEqual(result['events'], 2)
            self.assertEqual(result['rows'][0]['input'], 110)
            self.assertEqual(result['rows'][0]['cacheRead'], 40)
            self.assertEqual(result['rows'][0]['total'], 180)
            (root/'fork.jsonl').unlink()
            self.assertEqual(collector.collect()['rows'], result['rows'])

    def test_claude_stream_duplicates_and_cache_accounting(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory)
            records=[]
            for output in [5,20]:
                records.append(dict(timestamp='2026-10-01T15:00:00Z',requestId='r1',message=dict(id='m1',model='claude-test',usage=dict(input_tokens=10,cache_read_input_tokens=30,cache_creation_input_tokens=40,output_tokens=output))))
            path=root/'one.jsonl'
            path.write_text('\n'.join(map(json.dumps,records))+'\n{bad\n')
            result=Collector([('claude',root)]).collect()
            self.assertEqual(result['events'],1)
            self.assertEqual(result['rows'][0]['total'],100)
            self.assertEqual(result['skipped'],1)


if __name__ == '__main__':
    unittest.main()
