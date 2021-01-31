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
    for (let i = 0; i < csa.cfg_reg.length; i++) {
        let reg = csa.cfg_reg[i];
        if (reg[R_FMT][0] == '{')
            max_line += Math.trunc(reg[R_LEN] / fmt_size(reg[R_FMT]));
        else
            max_line += 1;
    }
    
    let cur_line = 0;
    for (let i = 0; i < csa.cfg_reg.length; i++) {
        let reg = csa.cfg_reg[i];
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
    let reg_rw = rw == 'r' ? csa.cfg_reg_r : csa.cfg_reg_w;
    
    for (let i = 0; i < csa.cfg_reg.length; i++) {
        let reg_pre = null;
        let reg_next = null;
        let btn_pre = null;
        let btn_next = null;
        let rw_idx_pre = null;
        let rw_idx_next = null;
        let reg = csa.cfg_reg[i];
        let btn = document.getElementById(`reg_btn_${rw}.${reg[R_ID]}`);
        let rw_idx = in_reg_rw(reg_rw, reg[R_ADDR]);
        if (i > 0) {
            reg_pre = csa.cfg_reg[i-1];
            btn_pre = document.getElementById(`reg_btn_${rw}.${reg_pre[R_ID]}`);
            rw_idx_pre = in_reg_rw(reg_rw, reg_pre[R_ADDR]);
        }
        if (i < csa.cfg_reg.length - 2) {
            reg_next = csa.cfg_reg[i+1];
            btn_next = document.getElementById(`reg_btn_${rw}.${reg_next[R_ID]}`);
            rw_idx_next = in_reg_rw(reg_rw, reg_next[R_ADDR]);
        }
        
        let color = rw == 'r' ? '#D5F5E3' : '#D6EAF8';
        btn.style['border-radius'] = '';
        btn.style['border-width'] = '';
        btn.style['background'] = '';
        btn.style['margin-top'] = '';
        btn.style['margin-bottom'] = '';
        btn.onclick = null;
        
        if (rw_idx != null) {
            btn.style['background'] = color;

            if (rw == 'w')
                btn.onclick = async () => { await write_reg_val(rw_idx); };
            else
                btn.onclick = async () => { await read_reg_val(rw_idx); };

            let disconn_pre = false;
            let disconn_next = false;
            if (reg_pre && reg_pre[R_ADDR] + reg_pre[R_LEN] != reg[R_ADDR])
                disconn_pre = true;
            if (reg_next && reg[R_ADDR] + reg[R_LEN] != reg_next[R_ADDR])
                disconn_next = true;
            
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
                else if (!disconn_next && disconn_next)
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
    
    for (let i = 0; i < csa.cfg_reg.length; i++) {
        let reg = csa.cfg_reg[i];
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

export { init_reg_list, update_reg_rw_btn, cal_reg_rw };

