/*
 * Software License Agreement (MIT License)
 *
 * Author: Duke Fong <d@d-l.io>
 */

import { L } from '../utils/lang.js'
import { sleep, escape_html, date2num, val2hex, dat2str, dat2hex, hex2dat,
         read_file, download, readable_size, blob2dat } from '../utils/helper.js';
import { CDWebSocket } from '../utils/cd_ws.js';
import { Idb } from '../utils/idb.js';
import { csa, alloc_port } from '../common.js';


let html = `
    <div class="container">
        <h2 class="title is-size-4">IAP</h2>
        <input type="text" size="85" placeholder="Full path of intel hex file on system" id="iap_path">
        <select id="iap_action" value="bl_full">
            <option value="bl_full">${L('Reboot')} -> BL -> ${L('Flash')} -> ${L('Reboot')}</option>
            <option value="bl_flash">${L('Reboot')} -> BL -> ${L('Flash')}</option>
            <option value="bl">${L('Reboot')} -> BL (${L('Enter')} BootLoader)</option>
            <option value="flash">${L('Flash Only')}</option>
        </select>
        <select id="iap_check" value="none">
            <option value="none">${L('No Check')}</option>
            <option value="read">${L('Read Back Check')}</option>
            <option value="crc">${L('Read CRC Check')}</option>
        </select>
        <button class="button is-small" id="iap_start">${L('Start')}</button>
        <button class="button is-small" id="iap_stop" disabled>${L('Stop')}</button> <br>
        
        <span>${L('Progress')}</span>: <span id="iap_epoch"></span> <span id="iap_progress">--</span>
    </div>
    <br>`;


async function flash_erase(addr, len) {
    let d = new Uint8Array(9);
    let dv = new DataView(d.buffer);
    d[0] = 0x2f;
    dv.setUint32(1, addr, true);
    dv.setUint32(5, len, true);
    
    csa.iap.proxy_sock.flush();
    await csa.iap.proxy_sock.sendto({'dst': [csa.arg.tgt, 0x8], 'dat': d}, ['server', 'proxy']);
    console.log(`flash_erase wait ret, addr: ${val2hex(addr)}, len: ${(val2hex(len))}`);
    let ret = await csa.iap.proxy_sock.recvfrom(5000);
    console.log('flash_erase ret', ret);
    if (ret && ret[0].dat.length == 1 && (ret[0].dat[0] & 0x8f) == 0x80) {
        return 0
    } else {
        console.log('flash_erase err');
        return -1;
    }
}

async function flash_write_blk(addr, dat) {
    let d = new Uint8Array(5 + dat.length);
    let dv = new DataView(d.buffer);
    d[0] = 0x20;
    dv.setUint32(1, addr, true);
    d.set(dat, 5);
    
    csa.iap.proxy_sock.flush();
    await csa.iap.proxy_sock.sendto({'dst': [csa.arg.tgt, 0x8], 'dat': d}, ['server', 'proxy']);
    console.log(`flash_write_blk wait ret, addr: ${val2hex(addr)}`);
    let ret = await csa.iap.proxy_sock.recvfrom(500);
    console.log('flash_write_blk ret', ret);
    if (ret && ret[0].dat.length == 1 && (ret[0].dat[0] & 0x8f) == 0x80) {
        return 0
    } else {
        console.log('flash_write_blk err');
        return -1;
    }
}

async function flash_write(addr, dat, blk_size=128) {
    let cur = addr;
    while (document.getElementById('iap_start').disabled) {
        let size = Math.min(blk_size, dat.length - (cur - addr));
        if (size == 0)
            return 0;
        let wdat = dat.slice(cur-addr, cur-addr+size);
        let ret = await flash_write_blk(cur, wdat);
        if (ret)
            return -1;
        cur += size;
        document.getElementById('iap_progress').innerHTML = `Write ${Math.round((cur - addr) / dat.length * 100)}%`;
    }
    return -2;
}

async function flash_read_blk(addr, len) {
    let d = new Uint8Array(6);
    let dv = new DataView(d.buffer);
    d[0] = 0x00;
    dv.setUint32(1, addr, true);
    d[5] = len;
    
    csa.iap.proxy_sock.flush();
    await csa.iap.proxy_sock.sendto({'dst': [csa.arg.tgt, 0x8], 'dat': d}, ['server', 'proxy']);
    console.log(`flash_read_blk wait ret, addr: ${val2hex(addr)}, len: ${len}`);
    let ret = await csa.iap.proxy_sock.recvfrom(500);
    console.log('flash_read_blk ret', ret);
    if (ret && (ret[0].dat[0] & 0x8f) == 0x80 && ret[0].dat.length == len + 1) {
        return ret[0].dat.slice(1);
    } else {
        console.log('flash_read_blk err');
        return null;
    }
}

