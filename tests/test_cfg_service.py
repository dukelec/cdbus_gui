"""Run with: python3 -m unittest discover -s tests -v

Load only the service function so tests need no serial device or UDP transport.
"""
import ast
import asyncio
import logging
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import json5

ROOT = Path(__file__).resolve().parents[1]


class ConfigServiceTests(unittest.IsolatedAsyncioTestCase):
    async def test_read_errors_do_not_stop_either_backend(self):
        for filename in ('main.py', 'main_udp.py'):
            with self.subTest(backend=filename), tempfile.TemporaryDirectory() as td:
                root = Path(td)
                (root / 'broken.json').write_text('{ invalid json', encoding='utf-8')
                (root / 'good.json').write_text('{reg: {list: []}}', encoding='utf-8')
                requests = [
                    {'action': 'get_cfg', 'cfg': 'broken.json'},
                    {'action': 'get_cfg', 'cfg': 'missing.json'},
                    {'action': 'get_cfg', 'cfg': 'good.json'},
                    {'action': 'get_cfgs'},
                ]
                replies = []

                class Sock:
                    def __init__(self, *args):
                        pass

                    async def recvfrom(self):
                        if not requests:
                            raise asyncio.CancelledError
                        return requests.pop(0), ('/dev', 'cmd')

                    async def sendto(self, data, addr):
                        replies.append(data)

                # Redirect only config-file opens; never modify the user's configs.
                def config_open(path):
                    return open(root / Path(path).name, encoding='utf-8')

                tree = ast.parse((ROOT / filename).read_text())
                fn = next(n for n in tree.body if isinstance(n, ast.AsyncFunctionDef)
                          and n.name == 'cfgs_service')
                code = compile(ast.Module(body=[fn], type_ignores=[]), filename, 'exec')
                ns = dict(os=os, json5=json5, csa={'cfgs': []}, open=config_open,
                          CDWebSocket=Sock, ws_ns=None, logger=logging.getLogger('test.cfgs'))
                exec(code, ns)
                with patch('os.listdir', return_value=['broken.json', 'good.json']):
                    with self.assertLogs('test.cfgs', level='WARNING'):
                        with self.assertRaises(asyncio.CancelledError):
                            await ns['cfgs_service']()
                self.assertEqual(len(replies), 4)
                self.assertTrue(replies[0].startswith('err:'))
                self.assertTrue(replies[1].startswith('err:'))
                self.assertEqual(replies[2], {'reg': {'list': []}})
                self.assertEqual(replies[3], ['broken.json', 'good.json'])


if __name__ == '__main__':
    unittest.main()
