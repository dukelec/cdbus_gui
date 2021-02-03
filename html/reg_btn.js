/*
 * Software License Agreement (MIT License)
 *
 * Author: Duke Fong <d@d-l.io>
 */

import { L } from './lang/lang.js';
import { escape_html, date2num, val2hex, dat2str, dat2hex, hex2dat,
         read_file, download, readable_size, blob2dat } from './utils/helper.js';
import { fmt_size, reg2str, read_reg_val, str2reg, write_reg_val,
         R_ADDR, R_LEN, R_FMT, R_SHOW, R_ID, R_DESC } from './reg_rw.js';
import { csa } from './ctrl.js';


function init_reg_list() {
    let list = [document.getElementById('reg_list0'), document.getElementById('reg_list1')];
    list[0].innerHTML = list[1].innerHTML = '';
    
    let max_line = 0; // balance left and right list
    for (let i = 0; i < csa.cfg.reg.length; i++) {
        let reg = csa.cfg.reg[i];
        if (reg[R_FMT][0] == '{')
            max_line += Math.trunc(reg[R_LEN] / fmt_size(reg[R_FMT]));
        else
            max_line += 1;
    }
    
    let cur_line = 0;
    for (let i = 0; i < csa.cfg.reg.length; i++) {
        let reg = csa.cfg.reg[i];
        let count = 1;
        let html_input = '';
        
        if (reg[R_FMT][0] == '{') {
            count = Math.trunc(reg[R_LEN] / fmt_size(reg[R_FMT]));
            for (let n = 0; n < count; n++) {
                html_input += `
                    <span class="has-tooltip-arrow has-tooltip-left" data-tooltip="Default: --" id="reg_dft.${reg[R_ID]}.${n}">
                      <input type="text" style="font-family: monospace;" id="reg.${reg[R_ID]}.${n}">
                    </span> ${reg[R_SHOW] == 0 ? '' : (reg[R_SHOW] == 1 ? 'H' : 'B')} <br>
                `; 
            }
        } else {
            html_input = `
                <span class="has-tooltip-arrow has-tooltip-left" data-tooltip="Default: --" id="reg_dft.${reg[R_ID]}">
                  <input type="text" style="font-family: monospace;" id="reg.${reg[R_ID]}">
                </span> ${reg[R_SHOW] == 0 ? '' : (reg[R_SHOW] == 1 ? 'H' : 'B')}
            `; 
        }
        
        let html = `
            <div class="columns is-mobile is-gapless">
              <div class="column">
                <div class="level is-mobile" style="margin: 5px 0 5px 0;">
                  <span class="level-left has-tooltip-arrow has-tooltip-multiline has-tooltip-right" data-tooltip="${reg[R_DESC]}">${reg[R_ID]}</span>
                  <span class="level-right" style="margin: 0 8px 0 4px; font-family: monospace;">0x${val2hex(reg[R_ADDR])}</span>
                </div>
              </div>
              <div class="column" style="margin: 5px 0 5px 0;">
                ${html_input}
              </div>
              <div class="column is-1 reg_btn_rw" id="reg_btn_r.${reg[R_ID]}">R</div>
              <div class="column is-1 reg_btn_rw" id="reg_btn_w.${reg[R_ID]}">W</div>
            </div>`;
        list[cur_line <= max_line/2 ? 0 : 1].insertAdjacentHTML('beforeend', html);
        cur_line += count;
    }
}


function in_reg_rw(reg_rw, addr) { // test if in range
    for (let i = 0; i < reg_rw.length; i++) {
        if (addr >= reg_rw[i][0] && addr < reg_rw[i][0] + reg_rw[i][1])
            return i;
    }
    return null;
}

