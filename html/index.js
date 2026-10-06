/*
 * Software License Agreement (MIT License)
 *
 * Author: Duke Fong <d@d-l.io>
 */

import { L } from './utils/lang.js?v=__V__'
import { escape_html, date2num, timestamp, val2hex, dat2str, dat2hex, hex2dat,
         read_file, download, readable_size, blob2dat } from './utils/helper.js?v=__V__';
import { CDWebSocket, CDWebSocketNS } from './utils/cd_ws.js?v=__V__';
import { Idb } from './utils/idb.js?v=__V__';
import { csa, init_nav, alloc_port, show_banner, ws_closed, init_sys, api_serve } from './common.js?v=__V__';
import { init_dbg } from './plugins/dbg.js?v=__V__';


csa.ws_ns = new CDWebSocketNS('/');
csa.cmd_sock = new CDWebSocket(csa.ws_ns, 'cmd');
let cfgs = null;
const dev_max = 100;


async function auto_hide() {
    let devs = [];
    for (let n = 0; n < dev_max; n++) {
        const dev = {
            tgt: document.getElementById(`cfg${n}.tgt`).value,
            cfg: document.getElementById(`cfg${n}.cfg`).value,
            name: document.getElementById(`cfg${n}.name`).value,
        };
        devs.push(dev);
    }
    let actived = 7;
    for (let n = 0; n < dev_max; n++) {
        if (devs[n].name && n >= actived)
            actived = n + 1;
    }
    devs = devs.slice(0, actived);
    await csa.db.set('tmp', '_index_/dev.list', devs);

    console.log("auto_hide:", devs);
    for (let i = 0; i < dev_max; i++)
        document.getElementById(`device_grp${i}`).style.display = i <= actived ? '' : 'none';
}

async function init_serial_cfg() {
    let ser_cfg = await csa.db.get('tmp', '_index_/ser.cfg');
    let port = document.getElementById('dev_port');
    let baud = document.getElementById('dev_baud');
    
    if (ser_cfg) {
        port.value = ser_cfg.port;
        baud.value = ser_cfg.baud;
    }
    
    port.onchange = baud.onchange = save_serial_cfg;
    baud.oninput = update_baud_hint;
}

async function save_serial_cfg() {
    await csa.db.set('tmp', '_index_/ser.cfg', {
        port: document.getElementById('dev_port').value,
        baud: document.getElementById('dev_baud').value
    });
}

