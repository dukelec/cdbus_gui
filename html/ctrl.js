/*
 * Software License Agreement (MIT License)
 *
 * Author: Duke Fong <d@d-l.io>
 */

import { L } from './lang/lang.js'
import {
    escape_html, date2num, val2hex, dat2str, dat2hex, hex2dat,
    read_file, download, readable_size, blob2dat } from './utils/helper.js'
//import { konva_zoom, konva_responsive } from './utils/konva_helper.js';
import { CDWebSocket, CDWebSocketNS } from './utils/cd_ws.js';
import { Idb } from './utils/idb.js';

const R_ADDR = 0; const R_LEN = 1; const R_FMT = 2;
const R_SHOW = 3; const R_ID = 4; const R_DESC = 5;

let csa = {
    db: null,
    ws_ns: null,
    cmd_sock: null,
    proxy_sock: null
};

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

async function ui_init_service() {
    let ui_init_sock = new CDWebSocket(csa.ws_ns, 'update_ui');
    while (true) {
        let dat = await ui_init_sock.recvfrom();
        console.log('ui_init get', dat);
        await ui_init_sock.sendto({'status': 'ok'}, dat[1]);
    }
}

function init_ws() {
    let ws_url = `ws://${window.location.hostname}:8080/${csa.tgt}`;
    let ws = new WebSocket(ws_url);
    
    ws.onopen = async function(evt) {
        console.log("ws onopen");
        csa.ws_ns.connections['server'] = ws;
    }
    ws.onmessage = async function(evt) {
        let dat = await blob2dat(evt.data);
        var msg = msgpack.deserialize(dat);
        //console.log("Received dat", msg);
        if (msg['dst'][1] in csa.ws_ns.sockets) {
            let sock = csa.ws_ns.sockets[msg['dst'][1]];
            sock.recv_q.put([msg['dat'], msg['src']]);
        } else {
            console.log("ws drop msg:", msg);
        }
    }
    ws.onerror = function(evt) {
        console.log("ws onerror: ", evt);
        document.body.style.backgroundColor = "gray";
    }
    ws.onclose = function(evt) {
        delete csa.ws_ns.connections['server'];
        console.log('ws disconnected');
        document.body.style.backgroundColor = "gray";
    }
}



function init_reg_list() {

    let list = document.getElementById('reg_list0');
    list.innerHTML = '';
    
    for (let i = 0; i < csa.cfg_reg.length; i++) {
        let reg = csa.cfg_reg[i];
        
        let html_input = '';
        
        if (reg[R_FMT][0] == '{') {
            let count = Math.trunc(reg[R_LEN] / fmt_size(reg[R_FMT]));
            for (let n = 0; n < count; n++) {
                html_input += `
                    <span class="has-tooltip-arrow has-tooltip-left" data-tooltip="dft val" id="reg_dft.${reg[R_ID]}">
                      <input type="text" style="font-family: monospace;" id="reg.${reg[R_ID]}.${n}">
                    </span> ${reg[R_SHOW] == 0 ? '' : (reg[R_SHOW] == 1 ? 'H' : 'B')} <br>
                `; 
            }
        } else {
            html_input = `
                <span class="has-tooltip-arrow has-tooltip-left" data-tooltip="dft val" id="reg_dft.${reg[R_ID]}">
                  <input type="text" style="font-family: monospace;" id="reg.${reg[R_ID]}">
                </span> ${reg[R_SHOW] == 0 ? '' : (reg[R_SHOW] == 1 ? 'H' : 'B')}
            `; 
        }
        
        
        let html = `
            <div class="columns is-mobile is-gapless">
              <div class="column">
                <div class="level is-mobile">
                  <span class="level-left has-tooltip-arrow has-tooltip-multiline has-tooltip-right" data-tooltip="${reg[R_DESC]}">${reg[R_ID]}</span>
                  <span class="level-right" style="margin: 0 8px 0 4px; font-family: monospace;">0x${val2hex(reg[R_ADDR])}</span>
                </div>
              </div>
              <div class="column" style="margin: 5px 0 5px 0;">
                ${html_input}
              </div>
              <div class="column is-1 reg_btn_rw" id="reg_btn_r.${reg[R_ID]}">R</div>
              <div class="column is-1 reg_btn_rw" id="reg_btn_w.${reg[R_ID]}">W</div>
            </div>`;
        list.insertAdjacentHTML('beforeend', html);
        //list.lastElementChild.getElementsByTagName("button")[0].onclick = async function() { };
    }
}


