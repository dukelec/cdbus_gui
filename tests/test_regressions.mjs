// Run with: node tests/test_regressions.mjs
// Evaluate project modules with simulated DOM and transport; no vendor code is loaded.
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
function source(file) {
    return fs.readFileSync(`${root}/${file}`, 'utf8')
        .replace(/^import\s+[\s\S]*?from\s+['"][^'"]+['"];?\s*$/gm, '')
        .replace(/^export\s*\{[\s\S]*?\};?\s*$/gm, '');
}
const silent = { log() {}, info() {}, warn() {}, error() {} };
function context(extra = {}) {
    return vm.createContext({ console: silent, L: x => x, Uint8Array, DataView,
        TextEncoder, TextDecoder, setTimeout: () => 1, clearTimeout() {}, ...extra });
}
const constants = { R_ADDR: 0, R_LEN: 1, R_FMT: 2, R_SHOW: 3, R_ID: 4, R_DESC: 5 };
const tick = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };

test('disabling a register clears Enter without breaking the remaining group', async () => {
    const elm = {};
    for (const id of ['a', 'b']) {
        elm[`reg.${id}`] = { style: {} };
        elm[`reg_btn_w.${id}`] = { style: {} };
    }
    const csa = { cfg: { reg: { list: [[0,1,'B',0,'a'], [1,1,'B',0,'b']] } },
        reg: { elm, reg_w: [[0,1], [1,1]] } };
    const writes = [];
    const ctx = context({ ...constants, csa, write_reg_val: async i => writes.push(csa.reg.reg_w[i][0]) });
    vm.runInContext(source('html/plugins/reg.js'), ctx);
    vm.runInContext("update_reg_rw_btn('w')", ctx);
    csa.reg.reg_w = [[1,1]];
    vm.runInContext("update_reg_rw_btn('w')", ctx);
    assert.equal(elm['reg_btn_w.a'].onclick, null);
    assert.equal(elm['reg.a'].onkeydown, null);
    await elm['reg.b'].onkeydown({ keyCode: 13 });
    assert.deepEqual(writes, [1]);
});

test('toggling periodic reads during a pending round keeps one timer', async () => {
    const timers = new Map();
    let seq = 0;
    const pending = [];
    const nodes = { keep_read: { checked: true }, read_period: { value: '200' },
        dev_read_all: { onclick: () => new Promise(r => pending.push(r)) } };
    const ctx = context({ document: { getElementById: id => nodes[id] },
        setTimeout: fn => { timers.set(++seq, fn); return seq; }, clearTimeout: id => timers.delete(id) });
    vm.runInContext(source('html/plugins/reg.js'), ctx);
    const first = vm.runInContext('period_read()', ctx);
    nodes.keep_read.checked = false;
    await vm.runInContext('period_read()', ctx);
    nodes.keep_read.checked = true;
    const second = vm.runInContext('period_read()', ctx);
    pending.forEach(r => r());
    await Promise.all([first, second]);
    assert.equal(pending.length, 1);
    assert.equal(timers.size, 1);
    nodes.keep_read.checked = false;
    await vm.runInContext('period_read()', ctx);
    assert.equal(timers.size, 0);
});

test('write uses the validated snapshot when the input changes during read-before-write', async () => {
    let release;
    let recvCount = 0;
    const sent = [];
    const elem = { value: '5', style: {} };
    const sock = { flush() {}, async sendto(msg) { sent.push([...msg.dat]); },
        recvfrom() { return ++recvCount === 1 ? new Promise(r => release = r) : Promise.resolve([{ dat: new Uint8Array([0]) }]); } };
    const csa = { arg: { tgt: '80:00:01' }, cfg: { reg: { list: [[0,1,'B',0,'x','',[0,10]]] } },
        reg: { reg_w: [[0,1]], reg_rbw: [], elm: { 'reg.x': elem }, proxy_sock_regw: sock } };
    const ctx = context({ csa, document: { getElementById: () => ({ checked: false }) } });
    vm.runInContext(source('html/utils/helper.js') + source('html/plugins/reg_rw.js'), ctx);
    const done = vm.runInContext('write_reg_val(0, false)', ctx);
    await tick();
    elem.value = '250';
    release([{ dat: new Uint8Array([0,0]) }]);
    assert.equal(await done, 0);
    assert.deepEqual(sent[1], [0x20,0,0,5]);
});

