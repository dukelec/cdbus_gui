/*
 * Software License Agreement (MIT License)
 *
 * Author: Duke Fong <d@d-l.io>
 */

import { escape_html, date2num, val2hex, dat2str, dat2hex, hex2dat,
         read_file, download, readable_size, blob2dat } from './utils/helper.js';
import { csa } from './ctrl.js';

const R_ADDR = 0; const R_LEN = 1; const R_FMT = 2;
const R_SHOW = 3; const R_ID = 4; const R_DESC = 5;

function fmt_size(fmt) {
    let f = fmt.replace(/\W/g, '') // remove non-alphanumeric chars
    let len = 0;
    for (let i = 0; i < f.length; i++) {
        switch (f[i]) {
        case 'c': len += 1; break;
        case 'b': len += 1; break;
        case 'B': len += 1; break;
        case 'h': len += 2; break;
        case 'H': len += 2; break;
        case 'i': len += 4; break;
        case 'I': len += 4; break;
        case 'f': len += 4; break;
        }
    }
    return len;
}

function reg2str(dat, ofs, fmt, show) {
    let ret = '';
    let dv = new DataView(dat.buffer);
    fmt = fmt.replace(/\W/g, ''); // remove non-alphanumeric chars
    for (let f of fmt) {
        switch (f) {
        case 'c':
            switch (show) {
            case 1:  ret = [ret, `0x${dat2hex(dat.slice(ofs,ofs+1), '', true)}`].filter(Boolean).join(' '); break;
            case 2:  ret = [ret, `${dat2hex(dat.slice(ofs,ofs+1), ' ')}`].filter(Boolean).join(' '); break;
            default: ret = [ret, `${dat2str(dat.slice(ofs,ofs+1))}`].filter(Boolean).join(' ');
            }
            ofs += 1; break;
        case 'b':
            switch (show) {
            case 1:  ret = [ret, `0x${dat2hex(dat.slice(ofs,ofs+1), '', true)}`].filter(Boolean).join(' '); break;
            case 2:  ret = [ret, `${dat2hex(dat.slice(ofs,ofs+1), ' ')}`].filter(Boolean).join(' '); break;
            default: ret = [ret, `${dv.getInt8(ofs, true)}`].filter(Boolean).join(' ');
            }
            ofs += 1; break;
        case 'B':
            switch (show) {
            case 1:  ret = [ret, `0x${dat2hex(dat.slice(ofs,ofs+1), '', true)}`].filter(Boolean).join(' '); break;
            case 2:  ret = [ret, `${dat2hex(dat.slice(ofs,ofs+1), ' ')}`].filter(Boolean).join(' '); break;
            default: ret = [ret, `${dv.getUint8(ofs, true)}`].filter(Boolean).join(' ');
            }
            ofs += 1; break;
        case 'h':
            switch (show) {
            case 1:  ret = [ret, `0x${dat2hex(dat.slice(ofs,ofs+2), '', true)}`].filter(Boolean).join(' '); break;
            case 2:  ret = [ret, `${dat2hex(dat.slice(ofs,ofs+2), ' ')}`].filter(Boolean).join(' '); break;
            default: ret = [ret, `${dv.getInt16(ofs, true)}`].filter(Boolean).join(' ');
            }
            ofs += 2; break;
        case 'H':
            switch (show) {
            case 1:  ret = [ret, `0x${dat2hex(dat.slice(ofs,ofs+2), '', true)}`].filter(Boolean).join(' '); break;
            case 2:  ret = [ret, `${dat2hex(dat.slice(ofs,ofs+2), ' ')}`].filter(Boolean).join(' '); break;
            default: ret = [ret, `${dv.getUint16(ofs, true)}`].filter(Boolean).join(' ');
            }
            ofs += 2; break;
        case 'i':
            switch (show) {
            case 1:  ret = [ret, `0x${dat2hex(dat.slice(ofs,ofs+4), '', true)}`].filter(Boolean).join(' '); break;
            case 2:  ret = [ret, `${dat2hex(dat.slice(ofs,ofs+4), ' ')}`].filter(Boolean).join(' '); break;
            default: ret = [ret, `${dv.getInt32(ofs, true)}`].filter(Boolean).join(' ');
            }
            ofs += 4; break;
        case 'I':
            switch (show) {
            case 1:  ret = [ret, `0x${dat2hex(dat.slice(ofs,ofs+4), '', true)}`].filter(Boolean).join(' '); break;
            case 2:  ret = [ret, `${dat2hex(dat.slice(ofs,ofs+4), ' ')}`].filter(Boolean).join(' '); break;
            default: ret = [ret, `${dv.getUint32(ofs, true)}`].filter(Boolean).join(' ');
            }
            ofs += 4; break;
        case 'f':
            switch (show) {
            case 1:  ret = [ret, `0x${dat2hex(dat.slice(ofs,ofs+4), '', true)}`].filter(Boolean).join(' '); break;
            case 2:  ret = [ret, `${dat2hex(dat.slice(ofs,ofs+4), ' ')}`].filter(Boolean).join(' '); break;
            default: ret = [ret, `${dv.getFloat32(ofs, true)}`].filter(Boolean).join(' ');
            }
            ofs += 4; break;
        }
    }
    return ret;
}

