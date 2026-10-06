#!/usr/bin/env python3
#
# Software License Agreement (MIT License)
#
# Author: Duke Fong <d@d-l.io>
#
# Replay a pcapng recording (cd_pcap.py) through the backend, as if the bus were sending it
# again: every inbound frame goes the way a live one goes, so the index page gets the
# interleaved log of every device, and an opened device page its own log, waveforms and
# pictures, with the timestamps of the capture. The marks come out as lines in the logs.
#
# The registers are rebuilt from the traffic: a read request (port 5) and its answer, or a
# write and its ok, say what a register held at that moment, and the newest value of every
# byte is kept in a memory image per device. Playing stops at the time asked for, the image
# at that point is sent to the device pages, and playing on from there moves it on, so the
# registers of any moment of the capture can be looked at: rewind, play to the time, read.
#
# Driven from the index page over the 'replay' port, see replay_service().

import os
import struct
import time
import datetime
import asyncio
import logging

from cdnet.parser import cdnet_l0, cdnet_l1
from cdnet.utils.crc import modbus_crc
import cd_pcap

logger = logging.getLogger('cdgui.replay')

STATUS_EVERY = 0.2      # seconds between progress pushes while playing


class PcapngError(ValueError):
    pass


def read_pcapng(data):
    """The packets of a pcapng file, in file order: a list of
    (kind, ts_ns, data, comment, outbound) with kind 'frame' (link type USER0 or an interface
    named cdbus) or 'mark' (USER1 or named mark); packets of other interfaces are skipped.
    outbound is what the epb_flags say, None when they say nothing."""
    pkts = []
    ifaces = []
    endian = '<'
    pos = 0
    n = len(data)
    if n < 12 or struct.unpack_from('<I', data, 0)[0] != cd_pcap.BT_SHB:
        raise PcapngError('not a pcapng file')
    while pos + 12 <= n:
        btype = struct.unpack_from(endian + 'I', data, pos)[0]
        if btype == cd_pcap.BT_SHB:
            magic = struct.unpack_from('<I', data, pos + 8)[0]
            endian = '<' if magic == 0x1a2b3c4d else '>'
            ifaces = []     # interface ids count from 0 again in a new section
        total = struct.unpack_from(endian + 'I', data, pos + 4)[0]
        if total < 12 or total % 4 or pos + total > n:
            raise PcapngError(f'bad block length {total} at {pos}')
        if struct.unpack_from(endian + 'I', data, pos + total - 4)[0] != total:
            raise PcapngError(f'block length mismatch at {pos}')
        body = data[pos + 8:pos + total - 4]
        if btype == cd_pcap.BT_IDB:
            linktype, _, _ = struct.unpack_from(endian + 'HHI', body, 0)
            opts = _options(body[8:], endian)
            name = opts.get(cd_pcap.IF_NAME, b'').decode(errors='replace')
            tsresol = opts.get(cd_pcap.IF_TSRESOL, b'\x06')[0]
            if tsresol & 0x80:
                scale = 1e9 / (2 ** (tsresol & 0x7f))
            else:
                scale = 10 ** (9 - tsresol)
            kind = None
            if linktype == cd_pcap.LINKTYPE_USER0 or name == 'cdbus':
                kind = 'frame'
            elif linktype == cd_pcap.LINKTYPE_USER1 or name == 'mark':
                kind = 'mark'
            ifaces.append((kind, scale))
        elif btype == cd_pcap.BT_EPB:
            if_id, ts_hi, ts_lo, cap, orig = struct.unpack_from(endian + 'IIIII', body, 0)
            if if_id >= len(ifaces):
                raise PcapngError(f'packet of unknown interface {if_id}')
            kind, scale = ifaces[if_id]
            if not kind:
                pos += total
                continue
            ts_ns = int(((ts_hi << 32) | ts_lo) * scale)
            dat = body[20:20 + cap]
            opts = _options(body[20 + cap + (-cap % 4):], endian)
            outbound = None
            if len(opts.get(cd_pcap.EPB_FLAGS, b'')) == 4:
                d = struct.unpack(endian + 'I', opts[cd_pcap.EPB_FLAGS])[0] & 3
                outbound = {1: False, 2: True}.get(d)
            pkts.append((kind, ts_ns, dat, opts.get(cd_pcap.OPT_COMMENT, b'').decode(errors='replace'),
                         outbound))
        pos += total
    return pkts


