/*
 * Software License Agreement (MIT License)
 *
 * Author: Duke Fong <d@d-l.io>
 */

import { L } from '../utils/lang.js?v=__V__'
import { escape_html, date2num, val2hex, dat2str, dat2hex, hex2dat,
         read_file, download, readable_size, blob2dat } from '../utils/helper.js?v=__V__';
import { CDWebSocket } from '../utils/cd_ws.js?v=__V__';
import { fmt_size, reg2str, read_reg_val, str2reg, write_reg_val,
         reg_range_err, reg_range_tip, reg_watch, reg_unwatch, reg_notify, reg_set_str,
         R_ADDR, R_LEN, R_FMT, R_SHOW, R_ID, R_DESC } from './reg_rw.js?v=__V__';
import { csa, alloc_port, save_cfg_file, show_cfg_error,
         topbar_slot, topbar_update } from '../common.js?v=__V__';


// the whole page assumes the reg list is sorted by address and has no overlap
function check_reg_list() {
    let list = csa.cfg.reg ? csa.cfg.reg.list : null;
    if (!list || !list.length) {
        show_cfg_error(L('Register list is empty.'));
        return;
    }
    let bad = [];
    for (let i = 1; i < list.length; i++) {
        let pre = list[i-1];
        let cur = list[i];
        if (cur[R_ADDR] < pre[R_ADDR] + pre[R_LEN])
            bad.push(`${pre[R_ID]} 0x${val2hex(pre[R_ADDR])}+${pre[R_LEN]} -> ${cur[R_ID]} 0x${val2hex(cur[R_ADDR])}`);
    }
    if (bad.length)
        show_cfg_error(L('Register list is out of order, addresses must ascend without overlap: %s').replace('%s', bad.join(', ')));

    for (let reg of list) {
        let err = reg_range_err(reg);
        if (err)
            show_cfg_error(`${reg[R_ID]}: ${err}`);
    }
}

const PIN_SVG = `<svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" ` +
                `stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">` +
                `<path d="M3.5 2.5h9"/><path d="M8 13.5V5.5"/><path d="M5 8.5l3-3 3 3"/></svg>`;

// the value boxes one register has: a single one, or one per element of a {..} array
function reg_val_sfx(reg) {
    if (reg[R_FMT][0] != '{')
        return [reg[R_ID]];
    let count = Math.trunc(reg[R_LEN] / fmt_size(reg[R_FMT]));
    return Array.from({length: count}, (_, n) => `${reg[R_ID]}.${n}`);
}

// every element id one row owns, with `p` in front of each of them
function reg_row_keys(reg, p='') {
    let keys = [`${p}reg_row.${reg[R_ID]}`, `${p}reg_btn_r.${reg[R_ID]}`,
                `${p}reg_btn_w.${reg[R_ID]}`, `${p}reg_btn_pin.${reg[R_ID]}`];
    for (let sfx of reg_val_sfx(reg))
        keys.push(`${p}reg_dft.${sfx}`, `${p}reg.${sfx}`);
    return keys;
}

