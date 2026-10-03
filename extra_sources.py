import hashlib
import json
import sqlite3
from datetime import datetime, timezone
from pathlib import Path


def event_id(key):
    return hashlib.sha256(json.dumps(key, ensure_ascii=False, separators=(',', ':')).encode()).hexdigest()


def protobuf(blob):
    fields = {}
    offset = 0
    def varint():
        nonlocal offset
        value = 0
        for shift in range(0, 70, 7):
            if offset >= len(blob):
                raise ValueError('truncated varint')
            byte = blob[offset]
            offset += 1
            value |= (byte & 127) << shift
            if byte < 128:
                return value
        raise ValueError('oversized varint')
    while offset < len(blob):
        tag = varint()
        field, wire = tag >> 3, tag & 7
        if field == 0:
            raise ValueError('invalid protobuf field')
        if wire == 0:
            value = varint()
        elif wire == 2:
            length = varint()
            if offset + length > len(blob):
                raise ValueError('truncated field')
            value = blob[offset:offset+length]
            offset += length
        elif wire in (1, 5):
            length = 8 if wire == 1 else 4
            if offset+length > len(blob):
                raise ValueError('truncated fixed field')
            offset += length
            continue
        else:
            raise ValueError('unsupported protobuf wire')
        fields.setdefault(field, value)
    return fields


def generation(blob, metadata=None):
    wrapped = protobuf(protobuf(blob).get(1, b''))
    usage = protobuf(wrapped.get(4, b''))
    raw = wrapped.get(19, b'').decode('utf-8').strip()
    label = wrapped.get(21, b'').decode('utf-8').strip()
    values = dict(input=usage.get(1, 0)+usage.get(2, 0), output=usage.get(3, 0), cacheRead=usage.get(5, 0), cacheWrite=0)
    if not raw and not label and not any(usage.get(k,0) for k in [2,3,5]):
        return None
    if not any(values.values()):
        return None
    timing = protobuf(wrapped.get(9, b''))
    timestamp = protobuf(timing.get(4, b'')).get(1)
    if not timestamp and metadata:
        timestamp = protobuf(protobuf(metadata).get(1,b'')).get(1)
    if not isinstance(timestamp, int) or timestamp <= 0:
        return None
    model = label if raw.endswith('-default') and label else raw or label or 'unknown'
    if model.endswith('-tiered'):
        model = model[:-7]
    return datetime.fromtimestamp(timestamp, timezone.utc).isoformat(), model, values


class AntigravityScanner:
    def __init__(self, home=None):
        self.home = home or Path.home()/'.gemini'
        self.cache = {}

    def scan(self):
        events, errors, files, active = [], [], 0, set()
        self.legacy_ids = sorted({p.stem for p in self.home.glob('antigravity*/conversations/*.pb')})
        for directory in self.home.glob('antigravity*/conversations'):
            for path in directory.glob('*.db'):
                active.add(path)
                files += 1
                try:
                    wal = Path(str(path)+'-wal')
                    signature = (path.stat().st_mtime_ns, path.stat().st_size, wal.stat().st_mtime_ns if wal.exists() else 0)
                    if path not in self.cache or self.cache[path][0] != signature:
                        parsed = []
                        bad = 0
                        connection = sqlite3.connect(path.as_uri()+'?mode=ro', uri=True)
                        try:
                            tables={r[0] for r in connection.execute("SELECT name FROM sqlite_master WHERE type='table'")}
                            if 'gen_metadata' not in tables:
                                self.cache[path]=(signature, [], 0)
                                continue
                            correlated = 'steps' in tables and 'metadata' in {r[1] for r in connection.execute('PRAGMA table_info(steps)')}
                            query = 'SELECT g.idx,g.data,s.metadata FROM gen_metadata g LEFT JOIN steps s ON s.idx=g.idx WHERE length(g.data)<=33554432' if correlated else 'SELECT idx,data,NULL FROM gen_metadata WHERE length(data)<=33554432'
                            for idx, blob, metadata in connection.execute(query):
                                try:
                                    event=generation(blob,metadata)
                                    if event:
                                        timestamp,model,values=event
                                        parsed.append((('antigravity',path.stem,idx,timestamp),timestamp,model,values))
                                except (ValueError, TypeError, UnicodeError, OverflowError):
                                    bad += 1
                            bad += connection.execute('SELECT count(*) FROM gen_metadata WHERE length(data)>33554432').fetchone()[0]
                        finally:
                            connection.close()
                        self.cache[path]=(signature, parsed, bad)
                    events.extend(self.cache[path][1])
                    if self.cache[path][2]:errors.append(f'Antigravity: {self.cache[path][2]} generation records skipped')
                except (sqlite3.Error, OSError) as error:
                    errors.append('Antigravity: '+type(error).__name__)
        self.cache={p:v for p,v in self.cache.items() if p in active}
        return events,files,errors


