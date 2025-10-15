/*
 * Software License Agreement (MIT License)
 *
 * Author: Duke Fong <d@d-l.io>
 */

import { L } from '../utils/lang.js'
import { timestamp, dat2str } from '../utils/helper.js';
import { CDWebSocket } from '../utils/cd_ws.js';
import { csa, alloc_port } from '../common.js';
import { Terminal } from '../libs/xterm-5.6.0-beta.129.js';
import { WebglAddon } from '../libs/xterm-addon-webgl-0.19.0-beta.129.js';
import { FitAddon } from '../libs/xterm-addon-fit-0.11.0-beta.129.js';
import { SearchAddon } from '../libs/xterm-addon-search-0.16.0-beta.129.js';

let html = `
    <div class="container">
        <h2 class="title is-size-4">Logs</h2>
        <div class="is-inline-flex" style="align-items: center; gap: 0.3rem; margin: 5px 0;">
            <span>${L('Max Len')}:</span> <input type="text" size="8" id="dbg_len" value="99999">
            <button class="button is-small" id="dbg_clear">${L('Clear')}</button>
            <button class="button is-small" id="dbg_select_all">${L('Select All')}</button> |
            <input type="text" size="32" placeholder="search" id="dbg_search">
            <button class="button is-small" id="dbg_search_prev">${L('Prev')}</button>
            <button class="button is-small" id="dbg_search_next">${L('Next')}</button>
        </div>
        <div id="dbg_log" style="resize: vertical; overflow: auto;"></div>
    </div>
    <br>`;

let term = null;
let origin_log = [];

function write_log(line) {
    const buffer = term.buffer.active;
    term.write(line);
    origin_log.push(line);
    if(buffer.viewportY + term.rows >= buffer.length)
        term.scrollToBottom();
}

function update_max_len() {
    let num = Number(document.getElementById('dbg_len').value);
    if (num) {
        term.options.scrollback = num;
        console.log(`dbg set max len: ${num}`);
    }
}

async function dbg_service() {
    term = new Terminal({
        convertEol: true, // using '\n' instead of '\r\n'
        fontSize: 12
    });
    update_max_len();
    document.getElementById('dbg_len').onchange = update_max_len;

    const webgl_addon = new WebglAddon();
    webgl_addon.onContextLoss(e => {
        webgl_addon.dispose();
    });
    term.loadAddon(webgl_addon);
    const fit_addon = new FitAddon();
    term.loadAddon(fit_addon);
    const search_addon = new SearchAddon();
    term.loadAddon(search_addon);
    term.open(document.getElementById('dbg_log'));
    const observer = new ResizeObserver(() => fit_addon.fit());
    observer.observe(document.getElementById('dbg_log'));
    
    term.attachCustomKeyEventHandler((e) => {
        if (e.ctrlKey && e.code == 'KeyC' && e.type == 'keydown') {
            if (term.hasSelection()) {
                const selected = term.getSelection();
                navigator.clipboard.writeText(selected);
                e.preventDefault();
                return false;
            }
        }
        if (e.code == 'Enter' && e.type == 'keydown') {
            term.writeln('');
            origin_log.push('\n');
            return false;
        }
        if (e.key == "F5")
            return false; // allow F5 refresh page
        return true;
    });
    
    document.getElementById('dbg_clear').onclick = () => {
        term.clear();
        term.select(0, 0, 0);
    };
    document.getElementById('dbg_select_all').onclick = () => {
        term.selectAll();
        term.focus();
    };
    document.getElementById('dbg_search_prev').onclick = () => {
        const val = document.getElementById('dbg_search').value;
        search_addon.findPrevious(val, {caseSensitive: true});
    };
    document.getElementById('dbg_search_next').onclick = () => {
        const val = document.getElementById('dbg_search').value;
        search_addon.findNext(val, {caseSensitive: true});
    };
    
    while (true) {
        let dat = await csa.dbg.sock.recvfrom();
        console.log('dbg get:', dat2str(dat[0].dat));
        let elem = document.getElementById('dbg_log');
        let txt = dat2str(dat[0].dat);
        write_log(txt);
    }
}

async function init_dbg() {
    csa.dbg = {};
    csa.plugins.push('dbg');
    
    let port = await alloc_port(9);
    console.log(`init_dbg, alloc port: ${port}`);
    csa.dbg.sock = new CDWebSocket(csa.ws_ns, port);
    
    document.head.insertAdjacentHTML('beforeend', '<link rel="stylesheet" href="./libs/xterm-5.6.0-beta.129.css">');
    document.getElementsByTagName('section')[0].insertAdjacentHTML('beforeend', html);
    dbg_service();
    
    csa.dbg.dat_export = () => { return origin_log.join(''); };
    csa.dbg.dat_import = (dat) => {
        term.write(dat);
        term.scrollToBottom();
    };
}

export { init_dbg };

