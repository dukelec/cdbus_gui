/*
 * Software License Agreement (MIT License)
 *
 * Author: Duke Fong <d@d-l.io>
 */

import { L } from '../utils/lang.js'
import { csa } from '../common.js';
import { fmt_size, R_ADDR, R_LEN, R_FMT, R_SHOW, R_ID, R_DESC } from './reg_rw.js';
import { val2hex } from '../utils/helper.js';


function plot_reg_w(idx) {
    let reg_val = csa.plot.reg_val[idx];
    let reg_name = csa.cfg.plot.plots[idx].cfg_reg;
    for (let i = 0; true; i++) {
        if (`reg.${reg_name}.${i}` in csa.reg.elm)
            csa.reg.elm[`reg.${reg_name}.${i}`].value = '0x0000 0x00';
        else
            break;
    }
    for (let i = 0; i < reg_val.length; i++) {
        if (`reg.${reg_name}.${i}` in csa.reg.elm) {
            csa.reg.elm[`reg.${reg_name}.${i}`].value = `0x${val2hex(reg_val[i][0])} 0x${val2hex(reg_val[i][1], 2)}`
        } else {
            console.warn(`reg.${reg_name}.${i} not exist`);
            alert(L('Insufficient registers!'));
            return;
        }
    }
    document.getElementById(`reg_btn_w.${reg_name}`).onclick();
}


// e.g. "str[2][3]" -> [["str[2][3]"], ["str[2]", 3], ["str", 2, 3]]
function split_indexes(str) {
    const result = [];
    let current = str;
    const indexes = [];
    
    result.push([current]);
    while (true) {
        const match = current.match(/\[(\d+)\]$/);
        if (!match)
            break;
        const value = Number(match[1]);
        indexes.unshift(value);
        current = current.replace(/\[\d+\]$/, '');
        result.push([current, ...indexes]);
    }
    return result.slice(0, 3);
}


function item_val(item, type) {
    if (item.length == 5) { // overlay
        switch (type) {
        case R_ADDR:
            if (Number.isInteger(item[0])) {
                return item[0] + item[1];
            } else {
                const label_a = split_indexes(item[0]);
                for (let i = 0; i < label_a.length; i++) {
                    const ret = _get_reg_ofs_len(label_a[i], true);
                    if (ret != null)
                        return ret[0] + item[1];
                }
                return null;
            }
        case R_LEN: return item[2];
        case R_FMT: return item[3];
        default: return null;
        }
    } else {
        return item[type];
    }
}