function update_reg_rw_btn(rw='r') {
    let reg_rw = rw == 'r' ? csa.dat.reg_r : csa.dat.reg_w;
    
    for (let i = 0; i < csa.cfg.reg.length; i++) {
        let reg_pre = null;
        let reg_next = null;
        let btn_pre = null;
        let btn_next = null;
        let rw_idx_pre = null;
        let rw_idx_next = null;
        let reg = csa.cfg.reg[i];
        let btn = document.getElementById(`reg_btn_${rw}.${reg[R_ID]}`);
        let rw_idx = in_reg_rw(reg_rw, reg[R_ADDR]);
        if (i > 0) {
            reg_pre = csa.cfg.reg[i-1];
            btn_pre = document.getElementById(`reg_btn_${rw}.${reg_pre[R_ID]}`);
            rw_idx_pre = in_reg_rw(reg_rw, reg_pre[R_ADDR]);
        }
        if (i < csa.cfg.reg.length - 1) {
            reg_next = csa.cfg.reg[i+1];
            btn_next = document.getElementById(`reg_btn_${rw}.${reg_next[R_ID]}`);
            rw_idx_next = in_reg_rw(reg_rw, reg_next[R_ADDR]);
        }
        
        let color = rw == 'r' ? '#D5F5E3' : '#D6EAF8';
        btn.style['border-radius'] = '';
        btn.style['border-width'] = '';
        btn.style['background'] = '';
        btn.style['color'] = '';
        btn.style['margin-top'] = '';
        btn.style['margin-bottom'] = '';
        btn.onclick = null;
        
        if (rw_idx != null) {
            btn.style['background'] = color;

            if (rw == 'w')
                btn.onclick = async () => { await write_reg_val(rw_idx); };
            else
                btn.onclick = async () => { await read_reg_val(rw_idx); };

            let disconn_pre = true;
            let disconn_next = true;
            if (reg_pre && reg_pre[R_ADDR] + reg_pre[R_LEN] == reg[R_ADDR])
                disconn_pre = false;
            if (reg_next && reg[R_ADDR] + reg[R_LEN] == reg_next[R_ADDR])
                disconn_next = false;
            
            if (rw_idx == rw_idx_pre && rw_idx != rw_idx_next) {
                btn.style['margin-top'] = '0';
                btn.style['border-width'] = '0 0.1px 0.1px 0.1px';
                if (!disconn_pre)
                    btn.style['border-radius'] = '0 0 6px 6px';
            
            } else if (rw_idx == rw_idx_pre && rw_idx == rw_idx_next) {
                btn.style['margin-top'] = '0';
                btn.style['margin-bottom'] = '0';
                btn.style['border-width'] = '0 0.1px 0 0.1px';
                
                if (!disconn_pre && !disconn_next)
                    btn.style['border-radius'] = '0 0 0 0';
                else if (disconn_pre && !disconn_next)
                    btn.style['border-radius'] = '6px 6px 0 0';
                else if (!disconn_pre && disconn_next)
                    btn.style['border-radius'] = '0 0 6px 6px';
                
            } else if (rw_idx != rw_idx_pre && rw_idx == rw_idx_next) {
                btn.style['margin-bottom'] = '0';
                btn.style['border-width'] = '0.1px 0.1px 0 0.1px';
                if (!disconn_next)
                    btn.style['border-radius'] = '6px 6px 0 0';
            }
        }
    }
}

function cal_reg_rw(rw='r') {
    let reg_rw = [];
    let start = null;
    
    for (let i = 0; i < csa.cfg.reg.length; i++) {
        let reg = csa.cfg.reg[i];
        let btn = document.getElementById(`reg_btn_${rw}.${reg[R_ID]}`);
        
        if (btn.style['background'] != '') {
            if (btn.style['margin-top'] == '' )
                start = reg[R_ADDR];
            if (btn.style['margin-bottom'] == '' ) {
                reg_rw.push([start, reg[R_ADDR] + reg[R_LEN] - start]);
            }
        }
    }
    return reg_rw;
}


async function button_edit() {
    if (document.getElementById('button_edit').style.background == '') {
        document.getElementById('button_edit').style.background = 'yellow';
        document.getElementById('button_subs').style.display = 'inline-block';
        
        for (let i = 0; i < csa.cfg.reg.length; i++) {
            let reg = csa.cfg.reg[i];
            let btn_r = document.getElementById(`reg_btn_r.${reg[R_ID]}`);
            let btn_w = document.getElementById(`reg_btn_w.${reg[R_ID]}`);
            btn_r.onclick = () => {
                btn_r.style.color = btn_r.style.color ? '' : 'yellow';
            };
            btn_w.onclick = () => {
                btn_w.style.color = btn_w.style.color ? '' : 'yellow';
            };
        }
        
    } else {
        document.getElementById('button_edit').style.background = '';
        document.getElementById('button_subs').style.display = 'none';
        update_reg_rw_btn('r');
        update_reg_rw_btn('w');
        // save to idb
        await csa.db.set('tmp', `reg_r.${csa.arg.name}`, csa.dat.reg_r);
        await csa.db.set('tmp', `reg_w.${csa.arg.name}`, csa.dat.reg_w);
    }
}

