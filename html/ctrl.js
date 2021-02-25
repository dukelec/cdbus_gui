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
import { init_reg_list, init_reg_rw, cal_reg_rw } from './reg_btn.js';
import { init_plots } from './plot.js';
import { dbg_raw_service, dbg_service } from './dbg.js';
import { init_iap } from './iap.js';
import { export_data, import_data } from './export.js';

let csa = {
    arg: {},            // url args
    db: null,
    
    ws_ns: null,
    cmd_sock: null,
    //proxy_sock_xxx: null,
    dbg_sock: null,     // port 9 debug
    dbg_raw_sock: null, // port 0xa debug
    
    cfg: {},            // device config
    dat: {
        reg_r: null,
        reg_w: null,
        reg_dft_r: [],  // first read flag
        reg_rbw: []     // read before write data
    },                  // runtime data
};


function init_ws() {
    let ws_url = `ws://${window.location.hostname}:8910/${csa.arg.tgt}`;
    let ws = new WebSocket(ws_url);
    
    ws.onopen = async function(evt) {
        console.log("ws onopen");
        csa.ws_ns.connections['server'] = ws;
        
        csa.cmd_sock.flush();
        await csa.cmd_sock.sendto({'action': 'get_cfg', 'cfg': csa.arg.cfg}, ['server', 'file']);
        let dat = await csa.cmd_sock.recvfrom(500);
        console.log('get_cfg ret', dat);
        csa.cfg = dat[0];
        
        dbg_service();
        init_reg_list();
        await init_reg_rw();
        //cal_reg_rw('r');
        init_plots();
        dbg_raw_service();
        init_iap();
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
    let elem = document.getElementById('dev_info');
    elem.style.background = '#D5F5E3';
    elem.innerHTML = 'Reading ...';
    
    csa.cmd_sock.flush();
    await csa.cmd_sock.sendto({'action': 'get'}, ['server', 'dev']);
    let dat = await csa.cmd_sock.recvfrom(500);
    if (!dat) {
        elem.style.background = '#F5B7B180';
        elem.innerHTML = 'WebSocket timeout';
        return;
    } else if (!dat[0].online) {
        elem.style.background = '#F5B7B180';
        elem.innerHTML = 'Serial disconnected';
        return;
    }
    
    csa.proxy_sock_info.flush();
    await csa.proxy_sock_info.sendto({'dst': [csa.arg.tgt, 0x1], 'dat': new Uint8Array([0x00])}, ['server', 'proxy']);
    console.log('read info wait ret');
    let ret = await csa.proxy_sock_info.recvfrom(500);
    console.log('read info ret', ret);
    if (ret) {
        elem.innerHTML = `${dat2str(ret[0].dat.slice(1))}`;
        elem.style.background = '#D5F5E360';
        setTimeout(() => { elem.style.background = ''; }, 100);
    } else {
        elem.innerHTML = 'Timeout';
        elem.style.background = '#F5B7B180';
    }
};

document.getElementById('dev_read_all').onclick = async function() {
    document.getElementById('dev_read_all').disabled = true;
    for (let i = 0; i < csa.dat.reg_r.length; i++) {
        let ret = await read_reg_val(i);
        if (ret)
            break;
    }
    document.getElementById('dev_read_all').disabled = false;
};

document.getElementById('dev_write_all').onclick = async function() {
    document.getElementById('dev_write_all').disabled = true;
    for (let i = 0; i < csa.dat.reg_w.length; i++) {
        let ret = await write_reg_val(i);
        if (ret)
            break;
    }
    document.getElementById('dev_write_all').disabled = false;
};

document.getElementById(`export_btn`).onclick = export_data;
document.getElementById(`import_btn`).onclick = import_data;

let read_timer = null;
async function period_read() {
    if (!document.getElementById('keep_read').checked) {
        if (read_timer)
            clearTimeout(read_timer);
        read_timer = null;
        return;
    }
    await document.getElementById('dev_read_all').onclick();
    read_timer = setTimeout(period_read, document.getElementById('read_period').value);
}
document.getElementById(`keep_read`).onclick = period_read;


window.addEventListener('load', async function() {
    console.log("load ctrl");
    let url_arg = new URLSearchParams(location.search);

    csa.arg.tgt = url_arg.get('tgt')
    csa.arg.cfg = url_arg.get('cfg')
    csa.arg.name = url_arg.get('name')
    if (!csa.arg.tgt || !csa.arg.cfg) {
        alert("no tgt or cfg");
        return;
    }
    document.getElementById('tgt_name').innerHTML = ` - ${csa.arg.name} < ${csa.arg.tgt} | ${csa.arg.cfg} >`;
    
    csa.ws_ns = new CDWebSocketNS(`/${csa.arg.tgt}`);
    csa.cmd_sock = new CDWebSocket(csa.ws_ns, 'cmd');
    csa.proxy_sock_info = new CDWebSocket(csa.ws_ns, 0x00f0);
    csa.proxy_sock_regr = new CDWebSocket(csa.ws_ns, 0xcdcd); // default port
    csa.proxy_sock_regw = new CDWebSocket(csa.ws_ns, 0x00f1);
    csa.proxy_sock_plot = new CDWebSocket(csa.ws_ns, 0x00f2);
    csa.proxy_sock_iap = new CDWebSocket(csa.ws_ns, 0x00f3);
    csa.dbg_sock = new CDWebSocket(csa.ws_ns, 9);
    csa.dbg_raw_sock = new CDWebSocket(csa.ws_ns, 0xa);
    csa.db = await new Idb();
    init_ws();
});

export { csa };

