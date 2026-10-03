"""Read-only opencode history adapter."""
import os
import json
import sqlite3
import csv
from io import StringIO
from pathlib import Path
from .base import CachedFileAdapter, event_id, tokens, timestamp


class OpenCodeAdapter(CachedFileAdapter):
    provider = 'opencode'

    def __init__(self, root=None):
        super().__init__()
        self.root = root if root is not None else Path(os.environ.get('OPENCODE_DATA_DIR', Path(os.environ.get('XDG_DATA_HOME', Path.home()/'.local/share'))/'opencode'))

    def paths(self):
        return self.root.glob('opencode*.db') if self.root.exists() else []

    @staticmethod
    def parse(path):
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

