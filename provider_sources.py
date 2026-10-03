"""Read-only history adapters and OpenUsage's loopback account-metric bridge.

Account metrics never become synthetic dated model usage. No credentials are read.
"""
import csv
from io import StringIO
from cursor_source import CursorAccountHistory
import json
import os
import sqlite3
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path
from urllib.request import urlopen, ProxyHandler, build_opener
from extra_sources import event_id

PROVIDERS = {
    'claude': 'Claude Code', 'codex': 'Codex', 'cursor': 'Cursor',
    'antigravity': 'Antigravity', 'copilot': 'Copilot', 'devin': 'Devin',
    'grok': 'Grok', 'ollama': 'Ollama', 'opencode': 'OpenCode',
    'openrouter': 'OpenRouter', 'zai': 'Z.ai',
}


def tokens(v):
    return min(1_000_000_000, max(0, v)) if isinstance(v, int) and not isinstance(v, bool) else 0


def timestamp(value, milliseconds=False):
    if isinstance(value, (int, float)) and value > 0:
        return datetime.fromtimestamp(value / (1000 if milliseconds else 1), timezone.utc).isoformat()
    if isinstance(value, str):
        parsed = datetime.fromisoformat(value.replace('Z', '+00:00'))
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        return parsed.isoformat()
    raise ValueError('missing timestamp')


class HistoryScanner:
    def __init__(self, grok=None, opencode=None, cursor=None):
        self.grok = grok or Path(os.environ.get('GROK_HOME', Path.home()/'.grok'))/'sessions'
        self.opencode = opencode or Path(os.environ.get('OPENCODE_DATA_DIR', Path(os.environ.get('XDG_DATA_HOME', Path.home()/'.local/share'))/'opencode'))
        self.cursor = cursor or Path(__file__).resolve().parent/'.local/imports/cursor.csv'
        self.cache = {}
        self.cursor_account = CursorAccountHistory(self.parse_cursor) if grok is None and opencode is None and cursor is None else None

    @staticmethod
    def parse_grok(path):
        events = []
        for line in path.read_text().splitlines():
            try:
                record = json.loads(line)
                params = record.get('params') or {}
                update = params.get('update') or record.get('update') or {}
                if update.get('sessionUpdate') != 'turn_completed': continue
                meta = params.get('_meta') or record.get('_meta') or {}
                date = timestamp(meta['agentTimestampMs'], True) if meta.get('agentTimestampMs') else timestamp(record.get('timestamp'))
                for model, usage in (update.get('usage') or {}).get('modelUsage', {}).items():
                    if not isinstance(usage, dict) or not isinstance(usage.get('inputTokens'), int): continue
                    total_input = tokens(usage['inputTokens'])
                    read = min(total_input, tokens(usage.get('cachedReadTokens')))
                    write = min(total_input-read, tokens(usage.get('cacheCreationTokens')))
                    values = dict(input=total_input-read-write, output=tokens(usage.get('outputTokens')), cacheRead=read, cacheWrite=write)
                    # Copies with the same event ID/model collapse across sessions and devices.
                    key = ('grok', meta.get('eventId') or event_id(record), model)
                    events.append((key, 'grok', date, model, values))
            except (ValueError, TypeError, AttributeError, OverflowError): continue
        return events

    @staticmethod
    def parse_opencode(path):
        events = {}
        connection = sqlite3.connect(path.resolve().as_uri()+'?mode=ro', uri=True)
        try:
            tables = {r[0] for r in connection.execute("SELECT name FROM sqlite_master WHERE type='table'")}
            for table in ['message', 'session_message']:
                if table not in tables: continue
                columns = {r[1] for r in connection.execute(f'PRAGMA table_info({table})')}
                if not {'id', 'time_created', 'data'} <= columns: continue
                kind = 'type' if 'type' in columns else 'NULL'
                for key, created, raw, role in connection.execute(f'SELECT id,time_created,data,{kind} FROM {table} WHERE length(data)<=33554432'):
                    try:
                        r = json.loads(raw)
                        actual_role = role or r.get('role')
                        if actual_role != 'assistant' and not (actual_role == 'compaction' and r.get('status') == 'completed'): continue
                        usage = r.get('tokens')
                        if not isinstance(usage, dict) or not any(k in usage for k in ['input','output']): continue
                        if not (r.get('time') or {}).get('completed') and not r.get('finish') and actual_role != 'compaction': continue
                        model = (r.get('model') or {}).get('id') or r.get('modelID') or 'unknown'
                        cache = usage.get('cache') or {}
                        # OpenCode stores cache buckets and reasoning separately from input/output.
                        values = dict(input=tokens(usage.get('input')), output=tokens(usage.get('output'))+tokens(usage.get('reasoning')), cacheRead=tokens(cache.get('read')), cacheWrite=tokens(cache.get('write')))
                        date = timestamp((r.get('time') or {}).get('completed') or created, True)
                        events[key] = (('opencode', key), 'opencode', date, model, values)
                    except (ValueError, TypeError, AttributeError, OverflowError): continue
        finally: connection.close()
        return list(events.values())

    @staticmethod
    def parse_cursor(path):
        events = []
        with (path.open(newline='', encoding='utf-8-sig') if isinstance(path,Path) else StringIO(path)) as f:
            reader = csv.DictReader(f)
            required = {'Date','Model','Input (w/ Cache Write)','Input (w/o Cache Write)','Cache Read','Output Tokens'}
            if len(reader.fieldnames or []) != len(set(reader.fieldnames or [])): raise ValueError('duplicate CSV columns')
            if not required <= set(reader.fieldnames or []): raise ValueError('invalid CSV schema')
            duplicates = {}
            for row in reader:
                try:
                    date = timestamp(row['Date'])
                    def count(column):
                        value = int(row[column].strip() or '0')
                        if value < 0: raise ValueError('negative tokens')
                        return tokens(value)
                    values = dict(input=count('Input (w/o Cache Write)'), output=count('Output Tokens'), cacheRead=count('Cache Read'), cacheWrite=count('Input (w/ Cache Write)'))
                    # Include multiplicity: identical rows can be separate requests in one export.
                    identity = event_id((date, row['Model'], values))
                    occurrence = duplicates.get(identity, 0); duplicates[identity] = occurrence+1
                    events.append((('cursor', identity, occurrence), 'cursor', date, row['Model'], values))
                except (ValueError, TypeError, OverflowError): continue
        return events

    def scan(self):
        events, errors, active = [], [], set()
        if self.cursor_account:
            account_events, account_errors = self.cursor_account.collect()
            events.extend(account_events); errors.extend(account_errors)
        sources = [(p, self.parse_grok) for p in self.grok.rglob('*.jsonl')] if self.grok.exists() else []
        sources += [(p, self.parse_opencode) for p in self.opencode.glob('opencode*.db')] if self.opencode.exists() else []
        if self.cursor.exists(): sources.append((self.cursor, self.parse_cursor))
        for path, parser in sources:
            active.add(path)
            try:
                wal = Path(str(path)+'-wal')
                signature = (path.stat().st_mtime_ns, path.stat().st_size, wal.stat().st_mtime_ns if wal.exists() else 0)
                if path not in self.cache or self.cache[path][0] != signature:
                    self.cache[path] = (signature, parser(path))
                events.extend(self.cache[path][1])
            except (OSError, sqlite3.Error, ValueError): errors.append(f'{parser.__name__.removeprefix("parse_")}: history could not be read')
        self.cache = {p:v for p,v in self.cache.items() if p in active}
        return events, len(active), errors


