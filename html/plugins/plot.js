/*
 * Software License Agreement (MIT License)
 *
 * Author: Duke Fong <d@d-l.io>
 */

import { L } from '../utils/lang.js'
import { escape_html, date2num, val2hex, dat2str, dat2hex, hex2dat, readable_float,
         read_file, download, readable_size, blob2dat, compare_dat } from '../utils/helper.js';
import { CDWebSocket } from '../utils/cd_ws.js';
import { csa, alloc_port, save_cfg_file, show_banner, show_cfg_error } from '../common.js';
import { wheelZoomPlugin, touchZoomPlugin } from './plot_zoom.js';
import { plot_fft_init, plot_fft_deinit, plot_fft_cal } from './plot_fft.js';
import { plot_reg_w_init, plot_reg_w, cfg_reg_slots } from './plot_reg_w.js';
import { reg_idx_by_name } from './reg.js';
import { fmt_size, reg2str, read_reg_val, str2reg, write_reg_val,
         R_ADDR, R_LEN, R_FMT, R_SHOW, R_ID, R_DESC } from './reg_rw.js';

let color_dft = [ "black", "red", "green", "blue", "cyan", "magenta", "gold",
                  "purple", "brown", "teal", "lime", "hotpink", "tan",
                  "olive", "orange", "pink", "#00000080" ];


async function plot_update(idx) {
    let max_len = csa.plot.plot_max_len[idx];
    let cur_len = csa.plot.dat[idx][0].length;
    let plot_dat = csa.plot.dat[idx];
    if (cur_len > max_len) {
        for (let i = 0; i < plot_dat.length; i++)
            plot_dat[i].splice(0, cur_len - max_len);
        cur_len = max_len;
    }
    if (csa.plot.plot_less_en[idx]) {
        let less_len = csa.plot.plot_less_len[idx];
        if (cur_len > less_len) {
            let less_dat = [];
            for (let i = 0; i < plot_dat.length; i++)
                less_dat.push(plot_dat[i].slice(cur_len - less_len));
            plot_dat = less_dat;
        }
    }
    if (csa.plot.plot_fft_en[idx])
        plot_dat = await plot_fft_cal(idx, plot_dat);
    csa.plot.plots[idx].setData(plot_dat);
}

function append_cal_val(idx, start) {
    let fcals = csa.plot.cal_fn[idx];
    if (!Array.isArray(fcals))
        return;
    let _d = csa.plot.dat[idx];
    for (let i = 0; i < fcals.length; i++) {
        if (!_d[start+i]) { // more formulas than series, should not happen
            console.error(`Plot${idx}: no series for cal result ${start+i}`);
            break;
        }
        let val;
        try {
            val = fcals[i](_d);
        } catch (err) {
            // e.g. the formula points at a series that no longer exists;
            // drop the value, do not throw away the whole packet
            if (!csa.plot.cal_error_reported[idx]) {
                csa.plot.cal_error_reported[idx] = true;
                console.error(`Plot${idx}: cal formula error, further errors are not repeated:`, err);
            }
            val = NaN;
        }
        _d[start+i].push(isNaN(val) ? null : val);
    }
}

function init_cal_fn(idx) {
    csa.plot.cal_fn[idx] = [];
    let cals = csa.cfg.plot.plots[idx].cal;
    for (let c_name in cals) {
        let c_str = cals[c_name];
        if (!/\breturn\b/.test(c_str))
            c_str = `return ( ${c_str} )`;
        try {
            csa.plot.cal_fn[idx].push(new Function('_d', `${c_str}`));
        } catch (err) {
            throw new Error(`cal "${c_name}": ${err.message || err}`);
        }
    }
}

function dv_fmt_read(dv, ofs, fmt) {
    let ret = [];
    fmt = fmt.replace(/\W/g, ''); // remove non-alphanumeric chars
    for (let f of fmt) {
        switch (f) {
        case 'c':
        case 'b':
            ret.push(dv.getInt8(ofs, true));
            ofs += 1; break;
        case 'B':
            ret.push(dv.getUint8(ofs, true));
            ofs += 1; break;
        case 'h':
            ret.push(dv.getInt16(ofs, true));
            ofs += 2; break;
        case 'H':
            ret.push(dv.getUint16(ofs, true));
            ofs += 2; break;
        case 'i':
            ret.push(dv.getInt32(ofs, true));
            ofs += 4; break;
        case 'I':
            ret.push(dv.getUint32(ofs, true));
            ofs += 4; break;
        case 'q':
            ret.push(Number(dv.getBigInt64(ofs, true)));
            ofs += 8; break;
        case 'Q':
            ret.push(Number(dv.getBigUint64(ofs, true)));
            ofs += 8; break;
        case 'f':
            ret.push(dv.getFloat32(ofs, true));
            ofs += 4; break;
        case 'd':
            ret.push(dv.getFloat64(ofs, true));
            ofs += 8; break;
        }
    }
    return ret;
}

function report_parse_error(idx, err) {
    if (csa.plot.parse_error_reported[idx])
        return;
    csa.plot.parse_error_reported[idx] = true;

    console.warn(`Plot${idx}: invalid incoming data ignored`, err);
    let notice = document.getElementById(`plot${idx}_parse_error`);
    if (notice)
        notice.style.display = '';
}

