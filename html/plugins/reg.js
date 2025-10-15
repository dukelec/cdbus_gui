/*
 * Software License Agreement (MIT License)
 *
 * Author: Duke Fong <d@d-l.io>
 */

import { L } from '../utils/lang.js'
import { escape_html, date2num, val2hex, dat2str, dat2hex, hex2dat,
         read_file, download, readable_size, blob2dat } from '../utils/helper.js';
import { CDWebSocket } from '../utils/cd_ws.js';
import { fmt_size, reg2str, read_reg_val, str2reg, write_reg_val,
         R_ADDR, R_LEN, R_FMT, R_SHOW, R_ID, R_DESC } from './reg_rw.js';
import { csa, alloc_port } from '../common.js';


function init_reg_list() {
    let list = [document.getElementById('reg_list0'), document.getElementById('reg_list1')];
    list[0].innerHTML = list[1].innerHTML = '';
    
    let max_line = 0; // balance left and right list
    for (let i = 0; i < csa.cfg.reg.list.length; i++) {
        let reg = csa.cfg.reg.list[i];
        if (reg[R_FMT][0] == '{')
            max_line += Math.trunc(reg[R_LEN] / fmt_size(reg[R_FMT]));
        else
            max_line += 1;
    }
    
    let cur_line = 0;
    for (let i = 0; i < csa.cfg.reg.list.length; i++) {
        let reg = csa.cfg.reg.list[i];
        let count = 1;
        let html_input = '';
        
        if (reg[R_FMT][0] == '{') {
            count = Math.trunc(reg[R_LEN] / fmt_size(reg[R_FMT]));
            for (let n = 0; n < count; n++) {
                html_input += `
                    <span class="has-tooltip-arrow has-tooltip-left" data-tooltip="Default: --\nFormat: ${reg[R_FMT]}" id="reg_dft.${reg[R_ID]}.${n}">
                      <input type="text" style="font-family: monospace;" id="reg.${reg[R_ID]}.${n}">
                    </span> ${reg[R_SHOW] == 0 ? '' : (reg[R_SHOW] == 1 ? 'H' : 'B')} <br>
                `;
                csa.reg.elm[`reg_dft.${reg[R_ID]}.${n}`] = null;
                csa.reg.elm[`reg.${reg[R_ID]}.${n}`] = null;
            }
        } else {
            html_input = `
                <span class="has-tooltip-arrow has-tooltip-left" data-tooltip="Default: --\nFormat: ${reg[R_FMT]}" id="reg_dft.${reg[R_ID]}">
                  <input type="text" style="font-family: monospace;" id="reg.${reg[R_ID]}">
                </span> ${reg[R_SHOW] == 0 ? '' : (reg[R_SHOW] == 1 ? 'H' : 'B')}
            `;
            csa.reg.elm[`reg_dft.${reg[R_ID]}`] = null;
            csa.reg.elm[`reg.${reg[R_ID]}`] = null;
        }
        
        let html = `
            <div class="columns is-mobile is-gapless">
              <div class="column">
                <div class="level is-mobile" style="margin: 5px 0;">
                  <span class="level-left has-tooltip-arrow has-tooltip-multiline has-tooltip-right" data-tooltip="${reg[R_DESC]}">${reg[R_ID]}</span>
                  <span class="level-right" style="margin: 0 8px 0 4px; font-family: monospace;">0x${val2hex(reg[R_ADDR])}</span>
                </div>
              </div>
              <div class="column is-mobile" style="margin: 5px 0; flex: 0 0 200px;">
                ${html_input}
              </div>
              <div class="column is-1 reg_btn_rw" id="reg_btn_r.${reg[R_ID]}">R</div>
              <div class="column is-1 reg_btn_rw" id="reg_btn_w.${reg[R_ID]}">W</div>
            </div>`;
        csa.reg.elm[`reg_btn_r.${reg[R_ID]}`] = null;
        csa.reg.elm[`reg_btn_w.${reg[R_ID]}`] = null;
        list[cur_line <= max_line/2 ? 0 : 1].insertAdjacentHTML('beforeend', html);
        cur_line += count;
    }
    
    for (let e in csa.reg.elm)
        csa.reg.elm[e] = document.getElementById(e);
}


function in_reg_rw(reg_rw, addr) { // test if in range
    for (let i = 0; i < reg_rw.length; i++) {
        if (addr >= reg_rw[i][0] && addr < reg_rw[i][0] + reg_rw[i][1])
            return i;
    }
    return null;
}

