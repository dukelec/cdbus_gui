/*
 * Software License Agreement (MIT License)
 *
 * Author: Duke Fong <d@d-l.io>
 */

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function read_file(file) {
    return await new Promise((resolve, reject) => {
        let reader = new FileReader();

        reader.onload = () => {
            resolve(new Uint8Array(reader.result));
        };
        reader.onerror = reject;
        reader.readAsArrayBuffer(file);
    })
}

async function load_img(img, url) {
    let ret = -1;
    await new Promise(resolve => {
        img.src = url;
        img.onload = () => { ret = 0; resolve(); };
        img.onerror = () => { console.error(`load_img: ${url}`); resolve(); };
    });
    return ret;
}

function date2num() {
    let d = (new Date()).toLocaleString('en-GB');
    let s = d.split(/[^0-9]/);
    return `${s[2]}${s[1]}${s[0]}${s[4]}${s[5]}${s[6]}`;
}

function timestamp() {
    let date = new Date();
    let time = date.toLocaleString('en-GB');
    return time.split(' ')[1] + '.' + String(date.getMilliseconds()).padStart(3, '0');
}

async function sha256(dat) {
    const hashBuffer = await crypto.subtle.digest('SHA-256', dat);
    return new Uint8Array(hashBuffer);
}

async function aes256(dat, key, type='encrypt') {
    let iv = new Uint8Array(16); // zeros
    let _key = await crypto.subtle.importKey('raw', key, {name: 'AES-CBC'}, false, ['encrypt', 'decrypt']);

    if (type == 'encrypt')
        return new Uint8Array(await crypto.subtle.encrypt({name: 'AES-CBC', iv: iv}, _key, dat));
    else
        return new Uint8Array(await crypto.subtle.decrypt({name: 'AES-CBC', iv: iv}, _key, dat));
}

function dat2hex(dat, join='', le=false) {
    let dat_array = Array.from(dat);
    if (le)
        dat_array = dat_array.reverse();
    return dat_array.map(b => b.toString(16).padStart(2, '0')).join(join);
}

function hex2dat(hex, le=false) {
    hex = hex.replace('0x', '').replace(/\s/g,'')
    let ret = new Uint8Array(hex.match(/.{1,2}/g).map(byte => parseInt(byte, 16)));
    if (le)
        return ret.reverse();
    return ret;
}

function dat2str(dat) {
    if (dat.indexOf(0) >= 0)
        dat = dat.slice(0, dat.indexOf(0));
    return new TextDecoder().decode(dat);
}

function str2dat(str) {
    let encoder = new TextEncoder();
    return encoder.encode(str);
}

function val2hex(val, fixed=4, prefix=false, upper=false, float=false) {
    let sign = Math.sign(val);
    val = Math.abs(val);
    let str = upper ? val.toString(16).toUpperCase() : val.toString(16);
    let arr = str.split('.');
    if (arr[0].length < fixed)
        arr[0] = '0'.repeat(fixed - arr[0].length) + arr[0];
    if (prefix)
        arr[0] = '0x' + arr[0];
    if (sign == -1)
        arr[0] = '-' + arr[0];
    if (float && arr.length == 1)
        arr.push('0');
    return arr.join('.');
}

// list: ['x', 'y']
// map: {'rotation': 'r'}
function cpy(dst, src, list, map = {}) {
    for (let i of list) {
        if (i in src)
            dst[i] = src[i];
    }
    for (let i in map) {
        if (i in src)
            dst[map[i]] = src[i];
    }
}

class Queue {
    constructor() {
        this.fifo = [];
        this.wakeup = null;
    }
    
    put(t) {
        this.fifo.push(t);
        if (this.wakeup)
            this.wakeup();
    }
    
    async get(timeout=null) {
        if (this.fifo.length)
            return this.fifo.shift();
        if (timeout == 0)
            return null;
        
        let p = new Promise(resolve => { this.wakeup = resolve; });
        let t;
        if (timeout)
            t = setTimeout(() => { this.wakeup(); }, timeout, null); // unit: ms
        
        await p;
        
        this.wakeup = null;
        if (timeout)
            clearTimeout(t);
        if (this.fifo.length)
            return this.fifo.shift();
        return null;
    }
    
