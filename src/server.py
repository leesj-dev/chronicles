import argparse
import base64
import json
import os
import threading
import re
from collections import defaultdict
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from adapters import create_adapters
from adapters.base import KST, day, number, event_id
from adapters.limits import OpenUsageBridge

from paths import ROOT, SRC
class Collector:
    def __init__(self, roots=None):
        self.adapters = create_adapters(roots)
        self.lock = threading.Lock()
        self.import_path = ROOT / '.local/imports/macmini.json' if roots is None else None
        self.bridge = OpenUsageBridge() if roots is None else None
        self.local_legacy_ids = []
        self.local_events = []
        self.local_missing = []

    def collect(self):
        with self.lock:
            unique = {}
            errors = []
            skipped = files = 0
            missing_records, legacy_ids = [], set()
            for adapter in self.adapters:
                result = adapter.scan()
                files += result.files
                skipped += result.skipped
                errors.extend(result.errors)
                missing_records.extend(result.missing)
                legacy_ids.update(result.legacy_ids)
                for key, provider, timestamp, model, values in result.events:
                    date = day(timestamp)
                    if not date: continue
                    key = event_id(key)
                    existing = unique.get(key)
                    if existing is None:
                        unique[key] = (provider, date, model, values.copy())
                    else:
                        for metric, value in values.items():
                            existing[3][metric] = max(existing[3].get(metric, 0), value)
            self.local_events = [dict(id=k, provider=p, date=d, model=m, **v) for k,(p,d,m,v) in unique.items()]
            devices = {k: {'this-mac'} for k in unique}
            imported_at = None
            self.local_missing = [dict(r, date=day(r['timestamp']), device='this-mac') for r in missing_records if day(r['timestamp'])]
            self.local_legacy_ids = sorted(legacy_ids)
            missing = {r['id']: r.copy() for r in self.local_missing}
            if self.import_path and self.import_path.exists():
                try:
                    imported = json.loads(self.import_path.read_text())
                    imported_at = imported.get('updatedAt')
                    errors.extend('SSH import: '+str(e) for e in imported.get('errors',[]))
                    legacy_ids.update(imported.get('legacyIds',[]))
                    for r in imported.get('missing',[]):
                        if r['id'] in missing:missing[r['id']]['device']='shared'
                        else:missing[r['id']]=dict(r,device='macmini')
                    for event in imported['events']:
                        k = event['id']
                        values = {f:number(event.get(f)) for f in ['input','output','cacheRead','cacheWrite','rounds','roundRecords']}
                        if k in unique:
                            for field,value in values.items():
                                unique[k][3][field] = max(unique[k][3].get(field,0),value)
                            devices[k].add('macmini')
                        else:
                            unique[k]=(event['provider'],event['date'],event['model'],values)
                            devices[k]={'macmini'}
                except (OSError, ValueError, KeyError, TypeError):
                    errors.append('SSH import could not be read')
            missing = {k:v for k,v in missing.items() if k not in unique}
            rows = defaultdict(lambda: dict(input=0, output=0, cacheRead=0, cacheWrite=0, requests=0, rounds=0, roundRecords=0))
            for event_key,(provider, date, model, values) in unique.items():
                device = 'shared' if len(devices[event_key])>1 else next(iter(devices[event_key]))
                row = rows[(provider, date, model, device)]
                for metric, value in values.items():
                    row[metric] += value
                row['requests'] += 1
            data = [dict(provider=p, date=d, model=m, device=device, **v, total=v['input'] + v['output'] + v['cacheRead'] + v['cacheWrite']) for (p, d, m, device), v in sorted(rows.items())]
            return dict(accountSnapshots=self.bridge.collect() if self.bridge else [], rows=data, missing=list(missing.values()), legacyAntigravity=len(legacy_ids), timezone=str(KST), updatedAt=datetime.now(timezone.utc).isoformat(), files=files, importedAt=imported_at, localEvents=len(self.local_events), remoteEvents=sum('macmini' in v for v in devices.values()), events=len(unique), skipped=skipped, errors=sorted(set(errors)))


