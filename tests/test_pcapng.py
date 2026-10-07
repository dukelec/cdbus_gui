"""Run with: python3 -m unittest discover -s tests -v

The pcapng recorder (cd_pcap.py): the file it writes is read back block by block here, and by
tshark when one is installed, the way Wireshark will read it.
"""
import os
import shutil
import struct
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / 'pycdnet'))

import cd_pcap
from cdnet.utils.crc import modbus_crc


def blocks(data):
    """(type, body) of every block, the trailing length checked against the leading one"""
    out = []
    pos = 0
    while pos < len(data):
        btype, total = struct.unpack_from('<II', data, pos)
        assert total % 4 == 0 and struct.unpack_from('<I', data, pos + total - 4)[0] == total
        out.append((btype, data[pos + 8:pos + total - 4]))
        pos += total
    assert pos == len(data)
    return out


def options(raw):
    out = []
    pos = 0
    while pos < len(raw):
        code, n = struct.unpack_from('<HH', raw, pos)
        if code == 0:
            break
        out.append((code, raw[pos + 4:pos + 4 + n]))
        pos += 4 + n + (-n % 4)
    return out


def with_crc(frame):
    return frame + modbus_crc(frame).to_bytes(2, 'little')


class RecorderTests(unittest.TestCase):
    def setUp(self):
        self.td = tempfile.TemporaryDirectory()
        self.rec = cd_pcap.Recorder(rec_dir=os.path.join(self.td.name, 'records'), app='cdbus_gui test')

    def tearDown(self):
        self.rec.stop()
        self.td.cleanup()

    def test_off_by_default(self):
        st = self.rec.status()
        self.assertEqual(st, {'on': False, 'path': None, 'pkts': 0, 'marks': 0, 'size': 0, 'start': None})
        # nothing to write to: frames and marks are dropped, not an error
        self.rec.frame(with_crc(b'\x00\xfe\x02\x40\x01'), outbound=True)
        self.assertFalse(self.rec.mark('x'))
        self.assertFalse(self.rec.stop())
        self.assertEqual(self.rec.status()['pkts'], 0)

    def test_file_layout(self):
        path = self.rec.start(dev_str='/dev/ttyACM0 @ 115200', comment='why')
        self.assertTrue(os.path.isfile(path))
        self.assertTrue(path.endswith('.pcapng'))
        with self.assertRaises(RuntimeError):
            self.rec.start()
        req = with_crc(b'\x00\xfe\x02\x40\x01')
        rep = with_crc(b'\xfe\x00\x0b\x01\x40cdfoc v3\n')
        self.rec.frame(req, outbound=True, ts_ns=1_700_000_000_123_456_789)
        self.assertTrue(self.rec.mark('motor'))
        self.rec.frame(rep, outbound=False, ts_ns=1_700_000_000_123_456_790)
        self.rec.sync()     # the writer thread has them in the file
        st = self.rec.status()
        self.assertTrue(st['on'])
        self.assertEqual((st['pkts'], st['marks']), (2, 1))
        self.assertEqual(st['size'], os.path.getsize(path))
        self.assertTrue(self.rec.stop())
        self.assertFalse(self.rec.status()['on'])
        self.assertEqual(self.rec.status()['path'], path)     # the last recording stays on show
        self.assertEqual(self.rec.status()['size'], st['size'])

        data = Path(path).read_bytes()
        self.assertEqual(len(data), st['size'])
        blks = blocks(data)
        self.assertEqual([b[0] for b in blks], [cd_pcap.BT_SHB, cd_pcap.BT_IDB, cd_pcap.BT_IDB,
                                                cd_pcap.BT_EPB, cd_pcap.BT_EPB, cd_pcap.BT_EPB])
        # section header: byte order magic, version 1.0, unknown section length
        magic, major, minor, length = struct.unpack_from('<IHHq', blks[0][1])
        self.assertEqual((magic, major, minor, length), (0x1a2b3c4d, 1, 0, -1))
        opts = dict(options(blks[0][1][16:]))
        self.assertEqual(opts[cd_pcap.OPT_COMMENT], b'why')
        self.assertEqual(opts[cd_pcap.SHB_USERAPPL], b'cdbus_gui test')
        # interfaces: user link types, nanosecond timestamps, the serial port in the description
        for blk, linktype, name in ((blks[1], 147, b'cdbus'), (blks[2], 148, b'mark')):
            lt, _, snaplen = struct.unpack_from('<HHI', blk[1])
            self.assertEqual(lt, linktype)
            o = dict(options(blk[1][8:]))
            self.assertEqual(o[cd_pcap.IF_NAME], name)
            self.assertEqual(o[cd_pcap.IF_TSRESOL], b'\x09')
        self.assertIn(b'/dev/ttyACM0 @ 115200', dict(options(blks[1][1][8:]))[cd_pcap.IF_DESCRIPTION])
        # the packets: interface, timestamp, the frame with its crc, direction, the mark text
        def epb(blk):
            if_id, ts_hi, ts_lo, cap, orig = struct.unpack_from('<IIIII', blk[1])
            self.assertEqual(cap, orig)
            dat = blk[1][20:20 + cap]
            o = dict(options(blk[1][20 + cap + (-cap % 4):]))
            return if_id, (ts_hi << 32) | ts_lo, dat, o
        if_id, ts, dat, o = epb(blks[3])
        self.assertEqual((if_id, ts, dat), (0, 1_700_000_000_123_456_789, req))
        self.assertEqual(o[cd_pcap.EPB_FLAGS], struct.pack('<I', cd_pcap.FLAG_OUTBOUND))
        self.assertEqual(modbus_crc(dat), 0)
        if_id, ts, dat, o = epb(blks[4])
        self.assertEqual((if_id, dat), (1, b'motor'))
        self.assertEqual(o[cd_pcap.OPT_COMMENT], b'motor')
        self.assertNotIn(cd_pcap.EPB_FLAGS, o)
        if_id, ts, dat, o = epb(blks[5])
        self.assertEqual((if_id, ts, dat), (0, 1_700_000_000_123_456_790, rep))
        self.assertEqual(o[cd_pcap.EPB_FLAGS], struct.pack('<I', cd_pcap.FLAG_INBOUND))

        self.check_with_tshark(path)

    def check_with_tshark(self, path):
        tshark = shutil.which('tshark')
        if not tshark:
            self.skipTest('tshark not installed, the file was only read back by hand')
        cmd = [tshark, '-r', path, '-T', 'fields', '-e', 'frame.number', '-e', 'frame.interface_id',
               '-e', 'frame.time_epoch', '-e', 'frame.comment', '-e', 'frame.len', '-E', 'separator=|']
        out = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
        self.assertEqual(out.returncode, 0, out.stderr)
        rows = [line.split('|') for line in out.stdout.strip().splitlines()]
        self.assertEqual(len(rows), 3, out.stdout)
        self.assertEqual(rows[0], ['1', '0', '1700000000.123456789', '', '7'])
        self.assertEqual(rows[1][:2] + rows[1][3:], ['2', '1', 'motor', '5'])
        self.assertEqual(rows[2], ['3', '0', '1700000000.123456790', '', '16'])

    def test_many_and_odd_sizes(self):
        # every data length pads to 4 bytes, and the file stays readable at any point
        path = self.rec.start()
        for n in range(0, 300, 7):
            self.rec.frame(bytes(range(n % 256)) * (n // 256 + 1), outbound=bool(n & 8))
        self.rec.mark('')
        self.rec.sync()
        st = self.rec.status()
        self.assertEqual(st['size'], os.path.getsize(path))   # unbuffered, on disk as it goes
        blks = blocks(Path(path).read_bytes())
        self.assertEqual(len(blks), 3 + st['pkts'] + st['marks'])
        self.rec.stop()

    def test_stop_drains_the_queue(self):
        # frames and marks are only queued by the caller, in order; stop() writes what is queued
        # before it closes the file, and nothing queued afterwards goes anywhere
        path = self.rec.start()
        for n in range(1000):
            self.rec.frame(with_crc(bytes([n & 0xff, 0, 1, n >> 8])), outbound=bool(n & 1))
            if n % 100 == 0:
                self.rec.mark(f'm{n}')
        self.assertTrue(self.rec.stop())
        self.rec.frame(with_crc(b'\x00\xfe\x02\x40\x01'), outbound=True)
        self.assertEqual((self.rec.status()['pkts'], self.rec.status()['marks']), (1000, 10))
        blks = blocks(Path(path).read_bytes())
        self.assertEqual(len(blks), 3 + 1010)
        ids = [struct.unpack_from('<I', b[1])[0] for b in blks[3:]]
        self.assertEqual(ids[:3], [0, 1, 0])    # m0 right after frame 0: the order is the queue's
        self.assertEqual(ids.count(1), 10)

    def test_ctrl_c_leaves_a_whole_file(self):
        # a KeyboardInterrupt in the main thread ends the process through atexit, where the recorder
        # writes what is still queued and closes the file: every block is there, none torn
        prog = (f'import sys, signal, time\n'
                f'sys.path.insert(0, {str(ROOT)!r}); sys.path.insert(0, {str(ROOT / "pycdnet")!r})\n'
                f'import cd_pcap\n'
                f'rec = cd_pcap.Recorder(rec_dir=sys.argv[1])\n'
                f'print(rec.start())\n'
                f'for n in range(3000): rec.frame(bytes([n & 0xff]) * 60, outbound=False)\n'
                f'rec.mark("bye")\n'
                f'signal.raise_signal(signal.SIGINT)\n'
                f'time.sleep(5)\n')
        out = subprocess.run([sys.executable, '-c', prog, self.td.name], capture_output=True, text=True, timeout=30)
        self.assertNotEqual(out.returncode, 0, out.stdout)
        self.assertIn('KeyboardInterrupt', out.stderr)
        path = out.stdout.strip()
        blks = blocks(Path(path).read_bytes())     # asserts every block whole, front and back
        self.assertEqual(len(blks), 3 + 3000 + 1)
        self.assertEqual(blks[-1][1][20:23], b'bye')


if __name__ == '__main__':
    unittest.main()