    // now some utilities:
    size() {
        return this.fifo.length;
    }
    flush() {
        this.fifo = [];
        if (this.wakeup)
            this.wakeup();
        this.wakeup = null;
    }
}

function download_url(data, fileName) {
    var a;
    a = document.createElement('a');
    a.href = data;
    a.download = fileName;
    document.body.appendChild(a);
    a.style = 'display: none';
    a.click();
    a.remove();
};

function download(data, fileName='dat.bin', mimeType='application/octet-stream') {
    var blob, url;
    blob = new Blob([data], {type: mimeType});
    url = window.URL.createObjectURL(blob);
    download_url(url, fileName);
    setTimeout(function() { return window.URL.revokeObjectURL(url); }, 1000);
};

function escape_html(unsafe) {
    return unsafe
         .replace(/&/g, "&amp;")
         .replace(/</g, "&lt;")
         .replace(/>/g, "&gt;")
         .replace(/"/g, "&quot;")
         .replace(/'/g, "&#039;");
}

function readable_size(bytes, fixed=3, si=true) {
    var thresh = si ? 1000 : 1024;
    if(Math.abs(bytes) < thresh) {
        return bytes + ' B';
    }
    var units = si
        ? ['kB','MB','GB','TB','PB','EB','ZB','YB']
        : ['KiB','MiB','GiB','TiB','PiB','EiB','ZiB','YiB'];
    var u = -1;
    do {
        bytes /= thresh;
        ++u;
    } while(Math.abs(bytes) >= thresh && u < units.length - 1);
    return bytes.toFixed(fixed)+' '+units[u];
}

function readable_float(num, double=false) {
    if (!isFinite(num))
        return num.toString();
    let fixed = 12;
    if (!double)
        num = parseFloat(num.toPrecision(7)); // for 32-bit float
    let n = num.toFixed(fixed);
    if (n.indexOf('e') != -1)
        return n;
    for (let i = 0; i < fixed / 3; i++) {
        if (n.endsWith('000'))
            n = n.slice(0, n.length - 3);
        else
            break;
    }
    if (n.endsWith('.'))
        n += '0';
    return n;
}

async function blob2dat(blob) {
    let ret;
    await new Promise(resolve => {
        new Response(blob).arrayBuffer().then(buf => {
            ret = new Uint8Array(buf);
            resolve();
        });
    });
    return ret;
}

function compare_dat(a, b) {
    if (a.length !== b.length)
        return -1;
    for (let i = 0; i < a.length; i++) {
        if (a[i] !== b[i])
            return i;
    }
    return null;
}

function dat_append(dat0, dat1) {
    let dat = new Uint8Array(dat0.length + dat1.length);
    dat.set(dat0);
    dat.set(dat1, dat0.length);
    return dat;
}


// modbus crc
const crc16_table = [
    0x0000, 0xc0c1, 0xc181, 0x0140, 0xc301, 0x03c0, 0x0280, 0xc241,
    0xc601, 0x06c0, 0x0780, 0xc741, 0x0500, 0xc5c1, 0xc481, 0x0440,
    0xcc01, 0x0cc0, 0x0d80, 0xcd41, 0x0f00, 0xcfc1, 0xce81, 0x0e40,
    0x0a00, 0xcac1, 0xcb81, 0x0b40, 0xc901, 0x09c0, 0x0880, 0xc841,
    0xd801, 0x18c0, 0x1980, 0xd941, 0x1b00, 0xdbc1, 0xda81, 0x1a40,
    0x1e00, 0xdec1, 0xdf81, 0x1f40, 0xdd01, 0x1dc0, 0x1c80, 0xdc41,
    0x1400, 0xd4c1, 0xd581, 0x1540, 0xd701, 0x17c0, 0x1680, 0xd641,
    0xd201, 0x12c0, 0x1380, 0xd341, 0x1100, 0xd1c1, 0xd081, 0x1040,
    0xf001, 0x30c0, 0x3180, 0xf141, 0x3300, 0xf3c1, 0xf281, 0x3240,
    0x3600, 0xf6c1, 0xf781, 0x3740, 0xf501, 0x35c0, 0x3480, 0xf441,
    0x3c00, 0xfcc1, 0xfd81, 0x3d40, 0xff01, 0x3fc0, 0x3e80, 0xfe41,
    0xfa01, 0x3ac0, 0x3b80, 0xfb41, 0x3900, 0xf9c1, 0xf881, 0x3840,
    0x2800, 0xe8c1, 0xe981, 0x2940, 0xeb01, 0x2bc0, 0x2a80, 0xea41,
    0xee01, 0x2ec0, 0x2f80, 0xef41, 0x2d00, 0xedc1, 0xec81, 0x2c40,
    0xe401, 0x24c0, 0x2580, 0xe541, 0x2700, 0xe7c1, 0xe681, 0x2640,
    0x2200, 0xe2c1, 0xe381, 0x2340, 0xe101, 0x21c0, 0x2080, 0xe041,
    0xa001, 0x60c0, 0x6180, 0xa141, 0x6300, 0xa3c1, 0xa281, 0x6240,
    0x6600, 0xa6c1, 0xa781, 0x6740, 0xa501, 0x65c0, 0x6480, 0xa441,
    0x6c00, 0xacc1, 0xad81, 0x6d40, 0xaf01, 0x6fc0, 0x6e80, 0xae41,
    0xaa01, 0x6ac0, 0x6b80, 0xab41, 0x6900, 0xa9c1, 0xa881, 0x6840,
    0x7800, 0xb8c1, 0xb981, 0x7940, 0xbb01, 0x7bc0, 0x7a80, 0xba41,
    0xbe01, 0x7ec0, 0x7f80, 0xbf41, 0x7d00, 0xbdc1, 0xbc81, 0x7c40,
    0xb401, 0x74c0, 0x7580, 0xb541, 0x7700, 0xb7c1, 0xb681, 0x7640,
    0x7200, 0xb2c1, 0xb381, 0x7340, 0xb101, 0x71c0, 0x7080, 0xb041,
    0x5000, 0x90c1, 0x9181, 0x5140, 0x9301, 0x53c0, 0x5280, 0x9241,
    0x9601, 0x56c0, 0x5780, 0x9741, 0x5500, 0x95c1, 0x9481, 0x5440,
    0x9c01, 0x5cc0, 0x5d80, 0x9d41, 0x5f00, 0x9fc1, 0x9e81, 0x5e40,
    0x5a00, 0x9ac1, 0x9b81, 0x5b40, 0x9901, 0x59c0, 0x5880, 0x9841,
    0x8801, 0x48c0, 0x4980, 0x8941, 0x4b00, 0x8bc1, 0x8a81, 0x4a40,
    0x4e00, 0x8ec1, 0x8f81, 0x4f40, 0x8d01, 0x4dc0, 0x4c80, 0x8c41,
    0x4400, 0x84c1, 0x8581, 0x4540, 0x8701, 0x47c0, 0x4680, 0x8641,
    0x8201, 0x42c0, 0x4380, 0x8341, 0x4100, 0x81c1, 0x8081, 0x4040
];

function crc16(data, crc_val=0xffff) {
    for (let i = 0; i < data.length; i++) {
        let tmp = (data[i] ^ crc_val) & 0xff;
        crc_val = (crc_val >> 8) ^ crc16_table[tmp];
    }
    return crc_val;
}


export {
    sleep, read_file, load_img, date2num, timestamp,
    sha256, aes256,
    dat2hex, hex2dat, dat2str, str2dat, val2hex,
    cpy, Queue,
    download,
    escape_html, readable_size, readable_float,
    blob2dat, compare_dat, dat_append, crc16
};
