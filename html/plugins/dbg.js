/*
 * Software License Agreement (MIT License)
 *
 * Author: Duke Fong <d@d-l.io>
 */

import { L } from '../utils/lang.js?v=__V__'
import { dat2str } from '../utils/helper.js?v=__V__';
import { CDWebSocket } from '../utils/cd_ws.js?v=__V__';
import { csa, alloc_port, PIN_SVG,
         topbar_slot, topbar_take, topbar_give_back } from '../common.js?v=__V__';
import { Terminal } from '../libs/xterm-5.6.0-beta.129.js';
import { WebglAddon } from '../libs/xterm-addon-webgl-0.19.0-beta.129.js';
import { FitAddon } from '../libs/xterm-addon-fit-0.11.0-beta.129.js';
import { SearchAddon } from '../libs/xterm-addon-search-0.16.0-beta.129.js';

// dbg_box is what moves up to the top bar and back, heading and all; the section around it is
// then empty, so it steps out of the way while the box is away
let html = `
    <div class="container" id="dbg_sect">
        <div id="dbg_box">
            <h2 class="title is-size-4">Logs</h2>
            <div class="is-inline-flex" style="align-items: center; gap: 0.3rem; margin: 5px 0;">
                <span>${L('Max Len')}:</span> <input type="text" size="8" id="dbg_len" value="99999">
                <button class="button is-small" id="dbg_clear">${L('Clear')}</button>
                <button class="button is-small" id="dbg_select_all">${L('Select All')}</button> |
                <input type="text" size="32" placeholder="search" id="dbg_search">
                <button class="button is-small" id="dbg_search_prev">${L('Prev')}</button>
                <button class="button is-small" id="dbg_search_next">${L('Next')}</button>
                <span class="topbar_pin" id="dbg_pin"
                      title="${L('Keep in the top bar')}">${PIN_SVG}</span>
            </div>
            <div id="dbg_log" class="resizable"></div>
        </div>
        <br>
    </div>`;

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
    // refit when the box changes size, and when the terminal itself does: a zoom changes the size
    // of a character cell but not the box, and the terminal would keep its row count and run on
    // past the bottom of the box, hiding the newest lines. fit() leaves the terminal alone once
    // the rows and columns already match, so the two do not set each other off for ever.
    const observer = new ResizeObserver(() => fit_addon.fit());
    observer.observe(document.getElementById('dbg_log'));
    observer.observe(term.element);
    
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
            return false; // allow page refresh with F5
        return true;
    });
    term.element.addEventListener('wheel', (e) => {
        e.preventDefault(); // scroll log without scrolling the page
    });
    
    document.getElementById('dbg_clear').onclick = () => {
        term.scrollToBottom(); // workaround for auto-scroll fails after clear
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

// the terminal refits itself on the resize that moving it causes, so there is nothing else to do
async function dbg_set_pin(on) {
    let box = document.getElementById('dbg_box');
    if (on)
        topbar_take(csa.dbg.slot, box);
    else
        topbar_give_back(box);
    document.getElementById('dbg_sect').hidden = on;
    let btn = document.getElementById('dbg_pin');
    btn.classList.toggle('is-pinned', on);
    btn.title = on ? L('Take out of the top bar') : L('Keep in the top bar');
    await csa.db.set('tmp', `${csa.arg.name}/dbg.pin`, on);
}

async function init_dbg() {
    csa.dbg = {};
    csa.plugins.push('dbg');
    
    let port = await alloc_port(9);
    console.log(`init_dbg, alloc port: ${port}`);
    csa.dbg.sock = new CDWebSocket(csa.ws_ns, port);
    
    document.head.insertAdjacentHTML('beforeend', '<link rel="stylesheet" href="./libs/xterm-5.6.0-beta.129.css">');
    document.getElementsByTagName('section')[0].insertAdjacentHTML('beforeend', html);
    csa.dbg.slot = await topbar_slot('dbg');
    document.getElementById('dbg_pin').onclick = () =>
            dbg_set_pin(!document.getElementById('dbg_pin').classList.contains('is-pinned'));
    if (await csa.db.get('tmp', `${csa.arg.name}/dbg.pin`))
        await dbg_set_pin(true);
    dbg_service();
    
    // for the external API: read back buffered log by cursor
    csa.dbg.log_read = (since=0, max_len=0) => {
        if (!(since >= 0) || since > origin_log.length)
            since = 0;
        let text = origin_log.slice(since).join('');
        let cut = 0;
        if (max_len > 0 && text.length > max_len) {
            cut = text.length - max_len;
            text = text.slice(cut);
        }
        return { since, next: origin_log.length, cut, text };
    };
    csa.dbg.log_clear = () => {
        origin_log = [];
        term.scrollToBottom(); // workaround for auto-scroll fails after clear
        term.clear();
        term.select(0, 0, 0);
    };
    csa.dbg.dat_export = () => { return origin_log.join(''); };
    csa.dbg.dat_import = (dat) => {
        term.write(dat);
        term.scrollToBottom();
    };
}

export { init_dbg };