function validate_raw_dat(fmt, dat_len) {
    if (typeof fmt !== 'string' || !fmt.includes('.'))
        throw new Error(`invalid format: ${fmt}`);

    if (fmt[1] == '.') {
        let grp_size = fmt_size(fmt);
        if (!grp_size || dat_len % grp_size)
            throw new Error(`data length ${dat_len} does not match group size ${grp_size}`);
        return;
    }

    let cnt_size = fmt_size(fmt[0]);
    let grp_size = fmt_size(fmt.split('.')[1]);
    let cnt_inc = Number(fmt.split('.')[0].slice(1));
    if (!cnt_size || !grp_size || !Number.isFinite(cnt_inc) ||
            dat_len < cnt_size || (dat_len - cnt_size) % grp_size)
        throw new Error(`data length ${dat_len} does not match format ${fmt}`);
}

function parse_raw_dat(idx, dat) {
    let dv = new DataView(dat.buffer, dat.byteOffset, dat.byteLength);
    let ofs = 0;
    let f = csa.plot.fmt[idx];
    validate_raw_dat(f, dat.length);

    if (f[1] == '.') { // x,d1,d2,d3, x,d1,d2,d3
        let grp_size = fmt_size(f);

        while (ofs < dat.length) {
            let grp_vals = dv_fmt_read(dv, ofs, f);
            let last_x = csa.plot.dat[idx][0].at(-1);
            let cur_x = grp_vals[0] + csa.plot.x_ofs[idx];
            if (last_x && cur_x <= last_x) {
                let type_mod = Math.pow(256, fmt_size(f[0]));
                cur_x += type_mod;
                csa.plot.x_ofs[idx] += type_mod;
            }
            csa.plot.dat[idx][0].push(cur_x);
            for (let i = 1; i < grp_vals.length; i++)
                csa.plot.dat[idx][i].push(grp_vals[i]);
            ofs += grp_size;
            append_cal_val(idx, grp_vals.length);
        }

    } else { // x, d1,d2,d3, d1,d2,d3
        let last_x = csa.plot.dat[idx][0].at(-1);
        let cnt_start = dv_fmt_read(dv, ofs, f[0])[0] + csa.plot.x_ofs[idx];
        ofs += fmt_size(f[0]);
        let grp_fmt = f.split('.')[1];
        let grp_size = fmt_size(grp_fmt);
        let cnt_inc = parseInt(f.split('.')[0].slice(1));
        let loop = 0;
        if (last_x && cnt_start <= last_x) {
            let type_mod = Math.pow(256, fmt_size(f[0]));
            cnt_start += type_mod;
            csa.plot.x_ofs[idx] += type_mod;
        }

        while (ofs < dat.length) {
            let grp_vals = dv_fmt_read(dv, ofs, grp_fmt);
            csa.plot.dat[idx][0].push(cnt_start + cnt_inc * loop);
            for (let i = 0; i < grp_vals.length; i++)
                csa.plot.dat[idx][i+1].push(grp_vals[i]);
            loop += 1;
            ofs += grp_size;
            append_cal_val(idx, grp_vals.length + 1);
        }
    }
}

async function dbg_raw_service() {
    let timer_pending = false;
    
    while (true) {
        let msg = await csa.plot.dbg_raw_sock.recvfrom();
        let dat = msg[0].dat;
        let src_port = msg[0].src[1];
        //console.log('dbg_raw get', dat2hex(dat, ' '));
        
        let idx = src_port & 0xf;
        if (idx >= csa.cfg.plot.plots.length) {
            console.log('dbg_raw: drop');
            continue;
        }
        
        let dat_len_bk = csa.plot.parse_dat_len_bk[idx];
        for (let i = 0; i < csa.plot.dat[idx].length; i++)
            dat_len_bk[i] = csa.plot.dat[idx][i].length;
        let x_ofs_bk = csa.plot.x_ofs[idx];
        try {
            parse_raw_dat(idx, dat);
        } catch (err) {
            for (let i = 0; i < csa.plot.dat[idx].length; i++)
                csa.plot.dat[idx][i].length = dat_len_bk[i];
            csa.plot.x_ofs[idx] = x_ofs_bk;
            report_parse_error(idx, err);
            continue;
        }
        
        if (!timer_pending) {
            timer_pending = true;
            setTimeout(async () => {
                await plot_update(idx);
                timer_pending = false;
            }, 100);
        }
    }
}


function make_chart(idx, name, series) {
    let opts = {
        title: name,
        width: 1200,
        height: 300,
        plugins: [
            wheelZoomPlugin({factor: 0.90}),
            touchZoomPlugin()
        ],
        cursor: {
            drag: { x: false, y: false, setScale: false }
        },
        scales: {
            x: {
                range(u, dataMin, dataMax) {
                    if (dataMin == null)
                        return [0, 100];
                    return [dataMin, dataMax];
                },
                time: false,
            },
            y: {
                range(u, dataMin, dataMax) {
                    if (dataMin == null)
                        return [0, 100];
                    if (dataMin == dataMax)
                        return [dataMin-50, dataMax+50];
                    return [dataMin, dataMax];
                    //return uPlot.rangeNum(dataMin, dataMax, 0.1, true);
                },
                //auto: false,
            }
        },
        axes: [
            {
                space(self, axisIdx, min, max, fullDim) {
                    let str_len = max.toString().length;
                    // length of number with ' separators
                    str_len += Math.floor((str_len - 1) / 3);
                    return str_len * 6 + 24;
                },
            }, {
                size(self, values, axisIdx, cycleNum) {
                    if (cycleNum > 2) // bail out, force convergence
                        return self.axes[axisIdx]._size;
                    if (!values)
                        return 40;
                    return Math.max(values[0].length, values[values.length-1].length) * 6 + 24;
                },
            }
        ],
        series: series,
        hooks: {
            setSeries: [
                async (u, seriesIdx, show) => { await plot_update(idx); }
            ]
        }
    };

    console.log(opts, idx);
    return new uPlot(opts, null, document.getElementById(`plot${idx}`));
}


