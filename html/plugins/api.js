/*
 * Software License Agreement (MIT License)
 *
 * Author: Duke Fong <d@d-l.io>
 *
 * Command layer for the external API (see api_serve.py).
 *
 * The backend relays a command here, this file runs the same functions the
 * buttons run, and replies with the result. Values still go through the
 * input boxes on the page, so the user sees every step, and waveforms keep
 * being drawn as usual.
 *
 * Commands are serialized: one finishes before the next starts.
 */

import { timestamp } from '../utils/helper.js';
import { CDWebSocket } from '../utils/cd_ws.js';
import { csa } from '../common.js';
import { fmt_size, read_reg_val, write_reg_val,
         R_ADDR, R_LEN, R_FMT, R_SHOW, R_ID, R_DESC } from './reg_rw.js';
import { cfg_reg_slots } from './plot_reg_w.js';


// ------------------------------------------------------------ reg helpers

// flatten the reg list, one entry per input box on the page
function reg_entries() {
    let ret = [];
    for (let r of csa.cfg.reg.list) {
        if (r[R_FMT][0] == '{') {
            let one_size = fmt_size(r[R_FMT]);
            let count = Math.trunc(r[R_LEN] / one_size);
            for (let n = 0; n < count; n++)
                ret.push({ name: `${r[R_ID]}.${n}`, key: `reg.${r[R_ID]}.${n}`,
                           addr: r[R_ADDR] + one_size * n, len: one_size,
                           fmt: r[R_FMT], show: r[R_SHOW], desc: r[R_DESC] });
        } else {
            ret.push({ name: r[R_ID], key: `reg.${r[R_ID]}`,
                       addr: r[R_ADDR], len: r[R_LEN],
                       fmt: r[R_FMT], show: r[R_SHOW], desc: r[R_DESC] });
        }
    }
    return ret;
}

function grp_idx(rw, addr, len) {
    let list = rw == 'r' ? csa.reg.reg_r : csa.reg.reg_w;
    for (let i = 0; i < list.length; i++) {
        if (addr >= list[i][0] && addr + len <= list[i][0] + list[i][1])
            return i;
    }
    return null;
}

// read groups overlapping a write group, so the input boxes are fresh
// before write_reg_val() packs all of them into one frame
function overlap_r_idx(w_idx) {
    let [addr, len] = csa.reg.reg_w[w_idx];
    let ret = [];
    for (let i = 0; i < csa.reg.reg_r.length; i++) {
        let [a, l] = csa.reg.reg_r[i];
        if (a < addr + len && addr < a + l)
            ret.push(i);
    }
    return ret;
}

function find_entries(names) {
    let all = reg_entries();
    if (!names || !names.length)
        return all.filter(e => grp_idx('r', e.addr, e.len) != null);
    let ret = [];
    for (let n of names) {
        let e = all.find(e => e.name == n);
        if (!e)
            throw new Error(`unknown reg: ${n}`);
        ret.push(e);
    }
    return ret;
}


// ------------------------------------------------------------ commands

