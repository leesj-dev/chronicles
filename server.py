import argparse
import json
import os
import threading
import re
from collections import defaultdict
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from zoneinfo import ZoneInfo
from extra_sources import AntigravityScanner, CopilotScanner, event_id
from provider_sources import HistoryScanner, OpenUsageBridge

ROOT = Path(__file__).resolve().parent
KST = ZoneInfo(os.environ.get('CHRONICLES_TIMEZONE','UTC'))


def number(value):
    return max(0, value) if isinstance(value, int) else 0


def day(timestamp):
    try:
        return datetime.fromisoformat(timestamp.replace('Z', '+00:00')).astimezone(KST).date().isoformat()
    except (ValueError, AttributeError, TypeError):
        return None


def parse_log(path, provider):
    events = []
    model = 'unknown'
    previous = None
    skipped = 0
    with path.open(encoding='utf-8') as stream:
        for line in stream:
            try:
                record = json.loads(line)
            except (ValueError, UnicodeError):
                skipped += 1
                continue
            if not isinstance(record, dict):
                continue
            timestamp = record.get('timestamp')
            date = day(timestamp)
            if provider == 'claude':
                message = record.get('message')
                if not isinstance(message, dict) or not isinstance(message.get('usage'), dict):
                    continue
                usage = message['usage']
                name = message.get('model') or 'unknown'
                if name == '<synthetic>' or not date:
                    continue
                message_id = message.get('id')
                key = ('claude', message_id, record.get('requestId')) if message_id else ('claude', str(path), record.get('uuid') or timestamp)
                values = {
                    'input': number(usage.get('input_tokens')),
                    'cacheRead': number(usage.get('cache_read_input_tokens')),
                    'cacheWrite': number(usage.get('cache_creation_input_tokens')),
                    'output': number(usage.get('output_tokens')),
                }
            else:
                payload = record.get('payload')
                if not isinstance(payload, dict):
                    continue
                if record.get('type') == 'turn_context':
                    model = payload.get('model') or model
                if payload.get('type') != 'token_count':
                    continue
                info = payload.get('info')
                if not isinstance(info, dict):
                    continue
                total = info.get('total_token_usage')
                last = info.get('last_token_usage')
                if not isinstance(total, dict) or not date:
                    continue
                current = {k: number(total.get(k)) for k in ['input_tokens', 'cached_input_tokens', 'cache_write_input_tokens', 'output_tokens', 'total_tokens']}
                if previous == current:
                    continue
                usage = last if isinstance(last, dict) else current
                if previous is not None and current['total_tokens'] >= previous['total_tokens']:
                    usage = {k: max(0, current[k] - previous[k]) for k in current}
                previous = current
                name = info.get('model') or model
                key = ('codex', timestamp, tuple(sorted(current.items())))
                cached = number(usage.get('cached_input_tokens'))
                values = {
                    'input': max(0, number(usage.get('input_tokens')) - cached - number(usage.get('cache_write_input_tokens'))),
                    'cacheRead': cached,
                    'cacheWrite': number(usage.get('cache_write_input_tokens')),
                    'output': number(usage.get('output_tokens')),
                }
            if any(values.values()):
                events.append((key, date, name, values))
    return events, skipped


