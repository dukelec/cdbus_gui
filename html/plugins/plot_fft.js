/*
 * Software License Agreement (MIT License)
 *
 * Author: Duke Fong <d@d-l.io>
 */

import { csa } from '../common.js';
import Module from '../libs/kissfft.131.2.0.js';

let overlay = {
    print: text => {
        console.log('fft:', text);
    },
    printErr: text => {
        console.error("fft error:", text);
    },
    quit: status => {
        console.log("fft quit:", status);
    },
    setStatus: text => {
        console.log(`fft status: ${text}`);
    }
};


async function plot_fft(idx, dat) {
    const fft_mod = csa.plot.fft_mod;
    const fft_obj = csa.plot.plot_fft[idx];
    if (dat.length > fft_obj.size)
        dat = dat.slice(dat.length - fft_obj.size);
    
    const input_ptr = fft_mod._calloc(fft_obj.size, 4);
    fft_mod.HEAPF32.set(dat, input_ptr / 4);
    
    const out_len = fft_obj.size / 2 + 1;
    const output_ptr = fft_mod._malloc(out_len * 2 * 4);
    const output_heap = fft_mod.HEAPF32.subarray(output_ptr / 4, output_ptr / 4 + out_len * 2);
    
    fft_mod._kiss_fftr(fft_obj.kiss_cfg, input_ptr, output_ptr);
    
    const mags = new Array(out_len);
    const inv_n2 = 1 / (fft_obj.size * fft_obj.size);
    for (let k = 0; k < out_len; k++) {
        const re = output_heap[2*k];
        const im = output_heap[2*k+1];
        let pwr = (re*re + im*im) * inv_n2;
        mags[k] = 10 * Math.log10(Math.max(pwr, 1e-12));
    }

    fft_mod._free(input_ptr);
    fft_mod._free(output_ptr);
    return mags;
}


async function plot_fft_cal(idx, plot_dat) {
    let fft_obj = csa.plot.plot_fft[idx];
    const out_len = fft_obj.size / 2 + 1;
    const rate = fft_obj.sample_rate;
    const freqs = new Array(out_len);
    for (let k = 0; k < out_len; k++)
        freqs[k] = k * rate / fft_obj.size;
    
    let fft_dat = [freqs];
    for (let i = 1; i < plot_dat.length; i++) {
        let mags = await plot_fft(idx, plot_dat[i]);
        fft_dat.push(mags);
    }
    return fft_dat;
}


async function plot_fft_init(idx) {
    if (!csa.plot.fft_mod)
        csa.plot.fft_mod = await Module(overlay);
    
    let fft_obj = csa.plot.plot_fft[idx];
    if (csa.cfg.plot.plots[idx].fft) {
        fft_obj.size = csa.cfg.plot.plots[idx].fft.size;
        fft_obj.sample_rate = csa.cfg.plot.plots[idx].fft.sample_rate;
    }
    if (!fft_obj.size)
        fft_obj.size = 4096;
    if (!fft_obj.sample_rate)
        fft_obj.sample_rate = 1;
    fft_obj.kiss_cfg = csa.plot.fft_mod._kiss_fftr_alloc(fft_obj.size, 0, null, null);
}

function plot_fft_deinit(idx) {
    let fft_obj = csa.plot.plot_fft[idx];
    if (fft_obj.kiss_cfg)
        csa.plot.fft_mod._free(fft_obj.kiss_cfg);
    fft_obj.kiss_cfg = null;
}


export {
    plot_fft_init, plot_fft_deinit, plot_fft_cal
};