const cmds = {

async info() {
    let regs = reg_entries().map(e => ({
        name: e.name, fmt: e.fmt, desc: e.desc,
        r: grp_idx('r', e.addr, e.len) != null,
        w: grp_idx('w', e.addr, e.len) != null
    }));
    let plots = [];
    if (csa.plot) {
        for (let i = 0; i < csa.plot.plots.length; i++) {
            let xs = csa.plot.dat[i][0];
            let c = csa.cfg.plot.plots[i];
            plots.push({
                idx: i,
                en: document.getElementById(`plot${i}_en`).checked,
                labels: csa.plot.plots[i].series.map(s => s.label),
                label: c.label,     // channel list, what plot_cfg takes
                cal: c.cal || null,
                x_fmt: c.x_fmt,
                cfg_reg: c.cfg_reg,
                slots: cfg_reg_slots(c.cfg_reg),
                slots_used: csa.plot.reg_val[i] ? csa.plot.reg_val[i].length : null,
                len: xs.length,
                x_min: xs.length ? xs[0] : null,
                x_max: xs.length ? xs.at(-1) : null
            });
        }
    }
    return {
        tgt: csa.arg.tgt, name: csa.arg.name, cfg: csa.arg.cfg,
        info: document.getElementById('dev_info').innerText,
        reg_overlay: (csa.cfg.plot && csa.cfg.plot.reg_overlay) || [],
        regs, plots
    };
},

async reg_read(a) {
    let entries = find_entries(a.names);
    let idxs = [];
    for (let e of entries) {
        let i = grp_idx('r', e.addr, e.len);
        if (i != null && !idxs.includes(i))
            idxs.push(i);
    }
    idxs.sort((x, y) => csa.reg.reg_r[x][0] - csa.reg.reg_r[y][0]);
    for (let i of idxs) {
        if (await read_reg_val(i))
            throw new Error(`read reg group ${i} failed (addr 0x${csa.reg.reg_r[i][0].toString(16)})`);
    }
    let ret = {};
    for (let e of entries)
        ret[e.name] = grp_idx('r', e.addr, e.len) == null ? null : csa.reg.elm[e.key].value;
    return ret;
},

async reg_write(a) {
    let names = Object.keys(a.vals || {});
    if (!names.length)
        throw new Error('no reg to write');
    let entries = find_entries(names);
    let idxs = [];
    for (let e of entries) {
        let i = grp_idx('w', e.addr, e.len);
        if (i == null)
            throw new Error(`reg write disabled: ${e.name}`);
        if (!idxs.includes(i))
            idxs.push(i);
    }
    idxs.sort((x, y) => csa.reg.reg_w[x][0] - csa.reg.reg_w[y][0]);

    if (a.refresh !== false) {
        let r_idxs = [];
        for (let i of idxs) {
            for (let r of overlap_r_idx(i)) {
                if (!r_idxs.includes(r))
                    r_idxs.push(r);
            }
        }
        for (let r of r_idxs) {
            if (await read_reg_val(r))
                throw new Error(`read before write failed, reg group ${r}`);
        }
    }

    for (let e of entries)
        csa.reg.elm[e.key].value = a.vals[e.name];
    for (let i of idxs) {
        if (await write_reg_val(i))
            throw new Error(`write reg group ${i} failed (addr 0x${csa.reg.reg_w[i][0].toString(16)})`);
    }
    return names.length;
},

async log_read(a) {
    return csa.dbg.log_read(a.since, a.max);
},

async log_clear() {
    csa.dbg.log_clear();
    return 0;
},

async plot_en(a) {
    let idx = chk_plot(a.idx);
    if (await csa.plot.set_en(idx, !!a.en))
        throw new Error(`plot${idx}: set enable failed, check the page for details`);
    return 0;
},

// pick what the plot samples, without reloading the page
async plot_cfg(a) {
    let idx = chk_plot(a.idx);
    if (a.label !== undefined && (!Array.isArray(a.label) || a.label.length < 2))
        throw new Error('label must be a list of at least 2: [x_name, ch1, ...]');
    if (a.cal !== undefined && a.cal !== null &&
            (typeof a.cal != 'object' || Array.isArray(a.cal)))
        throw new Error('cal must be an object: {"name": "expression"}');
    if (a.overlay !== undefined && a.overlay !== null && !Array.isArray(a.overlay))
        throw new Error('overlay must be a list of [base, ofs, len, fmt, name]');
    // overlay is shared by all plots of the device, not per plot
    let ret = await csa.plot.reconfig(idx, a.label, a.cal, a.overlay);
    if (a.save)  // keep it across page reloads, like the user's own choice
        await csa.plot.save_cfg();
    return ret;
},

async plot_clear(a) {
    csa.plot.clear(chk_plot(a.idx));
    return 0;
},

async plot_read(a) {
    let idx = chk_plot(a.idx);
    let dat = csa.plot.dat[idx];
    let series = csa.plot.plots[idx].series;
    let xs = dat[0];

    let cols = [0];
    if (a.series && a.series.length) {
        for (let s of a.series) {
            let c = series.findIndex(x => x.label == s);
            if (c < 0 && /^\d+$/.test(s) && Number(s) < series.length)
                c = Number(s);
            if (c < 0)
                throw new Error(`plot${idx}: unknown series: ${s}, has: ${series.map(x => x.label)}`);
            if (!cols.includes(c))
                cols.push(c);
        }
    } else {
        for (let c = 1; c < series.length; c++)
            cols.push(c);
    }

    let step = a.step >= 1 ? Math.round(a.step) : 1;
    let i_start = 0, i_end = xs.length;
    if (a.start != null) {
        while (i_start < i_end && xs[i_start] < a.start)
            i_start++;
    }
    if (a.end != null) {
        while (i_end > i_start && xs[i_end-1] > a.end)
            i_end--;
    }
    if (a.tail > 0)
        i_start = Math.max(i_start, i_end - a.tail * step);

    let digits = a.digits >= 1 ? Math.round(a.digits) : 0;
    let labels = cols.map(c => series[c].label);

    if (a.fmt == 'json') {
        let rows = [];
        for (let i = i_start; i < i_end; i += step)
            rows.push(cols.map(c => num(dat[c][i], c ? digits : 0)));
        return { labels, rows, total: xs.length,
                 x_min: xs.length ? xs[0] : null, x_max: xs.length ? xs.at(-1) : null };
    }
    let lines = [labels.map(csv_field).join(',')];
    for (let i = i_start; i < i_end; i += step)
        lines.push(cols.map(c => csv_str(dat[c][i], c ? digits : 0)).join(','));
    return lines.join('\n') + '\n';
},

async iap_start(a) {
    if (!csa.cfg.iap)
        throw new Error('no iap section in the device config file');
    if (!csa.iap.stop)
        throw new Error('iap is already running');
    let action = a.action || 'bl_full';
    if (!['bl_full', 'bl_flash', 'bl', 'flash'].includes(action))
        throw new Error(`bad iap action: ${action}`);
    let check = a.check || 'none';
    if (!['none', 'read', 'crc'].includes(check))
        throw new Error(`bad iap check: ${check}`);
    if (!a.path && action != 'bl')
        throw new Error('iap path is empty');
    csa.iap.start(a.path || '', action, check);
    return 0;
},

async iap_stop() {
    csa.iap.stop_now();
    return 0;
},

async iap_status() {
    return csa.iap.status();
}

};


