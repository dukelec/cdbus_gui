/*
 * Software License Agreement (MIT License)
 *
 * Author: Duke Fong <d@d-l.io>
 */

import { L } from '../utils/lang.js?v=__V__'
import { escape_html, date2num, val2hex, dat2str, str2dat, dat2hex, hex2dat, hex2float, parse_bigint,
         read_file, download, readable_size, readable_float, blob2dat } from '../utils/helper.js?v=__V__';
import { csa } from '../common.js?v=__V__';

const R_ADDR = 0; const R_LEN = 1; const R_FMT = 2;
const R_SHOW = 3; const R_ID = 4; const R_DESC = 5; const R_RANGE = 6;

// R_RANGE is the optional last member of a reg entry, it limits what may be written:
//   [[min, max, step], ...]  several ranges, the value is good when it fits any one of them
//   [min, max, step]         shorthand when there is only one range
// Both ends are included, step is optional, and null as an end means that end is not limited.
// The step is only enforced where it is exact, that is when min, step and the value are all
// integers; on a float it is just a hint of the granularity. It applies to every value of the
// register, so a struct or an array register shares one set of ranges.

// a bound may be a number, or a string for a value a json number cannot hold exactly
function to_num(v) {
    if (v === null || v === undefined || v === '')
        return null;
    if (typeof v == 'number')
        return isNaN(v) ? null : v;
    let str = String(v).trim();
    let neg = str.startsWith('-');       // Number() takes '0x..' but not '-0x..'
    let n = Number(neg ? str.slice(1) : str);
    return (str == '' || isNaN(n)) ? null : (neg ? -n : n);
}

// the ranges of a reg entry as [[min, max, step], ...], or null when it has none
function reg_ranges(reg) {
    let r = reg[R_RANGE];
    if (!Array.isArray(r) || !r.length)
        return null;
    let list = Array.isArray(r[0]) ? r : [r];   // accept the single range shorthand
    let ret = [];
    for (let one of list) {
        if (!Array.isArray(one) || one.length < 2)
            return null;                        // reg_range_err() reports it, ignore it here
        ret.push([to_num(one[0]), to_num(one[1]), to_num(one[2])]);
    }
    return ret;
}

// complain about a malformed range definition, so a typo does not just drop the limit
function reg_range_err(reg) {
    let r = reg[R_RANGE];
    if (r === undefined || r === null)
        return null;
    let bad = L('range must be [min, max, step] or [[min, max, step], ...]: %s');
    if (!Array.isArray(r) || !r.length)
        return bad.replace('%s', JSON.stringify(r));
    for (let one of (Array.isArray(r[0]) ? r : [r])) {
        if (!Array.isArray(one) || one.length < 2 || one.length > 3)
            return bad.replace('%s', JSON.stringify(one));
        let min = to_num(one[0]), max = to_num(one[1]);
        if ((one[0] != null && min == null) || (one[1] != null && max == null))
            return L('range bounds must be numbers: %s').replace('%s', JSON.stringify(one));
        if (min != null && max != null && min > max)
            return L('range min must not be above max: %s').replace('%s', JSON.stringify(one));
        if (one.length == 3 && one[2] != null) {
            let step = to_num(one[2]);
            if (step == null || step <= 0)
                return L('range step must be above 0: %s').replace('%s', JSON.stringify(one));
        }
    }
    return null;
}

// the ranges as text for the tooltip, e.g. "0~254" or "9600, 115200~921600/100"
function reg_range_str(reg) {
    let ranges = reg_ranges(reg);
    if (!ranges)
        return '';
    return ranges.map(([min, max, step]) => {
        let s;
        if (min != null && max != null)
            s = min == max ? `${min}` : `${min}~${max}`;
        else if (min != null)
            s = `>=${min}`;
        else if (max != null)
            s = `<=${max}`;
        else
            s = '*';
        return step ? `${s}/${step}` : s;
    }).join(', ');
}

// the range as a tooltip line, empty when the reg has none
function reg_range_tip(reg) {
    let str = reg_range_str(reg);
    return str ? `\nRange: ${str}` : '';
}

