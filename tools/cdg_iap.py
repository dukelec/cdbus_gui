#!/usr/bin/env python3
#
# Software License Agreement (MIT License)
#
# Author: Duke Fong <d@d-l.io>

"""CDBUS IAP Tool

Args:
  --in-file    FILE # write FILE to mcu (.hex or .bin format)
  --out-file   FILE # read FILE from mcu (.bin only)
  --addr       ADDR # mcu ram address (only for .bin file)
  --size       SIZE # only needed when read from mcu
  --flash-only      # do not reboot
  --enter-bl        # enter bootloader only

Examples:

write fw:
  ./cdg_iap.py --cfg CFG_FILE --in-file fw.hex
  ./cdg_iap.py --cfg CFG_FILE --in-file fw.bin --addr=0x0800c000

read fw:
  ./cdg_iap.py --cfg CFG_FILE --out-file fw.bin --addr=0x0800c000 --size=xxx

More args refers to:
"""

import sys, os
import struct
import re
from time import sleep
from intelhex import IntelHex
from cdg_cmd import *

sub_size = 128


def cdg_iap_init():
    global addr, size, in_file, out_file, flash_only, enter_bl
    addr = int(csa['args'].get("--addr", dft="0x0800c000"), 0)
    size = int(csa['args'].get("--size", dft="0"), 0)
    in_file = csa['args'].get("--in-file")
    out_file = csa['args'].get("--out-file")
    flash_only = csa['args'].get("--flash-only") != None
    enter_bl = csa['args'].get("--enter-bl") != None

    if not in_file and not out_file and not enter_bl:
        print(__doc__)
        exit(-1)


def _read_flash(addr, _len):
    csa['sock'].sendto(b'\x00' + struct.pack("<IB", addr, _len), (csa['dev_addr'], 8))
    ret, _ = csa['sock'].recvfrom()
    print(('  %08x: ' % addr) + ret.hex())
    if ret[0] != 0x80 or len(ret[1:]) != _len:
        print('read flash error')
        exit(-1)
    return ret[1:]

def _write_flash(addr, dat):
    print(('  %08x: ' % addr) + dat.hex())
    csa['sock'].sendto(b'\x20' + struct.pack("<I", addr) + dat, (csa['dev_addr'], 8))
    ret, _ = csa['sock'].recvfrom()
    print('  write ret: ' + ret.hex())
    if ret != b'\x80':
        print('write flash error')
        exit(-1)

def _erase_flash(addr, _len):
    csa['sock'].sendto(b'\x2f' + struct.pack("<II", addr, _len), (csa['dev_addr'], 8))
    ret, _ = csa['sock'].recvfrom()
    print('  erase ret: ' + ret.hex())
    if ret != b'\x80':
        print('erase flash error')
        exit(-1)


def read_flash(addr, _len):
    cur = addr
    ret = b''
    while True:
        size = min(sub_size, _len-(cur-addr))
        if size == 0:
            break
        ret += _read_flash(cur, size)
        cur += size
    return ret

def write_flash(addr, dat):
    cur = addr
    ret = b''
    _erase_flash(addr, len(dat))
    while True:
        size = min(sub_size, len(dat)-(cur-addr))
        if size == 0:
            break
        wdat = dat[cur-addr:cur-addr+size]
        _write_flash(cur, wdat)
        rdat = _read_flash(cur, len(wdat))
        if rdat != wdat:
            print(f'rdat != wdat, @{cur:08x}')
            exit(-1)
        cur += size

def _enter_bl():
    while True:
        info_str = cd_read_info(csa['dev_addr'], timeout=0.2)
        print('waiting (bl) in info string ...')
        print(f'info: {info_str}')
        if '(bl)' in info_str:
            cd_reg_rw(csa['dev_addr'], csa['cfg']['iap']['keep_bl'], write=b'\x01')
            print('keeped in bl mode')
            break
        elif info_str != 'error':
            print('do reboot before flash ...')
            try:
                cd_reg_rw(csa['dev_addr'], csa['cfg']['iap']['reboot'], write=b'\x01', timeout=0.3, retry=1)
            except Exception as err:
                pass
        sleep(0.2)


if __name__ == "__main__":
    cdg_cmd_init(__doc__)
    cdg_iap_init()

    if enter_bl:
        _enter_bl()

    elif out_file:
        print('read %d bytes @%08x to file' % (size, addr), out_file)
        ret = read_flash(addr, size)
        with open(out_file, 'wb') as f:
            f.write(ret)

    elif in_file:
        if not flash_only:
            _enter_bl()

        if in_file.lower().endswith('.bin'):
            with open(in_file, 'rb') as f:
                dat = f.read()
            print('write %d bytes @%08x from file' % (len(dat), addr), in_file)
            write_flash(addr, dat)

        elif in_file.lower().endswith('.hex'):
            dat = []
            ih = IntelHex()
            try:
                ih.loadhex(in_file)
                segs = ih.segments()
                csa['logger'].info(f'parse ihex file, segments: {[list(map(hex, l)) for l in segs]} (end addr inclusive)')
                for seg in segs:
                    s = [seg[0], ih.tobinstr(seg[0], size=seg[1]-seg[0])]
                    dat.append(s)
            except Exception as err:
                csa['logger'].error(f'parse ihex file error: {err}')
                exit(-1)

            for i in range(len(dat)):
                print(f'write {len(dat[i][1])} bytes @{dat[i][0]:08x} from file', in_file)
                write_flash(dat[i][0], dat[i][1])

        else:
            print('only supports .hex and .bin file')

        if not flash_only:
            print('do reboot after flash ...')
            try:
                cd_reg_rw(csa['dev_addr'], csa['cfg']['iap']['reboot'], write=b'\x01', timeout=0.3, retry=1)
            except Exception as err:
                pass
        print('flash succeed.')

