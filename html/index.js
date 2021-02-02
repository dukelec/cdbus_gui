/*
 * Software License Agreement (MIT License)
 *
 * Author: Duke Fong <d@d-l.io>
 */

import { L } from './lang/lang.js'
import { escape_html, date2num, val2hex, dat2str, dat2hex, hex2dat,
         read_file, download, readable_size, blob2dat } from './utils/helper.js';
//import { konva_zoom, konva_responsive } from './utils/konva_helper.js';
import { CDWebSocket, CDWebSocketNS } from './utils/cd_ws.js';
import { Idb } from './utils/idb.js';

let db = null;
let ws_ns = new CDWebSocketNS('/');
let cmd_sock = new CDWebSocket(ws_ns, 'cmd');
let dbg_sock = new CDWebSocket(ws_ns, 9);
let cfgs = null;


async function dbg_service() {
    document.getElementById('log_clear').onclick = () => {
        document.getElementById('dev_log').innerHTML = '';
    };
    document.getElementById('log_blank').onclick = () => {
        document.getElementById('dev_log').innerHTML += '<br>';
    };
    
    let ansi_up = new AnsiUp;
    while (true) {
        let dat = await dbg_sock.recvfrom();
        console.log('dbg get', dat);
        let elem = document.getElementById('dev_log');
        let txt = `${new Date().getTime()} [${dat[0].src[0]}]: ${dat2str(dat[0].dat.slice(1))}`;
        let html = ansi_up.ansi_to_html(txt);
        elem.innerHTML = [elem.innerHTML, html].filter(Boolean).join('<br>');
        elem.scrollBy(0, 100); // TODO: allow disable sroll; allow insert newline on UI
    }
}


async function ui_init_service() {
    let ui_init_sock = new CDWebSocket(ws_ns, 'update_ui');
    while (true) {
        let dat = await ui_init_sock.recvfrom();
        console.log('ui_init get', dat);
        await ui_init_sock.sendto({'status': 'ok'}, dat[1]);
    }
}


async function init_serial_cfg() {
    let ser_cfg = await db.get('tmp', 'ser_cfg');
    let port = document.getElementById('dev_port');
    let baud = document.getElementById('dev_baud');
    let bridge = document.getElementById('dev_bridge');
    
    if (ser_cfg) {
        port.value = ser_cfg.port;
        baud.value = ser_cfg.baud;
        bridge.checked = ser_cfg.bridge;
    }
    
    port.onchange = baud.onchange = bridge.onchange = async () => {
        await db.set('tmp', 'ser_cfg', {
            port: port.value,
            baud: baud.value,
            bridge: bridge.checked
        });
    };
}

async function init_cfg_list() {
    let sel_ops = '<option value=""></option>';
    for (let op of cfgs)
        sel_ops += `<option value="${op}">${op}</option>`;
    let list = document.getElementById('cfg_list');
    
    let devs = await db.get('tmp', 'dev_list');
    for (let i = 0; i < 10; i++) {
        let tgt = (devs && devs[i]) ? devs[i].tgt : `80:00:${val2hex(i+1,2)}`;
        let cfg = (devs && devs[i]) ? devs[i].cfg : '';
        let name = (devs && devs[i]) ? devs[i].name : '';
        let html = `
            <input type="text" value="${name}" id="cfg${i}.name">
            <input type="text" value="${tgt}" id="cfg${i}.tgt">
            <select id="cfg${i}.cfg" value="${cfg}">${sel_ops}</select>
            <button id="cfg${i}.btn">Open</button> <br>
        `;
        
        list.insertAdjacentHTML('beforeend', html);
        document.getElementById(`cfg${i}.cfg`).value = `${cfg}`;
        
        document.getElementById(`cfg${i}.btn`).onclick = async () => {
            let t = document.getElementById(`cfg${i}.tgt`).value;
            let c = document.getElementById(`cfg${i}.cfg`).value;
            console.log(`t: ${t}, c: ${c}`);
            if (!t || !c) {
                alert('empty not allowed');
                return;
            }
            window.open(`ctrl.html?tgt=${t}&cfg=${c}`, "_blank");
        };
        
        document.getElementById(`cfg${i}.name`).onchange =
                document.getElementById(`cfg${i}.tgt`).onchange =
                document.getElementById(`cfg${i}.cfg`).onchange = async () => {
            
            let devs = [];
            for (let n = 0; n < 10; n++) {
                devs.push({
                    tgt: document.getElementById(`cfg${n}.tgt`).value,
                    cfg: document.getElementById(`cfg${n}.cfg`).value,
                    name: document.getElementById(`cfg${n}.name`).value,
                });
            }
            await db.set('tmp', 'dev_list', devs);
        };
    }
}


