#!/usr/bin/env python3
#
# Software License Agreement (MIT License)
#
# Author: Duke Fong <d@d-l.io>

"""CMD Tool for CDBUS GUI

Args:
  --help    | -h    # this help message
  --verbose | -v    # debug level: verbose
  --debug   | -d    # debug level: debug

  --cfg   CFG_FILE  # always required

  --tty   PORT      # default: ttyACM0
  --baud  BAUD      # default: 115200
  --local LOCAL_MAC # default: 0
  --dev   TARGET    # default: 80:00:fe

  --quiet   | -q
  --pretend | -p

  --reg REG_NAME    # read reg if not specify val
  --val REG_VAL

  --export MPK_FILE # only print when file path empty
  --import MPK_FILE
"""

import os, sys, _thread
import json5
import pprint
import umsgpack
from cdg_helper import *

sys.path.append(os.path.join(os.path.dirname(__file__), '..', 'pycdnet'))

from cdnet.utils.log import *
from cdnet.utils.cd_args import CdArgs
from cdnet.dev.cdbus_serial import CDBusSerial
from cdnet.dispatch import *


csa = {
    'args': None,
    
    'dev_addr': None,
    'quiet': False,
    'pretend': False,

    'logger': None,
    'sock': None,
    
    'cfg': None,

    # reg_name(.n) : {
    #   fmt:
    #   show:
    #   addr:
    #   len:
    #   desc: '...'
    # }
    'regs': {}
}


def cdg_cmd_init(doc=None):
    global reg_name, reg_val, export_file, import_file, sock_dbg

    args = CdArgs()
    csa['args'] = args
    tty_str = args.get("--tty", dft="ttyACM0")
    baud = int(args.get("--baud", dft="115200"), 0)
    local_mac = int(args.get("--local", dft="0x00"), 0)
    csa['dev_addr'] = args.get("--dev", dft="80:00:fe")
    cfg_file = args.get("--cfg")

    csa['quiet'] = args.get("--quiet", "-q") != None
    csa['pretend'] = args.get("--pretend", "-p") != None

    reg_name = args.get("--reg")
    reg_val = args.get("--val")         # string value
    export_file = args.get("--export")  # mpk file
    import_file = args.get("--import")

    if args.get("--help", "-h") != None or cfg_file == None:
        print(f'{doc}\n{__doc__}' if doc else __doc__)
        exit(-1 if cfg_file == None else 0)

    if args.get("--verbose", "-v") != None:
        logger_init(logging.VERBOSE)
    elif args.get("--debug", "-d") != None:
        logger_init(logging.DEBUG)
    else:
        logger_init(logging.INFO)

    csa['logger'] = logging.getLogger(f'cdgui_cmd')

    dev = CDBusSerial(tty_str, baud=baud)

    CDNetIntf(dev, mac=local_mac)
    csa['sock'] = CDNetSocket(('', 0xcdcd))
    sock_dbg = CDNetSocket(('', 9))

    with open(cfg_file) as f:
        csa['cfg'] = json5.load(f)
    _thread.start_new_thread(dbg_echo, ())
    list_all_reg()

    if not csa['quiet']:
        print('Device Info:', cd_read_info(csa['dev_addr']))


def dbg_echo():
    while True:
        rx = sock_dbg.recvfrom()
        if not csa['quiet']:
            csa['logger'].info(f'#{rx[1][0][-2:]}  \x1b[0;37m' + rx[0][1:-1].decode() + '\x1b[0m')


# for unicast only
def cd_reg_rw(dev_addr, reg_addr, write=None, read=0, timeout=0.8, retry=3):
    if write != None:
        tx_dat = b'\x20'+struct.pack("<H", reg_addr) + write
    else:
        tx_dat = b'\x00'+struct.pack("<H", reg_addr) + struct.pack("<B", read)
    for cnt in range(retry):
        csa['sock'].clear()
        csa['sock'].sendto(tx_dat, (dev_addr, 0x5))
        dat, src = csa['sock'].recvfrom(timeout=timeout)
        if src:
            if src[0] == dev_addr and src[1] == 0x5:
                return dat
            if not csa['quiet']:
                csa['logger'].warning(f'cd_reg_rw recv wrong src')
        elif not csa['quiet']:
            csa['logger'].warning(f'cd_reg_rw timeout, dev: {dev_addr}')
    raise Exception('reg_rw retry error')
    #return None


def cd_read_info(dev_addr, timeout=0.8):
    csa['sock'].clear()
    csa['sock'].sendto(b'\x00', (dev_addr, 0x1))
    dat, src = csa['sock'].recvfrom(timeout=timeout)
    if src:
        return dat[1:]
    raise Exception('read info error')



