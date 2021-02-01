/*
 * Software License Agreement (MIT License)
 *
 * Author: Duke Fong <d@d-l.io>
 */

import { L } from './lang/lang.js';
import { escape_html, date2num, val2hex, dat2str, dat2hex, hex2dat,
         read_file, download, readable_size, blob2dat } from './utils/helper.js';
//import { konva_zoom, konva_responsive } from './utils/konva_helper.js';
import { CDWebSocket, CDWebSocketNS } from './utils/cd_ws.js';
import { Idb } from './utils/idb.js';
import { fmt_size } from './reg_rw.js';
import { init_plots } from './plot.js';
import { csa } from './ctrl.js';


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
            ret.push(dv.getFloat32(ofs, true));
            ofs += 4; break;
        }
    }
    return ret;
}

async function dbg_raw_service() {
    while (true) {
        let msg = await csa.dbg_raw_sock.recvfrom();
        let dat = msg[0].dat;
        dat = dat.slice(0); // dataview return wrong value without this
        let dv = new DataView(dat.buffer);
        //console.log('dbg_raw get', dat2hex(dat, ' '));
        
        let idx = dat[0] & 0x3f;
        if (idx >= csa.cfg_plot.fmt.length) {
            console.log('dbg_raw: drop');
            continue;
        }
        let rm_oldest = false;
        if (csa.cfg_plot.depth[idx] != 0 && csa.plots_dat[idx][0].length > csa.cfg_plot.depth[idx])
            rm_oldest = true;
        
        let ofs = 1;
        let f = csa.cfg_plot.fmt[idx].split(' - ')[0];

        if (f[1] == '.') { // x,d1,d2,d3, x,d1,d2,d3
            let grp_size = fmt_size(f);
            
            while (ofs < dat.length) {
                let grp_vals = dv_fmt_read(dv, ofs, f);
                for (let i = 0; i < grp_vals.length; i++) {
                    csa.plots_dat[idx][i].push(grp_vals[i]);
                    if (rm_oldest)
                        csa.plots_dat[idx][i].shift();
                }
                ofs += grp_size;
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
                csa.plots_dat[idx][0].push(cnt_start + cnt_inc * loop);
                if (rm_oldest)
                    csa.plots_dat[idx][0].shift();
                for (let i = 0; i < grp_vals.length; i++) {
                    csa.plots_dat[idx][i+1].push(grp_vals[i]);
                    if (rm_oldest)
                        csa.plots_dat[idx][i+1].shift();
                }
                loop += 1;
                ofs += grp_size;
            }
        }
        
        csa.plots[idx].setData(csa.plots_dat[idx]);
        //console.log(csa.plots_dat[idx]);
    }
}

async function dbg_service() {
    // TODO: support ANSI color
    while (true) {
        let dat = await csa.dbg_sock.recvfrom();
        console.log('dbg get', dat);
        let elem = document.getElementById('dev_log');
        elem.innerHTML = [elem.innerHTML, `${dat2str(dat[0].dat.slice(1))}`].filter(Boolean).join('<br>');
        elem.scrollBy(0, 100); // TODO: allow disable sroll; allow insert newline on UI
    }
}


export { dbg_raw_service, dbg_service };