function init_ws() {
    let ws_url = 'ws://' + window.location.hostname + ':8910';
    let ws = new WebSocket(ws_url);
    
    ws.onopen = async function(evt) {
        console.log("ws onopen");
        ws_ns.connections['server'] = ws;
        
        await cmd_sock.sendto({'action': 'get_cfgs'}, ['server', 'file']);
        let dat = await cmd_sock.recvfrom(1000);
        console.log('get_cfgs ret', dat);
        cfgs = dat[0];
        await init_cfg_list();
        await init_serial_cfg();
        await document.getElementById('btn_dev_get').onclick();
    }
    ws.onmessage = async function(evt) {
        let dat = await blob2dat(evt.data);
        var msg = msgpack.deserialize(dat);
        //console.log("Received dat", msg);
        var sock = ws_ns.sockets[msg['dst'][1]];
        sock.recv_q.put([msg['dat'], msg['src']]);
    }
    ws.onerror = function(evt) {
        console.log("ws onerror: ", evt);
        document.body.style.backgroundColor = "gray";
    }
    ws.onclose = function(evt) {
        delete ws_ns.connections['server'];
        console.log('ws disconnected');
        document.body.style.backgroundColor = "gray";
    }
}

    
document.getElementById('btn_dev_get').onclick = async function() {
    console.log('start get');
    await cmd_sock.sendto({'action': 'get'}, ['server', 'dev']);
    let dat = await cmd_sock.recvfrom(1000);
    console.log('btn_dev_get ret', dat);
    document.getElementById('dev_status').innerHTML = `${dat[0].port} | ${dat[0].online}`
    
    let list = document.getElementById('dev_list');
    list.innerHTML = '';
    
    let ports = dat[0].ports;

    if (ports) {
        for (let i = 0; i < ports.length; i++) { // escape
            let port = ports[i];
            let html = `<li>${port}</li>`;
            list.insertAdjacentHTML('beforeend', html);
            //list.lastElementChild.getElementsByTagName("button")[0].onclick = async function() { };
        }
    }
};

document.getElementById('btn_dev_open').onclick = async function() {
    console.log('start open');
    let port = document.getElementById('dev_port').value;
    let baud = parseInt(document.getElementById('dev_baud').value);
    let bridge = document.getElementById('dev_bridge').checked;
    await cmd_sock.sendto({'action': 'open', 'port': port, 'baud': baud, 'bridge': bridge}, ['server', 'dev']);
    let dat = await cmd_sock.recvfrom(1000);
    console.log('btn_dev_open ret', dat);
    await document.getElementById('btn_dev_get').onclick();
};

document.getElementById('btn_dev_close').onclick = async function() {
    console.log('start close');
    await cmd_sock.sendto({'action': 'close'}, ['server', 'dev']);
    let dat = await cmd_sock.recvfrom(1000);
    console.log('btn_dev_close ret', dat);
    await document.getElementById('btn_dev_get').onclick();
};


window.addEventListener('load', async function() {
    console.log("load app");
    db = await new Idb();
    ui_init_service();
    dbg_service();
    init_ws();
});