async function flash_read(addr, len, blk_size=128) {
    let cur = addr;
    let buf = new Uint8Array(0);
    while (document.getElementById('iap_start').disabled) {
        let size = Math.min(blk_size, len - (cur - addr));
        if (size == 0)
            return buf;
        let ret = await flash_read_blk(cur, size);
        if (ret == null)
            return null;
        buf = Uint8Array.from([...buf, ...ret]);
        cur += size;
        document.getElementById('iap_progress').innerHTML = `Read ${Math.round((cur - addr) / len * 100)}%`;
    }
    return null;
}

async function flash_read_crc(addr, len) {
    let d = new Uint8Array(9);
    let dv = new DataView(d.buffer);
    d[0] = 0x10;
    dv.setUint32(1, addr, true);
    dv.setUint32(5, len, true);
    
    csa.iap.proxy_sock.flush();
    await csa.iap.proxy_sock.sendto({'dst': [csa.arg.tgt, 0x8], 'dat': d}, ['server', 'proxy']);
    console.log(`flash_read_crc ret, addr: ${val2hex(addr)}, len: ${val2hex(len)}`);
    let ret = await csa.iap.proxy_sock.recvfrom(500);
    console.log('flash_read_crc', ret);
    if (ret && (ret[0].dat[0] & 0x8f) == 0x80) {
        let ret_dv = new DataView(ret[0].dat.slice(1).buffer);
        return ret_dv.getUint16(0, true);
    } else {
        console.log('flash_read_crc err');
        return null;
    }
}

function crc16(buffer) {
    var crc = 0xFFFF;
    var odd;

    for (var i = 0; i < buffer.length; i++) {
        crc = crc ^ buffer[i];

        for (var j = 0; j < 8; j++) {
            odd = crc & 0x0001;
            crc = crc >> 1;
            if (odd) {
                crc = crc ^ 0xA001;
            }
        }
    }

    return crc;
};

async function keep_in_bl() {
    let d = new Uint8Array([0x20, 0, 0, 1]);
    let dv = new DataView(d.buffer);
    dv.setUint16(1, csa.cfg.iap.keep_bl, true);
    
    csa.iap.proxy_sock.flush();
    await csa.iap.proxy_sock.sendto({'dst': [csa.arg.tgt, 0x5], 'dat': d}, ['server', 'proxy']);
    console.log('keep_in_bl wait ret');
    let ret = await csa.iap.proxy_sock.recvfrom(200);
    console.log('keep_in_bl ret', ret);
    if (ret && ret[0].dat.length == 1 && (ret[0].dat[0] & 0x8f) == 0x80) {
        console.log('keep_in_bl succeeded');
        return 0;
    } else {
        console.log('keep_in_bl err');
        return -1;
    }
}

async function do_reboot() {
    let d = new Uint8Array([0x20, 0, 0, 1]);
    let dv = new DataView(d.buffer);
    dv.setUint16(1, csa.cfg.iap.reboot, true);
    
    csa.iap.proxy_sock.flush();
    await csa.iap.proxy_sock.sendto({'dst': [csa.arg.tgt, 0x5], 'dat': d}, ['server', 'proxy']);
    console.log('reboot wait ret');
    let ret = await csa.iap.proxy_sock.recvfrom(200);
    console.log('reboot ret', ret);
}


async function stop_iap() {
    document.getElementById('iap_start').disabled = false;
    document.getElementById('iap_stop').disabled = true;
}

