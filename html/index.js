/*
 * Software License Agreement (MIT License)
 *
 * Author: Duke Fong <d@d-l.io>
 */

import { L } from './lang/lang.js'
import {
    escape_html, date2num,
    read_file, download, readable_size, blob2dat } from './utils/helper.js'
//import { konva_zoom, konva_responsive } from './utils/konva_helper.js';
import { CDWebSocket, CDWebSocketNS } from './utils/cd_ws.js';
import { Idb } from './utils/idb.js';

let db = null;
let ws_ns = new CDWebSocketNS('/');
let cmd_sock = new CDWebSocket(ws_ns, 'cmd');


async function ui_init_service() {
    let ui_init_sock = new CDWebSocket(ws_ns, 'update_ui');
    while (true) {
        let dat = await ui_init_sock.recvfrom();
        console.log('ui_init get', dat);
        await ui_init_sock.sendto({'status': 'ok'}, dat[1]);
    }
}

function init_ws() {
    let ws_url = 'ws://' + window.location.hostname + ':8080';
    let ws = new WebSocket(ws_url);
    
    ws.onopen = function(evt) {
        console.log("ws onopen");
        ws_ns.connections['server'] = ws;
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
};

document.getElementById('btn_dev_close').onclick = async function() {
    console.log('start close');
    await cmd_sock.sendto({'action': 'close'}, ['server', 'dev']);
    let dat = await cmd_sock.recvfrom(1000);
    console.log('btn_dev_close ret', dat);
};


window.addEventListener('load', async function() {
    console.log("load app");
    db = await new Idb();
    ui_init_service();
    init_ws();
});