def _options(raw, endian):
    out = {}
    pos = 0
    while pos + 4 <= len(raw):
        code, n = struct.unpack_from(endian + 'HH', raw, pos)
        if code == cd_pcap.OPT_END:
            break
        out[code] = raw[pos + 4:pos + 4 + n]
        pos += 4 + n + (-n % 4)
    return out


def time_str(ts_ns):
    return datetime.datetime.fromtimestamp(ts_ns / 1e9).strftime('%H:%M:%S.%f')[:-3]


class Replayer:
    """rx_rpt(rx, ts_ns): the backend's coroutine that hands a received packet to the pages,
    rx being what the cdnet parser returns. csa is looked at for the local net and the port."""

    def __init__(self, csa, ws_ns, rx_rpt, rec_dir='records'):
        self.csa = csa
        self.ws_ns = ws_ns
        self.rx_rpt = rx_rpt
        self.dir = rec_dir
        self.sock = None        # set by the service, for the pushes to the index page
        self.task = None
        self.name = None
        self.pkts = []
        self.t0 = 0
        self.pos = 0            # next packet to play
        self.t = 0              # offset of the last packet played, ns
        self.err = None
        self.marks = []
        self.devs = []
        self.pending = {}       # (dev, host_port): ('r', addr, len) | ('w', addr, data)
        self.mem = {}           # dev: {byte address: value}

    # ------------------------------------------------------------ state

    def list_files(self):
        files = []
        try:
            for f in sorted(os.listdir(self.dir), reverse=True):
                p = os.path.join(self.dir, f)
                if f.endswith('.pcapng') and os.path.isfile(p):
                    files.append({'name': f, 'size': os.path.getsize(p)})
        except OSError:
            pass
        return files

    def load(self, name, data=None):
        """name alone: a file of the records dir; with data: the bytes of an uploaded file"""
        self.stop_now()
        if data is None:
            if os.sep in name or (os.altsep and os.altsep in name) or not name.endswith('.pcapng'):
                raise ValueError(f'not a recording: {name}')
            try:
                with open(os.path.join(self.dir, name), 'rb') as f:
                    data = f.read()
            except OSError as err:
                raise ValueError(f'cannot read {name}: {err}')
        pkts = read_pcapng(data)
        if not pkts:
            raise PcapngError('no packets in the file')
        self.name = name
        self.pkts = pkts
        self.t0 = pkts[0][1]
        self.marks = [{'t': (p[1] - self.t0) / 1e9, 'text': p[3] or p[2].decode(errors='replace')}
                      for p in pkts if p[0] == 'mark']
        # the addresses of the capture, the most talkative first, without the host's own
        own = {f'{lv:02x}:{self.csa["net"]:02x}:{self.csa["mac"]:02x}' for lv in (0x00, 0x80)}
        devs = {}
        for kind, ts, dat, _, _ in pkts:
            if kind != 'frame':
                continue
            parsed = self.parse(dat)
            if parsed:
                (src, _), (dst, _), _ = parsed
                for a in (src, dst):
                    if a not in own:
                        devs[a] = devs.get(a, 0) + 1
        self.devs = sorted(devs, key=lambda a: -devs[a])
        self.rewind()
        logger.info(f'replay: loaded {name}: {len(pkts)} packets, {len(self.marks)} marks, '
                    f'{self.duration():.3f} s, addresses {self.devs}')

    def duration(self):
        return (self.pkts[-1][1] - self.t0) / 1e9 if self.pkts else 0

    def rewind(self):
        self.stop_now()
        self.pos = 0
        self.t = 0
        self.pending = {}
        self.mem = {}
        self.err = None

    def status(self, err=None):
        pages = [p.lstrip('/') for p in self.ws_ns.connections if p != '/']
        st = {'name': self.name, 'pkts': len(self.pkts), 'marks': self.marks,
              'duration': self.duration(), 'devs': self.devs, 'pages': pages,
              'pos': self.pos, 't': self.t / 1e9,
              'playing': self.task is not None and not self.task.done(),
              'err': err or self.err}
        return st

    def stop_now(self):
        if self.task and not self.task.done():
            self.task.cancel()
        self.task = None

    # ------------------------------------------------------------ playing

    def play(self, to_s, speed=0):
        """play on up to `to_s` seconds from the start of the file: 0 speed is at once,
        otherwise that many times real time. The task pushes its progress and the register
        images when it is done."""
        if not self.pkts:
            raise ValueError('no file loaded')
        if self.task and not self.task.done():
            raise ValueError('already playing')
        if self.csa.get('dev'):
            raise ValueError('close the serial port first, live frames would mix in')
        to_ns = int(to_s * 1e9)
        if self.pos >= len(self.pkts):
            raise ValueError('at the end of the file, rewind first')
        if to_ns < self.pkts[self.pos][1] - self.t0:
            raise ValueError(f'already past {to_s} s, rewind first')
        self.err = None
        self.task = asyncio.get_running_loop().create_task(self._run(to_ns, speed))

    async def _run(self, to_ns, speed):
        last_push = time.monotonic()
        try:
            while self.pos < len(self.pkts):
                kind, ts, dat, comment, outbound = self.pkts[self.pos]
                ofs = ts - self.t0
                if ofs > to_ns:
                    break
                if speed > 0 and self.pos > 0:
                    gap = (ts - self.pkts[self.pos - 1][1]) / 1e9 / speed
                    if gap > 0:
                        await asyncio.sleep(gap)
                try:
                    await self.dispatch(kind, ts, dat, comment, outbound)
                except Exception as err: # one bad frame must not end the replay
                    logger.warning(f'replay: packet {self.pos}: {err}')
                self.pos += 1
                self.t = ofs
                if time.monotonic() - last_push > STATUS_EVERY:
                    last_push = time.monotonic()
                    await self.push()
            if self.pos < len(self.pkts):
                self.t = to_ns      # played up to the time asked, even past the last packet before it
            await self.send_regs()
        except asyncio.CancelledError:
            await self.send_regs()
            raise
        except Exception as err:
            logger.error(f'replay: {err}')
            self.err = f'{err}'
        finally:
            self.task = None
            await self.push()

    async def push(self):
        if self.sock:
            await self.sock.sendto(self.status(), ('/', 'replay'))

    def parse(self, frame):
        """a frame as recorded, crc included: what the cdnet parser makes of it, None when it
        is no good"""
        if len(frame) < 5 or len(frame) != frame[2] + 5 or modbus_crc(frame) != 0:
            return None
        frame = frame[:-2]
        try:
            if frame[3] & 0x80:
                return cdnet_l1.from_frame(frame, self.csa['net'])
            return cdnet_l0.from_frame(frame, self.csa['net'])
        except Exception:
            return None

    async def dispatch(self, kind, ts, dat, comment, outbound=None):
        if kind == 'mark':
            text = comment or dat.decode(errors='replace')
            line = f'---- mark: {text} ----\n'
            await self.send_log('/', f'{time_str(ts)} [mark]: {line}'.encode())
            for path in list(self.ws_ns.connections):
                if path != '/':
                    await self.send_log(path, f'{time_str(ts)}: {line}'.encode())
            return
        rx = self.parse(dat)
        if not rx:
            logger.debug(f'replay: skip frame {dat.hex(" ")}')
            return
        # the host's own frames are not played to the pages; a capture without direction flags
        # (a sniffer's) tells them by the source mac
        if outbound or (outbound is None and dat[0] == self.csa['mac'] and dat[1] != self.csa['mac']):
            self.track_request(rx)
            return
        self.track_reply(rx)
        await self.rx_rpt(rx, ts)

    async def send_log(self, path, line):
        if self.sock:
            await self.sock.sendto({'src': ('replay', 9), 'dat': line}, (path, 9))

    # ------------------------------------------------------------ registers

    def track_request(self, rx):
        (src, src_port), (dst, dst_port), dat = rx
        if dst_port != 0x5 or len(dat) < 3:
            return
        cmd, addr = dat[0], dat[1] | (dat[2] << 8)
        if cmd == 0x00 and len(dat) >= 4:
            self.pending[(dst, src_port)] = ('r', addr, dat[3])
        elif cmd == 0x20:
            self.pending[(dst, src_port)] = ('w', addr, dat[3:])
        elif cmd == 0xa0:               # written without an answer: taken as done
            self.pending.pop((dst, src_port), None)
            self.store(dst, addr, dat[3:])

    def track_reply(self, rx):
        (src, src_port), (dst, dst_port), dat = rx
        if src_port != 0x5 or not dat:
            return
        req = self.pending.pop((src, dst_port), None)
        if not req or dat[0] & 0x7f:
            return
        kind, addr, arg = req
        if kind == 'r' and len(dat) >= 1 + arg:
            self.store(src, addr, dat[1:1 + arg])
        elif kind == 'w':
            self.store(src, addr, arg)

    def store(self, dev, addr, data):
        mem = self.mem.setdefault(dev, {})
        for i, b in enumerate(data):
            mem[addr + i] = b

    def runs(self, dev):
        """the image as [[address, bytes], ...], one entry per contiguous stretch"""
        out = []
        for a in sorted(self.mem.get(dev, {})):
            if out and out[-1][0] + len(out[-1][1]) == a:
                out[-1][1].append(self.mem[dev][a])
            else:
                out.append([a, bytearray([self.mem[dev][a]])])
        return [[a, bytes(b)] for a, b in out]

    async def send_regs(self):
        if not self.sock:
            return
        for dev in self.mem:
            runs = self.runs(dev)
            if runs:
                await self.sock.sendto({'mem': runs, 't': self.t / 1e9}, (f'/{dev}', 'reg_import'))


