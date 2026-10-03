import json
import re
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


class ExportTests(unittest.TestCase):
    def test_demo_export_embeds_data_styles_and_module_without_dependencies(self):
        root = Path(__file__).resolve().parents[1]
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory) / 'snapshot.html'
            subprocess.run([sys.executable, str(root/'server.py'), '--demo', '--export', str(target)], check=True, capture_output=True)
            page = target.read_text()
            self.assertNotIn('src="/app.js"', page)
            self.assertNotIn('src="/combobox.js"', page)
            self.assertIn('window.ChroniclesCombobox', page)
            self.assertNotIn('href="/style.css"', page)
            self.assertNotIn('href="/shadcn.css"', page)
            self.assertIn('--primary-foreground:', page)
            self.assertNotIn('from "./analytics.mjs"', page)
            self.assertIn('<style>', page)
            self.assertIn('data:image/svg+xml,', page)
            payload = re.search(r'window.CHRONICLES_DATA=(.*?);</script>', page, re.S).group(1)
            self.assertTrue(json.loads(payload)['demo'])
