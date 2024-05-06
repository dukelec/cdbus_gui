/*
 * Software License Agreement (MIT License)
 *
 * Author: Duke Fong <d@d-l.io>
 */

import { L } from '../utils/lang.js'
import { escape_html, date2num, val2hex, dat2str, dat2hex, hex2dat,
         read_file, download, readable_size, blob2dat } from '../utils/helper.js';
import { csa, alloc_port } from '../common.js';
import { fmt_size, reg2str, read_reg_val, str2reg, write_reg_val,
         R_ADDR, R_LEN, R_FMT, R_SHOW, R_ID, R_DESC } from './reg_rw.js';

let html = `
    <div class="container">
        <h2 class="title is-size-4"><span>${L('Export')} & ${L('Import')}</span></h2>
        <button class="button is-small" id="export_btn">${L('Export Data')}</button>
        <button class="button is-small" id="import_btn">${L('Import Data')}</button>
        <input id="input_file" type="file" style="display:none;">
    </div>
    <br>`;


function export_data() {
    let exp_dat = {
        version: 'cdgui v1'
    };
    
    for (let p of csa.plugins) {
        console.log(`export: p: ${p}`);
        if ('dat_export' in csa[p]) {
            exp_dat[p] = csa[p].dat_export();
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
            
            if (prj.version == 'cdgui v0') {
                prj.reg = prj.reg_str;
                prj.dbg = prj.logs;
                prj.plot = prj.plots;
                alert('Version v0 is deprecated and will be removed next time, please re-export to version v1!');
            }
            
            for (let p of csa.plugins) {
                console.log(`export: p: ${p}`);
                if ('dat_import' in csa[p]) {
                    csa[p].dat_import(prj[p]);
                }
            }
            
            alert('Import succeeded');
        }
        this.value = '';
    };
    input.click();
}


async function init_export() {
    csa.export = {};
    csa.plugins.push('export');
    
    document.getElementsByTagName('section')[0].insertAdjacentHTML('beforeend', html);
    document.getElementById(`export_btn`).onclick = export_data;
    document.getElementById(`import_btn`).onclick = import_data;
}

export { init_export };

