/*
 * Software License Agreement (MIT License)
 *
 * Author: Duke Fong <d@d-l.io>
 */

import { L } from './utils/lang.js'
import { escape_html, date2num, timestamp, val2hex, dat2str, dat2hex, hex2dat,
         read_file, download, readable_size, blob2dat } from './utils/helper.js';
import { CDWebSocket, CDWebSocketNS } from './utils/cd_ws.js';
import { Idb } from './utils/idb.js';
import { csa, alloc_port } from './common.js';
import { init_dbg } from './plugins/dbg.js';


csa.ws_ns = new CDWebSocketNS('/');
csa.cmd_sock = new CDWebSocket(csa.ws_ns, 'cmd');
let cfgs = null;
const dev_max = 100;
let devs = [];


function auto_hide() {
    console.log("auto_hide:", devs);
    let skip_hide = true;
    for (let i = 0; i < dev_max; i++) {
        if (i < Math.max(5, devs.length)) {
            document.getElementById(`device_grp${i}`).style.display = '';
        } else {
            document.getElementById(`device_grp${i}`).style.display = skip_hide ? '' : 'none';
            skip_hide = false;
        }
    }
}

async function init_serial_cfg() {
    let ser_cfg = await csa.db.get('tmp', '_index_/ser.cfg');
    let port = document.getElementById('dev_port');
    let baud = document.getElementById('dev_baud');
    let local_net = document.getElementById('local_net');
    let local_mac = document.getElementById('local_mac');
    
    if (ser_cfg) {
        port.value = ser_cfg.port;
        baud.value = ser_cfg.baud;
        local_net.value = ser_cfg.local_net;
        local_mac.value = ser_cfg.local_mac;
    }
    
    port.onchange = baud.onchange = local_net.onchange = local_mac.onchange = async () => {
        await csa.db.set('tmp', '_index_/ser.cfg', {
            port: port.value,
            baud: baud.value,
            local_net: local_net.value,
            local_mac: local_mac.value
        });
    };
}

async function init_cfg_list() {
    let sel_ops = '<option value="">--</option>';
    for (let op of cfgs)
        sel_ops += `<option value="${op}">${op}</option>`;
    let list = document.getElementById('cfg_list');
    
    let db_devs = await csa.db.get('tmp', '_index_/dev.list');
    console.log("init get devs:", devs);
    if (db_devs)
        devs = db_devs;
    for (let i = 0; i < dev_max; i++) {
        let tgt = (devs && devs[i]) ? devs[i].tgt : `00:00:fe`;
        let cfg = (devs && devs[i]) ? devs[i].cfg : '';
        let name = (devs && devs[i]) ? devs[i].name : '';
        let html = `
            <div id="device_grp${i}">
                <div class="is-inline-flex" style="align-items: center; gap: 0.3rem; margin: 1px 0;">
                    <input type="text" placeholder="Name Label" value="${name}" id="cfg${i}.name">
                    <input type="text" placeholder="CDNET IP" value="${tgt}" id="cfg${i}.tgt">
                    <select id="cfg${i}.cfg" value="${cfg}">${sel_ops}</select>
                    <button class="button is-small" id="cfg${i}.btn">${L('Open Window')}</button>
                </div>
            </div>
        `;
        
        list.insertAdjacentHTML('beforeend', html);
        document.getElementById(`cfg${i}.cfg`).value = `${cfg}`;
        
        document.getElementById(`cfg${i}.btn`).onclick = async () => {
            let t = document.getElementById(`cfg${i}.tgt`).value;
            let c = document.getElementById(`cfg${i}.cfg`).value;
            let n = document.getElementById(`cfg${i}.name`).value;
            console.log(`t: ${t}, c: ${c}`);
            if (!t || !c || !n) {
                alert('Empty not allowed');
                return;
            }
            window.open(`ctrl.html?tgt=${t}&cfg=${c}&name=${n}`, "_blank");
        };
        
        document.getElementById(`cfg${i}.name`).onchange =
                document.getElementById(`cfg${i}.tgt`).onchange =
                document.getElementById(`cfg${i}.cfg`).onchange = async () => {
            
            devs = [];
            for (let n = 0; n < dev_max; n++) {
                const dev = {
                    tgt: document.getElementById(`cfg${n}.tgt`).value,
                    cfg: document.getElementById(`cfg${n}.cfg`).value,
                    name: document.getElementById(`cfg${n}.name`).value,
                };
                if (!dev.name && n >= 5)
                    break;
                devs.push(dev);
            }
            await csa.db.set('tmp', '_index_/dev.list', devs);
            auto_hide();
        };
    }
    auto_hide();
}