class Collector:
    def __init__(self, roots=None):
        codex = Path(os.environ.get('CODEX_HOME', Path.home() / '.codex'))
        claude = Path(os.environ.get('CLAUDE_CONFIG_DIR', Path.home() / '.claude'))
        self.roots = roots or [('codex', codex / 'sessions'), ('codex', codex / 'archived_sessions'), ('claude', claude / 'projects')]
        self.cache = {}
        self.lock = threading.Lock()
        self.antigravity = AntigravityScanner() if roots is None else None
        self.copilot = CopilotScanner() if roots is None else None
        self.import_path = ROOT / ".local" / "imports" / "macmini.json" if roots is None else None
        self.history = HistoryScanner() if roots is None else None
        self.bridge = OpenUsageBridge() if roots is None else None
        self.local_events = []
        self.local_missing = []

    def collect(self):
        with self.lock:
            unique = {}
            active = set()
            errors = []
            skipped = 0
            for provider, root in self.roots:
                if not root.exists():
                    continue
                for path in root.rglob('*.jsonl'):
                    try:
                        resolved = path.resolve()
                        active.add(resolved)
                        stat = path.stat()
                        signature = (stat.st_mtime_ns, stat.st_size)
                        cached = self.cache.get(resolved)
                        if cached is None or cached[0] != signature:
                            parsed, bad = parse_log(path, provider)
                            self.cache[resolved] = (signature, parsed, bad)
                        _, events, bad = self.cache[resolved]
                        skipped += bad
                        for key, date, model, values in events:
                            key = event_id(key)
                            existing = unique.get(key)
                            if existing is None:
                                unique[key] = (provider, date, model, values.copy())
                            else:
                                for metric, value in values.items():
                                    existing[3][metric] = max(existing[3][metric], value)
                    except (OSError, UnicodeError) as error:
                        errors.append(f'{provider}: {type(error).__name__}')
            self.cache = {path: item for path, item in self.cache.items() if path in active}
            if self.antigravity:
                ag_events, ag_files, ag_errors = self.antigravity.scan()
                errors.extend(ag_errors)
                for key, timestamp, model, values in ag_events:
                    date = day(timestamp)
                    if date:
                        unique[event_id(key)] = ('antigravity', date, model, values)
            else:
                ag_files = 0
            cp_files = 0
            if self.copilot:
                cp_events, cp_files, cp_errors = self.copilot.scan()
                errors.extend(cp_errors)
                for key,timestamp,model,values in cp_events:
                    date=day(timestamp)
                    if date:
                        unique[event_id(key)]=('copilot',date,model,values)
            history_files = 0
            if self.history:
                history_events, history_files, history_errors = self.history.scan()
                errors.extend(history_errors)
                for key, provider, ts, model, values in history_events:
                    date = day(ts)
                    if date: unique[event_id(key)] = (provider, date, model, values)
            self.local_events = [dict(id=k, provider=p, date=d, model=m, **v) for k,(p,d,m,v) in unique.items()]
            devices = {k: {'this-mac'} for k in unique}
            imported_at = None
            self.local_missing = [dict(r,date=day(r['timestamp']),device='this-mac') for r in getattr(self.copilot,'missing',[]) if day(r['timestamp'])]
            missing = {r['id']:r.copy() for r in self.local_missing}
            legacy_ids = set(getattr(self.antigravity,'legacy_ids',[]))
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
            return dict(accountSnapshots=self.bridge.collect() if self.bridge else [], rows=data, missing=list(missing.values()), legacyAntigravity=len(legacy_ids), timezone=str(KST), updatedAt=datetime.now(timezone.utc).isoformat(), files=len(active)+ag_files+cp_files+history_files, importedAt=imported_at, localEvents=len(self.local_events), remoteEvents=sum('macmini' in v for v in devices.values()), events=len(unique), skipped=skipped, errors=sorted(set(errors)))


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
        elif path in ('/', '/index.html', '/app.js', '/combobox.js', '/analytics.mjs', '/style.css', '/shadcn.css', '/favicon.svg'):
            filename = 'index.html' if path == '/' else path[1:]
            content = (ROOT / 'web' / filename).read_bytes()
            mime = {'html': 'text/html', 'js': 'text/javascript', 'css': 'text/css', 'mjs':'text/javascript', 'svg':'image/svg+xml'}[filename.rsplit('.', 1)[-1]]
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
        page = (ROOT/'web'/'index.html').read_text()
        styles = (ROOT/'web'/'style.css').read_text()
        shadcn = (ROOT/'web'/'shadcn.css').read_text()
        page = re.sub(r'<link\s+rel="stylesheet"\s+href="/shadcn.css"\s*/?>', lambda _: '<style>'+shadcn+'</style>', page)
        combobox = (ROOT/'web'/'combobox.js').read_text()
        page = page.replace('<script src="/combobox.js"></script>', '<script>'+combobox+'</script>')
        analytics = (ROOT/'web'/'analytics.mjs').read_text().replace('export ', '')
        app = re.sub(r'^import .*?;\n', '', (ROOT/'web'/'app.js').read_text(), count=1, flags=re.S)
        payload = json.dumps(report).replace('<', '\\u003c')
        page = re.sub(r'<link\s+rel="stylesheet"\s+href="/style.css"\s*/?>', lambda _: '<style>'+styles+'</style>', page)
        page = page.replace('<script type="module" src="/app.js"></script>', '<script>window.CHRONICLES_DATA='+payload+';</script><script type="module">'+analytics+'\n'+app+'</script>')
        favicon = (ROOT/'web'/'favicon.svg').read_text()
        import urllib.parse
        page = page.replace('href="/"', 'href="#"')
        page = page.replace('/favicon.svg', 'data:image/svg+xml,'+urllib.parse.quote(favicon))
        args.export.parent.mkdir(parents=True, exist_ok=True)
        args.export.write_text(page)
        print(f'Exported snapshot: {args.export}')
        raise SystemExit(0)
    print(f'Chronicles: http://127.0.0.1:{args.port}', flush=True)
    ThreadingHTTPServer(('127.0.0.1', args.port), Handler).serve_forever()