collector = Collector()
DEMO = False


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.headers.get('Host', '').split(':')[0] not in ('127.0.0.1', 'localhost'):
            self.send_error(403)
            return
        path = self.path.split('?')[0]
        if path in ('/api/usage', '/api/demo', '/api/local'):
            try:
                content = json.dumps(json.loads((ROOT/'examples'/'demo.json').read_text()) if path=='/api/demo' or (DEMO and path!='/api/local') else collector.collect()).encode()
            except Exception:
                self.send_error(500, 'Usage scan failed')
                return
            mime = 'application/json'
        elif path in ('/', '/index.html', '/app.js', '/combobox.js', '/calendar.js', '/analytics.mjs', '/style.css', '/shadcn.css', '/favicon.svg', '/Geist.woff2'):
            filename = 'index.html' if path == '/' else path[1:]
            content = (SRC / 'web' / filename).read_bytes()
            mime = {'html': 'text/html', 'js': 'text/javascript', 'css': 'text/css', 'mjs':'text/javascript', 'svg':'image/svg+xml', 'woff2':'font/woff2'}[filename.rsplit('.', 1)[-1]]
        else:
            self.send_error(404)
            return
        self.send_response(200)
        self.send_header('Content-Type', mime + '; charset=utf-8')
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'")
        self.send_header('Content-Length', str(len(content)))
        self.end_headers()
        self.wfile.write(content)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--port', type=int, default=8768)
    parser.add_argument('--demo', action='store_true', help='Serve fictional sample data instead of scanning local records')
    parser.add_argument('--export', type=Path, metavar='PATH', help='Write a self-contained HTML snapshot and exit')
    args = parser.parse_args()
    DEMO = args.demo
    if args.export:
        report = json.loads((ROOT/'examples'/'demo.json').read_text()) if DEMO else collector.collect()
        page = (SRC/'web'/'index.html').read_text()
        styles = (SRC/'web'/'style.css').read_text()
        font = base64.b64encode((SRC/'web'/'Geist.woff2').read_bytes()).decode('ascii')
        styles = styles.replace('/Geist.woff2', 'data:font/woff2;base64,'+font)
        shadcn = (SRC/'web'/'shadcn.css').read_text()
        page = re.sub(r'<link\s+rel="stylesheet"\s+href="/shadcn.css"\s*/?>', lambda _: '<style>'+shadcn+'</style>', page)
        combobox = (SRC/'web'/'combobox.js').read_text()
        page = page.replace('<script src="/combobox.js"></script>', '<script>'+combobox+'</script>')
        calendar = (SRC/'web'/'calendar.js').read_text()
        page = page.replace('<script src="/calendar.js"></script>', '<script>'+calendar+'</script>')
        analytics = (SRC/'web'/'analytics.mjs').read_text().replace('export ', '')
        app = re.sub(r'^import .*?;\n', '', (SRC/'web'/'app.js').read_text(), count=1, flags=re.S)
        payload = json.dumps(report).replace('<', '\\u003c')
        page = re.sub(r'<link\s+rel="stylesheet"\s+href="/style.css"\s*/?>', lambda _: '<style>'+styles+'</style>', page)
        page = page.replace('<script type="module" src="/app.js"></script>', '<script>window.CHRONICLES_DATA='+payload+';</script><script type="module">'+analytics+'\n'+app+'</script>')
        favicon = (SRC/'web'/'favicon.svg').read_text()
        import urllib.parse
        page = page.replace('href="/"', 'href="#"')
        page = page.replace('/favicon.svg', 'data:image/svg+xml,'+urllib.parse.quote(favicon))
        args.export.parent.mkdir(parents=True, exist_ok=True)
        args.export.write_text(page)
        print(f'Exported snapshot: {args.export}')
        raise SystemExit(0)
    print(f'Chronicles: http://127.0.0.1:{args.port}', flush=True)
    ThreadingHTTPServer(('127.0.0.1', args.port), Handler).serve_forever()
