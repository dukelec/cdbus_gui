/*
 * Software License Agreement (MIT License)
 *
 * Author: Duke Fong <d@d-l.io>
 */

import { L } from './utils/lang.js?v=__V__'
import { escape_html, date2num, val2hex, dat2str, dat2hex, hex2dat,
         read_file, download, readable_size, blob2dat } from './utils/helper.js?v=__V__';
import { CDWebSocket, CDWebSocketNS } from './utils/cd_ws.js?v=__V__';
import { Idb } from './utils/idb.js?v=__V__';
import { csa, init_nav, alloc_port, show_banner, ws_closed, init_sys } from './common.js?v=__V__';
import { init_reg } from './plugins/reg.js?v=__V__';
import { init_plot } from './plugins/plot.js?v=__V__';
import { init_dbg } from './plugins/dbg.js?v=__V__';
import { init_pic } from './plugins/pic.js?v=__V__';
import { init_iap } from './plugins/iap.js?v=__V__';
import { init_export } from './plugins/export.js?v=__V__';
import { init_api } from './plugins/api.js?v=__V__';


function init_ws() {
    let ws_url = `ws://${window.location.hostname}:${window.location.port}/${csa.arg.tgt}`;
    let ws = new WebSocket(ws_url);
    
    ws.onopen = async function(evt) {
        console.log("ws onopen");
        csa.ws_ns.connections['server'] = ws;
        
        csa.cmd_sock.flush();
        await csa.cmd_sock.sendto({'action': 'get_cfg', 'cfg': csa.arg.cfg}, ['server', 'cfgs']);
        let dat = await csa.cmd_sock.recvfrom(2000);
        if (!dat) {
            if ('server' in csa.ws_ns.connections)
                show_banner('ws_banner', `<b>${L('No reply from backend, please check the backend log and reload the page.')}</b>`);
            return;
        }
        console.log('get_cfg ret', dat[0]);
        if (typeof dat[0] == 'string' && dat[0].startsWith('err:')) {
            show_banner('ws_banner', `<b>${escape_html(dat[0])}</b>`);
            return;
        }
        csa.cfg = dat[0];
        
        await init_sys();
        await alloc_port('clr_all');
        await init_reg();
        await init_dbg();
        await init_plot();
        await init_pic();
        await init_iap();
        await init_export();
        await init_api();
        
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
    }
    ws.onclose = function(evt) {
        delete csa.ws_ns.connections['server'];
        console.log('ws disconnected', evt.code, evt.reason);
        ws_closed(evt);
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
    } else if (dat[0] != 'udp' && dat[0].online == 3) {
        elem.style.background = '#F5B7B180';
        elem.innerText = L('Device thread dead, please re-open');
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
    
    init_nav();     // translate the page and draw the top bar
    
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