// one row of the register list. `p` prefixes every element id, so the same row can be built a
// second time as a mirror in the top bar; a mirror uses the browser's own title tooltips, the
// bar scrolls its contents and would clip the css ones.
function reg_row_html(reg, p='') {
    let dft_tip = `Default: --\nFormat: ${reg[R_FMT]}${reg_range_tip(reg)}`;
    let dft_attr = p ? `title="${escape_html(dft_tip)}"` :
                       `class="has-tooltip-arrow has-tooltip-left" data-tooltip="${escape_html(dft_tip)}"`;
    let desc = escape_html(reg[R_DESC] || '');
    let name_attr = p ? `class="level-left" title="${desc}"` :
                        `class="level-left has-tooltip-arrow has-tooltip-multiline has-tooltip-right" ` +
                        `data-tooltip="${desc}"`;
    let show = reg[R_SHOW] == 0 ? '' : (reg[R_SHOW] == 1 ? 'H' : 'B');
    let sfx_list = reg_val_sfx(reg);
    
    let br = sfx_list.length > 1 ? ' <br>' : '';
    let html_input = sfx_list.map(sfx => `
                <span ${dft_attr} id="${p}reg_dft.${sfx}">
                  <input type="text" style="font-family: monospace;" id="${p}reg.${sfx}">
                </span> ${show}${br}`).join('');
    
    return `
        <div class="columns is-mobile is-gapless reg_row" id="${p}reg_row.${reg[R_ID]}">
          <div class="column reg_row_name">
            <div class="level is-mobile">
              <span ${name_attr}>${reg[R_ID]}</span>
              <span class="level-right">0x${val2hex(reg[R_ADDR])}</span>
            </div>
          </div>
          <div class="column reg_row_val">
            ${html_input}
          </div>
          <div class="column is-1 reg_btn_rw" id="${p}reg_btn_r.${reg[R_ID]}">R</div>
          <div class="column is-1 reg_btn_rw" id="${p}reg_btn_w.${reg[R_ID]}">W</div>
          <div class="column is-1 reg_btn_pin" id="${p}reg_btn_pin.${reg[R_ID]}"
               title="${p ? L('Take out of the top bar') : L('Keep in the top bar')}">${PIN_SVG}</div>
        </div>`;
}

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
        let count = reg[R_FMT][0] == '{' ? Math.trunc(reg[R_LEN] / fmt_size(reg[R_FMT])) : 1;
        for (let key of reg_row_keys(reg))
            csa.reg.elm[key] = null;
        list[cur_line <= max_line/2 ? 0 : 1].insertAdjacentHTML('beforeend', reg_row_html(reg));
        cur_line += count;
    }
    
    for (let e in csa.reg.elm)
        csa.reg.elm[e] = document.getElementById(e);
    
    // a value typed into the list has to reach the mirrors of that value as well
    for (let reg of csa.cfg.reg.list) {
        for (let sfx of reg_val_sfx(reg)) {
            let elem = csa.reg.elm[`reg.${sfx}`];
            elem.oninput = () => reg_notify(elem);
        }
    }
}


function in_reg_rw(reg_rw, addr) { // test if in range
    for (let i = 0; i < reg_rw.length; i++) {
        if (addr >= reg_rw[i][0] && addr < reg_rw[i][0] + reg_rw[i][1])
            return i;
    }
    return null;
}

// the group set shown: 'reg' for reg_r / reg_w, or the xxx of an xxx_r / xxx_w pair
function cur_mode() {
    return document.getElementById('reg_mode').value;
}

function in_button_edit() {
    return document.getElementById('button_edit').style.background != '';
}

// every xxx_r / xxx_w set, in the order the config file first names it (the json5 parser, msgpack
// and the js object all keep that order); reg is the default and always there, first when the file
// has neither reg_r nor reg_w
function mode_names() {
    let names = [];
    for (let key in csa.cfg.reg) {
        let m = key.match(/^(\w+)_[rw]$/);
        if (m && !names.includes(m[1]))
            names.push(m[1]);
    }
    if (!names.includes('reg'))
        names.unshift('reg');
    return names;
}

// the groups of a set in effect: this browser's edited copy of each side, else the config file's
// (a side edited back to what the file has is stored as null, so each side falls back on its own)
async function mode_groups(mode) {
    let r = await csa.db.get('tmp', `${csa.arg.name}/reg.${mode}_r`);
    let w = await csa.db.get('tmp', `${csa.arg.name}/reg.${mode}_w`);
    return [r ?? csa.cfg.reg[`${mode}_r`], w ?? csa.cfg.reg[`${mode}_w`]];
}

// offer reg plus every set that has at least one group, keeping the page's choice when it is
// still there; with only reg left there is nothing to choose, so the select is locked
async function update_mode_select() {
    let sel = document.getElementById('reg_mode');
    let names = [];
    for (let m of mode_names()) {
        let [r, w] = await mode_groups(m);
        if (m == 'reg' || (r && r.length) || (w && w.length))
            names.push(m);
    }
    sel.innerHTML = names.map(m => `<option value="${m}">${m}</option>`).join('');
    sel.value = names.includes(csa.reg.mode) ? csa.reg.mode : 'reg';
    sel.disabled = names.length < 2;
    sel.title = names.length < 2 ? L('No other register group set to choose') : '';
}

