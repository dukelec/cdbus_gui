"""Run with: python3 -m unittest discover -s tests -v

main_udp.py records cdbus frames it rebuilds from its udp packets: the frame must be what the
serial backend would have seen on the bus, so a recording reads the same whichever made it.
The functions are lifted out of main_udp.py, which parses arguments and opens sockets on import.
"""
import ast
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / 'pycdnet'))

from cdnet.parser import cdnet_l0, cdnet_l1
from cdnet.utils.crc import modbus_crc


def lift(names, csa):
    tree = ast.parse((ROOT / 'main_udp.py').read_text())
    body = [n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name in names]
    ns = {'cdnet_l0': cdnet_l0, 'cdnet_l1': cdnet_l1, 'modbus_crc': modbus_crc, 'csa': csa}
    exec(compile(ast.Module(body=body, type_ignores=[]), 'main_udp.py', 'exec'), ns)
    return ns


class UdpRecordTests(unittest.TestCase):
    def setUp(self):
        self.csa = {'net': 0x00, 'mac': 0x03}
        ns = lift(['rec_frame', 'own_addr'], self.csa)
        self.rec_frame, self.own_addr = ns['rec_frame'], ns['own_addr']

    def test_own_addr_follows_the_level(self):
        self.assertEqual(self.own_addr('00:00:fe'), '00:00:03')
        self.assertEqual(self.own_addr('80:00:fe'), '80:00:03')
        self.assertEqual(self.own_addr('a0:05:fe'), 'a0:00:03')
        self.assertEqual(self.own_addr('90:00:ff'), '80:00:03')    # a multicast we send

    def test_frames_parse_back(self):
        cases = [
            (('00:00:fe', 0x09), ('00:00:03', 0x09), b'hi\n'),             # level 0 report from a device
            (('80:00:03', 0x40), ('80:00:fe', 0x05), b'\x00\x10\x00\x04'), # our level 1 request
            (('80:00:fe', 0x05), ('80:00:03', 0x40), b'\x80\x01\x02'),     # its answer
            (('a0:05:fe', 0x1234), ('a0:00:03', 0x40), b'x'),              # from another net, 16 bit port
            (('80:00:03', 0x40), ('90:00:ff', 0x09), b''),                 # our local multicast
            (('a0:00:03', 0x40), ('b0:00:ff', 0x09), b'y'),                # our cross net multicast
        ]
        for src, dst, dat in cases:
            with self.subTest(src=src, dst=dst):
                f = self.rec_frame(src, dst, dat)
                self.assertEqual(modbus_crc(f), 0)                 # the crc is there and right
                self.assertEqual(len(f), f[2] + 5)
                self.assertEqual((f[0], f[1]), (int(src[0][-2:], 16), int(dst[0][-2:], 16)))
                frame = f[:-2]
                parsed = (cdnet_l1 if frame[3] & 0x80 else cdnet_l0).from_frame(frame, self.csa['net'])
                self.assertEqual(parsed, (src, dst, dat))

    def test_what_no_frame_can_hold(self):
        with self.assertRaises(AssertionError):
            self.rec_frame(('00:00:fe', 0x1234), ('00:00:03', 9), b'')     # a level 0 port is 7 bits
        with self.assertRaises(AssertionError):
            self.rec_frame(('80:00:03', 0x40), ('80:00:fe', 0x05), bytes(260))


if __name__ == '__main__':
    unittest.main()