function in_reg_rw(reg_rw, addr) { // test if in range
    for (let i = 0; i < reg_rw.length; i++) {
        if (addr >= reg_rw[i][0] && addr < reg_rw[i][0] + reg_rw[i][1])
            return i;
    }
    return null;
}

function update_reg_rw_btn(rw='r') {
    let reg_rw = rw == 'r' ? csa.cfg_reg_r : csa.cfg_reg_w;
    
    for (let i = 0; i < csa.cfg_reg.length; i++) {
        let reg_pre = null;
        let reg_next = null;
        let btn_pre = null;
        let btn_next = null;
        let rw_idx_pre = null;
        let rw_idx_next = null;
        let reg = csa.cfg_reg[i];
        let btn = document.getElementById(`reg_btn_${rw}.${reg[R_ID]}`);
        let rw_idx = in_reg_rw(reg_rw, reg[R_ADDR]);
        if (i > 0) {
            reg_pre = csa.cfg_reg[i-1];
            btn_pre = document.getElementById(`reg_btn_${rw}.${reg_pre[R_ID]}`);
            rw_idx_pre = in_reg_rw(reg_rw, reg_pre[R_ADDR]);
        }
        if (i < csa.cfg_reg.length - 2) {
            reg_next = csa.cfg_reg[i+1];
            btn_next = document.getElementById(`reg_btn_${rw}.${reg_next[R_ID]}`);
            rw_idx_next = in_reg_rw(reg_rw, reg_next[R_ADDR]);
        }
        
        let color = rw == 'r' ? '#D5F5E3' : '#D6EAF8';
        btn.style['border-radius'] = '';
        btn.style['border-width'] = '';
        btn.style['background'] = '';
        btn.style['margin-top'] = '';
        btn.style['margin-bottom'] = '';
        
        if (rw_idx != null) {
            btn.style['background'] = color;
            let disconn_pre = false;
            let disconn_next = false;
            if (reg_pre && reg_pre[R_ADDR] + reg_pre[R_LEN] != reg[R_ADDR])
                disconn_pre = true;
            if (reg_next && reg[R_ADDR] + reg[R_LEN] != reg_next[R_ADDR])
                disconn_next = true;
            
            if (rw_idx == rw_idx_pre && rw_idx != rw_idx_next) {
                btn.style['margin-top'] = '0';
                btn.style['border-width'] = '0 0.1px 0.1px 0.1px';
                if (!disconn_pre)
                    btn.style['border-radius'] = '0 0 6px 6px';
                    
            } else if (rw_idx == rw_idx_pre && rw_idx == rw_idx_next) {
                btn.style['margin-top'] = '0';
                btn.style['margin-bottom'] = '0';
                btn.style['border-width'] = '0 0.1px 0 0.1px';
                
                if (!disconn_pre && !disconn_next)
                    btn.style['border-radius'] = '0 0 0 0';
                else if (disconn_pre && !disconn_next)
                    btn.style['border-radius'] = '6px 6px 0 0';
                else if (!disconn_next && disconn_next)
                    btn.style['border-radius'] = '0 0 6px 6px';
                    
            } else if (rw_idx != rw_idx_pre && rw_idx == rw_idx_next) {
                btn.style['margin-bottom'] = '0';
                btn.style['border-width'] = '0.1px 0.1px 0 0.1px';
                if (!disconn_next)
                    btn.style['border-radius'] = '6px 6px 0 0';
            }
        }
    }
}