// check what the user typed against the ranges, returns the reason it is bad, or null
function reg_range_check(reg, str) {
    let ranges = reg_ranges(reg);
    if (!ranges)
        return null;
    if (reg[R_SHOW] == 2)                                   // raw bytes, nothing to compare
        return null;
    if (reg[R_SHOW] == 0 && reg[R_FMT].includes('c'))       // a string, not numbers
        return null;
    for (let tok of str.trim().split(/\s+/)) {
        if (tok == '')
            continue;
        let val = to_num(tok);
        if (val == null)
            return L('%s: "%s" is not a number').replace('%s', reg[R_ID]).replace('%s', tok);
        let fit = false;
        for (let [min, max, step] of ranges) {
            if ((min != null && val < min) || (max != null && val > max))
                continue;
            let base = min == null ? 0 : min;
            if (step && Number.isInteger(step) && Number.isInteger(base) &&
                    Number.isInteger(val) && (val - base) % step != 0)
                continue;
            fit = true;
            break;
        }
        if (!fit)
            return L('%s: %s is outside %s').replace('%s', reg[R_ID])
                    .replace('%s', tok).replace('%s', reg_range_str(reg));
    }
    return null;
}

function fmt_size(fmt) {
    let f = fmt.replace(/\W/g, ''); // remove non-word chars
    let len = 0;
    for (let i = 0; i < f.length; i++) {
        if (!isNaN(f[i+1])) {       // e.g. '{H,B2}'
            len += Number(f[++i]);
            continue;
        }
        switch (f[i]) {
        case 'c': len += 1; break;
        case 'b': len += 1; break;
        case 'B': len += 1; break;
        case 'h': len += 2; break;
        case 'H': len += 2; break;
        case 'i': len += 4; break;
        case 'I': len += 4; break;
        case 'q': len += 8; break;
        case 'Q': len += 8; break;
        case 'f': len += 4; break;
        case 'd': len += 8; break;
        }
    }
    return len;
}

