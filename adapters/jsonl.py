"""Codex and Claude JSONL adapters, with independent per-harness caches."""
import json
import os
from pathlib import Path
from .base import ScanResult, day, number


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
                events.append((key, timestamp, name, values))
    return events, skipped


class JsonlAdapter:
    def __init__(self, roots):
        self.roots = list(roots)
        self.cache = {}

    def scan(self) -> ScanResult:
        result = ScanResult()
        active = set()
        for root in self.roots:
            if not root.exists(): continue
            for path in root.rglob('*.jsonl'):
                try:
                    resolved = path.resolve()
                    active.add(resolved)
                    stat = path.stat()
                    signature = (stat.st_mtime_ns, stat.st_size)
                    if resolved not in self.cache or self.cache[resolved][0] != signature:
                        parsed, bad = parse_log(path, self.provider)
                        self.cache[resolved] = (signature, parsed, bad)
                    _, events, bad = self.cache[resolved]
                    result.skipped += bad
                    result.events.extend((key, self.provider, date, model, values) for key, date, model, values in events)
                except (OSError, UnicodeError) as error:
                    result.errors.append(f'{self.provider}: {type(error).__name__}')
        self.cache = {p: value for p, value in self.cache.items() if p in active}
        result.files = len(active)
        return result


class CodexAdapter(JsonlAdapter):
    provider = 'codex'

    def __init__(self, roots=None):
        home = Path(os.environ.get('CODEX_HOME', Path.home() / '.codex'))
        super().__init__(roots if roots is not None else [home / 'sessions', home / 'archived_sessions'])


class ClaudeAdapter(JsonlAdapter):
    provider = 'claude'

    def __init__(self, roots=None):
        home = Path(os.environ.get('CLAUDE_CONFIG_DIR', Path.home() / '.claude'))
        super().__init__(roots if roots is not None else [home / 'projects'])
