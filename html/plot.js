/*
 * Software License Agreement (MIT License)
 *
 * Author: Duke Fong <d@d-l.io>
 */

import { escape_html, date2num, val2hex, dat2str, dat2hex, hex2dat,
         read_file, download, readable_size, blob2dat } from './utils/helper.js';
import { fmt_size, reg2str, read_reg_val, str2reg, write_reg_val, reg_idx_by_name,
         R_ADDR, R_LEN, R_FMT, R_SHOW, R_ID, R_DESC } from './reg_rw.js';
import { csa } from './ctrl.js';
import { wheelZoomPlugin, touchZoomPlugin } from './plot_zoom.js';


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
    let mask_addr = csa.cfg.reg[idx][R_ADDR];
    
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
        csa.proxy_sock_plot.flush();
        await csa.proxy_sock_plot.sendto({'dst': [csa.arg.tgt, 0x5], 'dat': dat}, ['server', 'proxy']);
        console.log('plot_set_en wait ret');
        let ret = await csa.proxy_sock_plot.recvfrom(500 * (i+1));
        console.log('plot_set_en ret', ret);
        if (ret && ret[0].dat[0] == 0x80) {
            console.log('plot_set_en ok');
            break;
        } else {
            console.warn(`plot_set_en err retry${i}`);
        }
    }
}


function init_plots() {
    if (!csa.cfg.plot)
        return;
    
    let list = document.getElementById('plot_list');
    list.insertAdjacentHTML('beforeend', `<h2 class="title is-size-4">Plots</h2>`);
    csa.plots = [];
    csa.dat.plots = [];
    
    for (let i = 0; i < csa.cfg.plot.fmt.length; i++) {
        let f = csa.cfg.plot.fmt[i];
        let f_fmt = f.split(' - ')[0];
        let f_str = f.slice(f_fmt.length + ' - '.length);
        let series_num = f_fmt.split('.')[1].length + 1;
        let series = [];
        
        csa.dat.plots.push([]);
        for (let s = 0; s < series_num; s++) {
            let color = csa.cfg.plot.length > i ? csa.cfg.plot[i][s] : null;
            if (!color)
                color = csa.cfg.plot.color_dft[s];
            if (!color)
                color = csa.cfg.plot.color_dft[0];
            let name = f_str.split(',')[s];
            if (!name)
                name = '~';
            else
                name = name.trim();
            series.push({ label: name, stroke: color });
            csa.dat.plots[i].push([]);
        }
        
        let html = `
            <label class="checkbox"><input type="checkbox" id="plot${i}_en"> Enable Plot${i}</label>
            <select id="plot${i}_size" value="none">
                <option value="1200x200">1200x200</option>
                <option value="1200x400">1200x400</option>
                <option value="1200x800">1200x800</option>
                <option value="1800x1000">1800x1000</option>
                <option value="none">Hide</option>
            </select>
            | Depth: <input type="text" size="8" placeholder="10000" id="plot${i}_len" value="10000">
            <button class="button is-small" id="plot${i}_clear">Clear</button>
            <br>
            <div id="plot${i}"></div>
        `;
        
        list.insertAdjacentHTML('beforeend', html);
        document.getElementById(`plot${i}_en`).onchange = async () => await plot_set_en();
        let u = make_chart(`plot${i}`, `Plot${i}`, series);
        csa.plots.push(u);
        
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
        document.getElementById(`plot${i}_clear`).onclick = async () => {
            for (let s = 0; s < series_num; s++)
                csa.dat.plots[i][s] = [];
            csa.plots[i].setData(csa.dat.plots[i]);
        };
    }
}


export { init_plots };