function update_reg_rw_btn(rw='r') {
    let reg_rw = rw == 'r' ? csa.reg.reg_r : csa.reg.reg_w;
    csa.reg.reg_rbw = []; // clean read-before-write buffer
    
    for (let i = 0; i < csa.cfg.reg.list.length; i++) {
        let reg_pre = null;
        let reg_next = null;
        let btn_pre = null;
        let btn_next = null;
        let rw_idx_pre = null;
        let rw_idx_next = null;
        let reg = csa.cfg.reg.list[i];
        let btn = csa.reg.elm[`reg_btn_${rw}.${reg[R_ID]}`];
        let rw_idx = in_reg_rw(reg_rw, reg[R_ADDR]);
        if (i > 0) {
            reg_pre = csa.cfg.reg.list[i-1];
            btn_pre = csa.reg.elm[`reg_btn_${rw}.${reg_pre[R_ID]}`];
            rw_idx_pre = in_reg_rw(reg_rw, reg_pre[R_ADDR]);
        }
        if (i < csa.cfg.reg.list.length - 1) {
            reg_next = csa.cfg.reg.list[i+1];
            btn_next = csa.reg.elm[`reg_btn_${rw}.${reg_next[R_ID]}`];
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

            if (rw == 'w') {
                if (reg[R_FMT][0] == '{') {
                    for (let n = 0; n < Math.trunc(reg[R_LEN] / fmt_size(reg[R_FMT])); n++) {
                        csa.reg.elm[`reg.${reg[R_ID]}.${n}`].onkeydown = async (event) => {
                            if (event.keyCode == 13) // enter key
                                await write_reg_val(rw_idx);
                        };
                    }
                } else {
                    csa.reg.elm[`reg.${reg[R_ID]}`].onkeydown = async (event) => {
                        if (event.keyCode == 13)
                            await write_reg_val(rw_idx);
                    };
                }
                btn.onclick = async () => { await write_reg_val(rw_idx); };
            } else {
                btn.onclick = async () => { await read_reg_val(rw_idx); };
            }

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
    
    for (let i = 0; i < csa.cfg.reg.list.length; i++) {
        let reg = csa.cfg.reg.list[i];
        let btn = csa.reg.elm[`reg_btn_${rw}.${reg[R_ID]}`];
        
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


// reg_rw <--> reg_cfg

function reg_idx_by_name(name) {
    for (let i = 0; i < csa.cfg.reg.list.length; i++) {
        let r = csa.cfg.reg.list[i];
        if (r[R_ID] == name)
            return i;
    }
    return null;
}

function get_reg_idx_range(addr, len) {
    let start_idx = null;
    for (let i = 0; i < csa.cfg.reg.list.length; i++) {
        let r = csa.cfg.reg.list[i];
        if (start_idx == null && r[R_ADDR] == addr)
                start_idx = i;
        if (start_idx != null && addr + len == r[R_ADDR] + r[R_LEN])
                return [start_idx, i];
    }
    return null;
}

function reg_cfg2reg_rw(list) {
    let reg_rw = [];
    if (!list)
        return reg_rw;
    for (let i = 0; i < list.length; i++) {
        let idx0 = reg_idx_by_name(list[i][0]);
        let idx1 = reg_idx_by_name(list[i][1]);
        if (idx0 == null)
            continue;
        if (idx1 == null)
            idx1 = idx0;
        let r0 = csa.cfg.reg.list[idx0];
        let r1 = csa.cfg.reg.list[idx1];
        if (idx0 == idx1) {
            reg_rw.push([r0[R_ADDR], r0[R_LEN]]);
        } else {
            reg_rw.push([r0[R_ADDR], r1[R_ADDR] - r0[R_ADDR] + r1[R_LEN]]);
        }
    }
    return reg_rw;
}

function reg_rw2reg_cfg(list) {
    let reg_str = [];
    let start = null;
    
    for (let i = 0; i < list.length; i++) {
        let idx_range = get_reg_idx_range(list[i][0], list[i][1]);
        if (idx_range == null)
            continue;
        let r0 = csa.cfg.reg.list[idx_range[0]];
        let r1 = csa.cfg.reg.list[idx_range[1]];
        if (r0[R_ID] != r1[R_ID])
            reg_str.push([r0[R_ID], r1[R_ID]]);
        else
            reg_str.push([r0[R_ID]]);
    }
    return reg_str;
}


// edit

async function button_edit() {
    if (document.getElementById('button_edit').style.background == '') {
        document.getElementById('button_edit').style.background = 'yellow';
        document.getElementById('button_subs').style.display = 'inline';
        
        for (let i = 0; i < csa.cfg.reg.list.length; i++) {
            let reg = csa.cfg.reg.list[i];
            let btn_r = csa.reg.elm[`reg_btn_r.${reg[R_ID]}`];
            let btn_w = csa.reg.elm[`reg_btn_w.${reg[R_ID]}`];
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
        let less = document.getElementById('less_reg').checked;
        if (less) {
            await csa.db.set('tmp', `${csa.arg.name}/reg.less_r`, reg_rw2reg_cfg(csa.reg.reg_r));
            await csa.db.set('tmp', `${csa.arg.name}/reg.less_w`, reg_rw2reg_cfg(csa.reg.reg_w));
        } else {
            await csa.db.set('tmp', `${csa.arg.name}/reg.reg_r`, reg_rw2reg_cfg(csa.reg.reg_r));
            await csa.db.set('tmp', `${csa.arg.name}/reg.reg_w`, reg_rw2reg_cfg(csa.reg.reg_w));
        }
        console.log(less ? 'new less_r values:' : 'new reg_r values:');
        console.log(JSON.stringify(csa.reg.reg_r));
        console.log(JSON.stringify(reg_rw2reg_cfg(csa.reg.reg_r)));
        console.log(less ? 'new less_w values:' : 'new reg_w values:');
        console.log(JSON.stringify(csa.reg.reg_w));
        console.log(JSON.stringify(reg_rw2reg_cfg(csa.reg.reg_w)));
    }
}

function set_group(on) {
    for (let rw of ['r', 'w']) {
        let color = rw == 'r' ? '#D5F5E3' : '#D6EAF8';
        let reg_rw = rw == 'r' ? csa.reg.reg_r : csa.reg.reg_w;
        
        for (let i = 0; i < csa.cfg.reg.list.length; i++) {
            let reg = csa.cfg.reg.list[i];
            let btn = csa.reg.elm[`reg_btn_${rw}.${reg[R_ID]}`];
            let btn_next = null;
            
            let rw_idx = in_reg_rw(reg_rw, reg[R_ADDR]);
            if (i < csa.cfg.reg.list.length - 1) {
                let reg_next = csa.cfg.reg.list[i+1];
                btn_next = csa.reg.elm[`reg_btn_${rw}.${reg_next[R_ID]}`];
            }
            
            if (btn.style.background && btn.style.color) {
                if (on) { // has margin
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
    
    csa.reg.reg_r = cal_reg_rw('r');
    update_reg_rw_btn('r');
    csa.reg.reg_w = cal_reg_rw('w');
    update_reg_rw_btn('w');
    // re-install onclick callback:
    document.getElementById('button_edit').style.background = '';
    button_edit();
}

function set_enable(on) {
    for (let rw of ['r', 'w']) {
        let color = rw == 'r' ? '#D5F5E3' : '#D6EAF8';
        let reg_rw = rw == 'r' ? csa.reg.reg_r : csa.reg.reg_w;
        
        for (let i = 0; i < csa.cfg.reg.list.length; i++) {
            let reg = csa.cfg.reg.list[i];
            let btn = csa.reg.elm[`reg_btn_${rw}.${reg[R_ID]}`];
            let btn_pre = null;
            let btn_next = null;
            
            let rw_idx = in_reg_rw(reg_rw, reg[R_ADDR]);
            if (i > 0) {
                let reg_pre = csa.cfg.reg.list[i-1];
                btn_pre = csa.reg.elm[`reg_btn_${rw}.${reg_pre[R_ID]}`];
            }
            if (i < csa.cfg.reg.list.length - 1) {
                let reg_next = csa.cfg.reg.list[i+1];
                btn_next = csa.reg.elm[`reg_btn_${rw}.${reg_next[R_ID]}`];
            }
            
            if (btn.style.color) {
                if (!on) {
                    btn.style['margin-top'] = '';
                    btn.style['margin-bottom'] = '';
                    if (btn_pre)
                        btn_pre.style['margin-bottom'] = '';
                    if (btn_next)
                        btn_next.style['margin-top'] = '';
                }
                btn.style.background = on ? color : '';
            }
        }
    }
    
    csa.reg.reg_r = cal_reg_rw('r');
    update_reg_rw_btn('r');
    csa.reg.reg_w = cal_reg_rw('w');
    update_reg_rw_btn('w');
    // re-install onclick callback:
    document.getElementById('button_edit').style.background = '';
    button_edit();
}

function button_all() {
    for (let rw of ['r', 'w']) {
        let reg_rw = rw == 'r' ? csa.reg.reg_r : csa.reg.reg_w;
        
        for (let i = 0; i < csa.cfg.reg.list.length; i++) {
            let reg = csa.cfg.reg.list[i];
            let btn = csa.reg.elm[`reg_btn_${rw}.${reg[R_ID]}`];
            btn.style.color = 'yellow';
        }
    }
}

function button_none() {
    for (let rw of ['r', 'w']) {
        let reg_rw = rw == 'r' ? csa.reg.reg_r : csa.reg.reg_w;
        
        for (let i = 0; i < csa.cfg.reg.list.length; i++) {
            let reg = csa.cfg.reg.list[i];
            let btn = csa.reg.elm[`reg_btn_${rw}.${reg[R_ID]}`];
            btn.style.color = '';
        }
    }
}

async function button_def() {
    let less = document.getElementById('less_reg').checked;
    csa.reg.reg_r = reg_cfg2reg_rw(less ? csa.cfg.reg.less_r : csa.cfg.reg.reg_r);
    csa.reg.reg_w = reg_cfg2reg_rw(less ? csa.cfg.reg.less_w : csa.cfg.reg.reg_w);
    await csa.db.set('tmp', `${csa.arg.name}/reg.reg_r`, null);
    await csa.db.set('tmp', `${csa.arg.name}/reg.reg_w`, null);
    await csa.db.set('tmp', `${csa.arg.name}/reg.less_r`, null);
    await csa.db.set('tmp', `${csa.arg.name}/reg.less_w`, null);
    update_reg_rw_btn('r');
    update_reg_rw_btn('w');
    // re-install onclick callback:
    document.getElementById('button_edit').style.background = '';
    button_edit();
    alert('Load default succeeded.');
}

async function init_reg_rw() {
    let less = document.getElementById('less_reg').checked;
    let reg_r = await csa.db.get('tmp', `${csa.arg.name}/reg.reg_r`);
    let reg_w = await csa.db.get('tmp', `${csa.arg.name}/reg.reg_w`);
    let less_r = await csa.db.get('tmp', `${csa.arg.name}/reg.less_r`);
    let less_w = await csa.db.get('tmp', `${csa.arg.name}/reg.less_w`);
    if (!less && reg_r && reg_w) {
        console.log('init reg from db reg_r/w');
        csa.reg.reg_r = reg_cfg2reg_rw(reg_r);
        csa.reg.reg_w = reg_cfg2reg_rw(reg_w);
    } else if (less && less_r && less_w) {
        console.log('init reg from db less_r/w');
        csa.reg.reg_r = reg_cfg2reg_rw(less_r);
        csa.reg.reg_w = reg_cfg2reg_rw(less_w);
    } else {
        console.log(less ? 'init reg from cfg.less_r/w' : 'init reg from cfg.reg_r/w');
        csa.reg.reg_r = reg_cfg2reg_rw(less ? csa.cfg.reg.less_r : csa.cfg.reg.reg_r);
        csa.reg.reg_w = reg_cfg2reg_rw(less ? csa.cfg.reg.less_w : csa.cfg.reg.reg_w);
    }
    update_reg_rw_btn('r');
    update_reg_rw_btn('w');
}


let read_timer = null;
async function period_read() {
    if (!document.getElementById('keep_read').checked) {
        if (read_timer)
            clearTimeout(read_timer);
        read_timer = null;
        return;
    }
    await document.getElementById('dev_read_all').onclick();
    read_timer = setTimeout(period_read, document.getElementById('read_period').value);
}


async function init_reg() {
    csa.reg = {
        reg_r: null,
        reg_w: null,
        reg_dft_r: [],  // first read flag
        reg_rbw: [],    // read before write data
        elm: {}         // cache dom elements
    };
    csa.plugins.push('reg');
    
    let port = await alloc_port();
    console.log(`init_reg, alloc port: ${port}`);
    csa.reg.proxy_sock_regr = new CDWebSocket(csa.ws_ns, port);
    
    port = await alloc_port();
    console.log(`init_reg, alloc port: ${port}`);
    csa.reg.proxy_sock_regw = new CDWebSocket(csa.ws_ns, port);
    
    let html = `
        <div class="container">
            <h2 class="title is-size-4"><span>${L('Regs')}</span></h2>
        
            <div class="is-inline-flex" style="align-items: center; gap: 0.3rem; margin: 5px 0;">
                <button class="button is-small" id="dev_read_all">${L('Read All')}</button>
                <button class="button is-small" id="dev_write_all">${L('Write All')}</button>
                |
                <label class="checkbox"><input type="checkbox" id="less_reg"> <span>${L('Less')}</span></label>
                <label class="checkbox"><input type="checkbox" id="keep_read"> <span>${L('Read per')}</span></label>
                <input type="text" size="5" placeholder="1000" id="read_period" value="1000"> ms
                |
                <button class="button is-small" id="button_edit">${L('Button Edit')}</button>
                <div id="button_subs" style="display: none;">
                <button class="button is-small" id="group_on">${L('Enable')} & ${L('Group')}</button>
                <button class="button is-small" id="group_off">${L('Ungroup')}</button>
                <button class="button is-small" id="enable_on">${L('Enable')}</button>
                <button class="button is-small" id="enable_off">${L('Disable')}</button>
                <button class="button is-small" id="button_all">${L('Select All')}</button>
                <button class="button is-small" id="button_def">${L('Load Default')}</button>
                </div>
            </div>
        
            <div class="content">
                <div class="columns">
                  <div class="column" id="reg_list0"></div>
                  <div class="column" id="reg_list1"></div>
                </div>
            </div>
        </div>
        <br>
    `;
    document.getElementsByTagName('section')[0].insertAdjacentHTML('beforeend', html);
    
    init_reg_list();
    await init_reg_rw();
    
    document.getElementById(`button_edit`).onclick = () => { button_edit(); button_none(); };
    document.getElementById(`group_on`).onclick = () => { set_enable(true); set_group(true); button_none(); };
    document.getElementById(`group_off`).onclick = () => { set_group(false); button_none(); };
    document.getElementById(`enable_on`).onclick = () => { set_enable(true); button_none(); };
    document.getElementById(`enable_off`).onclick = () => { set_enable(false); button_none(); };
    document.getElementById(`button_all`).onclick = button_all;
    document.getElementById(`button_def`).onclick = () => { button_none(); button_def(); };
    document.getElementById(`less_reg`).onchange = init_reg_rw;
    
    document.getElementById('dev_read_all').onclick = async function() {
        document.getElementById('dev_read_all').disabled = true;
        for (let i = 0; i < csa.reg.reg_r.length; i++) {
            let ret = await read_reg_val(i);
            if (ret)
                break;
        }
        document.getElementById('dev_read_all').disabled = false;
    };

    document.getElementById('dev_write_all').onclick = async function() {
        document.getElementById('dev_write_all').disabled = true;
        for (let i = 0; i < csa.reg.reg_w.length; i++) {
            let ret = await write_reg_val(i);
            if (ret)
                break;
        }
        document.getElementById('dev_write_all').disabled = false;
    };
    
    document.getElementById(`keep_read`).onclick = period_read;
    
    
    csa.reg.dat_export = () => {
        let reg_str = {};
        for (let i = 0; i < csa.cfg.reg.list.length; i++) {
            let r = csa.cfg.reg.list[i];
            
            if (r[R_FMT][0] == '{') {
                let one_size = fmt_size(r[R_FMT]);
                let count = Math.trunc(r[R_LEN] / one_size);
                for (let n = 0; n < count; n++) {
                    if (csa.reg.elm[`reg.${r[R_ID]}.${n}`].value != '')
                        reg_str[`${r[R_ID]}.${n}`] = csa.reg.elm[`reg.${r[R_ID]}.${n}`].value;
                }
            
            } else {
                if (csa.reg.elm[`reg.${r[R_ID]}`].value != '')
                    reg_str[`${r[R_ID]}`] = csa.reg.elm[`reg.${r[R_ID]}`].value;
            }
            
        }
        return reg_str;
    };
    
    csa.reg.dat_import = (dat) => {
        for (let i = 0; i < csa.cfg.reg.list.length; i++) {
            let r = csa.cfg.reg.list[i];
            
            if (r[R_FMT][0] == '{') {
                let one_size = fmt_size(r[R_FMT]);
                let count = Math.trunc(r[R_LEN] / one_size);
                for (let n = 0; n < count; n++) {
                    if (`${r[R_ID]}.${n}` in dat)
                        csa.reg.elm[`reg.${r[R_ID]}.${n}`].value = dat[`${r[R_ID]}.${n}`];
                }
            } else {
                if (`${r[R_ID]}` in dat)
                    csa.reg.elm[`reg.${r[R_ID]}`].value = dat[`${r[R_ID]}`];
            }
        }
    };
}


export { init_reg, cal_reg_rw, reg_idx_by_name };