# the websocket service, port 'replay', every answer is the status dict (with 'err' when the
# request failed), and the status is pushed to the index page while playing and when it ends:
#   {'action': 'list'}                                -> {'files': [...]} (the records dir)
#   {'action': 'load', 'name': ..., ['data': bytes]}  the file of the records dir, or an upload
#   {'action': 'play', 'to': seconds, 'speed': 0 | n} play on up to that time, 0: at once
#   {'action': 'stop'} | {'action': 'rewind'} | {'action': 'get'}
async def replay_service(rp, ws_ns):
    from cd_ws import CDWebSocket
    sock = CDWebSocket(ws_ns, 'replay')
    rp.sock = sock
    while True:
        dat, src = await sock.recvfrom()
        action = dat.get('action') if isinstance(dat, dict) else None
        logger.debug(f'replay ser: {action} from {src[0]}')
        err = None
        try:
            if action == 'list':
                await sock.sendto({'files': rp.list_files()}, src)
                continue
            elif action == 'load':
                data = dat.get('data')
                rp.load(dat['name'], bytes(data) if data is not None else None)
            elif action == 'play':
                rp.play(float(dat.get('to', 0)), float(dat.get('speed', 0)))
            elif action == 'stop':
                rp.stop_now()
            elif action == 'rewind':
                rp.rewind()
            elif action != 'get':
                err = f'unknown cmd: {action}'
        except Exception as e: # one bad request must not take the service down with it
            logger.warning(f'replay ser: {action}: {e}')
            err = f'{e}'
        await sock.sendto(rp.status(err), src)
