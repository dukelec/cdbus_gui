#!/usr/bin/env python3
#
# Software License Agreement (MIT License)
#
# Author: Duke Fong <d@d-l.io>
#
# Record the bus to a pcapng file, for Wireshark with wireshark/cdbus.lua of https://github.com/dukelec/cdbus_tools,
# where the format is described as well; the file is written by cdnet.utils.pcapng of pycdnet.
#
# Every frame the backend sends or receives goes in as it is on the wire, header, payload and
# crc, so the capture is the bus and not the backend's idea of it; the marks come from Enter in a
# Logs window, or the api.
#
# The recorder is fed from two threads, the serial receive thread and the asyncio loop. They only
# stamp the time and queue; one writer thread puts everything in the file in queue order, so
# neither of them waits for the disk. A sent frame is queued before it is written to the port: at
# 20 Mbps the reply is back before the sending thread gets to run again, and queued after the
# write it would land behind its own reply. Every block is one unbuffered write(), so a process
# killed at any point leaves whole blocks behind, and a normal exit, Ctrl-C included, drains the
# queue through atexit.

import os
import sys
import time
import datetime
import threading
import queue
import atexit
import logging
from cdnet.utils.pcapng import *   # PcapngWriter and the format's constants, cd_replay and the tests use them from here

logger = logging.getLogger('cdgui.pcap')


class Recorder:
    """start / stop a recording and feed it; status() is what the pages and the api show.
    `sock` is set by the rec service, so a change made through the api reaches the index page"""

    def __init__(self, rec_dir='records', app='cdbus_gui'):
        self.dir = rec_dir
        self.app = app
        self.lock = threading.Lock()    # start / stop / status; the frames and marks only touch the queue
        self.w = None
        self.q = None           # (if_id, ts_ns, data, flags, comment) for the writer thread, None to stop it
        self.t = None           # the writer thread, which owns the file and the counts below
        self.path = None        # of the recording, or of the last one, as are the counts and size
        self.pkts = 0
        self.marks = 0
        self.size = 0
        self.start_t = None
        self.sock = None
        atexit.register(self.stop)  # what is still queued at exit goes in the file, and it is closed

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
            w = PcapngWriter(path, app=self.app, comment=comment, dev_str=dev_str,
                             mark_str='marks: Enter in a Logs window of cdbus_gui, or its api')
            q = queue.Queue()
            t = threading.Thread(target=self._writer, args=(w, q), name='rec_writer', daemon=True)
            self.path, self.pkts, self.marks, self.start_t, self.size = path, 0, 0, now, w.size
            t.start()
            self.w, self.q, self.t = w, q, t
        logger.info(f'rec: start {path}')
        return path

    def stop(self):
        with self.lock:
            w, q, t = self.w, self.q, self.t
            self.w = self.q = self.t = None
        if not w:
            return False
        q.put(None)
        t.join()    # what was queued before is written, then the file closed
        logger.info(f'rec: stop {self.path}, {self.pkts} packets, {self.marks} marks, {w.size} bytes')
        return True

    def _writer(self, w, q):
        """the writer thread: the only one that touches the file, until the None stop() queues"""
        while True:
            item = q.get()
            try:
                if item is None:
                    w.close()
                    return
                if_id, ts_ns, dat, flags, comment = item
                try:
                    w.packet(if_id, dat, ts_ns, flags, comment)
                    if if_id == IF_MARK:
                        self.marks += 1
                        logger.info(f'rec: mark {self.marks}: {comment}')
                    else:
                        self.pkts += 1
                    self.size = w.size
                except OSError as err:
                    logger.error(f'rec: write {w.path}: {err}')
            finally:
                q.task_done()

    def frame(self, frame, outbound, ts_ns=None):
        """a cdbus frame as it is on the wire (with crc), stamped now unless told otherwise, queued
        for the writer; nothing happens while not recording"""
        q = self.q
        if q:
            q.put((IF_CDBUS, time.time_ns() if ts_ns is None else ts_ns, frame,
                   FLAG_OUTBOUND if outbound else FLAG_INBOUND, None))

    def mark(self, text, ts_ns=None):
        q = self.q
        if not q:
            return False
        text = f'{text}'
        q.put((IF_MARK, time.time_ns() if ts_ns is None else ts_ns, text.encode(), None, text))
        return True

    def sync(self):
        """wait until all that is queued so far is in the file"""
        q = self.q
        if q:
            q.join()

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