// ------------------------------------------------------------ misc

function chk_plot(idx) {
    if (!csa.plot)
        throw new Error('no plot section in the device config file');
    idx = Math.round(Number(idx));
    if (!(idx >= 0 && idx < csa.plot.plots.length))
        throw new Error(`plot index out of range: ${idx}`);
    return idx;
}

function num(v, digits) {
    if (v == null || Number.isNaN(v))
        return null;
    if (!digits || Number.isInteger(v))
        return v;
    return +v.toPrecision(digits);
}

function csv_str(v, digits) {
    let n = num(v, digits);
    return n == null ? '' : String(n);
}

function csv_field(s) {
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

async function handle(dat, src) {
    let rep = { id: dat.id, err: null, ret: null };
    let args = dat.args || {};
    try {
        if (!(dat.cmd in cmds))
            throw new Error(`unknown cmd: ${dat.cmd}`);
        rep.ret = await cmds[dat.cmd](args); // the backend prints it in the log
    } catch (err) {
        rep.err = `${err.message || err}`;
        console.error('api:', dat.cmd, err);
    }
    await csa.api.sock.sendto(rep, src);
}


async function api_service() {
    let queue = Promise.resolve();
    while (true) {
        let msg = await csa.api.sock.recvfrom();
        let dat = msg[0];
        if (!dat || !dat.cmd) { // answer of our 'hello', or api not enabled
            console.log('api: backend ret', dat);
            continue;
        }
        queue = queue.then(() => handle(dat, msg[1])).catch(err => console.error('api:', err));
    }
}


async function init_api() {
    csa.api = {};
    csa.api.sock = new CDWebSocket(csa.ws_ns, 'api');
    api_service();

    // tell the backend which device this page serves, so a script can address
    // it by name; no need to wait, the api is optional
    let plots = csa.plot ? csa.plot.plots.length : 0;
    await csa.api.sock.sendto({ 'cmd': 'hello',
        'args': { tgt: csa.arg.tgt, name: csa.arg.name, cfg: csa.arg.cfg, plots }
    }, ['server', 'api']);
}

export { init_api };
