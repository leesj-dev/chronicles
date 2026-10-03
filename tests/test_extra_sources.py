import json
import tempfile
import unittest
from pathlib import Path
from extra_sources import generation, CopilotScanner, event_id
from server import Collector


def varint(n):
    out=bytearray()
    while n>127:
        out.append((n&127)|128);n>>=7
    out.append(n)
    return bytes(out)


def field(n,value):
    if isinstance(value,int):return varint(n<<3)+varint(value)
    return varint((n<<3)|2)+varint(len(value))+value


class ExtraTests(unittest.TestCase):
    def test_antigravity_usage_and_step_timestamp(self):
        usage=field(1,10)+field(2,100)+field(3,20)+field(5,30)
        wrapped=field(19,b'gemini-pro-default')+field(21,b'Gemini Pro')+field(4,usage)
        metadata=field(1,field(1,1773964800))
        event=generation(field(1,wrapped),metadata)
        self.assertEqual(event[1],'Gemini Pro')
        self.assertEqual(event[2],dict(input=110,output=20,cacheRead=30,cacheWrite=0))
        self.assertIsNone(generation(field(1,wrapped)))

    def test_copilot_mutation_log(self):
        with tempfile.TemporaryDirectory() as directory:
            path=Path(directory)/'session.jsonl'
            records=[dict(kind=0,v=dict(sessionId='session',requests=[])),dict(kind=2,k=['requests'],v=[dict(requestId='request',timestamp=1773964800000,modelId='copilot/gpt-5.4')]),dict(kind=1,k=['requests',0,'result'],v=dict(usage=dict(promptTokens=100,completionTokens=20))),dict(kind=1,k=['requests',0,'result'],v=dict(usage=dict(promptTokens=100,completionTokens=30),metadata=dict(toolCallRounds=[{},{}])))]
            path.write_text('\n'.join(map(json.dumps,records)))
            events=CopilotScanner.parse(path)
            self.assertEqual(len(events),1)
            self.assertEqual(events[0][3]['output'],30)
            self.assertEqual(events[0][3]['rounds'],2)
            self.assertEqual(events[0][3]['roundRecords'],1)

    def test_missing_tokens_are_not_zero_usage(self):
        with tempfile.TemporaryDirectory() as directory:
            path=Path(directory)/'legacy.json'
            path.write_text(json.dumps(dict(sessionId='old',requests=[dict(requestId='request',timestamp=1762084800000,modelId='copilot/claude-sonnet-4.5',result=dict(metadata=dict(toolCallRounds=[{},{}])))])))
            events,missing=CopilotScanner.parse(path,with_coverage=True)
            self.assertEqual(events,[])
            self.assertEqual(len(missing),1)
            self.assertEqual(missing[0]['rounds'],2)

    def test_cross_device_duplicates(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory)
            usage=dict(input_tokens=100,cached_input_tokens=30,output_tokens=20,total_tokens=120)
            records=[dict(type='turn_context',payload=dict(model='gpt-5.4')),dict(type='event_msg',timestamp='2026-03-20T00:00:00Z',payload=dict(type='token_count',info=dict(total_token_usage=usage,last_token_usage=usage)))]
            (root/'local.jsonl').write_text('\n'.join(map(json.dumps,records)))
            collector=Collector([('codex',root)])
            first=collector.collect()
            imported=root/'import.json'
            imported.write_text(json.dumps(dict(events=collector.local_events,updatedAt='2026-10-03T00:00:00Z')))
            collector.import_path=imported
            combined=collector.collect()
            self.assertEqual(combined['events'],first['events'])
            self.assertEqual(combined['rows'][0]['total'],120)
            self.assertEqual(combined['rows'][0]['device'],'shared')


if __name__=='__main__':unittest.main()