def list_all_reg():
    for i in range(len(csa['cfg']['reg'])):
        r = csa['cfg']['reg'][i]
        #print(r)
        fmt = r[2]
        show = r[3]
        top_name = r[4]
        top_addr = r[0]
        top_len = r[1]
        top_desc = r[4]
        fmt_len = fmt_size(fmt)
        if top_len == fmt_len or fmt.startswith('['):
            #print(top_name)
            csa['regs'][top_name] = {
                'fmt': fmt,
                'show': show,
                'addr': top_addr,
                'len': top_len,
                'desc': top_desc
            }
        elif fmt.startswith('{'):
            num = int(top_len / fmt_len)
            for n in range(num):
                #print(top_name, n)
                csa['regs'][f'{top_name}.{n}'] = {
                    'fmt': fmt,
                    'show': show,
                    'addr': top_addr + fmt_len * n,
                    'len': fmt_len,
                    'desc': top_desc if n == 0 else None
                }
        else:
            raise Exception('fmt error')



def get_reg_info(name):
    for i in range(len(csa['cfg']['reg'])):
        r = csa['cfg']['reg'][i]
        if r[4] == name:
            return r
    return None


def get_rw_grp(name, rw='r'):
    if name not in csa['regs']:
        return None
    grps = csa['cfg'][f'reg_{rw}']
    addr_len_list = []
    for i in range(len(grps)):
        g = grps[i]
        assert(len(g) == 1 or len(g) == 2)
        if len(g) == 2:
            r0 = get_reg_info(g[0])
            r1 = get_reg_info(g[1])
            addr_len_list.append([r0[0], r1[0] + r1[1] - r0[0]])
        elif len(g) == 1:
            r0 = get_reg_info(g[0])
            addr_len_list.append([r0[0], r0[1]])
    for i in range(len(addr_len_list)):
        if csa['regs'][name]['addr'] >= addr_len_list[i][0] and \
           csa['regs'][name]['addr'] < addr_len_list[i][0] + addr_len_list[i][1]:
            return addr_len_list[i]
    return None


def read_reg(name):
    reg = csa['regs'][name]
    grp = get_rw_grp(name, 'r')
    if not grp or not reg:
        if not csa['quiet']:
            print(f'reg: {name} read disabled')
        exit(-1)
    dat = cd_reg_rw(csa['dev_addr'], grp[0], read=grp[1])
    if reg['fmt'].startswith('['):
        ret = []
        join = '' if reg['fmt'][1] == 'c' and reg['show'] == 0 else ' '
        fmt_len = fmt_size(reg['fmt'])
        for i in range(round(reg['len']/fmt_len)):
            ret.append(reg2str(dat[1:], reg['addr'] - grp[0] + fmt_len * i, reg['fmt'], reg['show']))
        return join.join(ret)
    return reg2str(dat[1:], reg['addr'] - grp[0], reg['fmt'], reg['show'])


def write_reg(name, str_):
    reg = csa['regs'][name]
    grp = get_rw_grp(name, 'w')
    if not grp or not reg:
        if not csa['quiet']:
            print(f'reg: {name} write disabled')
        exit(-1)
    dat = cd_reg_rw(csa['dev_addr'], grp[0], read=grp[1])
    dat = dat[1:]
    if reg['fmt'].startswith('['):
        ret = []
        fmt_len = fmt_size(reg['fmt'])
        for i in range(round(reg['len']/fmt_len)):
            dat = str2reg(dat, reg['addr'] - grp[0] + fmt_len * i, reg['fmt'], reg['show'], str_, i)
    else:
        dat = str2reg(dat, reg['addr'] - grp[0], reg['fmt'], reg['show'], str_, 0)
    cd_reg_rw(csa['dev_addr'], grp[0], write=dat)



if __name__ == "__main__":
    cdg_cmd_init()

    if reg_name != None:
        if reg_val == None:
            print(read_reg(reg_name))
        elif not csa['pretend']:
            write_reg(reg_name, reg_val)

    elif export_file != None:
        reg_str = {}
        for name in csa['regs']:
            if get_rw_grp(name, 'r') != None:
                reg_str[name] = read_reg(name)
        if not csa['quiet']:
            pprint.pp(reg_str)
        out_data = umsgpack.packb({'version': 'cdgui v0', 'reg_str': reg_str})
        if export_file:
            with open(export_file, 'wb') as f:
                f.write(out_data)

    elif import_file != None:
        with open(import_file, 'rb') as f:
            in_file = f.read()
        in_data = umsgpack.unpackb(in_file)
        for name in in_data['reg_str']:
            val = in_data['reg_str'][name]
            if not csa['quiet']:
                print(f'  {name}: {val}')
            if get_rw_grp(name, 'w') != None:
                if get_rw_grp(name, 'r') != None:
                    ori = read_reg(name)
                    if ori != val:
                        if not csa['quiet']:
                            print(f'    + write: {ori} -> {val}')
                        if not csa['pretend']:
                            write_reg(name, val)
                else:
                    if not csa['quiet']:
                        print(f'    + write only: {val}')
                    if not csa['pretend']:
                        write_reg(name, val)
            else:
                if get_rw_grp(name, 'r') != None:
                    ori = read_reg(name)
                    if ori != val and not csa['quiet']:
                        print(f'    - write disabled: current: {ori}')
                elif not csa['quiet']:
                    print(f'    - write & read disabled')

