"""Current account metrics; intentionally separate from dated model history."""
import json
import time
from concurrent.futures import ThreadPoolExecutor
from urllib.request import ProxyHandler, build_opener

PROVIDERS = {
    'claude': 'Claude Code', 'codex': 'Codex', 'cursor': 'Cursor',
    'antigravity': 'Antigravity', 'copilot': 'Copilot', 'devin': 'Devin',
    'grok': 'Grok', 'ollama': 'Ollama', 'opencode': 'OpenCode',
    'openrouter': 'OpenRouter', 'zai': 'Z.ai',
}


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
