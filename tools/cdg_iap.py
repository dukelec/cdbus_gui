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
  --verify     TYPE # write verify types: read, crc, none (default: read)

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
from cdnet.dev.cdbus_serial import modbus_crc


def compare_dat(a, b):
    if len(a) != len(b):
        return -1
    for i in range(len(a)):
        if a[i] != b[i]:
            return i
    return None


def cdg_iap_init():
    global addr, size, in_file, out_file, flash_only, enter_bl, verify
    addr = int(csa['args'].get("--addr", dft="0x0800c000"), 0)
    size = int(csa['args'].get("--size", dft="0"), 0)
    in_file = csa['args'].get("--in-file")
    out_file = csa['args'].get("--out-file")
    flash_only = csa['args'].get("--flash-only") != None
    enter_bl = csa['args'].get("--enter-bl") != None
    verify = csa['args'].get("--verify", dft="read")

    if not in_file and not out_file and not enter_bl:
        print(__doc__)
        exit(-1)


def _read_flash(addr, _len):
    csa['sock'].sendto(b'\x00' + struct.pack("<IB", addr, _len), (csa['dev_addr'], 8))
    ret, _ = csa['sock'].recvfrom(1)
    print(f'  {addr:08x}: ' + ret.hex() if ret else ret)
    if not ret or (ret[0] & 0xf) != 0 or len(ret[1:]) != _len:
        print('read flash error')
        exit(-1)
    return ret[1:]

def _write_flash(addr, dat, not_reply):
    if not_reply:
        csa['sock'].sendto(b'\xa0' + struct.pack("<I", addr) + dat, (csa['dev_addr'], 8))
    else:
        csa['sock'].sendto(b'\x20' + struct.pack("<I", addr) + dat, (csa['dev_addr'], 8))

def _erase_flash(addr, _len):
    csa['sock'].sendto(b'\x2f' + struct.pack("<II", addr, _len), (csa['dev_addr'], 8))
    ret, _ = csa['sock'].recvfrom(60)
    print('  erase ret: ' + ret.hex() if ret else ret)
    if not ret or (ret[0] & 0xf) != 0:
        print('erase flash error')
        exit(-1)

def _crc_flash(addr, _len):
    csa['sock'].sendto(b'\x10' + struct.pack("<II", addr, _len), (csa['dev_addr'], 8))
    ret, _ = csa['sock'].recvfrom(3)
    print('read crc ret: ' + ret.hex() if ret else ret)
    if not ret or (ret[0] & 0xf) != 0:
        print('read crc error')
        exit(-1)
    crc_val = struct.unpack("<H", ret[1:3])[0]
    return crc_val


def read_flash(addr, _len, blk_size=128):
    cur = addr
    ret = b''
    while True:
        size = min(blk_size, _len-(cur-addr))
        if size == 0:
            break
        ret += _read_flash(cur, size)
        cur += size
    return ret

def write_flash(addr, dat, blk_size=128, group_size=0):
    cur = addr
    pend_ret_max = 2 if group_size else 1
    pend_ret = 0
    group_size = max(group_size, 1)
    while True:
        has_more = cur - addr < len(dat)
        if pend_ret < pend_ret_max and has_more:
            for i in range(group_size):
                if cur - addr >= len(dat):
                    break;
                not_reply = i + 1 < group_size and cur - addr + blk_size < len(dat)
                size = min(blk_size, len(dat)-(cur-addr))
                wdat = dat[cur-addr:cur-addr+size]
                print(f'  i: {i}, reply: {not not_reply}, pend: {pend_ret}, cur: {addr:08x}, size: {size}')
                _write_flash(cur, wdat, not_reply)
                cur += size
            pend_ret += 1
        elif pend_ret:
            ret, _ = csa['sock'].recvfrom(1)
            if ret and (ret[0] & 0xf) == 0:
                pend_ret -= 1
                print(f'  write ret ok, pend: {pend_ret}: ' + ret.hex())
            else:
                print(f'  write ret err, pend: {pend_ret}: ' + ret.hex() if ret else ret)
                exit(-1)
        else:
            print("flash_write completed")
            break
    return 0