// a set other than reg only shows the regs a read or a write group covers, but all of them while
// the groups are being edited, or there would be no way to add one; the shown rows are then split
// over the two columns again the way init_reg_list() does it
function layout_reg_rows() {
    let list = [document.getElementById('reg_list0'), document.getElementById('reg_list1')];
    let all = cur_mode() == 'reg' || in_button_edit();
    let rows = csa.cfg.reg.list.map(reg => ({
        elm: csa.reg.elm[`reg_row.${reg[R_ID]}`],
        show: all || in_reg_rw(csa.reg.reg_r, reg[R_ADDR]) != null || in_reg_rw(csa.reg.reg_w, reg[R_ADDR]) != null,
        lines: reg[R_FMT][0] == '{' ? Math.trunc(reg[R_LEN] / fmt_size(reg[R_FMT])) : 1
    }));
    let max_line = rows.reduce((n, r) => n + (r.show ? r.lines : 0), 0);
    let cur_line = 0;
    for (let r of rows) {
        r.elm.style.display = r.show ? '' : 'none';
        list[cur_line <= max_line/2 ? 0 : 1].appendChild(r.elm);
        if (r.show)
            cur_line += r.lines;
    }
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
                btn.onclick = async () => await write_reg_val(rw_idx);
            } else {
                btn.onclick = async () => { await read_reg_val(rw_idx); };
            }

            // the list shows every register there is, so an edge is either the end of the
            // group or a join to the row next to it, never open
            set_rw_btn_style(btn, rw_idx == rw_idx_pre ? 'join' : 'end',
                                  rw_idx == rw_idx_next ? 'join' : 'end',
                             reg_pre, reg, reg_next);
        }
    }
}

// How one R / W button is drawn between the registers above and below it in the list. Each of
// its two edges is one of:
//   'end'   the group ends here, so that side of the button is closed off
//   'join'  the same group carries on into the row right next to it, and the two become one bar
//   'open'  the same group carries on, but into a register this list is not showing. The side
//           is drawn exactly as a join would draw it, only nothing is glued to it: a register
//           on its own in the top bar then looks the way it does down in the register list,
//           open above and below, instead of reading as a group of its own.
// `reg_pre` / `reg_next` are the neighbours in the register list, whatever is on screen: an
// address gap to one of them keeps that corner rounded, which is what shows the gap as a notch.
function set_rw_btn_style(btn, edge_pre, edge_next, reg_pre, reg, reg_next) {
    let disconn_pre = !(reg_pre && reg_pre[R_ADDR] + reg_pre[R_LEN] == reg[R_ADDR]);
    let disconn_next = !(reg_next && reg[R_ADDR] + reg[R_LEN] == reg_next[R_ADDR]);
    let round_pre = edge_pre == 'end' || disconn_pre;
    let round_next = edge_next == 'end' || disconn_next;
    
    if (edge_pre == 'join')
        btn.style['margin-top'] = '0';
    if (edge_next == 'join')
        btn.style['margin-bottom'] = '0';
    btn.style['border-width'] = `${edge_pre == 'end' ? '0.1px' : '0'} 0.1px ` +
                                `${edge_next == 'end' ? '0.1px' : '0'} 0.1px`;
    btn.style['border-radius'] = round_pre ? (round_next ? '6px' : '6px 6px 0 0')
                                           : (round_next ? '0 0 6px 6px' : '0');
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
        layout_reg_rows();
        build_pin_bar();
        
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
        // save to idb, only what differs from the config file
        let mode = cur_mode();
        await save_reg_db(`${mode}_r`, reg_rw2reg_cfg(csa.reg.reg_r));
        await save_reg_db(`${mode}_w`, reg_rw2reg_cfg(csa.reg.reg_w));
        console.log(`new ${mode}_r values:`);
        console.log(JSON.stringify(csa.reg.reg_r));
        console.log(JSON.stringify(reg_rw2reg_cfg(csa.reg.reg_r)));
        console.log(`new ${mode}_w values:`);
        console.log(JSON.stringify(csa.reg.reg_w));
        console.log(JSON.stringify(reg_rw2reg_cfg(csa.reg.reg_w)));
        // the edit may have emptied a set, or Load Default refilled one
        await update_mode_select();
        await init_reg_rw();
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
    let mode = cur_mode();
    csa.reg.reg_r = reg_cfg2reg_rw(csa.cfg.reg[`${mode}_r`]);
    csa.reg.reg_w = reg_cfg2reg_rw(csa.cfg.reg[`${mode}_w`]);
    for (let m of mode_names()) {
        await csa.db.set('tmp', `${csa.arg.name}/reg.${m}_r`, null);
        await csa.db.set('tmp', `${csa.arg.name}/reg.${m}_w`, null);
    }
    update_reg_rw_btn('r');
    update_reg_rw_btn('w');
    // re-install onclick callback:
    document.getElementById('button_edit').style.background = '';
    button_edit();
    alert('Load default succeeded.');
}