async function read_reg_val(r_idx, read_dft=false) {
    let addr = csa.cfg_reg_r[r_idx][0];
    let len = csa.cfg_reg_r[r_idx][1];
    
    let dat = new Uint8Array([read_dft ? 0x01 : 0x00, 0, 0, len]);
    let dv = new DataView(dat.buffer);
    dv.setUint16(1, addr, true);

    await csa.proxy_sock.sendto({'dst': [csa.tgt, 0x5], 'dat': dat}, ['server', 'proxy']);
    console.log('read reg wait ret');
    let ret = await csa.proxy_sock.recvfrom(1000);
    console.log('read reg ret', ret);
    if (ret && ret[0].dat[0] == 0x80) {
        csa.cfg_reg_r[r_idx][read_dft ? 3 : 2] = ret[0].dat.slice(1);
        
        let start = addr;
        let found_start = false;
        for (let i = 0; i < csa.cfg_reg.length; i++) {
            let r = csa.cfg_reg[i];
            
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
                    if (read_dft) {
                        let elem = document.getElementById(`reg_dft.${r[R_ID]}.${n}`);
                        elem.setAttribute('data-tooltip', 'Default: ' + reg2str(ret[0].dat.slice(1), r[R_ADDR] - start + one_size * n, r[R_FMT], r[R_SHOW]));
                    } else {
                        let elem = document.getElementById(`reg.${r[R_ID]}.${n}`);
                        elem.value = reg2str(ret[0].dat.slice(1), r[R_ADDR] - start + one_size * n, r[R_FMT], r[R_SHOW]);
                    }
                }
            }else if (r[R_FMT][0] == '[') {
                let one_size = fmt_size(r[R_FMT]);
                let count = Math.trunc(r[R_LEN] / one_size);
                let val = '';
                for (let n = 0; n < count; n++)
                    val = [val, reg2str(ret[0].dat.slice(1), r[R_ADDR] - start + one_size * n, r[R_FMT], r[R_SHOW])].filter(Boolean).join(' ');
                
                if (read_dft)
                    document.getElementById(`reg.${r[R_ID]}`).value = val;
                else
                    document.getElementById(`reg_dft.${r[R_ID]}`).setAttribute('data-tooltip', 'Default: ' + val);
                
            } else {
                if (read_dft) {
                    let elem = document.getElementById(`reg_dft.${r[R_ID]}`);
                    elem.setAttribute('data-tooltip', 'Default: ' + reg2str(ret[0].dat.slice(1), r[R_ADDR] - start, r[R_FMT], r[R_SHOW]));
                } else {
                    let elem = document.getElementById(`reg.${r[R_ID]}`);
                    elem.value = reg2str(ret[0].dat.slice(1), r[R_ADDR] - start, r[R_FMT], r[R_SHOW]);
                }
            }
            
        }
    } else {
        console.warn('read reg err');
    }
    
    if (csa.cfg_reg_r[r_idx][3] == null && !read_dft) {
        console.log('read default');
        await read_reg_val(r_idx, true); 
    }
}


