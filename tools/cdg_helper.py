#!/usr/bin/env python3
#
# Software License Agreement (MIT License)
#
# Author: Duke Fong <d@d-l.io>

import re, struct, math


def readable_float(num, double=False):
    if not math.isfinite(num):
        return str(num)
    fixed = 18 if double else 9
    precision = 16 if double else 7
    n = f"{num:.{precision}g}"
    if 'e' in n:
        return n
    parts = n.split('.')
    int_part = parts[0]
    dec_part = parts[1] if len(parts) > 1 else '0'
    
    dec_part = dec_part.ljust(fixed, '0')
    n = f"{int_part}.{dec_part}"
    
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

def hex2float(hex_):
    parts = hex_.split('.')
    if len(parts) > 1:
        sign = -1 if hex_.startswith('-') else 1
        val = int(parts[0], 16) + int(parts[1], 16) / pow(16, len(parts[1])) * sign
    else:
        val = int(parts[0], 16)
    return val

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
    f = re.sub(r'[\W_]', '', fmt) # remove non-word chars
    len_ = 0;
    i = 0
    while i < len(f):
        fnext = f[i+1] if i < len(f) - 1 else ''
        if fnext.isdigit(): # e.g. '{H,B2}'
            len_ += int(fnext)
            i += 2
            continue
        if f[i] == 'c' or f[i] == 'b' or f[i] == 'B':
            len_ += 1
        elif f[i] == 'h' or f[i] == 'H':
            len_ += 2
        elif f[i] == 'i' or f[i] == 'I' or f[i] == 'f':
            len_ += 4
        elif f[i] == 'q' or f[i] == 'Q' or f[i] == 'd':
            len_ += 8
        i += 1
    return len_;


def reg2str(dat, ofs, fmt, show):
    ret = ''
    f = re.sub(r'[\W_]', '', fmt) # remove non-word chars
    i = 0
    while i < len(f):
        fnext = f[i+1] if i < len(f) - 1 else ''
        if f[i] == 'c':
            c_len = 1
            if show == 1:
                ret = ' '.join(filter(None, [ret, f"{val2hex(struct.unpack('<b', dat[ofs:ofs+1])[0], 2, True)}"]))
            else:
                c_hdr = dat[ofs];
                if (c_hdr & 0b11100000) == 0b11000000:
                    c_len = 2 # 110xxxxx
                elif (c_hdr & 0b11110000) == 0b11100000:
                    c_len = 3 # 1110xxxx
                elif (c_hdr & 0b11111000) == 0b11110000:
                    c_len = 4 # 11110xxx
                d = dat[ofs:ofs+c_len]
                if len(d) and d[0] != 0:
                    ret = ' '.join(filter(None, [ret, f"{d.decode()}"]))
            ofs += int(fnext) if fnext.isdigit() else c_len
        elif f[i] == 'b':
            if show == 1:
                ret = ' '.join(filter(None, [ret, f"{val2hex(struct.unpack('<b', dat[ofs:ofs+1])[0], 2, True)}"]))
            else:
                ret = ' '.join(filter(None, [ret, f"{struct.unpack('<b', dat[ofs:ofs+1])[0]}"]))
            ofs += int(fnext) if fnext.isdigit() else 1
        elif f[i] == 'B':
            if show == 1:
                ret = ' '.join(filter(None, [ret, f"{val2hex(struct.unpack('<B', dat[ofs:ofs+1])[0], 2, True)}"]))
            elif show == 2:
                ret = ' '.join(filter(None, [ret, f"{dat2hex(dat[ofs:ofs+1], ' ')}"]))
            else:
                ret = ' '.join(filter(None, [ret, f"{struct.unpack('<B', dat[ofs:ofs+1])[0]}"]))
            ofs += int(fnext) if fnext.isdigit() else 1
        elif f[i] == 'h':
            if show == 1:
                ret = ' '.join(filter(None, [ret, f"{val2hex(struct.unpack('<h', dat[ofs:ofs+2])[0], 4, True)}"]))
            else:
                ret = ' '.join(filter(None, [ret, f"{struct.unpack('<h', dat[ofs:ofs+2])[0]}"]))
            ofs += int(fnext) if fnext.isdigit() else 2
        elif f[i] == 'H':
            if show == 1:
                ret = ' '.join(filter(None, [ret, f"{val2hex(struct.unpack('<H', dat[ofs:ofs+2])[0], 4, True)}"]))
            else:
                ret = ' '.join(filter(None, [ret, f"{struct.unpack('<H', dat[ofs:ofs+2])[0]}"]))
            ofs += int(fnext) if fnext.isdigit() else 2
        elif f[i] == 'i':
            if show == 1:
                ret = ' '.join(filter(None, [ret, f"{val2hex(struct.unpack('<i', dat[ofs:ofs+4])[0], 8, True)}"]))
            else:
                ret = ' '.join(filter(None, [ret, f"{struct.unpack('<i', dat[ofs:ofs+4])[0]}"]))
            ofs += int(fnext) if fnext.isdigit() else 4
        elif f[i] == 'I':
            if show == 1:
                ret = ' '.join(filter(None, [ret, f"{val2hex(struct.unpack('<I', dat[ofs:ofs+4])[0], 8, True)}"]))
            else:
                ret = ' '.join(filter(None, [ret, f"{struct.unpack('<I', dat[ofs:ofs+4])[0]}"]))
            ofs += int(fnext) if fnext.isdigit() else 4
        elif f[i] == 'q':
            if show == 1:
                ret = ' '.join(filter(None, [ret, f"{val2hex(struct.unpack('<q', dat[ofs:ofs+8])[0], 16, True)}"]))
            else:
                ret = ' '.join(filter(None, [ret, f"{struct.unpack('<q', dat[ofs:ofs+8])[0]}"]))
            ofs += int(fnext) if fnext.isdigit() else 8
        elif f[i] == 'Q':
            if show == 1:
                ret = ' '.join(filter(None, [ret, f"{val2hex(struct.unpack('<Q', dat[ofs:ofs+8])[0], 16, True)}"]))
            else:
                ret = ' '.join(filter(None, [ret, f"{struct.unpack('<Q', dat[ofs:ofs+8])[0]}"]))
            ofs += int(fnext) if fnext.isdigit() else 8
        elif f[i] == 'f':
            if show == 1:
                ret = ' '.join(filter(None, [ret, f"{val2hex(struct.unpack('<f', dat[ofs:ofs+4])[0], 8, True, False, True)}"]))
            else:
                ret = ' '.join(filter(None, [ret, f"{readable_float(struct.unpack('<f', dat[ofs:ofs+4])[0])}"]))
            ofs += int(fnext) if fnext.isdigit() else 4
        elif f[i] == 'd':
            if show == 1:
                ret = ' '.join(filter(None, [ret, f"{val2hex(struct.unpack('<d', dat[ofs:ofs+8])[0], 16, True, False, True)}"]))
            else:
                ret = ' '.join(filter(None, [ret, f"{readable_float(struct.unpack('<d', dat[ofs:ofs+8])[0], True)}"]))
            ofs += int(fnext) if fnext.isdigit() else 8
        i += 2 if fnext.isdigit() else 1
    return ret, ofs


