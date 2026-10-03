import argparse
import json
import os
import subprocess
from pathlib import Path

from paths import ROOT, SRC
parser = argparse.ArgumentParser(description='Import usage metadata over SSH without copying conversation content.')
parser.add_argument('--host', default='macmini')
args = parser.parse_args()
server = (SRC/'server.py').read_text()
bundle = 'import types,sys,json,os\n'
bundle += 'os.environ["CHRONICLES_TIMEZONE"]='+repr(os.environ.get('CHRONICLES_TIMEZONE','UTC'))+'\n'
bundle += 'paths=types.ModuleType("paths");paths.__file__="/tmp/chronicles/src/paths.py";sys.modules["paths"]=paths\n'
bundle += 'exec('+repr((SRC/'paths.py').read_text())+',paths.__dict__)\n'
bundle += 'package=types.ModuleType("adapters");package.__path__=[];sys.modules["adapters"]=package\n'
for name in ['base', 'jsonl', 'antigravity', 'copilot', 'cursor_account', 'cursor', 'grok', 'opencode', 'limits', '__init__']:
    module_name = 'adapters' if name == '__init__' else 'adapters.' + name
    source = (SRC/'adapters'/f'{name}.py').read_text()
    bundle += 'module=sys.modules.get('+repr(module_name)+') or types.ModuleType('+repr(module_name)+');sys.modules['+repr(module_name)+']=module\n'
    bundle += 'module.__file__='+repr('/tmp/chronicles/src/adapters/'+name+'.py')+';module.__package__="adapters"\n'
    bundle += 'exec('+repr(source)+',module.__dict__)\n'
bundle += 'namespace={"__name__":"usage_export","__file__":"/tmp/chronicles/src/server.py"}\n'
bundle += 'exec('+repr(server)+',namespace)\n'
bundle += 'collector=namespace["collector"];collector.import_path=None;collector.bridge=None;\nfor adapter in collector.adapters:\n if adapter.provider == "cursor" and adapter.account: adapter.account.cache_path=None\n'
bundle += 'report=collector.collect()\n'
bundle += 'print(json.dumps({"schema":"usage-atlas.events.v1","updatedAt":report["updatedAt"],"events":collector.local_events,"errors":report["errors"],"files":report["files"],"missing":collector.local_missing,"legacyIds":collector.local_legacy_ids}))\n'
result = subprocess.run(['ssh','-o','BatchMode=yes','-o','ConnectTimeout=10',args.host,'python3 -'],input=bundle,text=True,capture_output=True,timeout=180)
if result.returncode:
    raise SystemExit(result.stderr.strip() or 'SSH export failed')
data = json.loads(result.stdout)
if data.get('schema') != 'usage-atlas.events.v1':
    raise SystemExit('Unexpected export schema')
directory = ROOT/'.local'/'imports'
directory.mkdir(parents=True,exist_ok=True)
temporary = directory/'macmini.json.tmp'
temporary.write_text(json.dumps(data,ensure_ascii=False))
temporary.replace(directory/'macmini.json')
print(json.dumps({k:data[k] for k in ['updatedAt','files','errors']},ensure_ascii=False))
print('Imported',len(data['events']),'usage records from',args.host)