function reg2str(dat, ofs, fmt, show) {
    let ret = '';
    let dv = new DataView(dat.buffer);
    let f = fmt.replace(/\W/g, ''); // remove non-word chars
    for (let i = 0; i < f.length; i++) {
        switch (f[i]) {
        case 'c':
            let c_len = 1;
            switch (show) {
            case 1:  ret = [ret, `${val2hex(dv.getInt8(ofs, true), 2, true)}`].filter(Boolean).join(' '); break;
            default:
                let c_hdr = dat[ofs];
                if ((c_hdr & 0b11100000) === 0b11000000)
                    c_len = 2; // 110xxxxx
                else if ((c_hdr & 0b11110000) === 0b11100000)
                    c_len = 3; // 1110xxxx
                else if ((c_hdr & 0b11111000) === 0b11110000)
                    c_len = 4; // 11110xxx
                let d = dat.slice(ofs,ofs+c_len); // handle utf8
                ret = [ret, `${dat2str(d)}`].filter(Boolean).join(' ');
            }
            ofs += isNaN(f[i+1]) ? c_len : Number(f[++i]);
            break;
        case 'b':
            switch (show) {
            case 1:  ret = [ret, `${val2hex(dv.getInt8(ofs, true), 2, true)}`].filter(Boolean).join(' '); break;
            default: ret = [ret, `${dv.getInt8(ofs, true)}`].filter(Boolean).join(' ');
            }
            ofs += isNaN(f[i+1]) ? 1 : Number(f[++i]);
            break;
        case 'B':
            switch (show) {
            case 1:  ret = [ret, `${val2hex(dv.getUint8(ofs, true), 2, true)}`].filter(Boolean).join(' '); break;
            case 2:  ret = [ret, `${dat2hex(dat.slice(ofs,ofs+1), ' ')}`].filter(Boolean).join(' '); break;
            default: ret = [ret, `${dv.getUint8(ofs, true)}`].filter(Boolean).join(' ');
            }
            ofs += isNaN(f[i+1]) ? 1 : Number(f[++i]);
            break;
        case 'h':
            switch (show) {
            case 1:  ret = [ret, `${val2hex(dv.getInt16(ofs, true), 4, true)}`].filter(Boolean).join(' '); break;
            default: ret = [ret, `${dv.getInt16(ofs, true)}`].filter(Boolean).join(' ');
            }
            ofs += isNaN(f[i+1]) ? 2 : Number(f[++i]);
            break;
        case 'H':
            switch (show) {
            case 1:  ret = [ret, `${val2hex(dv.getUint16(ofs, true), 4, true)}`].filter(Boolean).join(' '); break;
            default: ret = [ret, `${dv.getUint16(ofs, true)}`].filter(Boolean).join(' ');
            }
            ofs += isNaN(f[i+1]) ? 2 : Number(f[++i]);
            break;
        case 'i':
            switch (show) {
            case 1:  ret = [ret, `${val2hex(dv.getInt32(ofs, true), 8, true)}`].filter(Boolean).join(' '); break;
            default: ret = [ret, `${dv.getInt32(ofs, true)}`].filter(Boolean).join(' ');
            }
            ofs += isNaN(f[i+1]) ? 4 : Number(f[++i]);
            break;
        case 'I':
            switch (show) {
            case 1:  ret = [ret, `${val2hex(dv.getUint32(ofs, true), 8, true)}`].filter(Boolean).join(' '); break;
            default: ret = [ret, `${dv.getUint32(ofs, true)}`].filter(Boolean).join(' ');
            }
            ofs += isNaN(f[i+1]) ? 4 : Number(f[++i]);
            break;
        case 'q':
            switch (show) {
            case 1:  ret = [ret, `${val2hex(dv.getBigInt64(ofs, true), 16, true)}`].filter(Boolean).join(' '); break;
            default: ret = [ret, `${dv.getBigInt64(ofs, true)}`].filter(Boolean).join(' ');
            }
            ofs += isNaN(f[i+1]) ? 8 : Number(f[++i]);
            break;
        case 'Q':
            switch (show) {
            case 1:  ret = [ret, `${val2hex(dv.getBigUint64(ofs, true), 16, true)}`].filter(Boolean).join(' '); break;
            default: ret = [ret, `${dv.getBigUint64(ofs, true)}`].filter(Boolean).join(' ');
            }
            ofs += isNaN(f[i+1]) ? 8 : Number(f[++i]);
            break;
        case 'f':
            switch (show) {
            case 1:  ret = [ret, `${val2hex(dv.getFloat32(ofs, true), 8, true, false, true)}`].filter(Boolean).join(' '); break;
            default: ret = [ret, `${readable_float(dv.getFloat32(ofs, true))}`].filter(Boolean).join(' ');
            }
            ofs += isNaN(f[i+1]) ? 4 : Number(f[++i]);
            break;
        case 'd':
            switch (show) {
            case 1:  ret = [ret, `${val2hex(dv.getFloat64(ofs, true), 16, true, false, true)}`].filter(Boolean).join(' '); break;
            default: ret = [ret, `${readable_float(dv.getFloat64(ofs, true), true)}`].filter(Boolean).join(' ');
            }
            ofs += isNaN(f[i+1]) ? 8 : Number(f[++i]);
            break;
        }
    }
    return [ret, ofs];
}

// Serialize reg transactions. The r/w sockets are each shared by the periodic
// read, the R/W buttons and the external api, so a concurrent transaction
// would mix the replies up. One lock for both, they talk to the same device.
let reg_lock = Promise.resolve();

async function reg_xfer(sock, dat, timeout=1000) {
    let unlock;
    let prev = reg_lock;
    reg_lock = new Promise(resolve => unlock = resolve);
    await prev;
    try {
        sock.flush();
        await sock.sendto({'dst': [csa.arg.tgt, 0x5], 'dat': dat}, ['server', 'proxy']);
        return await sock.recvfrom(timeout);
    } finally {
        unlock();
    }
}

