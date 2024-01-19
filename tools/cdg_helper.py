#!/usr/bin/env python3
#
# Software License Agreement (MIT License)
#
# Author: Duke Fong <d@d-l.io>

import re, struct, math


def readable_float(num, double=False):
    if not math.isfinite(num):
        return str(num)
    fixed = 12
    if not double:
        num = float(f"{num:.7g}")  # for 32-bit float
    n = f"{num:.{fixed}f}"
    if 'e' in n:
        return n
    for _ in range(fixed // 3):
        if n.endswith('000'):
            n = n[:-3]
        else:
            break
    if n.endswith('.'):
        n += '0'
    return n


def dat2hex(dat, join='', le=False):
    dat = reversed(dat) if le else dat
    return join.join([f'{x:02x}' for x in dat])

def hex2dat(hex_, le=False):
    hex_ = hex_.replace('0x', '').replace(' ','')
    ret = bytes.fromhex(hex_)
    return bytes(reversed(ret)) if le else ret


def val2hex(val, fixed=4, prefix=False, upper=False, float_=False):
    sign = '-' if val < 0 else ''
    val = abs(val)
    int_ = int(val)
    if isinstance(val, float):
        float_ = True
    sub_ = val - int_ if float_ else 0.0
    int_str = f'{int(int_):x}'
    int_str = (fixed - len(int_str)) * '0' + int_str
    sub_str = ''
    for i in range(16):
        y = int(sub_ * 16)
        sub_str += f'{y:x}'
        sub_ = sub_ * 16 - y
    if float_:
        str_ = f'{int_str}.{sub_str}'
        str_ = str_.rstrip('0')
        if str_.endswith('.'):
            str_ += '0'
    else:
        str_ = f'{int_str}'
    if upper:
        str_ = str_.upper()
    if prefix:
        str_ = '0x' + str_
    return sign + str_


def fmt_size(fmt):
    f = re.sub('[\W_]', '', fmt) # remove non-alphanumeric chars
    len_ = 0;
    for i in range(len(f)):
        if f[i] == 'c':
            len_ += 1
        elif f[i] == 'b' or f[i] == 'B':
            len_ += 1
        elif f[i] == 'h' or f[i] == 'H':
            len_ += 2
        elif f[i] == 'i' or f[i] == 'I':
            len_ += 4
        elif f[i] == 'f':
            len_ += 4
    return len_;


def reg2str(dat, ofs, fmt, show):
    ret = ''
    f = re.sub('[\W_]', '', fmt) # remove non-alphanumeric chars
    for i in range(len(f)):
        if f[i] == 'c':
            if show == 1:
                ret = ' '.join(filter(None, [ret, f"{val2hex(struct.unpack('<b', dat[ofs:ofs+1])[0], 2, True)}"]))
            elif show == 2:
                ret = ' '.join(filter(None, [ret, f"{dat2hex(dat[ofs:ofs+1], ' ')}"]))
            else:
                d = dat[ofs]
                if d != 0:
                    ret = ' '.join(filter(None, [ret, f"{chr(d)}"]))
            ofs += 1
        elif f[i] == 'b':
            if show == 1:
                ret = ' '.join(filter(None, [ret, f"{val2hex(struct.unpack('<b', dat[ofs:ofs+1])[0], 2, True)}"]))
            elif show == 2:
                ret = ' '.join(filter(None, [ret, f"{dat2hex(dat[ofs:ofs+1], ' ')}"]))
            else:
                ret = ' '.join(filter(None, [ret, f"{struct.unpack('<b', dat[ofs:ofs+1])[0]}"]))
            ofs += 1
        elif f[i] == 'B':
            if show == 1:
                ret = ' '.join(filter(None, [ret, f"{val2hex(struct.unpack('<B', dat[ofs:ofs+1])[0], 2, True)}"]))
            elif show == 2:
                ret = ' '.join(filter(None, [ret, f"{dat2hex(dat[ofs:ofs+1], ' ')}"]))
            else:
                ret = ' '.join(filter(None, [ret, f"{struct.unpack('<B', dat[ofs:ofs+1])[0]}"]))
            ofs += 1
        elif f[i] == 'h':
            if show == 1:
                ret = ' '.join(filter(None, [ret, f"{val2hex(struct.unpack('<h', dat[ofs:ofs+2])[0], 4, True)}"]))
            elif show == 2:
                ret = ' '.join(filter(None, [ret, f"{dat2hex(dat[ofs:ofs+2], ' ')}"]))
            else:
                ret = ' '.join(filter(None, [ret, f"{struct.unpack('<h', dat[ofs:ofs+2])[0]}"]))
            ofs += 2
        elif f[i] == 'H':
            if show == 1:
                ret = ' '.join(filter(None, [ret, f"{val2hex(struct.unpack('<H', dat[ofs:ofs+2])[0], 4, True)}"]))
            elif show == 2:
                ret = ' '.join(filter(None, [ret, f"{dat2hex(dat[ofs:ofs+2], ' ')}"]))
            else:
                ret = ' '.join(filter(None, [ret, f"{struct.unpack('<H', dat[ofs:ofs+2])[0]}"]))
            ofs += 2
        elif f[i] == 'i':
            if show == 1:
                ret = ' '.join(filter(None, [ret, f"{val2hex(struct.unpack('<i', dat[ofs:ofs+4])[0], 8, True)}"]))
            elif show == 2:
                ret = ' '.join(filter(None, [ret, f"{dat2hex(dat[ofs:ofs+4], ' ')}"]))
            else:
                ret = ' '.join(filter(None, [ret, f"{struct.unpack('<i', dat[ofs:ofs+4])[0]}"]))
            ofs += 4
        elif f[i] == 'I':
            if show == 1:
                ret = ' '.join(filter(None, [ret, f"{val2hex(struct.unpack('<I', dat[ofs:ofs+4])[0], 8, True)}"]))
            elif show == 2:
                ret = ' '.join(filter(None, [ret, f"{dat2hex(dat[ofs:ofs+4], ' ')}"]))
            else:
                ret = ' '.join(filter(None, [ret, f"{struct.unpack('<I', dat[ofs:ofs+4])[0]}"]))
            ofs += 4
        elif f[i] == 'f':
            if show == 1:
                ret = ' '.join(filter(None, [ret, f"{val2hex(struct.unpack('<f', dat[ofs:ofs+4])[0], 8, True, False, True)}"]))
            elif show == 2:
                ret = ' '.join(filter(None, [ret, f"{dat2hex(dat[ofs:ofs+4], ' ')}"]))
            else:
                ret = ' '.join(filter(None, [ret, f"{readable_float(struct.unpack('<f', dat[ofs:ofs+4])[0])}"]))
            ofs += 4
    return ret


def str2reg(dat, ofs, fmt, show, str_, s_idx):
    dat = bytearray(dat)
    f = re.sub('[\W_]', '', fmt) # remove non-alphanumeric chars
    str_a = str_.split(' ')
    for i in range(len(f)):
        if f[i] == 'c':
            if show == 1:
                dat[ofs:ofs+1] = struct.pack('<b', int(str_a[s_idx], 0))
            elif show == 2:
                dat[ofs:ofs+1] = hex2dat(str_a[s_idx])[0:1]
            else:
                dat[ofs:ofs+1] = bytes([ord(str_[s_idx])]) if s_idx < len(str_) else b'\x00'
            ofs += 1
        elif f[i] == 'b':
            if show == 2:
                dat[ofs:ofs+1] = hex2dat(str_a[s_idx])[0:1]
            else:
                dat[ofs:ofs+1] = struct.pack('<b', int(str_a[s_idx], 0))
            ofs += 1
        elif f[i] == 'B':
            if show == 2:
                dat[ofs:ofs+1] = hex2dat(str_a[s_idx])[0:1]
            else:
                dat[ofs:ofs+1] = struct.pack('<B', int(str_a[s_idx], 0))
            ofs += 1
        elif f[i] == 'h':
            if show == 2:
                dat[ofs:ofs+2] = hex2dat(str_a[s_idx])[0:2]
            else:
                dat[ofs:ofs+2] = struct.pack('<h', int(str_a[s_idx], 0))
            ofs += 2
        elif f[i] == 'H':
            if show == 2:
                dat[ofs:ofs+2] = hex2dat(str_a[s_idx])[0:2]
            else:
                dat[ofs:ofs+2] = struct.pack('<H', int(str_a[s_idx], 0))
            ofs += 2
        elif f[i] == 'i':
            if show == 2:
                dat[ofs:ofs+4] = hex2dat(str_a[s_idx])[0:4]
            else:
                dat[ofs:ofs+4] = struct.pack('<i', int(str_a[s_idx], 0))
            ofs += 4
        elif f[i] == 'I':
            if show == 2:
                dat[ofs:ofs+4] = hex2dat(str_a[s_idx])[0:4]
            else:
                dat[ofs:ofs+4] = struct.pack('<I', int(str_a[s_idx], 0))
            ofs += 4
        elif f[i] == 'f':
            if show == 1:
                parts = str_a[s_idx].split(".")
                if len(parts) > 1:
                    sign = -1 if val < 0 else 1
                    val = int(parts[0], 16) + int(parts[1], 16) / pow(16, len(parts[1])) * sign
                else:
                    val = int(parts[0], 16)
                dat[ofs:ofs+4] = struct.pack('<f', val)
            elif show == 2:
                dat[ofs:ofs+4] = hex2dat(str_a[s_idx])[0:4]
            else:
                dat[ofs:ofs+4] = struct.pack('<f', float(str_a[s_idx]))
            ofs += 4

        s_idx += 1
    return bytes(dat)

