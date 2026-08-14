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
        <button class="button is-small" id="export_csv_btn" style="display:none;">${L('Export CSV')}</button>
        <input id="input_file" type="file" style="display:none;">
    </div>
    <div class="modal" id="csv_modal">
        <div class="modal-background" id="csv_modal_bg"></div>
        <div class="modal-card">
            <header class="modal-card-head" style="padding: 0.8rem 1rem;">
                <p class="modal-card-title is-size-6">${L('Export CSV')}</p>
                <button class="delete" id="csv_modal_close"></button>
            </header>
            <section class="modal-card-body" style="padding: 1rem;">
                <div style="margin-bottom: 0.6rem;">
                    Plot: <div class="select is-small"><select id="csv_plot"></select></div>
                </div>
                <div style="margin-bottom: 0.6rem;" id="csv_series"></div>
                <div style="margin-bottom: 0.6rem;">
                    X ${L('Range')}: <input type="text" size="9" id="csv_x_min"> ~
                    <input type="text" size="9" id="csv_x_max">
                </div>
                <div style="margin-bottom: 0.6rem;">
                    ${L('Step')}: <input type="text" size="4" id="csv_step" value="1">
                    | ${L('Significant digits')}: <input type="text" size="3" id="csv_digits" value="6">
                </div>
                <div id="csv_hint"></div>
            </section>
            <footer class="modal-card-foot" style="padding: 0.8rem 1rem;">
                <button class="button is-small is-primary" id="csv_download">${L('Export')}</button>
            </footer>
        </div>
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
                console.log(`import: p: ${p}`);
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


function csv_field(s) {
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function csv_num(v, digits) {
    if (v == null || Number.isNaN(v))
        return '';
    if (!digits || Number.isInteger(v))
        return String(v);
    return String(+v.toPrecision(digits));
}

function csv_range_idx(idx) {
    let xs = csa.plot.dat[idx][0];
    let x_min = document.getElementById('csv_x_min').value.trim();
    let x_max = document.getElementById('csv_x_max').value.trim();
    let i_start = 0, i_end = xs.length; // i_end excluded
    if (x_min !== '' && !isNaN(x_min)) {
        while (i_start < xs.length && xs[i_start] < Number(x_min))
            i_start++;
    }
    if (x_max !== '' && !isNaN(x_max)) {
        while (i_end > i_start && xs[i_end-1] > Number(x_max))
            i_end--;
    }
    return [i_start, i_end];
}

function csv_step_val() {
    let step = Math.round(Number(document.getElementById('csv_step').value));
    return step >= 1 ? step : 1;
}

function csv_update_hint() {
    let idx = Number(document.getElementById('csv_plot').value);
    let [i_start, i_end] = csv_range_idx(idx);
    let rows = Math.ceil((i_end - i_start) / csv_step_val());
    let cols = document.querySelectorAll('#csv_series input:checked').length;
    document.getElementById('csv_hint').innerHTML = `${L('Rows')}: ${rows}, ${L('Columns')}: ${cols}`;
}

function csv_refresh() {
    let idx = Number(document.getElementById('csv_plot').value);
    let series = csa.plot.plots[idx].series;
    let html = `${L('Series')}: `;
    for (let s = 0; s < series.length; s++) {
        html += `<label class="checkbox" style="margin-right: 0.5rem;">
                   <input type="checkbox" id="csv_s${s}">
                   ${escape_html(series[s].label)}</label>`;
    }
    document.getElementById('csv_series').innerHTML = html;
    let xs = csa.plot.dat[idx][0];
    document.getElementById('csv_x_min').placeholder = xs.length ? xs[0] : '';
    document.getElementById('csv_x_max').placeholder = xs.length ? xs.at(-1) : '';
    csv_update_hint();
}

function export_csv() {
    let idx = Number(document.getElementById('csv_plot').value);
    let dat = csa.plot.dat[idx];
    if (!dat || !dat[0].length) {
        alert(`Plot${idx}: ${L('No data')}`);
        return;
    }
    let series = csa.plot.plots[idx].series;
    let cols = [];
    for (let s = 0; s < series.length; s++) {
        if (document.getElementById(`csv_s${s}`).checked)
            cols.push(s);
    }
    if (!cols.length) {
        alert(L('No data'));
        return;
    }
    let step = csv_step_val();
    let digits = Math.round(Number(document.getElementById('csv_digits').value));
    if (!(digits >= 1))
        digits = 0; // 0: keep full precision
    let [i_start, i_end] = csv_range_idx(idx);

    let lines = [cols.map(c => csv_field(series[c].label)).join(',')];
    for (let i = i_start; i < i_end; i += step)
        lines.push(cols.map(c => csv_num(dat[c][i], c ? digits : 0)).join(','));

    let name = csa.arg.name ? csa.arg.name : csa.arg.tgt;
    download(lines.join('\n'), `${name}_plot${idx}.csv`, 'text/csv');
}

function init_export_csv() {
    if (!csa.plot)
        return;
    document.getElementById('export_csv_btn').style.display = '';

    let sel = document.getElementById('csv_plot');
    for (let i = 0; i < csa.plot.plots.length; i++)
        sel.insertAdjacentHTML('beforeend', `<option value="${i}">Plot${i}</option>`);

    document.getElementById('export_csv_btn').onclick = () => {
        csv_refresh();
        document.getElementById('csv_modal').classList.add('is-active');
    };
    let close = () => document.getElementById('csv_modal').classList.remove('is-active');
    document.getElementById('csv_modal_close').onclick = close;
    document.getElementById('csv_modal_bg').onclick = close;

    sel.onchange = csv_refresh;
    document.getElementById('csv_series').onchange = csv_update_hint;
    document.getElementById('csv_x_min').oninput = csv_update_hint;
    document.getElementById('csv_x_max').oninput = csv_update_hint;
    document.getElementById('csv_step').oninput = csv_update_hint;
    document.getElementById('csv_download').onclick = export_csv;
}


async function init_export() {
    csa.export = {};
    csa.plugins.push('export');

    document.getElementsByTagName('section')[0].insertAdjacentHTML('beforeend', html);
    document.getElementById(`export_btn`).onclick = export_data;
    document.getElementById(`import_btn`).onclick = import_data;
    init_export_csv();
}

export { init_export };

