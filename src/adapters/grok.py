"""Read-only grok history adapter."""
import os
import json
import sqlite3
import csv
from io import StringIO
from pathlib import Path
from .base import CachedFileAdapter, event_id, tokens, timestamp


class GrokAdapter(CachedFileAdapter):
    provider = 'grok'

    def __init__(self, root=None):
        super().__init__()
        self.root = root if root is not None else Path(os.environ.get('GROK_HOME', Path.home()/'.grok'))/'sessions'

    def paths(self):
        return self.root.rglob('*.jsonl') if self.root.exists() else []

    @staticmethod
    def parse(path):
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

