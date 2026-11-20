"""Run with: python3 -m unittest discover -s tests -v"""
from pathlib import Path
import unittest

import json5

ROOT = Path(__file__).resolve().parents[1]
LANGS = {'zh-CN', 'zh-TW'}  # the LANG values of html/utils/lang.js, besides 'en'


class ConfigTests(unittest.TestCase):
    def test_trans_names_known_languages_and_registers(self):
        for path in sorted((ROOT / 'configs').glob('*.json')):
            with self.subTest(cfg=path.name):
                reg = json5.loads(path.read_text(encoding='utf-8'))['reg']
                lists = [reg['list']] + [s.get('list', []) for s in (reg.get('sets') or {}).values()]
                names = {r[4] for l in lists for r in l}
                seps = reg.get('seps') or {}
                self.assertEqual(set(seps) - names, set(), 'seps: unknown registers')
                for lang, t in (reg.get('trans') or {}).items():
                    self.assertIn(lang, LANGS)
                    self.assertEqual(set(t) - {'list', 'seps'}, set(), f'{lang}: only list and seps')
                    self.assertEqual(set(t.get('list', {})) - names, set(), f'{lang}: unknown registers')
                    self.assertEqual(set(t.get('seps', {})) - set(seps), set(), f'{lang}: unknown seps')


if __name__ == '__main__':
    unittest.main()