test('both plots refresh and respect buffer limits when packets arrive together', async () => {
    const timers = [];
    const messages = [];
    let receiver;
    const counts = [0,0];
    const csa = { cfg: { plot: { plots: [{},{}] } }, plot: {
        fmt: ['B.B','B.B'], dat: [[[],[]],[[],[]]], x_ofs: [0,0], cal_fn: [[],[]], brk: [[],[]], raw: [[],[]],
        parse_dat_len_bk: [[],[]], plot_max_len: [1,1], plot_less_en: [], plot_fft_en: [],
        plots: [0,1].map(i => ({ setData() { counts[i]++; } })),
        dbg_raw_sock: { recvfrom: () => messages.length ? Promise.resolve(messages.shift()) : new Promise(r => receiver = r) }
    } };
    const ctx = context({ ...constants, csa, setTimeout: fn => { timers.push(fn); return timers.length; } });
    vm.runInContext(source('html/plugins/reg_rw.js') + source('html/plugins/plot.js'), ctx);
    vm.runInContext('dbg_raw_service()', ctx);
    for (let t = 1; t <= 3; t++) {
        receiver([{ dat: new Uint8Array([t,7]), src: ['dev',0] }]);
        await tick();
        receiver([{ dat: new Uint8Array([t,8]), src: ['dev',1] }]);
        await tick();
        while (timers.length)
            await timers.shift()();
    }
    assert.deepEqual(counts, [3,3]);
    assert.equal(csa.plot.dat[1][0].length, 1);
});

function writer(regs, values, groups, initial) {
    const sent = [];
    const sock = { flush() {}, async sendto(msg) { sent.push([...msg.dat]); },
        async recvfrom() { return [{ dat: new Uint8Array([0]) }]; } };
    const csa = { arg: { tgt: '80:00:01' }, cfg: { reg: { list: regs } },
        reg: { reg_w: groups, reg_rbw: [new Uint8Array(initial)],
            elm: Object.fromEntries(Object.entries(values).map(([key, value]) => [key, { value, style: {} }])),
            proxy_sock_regw: sock } };
    const ctx = context({ csa, document: { getElementById: () => ({ checked: false }) } });
    vm.runInContext(source('html/utils/helper.js') + source('html/plugins/reg_rw.js'), ctx);
    return { csa, sent, ctx };
}

test('short raw-byte arrays report an input error without sending a request', async () => {
    const { csa, sent, ctx } = writer([[0,2,'[B]',2,'x']], { 'reg.x': 'aa' }, [[0,2]], [0,0]);
    csa.reg.reg_rbw = []; // invalid input must not even start read-before-write
    assert.equal(await vm.runInContext('write_reg_val(0, false)', ctx), -1);
    assert.match(csa.reg.last_err, /expected 2 values, got 1/);
    assert.equal(sent.length, 0);
});

test('valid raw bytes accept repeated whitespace and encode every byte', async () => {
    const { sent, ctx } = writer([[0,2,'[B]',2,'x']], { 'reg.x': ' aa \t bb ' }, [[0,2]], [0,0]);
    assert.equal(await vm.runInContext('write_reg_val(0, false)', ctx), 0);
    assert.deepEqual(sent, [[0x20,0,0,0xaa,0xbb]]);
});