async function save_reg_db(name, val) {
    let same = JSON.stringify(val) == JSON.stringify(csa.cfg.reg[name] || []);
    await csa.db.set('tmp', `${csa.arg.name}/reg.${name}`, same ? null : val);
}

// push the edited button groups back into the json5 config file, so they
// become the default for every browser instead of only this one
async function reg_save_file() {
    let mode = cur_mode();
    let cur = {};
    cur[`${mode}_r`] = reg_rw2reg_cfg(csa.reg.reg_r);
    cur[`${mode}_w`] = reg_rw2reg_cfg(csa.reg.reg_w);
    for (let m of mode_names()) {   // and whatever was edited in the other sets
        if (m == mode)
            continue;
        for (let n of [`${m}_r`, `${m}_w`]) {
            let v = await csa.db.get('tmp', `${csa.arg.name}/reg.${n}`);
            if (v)
                cur[n] = v;
        }
    }
    let vals = [];
    for (let n in cur) {
        if (JSON.stringify(cur[n]) != JSON.stringify(csa.cfg.reg[n] || []))
            vals.push({ path: ['reg', n], val: cur[n] });
    }
    if (!vals.length) {
        alert(L('The config file already matches, nothing to save.'));
        return;
    }
    let btn = document.getElementById('save_reg_file');
    btn.disabled = true;
    try {
        await save_cfg_file(vals);
        for (let v of vals) { // the file is the default now, drop the local copy
            csa.cfg.reg[v.path[1]] = v.val;
            await csa.db.set('tmp', `${csa.arg.name}/reg.${v.path[1]}`, null);
        }
        alert(L('Saved to %s, the previous version is kept as a .bak file.')
              .replace('%s', csa.arg.cfg));
    } catch (err) {
        alert(`${err.message || err}`);
    } finally {
        btn.disabled = false;
    }
}

// ---- the top bar ----------------------------------------------------------------------

// the pinned registers in address order, split into runs of registers that sit next to each
// other in the list: a run is drawn as one column, so a group reads up in the bar exactly as
// it does in the list below. Two pinned registers with an unpinned one between them start
// separate runs, or the bar would draw a group with one of its members silently missing.
function pin_runs() {
    let runs = [];
    for (let i = 0; i < csa.cfg.reg.list.length; i++) {
        if (!csa.reg.pin.ids.includes(csa.cfg.reg.list[i][R_ID]))
            continue;
        let last = runs[runs.length - 1];
        if (last && last[last.length - 1] == i - 1)
            last.push(i);
        else
            runs.push([i]);
    }
    return runs;
}

