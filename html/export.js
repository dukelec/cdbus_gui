/*
 * Software License Agreement (MIT License)
 *
 * Author: Duke Fong <d@d-l.io>
 */

import { L } from './utils/lang.js'
import { escape_html, date2num, val2hex, dat2str, dat2hex, hex2dat,
         read_file, download, readable_size, blob2dat } from './utils/helper.js';
import { fmt_size, reg2str, read_reg_val, str2reg, write_reg_val,
         R_ADDR, R_LEN, R_FMT, R_SHOW, R_ID, R_DESC } from './reg_rw.js';
import { csa } from './ctrl.js';


function export_data() {
    let exp_dat = {
        version: 'cdgui v0',
        reg_str: {},
        logs: document.getElementById('dev_log').innerHTML,
    };
    if (csa.dat.plots)
        exp_dat.plots = csa.dat.plots;
    
    for (let i = 0; i < csa.cfg.reg.length; i++) {
        let r = csa.cfg.reg[i];
        
        if (r[R_FMT][0] == '{') {
            let one_size = fmt_size(r[R_FMT]);
            let count = Math.trunc(r[R_LEN] / one_size);
            for (let n = 0; n < count; n++)
                exp_dat.reg_str[`${r[R_ID]}.${n}`] = document.getElementById(`reg.${r[R_ID]}.${n}`).value;
        
        } else {
            exp_dat.reg_str[`${r[R_ID]}`] = document.getElementById(`reg.${r[R_ID]}`).value;
        }
        
    }
    
    console.info('export_data:', exp_dat);
    const file_dat = msgpack.serialize(exp_dat);
    download(file_dat, csa.arg.name ? `${csa.arg.name}.mpk` : `${csa.arg.tgt}.mpk`);
}

function import_data() {
    //let input = document.createElement('input');
    //cpy(input, {type: 'file', accept: '*.mpk'}, ['type', 'accept']);
    let input = document.getElementById('input_file');
    input.accept = '.mpk';
    input.onchange = async function () {
        var files = this.files;
        if (files && files.length) {
        
            let file = files[0];
            let data = await read_file(file);
            let prj = msgpack.deserialize(data);
            if (!prj || !prj.version || !prj.version.startsWith('cdgui')) {
                alert(L('Format error'));
                this.value = '';
                return;
            }
            console.log('import dat:', prj);
            
            for (let i = 0; i < csa.cfg.reg.length; i++) {
                let r = csa.cfg.reg[i];
                
                if (r[R_FMT][0] == '{') {
                    let one_size = fmt_size(r[R_FMT]);
                    let count = Math.trunc(r[R_LEN] / one_size);
                    for (let n = 0; n < count; n++) {
                        if (`${r[R_ID]}.${n}` in prj.reg_str)
                            document.getElementById(`reg.${r[R_ID]}.${n}`).value = prj.reg_str[`${r[R_ID]}.${n}`];
                    }
                } else {
                    if (`${r[R_ID]}` in prj.reg_str)
                        document.getElementById(`reg.${r[R_ID]}`).value = prj.reg_str[`${r[R_ID]}`];
                }
            }
            
            document.getElementById('dev_log').innerHTML = prj.logs;
            if (prj.plots) {
                csa.dat.plots = prj.plots;
                for (let i = 0; i < csa.plots.length; i++) {
                    csa.plots[i].setData(csa.dat.plots[i]);
                }
            }
            alert('Import succeeded');
        }
        this.value = '';
    };
    input.click();
}


export { export_data, import_data };