// e.g. name_a: ["str[2][3]"] or ["str[2]", 3]
function _get_reg_ofs_len(name_a, skip_overlay=false) {
    let match_item = null;
    
    if (!skip_overlay && csa.cfg.plot.reg_overlay) {
        let overlay = csa.cfg.plot.reg_overlay;
        for (let i = 0; i < overlay.length; i++) {
            if (overlay[i][4] == name_a[0]) {
                match_item = overlay[i];
                break;
            }
        }
    }
    if (!match_item) {
        let list = csa.cfg.reg.list;
        for (let i = 0; i < list.length; i++) {
            if (list[i][R_ID] == name_a[0]) {
                match_item = list[i];
                break;
            }
        }
    }
    if (!match_item)
        return null;
    
    if (name_a.length == 1) {
        let f = item_val(match_item, R_FMT);
        f = f.replace(/\W/g, '');
        let f_size = fmt_size(f);
        let len = item_val(match_item, R_LEN);
        if ((len / f_size) == 1 && !isNaN(f.at(-1)))
            return [item_val(match_item, R_ADDR), fmt_size(f.slice(0, -1)), f.slice(0, -1)];
        return [item_val(match_item, R_ADDR), len, f.repeat(len/f_size)];
    }
    
    const fmt_s = fmt_size(item_val(match_item, R_FMT));
    if (name_a.length == 2) {
        if (item_val(match_item, R_FMT)[0] == '[' || item_val(match_item, R_FMT)[0] == '{') {
            const ofs = item_val(match_item, R_ADDR) + fmt_s * name_a[1];
            const fmt = item_val(match_item, R_FMT).slice(1, -1);
            let f = fmt.replace(/\W/g, '');
            if (!isNaN(f.at(-1)))
                return [ofs, fmt_size(f.slice(0, -1)), f.slice(0, -1)];
            return [ofs, fmt_s, fmt];
        } else {
            const fmt_list = item_val(match_item, R_FMT).split(',');
            if (name_a[1] + 1 > fmt_list.length)
                return null;
            const sub_size = fmt_size(fmt_list[name_a[1]]);
            let ofs = 0;
            for (let i = 0; i < name_a[1]; i++)
                ofs += fmt_size(fmt_list[i]);
            let f = fmt_list[name_a[1]].replace(/\W/g, '');
            if (!isNaN(f.at(-1)))
                return [item_val(match_item, R_ADDR) + ofs, fmt_size(f.slice(0, -1)), f.slice(0, -1)];
            return [item_val(match_item, R_ADDR) + ofs, sub_size, fmt_list[name_a[1]]];
        }
    }
    
    if (name_a.length == 3 && item_val(match_item, R_FMT)[0] == '{') {
        const ofs1 = item_val(match_item, R_ADDR) + fmt_s * name_a[1];
        const fmt_list = item_val(match_item, R_FMT).split(',');
        if (name_a[2] + 1 > fmt_list.length)
            return null;
        const sub_size = fmt_size(fmt_list[name_a[2]]);
        let ofs2 = 0;
        for (let i = 0; i < name_a[2]; i++)
            ofs2 += fmt_size(fmt_list[i]);
        let f = fmt_list[name_a[2]].replace(/\W/g, '');
        if (!isNaN(f.at(-1)))
            return [ofs1 + ofs2, fmt_size(f.slice(0, -1)), f.slice(0, -1)];
        return [ofs1 + ofs2, sub_size, fmt_list[name_a[2]]];
    }
    
    return null;
}


function get_reg_ofs_len(name) {
    const label_a = split_indexes(name);
    for (let i = 0; i < label_a.length; i++) {
        let ret = _get_reg_ofs_len(label_a[i]);
        if (ret)
            return ret;
    }
    return null;
}


function plot_reg_w_init(idx) {
    let list = [];
    console.log(`plot_reg_w_init ${idx}`);
    const label = csa.cfg.plot.plots[idx].label;
    for (let i = 1; i < label.length; i++) {
        let ret = get_reg_ofs_len(label[i]);
        if (!ret) {
            console.warn(`plot label not found: ${label[i]}`);
            return;
        }
        if (ret[2].length == 1) {
            ret.push(label[i]);
        } else {
            for (let x = 0; x < ret[2].length; x++)
                ret.push(`${label[i]}[${x}]`);
        }
        list.push(ret);
    }
    console.log(`label list before merge:`, list);
    
    const result = [];
    let cur = [...list[0]];
    for (let i = 1; i < list.length; i++) {
        const next = list[i];

        const cur_end = cur[0] + cur[1];
        const next_start = next[0];

        if (cur_end === next_start) {
            cur[1] += next[1];
            cur[2] += next[2];
            cur.push(...next.slice(3));
        } else {
            result.push(cur);
            cur = [...next];
        }
    }
    result.push(cur);
    console.log(`label list after merge:`, result);
    
    const fmts = result.map(item => item[2]).join('');
    const labels = result.flatMap(item => item.slice(3));
    csa.plot.fmt[idx] = csa.cfg.plot.plots[idx].x_fmt + '.' + fmts;
    csa.plot.label[idx].push(csa.cfg.plot.plots[idx].label[0]);
    csa.plot.label[idx].push(...labels);
    
    console.log(`fmt: ${csa.plot.fmt[idx]}`);
    console.log(`label:`, csa.plot.label[idx]);
    csa.plot.reg_val[idx] = result;
}


export {
    plot_reg_w_init, plot_reg_w
};