async function plot_set_en() {
    let idx = reg_idx_by_name(csa.cfg.plot.mask);
    if (idx == null) {
        alert(`plot.mask not found`);
        return;
    }
    let mask_addr = csa.cfg.reg.list[idx][R_ADDR];
    
    let msk = 0;
    for (let i = 0; i < csa.cfg.plot.plots.length; i++) {
        if (document.getElementById(`plot${i}_en`).checked)
            msk |= 1 << i;
    }
    console.log('plot_set_en val:', msk);
    
    let dat = new Uint8Array([0x20, 0, 0, msk]);
    let dv = new DataView(dat.buffer);
    dv.setUint16(1, mask_addr, true);
    
    for (let i = 0; i < 3; i++) {
        csa.plot.proxy_sock.flush();
        await csa.plot.proxy_sock.sendto({'dst': [csa.arg.tgt, 0x5], 'dat': dat}, ['server', 'proxy']);
        console.log('plot_set_en wait ret');
        let ret = await csa.plot.proxy_sock.recvfrom(500 * (i+2));
        console.log('plot_set_en ret', ret);
        if (ret && (ret[0].dat[0] & 0xf) == 0) {
            console.log('plot_set_en ok');
            break;
        } else {
            console.warn(`plot_set_en err retry${i}`);
        }
    }
}


// apply the current checkbox state of plot `i` to the device
async function plot_apply_en(i) {
    let checkbox = document.getElementById(`plot${i}_en`);
    checkbox.disabled = true;
    try {
        if (checkbox.checked) {
            let ret = await plot_reg_w(i);
            if (ret) {
                checkbox.checked = false;
                return -1;
            }
        }
        await plot_set_en();
        return 0;
    } catch (err) {
        checkbox.checked = false;
        console.error(`Plot${i}: config regs failed`, err);
        return -1;
    } finally {
        checkbox.disabled = false;
    }
}

// same as clicking the checkbox / the clear button, also used by the api plugin
async function plot_set_one_en(i, en) {
    document.getElementById(`plot${i}_en`).checked = !!en;
    return await plot_apply_en(i);
}

// straight from the config file, for "Load Default"
let plot_dft = [];      // per plot {label, cal}
let overlay_dft = null; // reg_overlay, shared by all plots
let plot_cfg_idx = 0;   // plot the channel dialog is editing


// A name is written the way the config file writes it, quoted and escaped,
// so a name that contains a colon or a comma cannot break the line apart.
// An unquoted name is still accepted, it just cannot contain a colon.
function name2txt(name) {
    return JSON.stringify(name);
}

// end index of the quoted string starting at i, or -1
function quoted_end(s, i) {
    let q = s[i];
    for (i++; i < s.length; i++) {
        if (s[i] == '\\') {
            i++;
            continue;
        }
        if (s[i] == q)
            return i;
    }
    return -1;
}

// drop the quotes only when the whole field is one quoted string, so a value
// like `'a' + 'b'` is left alone
function unquote(f) {
    if (f[0] != '"' && f[0] != "'")
        return f;
    let end = quoted_end(f, 0);
    if (end != f.length - 1)
        return f;
    return f.slice(1, end).replace(/\\(.)/g, '$1');
}

// split on commas that are not inside quotes
function split_fields(s) {
    let out = [];
    let cur = '';
    for (let i = 0; i < s.length; i++) {
        if (s[i] == '"' || s[i] == "'") {
            let end = quoted_end(s, i);
            if (end < 0) {
                cur += s.slice(i);
                break;
            }
            cur += s.slice(i, end + 1);
            i = end;
        } else if (s[i] == ',') {
            out.push(cur.trim());
            cur = '';
        } else {
            cur += s[i];
        }
    }
    out.push(cur.trim());
    return out;
}

function split_name(line) {
    let q = line[0];
    if (q == '"' || q == "'") {
        let end = -1;
        for (let i = 1; i < line.length; i++) {
            if (line[i] == '\\') {
                i++;
                continue;
            }
            if (line[i] == q) {
                end = i;
                break;
            }
        }
        if (end < 0)
            return null;
        let rest = line.slice(end + 1).trim();
        if (rest[0] != ':')
            return null;
        return [line.slice(1, end).replace(/\\(.)/g, '$1'), rest.slice(1).trim()];
    }
    let i = line.indexOf(':');
    if (i <= 0)
        return null;
    return [line.slice(0, i).trim(), line.slice(i + 1).trim()];
}

function each_line(txt) {
    return txt.split('\n').map(x => x.trim()).filter(x => x && !x.startsWith('//'));
}

// A formula may span lines: the follow up lines are indented, the way a
// continuation is written in a config file that has room for it.
function cal2txt(cal) {
    return Object.entries(cal || {}).map(([k, v]) => {
        let lines = String(v).split('\n');
        // a body that opens with a comment would read as if the whole formula
        // were commented out, so leave the name line bare in that case
        let head = lines[0].startsWith('//') ? '' : lines.shift();
        return name2txt(k) + ':' + (head ? ' ' + head : '') +
               lines.map(x => '\n    ' + x).join('');
    }).join('\n');
}

function txt2label(txt) {
    return txt.split('\n').map(x => x.trim()).filter(x => x.length);
}