class CopilotScanner:
    def __init__(self, home=None):
        self.home = home or Path.home()/'Library/Application Support/Code/User/workspaceStorage'
        self.cache = {}

    @staticmethod
    def parse(path, with_coverage=False):
        requests = []
        session = path.stem
        def reduced(request):
            if not isinstance(request, dict):
                return {}
            result=request.get('result') or {}
            metadata=result.get('metadata') or {} if isinstance(result,dict) else {}
            return {k:request.get(k) for k in ['requestId','timestamp','modelId','responseId']} | {'usage':result.get('usage') if isinstance(result,dict) else None,'details':result.get('details') if isinstance(result,dict) else None,'agentId':metadata.get('agentId'),'hasResult':bool(result),'rounds':len(metadata.get('toolCallRounds',[]))}
        def reset(value):
            nonlocal requests,session
            if isinstance(value,dict):
                session=value.get('sessionId') or session
                requests=[reduced(r) for r in value.get('requests',[]) if isinstance(r,dict)]
        if path.suffix=='.json':
            reset(json.loads(path.read_text()))
        else:
            with path.open() as stream:
                for line in stream:
                    try:record=json.loads(line)
                    except ValueError:continue
                    kind=record.get('kind');keys=record.get('k',[]);value=record.get('v')
                    if kind==0:
                        reset(value)
                    elif keys==['requests'] and isinstance(value,list):
                        if kind==1:requests=[reduced(r) for r in value]
                        elif kind==2:requests.extend(reduced(r) for r in value)
                    elif len(keys)>=2 and keys[0]=='requests' and isinstance(keys[1],int):
                        index=keys[1]
                        if index<0 or index>=len(requests):continue
                        if len(keys)==2 and kind==1:requests[index]=reduced(value)
                        elif len(keys)==3 and kind==1:
                            field=keys[2]
                            if field in ['requestId','timestamp','modelId','responseId']:requests[index][field]=value
                            elif field=='result' and isinstance(value,dict):
                                requests[index].update(usage=value.get('usage'),details=value.get('details'),agentId=(value.get('metadata') or {}).get('agentId'),hasResult=bool(value),rounds=len((value.get('metadata') or {}).get('toolCallRounds',[])))
        events=[]
        missing=[]
        for index,request in enumerate(requests):
            usage=request.get('usage')
            if request.get('agentId') and not request['agentId'].startswith('github.copilot'):
                continue
            timestamp=request.get('timestamp')
            if isinstance(timestamp,dict):timestamp=timestamp.get('start')
            if isinstance(timestamp,(int,float)):
                if timestamp<=0:continue
                timestamp=datetime.fromtimestamp(timestamp/1000,timezone.utc).isoformat()
            if not isinstance(timestamp,str):continue
            model=request.get('modelId') or (request.get('details') or '').split(' • ')[0] or 'unknown'
            if not isinstance(model,str):continue
            if model.startswith('github.copilot-chat/'):
                model='copilot/'+model.split('/',1)[1]
            if not isinstance(usage,dict) or 'promptTokens' not in usage or 'completionTokens' not in usage:
                if request.get('hasResult'):
                    missing.append(dict(id=event_id(('copilot',session,request.get('requestId') or index)),provider='copilot',timestamp=timestamp,model=model,rounds=request.get('rounds',0)))
                continue
            prompt=usage.get('promptTokens');output=usage.get('completionTokens')
            if not isinstance(prompt,int) or not isinstance(output,int):continue
            values=dict(input=max(0,prompt),output=max(0,output),cacheRead=0,cacheWrite=0,rounds=request.get('rounds',0),roundRecords=int(request.get('rounds',0)>0))
            events.append((('copilot',session,request.get('requestId') or index),timestamp,model,values))
        return (events,missing) if with_coverage else events

    def scan(self):
        events,errors,active=[],[],set()
        for path in self.home.glob('*/chatSessions/*'):
            if path.suffix not in ['.json','.jsonl']:continue
            active.add(path)
            try:
                stat=path.stat();signature=(stat.st_mtime_ns,stat.st_size)
                if path not in self.cache or self.cache[path][0]!=signature:
                    parsed,missing=self.parse(path,with_coverage=True)
                    self.cache[path]=(signature,parsed,missing)
                events.extend(self.cache[path][1])
            except (OSError,ValueError,TypeError,AttributeError,OverflowError) as error:
                errors.append('Copilot: '+type(error).__name__)
        self.cache={p:v for p,v in self.cache.items() if p in active}
        self.missing=[r for value in self.cache.values() for r in value[2]]
        return events,len(active),errors
