import json
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from .base import ScanResult, event_id


class CopilotAdapter:
    provider = 'copilot'
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

    def scan(self) -> ScanResult:
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
        return ScanResult(events=[(key, self.provider, ts, model, values) for key, ts, model, values in events], files=len(active), errors=errors, missing=self.missing)
