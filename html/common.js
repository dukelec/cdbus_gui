/*
 * Software License Agreement (MIT License)
 *
 * Author: Duke Fong <d@d-l.io>
 */

import { L, LANGS, lang_pref, set_lang } from './utils/lang.js?v=__V__'
import { escape_html } from './utils/helper.js?v=__V__';
import { CDWebSocket } from './utils/cd_ws.js?v=__V__';

const WS_CLOSE_DUPLICATE = 4001; // server close code: same page already opened in another window

const VERSION = 'v3.12';     // shown in the nav bar, web_serve.py reads it from here
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
    init_topbar();
}


// A sticky strip right under the nav bar that any plugin can put something into. A plugin asks
// for its slot once and either fills it or hands a whole element over with topbar_take(). Each
// slot is a band of its own, the bands stack up and the user can move them past each other. The
// strip is not rendered at all while every band is empty, so a page that puts nothing up there
// behaves exactly as it did before.

// the mark on whatever can be sent up to the strip: an arrow into a bar, turned over once it is
// up there to mean putting it back
const PIN_SVG = `<svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" ` +
                `stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">` +
                `<path d="M3.5 2.5h9"/><path d="M8 13.5V5.5"/><path d="M5 8.5l3-3 3 3"/></svg>`;

let topbar_order = null;    // slot names top to bottom, null until read back from the db

function init_topbar() {
    let nav = document.getElementById('nav');
    if (!nav || document.getElementById('topbar'))
        return;
    nav.insertAdjacentHTML('afterend', `
      <div id="topbar" style="display: none;">
        <div id="topbar_fold" title="${L('Fold')}"></div>
        <div id="topbar_body"></div>
      </div>`);
    document.getElementById('topbar_fold').onclick = async () => {
        let fold = !document.getElementById('topbar').classList.contains('is-folded');
        document.getElementById('topbar').classList.toggle('is-folded', fold);
        await topbar_save('fold', fold);
    };
}

async function topbar_save(key, val) {
    if (csa.db && csa.arg.name)
        await csa.db.set('tmp', `${csa.arg.name}/topbar.${key}`, val);
}

// the container a plugin owns. The bands come out in the order the plugins ask for them, which
// is the order of the page itself, unless the user has moved them since.
async function topbar_slot(name) {
    init_topbar();
    let body = document.getElementById('topbar_body');
    if (!body)
        return null;
    if (topbar_order == null) {
        let saved = csa.db && csa.arg.name ? await csa.db.get('tmp', `${csa.arg.name}/topbar.order`) : null;
        topbar_order = Array.isArray(saved) ? saved : [];
        if (csa.db && csa.arg.name && await csa.db.get('tmp', `${csa.arg.name}/topbar.fold`))
            document.getElementById('topbar').classList.add('is-folded');
    }
    let slot = document.getElementById(`topbar_slot.${name}`);
    if (!slot) {
        if (!topbar_order.includes(name))
            topbar_order.push(name);
        body.insertAdjacentHTML('beforeend', `
            <div class="topbar_band" id="topbar_band.${name}" hidden>
              <div class="topbar_move">
                <span id="topbar_up.${name}" title="${L('Move up')}">&#9652;</span>
                <span id="topbar_dn.${name}" title="${L('Move down')}">&#9662;</span>
              </div>
              <div class="topbar_slot" id="topbar_slot.${name}"></div>
            </div>`);
        document.getElementById(`topbar_up.${name}`).onclick = () => move_band(name, -1);
        document.getElementById(`topbar_dn.${name}`).onclick = () => move_band(name, 1);
        slot = document.getElementById(`topbar_slot.${name}`);
        apply_topbar_order();
    }
    return slot;
}

function apply_topbar_order() {
    for (let i = 0; i < topbar_order.length; i++) {
        let band = document.getElementById(`topbar_band.${topbar_order[i]}`);
        if (band)
            band.style.order = i;
    }
}

// swap a band with the one shown above or below it. A band with nothing in it keeps its place in
// the order while it is out of sight, so filling it again does not shuffle the others.
async function move_band(name, dir) {
    let shown = topbar_order.filter(n => {
        let band = document.getElementById(`topbar_band.${n}`);
        return band && !band.hidden;
    });
    let other = shown[shown.indexOf(name) + dir];
    if (!other)
        return;
    let a = topbar_order.indexOf(name), b = topbar_order.indexOf(other);
    [topbar_order[a], topbar_order[b]] = [topbar_order[b], topbar_order[a]];
    apply_topbar_order();
    await topbar_save('order', topbar_order);
}

// hand an element over to the strip, or give it back to where it came from. The anchor left
// behind in its place is what puts it back in the same spot, whatever has been added since.
function topbar_take(slot, elm, order=0) {
    if (!elm._topbar_anchor) {
        elm._topbar_anchor = document.createElement('div');
        elm._topbar_anchor.hidden = true;
        elm.parentElement.insertBefore(elm._topbar_anchor, elm);
    }
    elm.style.order = order;
    slot.appendChild(elm);
    topbar_update();
}

function topbar_give_back(elm) {
    if (elm._topbar_anchor) {
        elm.style.order = '';
        elm._topbar_anchor.parentElement.insertBefore(elm, elm._topbar_anchor);
    }
    topbar_update();
}

// call after changing what is in a slot: a band with nothing in it steps out of the way, and the
// strip shows itself only while some band is left
function topbar_update() {
    let bar = document.getElementById('topbar');
    if (!bar)
        return;
    let shown = 0;
    for (let name of topbar_order || []) {
        let band = document.getElementById(`topbar_band.${name}`);
        if (!band)
            continue;
        band.hidden = !document.getElementById(`topbar_slot.${name}`).children.length;
        if (!band.hidden)
            shown++;
    }
    bar.style.display = shown ? '' : 'none';
    bar.classList.toggle('is-single', shown < 2);   // nothing to reorder, no arrows
}

// show a sticky notification at the top of the page, same id replaces the previous one.
// They stack up in one sticky box, the newest on top: each sticky on its own, they all stuck
// at the top once the page was scrolled, and the older ones covered the newer ones
function show_banner(id, html, cls='is-danger') {
    let elem = document.getElementById(id);
    if (!elem) {
        let box = document.getElementById('banner_box');
        if (!box) {
            box = document.createElement('div');
            box.id = 'banner_box';
            box.style.cssText = 'position: sticky; top: 0; z-index: 100;';
            document.body.prepend(box);
        }
        elem = document.createElement('div');
        elem.id = id;
        elem.style.cssText = 'margin: 0; border-radius: 0; white-space: pre-wrap; ' +
                             'border-bottom: 1px solid #0000001a; ' +
                             'background-color: #F5B7B180; backdrop-filter: blur(8px); ' +
                             '-webkit-backdrop-filter: blur(8px);';
        box.prepend(elem);
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

export { csa, VERSION, init_nav, PIN_SVG,
         topbar_slot, topbar_update, topbar_take, topbar_give_back,
         alloc_port, save_cfg_file, show_banner, show_cfg_error, ws_closed, show_faults, init_sys };