// A register value lives in exactly one place: the input box of the register list. Every
// other widget showing the same value (the mirrors in the top bar, later the dashboard) is
// told to re-read it whenever it changes, so there is never a second copy to keep in step.
// `edit_elm` is the widget's own input, if it has one the user can type into.
function reg_watch(elem, owner, cb, edit_elm=null) {
    (elem._subs ||= []).push({owner, cb, edit_elm});
    cb(elem);
}

// drop everything one owner subscribed to, before it rebuilds its widgets
function reg_unwatch(owner) {
    for (let key in csa.reg.elm) {
        let elem = csa.reg.elm[key];
        if (elem && elem._subs)
            elem._subs = elem._subs.filter(s => s.owner !== owner);
    }
}

// `src` is the owner that caused the change, it does not need telling about its own edit
function reg_notify(elem, src=null) {
    for (let s of (elem._subs || []))
        if (s.owner !== src)
            s.cb(elem);
}

function reg_set_str(elem, str) {
    if (elem.value == str)
        return;
    elem.value = str;
    reg_notify(elem);
}

function reg_set_tip(elem, tip) {
    elem.setAttribute('data-tooltip', tip);
    reg_notify(elem);
}

// The button edit mode replaces the group sets while a read or write may be on its way. Such a
// transfer keeps the addr / len it started with, but its index may now name another group, or
// none: the rows of that group are not its to colour, and a write must not pack the fresh
// read-before-write bytes of another group.
function grp_same(rw, idx, addr, len) {
    let g = (rw == 'r' ? csa.reg.reg_r : csa.reg.reg_w)[idx];
    return !!g && g[0] == addr && g[1] == len;
}

function in_editing(elem) { // skip update the input box being edited during periodic read
    if (!document.getElementById('keep_read')?.checked)
        return false;
    if (document.activeElement === elem)
        return true;
    for (let s of (elem._subs || []))   // one of its mirrors is being edited
        if (s.edit_elm && document.activeElement === s.edit_elm)
            return true;
    return false;
}

