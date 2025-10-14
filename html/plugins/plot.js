/*
 * Software License Agreement (MIT License)
 *
 * Author: Duke Fong <d@d-l.io>
 */

import { L } from '../utils/lang.js'
import { escape_html, date2num, val2hex, dat2str, dat2hex, hex2dat,
         read_file, download, readable_size, blob2dat } from '../utils/helper.js';
import { CDWebSocket } from '../utils/cd_ws.js';
import { csa, alloc_port } from '../common.js';
import { wheelZoomPlugin, touchZoomPlugin } from './plot_zoom.js';
import { reg_idx_by_name } from './reg.js';
import { fmt_size, reg2str, read_reg_val, str2reg, write_reg_val,
         R_ADDR, R_LEN, R_FMT, R_SHOW, R_ID, R_DESC } from './reg_rw.js';

let color_dft = [ "black", "red", "green", "blue", "cyan", "magenta", "gold",
                  "purple", "brown", "teal", "lime", "hotpink", "tan",
                  "olive", "orange", "pink", "#00000080" ];


function append_cal_val(idx, start, max_len) {
    let fcals = csa.plot.cal_fn[idx];
    if (!Array.isArray(fcals))
        return;
    let _d = csa.plot.dat[idx];
    for (let i = 0; i < fcals.length; i++) {
        const cal_fn = fcals[i];
        let val = cal_fn(_d);
        let cal_d = csa.plot.dat[idx][start+i];
        cal_d.push(isNaN(val) ? null : val);
        if (max_len && cal_d.length > max_len)
            cal_d.splice(0, cal_d.length - max_len);
    }
}

function init_cal_fn(idx) {
    csa.plot.cal_fn[idx] = [];
    let cals = csa.cfg.plot.cal[idx];
    for (let i = 0; i < cals.length; i++) {
        let c_name = cals[i].split(':')[0];
        let c_str = cals[i].slice(c_name.length + 1);
        if (!/\breturn\b/.test(c_str))
            c_str = `return ( ${c_str} )`;
        csa.plot.cal_fn[idx].push(new Function('_d', `${c_str}`));
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
        case 'f':
            //ret.push(+dv.getFloat32(ofs, true).toFixed(9));
            ret.push(dv.getFloat32(ofs, true));
            ofs += 4; break;
        }
    }
    return ret;
}

async function dbg_raw_service() {
    let timer_pending = false;
    
    while (true) {
        let msg = await csa.plot.dbg_raw_sock.recvfrom();
        let dat = msg[0].dat;
        let src_port = msg[0].src[1];
        dat = dat.slice(0); // dataview return wrong value without this
        let dv = new DataView(dat.buffer);
        //console.log('dbg_raw get', dat2hex(dat, ' '));
        
        let idx = src_port & 0xf;
        if (idx >= csa.cfg.plot.fmt.length) {
            console.log('dbg_raw: drop');
            continue;
        }
        let max_len = 0;
        if (!timer_pending)
            max_len = csa.plot.plot_max_len[idx];
        
        let ofs = 0;
        let f = csa.cfg.plot.fmt[idx].split(' - ')[0];

        if (f[1] == '.') { // x,d1,d2,d3, x,d1,d2,d3
            let grp_size = fmt_size(f);
            
            while (ofs < dat.length) {
                let grp_vals = dv_fmt_read(dv, ofs, f);
                for (let i = 0; i < grp_vals.length; i++) {
                    let dat_d = csa.plot.dat[idx][i];
                    dat_d.push(grp_vals[i]);
                    if (max_len && dat_d.length > max_len)
                        dat_d.splice(0, dat_d.length - max_len);
                }
                ofs += grp_size;
                append_cal_val(idx, grp_vals.length, max_len);
            }
        
        } else { // x, d1,d2,d3, d1,d2,d3
            let cnt_start = dv_fmt_read(dv, ofs, f[0])[0];
            ofs += fmt_size(f[0]);
            let grp_fmt = f.split('.')[1];
            let grp_size = fmt_size(grp_fmt);
            let cnt_inc = parseInt(f.split('.')[0].slice(1));
            let loop = 0;
            
            while (ofs < dat.length) {
                let grp_vals = dv_fmt_read(dv, ofs, grp_fmt);
                let dat_d = csa.plot.dat[idx][0];
                dat_d.push(cnt_start + cnt_inc * loop);
                if (max_len && dat_d.length > max_len)
                    dat_d.splice(0, dat_d.length - max_len);
                for (let i = 0; i < grp_vals.length; i++) {
                    let dat_d = csa.plot.dat[idx][i+1];
                    dat_d.push(grp_vals[i]);
                    if (max_len && dat_d.length > max_len)
                        dat_d.splice(0, dat_d.length - max_len);
                }
                loop += 1;
                ofs += grp_size;
                append_cal_val(idx, grp_vals.length + 1, max_len);
            }
        }
        
        if (!timer_pending) {
            timer_pending = true;
            setTimeout(() => {
                csa.plot.plots[idx].setData(csa.plot.dat[idx]);
                timer_pending = false;
            }, 100);
        }
    }
}


