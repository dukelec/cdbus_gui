/*
 * Software License Agreement (MIT License)
 *
 * Author: Duke Fong <d@d-l.io>
 */

import { L } from '../utils/lang.js'
import { escape_html, date2num, val2hex, dat2str, str2dat, dat2hex, hex2dat, hex2float, parse_bigint,
         read_file, download, readable_size, readable_float, blob2dat } from '../utils/helper.js';
import { csa } from '../common.js';

const R_ADDR = 0; const R_LEN = 1; const R_FMT = 2;
const R_SHOW = 3; const R_ID = 4; const R_DESC = 5;

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
            case 2:  ret = [ret, `${dat2hex(dat.slice(ofs,ofs+1), ' ')}`].filter(Boolean).join(' '); break;
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
            case 2:  ret = [ret, `${dat2hex(dat.slice(ofs,ofs+1), ' ')}`].filter(Boolean).join(' '); break;
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
            case 2:  ret = [ret, `${dat2hex(dat.slice(ofs,ofs+2), ' ')}`].filter(Boolean).join(' '); break;
            default: ret = [ret, `${dv.getInt16(ofs, true)}`].filter(Boolean).join(' ');
            }
            ofs += isNaN(f[i+1]) ? 2 : Number(f[++i]);
            break;
        case 'H':
            switch (show) {
            case 1:  ret = [ret, `${val2hex(dv.getUint16(ofs, true), 4, true)}`].filter(Boolean).join(' '); break;
            case 2:  ret = [ret, `${dat2hex(dat.slice(ofs,ofs+2), ' ')}`].filter(Boolean).join(' '); break;
            default: ret = [ret, `${dv.getUint16(ofs, true)}`].filter(Boolean).join(' ');
            }
            ofs += isNaN(f[i+1]) ? 2 : Number(f[++i]);
            break;
        case 'i':
            switch (show) {
            case 1:  ret = [ret, `${val2hex(dv.getInt32(ofs, true), 8, true)}`].filter(Boolean).join(' '); break;
            case 2:  ret = [ret, `${dat2hex(dat.slice(ofs,ofs+4), ' ')}`].filter(Boolean).join(' '); break;
            default: ret = [ret, `${dv.getInt32(ofs, true)}`].filter(Boolean).join(' ');
            }
            ofs += isNaN(f[i+1]) ? 4 : Number(f[++i]);
            break;
        case 'I':
            switch (show) {
            case 1:  ret = [ret, `${val2hex(dv.getUint32(ofs, true), 8, true)}`].filter(Boolean).join(' '); break;
            case 2:  ret = [ret, `${dat2hex(dat.slice(ofs,ofs+4), ' ')}`].filter(Boolean).join(' '); break;
            default: ret = [ret, `${dv.getUint32(ofs, true)}`].filter(Boolean).join(' ');
            }
            ofs += isNaN(f[i+1]) ? 4 : Number(f[++i]);
            break;
        case 'q':
            switch (show) {
            case 1:  ret = [ret, `${val2hex(dv.getBigInt64(ofs, true), 16, true)}`].filter(Boolean).join(' '); break;
            case 2:  ret = [ret, `${dat2hex(dat.slice(ofs,ofs+8), ' ')}`].filter(Boolean).join(' '); break;
            default: ret = [ret, `${dv.getBigInt64(ofs, true)}`].filter(Boolean).join(' ');
            }
            ofs += isNaN(f[i+1]) ? 8 : Number(f[++i]);
            break;
        case 'Q':
            switch (show) {
            case 1:  ret = [ret, `${val2hex(dv.getBigUint64(ofs, true), 16, true)}`].filter(Boolean).join(' '); break;
            case 2:  ret = [ret, `${dat2hex(dat.slice(ofs,ofs+8), ' ')}`].filter(Boolean).join(' '); break;
            default: ret = [ret, `${dv.getBigUint64(ofs, true)}`].filter(Boolean).join(' ');
            }
            ofs += isNaN(f[i+1]) ? 8 : Number(f[++i]);
            break;
        case 'f':
            switch (show) {
            case 1:  ret = [ret, `${val2hex(dv.getFloat32(ofs, true), 8, true, false, true)}`].filter(Boolean).join(' '); break;
            case 2:  ret = [ret, `${dat2hex(dat.slice(ofs,ofs+4), ' ')}`].filter(Boolean).join(' '); break;
            default: ret = [ret, `${readable_float(dv.getFloat32(ofs, true))}`].filter(Boolean).join(' ');
            }
            ofs += isNaN(f[i+1]) ? 4 : Number(f[++i]);
            break;
        case 'd':
            switch (show) {
            case 1:  ret = [ret, `${val2hex(dv.getFloat64(ofs, true), 16, true, false, true)}`].filter(Boolean).join(' '); break;
            case 2:  ret = [ret, `${dat2hex(dat.slice(ofs,ofs+8), ' ')}`].filter(Boolean).join(' '); break;
            default: ret = [ret, `${readable_float(dv.getFloat64(ofs, true), true)}`].filter(Boolean).join(' ');
            }
            ofs += isNaN(f[i+1]) ? 8 : Number(f[++i]);
            break;
        }
    }
    return [ret, ofs];
}