// tie one mirror row to the row of the same register in the list: the list keeps the only
// copy of every value, the mirror only shows it and hands typing straight back
function bind_pin_row(idx, in_run_pre, in_run_next) {
    let reg = csa.cfg.reg.list[idx];
    let id = reg[R_ID];
    let pin = csa.reg.pin.elm;
    // a run is a stretch of the list, so a neighbour it shows is the list neighbour itself
    let reg_pre = idx > 0 ? csa.cfg.reg.list[idx-1] : null;
    let reg_next = idx < csa.cfg.reg.list.length - 1 ? csa.cfg.reg.list[idx+1] : null;
    
    for (let sfx of reg_val_sfx(reg)) {
        let src = csa.reg.elm[`reg.${sfx}`];
        let dst = pin[`pin_reg.${sfx}`];
        reg_watch(src, 'reg_pin', (e) => {
            dst.value = e.value;
            dst.style.background = e.style.background;
        }, dst);
        dst.oninput = () => { src.value = dst.value; reg_notify(src, 'reg_pin'); };
        dst.onkeydown = (evt) => src.onkeydown?.(evt);   // enter writes, as it does in the list
        
        let src_dft = csa.reg.elm[`reg_dft.${sfx}`];
        let dst_dft = pin[`pin_reg_dft.${sfx}`];
        reg_watch(src_dft, 'reg_pin', (e) => { dst_dft.title = e.getAttribute('data-tooltip') || ''; });
    }
    
    // the buttons do whatever the list row's buttons do at that moment, group and all, so
    // there is never a second idea of what R or W means for this register
    for (let rw of ['r', 'w']) {
        let btn = pin[`pin_reg_btn_${rw}.${id}`];
        let src_btn = csa.reg.elm[`reg_btn_${rw}.${id}`];
        btn.onclick = () => src_btn.onclick?.();
        
        let reg_rw = rw == 'r' ? csa.reg.reg_r : csa.reg.reg_w;
        let rw_idx = reg_rw ? in_reg_rw(reg_rw, reg[R_ADDR]) : null;
        if (rw_idx == null)     // not in a group of the set in use, same dead button as below
            continue;
        btn.style['background'] = rw == 'r' ? '#D5F5E3' : '#D6EAF8';
        // same edges as the list row has, except that an edge whose register the bar is not
        // showing is left open instead of glued to it
        let same = (r) => r != null && in_reg_rw(reg_rw, r[R_ADDR]) === rw_idx;
        set_rw_btn_style(btn,
                !same(reg_pre) ? 'end' : (in_run_pre ? 'join' : 'open'),
                !same(reg_next) ? 'end' : (in_run_next ? 'join' : 'open'),
                reg_pre, reg, reg_next);
    }
    
    pin[`pin_reg_btn_pin.${id}`].onclick = () => toggle_pin(id);
}

function build_pin_bar() {
    if (!csa.reg.pin.slot)
        return;
    reg_unwatch('reg_pin');
    csa.reg.pin.slot.innerHTML = '';
    csa.reg.pin.elm = {};
    // while the groups are being edited the R / W buttons mean something else entirely
    let runs = in_button_edit() ? [] : pin_runs();
    
    for (let run of runs) {
        let div = document.createElement('div');
        div.className = 'reg_pin_cluster';
        for (let i of run)
            div.insertAdjacentHTML('beforeend', reg_row_html(csa.cfg.reg.list[i], 'pin_'));
        csa.reg.pin.slot.appendChild(div);
        for (let i of run) {
            for (let key of reg_row_keys(csa.cfg.reg.list[i], 'pin_'))
                csa.reg.pin.elm[key] = document.getElementById(key);
        }
    }
    for (let run of runs) {
        for (let n = 0; n < run.length; n++)
            bind_pin_row(run[n], n > 0, n < run.length - 1);
    }
    fit_pin_names();
    topbar_update();
}

// Each run is a grid of its own, so left alone each is only as wide as its own longest name and
// the runs do not line up once the bar wraps onto a second line. Measuring the widest name of
// the whole bar and handing it to every run makes them all the same width, and equally wide
// items in a wrapping row line up column for column by themselves.
function fit_pin_names() {
    let slot = csa.reg.pin.slot;
    slot.style.removeProperty('--pin_name');    // back to each run's own width to measure
    let w = 0;
    for (let e of slot.getElementsByClassName('reg_row_name'))
        w = Math.max(w, e.getBoundingClientRect().width);
    if (w)      // 0 before the page is laid out, leave each run its own width until then
        slot.style.setProperty('--pin_name', `${Math.ceil(w)}px`);
}

function update_pin_btns() {
    for (let reg of csa.cfg.reg.list) {
        csa.reg.elm[`reg_btn_pin.${reg[R_ID]}`]
                .classList.toggle('is-pinned', csa.reg.pin.ids.includes(reg[R_ID]));
    }
}

async function toggle_pin(id) {
    let i = csa.reg.pin.ids.indexOf(id);
    if (i < 0)
        csa.reg.pin.ids.push(id);
    else
        csa.reg.pin.ids.splice(i, 1);
    await csa.db.set('tmp', `${csa.arg.name}/reg.pin`, csa.reg.pin.ids);
    update_pin_btns();
    build_pin_bar();
}

