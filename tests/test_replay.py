"""Run with: python3 -m unittest discover -s tests -v

The replayer (cd_replay.py): a recording made with cd_pcap.Recorder is read back and played
through a stand-in for the backend's report path and websocket, checking what the pages would
get, where playing stops, and the register image rebuilt from the traffic.
"""
import asyncio
import os
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / 'pycdnet'))

import cd_pcap
import cd_replay
from cdnet.utils.crc import modbus_crc


def frame(src, dst, payload):
    f = bytes([src, dst, len(payload)]) + payload
    return f + modbus_crc(f).to_bytes(2, 'little')


class Sock:
    def __init__(self):
        self.sent = []      # (path, port, dat)

    async def sendto(self, dat, addr):
        self.sent.append((addr[0], addr[1], dat))
        return None


class NS:
    def __init__(self, paths):
        self.connections = {p: None for p in paths}


def make_recording(rec_dir):
    """one second of traffic of two devices, fe and 01: debug lines, a register read and a
    write with their answers, a write without answer, a mark, and a frame with a bad crc"""
    rec = cd_pcap.Recorder(rec_dir=rec_dir)
    path = rec.start(dev_str='test')
    t = 1_700_000_000_000_000_000
    ev = []
    def rx(f, ms): rec.frame(f, outbound=False, ts_ns=t + ms * 1_000_000)
    def tx(f, ms): rec.frame(f, outbound=True, ts_ns=t + ms * 1_000_000)
    rx(frame(0xfe, 0x00, b'\x80\x09\x09hello fe\n'), 0)
    rx(frame(0x01, 0x00, b'\x80\x09\x09hello 01\n'), 100)
    tx(frame(0x00, 0xfe, b'\x80\x40\x05\x00\x10\x00\x04'), 200)            # read 0x0010, 4 bytes
    rx(frame(0xfe, 0x00, b'\x80\x05\x40\x80\x11\x22\x33\x44'), 210)         # -> 11 22 33 44
    rec.mark('one', ts_ns=t + 250 * 1_000_000)
    tx(frame(0x00, 0xfe, b'\x80\x41\x05\x20\x12\x00\xaa\xbb'), 300)        # write 0x0012 = aa bb
    rx(frame(0xfe, 0x00, b'\x80\x05\x41\x80'), 310)                         # ok
    tx(frame(0x00, 0xfe, b'\x80\x41\x05\x20\x20\x00\xcc'), 400)            # write 0x0020 = cc
    rx(frame(0xfe, 0x00, b'\x80\x05\x41\x81'), 410)                         # refused: not stored
    tx(frame(0x00, 0x01, b'\x80\x40\x05\xa0\x00\x01\x05\x06'), 500)        # write without answer, device 01
    tx(frame(0x00, 0xfe, b'\x80\x40\x05\x00\x10\x00\x02'), 600)            # read 0x0010, 2 bytes
    rx(frame(0xfe, 0x00, b'\x80\x05\x40\x80\x99\x88'), 610)                 # -> 99 88 (over 11 22)
    bad = bytearray(frame(0xfe, 0x00, b'\x80\x09\x09bad\n')); bad[-1] ^= 1
    rx(bytes(bad), 700)
    rx(frame(0xfe, 0x00, b'\x80\x09\x09bye\n'), 1000)
    rec.stop()
    return path


class ReplayTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.td = tempfile.TemporaryDirectory()
        self.path = make_recording(os.path.join(self.td.name, 'records'))
        self.reports = []
        self.ns = NS(['/', '/80:00:fe', '/80:00:01'])
        self.csa = {'net': 0, 'mac': 0, 'dev': None}
        self.rp = cd_replay.Replayer(self.csa, self.ns, self.rx_rpt, rec_dir=os.path.join(self.td.name, 'records'))
        self.rp.sock = Sock()

    def tearDown(self):
        self.td.cleanup()

    async def rx_rpt(self, rx, ts_ns):
        self.reports.append((rx, ts_ns))

    async def play(self, to, speed=0):
        self.rp.play(to, speed)
        await self.rp.task

    def test_read_file(self):
        pkts = cd_replay.read_pcapng(Path(self.path).read_bytes())
        self.assertEqual(len(pkts), 14)
        kinds = [p[0] for p in pkts]
        self.assertEqual(kinds.count('mark'), 1)
        self.assertEqual([p[4] for p in pkts[:3]], [False, False, True])
        self.assertEqual(pkts[kinds.index('mark')][3], 'one')
        with self.assertRaises(cd_replay.PcapngError):
            cd_replay.read_pcapng(b'not a capture at all')

    async def test_load_and_status(self):
        self.assertEqual([f['name'] for f in self.rp.list_files()], [os.path.basename(self.path)])
        self.rp.load(os.path.basename(self.path))
        st = self.rp.status()
        self.assertEqual((st['pkts'], st['pos'], st['t'], st['playing'], st['err']), (14, 0, 0, False, None))
        self.assertEqual(st['devs'], ['80:00:fe', '80:00:01'])     # the most talkative first, the host left out
        self.assertEqual(st['pages'], ['80:00:fe', '80:00:01'])
        self.assertEqual([m['text'] for m in st['marks']], ['one'])
        with self.assertRaises(ValueError):
            self.rp.load('../etc/passwd')
        with self.assertRaises(ValueError):
            self.rp.load('missing.pcapng')
        # an upload is taken by its bytes
        self.rp.load('up.pcapng', Path(self.path).read_bytes())
        self.assertEqual(self.rp.status()['name'], 'up.pcapng')

    async def test_play_in_steps(self):
        self.rp.load(os.path.basename(self.path))
        # the host's own frames are not reported, the bad one is dropped, the timestamps are kept
        await self.play(0.25)
        texts = [rx[2] for rx, _ in self.reports]
        self.assertEqual(texts, [b'hello fe\n', b'hello 01\n', b'\x80\x11\x22\x33\x44'])
        self.assertEqual(self.reports[1][1], 1_700_000_000_100_000_000)
        st = self.rp.status()
        self.assertEqual((st['pos'], st['t']), (5, 0.25))      # the mark at 0.25 s is in
        # the image at this point: the first read
        regs = [s for s in self.rp.sock.sent if s[1] == 'reg_import']
        self.assertEqual(regs[-1][0], '/80:00:fe')
        self.assertEqual(regs[-1][2]['mem'], [[0x10, b'\x11\x22\x33\x44']])
        # going back is refused, going on works; a mark becomes a log line on every page
        with self.assertRaises(ValueError):
            self.rp.play(0.1)
        await self.play(0.55)
        logs = [s for s in self.rp.sock.sent if s[1] == 9]
        self.assertEqual([s[0] for s in logs], ['/', '/80:00:fe', '/80:00:01'])
        self.assertIn(b'[mark]: ---- mark: one ----\n', logs[0][2]['dat'])
        self.assertTrue(logs[1][2]['dat'].endswith(b': ---- mark: one ----\n'))
        regs = {s[0]: s[2]['mem'] for s in self.rp.sock.sent if s[1] == 'reg_import'}
        self.assertEqual(regs['/80:00:fe'], [[0x10, b'\x11\x22\xaa\xbb']])   # the ok write over bytes 2 and 3
        self.assertEqual(regs['/80:00:01'], [[0x100, b'\x05\x06']])                # written without answer
        # to the end: the refused write left 0x20 alone, the second read overwrote two bytes
        await self.play(100)
        st = self.rp.status()
        self.assertEqual((st['pos'], st['t'], st['playing']), (14, 1.0, False))
        regs = {s[0]: s[2]['mem'] for s in self.rp.sock.sent if s[1] == 'reg_import'}
        self.assertEqual(regs['/80:00:fe'], [[0x10, b'\x99\x88\xaa\xbb']])
        self.assertEqual([rx[2] for rx, _ in self.reports][-1], b'bye\n')
        self.assertEqual(len(self.reports), 7)
        with self.assertRaises(ValueError):
            self.rp.play(100)   # at the end
        # rewind forgets the image and starts over
        self.rp.rewind()
        self.assertEqual((self.rp.pos, self.rp.mem), (0, {}))
        await self.play(0.05)
        self.assertEqual(len(self.reports), 8)
        # status pushes went to the index page
        self.assertTrue(any(s[0] == '/' and s[1] == 'replay' for s in self.rp.sock.sent))

    async def test_paced_and_refusals(self):
        self.rp.load(os.path.basename(self.path))
        self.csa['dev'] = object()
        with self.assertRaises(ValueError):
            self.rp.play(1)
        self.csa['dev'] = None
        t0 = asyncio.get_running_loop().time()
        await self.play(0.1, speed=10)      # 100 ms of capture at 10x: about 10 ms
        self.assertLess(asyncio.get_running_loop().time() - t0, 0.5)
        self.assertEqual(len(self.reports), 2)
        with self.assertRaises(ValueError):
            cd_replay.Replayer(self.csa, self.ns, self.rx_rpt).play(1)   # nothing loaded


if __name__ == '__main__':
    unittest.main()