function make_chart(eid, name, series) {
    let opts = {
        title: name,
        width: 1200,
        height: 200,
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
                    return Math.max(min.toFixed(3).length * 8, max.toFixed(3).length * 8);
                },
            }, {
                size(self, values, axisIdx, cycleNum) {
                    if (cycleNum > 2) // bail out, force convergence
                        return self.axes[axisIdx]._size;
                    if (!values)
                        return 40;
                    return Math.max(values[0].length * 8, values[values.length-1].length * 8) + 8;
                },
            }
        ],
        series: series
    };

    console.log(opts, eid);
    return new uPlot(opts, null, document.getElementById(eid));
}


async function plot_set_en() {
    let idx = reg_idx_by_name(csa.cfg.plot.mask);
    if (idx == null) {
        alert(`plot.mask not found`);
        return;
    }
    let mask_addr = csa.cfg.reg.list[idx][R_ADDR];
    
    let msk = 0;
    for (let i = 0; i < csa.cfg.plot.fmt.length; i++) {
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


async function init_plot() {
    if (!csa.cfg.plot) {
        console.info(`skip init_plot`);
        return;
    }
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
        <br>`;
    document.getElementsByTagName('section')[0].insertAdjacentHTML('beforeend', html);
    
    
    let list = document.getElementById('plot_list');
    const max_len = 10000;
    csa.plot.plots = [];
    csa.plot.dat = [];
    csa.plot.cal_fn = [];
    csa.plot.plot_max_len = [];
    
    for (let i = 0; i < csa.cfg.plot.fmt.length; i++) {
        let f = csa.cfg.plot.fmt[i];
        let f_fmt = f.split(' - ')[0];
        let f_str = f.slice(f_fmt.length + ' - '.length);
        let series_num = f_fmt.split('.')[1].length + 1;
        let series = [];
        csa.plot.plot_max_len.push(max_len);
        
        let cals = csa.cfg.plot.cal[i];
        if (Array.isArray(cals)) {
            series_num += cals.length;
            for (let cal of cals) {
                let c_name = cal.split(':')[0];
                f_str += `, ${c_name}`;
            }
            init_cal_fn(i);
        }
        
        csa.plot.dat.push([]);
        for (let s = 0; s < series_num; s++) {
            let colors = csa.cfg.plot.color[i] ? csa.cfg.plot.color[i] : color_dft;
            let color = colors[(s-1) % colors.length];
            if (!color)
                color = "black";
            let name = f_str.split(',')[s];
            if (!name)
                name = '~';
            else
                name = name.trim();
            series.push({ label: name, stroke: color });
            csa.plot.dat[i].push([]);
        }
        
        let html = `
            <div class="is-inline-flex" style="align-items: center; gap: 0.3rem; margin: 5px 0;">
                <label class="checkbox"><input type="checkbox" id="plot${i}_en"> ${L('Enable')} Plot${i}</label>
                <select id="plot${i}_size" value="none">
                    <option value="1200x200">1200x200</option>
                    <option value="1200x400">1200x400</option>
                    <option value="1200x800">1200x800</option>
                    <option value="1800x1000">1800x1000</option>
                    <option value="none">Hide</option>
                </select>
                | ${L('Depth')}: <input type="text" size="8" placeholder="${max_len}" id="plot${i}_len" value="${max_len}">
                <button class="button is-small" id="plot${i}_clear">${L('Clear')}</button>
            </div>
            <div id="plot${i}"></div>
        `;
        
        list.insertAdjacentHTML('beforeend', html);
        document.getElementById(`plot${i}_en`).onchange = async () => await plot_set_en();
        let u = make_chart(`plot${i}`, `Plot${i}`, series);
        csa.plot.plots.push(u);
        
        document.getElementById(`plot${i}_size`).onchange = async () => {
            let size = document.getElementById(`plot${i}_size`).value;
            if (size == 'none') {
                document.getElementById(`plot${i}`).style.display = 'none';
            } else {
                let ss = size.split('x');
                let width = parseInt(ss[0]);
                let height = parseInt(ss[1]);
                u.setSize({width, height});
                document.getElementById(`plot${i}`).style.display = 'block';
            }
        };
        document.getElementById(`plot${i}_len`).onchange = async () => {
            let len = Number(document.getElementById(`plot${i}_len`).value);
            csa.plot.plot_max_len[i] = len;
        };
        document.getElementById(`plot${i}_clear`).onclick = async () => {
            for (let s = 0; s < series_num; s++)
                csa.plot.dat[i][s] = [];
            csa.plot.plots[i].setData(csa.plot.dat[i]);
        };
    }
    
    dbg_raw_service();
    
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

