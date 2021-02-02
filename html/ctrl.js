/*
 * Software License Agreement (MIT License)
 *
 * Author: Duke Fong <d@d-l.io>
 */

import { L } from './lang/lang.js';
import { escape_html, date2num, val2hex, dat2str, dat2hex, hex2dat,
         read_file, download, readable_size, blob2dat } from './utils/helper.js';
//import { konva_zoom, konva_responsive } from './utils/konva_helper.js';
import { CDWebSocket, CDWebSocketNS } from './utils/cd_ws.js';
import { Idb } from './utils/idb.js';
import { fmt_size, reg2str, read_reg_val, str2reg, write_reg_val,
         R_ADDR, R_LEN, R_FMT, R_SHOW, R_ID, R_DESC } from './reg_rw.js';
import { init_reg_list, update_reg_rw_btn, cal_reg_rw } from './reg_btn.js';
import { init_plots } from './plot.js';
import { dbg_raw_service, dbg_service } from './dbg.js';

let csa = {
    arg: {},            // url args
    db: null,
    
    ws_ns: null,
    cmd_sock: null,
    proxy_sock: null,
    dbg_sock: null,     // port 9 debug
    dbg_raw_sock: null, // port 0xa debug
    
    cfg: {},            // device config
    dat: {
        reg_dft_r: [],  // first read flag
        reg_rbw: []     // read before write data
    },                  // runtime data
};


function init_ws() {
    let ws_url = `ws://${window.location.hostname}:8080/${csa.arg.tgt}`;
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


document.getElementById('dev_read_info').onclick = async function() {
    document.getElementById('dev_info').innerHTML = 'reading ...';
    await csa.proxy_sock.sendto({'dst': [csa.arg.tgt, 0x1], 'dat': new Uint8Array([0x00])}, ['server', 'proxy']);
    console.log('read info wait ret');
    let ret = await csa.proxy_sock.recvfrom(1000);
    console.log('read info ret', ret);
    if (ret)
        document.getElementById('dev_info').innerHTML = `${dat2str(ret[0].dat.slice(1))}`;
    else
        document.getElementById('dev_info').innerHTML = 'time out';
};

document.getElementById('dev_read_all').onclick = async function() {
    for (let i = 0; i < csa.cfg.reg_r.length; i++)
        await read_reg_val(i);
};

document.getElementById('dev_write_all').onclick = async function() {
    for (let i = 0; i < csa.cfg.reg_w.length; i++)
        await write_reg_val(i);
};


window.addEventListener('load', async function() {
    console.log("load ctrl");
    let url_arg = new URLSearchParams(location.search);

    csa.arg.tgt = url_arg.get('tgt')
    csa.arg.cfg = url_arg.get('cfg')
    if (!csa.arg.tgt || !csa.arg.cfg) {
        alert("no tgt or cfg");
        return;
    }
    
    csa.ws_ns = new CDWebSocketNS(`/${csa.arg.tgt}`);
    csa.cmd_sock = new CDWebSocket(csa.ws_ns, 'cmd');
    csa.proxy_sock = new CDWebSocket(csa.ws_ns, 0xcdcd);
    csa.dbg_sock = new CDWebSocket(csa.ws_ns, 9);
    csa.dbg_raw_sock = new CDWebSocket(csa.ws_ns, 0xa);
    csa.db = await new Idb();
    
    dbg_service();
    dbg_raw_service();
    init_ws();

    // fmt: [c]: string, b: int8_t, B: uint8_t, h: int16_t, H: uint16_t, i: int32_t, I: uint32_t, f: float
    // show: 0: normal, 1: hex, 2: bytes
    csa.cfg.reg = [
        [ 0x0002, 2,  'H',     1, 'conf_ver',     'Magic Code: 0xcdcd' ],
        [ 0x0004, 1,  'B',     0, 'conf_from',    '0: default config, 1: load from flash' ],
        [ 0x000c, 4,  'I',     0, 'bus_baud_low', 'RS-485 baud rate for first byte' ],
        [ 0x0016, 3,  '[B]',   2, 'dbg_dst_addr', 'Send debug message to this address' ],
        [ 0x0164, 24, '{H,H}', 1, 'dbg_raw[0]',   'Config raw debug for current loop' ],
        [ 0x0208, 4,  'i',     0, 'tc_pos',       'Set target position' ],
        [ 0x0300, 10, '[c]',   0, 'test_str',     'test string' ]
    ];
    csa.cfg.reg_r = [
        // addr   len
        [ 0x0002, 0x3],
        [ 0x000c, 0x16-0xc+3],
        [ 0x000164, 24+4],
    ];
    csa.cfg.reg_w = [
        // addr   len
        [ 0x0002, 0x3],
        [ 0x000c, 0x16-0xc+3],
        [ 0x000164, 24+4],
    ];
    csa.cfg.plot = {
        'mask_addr': 0x0162, // uint8_t raw dbg mask
        'color_dft': [ '#00000080', 'green', 'blue', 'yellow', 'black', 'red', 'cyan', 'purple' ], // start from index 1
        'fmt': [
            'I1.fffHH - N, I, A, V, P', // number before . is cnt_inc (>= 1)
            'I.bbFBB - N, n1, n2, p1, p2'
        ],
        'color': [ // use color_dft if not exist
        ],
        'depth': [ 1000, 1000 ], // limit depth, 0: no limit
        'cal': [
            [ 'diff13: _D(1) - _D(3)' ] // data1 - data3
        ]
    };
    csa.cfg.pic = {
        'fmt': 'jpg'
    };
    
    init_reg_list();
    update_reg_rw_btn('r');
    update_reg_rw_btn('w');
    cal_reg_rw('r');
    init_plots();
});

export { csa };