test('snapshot packing preserves gaps, struct padding, numeric arrays and UTF-8 strings', async () => {
    const regs = [[0,8,'{H,B2}',0,'s'], [10,4,'[H]',0,'a'], [14,4,'[c]',0,'text']];
    const values = { 'reg.s.0': '258 3', 'reg.s.1': '1029 6', 'reg.a': '7 8', 'reg.text': '中' };
    const initial = Array(18).fill(0xee);
    const { sent, ctx } = writer(regs, values, [[0,18]], initial);
    assert.equal(await vm.runInContext('write_reg_val(0, false)', ctx), 0);
    assert.deepEqual(sent[0], [0x20,0,0, 2,1,3,0xee, 5,4,6,0xee, 0xee,0xee, 7,0,8,0, 0xe4,0xb8,0xad,0]);
});

test('empty text arrays can still be cleared', async () => {
    const { sent, ctx } = writer([[0,2,'[c]',0,'text']], { 'reg.text': '' }, [[0,2]], [65,66]);
    assert.equal(await vm.runInContext('write_reg_val(0, false)', ctx), 0);
    assert.deepEqual(sent[0], [0x20,0,0,0,0]);
});

test('out-of-range values are rejected before sending', async () => {
    const { csa, sent, ctx } = writer([[0,1,'B',0,'x','',[0,10]]], { 'reg.x': '250' }, [[0,1]], [0]);
    assert.equal(await vm.runInContext('write_reg_val(0, false)', ctx), -1);
    assert.match(csa.reg.last_err, /outside/);
    assert.equal(sent.length, 0);
});

test('stopping during a pending periodic read prevents rescheduling', async () => {
    let release;
    const timers = [];
    const nodes = { keep_read: { checked: true }, read_period: { value: '200' },
        dev_read_all: { onclick: () => new Promise(r => release = r) } };
    const ctx = context({ document: { getElementById: id => nodes[id] }, setTimeout: fn => timers.push(fn) });
    vm.runInContext(source('html/plugins/reg.js'), ctx);
    const pending = vm.runInContext('period_read()', ctx);
    nodes.keep_read.checked = false;
    await vm.runInContext('period_read()', ctx);
    release();
    await pending;
    assert.equal(timers.length, 0);
});

test('periodic reads recover after read or saved-period lookup errors', async () => {
    for (const readFails of [true, false]) {
        const timers = [];
        const nodes = { keep_read: { checked: true }, read_period: { value: '' },
            dev_read_all: { async onclick() { if (readFails) throw Error('read failed'); } } };
        const ctx = context({ document: { getElementById: id => nodes[id] },
            csa: { arg: { name: 'test' }, db: { async get() { throw Error('storage failed'); } } },
            setTimeout: (fn, ms) => timers.push({ fn, ms }) });
        vm.runInContext(source('html/plugins/reg.js'), ctx);
        await vm.runInContext('period_read()', ctx);
        assert.equal(timers.length, 1);
        assert.equal(timers[0].ms, 200);
        assert.equal(vm.runInContext('read_running', ctx), false);
    }
});

test('device initialization displays config errors without initializing plugins', async () => {
    let ws;
    const banners = [];
    const csa = { arg: { tgt: '80:00:01', cfg: 'bad.json' }, ws_ns: { connections: {} },
        cmd_sock: { flush() {}, async sendto() {}, async recvfrom() { return ['err: <bad config>']; } } };
    const ctx = context({ csa,
        document: { getElementById: () => ({}) },
        window: { location: { hostname: 'localhost', port: '8910' }, addEventListener() {} },
        WebSocket: class { constructor() { ws = this; } },
        show_banner: (id, message) => banners.push(message),
        init_sys: () => assert.fail('initialization must stop on error') });
    vm.runInContext(source('html/utils/helper.js') + source('html/ctrl.js'), ctx);
    vm.runInContext('init_ws()', ctx);
    await ws.onopen();
    assert.deepEqual(banners, ['<b>err: &lt;bad config&gt;</b>']);
    assert.equal(csa.cfg, undefined);
});

test('Re-Calc displays config errors and retains the current plot config', async () => {
    const errors = [];
    const cfg = { cal: { derived: '1' } };
    const csa = { arg: { cfg: 'bad.json' }, cfg: { plot: { plots: [cfg] } },
        plot: { proxy_sock: { flush() {}, async sendto() {}, async recvfrom() { return ['err: invalid json']; } } } };
    const ctx = context({ csa, show_cfg_error: message => errors.push(message) });
    vm.runInContext(source('html/plugins/plot.js'), ctx);
    await vm.runInContext('plot_cal_update(0)', ctx);
    assert.deepEqual(errors, ['err: invalid json']);
    assert.equal(csa.cfg.plot.plots[0], cfg);
});