async function do_iap() {
    document.getElementById('iap_start').disabled = true;
    document.getElementById('iap_stop').disabled = false;
    document.getElementById('iap_epoch').innerHTML = '';
    document.getElementById('iap_progress').innerHTML = '--';
    
    let path = document.getElementById('iap_path').value;
    let check = document.getElementById('iap_check').value;
    let action = document.getElementById('iap_action').value;
    
    if (!path && action != 'bl') {
        alert('path empty');
        stop_iap();
        return;
    }
    
    let msg = null;
    if (action != "bl") {
        csa.cmd_sock.flush();
        await csa.cmd_sock.sendto({'action': 'get_ihex', 'path': path}, ['server', 'iap']);
        msg = await csa.cmd_sock.recvfrom(500);
        if (!msg || !msg[0].length) {
            alert('invalid ihex file');
            stop_iap();
            return;
        }
        console.log(`get_ihex:`, msg[0]);
    }
    
    let retry_cnt = 0;
    let reboot_cnt = 0;
    while (action.startsWith('bl') && document.getElementById('iap_start').disabled) {
    
        csa.iap.proxy_sock.flush();
        await csa.iap.proxy_sock.sendto({'dst': [csa.arg.tgt, 0x1], 'dat': new Uint8Array([0x00])}, ['server', 'proxy']);
        console.log('read info wait ret');
        let ret = await csa.iap.proxy_sock.recvfrom(200);
        console.log('read info ret', ret);
        if (ret && ret[0].src[1] == 0x0001) {
            let s = dat2str(ret[0].dat.slice(1));
            if (s.includes('(bl)')) {
                console.log(`found (bl): ${s}`);
                if (await keep_in_bl()) {
                    document.getElementById('iap_progress').innerHTML = `keep_in_bl failed`;
                } else {
                    document.getElementById('iap_progress').innerHTML = `keep_in_bl succeeded`;
                    break;
                }
            } else {
                console.log('not found (bl), reboot');
                document.getElementById('iap_progress').innerHTML = `Not found string "(bl)", reboot...`;
                await do_reboot();
                reboot_cnt++;
            }
        } else {
            let retry_str;
            switch (retry_cnt) {
            case 0: retry_str = '-'; break;
            case 1: retry_str = '\\'; break;
            case 2: retry_str = '|'; break;
            case 3: retry_str = '/'; break;
            }
            console.log('read info time out');
            document.getElementById('iap_progress').innerHTML =
                `Try read info <span style="font-family: monospace;">(${retry_str})</span> | try reboot: ${reboot_cnt}`;
        }
        if (++retry_cnt >= 4)
            retry_cnt = 0;
        await sleep(50);
    }
    
    if (action == "flash" && document.getElementById('iap_start').disabled) {
        if (await keep_in_bl()) {
            document.getElementById('iap_progress').innerHTML = `keep_in_bl failed`;
            stop_iap();
            return;
        } else {
            console.log(`keep_in_bl succeeded`);
            document.getElementById('iap_progress').innerHTML = `keep_in_bl succeeded`;
        }
    }
    
    for (let idx = 0; action != "bl" && idx < msg[0].length; idx++) {
        if (!document.getElementById('iap_start').disabled)
            break;
        let seg = msg[0][idx];
        let addr = seg[0];
        let dat = seg[1];
        let len = dat.length;
        document.getElementById('iap_epoch').innerHTML = `[${idx+1}/${msg[0].length}]`;
        
        document.getElementById('iap_progress').innerHTML = `Erasing...`;
        if (await flash_erase(addr, len)) {
            document.getElementById('iap_progress').innerHTML = `Erase failed`;
            stop_iap();
            return;
        }
    }
    
    for (let idx = 0; action != "bl" && idx < msg[0].length; idx++) {
        if (!document.getElementById('iap_start').disabled)
            break;
        let seg = msg[0][idx];
        let addr = seg[0];
        let dat = seg[1];
        let len = dat.length;
        let crc_ori = crc16(dat);
        document.getElementById('iap_epoch').innerHTML = `[${idx+1}/${msg[0].length}]`;
        
        if (await flash_write(addr, dat)) {
            document.getElementById('iap_progress').innerHTML = `Write failed`;
            stop_iap();
            return;
        }
        
        if (check == "crc") {
            let crc_back = await flash_read_crc(addr, len);
            if (crc_back == null) {
                document.getElementById('iap_progress').innerHTML = 'Read crc failed.';
                stop_iap();
                return;
            } else if (crc_back != crc_ori) {
                document.getElementById('iap_progress').innerHTML = `CRC Err: ${val2hex(crc_back, 2)} != ${val2hex(crc_ori, 2)}`;
                stop_iap();
                return;
            }
            document.getElementById('iap_progress').innerHTML = 'Succeeded with crc check.';
        
        } else if (check == "read") {
            let buf = await flash_read(addr, len);
            if (!buf) {
                document.getElementById('iap_progress').innerHTML = 'Read back failed.';
                stop_iap();
                return;
            }
            let crc_back = crc16(buf);
            if (crc_back != crc_ori) {
                document.getElementById('iap_progress').innerHTML = `CRC Err: ${val2hex(crc_back, 2)} != ${val2hex(crc_ori, 2)}`;
                stop_iap();
                return;
            }
            document.getElementById('iap_progress').innerHTML = 'Succeeded with read back check.';
        } else {
            document.getElementById('iap_progress').innerHTML = 'Succeeded without check.';
        }
    }
    
    if (action == 'bl_full' && document.getElementById('iap_start').disabled)
        await do_reboot();
    
    stop_iap();
};

async function init_iap() {
    csa.iap = {};
    csa.plugins.push('iap');
    
    document.getElementsByTagName('section')[0].insertAdjacentHTML('beforeend', html);
    
    let iap_cfg = await csa.db.get('tmp', `${csa.arg.name}/iap.cfg`);
    let path = document.getElementById('iap_path');
    let check = document.getElementById('iap_check');
    let action = document.getElementById('iap_action');
    
    let port = await alloc_port();
    console.log(`init_iap, alloc port: ${port}`);
    csa.iap.proxy_sock = new CDWebSocket(csa.ws_ns, port);
    
    if (iap_cfg) {
        path.value = iap_cfg.path;
        check.value = iap_cfg.check;
        action.value = iap_cfg.action;
    }
    
    path.onchange = check.onchange = action.onchange = async () => {
        await csa.db.set('tmp', `${csa.arg.name}/iap.cfg`, {
            path: path.value,
            check: check.value,
            action: action.value
        });
    };
    
    document.getElementById('iap_start').onclick = do_iap;
    document.getElementById('iap_stop').onclick = stop_iap;
}


export { init_iap };

