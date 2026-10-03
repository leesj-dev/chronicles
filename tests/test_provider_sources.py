import json
import sqlite3
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from adapters import GrokAdapter, OpenCodeAdapter, CursorAdapter
from adapters.limits import OpenUsageBridge
from server import Collector


class ProviderTests(unittest.TestCase):
    def test_grok_copied_events_and_exclusive_cache_buckets(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            record = {'params': {'_meta': {'eventId':'turn-1','agentTimestampMs':1760000000000}, 'update': {'sessionUpdate':'turn_completed','usage': {'modelUsage': {'grok-4': {'inputTokens':100,'cachedReadTokens':40,'cacheCreationTokens':10,'outputTokens':20,'reasoningTokens':5}}}}}}
            for name in ['a','b']:
                (root/f'{name}.jsonl').write_text(json.dumps(record)+'\ninvalid\n')
            scanner = GrokAdapter(root)
            result = scanner.scan()
            events, files, errors = result.events, result.files, result.errors
            self.assertEqual(files,2)
            self.assertFalse(errors)
            self.assertEqual(events[0][0], events[1][0])
            self.assertEqual(events[0][-1], dict(input=50,output=20,cacheRead=40,cacheWrite=10))
            collector = Collector(roots=[('claude',root/'none')]);collector.adapters=[scanner]
            report = collector.collect()
            self.assertEqual(report['events'],1)
            self.assertEqual(report['rows'][0]['total'],120)

    def test_opencode_migration_duplicates_reasoning_and_incomplete_turns(self):
        with tempfile.TemporaryDirectory() as tmp:
            db=Path(tmp)/'opencode.db';c=sqlite3.connect(db)
            c.execute('CREATE TABLE message(id TEXT,time_created INTEGER,data TEXT)')
            c.execute('CREATE TABLE session_message(id TEXT,time_created INTEGER,data TEXT,type TEXT)')
            old=dict(role='assistant',modelID='gpt-5.4',time=dict(completed=1760000000000),tokens=dict(input=10,output=5,reasoning=3,cache=dict(read=4,write=2)))
            new=old|dict(model=dict(id='gpt-5.4',providerID='openai'))
            c.execute('INSERT INTO message VALUES(?,?,?)',('same',1760000000000,json.dumps(old)))
            c.execute('INSERT INTO session_message VALUES(?,?,?,?)',('same',1760000000000,json.dumps(new),'assistant'))
            c.execute('INSERT INTO message VALUES(?,?,?)',('unfinished',1760000000000,json.dumps(old|dict(time={}))))
            c.commit();c.close()
            events=OpenCodeAdapter.parse(db)
            self.assertEqual(len(events),1)
            self.assertEqual(events[0][-1],dict(input=10,output=8,cacheRead=4,cacheWrite=2))

    def test_cursor_csv_preserves_identical_rows_and_rejects_bad_schema(self):
        with tempfile.TemporaryDirectory() as tmp:
            p=Path(tmp)/'cursor.csv'
            header='Date,Model,Input (w/ Cache Write),Input (w/o Cache Write),Cache Read,Output Tokens\n'
            row='2026-01-01T12:00:00Z,claude-sonnet-4.5,10,20,30,40\n'
            p.write_text(header+row+row)
            events=CursorAdapter.parse(p)
            self.assertEqual(len(events),2)
            self.assertNotEqual(events[0][0],events[1][0])
            self.assertEqual(sum(events[0][-1].values()),100)
            p.write_text('Date,Model\n2026-01-01,auto\n')
            with self.assertRaises(ValueError):CursorAdapter.parse(p)

    def test_bridge_supports_legacy_and_array_snapshots_and_never_creates_history(self):
        snapshot=dict(providerId='ollama',plan='Pro',fetchedAt='2026-01-01T00:00:00Z',lines=[dict(type='progress',label='Weekly',used=30,limit=100,format=dict(kind='percent')),dict(type='text',label='Plan',value='Pro'),dict(type='badge',label='State',text='Active'),dict(type='barChart',label='Trend',points=[dict(label='Mon',value=10,valueLabel='10 tokens')]),dict(type='secret',label='ignored',value='ignore')],apiKey='must-not-be-forwarded')
        class Response:
            def __init__(self,data):self.data=data
            def __enter__(self):return self
            def __exit__(self,*args):pass
            def read(self,*args):return json.dumps(self.data).encode()
        bridge=OpenUsageBridge()
        with patch.object(bridge.opener,'open',return_value=Response(snapshot)) as request:
            legacy=bridge.fetch('ollama')
            self.assertEqual(request.call_args.args[0],'http://127.0.0.1:6736/v1/usage/ollama')
        with patch.object(bridge.opener,'open',return_value=Response([snapshot])):
            self.assertEqual(bridge.fetch('ollama'),legacy)
        self.assertEqual(len(legacy[0]['lines']),4)
        self.assertNotIn('apiKey',json.dumps(legacy))
        with tempfile.TemporaryDirectory() as tmp:
            collector=Collector(roots=[('claude',Path(tmp))]);collector.bridge=bridge
            with patch.object(bridge,'collect',return_value=legacy):report=collector.collect()
            self.assertEqual(report['rows'],[])
            self.assertEqual(report['accountSnapshots'],legacy)