function cal_reg_rw(rw='r') {
    let reg_rw = [];
    let start = null;
    
    for (let i = 0; i < csa.cfg_reg.length; i++) {
        let reg = csa.cfg_reg[i];
        let btn = document.getElementById(`reg_btn_${rw}.${reg[R_ID]}`);
        
        if (btn.style['background'] != '') {
            if (btn.style['margin-top'] == '' )
                start = reg[R_ADDR];
            if (btn.style['margin-bottom'] == '' ) {
                reg_rw.push([start, reg[R_ADDR] + reg[R_LEN] - start]);
            }
        }
    }
    return reg_rw;
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
                    let elem = document.getElementById(`reg.${r[R_ID]}.${n}`);
                    elem.value = reg2str(ret[0].dat.slice(1), r[R_ADDR] - start + one_size * n, r[R_FMT], r[R_SHOW]);
                }
            }else if (r[R_FMT][0] == '[') {
                let one_size = fmt_size(r[R_FMT]);
                let count = Math.trunc(r[R_LEN] / one_size);
                let elem = document.getElementById(`reg.${r[R_ID]}`);
                elem.value = '';
                for (let n = 0; n < count; n++)
                    elem.value = [elem.value, reg2str(ret[0].dat.slice(1), r[R_ADDR] - start + one_size * n, r[R_FMT], r[R_SHOW])].filter(Boolean).join(' ');
                
            } else {
                let elem = document.getElementById(`reg.${r[R_ID]}`);
                elem.value = reg2str(ret[0].dat.slice(1), r[R_ADDR] - start, r[R_FMT], r[R_SHOW]);
            }
            
        }
    } else {
        console.warn('read reg err');
    }
}

function str2reg(dat, ofs, fmt, show, str, s_idx) {
    console.log(`str2reg: ${ofs}, ${fmt}, ${show}, ${str}, ${s_idx}`);
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
}


document.getElementById('dev_read_info').onclick = async function() {
    document.getElementById('dev_info').innerHTML = 'reading ...';
    await csa.proxy_sock.sendto({'dst': [csa.tgt, 0x1], 'dat': new Uint8Array([0x00])}, ['server', 'proxy']);
    console.log('read info wait ret');
    let ret = await csa.proxy_sock.recvfrom(1000);
    console.log('read info ret', ret);
    if (ret)
        document.getElementById('dev_info').innerHTML = `${dat2str(ret[0].dat.slice(1))}`;
    else
        document.getElementById('dev_info').innerHTML = 'time out';
};

document.getElementById('dev_read_all').onclick = async function() {
    for (let i = 0; i < csa.cfg_reg_r.length; i++)
        await read_reg_val(i);
};

document.getElementById('dev_write_all').onclick = async function() {
    for (let i = 0; i < csa.cfg_reg_w.length; i++)
        await write_reg_val(i);
};


window.addEventListener('load', async function() {
    console.log("load ctrl");
    let url_arg = new URLSearchParams(location.search);

    csa.tgt = url_arg.get('tgt')
    csa.cfg = url_arg.get('cfg')
    if (!csa.tgt || !csa.cfg) {
        alert("no tgt or cfg");
        return;
    }
    
    csa.ws_ns = new CDWebSocketNS(`/${csa.tgt}`);
    csa.cmd_sock = new CDWebSocket(csa.ws_ns, 'cmd');
    csa.proxy_sock = new CDWebSocket(csa.ws_ns, 0xcdcd);
    csa.db = await new Idb();
    
    ui_init_service();
    init_ws();

    // fmt: [c]: string, b: int8_t, B: uint8_t, h: int16_t, H: uint16_t, i: int32_t, I: uint32_t, f: float
    // show: 0: normal, 1: hex, 2: bytes
    csa.cfg_reg = [
        [ 0x0002, 2,  'H',     1, 'conf_ver',     'Magic Code: 0xcdcd' ],
        [ 0x0004, 1,  'B',     0, 'conf_from',    '0: default config, 1: load from flash' ],
        [ 0x000c, 4,  'I',     0, 'bus_baud_low', 'RS-485 baud rate for first byte' ],
        [ 0x0016, 3,  '[B]',   2, 'dbg_dst_addr', 'Send debug message to this address' ],
        [ 0x0168, 24, '{H,H}', 1, 'dbg_raw[0]',   'Config raw debug for current loop' ],
        [ 0x0208, 4,  'i',     0, 'tc_pos',       'Set target position' ],
        [ 0x0300, 10, '[c]',   0, 'test_str',     'test string' ]
    ];
    csa.cfg_reg_r = [
        // addr   len           dat   dft
        [ 0x0002, 0x3,          null, null],
        [ 0x000c, 0x16-0xc+3,   null, null],
        [ 0x000168, 24+4,       null, null],
    ];
    csa.cfg_reg_w = [
        // addr   len           read-before-write (not change reserved value)
        [ 0x0002, 0x3,          null],
        [ 0x000c, 0x16-0xc+3,   null],
        [ 0x000168, 24+4,       null],
    ];
    
    init_reg_list();
    update_reg_rw_btn('r');
    update_reg_rw_btn('w');
    cal_reg_rw('r');
});