async function read_reg_val(r_idx, read_dft=false) {
    let grp = csa.reg.reg_r[r_idx];
    if (!grp)
        return -1;
    let [addr, len] = grp;
    set_input_bg('r', r_idx, '#D5F5E3');
    
    let dat = new Uint8Array([read_dft ? 0x01 : 0x00, 0, 0, len]);
    let dv = new DataView(dat.buffer);
    dv.setUint16(1, addr, true);

    console.log('read reg wait ret');
    let ret = await reg_xfer(csa.reg.proxy_sock_regr, dat);
    console.log('read reg ret', ret);
    if (ret && (ret[0].dat[0] & 0xf) == 0) {
        if (read_dft)
            csa.reg.reg_dft_r[r_idx] = true;
        
        let start = addr;
        let found_start = false;
        for (let i = 0; i < csa.cfg.reg.list.length; i++) {
            let r = csa.cfg.reg.list[i];
            
            if (!found_start) {
                if (start == r[R_ADDR]) {
                    found_start = true;
                } else {
                    continue;
                }
            }
            
            let ofs = r[R_ADDR] - start;
            if (ofs >= len)
                break;
            
            if (r[R_FMT][0] == '{') {
                let one_size = fmt_size(r[R_FMT]);
                let count = Math.trunc(r[R_LEN] / one_size);
                for (let n = 0; n < count; n++) {
                    let [str, ofs] = reg2str(ret[0].dat.slice(1), r[R_ADDR] - start + one_size * n, r[R_FMT], r[R_SHOW]);
                    if (read_dft) {
                        let elem = csa.reg.elm[`reg_dft.${r[R_ID]}.${n}`];
                        reg_set_tip(elem, `Default: ${str}\nFormat: ${r[R_FMT]}${reg_range_tip(r)}`);
                    } else {
                        let elem = csa.reg.elm[`reg.${r[R_ID]}.${n}`];
                        if (!in_editing(elem))
                            reg_set_str(elem, str);
                    }
                }
            } else if (r[R_FMT][0] == '[') {
                let one_size = fmt_size(r[R_FMT]);
                let count = Math.trunc(r[R_LEN] / one_size);
                let val = '';
                let join = r[R_FMT][1] == 'c' && r[R_SHOW] == 0 ? '' : ' ';
                for (let n = 0; n < count; /**/) {
                    let cur_ofs = r[R_ADDR] - start + one_size * n;
                    let [str, ofs] = reg2str(ret[0].dat.slice(1), cur_ofs, r[R_FMT], r[R_SHOW]);
                    if (join == '' && str.length == 0) // stop parsing at '\0'
                        break;
                    val = [val, str].filter(Boolean).join(join);
                    n += Math.trunc((ofs - cur_ofs) / one_size);
                }
                
                if (read_dft) {
                    reg_set_tip(csa.reg.elm[`reg_dft.${r[R_ID]}`], `Default: ${val}\nFormat: ${r[R_FMT]}${reg_range_tip(r)}`);
                } else {
                    let elem = csa.reg.elm[`reg.${r[R_ID]}`];
                    if (!in_editing(elem))
                        reg_set_str(elem, val);
                }
                
            } else {
                let [str,ofs] = reg2str(ret[0].dat.slice(1), r[R_ADDR] - start, r[R_FMT], r[R_SHOW]);
                if (read_dft) {
                    let elem = csa.reg.elm[`reg_dft.${r[R_ID]}`];
                    reg_set_tip(elem, `Default: ${str}\nFormat: ${r[R_FMT]}${reg_range_tip(r)}`);
                } else {
                    let elem = csa.reg.elm[`reg.${r[R_ID]}`];
                    if (!in_editing(elem))
                        reg_set_str(elem, str);
                }
            }
            
        }
    } else {
        console.warn('read reg err');
        if (grp_same('r', r_idx, addr, len))
            set_input_bg('r', r_idx, '#F5B7B180');
        return -1;
    }
    
    if (!grp_same('r', r_idx, addr, len)) // the groups changed meanwhile, the values still went in
        return -1;
    if (!read_dft && !csa.reg.reg_dft_r[r_idx]) {
        console.log('read default');
        return await read_reg_val(r_idx, true);
    } else {
        set_input_bg('r', r_idx, '#D5F5E360');
        setTimeout(() => { set_input_bg('r', r_idx, ''); }, 100);
        return 0;
    }
}


function str2reg(dat, ofs, fmt, show, str, s_idx) {
    let dv = new DataView(dat.buffer);
    let f = fmt.replace(/\W/g, ''); // remove non-word chars
    let str_a = str.trim().split(/\s+/);
    for (let i = 0; i < f.length; i++) {
        switch (f[i]) {
        case 'c':
            switch (show) {
            case 1:  dv.setInt8(ofs, parseInt(str_a[s_idx]), true); break;
            default:
                let str_dat = str2dat(str); // handle utf8
                let str_idx = str_dat.slice(s_idx,s_idx+1);
                if (!str_idx.length)
                    str_idx = new Uint8Array(1); // zero
                dat.set(str_idx, ofs);
            }
            ofs += isNaN(f[i+1]) ? 1 : Number(f[++i]);
            break;
        case 'b':
            dv.setInt8(ofs, parseInt(str_a[s_idx]), true);
            ofs += isNaN(f[i+1]) ? 1 : Number(f[++i]);
            break;
        case 'B':
            switch (show) {
            case 2:  dat.set(hex2dat(str_a[s_idx]).slice(0,1), ofs); break;
            default: dv.setUint8(ofs, parseInt(str_a[s_idx]), true);
            }
            ofs += isNaN(f[i+1]) ? 1 : Number(f[++i]);
            break;
        case 'h':
            dv.setInt16(ofs, parseInt(str_a[s_idx]), true);
            ofs += isNaN(f[i+1]) ? 2 : Number(f[++i]);
            break;
        case 'H':
            dv.setUint16(ofs, parseInt(str_a[s_idx]), true);
            ofs += isNaN(f[i+1]) ? 2 : Number(f[++i]);
            break;
        case 'i':
            dv.setInt32(ofs, parseInt(str_a[s_idx]), true);
            ofs += isNaN(f[i+1]) ? 4 : Number(f[++i]);
            break;
        case 'I':
            dv.setUint32(ofs, parseInt(str_a[s_idx]), true);
            ofs += isNaN(f[i+1]) ? 4 : Number(f[++i]);
            break;
        case 'q':
            dv.setBigInt64(ofs, parse_bigint(str_a[s_idx]), true);
            ofs += isNaN(f[i+1]) ? 8 : Number(f[++i]);
            break;
        case 'Q':
            dv.setBigUint64(ofs, parse_bigint(str_a[s_idx]), true);
            ofs += isNaN(f[i+1]) ? 8 : Number(f[++i]);
            break;
        case 'f':
            switch (show) {
            case 1:  dv.setFloat32(ofs, hex2float(str_a[s_idx]), true); break;
            default: dv.setFloat32(ofs, parseFloat(str_a[s_idx]), true);
            }
            ofs += isNaN(f[i+1]) ? 4 : Number(f[++i]);
            break;
        case 'd':
            switch (show) {
            case 1:  dv.setFloat64(ofs, hex2float(str_a[s_idx]), true); break;
            default: dv.setFloat64(ofs, parseFloat(str_a[s_idx]), true);
            }
            ofs += isNaN(f[i+1]) ? 8 : Number(f[++i]);
            break;
        }
        s_idx += 1;
    }
}