class OpenUsageBridge:
    """Optional read-only integration; fixed loopback origin, no proxy or credential access."""
    def __init__(self, port=6736):
        self.port = int(port)
        self.cached = None
        self.updated = 0
        self.opener = build_opener(ProxyHandler({}))

    def fetch(self, provider):
        try:
            with self.opener.open(f'http://127.0.0.1:{self.port}/v1/usage/{provider}', timeout=2) as response:
                raw = json.loads(response.read(2_000_001))
            snapshots = raw if isinstance(raw, list) else [raw]
            result = []
            for snapshot in snapshots:
                if not isinstance(snapshot, dict) or not str(snapshot.get('providerId', '')).startswith(provider): continue
                lines = []
                for line in snapshot.get('lines', []):
                    if not isinstance(line, dict) or line.get('type') not in ['text','progress','badge','barChart']: continue
                    if line.get('label') == 'Error' or str(line.get('value') or line.get('text') or '').strip().lower() in ['no data','no usage data','—']: continue
                    safe = {k: str(line[k])[:160] for k in ['type','label','value','text','subtitle','note','resetsAt'] if line.get(k) is not None}
                    for k in ['used','limit']:
                        if isinstance(line.get(k),(int,float)): safe[k] = line[k]
                    if isinstance(line.get('format'),dict): safe['format'] = {k:str(v)[:40] for k,v in line['format'].items() if k in ['kind','suffix']}
                    if line.get('type') == 'barChart' and isinstance(line.get('points'), list):
                        safe['points'] = [dict(label=str(p.get('label',''))[:40], value=p['value'], valueLabel=str(p.get('valueLabel',''))[:80]) for p in line['points'][:366] if isinstance(p,dict) and isinstance(p.get('value'),(int,float)) and p['value'] >= 0]
                    lines.append(safe)
                result.append(dict(provider=provider, fetchedAt=str(snapshot.get('fetchedAt',''))[:40], plan=str(snapshot.get('plan') or '')[:80], lines=lines))
            return result
        except (OSError, ValueError, TypeError, AttributeError): return []

    def collect(self):
        if self.cached is not None and time.monotonic()-self.updated < 30: return self.cached
        with ThreadPoolExecutor(max_workers=11) as pool:
            snapshots = [s for group in pool.map(self.fetch, PROVIDERS) for s in group]
        self.cached = snapshots
        self.updated = time.monotonic()
        return snapshots
