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
    return new TextDecoder().decode(dat);
}

function str2dat(str) {
    let encoder = new TextEncoder();
    return encoder.encode(str);
}

function val2hex(val, fixed=4, upper=false) {
    let str = upper ? val.toString(16).toUpperCase() : val.toString(16);
    if (str.length < fixed)
        str = '0'.repeat(fixed - str.length) + str;
    return str;
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

// https://stackoverflow.com/questions/47157428/how-to-implement-a-pseudo-blocking-async-queue-in-js-ts
class Queue {
    constructor() {
        // invariant: at least one of the arrays is empty
        this.resolvers = [];
        this.promises = [];
    }
    _add() {
        this.promises.push(new Promise(resolve => {
            this.resolvers.push(resolve);
        }));
    }
    put(t) {
        // if (this.resolvers.length) this.resolvers.shift()(t);
        // else this.promises.push(Promise.resolve(t));
        if (!this.resolvers.length)
            this._add();
        this.resolvers.shift()(t);
    }
    async get(timeout=null) {
        if (!this.promises.length)
            this._add();
        var p = this.promises.shift();
        var t;
        if (timeout) {
            t = setTimeout(this.put.bind(this), timeout, null); // unit: ms
        }
        var ret_val = await p;
        if (timeout)
            clearTimeout(t);
        return ret_val;
    }
    
    // now some utilities:
    empty() { // there are no values available
        return !this.promises.length; // this.length == 0
    }
    is_blocked() { // it's waiting for values
        return !!this.resolvers.length; // this.length < 0
    }
    qsize() {
        return this.promises.length - this.resolvers.length;
    }
    flush() {
        this.resolvers = [];
        this.promises = [];
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

export {
    sleep, read_file, load_img, date2num, timestamp,
    sha256, aes256,
    dat2hex, hex2dat, dat2str, str2dat, val2hex,
    cpy, Queue,
    download,
    escape_html, readable_size,
    blob2dat
};