// the regs a read / write group covers, in list order
function group_regs(addr, len) {
    let ret = [];
    let found_start = false;
    for (let r of csa.cfg.reg.list) {
        if (!found_start) {
            if (addr != r[R_ADDR])
                continue;
            found_start = true;
        }
        if (r[R_ADDR] - addr >= len)
            break;
        ret.push(r);
    }
    return ret;
}

// Capture the input strings once: validation and packing must use the same values,
// even if the user or a periodic read changes the boxes during read-before-write.
function group_inputs(addr, len) {
    let inputs = [];
    for (let reg of group_regs(addr, len)) {
        let size = fmt_size(reg[R_FMT]);
        let count = Math.trunc(reg[R_LEN] / size);
        let struct = reg[R_FMT][0] == '{';
        for (let n = 0; n < (struct ? count : 1); n++) {
            let key = `reg.${reg[R_ID]}` + (struct ? `.${n}` : '');
            inputs.push({ reg, str: csa.reg.elm[key].value,
                          ofs: reg[R_ADDR] - addr + (struct ? size * n : 0),
                          count: reg[R_FMT][0] == '[' ? count : 1, size });
        }
    }
    return inputs;
}

function check_group_inputs(inputs) {
    for (let {reg, str, count} of inputs) {
        // Text arrays may be shorter than the register, and are zero padded.
        if (!(reg[R_SHOW] == 0 && reg[R_FMT].includes('c'))) {
            let expected = reg[R_FMT].replace(/[^a-zA-Z]/g, '').length * count;
            let actual = str.trim() ? str.trim().split(/\s+/).length : 0;
            if (actual != expected)
                return L('%s: expected %s values, got %s').replace('%s', reg[R_ID])
                        .replace('%s', expected).replace('%s', actual);
        }
        let err = reg_range_check(reg, str);
        if (err)
            return err;
    }
    return null;
}

