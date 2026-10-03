import base64
import json
import sqlite3
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from urllib.error import HTTPError
from adapters.cursor_account import CursorAccountHistory, NoRedirect
from adapters.cursor import CursorAdapter


class CursorTests(unittest.TestCase):
    def test_automatic_export_uses_existing_login_and_only_caches_counters(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);db=root/'state.vscdb';cache=root/'counters.json'
            payload=base64.urlsafe_b64encode(json.dumps(dict(sub='auth|user_123')).encode()).decode().rstrip('=')
            token='header.'+payload+'.signature'
            c=sqlite3.connect(db);c.execute('CREATE TABLE ItemTable(key TEXT,value TEXT)');c.execute('INSERT INTO ItemTable VALUES(?,?)',('cursorAuth/accessToken',token));c.commit();c.close()
            csv='Date,Model,Input (w/ Cache Write),Input (w/o Cache Write),Cache Read,Output Tokens,Email\n2026-01-01T12:00:00Z,sonnet-4.5,0,10,20,30,private@example.test\n'
            class Response:
                def __enter__(self):return self
                def __exit__(self,*args):pass
                def read(self,*args):return csv.encode()
            source=CursorAccountHistory(CursorAdapter.parse,cache_path=cache,state_path=db)
            with patch('adapters.cursor_account.time.monotonic', return_value=10), patch.object(source.opener,'open',return_value=Response()) as fetch:
                events,errors=source.collect()
                request=fetch.call_args.args[0]
                self.assertTrue(request.full_url.startswith('https://cursor.com/api/dashboard/export-usage-events-csv?'))
                self.assertIn('strategy=tokens',request.full_url)
                self.assertEqual(request.get_header('Cookie'),'WorkosCursorSessionToken=user_123%3A%3A'+token)
            self.assertFalse(errors);self.assertEqual(len(events),1)
            self.assertEqual(sum(events[0][-1].values()),60)
            self.assertNotIn(token,cache.read_text());self.assertNotIn('private@example',cache.read_text())
            # Refresh failure preserves history and emits a fixed message, never raw errors/credentials.
            source.updated=0
            with patch.object(source.opener,'open',side_effect=HTTPError('https://cursor.com',401,token,None,None)):
                retained,errors=source.collect()
            self.assertEqual(retained,events);self.assertNotIn(token,str(errors))
            self.assertIn('sign in',errors[0])
            loaded=CursorAccountHistory(CursorAdapter.parse,cache_path=cache,state_path=root/'absent')
            with patch.object(loaded,'access_token',return_value=None):
                self.assertEqual(loaded.collect()[0],events)
            self.assertIsNone(NoRedirect().redirect_request(request,None,302,'Found',{},'https://other.example'))

    def test_subject_rejects_invalid_header_characters(self):
        for subject in ['bad\r\nCookie: secret','', 'user/name']:
            payload=base64.urlsafe_b64encode(json.dumps(dict(sub=subject)).encode()).decode().rstrip('=')
            with self.assertRaises(ValueError):CursorAccountHistory.subject('x.'+payload+'.y')
