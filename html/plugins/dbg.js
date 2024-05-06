/*
 * Software License Agreement (MIT License)
 *
 * Author: Duke Fong <d@d-l.io>
 */

import { L } from '../utils/lang.js'
import { timestamp, dat2str } from '../utils/helper.js';
import { CDWebSocket } from '../utils/cd_ws.js';
import { csa, alloc_port } from '../common.js';

let html = `
    <div class="container">
        <h2 class="title is-size-4">Logs</h2>
        <label class="checkbox"><input type="checkbox" id="dbg_scroll_end" checked> <span>${L('Scroll end')}</span></label>
        | <span>${L('Len')}</span>: <input type="text" size="8" placeholder="1000" id="dbg_len" value="1000">
        <button class="button is-small" id="dbg_clear">${L('Clear')}</button>
        <button class="button is-small" id="dbg_blank">${L('Add blank')}</button> <br><br>
        <div style="font-family: monospace; font-size: 12px; overflow: scroll; height: 260px; color: white; background: black; resize: both;" id="dbg_log"></div>
    </div>
    <br>`;

let is_index = false;

async function dbg_service() {
    document.getElementById('dbg_clear').onclick = () => {
        document.getElementById('dbg_log').innerHTML = '';
    };
    document.getElementById('dbg_blank').onclick = () => {
        document.getElementById('dbg_log').innerHTML += '<br>';
        if (document.getElementById('dbg_scroll_end').checked)
            document.getElementById('dbg_log').scrollBy(0, 1000);
    };

    let ansi_up = new AnsiUp;
    while (true) {
        let dat = await csa.dbg.sock.recvfrom();
        console.log('dbg get:', dat2str(dat[0].dat.slice(1)));
        let elem = document.getElementById('dbg_log');
        let addition = is_index ? ` [${dat[0].src[0]}]` : '';
        let txt = `${timestamp()}${addition}: ${dat2str(dat[0].dat.slice(1))}`;
        let html = ansi_up.ansi_to_html(txt);
        //elem.innerHTML += html + '<br>';
        elem.insertAdjacentHTML('beforeend', html + '<br>');
        if (document.getElementById('dbg_scroll_end').checked)
            elem.scrollBy(0, 1000);
        if (elem.children.length > document.getElementById('dbg_len').value) {
            elem.firstChild.remove();
            elem.firstElementChild.remove();
        }
    }
}

async function init_dbg() {
    csa.dbg = {};
    csa.plugins.push('dbg');
    is_index = !('tgt' in csa.arg);
    
    let port = await alloc_port(9);
    console.log(`init_dbg, alloc port: ${port}`);
    csa.dbg.sock = new CDWebSocket(csa.ws_ns, port);
    
    document.getElementsByTagName('section')[0].insertAdjacentHTML('beforeend', html);
    dbg_service();
    
    csa.dbg.dat_export = () => { return document.getElementById('dbg_log').innerHTML; };
    csa.dbg.dat_import = (dat) => { document.getElementById('dbg_log').innerHTML = dat; };
}

export { init_dbg };

