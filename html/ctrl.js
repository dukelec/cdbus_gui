/*
 * Software License Agreement (MIT License)
 *
 * Author: Duke Fong <d@d-l.io>
 */

import { L } from './lang/lang.js'
import {
    escape_html, date2num, val2hex,
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
        
        // read dev info for test
        await csa.proxy_sock.sendto({'dst': [csa.tgt, 0x1], 'dat': new Uint8Array([0x00])}, ['server', 'proxy']);
        console.log('proxy wait ret');
        let ret = await csa.proxy_sock.recvfrom(1000);
        console.log('proxy ret', ret);
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
                      <input type="text" id="reg.${reg[R_ID]}.${n}">
                    </span> ${reg[R_SHOW] == 0 ? '' : (reg[R_SHOW] == 1 ? 'H' : 'B')} <br>
                `; 
            }
        } else {
            html_input = `
                <span class="has-tooltip-arrow has-tooltip-left" data-tooltip="dft val" id="reg_dft.${reg[R_ID]}">
                  <input type="text" id="reg.${reg[R_ID]}">
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

function read_reg_val(r_idx, read_dft=false) {
    // 
}


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
        // addr   len
        [ 0x0002, 0x3],
        [ 0x000c, 0x168-0xc+24],
    ];
    csa.cfg_reg_w = [
        // addr   len
        [ 0x0002, 0x3],
        [ 0x0208, 0x4],
    ];
    
    init_reg_list();
    update_reg_rw_btn('r');
    update_reg_rw_btn('w');
    cal_reg_rw('r');
});



