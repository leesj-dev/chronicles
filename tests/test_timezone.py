import os
import unittest
from datetime import datetime
from pathlib import Path
from unittest.mock import patch

from adapters.base import get_timezone


class TimezoneTests(unittest.TestCase):
    def test_override_takes_precedence(self):
        with patch.dict(os.environ, {'CHRONICLES_TIMEZONE': 'UTC', 'TZ': 'Asia/Seoul'}, clear=True):
            self.assertEqual(str(get_timezone()), 'UTC')

    def test_tz_environment(self):
        with patch.dict(os.environ, {'TZ': ':Asia/Seoul'}, clear=True):
            self.assertEqual(str(get_timezone()), 'Asia/Seoul')

    def test_mac_system_timezone_and_midnight(self):
        with patch.dict(os.environ, {}, clear=True), \
                patch('adapters.base.Path.resolve', return_value=Path('/var/db/timezone/zoneinfo/Asia/Seoul')), \
                patch('adapters.base.Path.read_text', side_effect=FileNotFoundError):
            zone = get_timezone()
        self.assertEqual(str(zone), 'Asia/Seoul')
        self.assertEqual(datetime.fromisoformat('2026-10-01T15:00:00+00:00').astimezone(zone).date().isoformat(), '2026-10-02')

    def test_linux_timezone_file_and_daylight_saving(self):
        with patch.dict(os.environ, {}, clear=True), \
                patch('adapters.base.Path.resolve', return_value=Path('/etc/localtime')), \
                patch('adapters.base.Path.read_text', return_value='America/New_York\n'):
            zone = get_timezone()
        self.assertEqual(str(zone), 'America/New_York')
        self.assertEqual(datetime(2026, 1, 1, tzinfo=zone).utcoffset().total_seconds(), -18000)
        self.assertEqual(datetime(2026, 7, 1, tzinfo=zone).utcoffset().total_seconds(), -14400)

    def test_unavailable_system_timezone_falls_back_to_utc(self):
        with patch.dict(os.environ, {'TZ': 'invalid/timezone'}, clear=True), \
                patch('adapters.base.Path.resolve', side_effect=OSError), \
                patch('adapters.base.Path.read_text', side_effect=FileNotFoundError):
            self.assertEqual(str(get_timezone()), 'UTC')