def str2reg(dat, ofs, fmt, show, str_, s_idx):
    dat = bytearray(dat)
    f = re.sub(r'[\W_]', '', fmt) # remove non-word chars
    str_a = str_.split(' ')
    i = 0
    while i < len(f):
        fnext = f[i+1] if i < len(f) - 1 else ''
        if f[i] == 'c':
            if show == 1:
                dat[ofs:ofs+1] = struct.pack('<b', int(str_a[s_idx], 0))
            else:
                str_b = str_.encode()
                dat[ofs:ofs+1] = bytes([str_b[s_idx]]) if s_idx < len(str_b) else b'\x00'
            ofs += int(fnext) if fnext.isdigit() else 1
        elif f[i] == 'b':
            dat[ofs:ofs+1] = struct.pack('<b', int(str_a[s_idx], 0))
            ofs += int(fnext) if fnext.isdigit() else 1
        elif f[i] == 'B':
            if show == 2:
                dat[ofs:ofs+1] = hex2dat(str_a[s_idx])[0:1]
            else:
                dat[ofs:ofs+1] = struct.pack('<B', int(str_a[s_idx], 0))
            ofs += int(fnext) if fnext.isdigit() else 1
        elif f[i] == 'h':
            dat[ofs:ofs+2] = struct.pack('<h', int(str_a[s_idx], 0))
            ofs += int(fnext) if fnext.isdigit() else 2
        elif f[i] == 'H':
            dat[ofs:ofs+2] = struct.pack('<H', int(str_a[s_idx], 0))
            ofs += int(fnext) if fnext.isdigit() else 2
        elif f[i] == 'i':
            dat[ofs:ofs+4] = struct.pack('<i', int(str_a[s_idx], 0))
            ofs += int(fnext) if fnext.isdigit() else 4
        elif f[i] == 'I':
            dat[ofs:ofs+4] = struct.pack('<I', int(str_a[s_idx], 0))
            ofs += int(fnext) if fnext.isdigit() else 4
        elif f[i] == 'q':
            dat[ofs:ofs+8] = struct.pack('<q', int(str_a[s_idx], 0))
            ofs += int(fnext) if fnext.isdigit() else 8
        elif f[i] == 'Q':
            dat[ofs:ofs+8] = struct.pack('<Q', int(str_a[s_idx], 0))
            ofs += int(fnext) if fnext.isdigit() else 8
        elif f[i] == 'f':
            if show == 1:
                dat[ofs:ofs+4] = struct.pack('<f', hex2float(str_a[s_idx]))
            else:
                dat[ofs:ofs+4] = struct.pack('<f', float(str_a[s_idx]))
            ofs += int(fnext) if fnext.isdigit() else 4
        elif f[i] == 'd':
            if show == 1:
                dat[ofs:ofs+8] = struct.pack('<d', hex2float(str_a[s_idx]))
            else:
                dat[ofs:ofs+8] = struct.pack('<d', float(str_a[s_idx]))
            ofs += int(fnext) if fnext.isdigit() else 8
        
        i += 2 if fnext.isdigit() else 1
        s_idx += 1
    return bytes(dat)

