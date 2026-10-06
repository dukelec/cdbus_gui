#!/usr/bin/env python3
#
# Software License Agreement (MIT License)
#
# Author: Duke Fong <d@d-l.io>
#
# Record the bus to a pcapng file, for Wireshark with wireshark/cdbus.lua of https://github.com/dukelec/cdbus_tools,
# where the format is described as well.
#
# Every frame the backend sends or receives goes in as it is on the wire, header, payload and
# crc, so the capture is the bus and not the backend's idea of it. The file has two interfaces:
#   0: "cdbus", link type USER0 (147), the frames, the epb flags tell rx from tx
#   1: "mark",  link type USER1 (148), the marks: Enter in a Logs window, or the api
# A mark is a packet whose data is the mark text, with the same text as the packet comment, so
# it reads the same with or without the dissector. Timestamps are nanoseconds since the epoch.
#
# The recorder is driven from two threads, the serial receive thread and the asyncio loop, so
# everything that touches the file goes through one lock.

import os
import sys
import struct
import time
import datetime
import platform
import threading
import logging

logger = logging.getLogger('cdgui.pcap')

LINKTYPE_USER0 = 147
LINKTYPE_USER1 = 148

IF_CDBUS = 0
IF_MARK = 1

FLAG_INBOUND = 1    # epb_flags direction: the frame came in from the bus
FLAG_OUTBOUND = 2   # the backend sent it

# pcapng block and option codes
BT_SHB = 0x0a0d0d0a
BT_IDB = 1
BT_EPB = 6
OPT_END = 0
OPT_COMMENT = 1
SHB_OS = 3
SHB_USERAPPL = 4
IF_NAME = 2
IF_DESCRIPTION = 3
IF_TSRESOL = 9
EPB_FLAGS = 2


def _opt(code, val):
    """one option, value padded to 4 bytes; a str goes in as utf-8"""
    if isinstance(val, str):
        val = val.encode()
    return struct.pack('<HH', code, len(val)) + val + b'\0' * (-len(val) % 4)


def _block(btype, body, opts=b''):
    if opts:
        opts += _opt(OPT_END, b'')
    body += opts
    total = 12 + len(body)
    return struct.pack('<II', btype, total) + body + struct.pack('<I', total)


class PcapngWriter:
    """a pcapng file with the two interfaces above, every block written and flushed as it comes"""

    def __init__(self, path, app='cdbus_gui', comment=None, dev_str=None):
        self.path = path
        self.f = open(path, 'wb')
        self.size = 0
        opts = _opt(SHB_USERAPPL, app) + _opt(SHB_OS, platform.platform())
        if comment:
            opts = _opt(OPT_COMMENT, comment) + opts
        self._write(_block(BT_SHB, struct.pack('<IHHq', 0x1a2b3c4d, 1, 0, -1), opts))
        self._write(self._idb(LINKTYPE_USER0, 'cdbus',
                              f'CDBUS frames: {dev_str}' if dev_str else 'CDBUS frames'))
        self._write(self._idb(LINKTYPE_USER1, 'mark',
                              'marks: Enter in a Logs window of cdbus_gui, or its api'))

    @staticmethod
    def _idb(linktype, name, desc):
        opts = _opt(IF_NAME, name) + _opt(IF_DESCRIPTION, desc) + _opt(IF_TSRESOL, b'\x09')
        return _block(BT_IDB, struct.pack('<HHI', linktype, 0, 0), opts)

    def _write(self, blk):
        self.f.write(blk)
        self.f.flush()
        self.size += len(blk)

    def packet(self, if_id, dat, ts_ns=None, flags=None, comment=None):
        if ts_ns is None:
            ts_ns = time.time_ns()
        opts = b''
        if comment:
            opts += _opt(OPT_COMMENT, comment)
        if flags is not None:
            opts += _opt(EPB_FLAGS, struct.pack('<I', flags))
        body = struct.pack('<IIIII', if_id, ts_ns >> 32, ts_ns & 0xffffffff, len(dat), len(dat))
        body += dat + b'\0' * (-len(dat) % 4)
        self._write(_block(BT_EPB, body, opts))

    def close(self):
        self.f.close()


