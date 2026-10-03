"""Read-only cursor history adapter."""
import os
import json
import sqlite3
import csv
from io import StringIO
from pathlib import Path
from .base import ScanResult, CachedFileAdapter, event_id, tokens, timestamp
from .cursor_account import CursorAccountHistory


class CursorAdapter(CachedFileAdapter):
    provider = 'cursor'

    def __init__(self, csv_path=None, account=True):
        super().__init__()
        self.csv_path = csv_path if csv_path is not None else Path(__file__).resolve().parent.parent/'.local/imports/cursor.csv'
        self.account = CursorAccountHistory(self.parse) if account else None

    def paths(self):
        return [self.csv_path] if self.csv_path.exists() else []

    def scan(self) -> ScanResult:
        result = super().scan()
        if self.account:
            events, errors = self.account.collect()
            result.events = events + result.events
            result.errors = errors + result.errors
        return result

    @staticmethod
    def parse(path):
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

