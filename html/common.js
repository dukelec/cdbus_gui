/*
 * Software License Agreement (MIT License)
 *
 * Author: Duke Fong <d@d-l.io>
 */

import { L, LANGS, lang_pref, set_lang } from './utils/lang.js?v=__V__'
import { escape_html } from './utils/helper.js?v=__V__';
import { CDWebSocket } from './utils/cd_ws.js?v=__V__';

const WS_CLOSE_DUPLICATE = 4001; // server close code: same page already opened in another window

const VERSION = 'v3.4';     // shown in the nav bar, web_serve.py reads it from here
// replaced by web_serve.py with "<VERSION>-<hash of all own front end files>", the same
// string the ?v= of every own css / js / module url carries, so a changed front end
// means changed urls and the browser is bound to fetch the new files
const ASSET_VER = '__V__';

let csa = {
    arg: {},            // url args
    db: null,

    ws_ns: null,
    cmd_sock: null,
    sys_sock: null,     // receive backend faults

    cfg: {},            // device config
    plugins: []         // registered plugins
};


// ask the backend for a port number, or drop all of them for 'clr_all'. Every caller hands
// the port straight to a CDWebSocket, so a missing reply cannot be papered over with a null
// port: say what happened and stop here rather than run on with a socket nothing can reach.
async function alloc_port(port=null) {
    csa.cmd_sock.flush();
    let req = port == 'clr_all' ? {'action': 'clr_all'} : {'action': 'get_port', 'port': port};
    await csa.cmd_sock.sendto(req, ['server', 'port']);
    let ret = await csa.cmd_sock.recvfrom(1000);
    if (!ret) {
        show_banner('ws_banner', `<b>${L('No reply from backend, please check the backend log and reload the page.')}</b>`);
        throw new Error(`alloc_port(${port}): no reply from backend`);
    }
    if (port == 'clr_all')
        console.log(`clr_all ports ret: ${ret[0]}`);
    else
        return ret[0];
}

// write a few values back into the device's json5 config file, in place:
// only the spans that belong to these keys change, comments inside them are lost
async function save_cfg_file(vals) {
    if (!vals.length)
        return 0;
    csa.cmd_sock.flush();
    await csa.cmd_sock.sendto({'action': 'set_cfg', 'cfg': csa.arg.cfg, 'vals': vals},
                              ['server', 'cfgs']);
    let ret = await csa.cmd_sock.recvfrom(5000);
    if (!ret)
        throw new Error(L('No reply from backend, please check the backend log and reload the page.'));
    if (ret[0] != 'successed')
        throw new Error(`${ret[0]}`);
    return vals.length;
}

// evaluate the ${L('...')} placeholders written in the static html
function apply_trans() {
    for (let tag of ['button', 'span', 'option', 'td']) {
        let elems = document.getElementsByTagName(tag);
        for (let e of elems) {
            e.innerHTML = eval("`" + e.innerHTML + "`");
            if (e.title)
                e.title = eval("`" + e.title + "`");
        }
    }
}

// translate the page, then fill the <div id="nav"> of the page with the top bar:
// app name, version and the language picker
function init_nav() {
    apply_trans();
    let nav = document.getElementById('nav');
    if (!nav)
        return;
    let ver = ASSET_VER.startsWith(`${VERSION}-`) ? ASSET_VER : VERSION;  // full one only when served
    nav.innerHTML = `
      <nav class="navbar is-light" role="navigation">
        <div class="navbar-brand">
          <a class="navbar-item has-text-weight-bold" href="./">CDBUS GUI
            <span class="has-text-grey has-text-weight-normal is-size-7 ml-2" title="${ver}">${VERSION}</span></a>
        </div>
        <div class="navbar-menu is-active">
          <div class="navbar-end">
            <div class="navbar-item" title="${L('Language')}"><span class="select is-small"><select id="lang_sel">
              ${LANGS.map(([v, t]) => `<option value="${v}" ${v == lang_pref() ? 'selected' : ''}>${v ? t : L('Auto')}</option>`).join('')}
            </select></span></div>
          </div>
        </div>
      </nav>`;
    // L() is fixed when the modules load, so just remember the choice and reload the page
    document.getElementById('lang_sel').onchange = e => { set_lang(e.target.value); location.reload(); };
}

// show a sticky notification at the top of the page, same id replaces the previous one
function show_banner(id, html, cls='is-danger') {
    let elem = document.getElementById(id);
    if (!elem) {
        elem = document.createElement('div');
        elem.id = id;
        elem.style.cssText = 'position: sticky; top: 0; z-index: 100; margin: 0; border-radius: 0; white-space: pre-wrap; ' +
                             'background-color: #F5B7B180; backdrop-filter: blur(8px); ' +
                             '-webkit-backdrop-filter: blur(8px);';
        document.body.prepend(elem);
    }
    elem.className = `notification ${cls}`;
    elem.innerHTML = html;
    elem.style.display = html ? '' : 'none';
}

// called on websocket close: tell the user why the page is dead
function ws_closed(evt) {
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

let cfg_errors = [];

// report a device config file problem, all problems share one banner
function show_cfg_error(msg) {
    console.error('cfg error:', msg);
    if (cfg_errors.includes(msg))
        return;
    cfg_errors.push(msg);
    let list = cfg_errors.map(e => escape_html(e)).join('\n');
    show_banner('cfg_banner', `<b>${L('Config file error, related functions may not work:')}</b>\n${list}`);
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

export { csa, VERSION, init_nav,
         alloc_port, save_cfg_file, show_banner, show_cfg_error, ws_closed, show_faults, init_sys };