def _enter_bl():
    while True:
        info_str = cd_read_info(csa['dev_addr'], timeout=0.1)
        print('waiting (bl) in info string ...')
        print(f'info: {info_str}')
        if '(bl)' in info_str:
            if 'keep_bl' in csa['cfg']['iap']:
                cd_reg_rw(csa['dev_addr'], csa['cfg']['iap']['keep_bl'], write=b'\x01', timeout=0.2)
                print('keeped in bl mode')
            break
        elif info_str != 'error':
            print('do reboot before flash ...')
            try:
                cd_reg_rw(csa['dev_addr'], csa['cfg']['iap']['reboot'], write=b'\x01', timeout=0.2, retry=1)
            except Exception as err:
                pass


if __name__ == "__main__":
    cdg_cmd_init(__doc__)
    cdg_iap_init()

    blk_size = 128
    batch_pkts = 0
    if 'batch_pkts' in csa['cfg']['iap']:
        batch_pkts = csa['cfg']['iap']['batch_pkts']
    if 'blk_size' in csa['cfg']['iap']:
        blk_size = csa['cfg']['iap']['blk_size']
    print(f'iap: blk_size: {blk_size}, batch_pkts: {batch_pkts}')

    if enter_bl:
        _enter_bl()

    elif out_file:
        print('read %d bytes @%08x to file' % (size, addr), out_file)
        ret = read_flash(addr, size, blk_size)
        with open(out_file, 'wb') as f:
            f.write(ret)

    elif in_file:
        if not flash_only:
            _enter_bl()

        if in_file.lower().endswith('.bin'):
            with open(in_file, 'rb') as f:
                dat = f.read()
            print('write %d bytes @%08x from file' % (len(dat), addr), in_file)
            _erase_flash(addr, len(dat))
            write_flash(addr, dat, blk_size, batch_pkts)
            if verify == 'read':
                rdat = read_flash(addr, len(dat), blk_size)
                ret = compare_dat(dat, rdat)
                if ret != None:
                    if ret < 0:
                        print(f'rdat != wdat, {ret}')
                    else:
                        print(f'rdat != wdat, @{ret:08x} (w: {dat[ret]:02x}, r: {rdat[ret]:02x}')
                    exit(-1)
                print('succeeded with read back check')
            elif verify == 'crc':
                crc = modbus_crc(dat)
                rcrc = _crc_flash(addr, len(dat))
                if crc == rcrc:
                    print('succeeded with crc check')
                else:
                    print(f'crc err: {rcrc:04x} != {crc:04x}')
            else:
                print('succeeded without check')

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
                print(f'flash_erase... addr: {dat[i][0]:08x}, len: {len(dat[i][1])}')
                _erase_flash(dat[i][0], len(dat[i][1]))

            for i in range(len(dat)):
                print(f'write {len(dat[i][1])} bytes @{dat[i][0]:08x} from file', in_file)
                write_flash(dat[i][0], dat[i][1], blk_size, batch_pkts)

            for i in range(len(dat)):
                if verify == 'read':
                    rdat = read_flash(dat[i][0], len(dat[i][1]), blk_size)
                    ret = compare_dat(dat[i][1], rdat)
                    if ret != None:
                        if ret < 0:
                            print(f'seg {i}: rdat != wdat, {ret}')
                        else:
                            print(f'seg {i}: rdat != wdat, @{ret:08x} (w: {dat[ret]:02x}, r: {rdat[ret]:02x}')
                        exit(-1)
                    print(f'seg {i}: succeeded with read back check')
                elif verify == 'crc':
                    crc = modbus_crc(dat[i][1])
                    rcrc = _crc_flash(dat[i][0], len(dat[i][1]))
                    if crc == rcrc:
                        print(f'seg {i}: succeeded with crc check')
                    else:
                        print(f'seg {i}: crc err: {rcrc:04x} != {crc:04x}')
                else:
                    print(f'seg {i}: succeeded without check')

        else:
            print('only supports .hex and .bin file')


        if not flash_only:
            print('do reboot after flash ...')
            try:
                cd_reg_rw(csa['dev_addr'], csa['cfg']['iap']['reboot'], write=b'\x02', timeout=0.2, retry=1)
            except Exception as err:
                pass
        print('flash succeed.')