// the bar is this browser's own, the config file only says which registers start out in it
async function init_pin() {
    csa.reg.pin.slot = await topbar_slot('reg', 0);
    let ids = await csa.db.get('tmp', `${csa.arg.name}/reg.pin`) ?? csa.cfg.reg.pin ?? [];
    if (!Array.isArray(ids)) {
        show_cfg_error(L('reg.pin must be a list of register names.'));
        ids = [];
    }
    csa.reg.pin.ids = ids.filter(id => reg_idx_by_name(id) != null);
    for (let reg of csa.cfg.reg.list)
        csa.reg.elm[`reg_btn_pin.${reg[R_ID]}`].onclick = () => toggle_pin(reg[R_ID]);
    update_pin_btns();
}


async function init_reg_rw() {
    let [reg_r, reg_w] = await mode_groups(cur_mode());
    console.log(`init reg ${cur_mode()} groups:`, reg_r, reg_w);
    csa.reg.reg_r = reg_cfg2reg_rw(reg_r);
    csa.reg.reg_w = reg_cfg2reg_rw(reg_w);
    update_reg_rw_btn('r');
    update_reg_rw_btn('w');
    layout_reg_rows();
    build_pin_bar();
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
        elm: {},        // cache dom elements
        pin: { ids: [], elm: {}, slot: null }   // the rows mirrored in the top bar
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
                <span class="select is-small"><select id="reg_mode"></select></span>
                <label class="checkbox"><input type="checkbox" id="keep_read"> <span>${L('Read per')}</span></label>
                <input type="text" size="5" placeholder="200" id="read_period" value="200"> ms
                |
                <button class="button is-small" id="button_edit">${L('Button Edit')}</button>
                <div id="button_subs" style="display: none;">
                <button class="button is-small" id="group_on">${L('Enable')} & ${L('Group')}</button>
                <button class="button is-small" id="group_off">${L('Ungroup')}</button>
                <button class="button is-small" id="enable_on">${L('Enable')}</button>
                <button class="button is-small" id="enable_off">${L('Disable')}</button>
                <button class="button is-small" id="button_all">${L('Select All')}</button>
                <button class="button is-small" id="button_def">${L('Load Default')}</button>
                <button class="button is-small" id="save_reg_file">${L('Update Config File')}</button>
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
    
    check_reg_list();
    init_reg_list();
    await init_pin();
    // the group set (reg by default) and the read period are remembered per device page,
    // the read switch itself always starts off
    csa.reg.mode = await csa.db.get('tmp', `${csa.arg.name}/reg.mode`) || 'reg';
    document.getElementById('read_period').value =
            await csa.db.get('tmp', `${csa.arg.name}/reg.read_period`) || '200';
    await update_mode_select();
    await init_reg_rw();
    
    document.getElementById(`button_edit`).onclick = () => { button_edit(); button_none(); };
    document.getElementById(`group_on`).onclick = () => { set_enable(true); set_group(true); button_none(); };
    document.getElementById(`group_off`).onclick = () => { set_group(false); button_none(); };
    document.getElementById(`enable_on`).onclick = () => { set_enable(true); button_none(); };
    document.getElementById(`enable_off`).onclick = () => { set_enable(false); button_none(); };
    document.getElementById(`button_all`).onclick = button_all;
    document.getElementById(`button_def`).onclick = () => { button_none(); button_def(); };
    document.getElementById('reg_mode').onchange = async () => {
        csa.reg.mode = cur_mode();
        await csa.db.set('tmp', `${csa.arg.name}/reg.mode`, csa.reg.mode);
        await init_reg_rw();
    };
    document.getElementById('read_period').oninput = async () => {
        let val = document.getElementById('read_period').value.trim();
        if (Number(val) > 0) {  // keep the last good one, an empty box would read with no delay
            await csa.db.set('tmp', `${csa.arg.name}/reg.read_period`, val);
        }
    };
    document.getElementById(`save_reg_file`).onclick = reg_save_file;
    
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
                        reg_set_str(csa.reg.elm[`reg.${r[R_ID]}.${n}`], dat[`${r[R_ID]}.${n}`]);
                }
            } else {
                if (`${r[R_ID]}` in dat)
                    reg_set_str(csa.reg.elm[`reg.${r[R_ID]}`], dat[`${r[R_ID]}`]);
            }
        }
    };
}


export { init_reg, cal_reg_rw, reg_idx_by_name };