function txt2cal(txt) {
    let cal = {};
    let name = null;
    let head = '';
    let cont = [];

    let flush = () => {
        if (name == null)
            return;
        let body;
        if (!cont.length) {
            body = unquote(head);
        } else { // take the common indent back off, keep the shape inside
            let pad = Math.min(...cont.map(x => x.match(/^ */)[0].length));
            let lines = cont.map(x => x.slice(pad));
            body = head ? [head, ...lines].join('\n') : lines.join('\n');
        }
        if (!body)
            throw new Error(L('formula "%s" has no expression').replace('%s', name));
        cal[name] = body;
        name = null;
        head = '';
        cont = [];
    };

    for (let line of txt.split('\n')) {
        line = line.replace(/\s+$/, '');
        // an indented line carries the formula on, comments in a body included
        if (name != null && line && /^\s/.test(line)) {
            cont.push(line);
            continue;
        }
        if (!line || line.startsWith('//')) // blank, or a note about the box
            continue;
        flush();
        let nv = split_name(line);
        if (!nv || !nv[0])
            throw new Error(L('a formula line must be "name": expression, got: %s')
                            .replace('%s', line));
        name = nv[0];
        head = nv[1];
    }
    flush();
    return cal;
}

// reg_overlay entry: [base, ofs, len, fmt, name], base is an address or a
// register name; shown as one line per entry: "name": base, ofs, len, fmt
function overlay2txt(overlay) {
    return (overlay || []).map(o => {
        let base = typeof o[0] == 'number' ?
                   `0x${o[0].toString(16).padStart(4, '0')}` : name2txt(o[0]);
        return `${name2txt(o[4])}: ${base}, ${o[1]}, ${o[2]}, ${name2txt(o[3])}`;
    }).join('\n');
}

function txt2overlay(txt) {
    let ret = [];
    for (let line of each_line(txt)) {
        let nv = split_name(line);
        let a = nv ? split_fields(nv[1]) : [];
        // an unquoted format may hold commas, e.g. H,B2, so it takes the rest
        let fmt = unquote(a.slice(3).join(','));
        let base_s = a.length ? unquote(a[0]) : '';
        if (!nv || !nv[0] || a.length < 4 || !base_s || !fmt ||
                !Number.isFinite(Number(a[1])) || !(Number(a[2]) > 0))
            throw new Error(L('an overlay line must be "name": base, ofs, len, fmt, got: %s')
                            .replace('%s', line));
        let base = /^[-+]?(0[xX][0-9a-fA-F]+|\d+)$/.test(base_s) ? Number(base_s) : base_s;
        ret.push([base, Number(a[1]), Number(a[2]), fmt, nv[0]]);
    }
    return ret;
}

function same_as_dft(idx) {
    let c = csa.cfg.plot.plots[idx];
    let d = plot_dft[idx];
    return compare_dat(c.label, d.label) === null && cal2txt(c.cal) == cal2txt(d.cal);
}

// keep the user's channel choice like the reg button groups are kept
async function plot_cfg_save() {
    let plots = [];
    for (let i = 0; i < csa.cfg.plot.plots.length; i++)
        plots.push(same_as_dft(i) ? null : { label: csa.cfg.plot.plots[i].label,
                                             cal: csa.cfg.plot.plots[i].cal || null });
    let ovl = overlay2txt(csa.cfg.plot.reg_overlay) == overlay2txt(overlay_dft) ?
              null : (csa.cfg.plot.reg_overlay || []);
    let none = ovl == null && plots.every(x => x == null);
    await csa.db.set('tmp', `${csa.arg.name}/plot.cfg`,
                     none ? null : { plots, reg_overlay: ovl });
}


function plot_cfg_hint(idx) {
    let used = csa.plot.reg_val[idx] ? csa.plot.reg_val[idx].length : 0;
    let slots = cfg_reg_slots(csa.cfg.plot.plots[idx].cfg_reg);
    document.getElementById('plot_cfg_hint').innerText =
        `${L('Slots')}: ${used}/${slots == null ? '?' : slots}` +
        (same_as_dft(idx) ? '' : `, ${L('modified')}`);
}

function plot_cfg_open(idx) {
    plot_cfg_idx = idx;
    let c = csa.cfg.plot.plots[idx];
    document.getElementById('plot_cfg_title').innerText = `Plot${idx} ${L('Channels')}`;
    document.getElementById('plot_cfg_label').value = (c.label || []).join('\n');
    document.getElementById('plot_cfg_cal').value = cal2txt(c.cal);
    document.getElementById('plot_cfg_ovl').value = overlay2txt(csa.cfg.plot.reg_overlay);
    document.getElementById('plot_cfg_err').innerText = '';
    plot_cfg_hint(idx);
    document.getElementById('plot_cfg_modal').classList.add('is-active');
}

// rebuild every plot: used when reg_overlay changes, it is shared
async function plot_reconfig_all(skip=-1) {
    for (let i = 0; i < csa.cfg.plot.plots.length; i++) {
        if (i == skip)
            continue;
        let c = csa.cfg.plot.plots[i];
        await plot_reconfig(i, c.label, c.cal || null);
    }
}

// Apply a channel / formula / overlay change. reg_overlay is shared, so when
// it changes every plot is rebuilt, and put back if the new one does not fit.
async function plot_apply_cfg(idx, label, cal, overlay) {
    let ovl_bk = csa.cfg.plot.reg_overlay;
    let ovl_changed = overlay !== undefined && overlay2txt(overlay) != overlay2txt(ovl_bk);
    try {
        if (ovl_changed)
            csa.cfg.plot.reg_overlay = overlay;
        let ret = await plot_reconfig(idx, label, cal);
        if (ovl_changed)
            await plot_reconfig_all(idx);
        return ret;
    } catch (err) {
        if (ovl_changed) {
            csa.cfg.plot.reg_overlay = ovl_bk;
            try {
                await plot_reconfig_all();
            } catch (e) {
                console.error('restore after a failed overlay change:', e);
            }
        }
        throw err;
    }
}