async function read_reg_val(r_idx, read_dft=false) {
    set_input_bg('r', r_idx, '#D5F5E3');
    let addr = csa.reg.reg_r[r_idx][0];
    let len = csa.reg.reg_r[r_idx][1];
    
    let dat = new Uint8Array([read_dft ? 0x01 : 0x00, 0, 0, len]);
    let dv = new DataView(dat.buffer);
    dv.setUint16(1, addr, true);

    csa.reg.proxy_sock_regr.flush();
    await csa.reg.proxy_sock_regr.sendto({'dst': [csa.arg.tgt, 0x5], 'dat': dat}, ['server', 'proxy']);
    console.log('read reg wait ret');
    let ret = await csa.reg.proxy_sock_regr.recvfrom(1000);
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
                        elem.setAttribute('data-tooltip', `Default: ${str}\nFormat: ${r[R_FMT]}`);
                    } else {
                        let elem = csa.reg.elm[`reg.${r[R_ID]}.${n}`];
                        elem.value = str;
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
                    val = [val, str].filter(Boolean).join(join);
                    n += Math.trunc((ofs - cur_ofs) / one_size);
                }
                
                if (read_dft)
                    csa.reg.elm[`reg_dft.${r[R_ID]}`].setAttribute('data-tooltip', `Default: ${val}\nFormat: ${r[R_FMT]}`);
                else
                    csa.reg.elm[`reg.${r[R_ID]}`].value = val;
                
            } else {
                let [str,ofs] = reg2str(ret[0].dat.slice(1), r[R_ADDR] - start, r[R_FMT], r[R_SHOW]);
                if (read_dft) {
                    let elem = csa.reg.elm[`reg_dft.${r[R_ID]}`];
                    elem.setAttribute('data-tooltip', `Default: ${str}\nFormat: ${r[R_FMT]}`);
                } else {
                    let elem = csa.reg.elm[`reg.${r[R_ID]}`];
                    elem.value = str;
                }
            }
            
        }
    } else {
        console.warn('read reg err');
        set_input_bg('r', r_idx, '#F5B7B180');
        return -1;
    }
    
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
    let str_a = str.split(' ');
    for (let i = 0; i < f.length; i++) {
        switch (f[i]) {
        case 'c':
            switch (show) {
            case 1:  dv.setInt8(ofs, parseInt(str_a[s_idx]), true); break;
            case 2:  dat.set(hex2dat(str_a[s_idx]).slice(0,1), ofs); break;
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
            switch (show) {
            case 2:  dat.set(hex2dat(str_a[s_idx]).slice(0,1), ofs); break;
            default: dv.setInt8(ofs, parseInt(str_a[s_idx]), true);
            }
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
            switch (show) {
            case 2:  dat.set(hex2dat(str_a[s_idx]).slice(0,2), ofs); break;
            default: dv.setInt16(ofs, parseInt(str_a[s_idx]), true);
            }
            ofs += isNaN(f[i+1]) ? 2 : Number(f[++i]);
            break;
        case 'H':
            switch (show) {
            case 2:  dat.set(hex2dat(str_a[s_idx]).slice(0,2), ofs); break;
            default: dv.setUint16(ofs, parseInt(str_a[s_idx]), true);
            }
            ofs += isNaN(f[i+1]) ? 2 : Number(f[++i]);
            break;
        case 'i':
            switch (show) {
            case 2:  dat.set(hex2dat(str_a[s_idx]).slice(0,4), ofs); break;
            default: dv.setInt32(ofs, parseInt(str_a[s_idx]), true);
            }
            ofs += isNaN(f[i+1]) ? 4 : Number(f[++i]);
            break;
        case 'I':
            switch (show) {
            case 2:  dat.set(hex2dat(str_a[s_idx]).slice(0,4), ofs); break;
            default: dv.setUint32(ofs, parseInt(str_a[s_idx]), true);
            }
            ofs += isNaN(f[i+1]) ? 4 : Number(f[++i]);
            break;
        case 'q':
            switch (show) {
            case 2:  dat.set(hex2dat(str_a[s_idx]).slice(0,8), ofs); break;
            default: dv.setBigInt64(ofs, parse_bigint(str_a[s_idx]), true);
            }
            ofs += isNaN(f[i+1]) ? 8 : Number(f[++i]);
            break;
        case 'Q':
            switch (show) {
            case 2:  dat.set(hex2dat(str_a[s_idx]).slice(0,8), ofs); break;
            default: dv.setBigUint64(ofs, parse_bigint(str_a[s_idx]), true);
            }
            ofs += isNaN(f[i+1]) ? 8 : Number(f[++i]);
            break;
        case 'f':
            switch (show) {
            case 1:  dv.setFloat32(ofs, hex2float(str_a[s_idx]), true); break;
            case 2:  dat.set(hex2dat(str_a[s_idx]).slice(0,4), ofs); break;
            default: dv.setFloat32(ofs, parseFloat(str_a[s_idx]), true);
            }
            ofs += isNaN(f[i+1]) ? 4 : Number(f[++i]);
            break;
        case 'd':
            switch (show) {
            case 1:  dv.setFloat64(ofs, hex2float(str_a[s_idx]), true); break;
            case 2:  dat.set(hex2dat(str_a[s_idx]).slice(0,8), ofs); break;
            default: dv.setFloat64(ofs, parseFloat(str_a[s_idx]), true);
            }
            ofs += isNaN(f[i+1]) ? 8 : Number(f[++i]);
            break;
        }
        s_idx += 1;
    }
}

