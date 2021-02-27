/*
 * Software License Agreement (MIT License)
 *
 * Author: Duke Fong <d@d-l.io>
 */

import { L } from './lang/lang.js';
import { sleep, escape_html, date2num, val2hex, dat2str, dat2hex, hex2dat,
         read_file, download, readable_size, blob2dat } from './utils/helper.js';
import { Idb } from './utils/idb.js';
import { csa } from './ctrl.js';


async function flash_erase(addr, len) {
    let d = new Uint8Array(9);
    let dv = new DataView(d.buffer);
    d[0] = 0x2f;
    dv.setUint32(1, addr, true);
    dv.setUint32(5, len, true);
    
    csa.proxy_sock_iap.flush();
    await csa.proxy_sock_iap.sendto({'dst': [csa.arg.tgt, 0x8], 'dat': d}, ['server', 'proxy']);
    console.log(`flash_erase wait ret, addr: ${val2hex(addr)}, len: ${(val2hex(len))}`);
    let ret = await csa.proxy_sock_iap.recvfrom(5000);
    console.log('flash_erase ret', ret);
    if (ret && ret[0].dat.length == 1 && ret[0].dat[0] == 0x80) {
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
    
    csa.proxy_sock_iap.flush();
    await csa.proxy_sock_iap.sendto({'dst': [csa.arg.tgt, 0x8], 'dat': d}, ['server', 'proxy']);
    console.log(`flash_write_blk wait ret, addr: ${val2hex(addr)}`);
    let ret = await csa.proxy_sock_iap.recvfrom(500);
    console.log('flash_write_blk ret', ret);
    if (ret && ret[0].dat.length == 1 && ret[0].dat[0] == 0x80) {
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
    
    csa.proxy_sock_iap.flush();
    await csa.proxy_sock_iap.sendto({'dst': [csa.arg.tgt, 0x8], 'dat': d}, ['server', 'proxy']);
    console.log(`flash_read_blk wait ret, addr: ${val2hex(addr)}, len: ${len}`);
    let ret = await csa.proxy_sock_iap.recvfrom(500);
    console.log('flash_read_blk ret', ret);
    if (ret && ret[0].dat[0] == 0x80 && ret[0].dat.length == len + 1) {
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
    
    csa.proxy_sock_iap.flush();
    await csa.proxy_sock_iap.sendto({'dst': [csa.arg.tgt, 0x8], 'dat': d}, ['server', 'proxy']);
    console.log(`flash_read_crc ret, addr: ${val2hex(addr)}, len: ${val2hex(len)}`);
    let ret = await csa.proxy_sock_iap.recvfrom(500);
    console.log('flash_read_crc', ret);
    if (ret && ret[0].dat[0] == 0x80) {
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
    
    csa.proxy_sock_iap.flush();
    await csa.proxy_sock_iap.sendto({'dst': [csa.arg.tgt, 0x5], 'dat': d}, ['server', 'proxy']);
    console.log('keep_in_bl wait ret');
    let ret = await csa.proxy_sock_iap.recvfrom(200);
    console.log('keep_in_bl ret', ret);
    if (ret && ret[0].dat.length == 1 && ret[0].dat[0] == 0x80) {
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
    
    csa.proxy_sock_iap.flush();
    await csa.proxy_sock_iap.sendto({'dst': [csa.arg.tgt, 0x5], 'dat': d}, ['server', 'proxy']);
    console.log('reboot wait ret');
    let ret = await csa.proxy_sock_iap.recvfrom(200);
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
    
    if (!path) {
        alert('path empty');
        stop_iap();
        return;
    }
    
    csa.cmd_sock.flush();
    await csa.cmd_sock.sendto({'action': 'get_ihex', 'path': path}, ['server', 'file']);
    let msg = await csa.cmd_sock.recvfrom(500);
    if (!msg || !msg[0].length) {
        alert('invalid ihex file');
        stop_iap();
        return;
    }
    console.log(`get_ihex:`, msg[0]);
    
    let retry_cnt = 0;
    while (action.startsWith('bl') && document.getElementById('iap_start').disabled) {
    
        csa.proxy_sock_iap.flush();
        await csa.proxy_sock_iap.sendto({'dst': [csa.arg.tgt, 0x1], 'dat': new Uint8Array([0x00])}, ['server', 'proxy']);
        console.log('read info wait ret');
        let ret = await csa.proxy_sock_iap.recvfrom(200);
        console.log('read info ret', ret);
        if (ret) {
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
            }
        } else {
            console.log('read info time out');
            document.getElementById('iap_progress').innerHTML = `Read info, retry cnt: ${retry_cnt}`;
            continue;
        }
        retry_cnt++;
        await sleep(100);
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
    
    for (let idx = 0; idx < msg[0].length; idx++) {
        if (action == "bl" || !document.getElementById('iap_start').disabled)
            break;
        let seg = msg[0][idx];
        let addr = seg[0];
        let dat = seg[1];
        let len = dat.length;
        let crc_ori = crc16(dat);
        document.getElementById('iap_epoch').innerHTML = `[${idx+1}/${msg[0].length}]`;
        
        document.getElementById('iap_progress').innerHTML = `Erasing...`;
        if (await flash_erase(addr, len)) {
            document.getElementById('iap_progress').innerHTML = `Erase failed`;
            stop_iap();
            return;
        }
        
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
    let iap_cfg = await csa.db.get('tmp', `iap_cfg.${csa.arg.name}`);
    let path = document.getElementById('iap_path');
    let check = document.getElementById('iap_check');
    let action = document.getElementById('iap_action');
    
    if (iap_cfg) {
        path.value = iap_cfg.path;
        check.value = iap_cfg.check;
        action.value = iap_cfg.action;
    }
    
    path.onchange = check.onchange = action.onchange = async () => {
        await csa.db.set('tmp', `iap_cfg.${csa.arg.name}`, {
            path: path.value,
            check: check.value,
            action: action.value
        });
    };
}


document.getElementById('iap_start').onclick = do_iap;
document.getElementById('iap_stop').onclick = stop_iap;

export { init_iap };