function init_ws() {
    let ws_url = 'ws://' + window.location.hostname + ':8910';
    let ws = new WebSocket(ws_url);
    
    ws.onopen = async function(evt) {
        console.log("ws onopen");
        csa.ws_ns.connections['server'] = ws;
        
        csa.cmd_sock.flush();
        await csa.cmd_sock.sendto({'action': 'get_cfgs'}, ['server', 'cfgs']);
        let dat = await csa.cmd_sock.recvfrom(2000);
        console.log('get_cfgs ret', dat);
        cfgs = dat[0];
        
        await alloc_port('clr_all');
        await init_dbg();
        
        await init_cfg_list();
        await init_serial_cfg();
        await document.getElementById('btn_dev_get').onclick();
    }
    ws.onmessage = async function(evt) {
        let dat = await blob2dat(evt.data);
        var msg = msgpack.deserialize(dat);
        //console.log("Received dat", msg);
        var sock = csa.ws_ns.sockets[msg['dst'][1]];
        sock.recv_q.put([msg['dat'], msg['src']]);
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


document.getElementById('set_local').onclick = async function() {
    console.log('set_local');
    let net = document.getElementById('local_net').value;
    let mac = document.getElementById('local_mac').value;
    if (!net || !mac) {
        alert('Empty not allowed');
        return;
    }
    document.getElementById('set_local').disabled = true;
    csa.cmd_sock.flush();
    await csa.cmd_sock.sendto({'action': 'set_local', 'net': parseInt(net), 'mac': parseInt(mac)}, ['server', 'dev']);
    let dat = await csa.cmd_sock.recvfrom(1000);
    console.log('set_local ret', dat);
    await document.getElementById('btn_dev_get').onclick();
    document.getElementById('set_local').disabled = false;
};
    
document.getElementById('btn_dev_get').onclick = async function() {
    console.log('start get');
    let status = document.getElementById('dev_status');
    let list = document.getElementById('dev_list');
    document.getElementById('btn_dev_get').disabled = true;
    status.style.background = list.style.background = '#D5F5E3';
    
    csa.cmd_sock.flush();
    await csa.cmd_sock.sendto({'action': 'get'}, ['server', 'dev']);
    let dat = await csa.cmd_sock.recvfrom(1000);
    console.log('btn_dev_get ret', dat);
    status.innerHTML = `${dat[0].port ? dat[0].port : 'None'} | ${dat[0].online ? L('Online') : L('Offline')} ` +
                       `(local net: 0x${val2hex(dat[0].net,2)} mac: 0x${val2hex(dat[0].mac,2)})`;
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
    status.style.background = list.style.background = '#D5F5E360';
    setTimeout(() => { status.style.background = list.style.background = ''; }, 100);
    document.getElementById('btn_dev_get').disabled = false;
};

document.getElementById('btn_dev_open').onclick = async function() {
    console.log('start open');
    let port = document.getElementById('dev_port').value;
    let baud = parseInt(document.getElementById('dev_baud').value);
    if (!port || !baud) {
        alert('Empty not allowed');
        return;
    }
    document.getElementById('btn_dev_open').disabled = true;
    csa.cmd_sock.flush();
    await csa.cmd_sock.sendto({'action': 'open', 'port': port, 'baud': baud}, ['server', 'dev']);
    let dat = await csa.cmd_sock.recvfrom(1000);
    console.log('btn_dev_open ret', dat);
    await document.getElementById('btn_dev_get').onclick();
    document.getElementById('btn_dev_open').disabled = false;
    document.getElementById('set_local').click();
};

document.getElementById('btn_dev_close').onclick = async function() {
    console.log('start close');
    document.getElementById('btn_dev_close').disabled = true;
    csa.cmd_sock.flush();
    await csa.cmd_sock.sendto({'action': 'close'}, ['server', 'dev']);
    let dat = await csa.cmd_sock.recvfrom(1000);
    console.log('btn_dev_close ret', dat);
    await document.getElementById('btn_dev_get').onclick();
    document.getElementById('btn_dev_close').disabled = false;
};

window.addEventListener('load', async function() {
    console.log("load app");
    
    // apply translation
    for (let tag of ['button', 'span', 'option', 'td']) {
        let elems = document.getElementsByTagName(tag);
        for (let e of elems) {
            e.innerHTML = eval("`" + e.innerHTML + "`");
            if (e.title)
                e.title = eval("`" + e.title + "`");
        }
    }
    
    csa.db = await new Idb();
    init_ws();
});

