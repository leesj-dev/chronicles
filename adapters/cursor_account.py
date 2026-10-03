"""Cursor account history using the app's existing login and official usage export.

Credentials stay in memory. Only normalized usage counters are persisted.
"""
import base64
import json
import os
import re
import sqlite3
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from urllib.error import HTTPError
from urllib.parse import urlencode
from urllib.request import Request, HTTPRedirectHandler, ProxyHandler, build_opener
from .base import event_id


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None  # Never forward an account cookie to a redirected destination.


class CursorAccountHistory:
    def __init__(self, parser, cache_path=None, state_path=None):
        self.parser = parser
        self.cache_path = cache_path or Path(__file__).resolve().parent.parent/'.local/cursor-history.json'
        if state_path is not None:
            self.state_path = state_path
        elif sys.platform == 'darwin':
            self.state_path = Path.home()/'Library/Application Support/Cursor/User/globalStorage/state.vscdb'
        elif sys.platform == 'win32':
            self.state_path = Path(os.environ.get('APPDATA', Path.home()))/'Cursor/User/globalStorage/state.vscdb'
        else:
            self.state_path = Path(os.environ.get('XDG_CONFIG_HOME', Path.home()/'.config'))/'Cursor/User/globalStorage/state.vscdb'
        self.opener = build_opener(ProxyHandler({}), NoRedirect())
        self.cached = None
        self.updated = 0
        self.errors = []

    def access_token(self):
        token = None
        if self.state_path.exists():
            c = sqlite3.connect(self.state_path.resolve().as_uri()+'?mode=ro', uri=True)
            try:
                row = c.execute('SELECT value FROM ItemTable WHERE key=? LIMIT 1', ('cursorAuth/accessToken',)).fetchone()
                token = row[0].strip() if row and isinstance(row[0], str) else None
            finally: c.close()
        if not token and sys.platform == 'darwin' and (Path('/Applications/Cursor.app').exists() or (Path.home()/'Applications/Cursor.app').exists()):
            result = subprocess.run(['/usr/bin/security','find-generic-password','-s','cursor-access-token','-w'],capture_output=True,text=True,timeout=10)
            if result.returncode == 0: token = result.stdout.strip()
        if not token or not re.fullmatch(r'[A-Za-z0-9_.-]+', token): return None
        return token

    @staticmethod
    def subject(token):
        payload = token.split('.')[1]
        data = json.loads(base64.urlsafe_b64decode(payload+'='*(-len(payload)%4)))
        if not isinstance(data,dict) or not isinstance(data.get('sub'),str): raise ValueError('invalid token')
        subject = data['sub'].split('|')[-1]
        if not re.fullmatch(r'[A-Za-z0-9_-]{1,200}', subject): raise ValueError('invalid subject')
        return subject

    def load_cache(self):
        if self.cache_path and self.cache_path.exists():
            try:
                rows=json.loads(self.cache_path.read_text())
                return [(tuple(r[0]), r[1], r[2], r[3], r[4]) for r in rows if len(r)==5 and r[1]=='cursor' and isinstance(r[4],dict)]
            except (OSError, ValueError, TypeError, KeyError): return []
        return []

    def collect(self):
        if self.cached is None: self.cached = self.load_cache()
        if self.updated and time.monotonic()-self.updated < 300: return self.cached, self.errors
        self.updated = time.monotonic()
        self.errors = []
        try:
            token = self.access_token()
            if not token:
                self.updated = 0
                return self.cached, []
            subject = self.subject(token)
            # Wide initial window; preserved counters survive later account export retention limits.
            first = datetime.fromisoformat(os.environ.get('CHRONICLES_CURSOR_START','2025-01-01')).replace(tzinfo=timezone.utc)
            query = urlencode(dict(startDate=int(first.timestamp()*1000), endDate=int(datetime.now(timezone.utc).timestamp()*1000), strategy='tokens'))
            request = Request('https://cursor.com/api/dashboard/export-usage-events-csv?'+query, headers={'Cookie':f'WorkosCursorSessionToken={subject}%3A%3A{token}','Accept':'text/csv'})
            with self.opener.open(request, timeout=20) as response:
                body=response.read(33_554_433)
                if len(body)>33_554_432: raise ValueError('oversized CSV')
            events = self.parser(body.decode('utf-8-sig'))
            merged = {event_id(e[0]):e for e in self.cached}
            merged.update({event_id(e[0]):e for e in events})
            self.cached = list(merged.values())
            if self.cache_path:
                self.cache_path.parent.mkdir(parents=True, exist_ok=True)
                temporary = self.cache_path.with_suffix('.tmp')
                temporary.write_text(json.dumps(self.cached))
                temporary.replace(self.cache_path)
        except HTTPError as error:
            self.errors = ['Cursor: sign in again in the Cursor app' if error.code in [401,403] else 'Cursor: usage export unavailable; retained previous history']
        except (OSError, ValueError, sqlite3.Error, subprocess.SubprocessError, IndexError, TypeError):
            self.errors = ['Cursor: automatic history unavailable; retained previous history']
        return self.cached, self.errors