function plot_cfg_diff() {
    let vals = [];
    if (overlay2txt(csa.cfg.plot.reg_overlay) != overlay2txt(overlay_dft))
        vals.push({ path: ['plot', 'reg_overlay'], val: csa.cfg.plot.reg_overlay || [] });
    for (let i = 0; i < csa.cfg.plot.plots.length; i++) {
        let c = csa.cfg.plot.plots[i];
        let d = plot_dft[i];
        if (compare_dat(c.label, d.label) !== null)
            vals.push({ path: ['plot', 'plots', i, 'label'], val: c.label });
        if (cal2txt(c.cal) != cal2txt(d.cal))
            vals.push({ path: ['plot', 'plots', i, 'cal'], val: c.cal || {} });
    }
    return vals;
}

async function plot_cfg_apply(label, cal, overlay) {
    let idx = plot_cfg_idx;
    let err_elm = document.getElementById('plot_cfg_err');
    let btns = ['plot_cfg_apply', 'plot_cfg_def', 'plot_cfg_file']
               .map(x => document.getElementById(x));
    err_elm.innerText = '';
    btns.forEach(b => b.disabled = true);
    try {
        await plot_apply_cfg(idx, label, cal, overlay);
        await plot_cfg_save();
        document.getElementById('plot_cfg_modal').classList.remove('is-active');
    } catch (err) {
        err_elm.innerText = `${err.message || err}`;
    } finally {
        btns.forEach(b => b.disabled = false);
        plot_cfg_hint(idx);
    }
}


// Rebuild a plot from a new channel list without reloading the page: same
// steps init_plot runs. Used by the api plugin, so a script can pick what it
// wants to look at. Restores the old config if the new one does not fit.
async function plot_reconfig(idx, label, cal) {
    let cfg = csa.cfg.plot.plots[idx];
    let bk = { label: cfg.label, cal: cfg.cal, p_label: csa.plot.label[idx],
               fmt: csa.plot.fmt[idx], reg_val: csa.plot.reg_val[idx] };
    let checkbox = document.getElementById(`plot${idx}_en`);
    let was_en = checkbox.checked;

    if (was_en) { // stop the device first, it still sends the old layout
        checkbox.checked = false;
        await plot_set_en();
    }

    if (label)
        cfg.label = label;
    if (cal !== undefined)
        cfg.cal = cal;
    csa.plot.label[idx] = [];
    let err = plot_reg_w_init(idx);
    let series = null;
    if (!err) {
        try {
            series = plot_init_series(idx); // throws if a formula does not compile
            // run each one once: catches a formula pointing at a series that
            // the new channel list does not have
            let names = Object.keys(cfg.cal || {});
            csa.plot.cal_fn[idx].forEach((fn, i) => {
                try {
                    fn(csa.plot.dat[idx]);
                } catch (e) {
                    throw new Error(`cal "${names[i]}": ${e.message || e}`);
                }
            });
        } catch (e) {
            err = `${e.message || e}`;
        }
    }

    if (err) { // put everything back, the page has to stay usable
        cfg.label = bk.label;
        cfg.cal = bk.cal;
        csa.plot.label[idx] = bk.p_label;
        csa.plot.fmt[idx] = bk.fmt;
        csa.plot.reg_val[idx] = bk.reg_val;
        plot_init_series(idx);
        csa.plot.plots[idx].setData(csa.plot.dat[idx]);
        if (was_en) {
            checkbox.checked = true;
            await plot_apply_en(idx);
        }
        throw new Error(err);
    }

    csa.plot.x_ofs[idx] = 0;
    csa.plot.parse_error_reported[idx] = false;
    csa.plot.cal_error_reported[idx] = false;
    document.getElementById(`plot${idx}_parse_error`).style.display = 'none';
    csa.plot.plots[idx].destroy();
    csa.plot.plots[idx] = make_chart(idx, `Plot${idx}`, series);

    if (was_en) {
        checkbox.checked = true;
        if (await plot_apply_en(idx))
            throw new Error('new config written, but enabling the waveform failed');
    }
    return csa.plot.plots[idx].series.map(x => x.label);
}

function plot_clear_dat(i) {
    for (let s = 0; s < csa.plot.dat[i].length; s++)
        csa.plot.dat[i][s] = [];
    csa.plot.plots[i].setData(csa.plot.dat[i]);
    csa.plot.x_ofs[i] = 0;
}


function is_float(n) {
    return typeof n === 'number' && !Number.isInteger(n);
}

function plot_init_series(idx) {
    let f_fmt = csa.plot.fmt[idx];
    let f_label = csa.plot.label[idx];
    let series_num = f_fmt.split('.')[1].length + 1;
    f_label = f_label.slice(0, series_num);
    if (f_label.length < series_num)
        f_label[series_num-1] = '~';
    let series = [];
    
    let cals = csa.cfg.plot.plots[idx].cal;
    if (cals) {
        series_num += Object.keys(cals).length;
        f_label = [...f_label, ...Object.keys(cals)];
    }
    init_cal_fn(idx); // always, or removing every formula leaves stale ones
    
    csa.plot.dat[idx] = [];
    for (let s = 0; s < series_num; s++) {
        let colors = csa.cfg.plot.plots[idx].color ? csa.cfg.plot.plots[idx].color : color_dft;
        let color = colors[(s-1) % colors.length];
        if (!color)
            color = "black";
        let label = f_label[s];
        if (!label)
            label = '~';
        else
            label = label.trim();
        series.push({ label, stroke: color, value: (_, val) => is_float(val) ? readable_float(val) : val });
        csa.plot.dat[idx].push([]);
    }
    return series;
}