function str2reg(dat, ofs, fmt, show, str, s_idx) {
    let dv = new DataView(dat.buffer);
    fmt = fmt.replace(/\W/g, ''); // remove non-alphanumeric chars
    let str_a = str.split(' ');
    for (let f of fmt) {
        switch (f) {
        case 'c':
            switch (show) {
            case 1:  dat.set(hex2dat(str_a[s_idx], true).slice(0,1), ofs); break;
            case 2:  dat.set(hex2dat(str_a[s_idx]).slice(0,1), ofs); break;
            default: dat.set(str2dat(str[s_idx]), ofs);
            }
            ofs += 1; break;
        case 'b':
            switch (show) {
            case 1:  dat.set(hex2dat(str_a[s_idx], true).slice(0,1), ofs); break;
            case 2:  dat.set(hex2dat(str_a[s_idx]).slice(0,1), ofs); break;
            default: dv.setInt8(ofs, parseInt(str_a[s_idx]), true);
            }
            ofs += 1; break;
        case 'B':
            switch (show) {
            case 1:  dat.set(hex2dat(str_a[s_idx], true).slice(0,1), ofs); break;
            case 2:  dat.set(hex2dat(str_a[s_idx]).slice(0,1), ofs); break;
            default: dv.setUint8(ofs, parseInt(str_a[s_idx]), true);
            }
            ofs += 1; break;
        case 'h':
            switch (show) {
            case 1:  dat.set(hex2dat(str_a[s_idx], true).slice(0,2), ofs); break;
            case 2:  dat.set(hex2dat(str_a[s_idx]).slice(0,2), ofs); break;
            default: dv.setInt16(ofs, parseInt(str_a[s_idx]), true);
            }
            ofs += 2; break;
        case 'H':
            switch (show) {
            case 1:  dat.set(hex2dat(str_a[s_idx], true).slice(0,2), ofs); break;
            case 2:  dat.set(hex2dat(str_a[s_idx]).slice(0,2), ofs); break;
            default: dv.setUint16(ofs, parseInt(str_a[s_idx]), true);
            }
            ofs += 2; break;
        case 'i':
            switch (show) {
            case 1:  dat.set(hex2dat(str_a[s_idx], true).slice(0,4), ofs); break;
            case 2:  dat.set(hex2dat(str_a[s_idx]).slice(0,4), ofs); break;
            default: dv.setInt32(ofs, parseInt(str_a[s_idx]), true);
            }
            ofs += 4; break;
        case 'I':
            switch (show) {
            case 1:  dat.set(hex2dat(str_a[s_idx], true).slice(0,4), ofs); break;
            case 2:  dat.set(hex2dat(str_a[s_idx]).slice(0,4), ofs); break;
            default: dv.setUint32(ofs, parseInt(str_a[s_idx]), true);
            }
            ofs += 4; break;
        case 'f':
            switch (show) {
            case 1:  dat.set(hex2dat(str_a[s_idx], true).slice(0,4), ofs); break;
            case 2:  dat.set(hex2dat(str_a[s_idx]).slice(0,4), ofs); break;
            default: dv.setFloat32(ofs, parseFloat(str_a[s_idx]), true);
            }
            ofs += 4; break;
        }
        s_idx += 1;
    }
}

async function write_reg_val(w_idx) {
    let addr = csa.cfg_reg_w[w_idx][0];
    let len = csa.cfg_reg_w[w_idx][1];
    
    if (csa.cfg_reg_w[w_idx][2] == null) { // read-before-write
        let dat = new Uint8Array([0x00, 0, 0, len]);
        let dv = new DataView(dat.buffer);
        dv.setUint16(1, addr, true);
        
        await csa.proxy_sock.sendto({'dst': [csa.tgt, 0x5], 'dat': dat}, ['server', 'proxy']);
        console.log('read-before-write wait ret');
        let ret = await csa.proxy_sock.recvfrom(1000);
        console.log('read-before-write ret', ret);
        if (ret && ret[0].dat[0] == 0x80) {
            csa.cfg_reg_w[w_idx][2] = ret[0].dat.slice(1);
        } else {
            console.log('read-before-write err');
            return;
        }
    }
    
    let dat = new Uint8Array(3 + len);
    let dv = new DataView(dat.buffer);
    dv.setUint16(1, addr, true);
    dat[0] = 0x20;
    dat.set(csa.cfg_reg_w[w_idx][2], 3);
    
    console.info('begore write reg:', dat2hex(dat, ' '));

    let start = addr;
    let found_start = false;
    for (let i = 0; i < csa.cfg_reg.length; i++) {
        let r = csa.cfg_reg[i];
        
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
                let elem = document.getElementById(`reg.${r[R_ID]}.${n}`);
                str2reg(dat, r[R_ADDR]-start+one_size*n+3, r[R_FMT], r[R_SHOW], elem.value, 0);
            }
        }else if (r[R_FMT][0] == '[') {
            let one_size = fmt_size(r[R_FMT]);
            let count = Math.trunc(r[R_LEN] / one_size);
            let elem = document.getElementById(`reg.${r[R_ID]}`);
            for (let n = 0; n < count; n++)
                str2reg(dat, r[R_ADDR]-start+one_size*n+3, r[R_FMT], r[R_SHOW], elem.value, n);
            
        } else {
            let elem = document.getElementById(`reg.${r[R_ID]}`);
            str2reg(dat, r[R_ADDR]-start+3, r[R_FMT], r[R_SHOW], elem.value, 0);
        }
        
    }
    
    console.info('write reg:', dat2hex(dat, ' '));
    await csa.proxy_sock.sendto({'dst': [csa.tgt, 0x5], 'dat': dat}, ['server', 'proxy']);
    console.log('write reg wait ret');
    let ret = await csa.proxy_sock.recvfrom(1000);
    console.log('write reg ret', ret);
    if (ret && ret[0].dat[0] == 0x80) {
        console.log('write reg succeeded');
    } else {
        console.log('write reg err');
    }
}

export {
    fmt_size, reg2str, read_reg_val, str2reg, write_reg_val,
    R_ADDR, R_LEN, R_FMT, R_SHOW, R_ID, R_DESC
};