test('a reg_overlay on a register missing from the list is reported when the plot config loads', () => {
    const list = [[0x26,16,'{H,H}',1,'dbg_raw[0]',''], [0x78,4,'f',0,'pid_pos_kp',''], [0x2cc,4,'i',0,'cur_pos','']];
    const plot = overlay => ({ reg_overlay: overlay,
        plots: [{ cfg_reg: 'dbg_raw[0]', x_fmt: 'H1', label: ['N', 'pid target', 'i_term', 'cur_pos'] }] });
    const csa = { cfg: { reg: { list } }, plot: { fmt: [], label: [[]], reg_val: [] } };
    const ctx = context({ ...constants, csa });
    vm.runInContext(source('html/plugins/reg_rw.js') + source('html/plugins/plot_reg_w.js'), ctx);
    csa.cfg.plot = plot([['pid_pos_ki',20,4,'i','pid target'], ['pid_pos_ki',24,4,'f','i_term']]);
    assert.equal(vm.runInContext('plot_reg_w_init(0)', ctx), 'data register not found: pid target (reg_overlay: pid_pos_ki)');
    assert.equal(csa.plot.fmt[0], '');
    assert.equal(csa.plot.reg_val[0], null);
    csa.cfg.plot = plot([['pid_pos_kp',24,4,'i','pid target'], ['pid_pos_kp',28,4,'f','i_term']]);
    csa.plot.label = [[]];
    assert.equal(vm.runInContext('plot_reg_w_init(0)', ctx), null);
    assert.equal(csa.plot.fmt[0], 'H1.ifi');
    assert.deepEqual(Array.from(csa.plot.reg_val[0], r => r[0]), [0x90, 0x2cc]);
});

test('a plot whose channels did not resolve still gets an empty chart', () => {
    const csa = { cfg: { plot: { plots: [{ label: ['N', 'pid target'] }] } },
        plot: { fmt: [''], label: [[]], cal_fn: [], dat: [] } };
    const ctx = context({ ...constants, csa });
    vm.runInContext(source('html/plugins/reg_rw.js') + source('html/plugins/plot.js'), ctx);
    assert.equal(vm.runInContext('plot_init_series(0)', ctx).length, 1);
    assert.equal(csa.plot.dat[0].length, 1);
});

test('the legend names NaN and ±Infinity behind a gap, and formula NaN is kept for it', () => {
    const csa = { plot: { raw: [[[0,1,2,3,4], [1.5, NaN, Infinity, -Infinity, null]]], cal_fn: [[
        _d => NaN, _d => _d[9].at(-1), _d => 2 ]], cal_error_reported: [false] } };
    const ctx = context({ ...constants, csa });
    vm.runInContext(source('html/utils/helper.js') + source('html/plugins/reg_rw.js') + source('html/plugins/plot.js'), ctx);
    const legend = i => vm.runInContext(`plot_legend_val(0, ${i == 0 ? 1.5 : 'null'}, 1, ${i})`, ctx);
    assert.deepEqual([0, 1, 2, 3, 4].map(legend), ['1.500', 'NaN', 'Infinity', '-Infinity', null]);
    assert.equal(vm.runInContext('plot_legend_val(0, null, 1, null)', ctx), null); // cursor off the plot
    csa.plot.dat = [[[0], [], [], [], [], []]];
    csa.plot.dat[0][9] = [];
    vm.runInContext('append_cal_val(0, 1)', ctx);
    assert.ok(Number.isNaN(csa.plot.dat[0][1][0]));
    assert.equal(csa.plot.dat[0][2][0], null);   // undefined from an empty series
    assert.equal(csa.plot.dat[0][3][0], 2);
});