async function write_reg_val(w_idx) {
    set_input_bg('w', w_idx, '#D6EAF8');
    let has_empty = false;
    let addr = csa.reg.reg_w[w_idx][0];
    let len = csa.reg.reg_w[w_idx][1];
    
    if (!csa.reg.reg_rbw[w_idx]) { // read-before-write
        let dat = new Uint8Array([0x00, 0, 0, len]);
        let dv = new DataView(dat.buffer);
        dv.setUint16(1, addr, true);
        
        csa.reg.proxy_sock_regw.flush();
        await csa.reg.proxy_sock_regw.sendto({'dst': [csa.arg.tgt, 0x5], 'dat': dat}, ['server', 'proxy']);
        console.log('read-before-write wait ret');
        let ret = await csa.reg.proxy_sock_regw.recvfrom(1000);
        console.log('read-before-write ret', ret);
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
                if (elem.value == '')
                    has_empty = true;
                str2reg(dat, r[R_ADDR]-start+one_size*n+3, r[R_FMT], r[R_SHOW], elem.value, 0);
            }
        } else if (r[R_FMT][0] == '[') {
            let one_size = fmt_size(r[R_FMT]);
            let count = Math.trunc(r[R_LEN] / one_size);
            let elem = csa.reg.elm[`reg.${r[R_ID]}`];
            if (elem.value == '' && r[R_FMT] != '[c]')
                has_empty = true;
            for (let n = 0; n < count; n++)
                str2reg(dat, r[R_ADDR]-start+one_size*n+3, r[R_FMT], r[R_SHOW], elem.value, n);
            
        } else {
            let elem = csa.reg.elm[`reg.${r[R_ID]}`];
            if (elem.value == '')
                has_empty = true;
            str2reg(dat, r[R_ADDR]-start+3, r[R_FMT], r[R_SHOW], elem.value, 0);
        }
        
    }
    
    if (has_empty) {
        console.log('write reg: input empty');
        set_input_bg('w', w_idx, '#F5B7B180');
        return -1;
    }
    
    console.info('write reg:', dat2hex(dat, ' '));
    csa.reg.proxy_sock_regw.flush();
    await csa.reg.proxy_sock_regw.sendto({'dst': [csa.arg.tgt, 0x5], 'dat': dat}, ['server', 'proxy']);
    console.log('write reg wait ret');
    let ret = await csa.reg.proxy_sock_regw.recvfrom(1000);
    console.log('write reg ret', ret);
    if (ret && (ret[0].dat[0] & 0xf) == 0) {
        console.log('write reg succeeded');
        set_input_bg('w', w_idx, '#D6EAF860');
        setTimeout(() => { set_input_bg('w', w_idx, ''); }, 100);
        return 0;
    } else {
        console.log('write reg err');
        set_input_bg('w', w_idx, '#F5B7B180');
        return -1;
    }
}


function set_input_bg(rw='r', idx, bg) {
    let reg_rw = rw == 'r' ? csa.reg.reg_r : csa.reg.reg_w;
    let addr = reg_rw[idx][0];
    let len = reg_rw[idx][1];
    
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
            for (let n = 0; n < count; n++)
                csa.reg.elm[`reg.${r[R_ID]}.${n}`].style.background = bg;
        } else {
            csa.reg.elm[`reg.${r[R_ID]}`].style.background = bg;
        }
    }
}

export {
    fmt_size, reg2str, read_reg_val, str2reg, write_reg_val,
    R_ADDR, R_LEN, R_FMT, R_SHOW, R_ID, R_DESC
};
