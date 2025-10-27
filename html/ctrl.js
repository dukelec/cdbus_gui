/*
 * Software License Agreement (MIT License)
 *
 * Author: Duke Fong <d@d-l.io>
 */

import { L } from './utils/lang.js'
import { escape_html, date2num, val2hex, dat2str, dat2hex, hex2dat,
         read_file, download, readable_size, blob2dat } from './utils/helper.js';
import { CDWebSocket, CDWebSocketNS } from './utils/cd_ws.js';
import { Idb } from './utils/idb.js';
import { csa, alloc_port } from './common.js';
import { init_reg } from './plugins/reg.js';
import { init_plot } from './plugins/plot.js';
import { init_dbg } from './plugins/dbg.js';
import { init_pic } from './plugins/pic.js';
import { init_iap } from './plugins/iap.js';
import { init_export } from './plugins/export.js';


function init_ws() {
    let ws_url = `ws://${window.location.hostname}:8910/${csa.arg.tgt}`;
    let ws = new WebSocket(ws_url);
    
    ws.onopen = async function(evt) {
        console.log("ws onopen");
        csa.ws_ns.connections['server'] = ws;
        
        csa.cmd_sock.flush();
        await csa.cmd_sock.sendto({'action': 'get_cfg', 'cfg': csa.arg.cfg}, ['server', 'cfgs']);
        let dat = await csa.cmd_sock.recvfrom(2000);
        console.log('get_cfg ret', dat[0]);
        csa.cfg = dat[0];
        
        await alloc_port('clr_all');
        await init_reg();
        await init_dbg();
        await init_plot();
        await init_pic();
        await init_iap();
        await init_export();
        
        let port = await alloc_port();
        csa.proxy_sock_info = new CDWebSocket(csa.ws_ns, port);
        document.getElementById('dev_read_info').click();
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
    elem.innerText = 'Reading ...';
    
    csa.cmd_sock.flush();
    await csa.cmd_sock.sendto({'action': 'get'}, ['server', 'dev']);
    let dat = await csa.cmd_sock.recvfrom(1000);
    if (!dat) {
        elem.style.background = '#F5B7B180';
        elem.innerText = 'WebSocket timeout';
        return;
    } else if (dat[0] != 'udp' && !dat[0].online) {
        elem.style.background = '#F5B7B180';
        elem.innerText = L('Serial disconnected');
        return;
    }
    
    csa.proxy_sock_info.flush();
    await csa.proxy_sock_info.sendto({'dst': [csa.arg.tgt, 0x1], 'dat': new Uint8Array([])}, ['server', 'proxy']);
    console.log('read info wait ret');
    let ret = await csa.proxy_sock_info.recvfrom(1000);
    console.log('read info ret', ret);
    if (ret) {
        elem.innerText = `${dat2str(ret[0].dat)}`;
        elem.style.background = '#D5F5E360';
        setTimeout(() => { elem.style.background = ''; }, 100);
    } else {
        elem.innerText = 'Timeout';
        elem.style.background = '#F5B7B180';
    }
};


window.addEventListener('load', async function() {
    console.log("load ctrl");
    
    // apply translation
    for (let tag of ['button', 'span', 'option', 'td']) {
        let elems = document.getElementsByTagName(tag);
        for (let e of elems) {
            e.innerHTML = eval("`" + e.innerHTML + "`");
            if (e.title)
                e.title = eval("`" + e.title + "`");
        }
    }
    
    let url_arg = new URLSearchParams(location.search);

    csa.arg.tgt = url_arg.get('tgt')
    csa.arg.cfg = url_arg.get('cfg')
    csa.arg.name = url_arg.get('name')
    if (!csa.arg.tgt || !csa.arg.cfg) {
        alert("no tgt or cfg");
        return;
    }
    document.getElementById('tgt_name').innerText = ` - ${csa.arg.name} < ${csa.arg.tgt} | ${csa.arg.cfg} >`;
    
    csa.ws_ns = new CDWebSocketNS(`/${csa.arg.tgt}`);
    csa.cmd_sock = new CDWebSocket(csa.ws_ns, 'cmd');
    
    csa.db = await new Idb();
    init_ws();
});

export { csa };