async function init_cfg_list() {
    let sel_ops = '<option value="">--</option>';
    for (let op of [...cfgs].sort((a, b) => a.localeCompare(b)))
        sel_ops += `<option value="${op}">${op}</option>`;
    let list = document.getElementById('cfg_list');
    
    let devs = await csa.db.get('tmp', '_index_/dev.list');
    console.log("init get devs:", devs);
    if (!devs)
        devs = [];
    for (let i = 0; i < dev_max; i++) {
        let tgt = (devs && devs[i]) ? devs[i].tgt : `00:00:fe`;
        let cfg = (devs && devs[i]) ? devs[i].cfg : '';
        let name = (devs && devs[i]) ? devs[i].name : '';
        let html = `
            <div id="device_grp${i}">
                <div class="is-inline-flex" style="align-items: center; gap: 0.3rem; margin: 1px 0;">
                    <input type="text" placeholder="Name Label" value="${escape_html(`${name}`)}" id="cfg${i}.name">
                    <input type="text" placeholder="CDNET IP" value="${escape_html(`${tgt}`)}" id="cfg${i}.tgt">
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
            // the backend routes a device's answers to the page named by the address as its
            // parser prints it, two lower case hex digits per byte, so that is the one form the
            // page may be opened under: 80:00:FE went out fine and never heard anything back
            t = t.trim().toLowerCase();
            if (!/^[0-9a-f]{2}:[0-9a-f]{2}:[0-9a-f]{2}$/.test(t)) {
                alert(L('CDNET address must be 3 hex bytes, e.g. 80:00:fe, not: %s').replace('%s', t));
                return;
            }
            // tgt goes in as is, to stay readable in the url; the name is free text,
            // a & or # in it would cut the args short
            window.open(`ctrl.html?tgt=${t}&cfg=${encodeURIComponent(c)}` +
                        `&name=${encodeURIComponent(n)}`, "_blank");
        };
        
        document.getElementById(`cfg${i}.name`).onchange =
                document.getElementById(`cfg${i}.tgt`).onchange =
                document.getElementById(`cfg${i}.cfg`).onchange = async () => { await auto_hide(); };
    }
    await auto_hide();
}


function init_ws() {
    let ws_url = `ws://${window.location.hostname}:${window.location.port}`;
    let ws = new WebSocket(ws_url);
    
    ws.onopen = async function(evt) {
        console.log("ws onopen");
        csa.ws_ns.connections['server'] = ws;
        
        csa.cmd_sock.flush();
        await csa.cmd_sock.sendto({'action': 'get_cfgs'}, ['server', 'cfgs']);
        let dat = await csa.cmd_sock.recvfrom(2000);
        console.log('get_cfgs ret', dat);
        if (!dat) {
            if ('server' in csa.ws_ns.connections)
                show_banner('ws_banner', `<b>${L('No reply from backend, please check the backend log and reload the page.')}</b>`);
            return;
        }
        cfgs = dat[0];
        
        await init_sys();
        await alloc_port('clr_all');
        await init_dbg();
        
        await init_cfg_list();
        await init_serial_cfg();
        await dev_get();
        await init_rec();       // the udp backend records too, the frames rebuilt from its packets
        await init_replay();
        csa.api_sock = new CDWebSocket(csa.ws_ns, 'api');
        api_serve(csa.api_sock, api_cmds);
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

// warn if the baud rate input differs from the one in use
function update_baud_hint() {
    let hint = document.getElementById('dev_baud_hint');
    if (!hint)
        return;
    let baud = parseInt(document.getElementById('dev_baud').value);
    if (csa.dev_baud && baud && baud != csa.dev_baud) {
        hint.innerText = ' ' + L('(input differs, close and re-open to apply)');
        hint.style.color = '#c00';
    } else {
        hint.innerText = '';
    }
}

// one request to the backend's serial service at a time: the buttons and the api share cmd_sock,
// and two requests in flight would take each other's replies
let dev_lock = Promise.resolve();

async function dev_req(req) {
    let unlock;
    let prev = dev_lock;
    dev_lock = new Promise(resolve => unlock = resolve);
    await prev;
    try {
        csa.cmd_sock.flush();
        await csa.cmd_sock.sendto(req, ['server', 'dev']);
        return await csa.cmd_sock.recvfrom(1000);
    } finally {
        unlock();
    }
}

// Refresh: show what the backend has open, and the ports there are; the reply is kept in
// csa.dev_st as well, null when there was none
async function dev_get() {
    console.log('start get');
    let status = document.getElementById('dev_status');
    let list = document.getElementById('dev_list');
    document.getElementById('btn_dev_get').disabled = true;
    status.style.background = list.style.background = '#D5F5E3';
    
    let dat = await dev_req({'action': 'get'});
    console.log('btn_dev_get ret', dat);
    csa.dev_st = dat ? dat[0] : null;
    if (!dat) {
        status.innerHTML = `<span style="color: #c00">${L('Reply timeout, please Refresh again. If it persists, check the backend log.')}</span>`;
        status.style.background = list.style.background = '';
        document.getElementById('btn_dev_get').disabled = false;
        return null;
    }
    if (dat[0] == 'udp') {
        console.log('udp mode!');
        document.getElementById('dev_ctrl_hide').style.display = 'none';
        return dat[0];
    }
    let online_str = L('Offline');
    if (dat[0].online == 1)
        online_str = L('Online');
    else if (dat[0].online == 2)
        online_str = L('Connecting...');
    else if (dat[0].online == 3)
        online_str = `<span style="color: #c00">${L('Device thread dead, please re-open')}</span>`;
    csa.dev_baud = dat[0].baud;
    let baud_str = dat[0].baud ? ` @ ${dat[0].baud}` : '';
    status.innerHTML = `${dat[0].port ? dat[0].port : 'None'}${baud_str} | ${online_str} ` +
                       `(local net: 0x${val2hex(dat[0].net,2)} mac: 0x${val2hex(dat[0].mac,2)})` +
                       `<span id="dev_baud_hint"></span>`;
    update_baud_hint();
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
    return dat[0];
}

// Open the port the two boxes name. Why it did not open is alerted, or returned for the api,
// which has no one to click the alert away.
async function dev_open(alert_err=true) {
    console.log('start open');
    let port = document.getElementById('dev_port').value;
    let baud = parseInt(document.getElementById('dev_baud').value);
    if (!port || !baud) {
        if (alert_err)
            alert('Empty not allowed');
        return 'the port and the baud rate must not be empty';
    }
    document.getElementById('btn_dev_open').disabled = true;
    let err = null;
    try {
        let dat = await dev_req({'action': 'open', 'port': port, 'baud': baud});
        console.log('btn_dev_open ret', dat);
        if (!dat)
            err = 'no reply from the backend';
        else if (typeof dat[0] == 'string' && dat[0].startsWith('err')) {
            err = `${dat[0]}`.replace(/^err:\s*(dev:\s*)?/, '');
            if (alert_err) // the backend now reports why an open failed, not only "already opened"
                alert(err.includes('already opened') ?
                      L('Serial port already opened, please close it first, then open again to apply new settings.') : err);
        }
        await dev_get();
    } finally {
        document.getElementById('btn_dev_open').disabled = false;
    }
    return err;
}

async function dev_close() {
    console.log('start close');
    document.getElementById('btn_dev_close').disabled = true;
    try {
        let dat = await dev_req({'action': 'close'});
        console.log('btn_dev_close ret', dat);
        await dev_get();
    } finally {
        document.getElementById('btn_dev_close').disabled = false;
    }
}

document.getElementById('btn_dev_get').onclick = dev_get;
document.getElementById('btn_dev_open').onclick = () => dev_open();
document.getElementById('btn_dev_close').onclick = dev_close;


// ---- the pcapng recording, done by the backend: the box here only shows its state and asks
// for a start or stop. Whatever the backend sends on the 'rec' port is a status, the answer to
// a request and the push after a change made through the api alike, so one loop shows them all
// and the buttons do not wait for anything. While recording the count is refreshed every second.

let rec_timer = null;

function rec_show(st) {
    let elem = document.getElementById('rec_status');
    document.getElementById('btn_rec_start').disabled = !!st.on;
    document.getElementById('btn_rec_stop').disabled = !st.on;
    let detail = st.path ? `${escape_html(st.path)} | ${st.pkts} ${L('packets')}, ${st.marks} ${L('marks')}` : '';
    if (st.on)
        detail += `, ${readable_size(st.size)}`;
    let html = st.on ? `<span style="color: #c00">●</span> ${L('Recording')}: ${detail}`
                     : `${L('Not recording')}` + (detail ? ` (${L('last')}: ${detail})` : '');
    if (st.err)
        html += ` <span style="color: #c00">${escape_html(st.err)}</span>`;
    elem.innerHTML = html;
    if (st.on && !rec_timer)
        rec_timer = setInterval(() => rec_req('get'), 1000);
    if (!st.on && rec_timer) {
        clearInterval(rec_timer);
        rec_timer = null;
    }
}

async function rec_req(action) {
    await csa.rec_sock.sendto({'action': action}, ['server', 'rec']);
}

async function init_rec() {
    csa.rec_sock = new CDWebSocket(csa.ws_ns, 'rec');
    document.getElementById('btn_rec_start').onclick = () => rec_req('start');
    document.getElementById('btn_rec_stop').onclick = () => rec_req('stop');
    await rec_req('get');
    (async () => {
        while (true) {
            let ret = await csa.rec_sock.recvfrom(3000);
            if (ret)
                rec_show(ret[0]);
            else if (!('server' in csa.ws_ns.connections))
                return;
        }
    })();
}


// ---- replay of a pcapng recording, done by the backend (cd_replay.py): this box picks the
// file, says how far to play and shows where it is. As with the recording, every message on the
// 'replay' port is a status, the answer to a request or a push while playing, one loop shows it.

let rp_st = null;

function rp_fmt_t(t) {
    return (Math.round(t * 1000) / 1000).toFixed(3);
}

function rp_show(st) {
    rp_st = st;
    let info = document.getElementById('rp_info');
    let pos = document.getElementById('rp_pos');
    let marks = document.getElementById('rp_marks');
    if (!st.name) {
        info.innerHTML = `<span class="has-text-grey">${L('No file loaded')}</span>`;
        pos.innerHTML = '';
        marks.innerHTML = '';
    } else {
        let devs = st.devs.map(d => {
            let open = st.pages.includes(d);
            return `<span title="${open ? L('page open') : L('no page open')}" ` +
                   `style="${open ? '' : 'color: #999'}">${escape_html(d)}</span>`;
        }).join(', ');
        info.innerHTML = `${escape_html(st.name)} | ${st.pkts} ${L('packets')}, ${st.marks.length} ${L('marks')}, ` +
                         `${rp_fmt_t(st.duration)} s | ${L('addresses')}: ${devs}`;
        pos.innerHTML = `${st.playing ? `<span style="color: #c00">▶</span> ` : ''}` +
                        `${rp_fmt_t(st.t)} / ${rp_fmt_t(st.duration)} s, ${st.pos} / ${st.pkts}`;
        marks.innerHTML = st.marks.length ? `${L('marks')}: ` + st.marks.map((m, i) =>
            `<button class="button is-small" style="margin: 1px;" title="${L('Set Play to this time')}" ` +
            `data-t="${m.t}">${i + 1}: ${rp_fmt_t(m.t)} s ${escape_html(m.text)}</button>`).join('') : '';
        for (let b of marks.querySelectorAll('button'))
            b.onclick = () => { document.getElementById('rp_to').value = rp_fmt_t(Number(b.dataset.t)); };
    }
    if (st.err)
        info.innerHTML += ` <span style="color: #c00">${escape_html(st.err)}</span>`;
    document.getElementById('rp_play').disabled = !st.name || st.playing;
    document.getElementById('rp_pause').disabled = !st.playing;
    document.getElementById('rp_rewind').disabled = !st.name || st.playing;
}

async function rp_req(req) {
    await csa.rp_sock.sendto(req, ['server', 'replay']);
}

// the answer to a 'list' comes back through the same loop as the status messages: one reader
// on the socket, or the two would take each other's messages
function rp_fill_files(files) {
    let sel = document.getElementById('rp_files');
    let cur = sel.value;
    sel.innerHTML = '<option value="">--</option>' + files.map(f =>
        `<option value="${escape_html(f.name)}">${escape_html(f.name)} (${readable_size(f.size)})</option>`).join('');
    sel.value = cur;
    if (sel.value == '' && files.length) // the newest, usually the one just recorded
        sel.value = files[0].name;
}

async function init_replay() {
    csa.rp_sock = new CDWebSocket(csa.ws_ns, 'replay');
    document.getElementById('rp_refresh').onclick = () => rp_req({'action': 'list'});
    document.getElementById('rp_load').onclick = () => {
        let name = document.getElementById('rp_files').value;
        if (name)
            rp_req({'action': 'load', 'name': name});
    };
    document.getElementById('rp_browse').onclick = () => document.getElementById('rp_file').click();
    document.getElementById('rp_file').onchange = async function() {
        if (this.files && this.files.length) {
            let file = this.files[0];
            let data = await read_file(file);
            await rp_req({'action': 'load', 'name': file.name, 'data': data});
        }
        this.value = '';
    };
    document.getElementById('rp_play').onclick = () => {
        let to = Number(document.getElementById('rp_to').value);
        if (document.getElementById('rp_to').value.trim() == '' || isNaN(to)) {
            to = rp_st ? rp_st.duration : 0; // nothing given: to the end
            document.getElementById('rp_to').value = rp_fmt_t(to);
        }
        rp_req({'action': 'play', 'to': to, 'speed': Number(document.getElementById('rp_speed').value)});
    };
    document.getElementById('rp_pause').onclick = () => rp_req({'action': 'stop'});
    document.getElementById('rp_rewind').onclick = () => rp_req({'action': 'rewind'});
    (async () => {
        while (true) {
            let ret = await csa.rp_sock.recvfrom(3000);
            if (ret) {
                if (ret[0].files)
                    rp_fill_files(ret[0].files);
                else
                    rp_show(ret[0]);
            } else if (!('server' in csa.ws_ns.connections))
                return;
        }
    })();
    await rp_req({'action': 'list'});
    await rp_req({'action': 'get'});
}


// ---- the external api (api_serve.py): the serial port, the same way the buttons above do it

const DEV_STATES = ['offline', 'online', 'connecting', 'dead'];

function serial_status() {
    let d = csa.dev_st;
    if (d == null)
        throw new Error('no reply from the backend, see its log');
    if (d == 'udp')
        throw new Error('the backend talks udp (main_udp.py), there is no serial port to set up');
    return {
        port: d.port, baud: d.baud, state: DEV_STATES[d.online] ?? `${d.online}`,
        input: { port: document.getElementById('dev_port').value,
                 baud: document.getElementById('dev_baud').value },
        ports: d.ports, net: d.net, mac: d.mac
    };
}

const api_cmds = {

async serial_get() {
    await dev_get();
    return serial_status();
},

// fill in the boxes (kept, as if typed in), then Open; either one left out keeps what the box has
async serial_open(a) {
    await dev_get();
    serial_status();    // the backend has no serial port at all
    if (a.port != null && (typeof a.port != 'string' || !a.port.trim()))
        throw new Error('port must be a non-empty string: a device path, or any part of a line of "ports"');
    let baud = a.baud == null ? null : Number(a.baud);
    if (baud != null && !(Number.isInteger(baud) && baud > 0))
        throw new Error(`baud must be a positive integer, not ${JSON.stringify(a.baud)}`);
    if (a.port != null)
        document.getElementById('dev_port').value = a.port.trim();
    if (baud != null)
        document.getElementById('dev_baud').value = `${baud}`;
    if (a.port != null || baud != null) {
        await save_serial_cfg();
        update_baud_hint();
    }
    let err = await dev_open(false);
    if (err) {
        let d = csa.dev_st;
        throw new Error(d && d.port ? `${err} (open now: ${d.port} @ ${d.baud})` : err);
    }
    return serial_status();
},

async serial_close() {
    await dev_get();
    serial_status();
    await dev_close();
    return serial_status();
}

};

window.addEventListener('load', async function() {
    console.log("load app");
    
    init_nav();     // translate the page and draw the top bar
    
    csa.db = await new Idb();
    init_ws();
});