function toggle_group() {
    for (let rw of ['r', 'w']) {
        let color = rw == 'r' ? '#D5F5E3' : '#D6EAF8';
        let reg_rw = rw == 'r' ? csa.dat.reg_r : csa.dat.reg_w;
        
        for (let i = 0; i < csa.cfg.reg.length; i++) {
            let reg = csa.cfg.reg[i];
            let btn = document.getElementById(`reg_btn_${rw}.${reg[R_ID]}`);
            let btn_next = null;
            
            let rw_idx = in_reg_rw(reg_rw, reg[R_ADDR]);
            if (i < csa.cfg.reg.length - 1) {
                let reg_next = csa.cfg.reg[i+1];
                btn_next = document.getElementById(`reg_btn_${rw}.${reg_next[R_ID]}`);
            }
            
            if (btn.style.background && btn.style.color) {
                if (btn.style['margin-bottom'] == '') { // has margin
                    if (btn_next && btn_next.style.background && btn_next.style.color) { // next selected
                        btn.style['margin-bottom'] = '0';
                        btn_next.style['margin-top'] = '0';
                    }
                } else {
                    if (btn_next && btn_next.style.background && btn_next.style.color) { // next selected
                        btn.style['margin-bottom'] = '';
                        btn_next.style['margin-top'] = '';
                    }
                }
            }
        }
    }
    
    csa.dat.reg_r = cal_reg_rw('r');
    update_reg_rw_btn('r');
    csa.dat.reg_w = cal_reg_rw('w');
    update_reg_rw_btn('w');
    // re-install onclick callback:
    document.getElementById('button_edit').style.background = '';
    button_edit();
}

function toggle_enable() {
    for (let rw of ['r', 'w']) {
        let color = rw == 'r' ? '#D5F5E3' : '#D6EAF8';
        let reg_rw = rw == 'r' ? csa.dat.reg_r : csa.dat.reg_w;
        
        for (let i = 0; i < csa.cfg.reg.length; i++) {
            let reg = csa.cfg.reg[i];
            let btn = document.getElementById(`reg_btn_${rw}.${reg[R_ID]}`);
            let btn_pre = null;
            let btn_next = null;
            
            let rw_idx = in_reg_rw(reg_rw, reg[R_ADDR]);
            if (i > 0) {
                let reg_pre = csa.cfg.reg[i-1];
                btn_pre = document.getElementById(`reg_btn_${rw}.${reg_pre[R_ID]}`);
            }
            if (i < csa.cfg.reg.length - 1) {
                let reg_next = csa.cfg.reg[i+1];
                btn_next = document.getElementById(`reg_btn_${rw}.${reg_next[R_ID]}`);
            }
            
            if (btn.style.color) {
                btn.style['margin-top'] = '';
                btn.style['margin-bottom'] = '';
                if (btn_pre)
                    btn_pre.style['margin-bottom'] = '';
                if (btn_next)
                    btn_next.style['margin-top'] = '';
                if (btn.style.background) {
                    btn.style.background = '';
                } else {
                    btn.style.background = color;
                }
            }
        }
    }
    
    csa.dat.reg_r = cal_reg_rw('r');
    update_reg_rw_btn('r');
    csa.dat.reg_w = cal_reg_rw('w');
    update_reg_rw_btn('w');
    // re-install onclick callback:
    document.getElementById('button_edit').style.background = '';
    button_edit();
}

function button_all() {
    for (let rw of ['r', 'w']) {
        let reg_rw = rw == 'r' ? csa.dat.reg_r : csa.dat.reg_w;
        
        for (let i = 0; i < csa.cfg.reg.length; i++) {
            let reg = csa.cfg.reg[i];
            let btn = document.getElementById(`reg_btn_${rw}.${reg[R_ID]}`);
            btn.style.color = 'yellow';
        }
    }
}

async function button_def() {
    csa.dat.reg_r = csa.cfg.reg_r;
    csa.dat.reg_w = csa.cfg.reg_w;
    await csa.db.set('tmp', `reg_r.${csa.arg.name}`, null);
    await csa.db.set('tmp', `reg_w.${csa.arg.name}`, null);
    update_reg_rw_btn('r');
    update_reg_rw_btn('w');
}

async function init_reg_rw() {
    let reg_r = await csa.db.get('tmp', `reg_r.${csa.arg.name}`);
    let reg_w = await csa.db.get('tmp', `reg_w.${csa.arg.name}`);
    if (reg_r && reg_w) {
        csa.dat.reg_r = reg_r;
        csa.dat.reg_w = reg_w;
    } else {
        csa.dat.reg_r = csa.cfg.reg_r;
        csa.dat.reg_w = csa.cfg.reg_w;
    }
}


document.getElementById(`button_edit`).onclick = button_edit;
document.getElementById(`toggle_group`).onclick = toggle_group;
document.getElementById(`toggle_enable`).onclick = toggle_enable;
document.getElementById(`button_all`).onclick = button_all;
document.getElementById(`button_def`).onclick = button_def;


export { init_reg_list, init_reg_rw, update_reg_rw_btn, cal_reg_rw, button_edit, toggle_group, toggle_enable };

