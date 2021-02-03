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
import { init_reg_list, update_reg_rw_btn, cal_reg_rw, button_edit, toggle_group, toggle_enable } from './reg_btn.js';
import { init_plots } from './plot.js';
import { dbg_raw_service, dbg_service } from './dbg.js';
import { init_iap, do_iap } from './iap.js';
import { export_data, import_data } from './export.js';

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
    let ws_url = `ws://${window.location.hostname}:8910/${csa.arg.tgt}`;
    let ws = new WebSocket(ws_url);
    
    ws.onopen = async function(evt) {
        console.log("ws onopen");
        csa.ws_ns.connections['server'] = ws;
        
        await csa.cmd_sock.sendto({'action': 'get_cfg', 'cfg': csa.arg.cfg}, ['server', 'file']);
        let dat = await csa.cmd_sock.recvfrom(1000);
        console.log('get_cfg ret', dat);
        csa.cfg = dat[0];
        
        init_reg_list();
        update_reg_rw_btn('r');
        update_reg_rw_btn('w');
        //cal_reg_rw('r');
        init_plots();
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
    document.getElementById('dev_info').innerHTML = 'reading ...';
    
    await csa.cmd_sock.sendto({'action': 'get'}, ['server', 'dev']);
    let dat = await csa.cmd_sock.recvfrom(500);
    if (!dat || !dat[0].online) {
        alert('Serial disconnected');
        return;
    }
    
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

document.getElementById('iap_btn').onclick = do_iap;
document.getElementById(`export_btn`).onclick = export_data;
document.getElementById(`import_btn`).onclick = import_data;
document.getElementById(`button_edit`).onclick = button_edit;
document.getElementById(`toggle_group`).onclick = toggle_group;
document.getElementById(`toggle_enable`).onclick = toggle_enable;


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
    csa.proxy_sock = new CDWebSocket(csa.ws_ns, 0xcdcd);
    csa.dbg_sock = new CDWebSocket(csa.ws_ns, 9);
    csa.dbg_raw_sock = new CDWebSocket(csa.ws_ns, 0xa);
    csa.db = await new Idb();
    
    dbg_service();
    dbg_raw_service();
    init_ws();
});

export { csa };

