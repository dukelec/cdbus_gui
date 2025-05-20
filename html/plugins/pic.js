/*
 * Software License Agreement (MIT License)
 *
 * Author: Duke Fong <d@d-l.io>
 */

import { L } from '../utils/lang.js'
import { escape_html, date2num, timestamp, val2hex, dat2str, dat2hex, hex2dat,
         read_file, download, readable_size, blob2dat } from '../utils/helper.js';
//import { konva_zoom, konva_responsive } from '../utils/konva_helper.js';
import { CDWebSocket, CDWebSocketNS } from '../utils/cd_ws.js';
import { Idb } from '../utils/idb.js';
import { csa, alloc_port } from '../common.js';


async function pic_service() {
    let pic_cnt = 1;
    let img_dat = new Uint8Array(0);
    let dat_cnt = 0;
    
    while (true) {
        let msg = await csa.pic.sock.recvfrom();
        let dat = msg[0].dat.slice(0);
        let src_port = msg[0].src[1];
        let hdr = src_port; // [5:4] FRAGMENT: 00: error, 01: first, 10: more, 11: last, [3:0]: cnt
        
        if (hdr == 0x50) { // first
            img_dat = dat;
            dat_cnt = 0;
            console.log(`img: header ${dat[0]} ${dat[1]}`);
        
        } else if ((hdr & 0xf0) == 0x60) { // more
            if (dat_cnt == (hdr & 0xf)) {
                img_dat = Uint8Array.from([...img_dat, ...dat]);
            } else {
                console.warn(`pic, wrong cnt, local: ${dat_cnt} != rx: ${hdr & 0xf}, dat len: ${dat.length}`);
            }
            
        } else if ((hdr & 0xf0) == 0x70) { // end
            if (dat_cnt == (hdr & 0xf)) {
                img_dat = Uint8Array.from([...img_dat, ...dat]);
                // show pic
                document.getElementById('pic_id').src = URL.createObjectURL( new Blob([img_dat.buffer], { type: `image/${csa.cfg.pic.fmt}` }) );
                document.getElementById('pic_cnt').innerHTML = `- #${pic_cnt}`;
                pic_cnt++;
                // download(img_dat); // debug
                
            } else {
                console.warn(`pic, wrong cnt at end, local: ${dat_cnt} != rx: ${hdr & 0xf}, dat len: ${dat.length}`);
            }
        } else { // err
            console.warn(`pic, receive err, local: ${dat_cnt}, rx: ${hdr & 0xf}, all len: ${img_dat.length}`);
        }
        
        if (++dat_cnt == 0x10)
            dat_cnt = 0;
    }
}


async function init_pic() {
    if (!csa.cfg.pic || !csa.cfg.pic.port) {
        console.info(`skip init_pic`);
        return;
    }
    csa.pic = {};
    csa.plugins.push('pic');

    let port = await alloc_port(csa.cfg.pic.port);
    console.log(`init_pic, alloc port: ${port}`);
    csa.pic.sock = new CDWebSocket(csa.ws_ns, port);

    let html = `
        <div class="container" id="pic_show">
            <h2 class="title is-size-4">Picture <span class="is-size-6" id="pic_cnt">- #--</span></h2>
            <img id="pic_id" style="min-width: 320px; min-height: 240px; max-width: 100%;"></img>
            <br><br>
        </div>`;
    document.getElementsByTagName('section')[0].insertAdjacentHTML('beforeend', html);

    pic_service();
}

export { init_pic };

