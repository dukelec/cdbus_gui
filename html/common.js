/*
 * Software License Agreement (MIT License)
 *
 * Author: Duke Fong <d@d-l.io>
 */

import { L } from './utils/lang.js'
import { escape_html } from './utils/helper.js';
import { CDWebSocket } from './utils/cd_ws.js';

const WS_CLOSE_DUPLICATE = 4001; // server close code: same page already opened in another window

let csa = {
    arg: {},            // url args
    db: null,

    ws_ns: null,
    cmd_sock: null,
    sys_sock: null,     // receive backend faults

    cfg: {},            // device config
    plugins: []         // registered plugins
};


async function alloc_port(port=null) {
    csa.cmd_sock.flush();
    if (port == 'clr_all') {
        await csa.cmd_sock.sendto({'action': 'clr_all'}, ['server', 'port']);
        let ret = await csa.cmd_sock.recvfrom(1000);
        console.log(`clr_all ports ret: ${ret[0]}`);
    } else {
        await csa.cmd_sock.sendto({'action': 'get_port', 'port': port}, ['server', 'port']);
        let ret = await csa.cmd_sock.recvfrom(1000);
        //console.log(`alloc port: ${ret[0]}`);
        return ret[0];
    }
}

// show a sticky notification at the top of the page, same id replaces the previous one
function show_banner(id, html, cls='is-danger') {
    let elem = document.getElementById(id);
    if (!elem) {
        elem = document.createElement('div');
        elem.id = id;
        elem.style.cssText = 'position: sticky; top: 0; z-index: 100; margin: 0; border-radius: 0; white-space: pre-wrap;';
        document.body.prepend(elem);
    }
    elem.className = `notification ${cls}`;
    elem.innerHTML = html;
    elem.style.display = html ? '' : 'none';
}

// called on websocket close: tell the user why the page is dead
function ws_closed(evt) {
    document.body.style.backgroundColor = 'gray';
    if (evt && evt.code == WS_CLOSE_DUPLICATE) {
        let title;
        if (csa.arg.tgt)
            title = L('A page for device address %s is already opened in another window, only one page per device address is allowed.')
                    .replace('%s', escape_html(csa.arg.tgt));
        else
            title = L('The index page is already opened in another window, only one index page is allowed.');
        show_banner('ws_banner', `<b>${title}</b>\n` +
                    L('Close this window and use the existing one. (If the existing one was just closed, wait a few seconds and reload.)'));
    } else {
        show_banner('ws_banner', `<b>${L('WebSocket disconnected')}</b>\n` +
                    L('The backend may have exited or the connection was lost, please check the backend log and reload the page.'));
    }
}

function show_faults(faults) {
    if (!faults || !faults.length) {
        show_banner('fault_banner', '');
        return;
    }
    let list = faults.map(f => escape_html(f)).join('\n');
    show_banner('fault_banner', `<b>${L('Backend fault, communication may be broken. Please check the backend log and restart it.')}</b>\n${list}`);
}

// query backend faults once, then keep listening for fault broadcasts
async function init_sys() {
    if (!csa.sys_sock)
        csa.sys_sock = new CDWebSocket(csa.ws_ns, 'sys');
    csa.sys_sock.flush();
    await csa.sys_sock.sendto({'action': 'get_faults'}, ['server', 'sys']);
    (async () => {
        while (true) {
            let ret = await csa.sys_sock.recvfrom(3000);
            if (ret)
                show_faults(ret[0]);
            else if (!('server' in csa.ws_ns.connections))
                return;
        }
    })();
}

export { csa, alloc_port, show_banner, ws_closed, show_faults, init_sys };