async function plot_cal_update(idx) {
    let cal_keys_bk = csa.cfg.plot.plots[idx].cal;
    cal_keys_bk = cal_keys_bk ? Object.keys(cal_keys_bk) : [];
    csa.plot.proxy_sock.flush();
    await csa.plot.proxy_sock.sendto({'action': 'get_cfg', 'cfg': csa.arg.cfg}, ['server', 'cfgs']);
    let dat = await csa.plot.proxy_sock.recvfrom(2000);
    if (dat && dat[0] && dat[0].plot.plots[idx]) {
        csa.cfg.plot.plots[idx] = dat[0].plot.plots[idx];
        console.log('get_cfg ret', csa.cfg.plot.plots[idx]);
    } else {
        console.warn('get_cfg ret', dat);
        return;
    }
    plot_fft_deinit(idx);
    await plot_fft_init(idx);
    
    let dat_bk = csa.plot.dat[idx];
    let series = plot_init_series(idx);
    let f_fmt = csa.plot.fmt[idx];
    let f_num = f_fmt.split('.')[1].length + 1;
    for (let i = 0; i < dat_bk[0].length; i++) {
        for (let n = 0; n < f_num; n++)
            csa.plot.dat[idx][n].push(dat_bk[n][i]);
        append_cal_val(idx, f_num);
    }
    let cal_keys = csa.cfg.plot.plots[idx].cal;
    cal_keys = cal_keys ? Object.keys(cal_keys) : [];
    if (compare_dat(cal_keys_bk, cal_keys) !== null) {
        console.log(`replace chart, key changes: ${cal_keys_bk} -> ${cal_keys}`);
        csa.plot.plots[idx].destroy();
        let u = make_chart(idx, `Plot${idx}`, series);
        csa.plot.plots[idx] = u;
    }
    await plot_update(idx);
}