async function write_reg_val(w_idx, alert_err=true) {
    let grp = csa.reg.reg_w[w_idx];
    if (!grp)
        return -1;
    let [addr, len] = grp;
    set_input_bg('w', w_idx, '#D6EAF8');
    csa.reg.last_err = null;
    
    // refuse a value the config does not allow before the read-before-write round trip:
    // no point going out to the bus just to reject it here afterwards
    let inputs = group_inputs(addr, len);
    let input_err = check_group_inputs(inputs);
    if (input_err) {
        console.log('write reg: invalid input:', input_err);
        csa.reg.last_err = input_err;
        set_input_bg('w', w_idx, '#F5B7B180');
        if (alert_err)
            alert(input_err);
        return -1;
    }
    
    if (!csa.reg.reg_rbw[w_idx]) { // read-before-write
        let dat = new Uint8Array([0x00, 0, 0, len]);
        let dv = new DataView(dat.buffer);
        dv.setUint16(1, addr, true);
        
        console.log('read-before-write wait ret');
        let ret = await reg_xfer(csa.reg.proxy_sock_regw, dat);
        console.log('read-before-write ret', ret);
        if (!grp_same('w', w_idx, addr, len)) { // the groups changed meanwhile, give up
            console.log('read-before-write: group changed');
            return -1;
        }
        if (ret && (ret[0].dat[0] & 0xf) == 0) {
            csa.reg.reg_rbw[w_idx] = ret[0].dat.slice(1);
        } else {
            console.log('read-before-write err');
            set_input_bg('w', w_idx, '#F5B7B180');
            return -1;
        }
    }
    
    let dat = new Uint8Array(3 + len);
    let dv = new DataView(dat.buffer);
    dv.setUint16(1, addr, true);
    dat[0] = 0x20;
    dat.set(csa.reg.reg_rbw[w_idx], 3);
    
    console.info('before write reg:', dat2hex(dat, ' '));

    try {
        for (let {reg, str, ofs, count, size} of inputs) {
            for (let n = 0; n < count; n++)
                str2reg(dat, ofs + size * n + 3, reg[R_FMT], reg[R_SHOW], str, n);
        }
    } catch (err) {
        csa.reg.last_err = `${err.message || err}`;
        set_input_bg('w', w_idx, '#F5B7B180');
        if (alert_err)
            alert(csa.reg.last_err);
        return -1;
    }

    console.info('write reg:', dat2hex(dat, ' '));
    console.log('write reg wait ret');
    let ret = await reg_xfer(csa.reg.proxy_sock_regw, dat);
    console.log('write reg ret', ret);
    let same = grp_same('w', w_idx, addr, len); // else the rows are another group's now
    if (ret && (ret[0].dat[0] & 0xf) == 0) {
        console.log('write reg succeeded');
        if (same) {
            set_input_bg('w', w_idx, '#D6EAF860');
            setTimeout(() => { set_input_bg('w', w_idx, ''); }, 100);
        }
        return 0;
    } else {
        console.log('write reg err');
        if (same)
            set_input_bg('w', w_idx, '#F5B7B180');
        return -1;
    }
}


function set_input_bg(rw='r', idx, bg) {
    let skip_edit = rw == 'r' && bg != ''; // don't highlight the input box being edited
    let reg_rw = rw == 'r' ? csa.reg.reg_r : csa.reg.reg_w;
    if (!reg_rw[idx]) // a timer from before the groups were edited
        return;
    let [addr, len] = reg_rw[idx];
    
    let start = addr;
    let found_start = false;
    for (let i = 0; i < csa.cfg.reg.list.length; i++) {
        let r = csa.cfg.reg.list[i];
        
        if (!found_start) {
            if (start == r[R_ADDR]) {
                found_start = true;
            } else {
                continue;
            }
        }
        let ofs = r[R_ADDR] - start;
        if (ofs >= len)
            break;
        
        if (r[R_FMT][0] == '{') {
            let one_size = fmt_size(r[R_FMT]);
            let count = Math.trunc(r[R_LEN] / one_size);
            for (let n = 0; n < count; n++) {
                let elem = csa.reg.elm[`reg.${r[R_ID]}.${n}`];
                if (!skip_edit || !in_editing(elem)) {
                    elem.style.background = bg;
                    reg_notify(elem);
                }
            }
        } else {
            let elem = csa.reg.elm[`reg.${r[R_ID]}`];
            if (!skip_edit || !in_editing(elem)) {
                elem.style.background = bg;
                reg_notify(elem);
            }
        }
    }
}

export {
    fmt_size, reg2str, read_reg_val, str2reg, write_reg_val,
    reg_range_err, reg_range_tip,
    reg_watch, reg_unwatch, reg_notify, reg_set_str,
    R_ADDR, R_LEN, R_FMT, R_SHOW, R_ID, R_DESC, R_RANGE
};