class Recorder:
    """start / stop a recording and feed it; status() is what the pages and the api show.
    `sock` is set by the rec service, so a change made through the api reaches the index page"""

    def __init__(self, rec_dir='records', app='cdbus_gui'):
        self.dir = rec_dir
        self.app = app
        self.lock = threading.Lock()
        self.w = None
        self.path = None        # of the recording, or of the last one, as are the counts and size
        self.pkts = 0
        self.marks = 0
        self.size = 0
        self.start_t = None
        self.sock = None

    def status(self, err=None):
        with self.lock:
            st = {'on': self.w is not None, 'path': self.path, 'pkts': self.pkts, 'marks': self.marks,
                  'size': self.size,
                  'start': self.start_t.isoformat(timespec='seconds') if self.start_t else None}
        if err:
            st['err'] = err
        return st

    def start(self, dev_str=None, comment=None):
        """returns the path; raises on a file problem, or when a recording is on"""
        with self.lock:
            if self.w:
                raise RuntimeError(f'already recording to {self.path}')
            os.makedirs(self.dir, exist_ok=True)
            now = datetime.datetime.now()
            path = os.path.join(self.dir, now.strftime('cdbus_%Y%m%d_%H%M%S.pcapng'))
            self.w = PcapngWriter(path, app=self.app, comment=comment, dev_str=dev_str)
            self.path, self.pkts, self.marks, self.start_t = path, 0, 0, now
            self.size = self.w.size
        logger.info(f'rec: start {path}')
        return path

    def stop(self):
        with self.lock:
            w, self.w = self.w, None
            if w:
                w.close()
        if w:
            logger.info(f'rec: stop {self.path}, {self.pkts} packets, {self.marks} marks, {w.size} bytes')
        return w is not None

    def frame(self, frame, outbound, ts_ns=None):
        """a cdbus frame as it is on the wire (with crc); nothing happens while not recording"""
        with self.lock:
            if not self.w:
                return
            try:
                self.w.packet(IF_CDBUS, frame, ts_ns, FLAG_OUTBOUND if outbound else FLAG_INBOUND)
                self.pkts += 1
                self.size = self.w.size
            except OSError as err:
                logger.error(f'rec: write {self.path}: {err}')

    def mark(self, text, ts_ns=None):
        text = f'{text}'
        with self.lock:
            if not self.w:
                return False
            try:
                self.w.packet(IF_MARK, text.encode(), ts_ns, comment=text)
                self.marks += 1
                self.size = self.w.size
            except OSError as err:
                logger.error(f'rec: write {self.path}: {err}')
        logger.info(f'rec: mark {self.marks}: {text}')
        return True

    async def notify(self, path='/'):
        """push the status to the index page, after a change the page did not ask for"""
        if self.sock:
            await self.sock.sendto(self.status(), (path, 'rec'))


# the websocket service the pages talk to, port 'rec':
#   {'action': 'get' | 'start' | 'stop'}  -> status dict, 'err' in it when it failed
#   {'action': 'mark', 'text': ...}       -> nothing (a mark while not recording is dropped)
# rec=None (main_udp.py, no bus to record): marks are dropped, the rest answers with an error
async def rec_service(rec, ws_ns, dev_str=lambda: None):
    from cd_ws import CDWebSocket
    sock = CDWebSocket(ws_ns, 'rec')
    if rec:
        rec.sock = sock
    while True:
        dat, src = await sock.recvfrom()
        logger.debug(f'rec ser: {dat}, path: {src[0]}')
        try:
            action = dat.get('action') if isinstance(dat, dict) else None
            if action == 'mark':
                if rec:
                    rec.mark(dat.get('text', ''))
                continue
            if not rec:
                await sock.sendto({'on': False, 'err': 'no recording in udp mode'}, src)
                continue
            err = None
            if action == 'start':
                try:
                    rec.start(dev_str=dev_str())
                except (OSError, RuntimeError) as e:
                    err = f'{e}'
            elif action == 'stop':
                rec.stop()
            elif action != 'get':
                err = f'unknown cmd: {action}'
            await sock.sendto(rec.status(err), src)
        except Exception as err: # one bad request must not take the service down with it
            logger.warning(f'rec ser: {dat}: {err}')
            await sock.sendto({'on': False, 'err': f'{err}'}, src)