async function init_plot() {
    if (!csa.cfg.plot) {
        console.info(`skip init_plot`);
        return;
    }
    if (!csa.cfg.plot.plots || !csa.cfg.plot.plots.length) {
        show_cfg_error(L('Plot list is empty.'));
        return;
    }
    if (reg_idx_by_name(csa.cfg.plot.mask) == null)
        show_cfg_error(L('Plot mask register not found: %s').replace('%s', `${csa.cfg.plot.mask}`));
    csa.plot = {};
    csa.plugins.push('plot');

    let port = await alloc_port(0x0a);
    console.log(`init_plot, alloc dbg_raw port: ${port}`);
    csa.plot.dbg_raw_sock = new CDWebSocket(csa.ws_ns, port);
    
    port = await alloc_port();
    console.log(`init_plot, alloc plot port: ${port}`);
    csa.plot.proxy_sock = new CDWebSocket(csa.ws_ns, port);
    
    let html = `
        <div class="container" id="plot_list">
            <h2 class="title is-size-4">Plots</h2>
        </div>
        <div class="modal" id="plot_cfg_modal">
            <div class="modal-background" id="plot_cfg_bg"></div>
            <div class="modal-card">
                <header class="modal-card-head" style="padding: 0.8rem 1rem;">
                    <p class="modal-card-title is-size-6" id="plot_cfg_title">Plot</p>
                    <button class="delete" id="plot_cfg_close"></button>
                </header>
                <section class="modal-card-body" style="padding: 1rem;">
                    <div style="margin-bottom: 0.3rem;">${L('Channels')}:
                        <span class="is-size-7">${L('one per line, the first is the x axis')}</span>
                        | <span class="is-size-7" id="plot_cfg_hint"></span>
                    </div>
                    <textarea class="textarea is-small" rows="7" id="plot_cfg_label"
                              style="font-family: monospace;" spellcheck="false"></textarea>
                    <div style="margin: 0.6rem 0 0.3rem;">${L('Formulas')}:
                        <span class="is-size-7">${L('one per line, "name": expression')}</span>
                    </div>
                    <textarea class="textarea is-small" rows="5" id="plot_cfg_cal"
                              style="font-family: monospace;" spellcheck="false"></textarea>
                    <div style="margin: 0.6rem 0 0.3rem;">${L('Overlays')}:
                        <span class="is-size-7">${L('shared by all plots, "name": base, ofs, len, fmt')}</span>
                    </div>
                    <textarea class="textarea is-small" rows="4" id="plot_cfg_ovl"
                              style="font-family: monospace;" spellcheck="false"></textarea>
                    <div class="is-size-7" id="plot_cfg_err"
                         style="margin-top: 0.5rem; color: #c00; white-space: pre-wrap;"></div>
                </section>
                <footer class="modal-card-foot" style="padding: 0.8rem 1rem;">
                    <button class="button is-small is-primary" id="plot_cfg_apply">${L('Apply')}</button>
                    <button class="button is-small" id="plot_cfg_def">${L('Load Default')}</button>
                    <button class="button is-small" id="plot_cfg_file">${L('Update Config File')}</button>
                </footer>
            </div>
        </div>
        <br>`;
    document.getElementsByTagName('section')[0].insertAdjacentHTML('beforeend', html);

    let cfg_close = () => document.getElementById('plot_cfg_modal').classList.remove('is-active');
    document.getElementById('plot_cfg_close').onclick = cfg_close;
    document.getElementById('plot_cfg_bg').onclick = cfg_close;

    // examples, shown while a box is still empty
    document.getElementById('plot_cfg_cal').placeholder =
            L('// _d[1] is the first channel, _d[0] the x axis, at(-1) its newest sample') + '\n' +
            L('// indent to carry one formula on to the next line') + '\n' +
            '"err": _d[2].at(-1) - _d[1].at(-1)\n' +
            '"clip": let e = _d[2].at(-1) - _d[1].at(-1);\n' +
            '    return Math.min(Math.abs(e), 100);';
    document.getElementById('plot_cfg_ovl').placeholder =
            L('// base is a reg name or an address, ofs and len are bytes') + '\n' +
            L('// commas in fmt cover several values: pid_dbg[0], pid_dbg[1] ...') + '\n' +
            '"i_term": "pid_pos_ki", 24, 4, "f"\n' +
            '"pid_dbg": 0x0150, 0, 12, "i,f,i"';
    document.getElementById('plot_cfg_apply').onclick = async () => {
        let label, cal, ovl;
        try {
            label = txt2label(document.getElementById('plot_cfg_label').value);
            cal = txt2cal(document.getElementById('plot_cfg_cal').value);
            ovl = txt2overlay(document.getElementById('plot_cfg_ovl').value);
        } catch (err) {
            document.getElementById('plot_cfg_err').innerText = `${err.message || err}`;
            return;
        }
        await plot_cfg_apply(label, cal, ovl);
    };
    // apply what is in the boxes, then push every change into the config file
    document.getElementById('plot_cfg_file').onclick = async () => {
        let err_elm = document.getElementById('plot_cfg_err');
        let btns = ['plot_cfg_apply', 'plot_cfg_def', 'plot_cfg_file']
                   .map(x => document.getElementById(x));
        let label, cal, ovl;
        try {
            label = txt2label(document.getElementById('plot_cfg_label').value);
            cal = txt2cal(document.getElementById('plot_cfg_cal').value);
            ovl = txt2overlay(document.getElementById('plot_cfg_ovl').value);
        } catch (err) {
            err_elm.innerText = `${err.message || err}`;
            return;
        }
        err_elm.innerText = '';
        btns.forEach(b => b.disabled = true);
        try {
            await plot_apply_cfg(plot_cfg_idx, label, cal, ovl);
            let vals = plot_cfg_diff();
            if (!vals.length) {
                err_elm.innerText = L('The config file already matches, nothing to save.');
                return;
            }
            await save_cfg_file(vals);
            overlay_dft = csa.cfg.plot.reg_overlay; // the file is the default now
            plot_dft = csa.cfg.plot.plots.map(c => ({ label: c.label, cal: c.cal }));
            await plot_cfg_save();
            document.getElementById('plot_cfg_modal').classList.remove('is-active');
            alert(L('Saved to %s, the previous version is kept as a .bak file.')
                  .replace('%s', csa.arg.cfg));
        } catch (err) {
            err_elm.innerText = `${err.message || err}`;
        } finally {
            btns.forEach(b => b.disabled = false);
            plot_cfg_hint(plot_cfg_idx);
        }
    };
    // the overlay list is shared, so this restores every plot at once
    document.getElementById('plot_cfg_def').onclick = async () => {
        if (!confirm(L('Restore the channels of all plots and the overlay list from the config file?')))
            return;
        let err_elm = document.getElementById('plot_cfg_err');
        err_elm.innerText = '';
        try {
            csa.cfg.plot.reg_overlay = overlay_dft;
            for (let i = 0; i < csa.cfg.plot.plots.length; i++)
                await plot_reconfig(i, plot_dft[i].label, plot_dft[i].cal || null);
            await plot_cfg_save();
            plot_cfg_open(plot_cfg_idx);
        } catch (err) {
            err_elm.innerText = `${err.message || err}`;
        }
    };
    
    
    let list = document.getElementById('plot_list');
    const max_len = 50000;
    const less_len = 5000;
    plot_dft = [];
    overlay_dft = csa.cfg.plot.reg_overlay;
    let saved = await csa.db.get('tmp', `${csa.arg.name}/plot.cfg`);
    csa.plot.plots = [];
    csa.plot.dat = [];
    csa.plot.cal_fn = [];
    csa.plot.plot_max_len = [];
    csa.plot.plot_less_len = [];
    csa.plot.plot_less_en = [];
    csa.plot.plot_fft_en = [];
    csa.plot.plot_fft = [];
    csa.plot.x_ofs = [];
    csa.plot.fmt = [];
    csa.plot.label = [];
    csa.plot.reg_val = [];
    csa.plot.parse_error_reported = [];
    csa.plot.cal_error_reported = [];
    csa.plot.parse_dat_len_bk = [];
    
    for (let i = 0; i < csa.cfg.plot.plots.length; i++) {
        csa.plot.plot_max_len.push(max_len);
        csa.plot.plot_less_len.push(less_len);
        csa.plot.plot_less_en.push(true);
        csa.plot.plot_fft_en.push(false);
        csa.plot.plot_fft.push({});
        csa.plot.x_ofs.push(0);
        csa.plot.fmt.push('');
        csa.plot.label.push([]);
        csa.plot.reg_val.push(null);
        csa.plot.parse_error_reported.push(false);
        csa.plot.cal_error_reported.push(false);
        csa.plot.parse_dat_len_bk.push([]);
        await plot_fft_init(i);
        plot_dft.push({ label: csa.cfg.plot.plots[i].label, cal: csa.cfg.plot.plots[i].cal });
    }
    
    // Apply what the user picked in this browser. If it no longer fits, e.g.
    // the config file was edited since, drop the whole saved choice and go
    // back to the file: the overlay list is shared, a half applied mix of the
    // two would be worse than either.
    let apply_saved = (use) => {
        csa.cfg.plot.reg_overlay = use && saved.reg_overlay ? saved.reg_overlay : overlay_dft;
        let errs = [];
        for (let i = 0; i < csa.cfg.plot.plots.length; i++) {
            let sp = use && saved.plots ? saved.plots[i] : null;
            csa.cfg.plot.plots[i].label = sp ? sp.label : plot_dft[i].label;
            csa.cfg.plot.plots[i].cal = sp ? sp.cal : plot_dft[i].cal;
            csa.plot.label[i] = [];
            let e = plot_reg_w_init(i);
            if (e)
                errs.push(`Plot${i}: ${e}`);
        }
        return errs;
    };
    let cfg_errs = apply_saved(!!saved);
    if (cfg_errs.length && saved) {
        console.warn(`saved plot config rejected: ${cfg_errs}, using the default`);
        cfg_errs = apply_saved(false);
        await csa.db.set('tmp', `${csa.arg.name}/plot.cfg`, null);
        show_banner('plot_cfg_banner',
                    `<b>${L('Saved plot channels no longer fit the config file, the default was restored.')}</b>`,
                    'is-warning');
    }
    for (let e of cfg_errs)
        show_cfg_error(e);
    
    for (let i = 0; i < csa.cfg.plot.plots.length; i++) {
        let html = `
            <div class="is-inline-flex" style="align-items: center; gap: 0.3rem; margin: 5px 0;">
                <label class="checkbox"><input type="checkbox" id="plot${i}_en"> ${L('Enable')} Plot${i}</label>
                | ${L('Depth')}: <input type="text" size="8" placeholder="${max_len}" id="plot${i}_len" value="${max_len}">
                ${L('Realtime')} <input type="checkbox" id="plot${i}_less" checked>:
                <input type="text" size="6" placeholder="${less_len}" id="plot${i}_less_len" value="${less_len}">
                FFT <input type="checkbox" id="plot${i}_fft">
                <button class="button is-small" id="plot${i}_cfg">${L('Channels')}</button>
                <button class="button is-small" id="plot${i}_clear">${L('Clear')}</button>
                <button class="button is-small" id="plot${i}_re_cal">${L('Re-Calc')}</button>
            </div>
            <div class="notification is-warning is-light" id="plot${i}_parse_error" style="display: none; padding: 0.75rem;">
                <button class="delete" aria-label="close"></button>
                Plot${i}: ${L('Invalid incoming data was ignored. Further errors will not be shown repeatedly.')}
            </div>
            <div id="plot${i}" class="resizable"></div>
        `;
        
        list.insertAdjacentHTML('beforeend', html);
        document.querySelector(`#plot${i}_parse_error .delete`).onclick = () => {
            document.getElementById(`plot${i}_parse_error`).style.display = 'none';
        };
        document.getElementById(`plot${i}_en`).onchange = async () => { await plot_apply_en(i); };
        let series = plot_init_series(i);
        let u = make_chart(i, `Plot${i}`, series);
        csa.plot.plots.push(u);
        
        const observer = new ResizeObserver(() => {
            let elm = document.getElementById(`plot${i}`);
            let title_height = elm.querySelector('.u-title').offsetHeight;
            let legend_height = elm.querySelector('.u-legend').offsetHeight;
            let height = elm.offsetHeight - title_height - legend_height;
            //console.log(`plot${i} fit: width: ${elm.offsetWidth}, height: ${height} (${elm.offsetHeight})`);
            csa.plot.plots[i].setSize({width: elm.offsetWidth, height});
        });
        observer.observe(document.getElementById(`plot${i}`));
        
        document.getElementById(`plot${i}_len`).onchange = async () => {
            let len = Number(document.getElementById(`plot${i}_len`).value);
            csa.plot.plot_max_len[i] = len;
        };
        document.getElementById(`plot${i}_less_len`).onchange = async () => {
            let len = Number(document.getElementById(`plot${i}_less_len`).value);
            csa.plot.plot_less_len[i] = len;
        };
        document.getElementById(`plot${i}_less`).onchange = async () => {
            csa.plot.plot_less_en[i] = document.getElementById(`plot${i}_less`).checked;
            await plot_update(i);
        };
        document.getElementById(`plot${i}_fft`).onchange = async () => {
            csa.plot.plot_fft_en[i] = document.getElementById(`plot${i}_fft`).checked;
            await plot_update(i);
        };
        document.getElementById(`plot${i}_cfg`).onclick = () => { plot_cfg_open(i); };
        document.getElementById(`plot${i}_clear`).onclick = async () => { plot_clear_dat(i); };
        document.getElementById(`plot${i}_re_cal`).onclick = async () => {
            document.getElementById(`plot${i}_re_cal`).disabled = true;
            await plot_cal_update(i);
            document.getElementById(`plot${i}_re_cal`).disabled = false;
        };
    }
    
    dbg_raw_service();
    
    csa.plot.set_en = plot_set_one_en;
    csa.plot.clear = plot_clear_dat;
    csa.plot.reconfig = plot_apply_cfg;
    csa.plot.save_cfg = plot_cfg_save;

    csa.plot.dat_export = () => { return csa.plot.dat; };
    csa.plot.dat_import = (dat) => {
        for (let i = 0; i < csa.plot.plots.length; i++) {
            let padding = Math.max(csa.plot.dat[i].length - dat[i].length, 0);
            csa.plot.dat[i] = dat[i].concat(Array(padding).fill([]));
            csa.plot.plots[i].setData(csa.plot.dat[i]);
        }
    };
}


export { init_plot };
