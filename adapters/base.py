"""Shared read-only history contract; each adapter represents one harness."""
import hashlib
import json
import sqlite3
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Protocol
from zoneinfo import ZoneInfo
import os

KST = ZoneInfo(os.environ.get('CHRONICLES_TIMEZONE', 'UTC'))


def event_id(key):
    return hashlib.sha256(json.dumps(key, ensure_ascii=False, separators=(',', ':')).encode()).hexdigest()


def number(value):
    return max(0, value) if isinstance(value, int) else 0


def day(value):
    try:
        return datetime.fromisoformat(value.replace('Z', '+00:00')).astimezone(KST).date().isoformat()
    except (ValueError, AttributeError, TypeError):
        return None


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


# (deduplication key, provider, timestamp, model, token/count values)
HistoryEvent = tuple[object, str, str, str, dict]


@dataclass
class ScanResult:
    events: list[HistoryEvent] = field(default_factory=list)
    files: int = 0
    errors: list[str] = field(default_factory=list)
    skipped: int = 0
    missing: list[dict] = field(default_factory=list)
    legacy_ids: list[str] = field(default_factory=list)


class HistoryAdapter(Protocol):
    provider: str

    def scan(self) -> ScanResult: ...


class CachedFileAdapter:
    """Common file invalidation, including SQLite WAL changes."""
    def __init__(self):
        self.cache = {}

    def paths(self):
        raise NotImplementedError

    def scan(self) -> ScanResult:
        result = ScanResult()
        active = set()
        for path in self.paths():
            active.add(path)
            try:
                wal = Path(str(path) + '-wal')
                signature = (path.stat().st_mtime_ns, path.stat().st_size, wal.stat().st_mtime_ns if wal.exists() else 0)
                if path not in self.cache or self.cache[path][0] != signature:
                    self.cache[path] = (signature, self.parse(path))
                result.events.extend(self.cache[path][1])
            except (OSError, sqlite3.Error, ValueError):
                result.errors.append(f'{self.provider}: history could not be read')
        self.cache = {p: value for p, value in self.cache.items() if p in active}
        result.files = len(active)
        return result
