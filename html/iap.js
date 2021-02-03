/*
 * Software License Agreement (MIT License)
 *
 * Author: Duke Fong <d@d-l.io>
 */

import { L } from './lang/lang.js';
import { escape_html, date2num, val2hex, dat2str, dat2hex, hex2dat,
         read_file, download, readable_size, blob2dat } from './utils/helper.js';
import { Idb } from './utils/idb.js';
import { csa } from './ctrl.js';


async function flash_erase(addr, len) {
    let d = new Uint8Array(9);
    let dv = new DataView(d.buffer);
    d[0] = 0x2f;
    dv.setUint32(1, addr, true);
    dv.setUint32(5, len, true);
    
    await csa.proxy_sock.sendto({'dst': [csa.arg.tgt, 0x8], 'dat': d}, ['server', 'proxy']);
    console.log(`flash_erase wait ret, addr: ${val2hex(addr)}, len: ${(val2hex(len))}`);
    let ret = await csa.proxy_sock.recvfrom(1000);
    console.log('flash_erase ret', ret);
    if (ret && ret[0].dat[0] == 0x80) {
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
    
    await csa.proxy_sock.sendto({'dst': [csa.arg.tgt, 0x8], 'dat': d}, ['server', 'proxy']);
    console.log(`flash_write_blk wait ret, addr: ${val2hex(addr)}`);
    let ret = await csa.proxy_sock.recvfrom(1000);
    console.log('flash_write_blk ret', ret);
    if (ret && ret[0].dat[0] == 0x80) {
        return 0
    } else {
        console.log('flash_write_blk err');
        return -1;
    }
}

async function flash_write(addr, dat, blk_size=128) {
    let cur = addr;
    while (true) {
        let size = Math.min(blk_size, dat.length - (cur - addr));
        if (size == 0)
            return 0;
        let wdat = dat.slice(cur-addr, cur-addr+size);
        let ret = await flash_write_blk(cur, wdat);
        if (ret)
            return -1;
        cur += size;
        document.getElementById('iap_progress').innerHTML = `write ${Math.round((cur - addr) / dat.length * 100)}%`;
    }
}

async function flash_read_blk(addr, len) {
    let d = new Uint8Array(6);
    let dv = new DataView(d.buffer);
    d[0] = 0x00;
    dv.setUint32(1, addr, true);
    d[5] = len;
    
    await csa.proxy_sock.sendto({'dst': [csa.arg.tgt, 0x8], 'dat': d}, ['server', 'proxy']);
    console.log(`flash_read_blk wait ret, addr: ${val2hex(addr)}, len: ${len}`);
    let ret = await csa.proxy_sock.recvfrom(1000);
    console.log('flash_read_blk ret', ret);
    if (ret && ret[0].dat[0] == 0x80) {
        return ret[0].dat.slice(1);
    } else {
        console.log('flash_read_blk err');
        return null;
    }
}

async function flash_read(addr, len, blk_size=128) {
    let cur = addr;
    let buf = new Uint8Array(0);
    while (true) {
        let size = Math.min(blk_size, len - (cur - addr));
        if (size == 0)
            return buf;
        let ret = await flash_read_blk(cur, size);
        if (ret == null)
            return null;
        buf = Uint8Array.from([...buf, ...ret]);
        cur += size;
        document.getElementById('iap_progress').innerHTML = `read ${Math.round((cur - addr) / len * 100)}%`;
    }
}

async function flash_read_crc(addr, len) {
    let d = new Uint8Array(9);
    let dv = new DataView(d.buffer);
    d[0] = 0x10;
    dv.setUint32(1, addr, true);
    dv.setUint32(5, len, true);
    
    await csa.proxy_sock.sendto({'dst': [csa.arg.tgt, 0x8], 'dat': d}, ['server', 'proxy']);
    console.log(`flash_read_crc ret, addr: ${val2hex(addr)}, len: ${val2hex(len)}`);
    let ret = await csa.proxy_sock.recvfrom(1000);
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
    
    await csa.proxy_sock.sendto({'dst': [csa.arg.tgt, 0x5], 'dat': d}, ['server', 'proxy']);
    console.log('keep_in_bl wait ret');
    let ret = await csa.proxy_sock.recvfrom(1000);
    console.log('keep_in_bl ret', ret);
    if (ret && ret[0].dat[0] == 0x80) {
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
    
    await csa.proxy_sock.sendto({'dst': [csa.arg.tgt, 0x5], 'dat': d}, ['server', 'proxy']);
    console.log('reboot wait ret');
    let ret = await csa.proxy_sock.recvfrom(500);
    console.log('reboot ret', ret);
}


async function do_iap() {
    document.getElementById('iap_progress').innerHTML = '--';
    let path = document.getElementById('iap_path').value;
    if (!path) {
        alert('path empty');
        return;
    }
    
    await csa.cmd_sock.sendto({'action': 'get_bin', 'path': path}, ['server', 'file']);
    let dat = await csa.cmd_sock.recvfrom(1000);
    if (!dat || !dat[0].length) {
        alert('invalid bin file');
        return;
    }
    let len = dat[0].length;
    let crc_ori = crc16(dat[0]);
    let addr = csa.cfg.iap.addr;
    console.log(`get_bin, bin len: ${len}, crc: 0x${val2hex(crc_ori, 2)}`);
    
    if (await keep_in_bl()) {
        alert(`keep_in_bl failed`);
        return;
    }
    
    if (await flash_erase(addr, len)) {
        alert(`erase failed`);
        return;
    }
    
    if (await flash_write(addr, dat[0])) {
        alert(`write failed`);
        return;
    }
    
    let check = document.getElementById('iap_check').value;
    
    if (check == "crc") {
        let crc_back = await flash_read_crc(addr, len);
        if (crc_back != crc_ori) {
            alert(`read crc: ${val2hex(crc_back, 2)} != ${val2hex(crc_ori, 2)}`);
            return;
        }
        document.getElementById('iap_progress').innerHTML = 'Succeeded with crc check.';
        
    } else if (check == "read") {
        let buf = await flash_read(addr, len);
        if (!buf) {
            alert(`write failed`);
            return;
        }
        let crc_back = crc16(buf);
        if (crc_back != crc_ori) {
            alert(`read back: crc: ${val2hex(crc_back, 2)} != ${val2hex(crc_ori, 2)}`);
            return;
        }
        document.getElementById('iap_progress').innerHTML = 'Succeeded with read back check.';
    } else {
        document.getElementById('iap_progress').innerHTML = 'Succeeded without check.';
    }
    
    let reboot = document.getElementById('iap_reboot').checked;
    if (reboot)
        await do_reboot();
};

async function init_iap() {
    let iap_cfg = await csa.db.get('tmp', `iap_cfg.${csa.arg.name}`);
    let path = document.getElementById('iap_path');
    let check = document.getElementById('iap_check');
    let reboot = document.getElementById('iap_reboot');
    
    if (iap_cfg) {
        path.value = iap_cfg.path;
        check.value = iap_cfg.check;
        reboot.checked = iap_cfg.reboot;
    }
    
    path.onchange = check.onchange = reboot.onchange = async () => {
        await csa.db.set('tmp', `iap_cfg.${csa.arg.name}`, {
            path: path.value,
            check: check.value,
            reboot: reboot.checked
        });
    };
}


export { do_iap, init_iap };

