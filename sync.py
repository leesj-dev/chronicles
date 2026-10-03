import argparse
import json
import os
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parent
parser = argparse.ArgumentParser(description='Import usage metadata over SSH without copying conversation content.')
parser.add_argument('--host', default='macmini')
args = parser.parse_args()
source = (ROOT/'extra_sources.py').read_text()
server = (ROOT/'server.py').read_text()
bundle = 'import types,sys,json,os\n'
bundle += 'os.environ["CHRONICLES_TIMEZONE"]='+repr(os.environ.get('CHRONICLES_TIMEZONE','UTC'))+'\n'
bundle += 'extra=types.ModuleType("extra_sources");sys.modules["extra_sources"]=extra\n'
bundle += 'exec('+repr(source)+',extra.__dict__)\n'
bundle += 'namespace={"__name__":"usage_export","__file__":"/tmp/usage-readonly-export.py"}\n'
bundle += 'exec('+repr(server)+',namespace)\n'
bundle += 'collector=namespace["collector"];collector.import_path=None\n'
bundle += 'report=collector.collect()\n'
bundle += 'print(json.dumps({"schema":"usage-atlas.events.v1","updatedAt":report["updatedAt"],"events":collector.local_events,"errors":report["errors"],"files":report["files"],"missing":collector.local_missing,"legacyIds":getattr(collector.antigravity,"legacy_ids",[])}))\n'
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
