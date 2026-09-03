#!/usr/bin/env python3
#
# Software License Agreement (MIT License)
#
# Author: Duke Fong <d@d-l.io>
#
# Watchdog for important asyncio tasks and threads:
#   - wrap tasks / threads, record unexpected exit or exception as a "fault"
#   - periodically check registered threads are still alive
#   - report faults to all connected web pages (port 'sys'), so the user
#     knows why the communication is broken

import asyncio
import logging
import threading
import traceback
from cd_ws import CDWebSocket
from web_serve import ws_ns

logger = logging.getLogger(f'cdgui.watch')

faults = []     # list of str: 'name: reason'
threads = {}    # name: threading.Thread
loop = None
exit_code = 0   # set to non-zero by a fatal fault


def init(async_loop):
    global loop
    loop = async_loop


def _notify():
    sock = ws_ns.sockets.get('sys')
    if sock and loop:
        loop.create_task(sock.broadcast(faults, 'sys'))


def report_fault(name, reason):
    """Record a fault and notify all pages, safe to call from any thread."""
    msg = f'{name}: {reason}'
    if msg in faults:
        return
    faults.append(msg)
    logger.critical(f'FAULT: {msg}')
    if loop:
        loop.call_soon_threadsafe(_notify)


def clear_fault(name):
    """Remove faults reported by `name` (e.g. after the device is re-opened)."""
    global faults
    remain = [f for f in faults if not f.startswith(f'{name}: ')]
    if len(remain) != len(faults):
        faults[:] = remain
        if loop:
            loop.call_soon_threadsafe(_notify)


def create_task(coro, name, fatal=False):
    """Run coroutine as a task, report if it raises or exits unexpectedly.
    fatal=True: stop the event loop on failure (e.g. web server can't start)."""
    async def wrap():
        try:
            await coro
            reason = 'exited unexpectedly'
        except asyncio.CancelledError:
            raise
        except Exception as err:
            logger.error(f'{name}: {traceback.format_exc()}')
            reason = f'{type(err).__name__}: {err}'
        report_fault(name, reason)
        if fatal:
            global exit_code
            logger.critical(f'{name} is fatal, exit')
            exit_code = 1
            loop.stop() # main should call sys.exit(cd_watch.exit_code) after run_forever()
    return loop.create_task(wrap(), name=name)


def start_thread(target, name):
    """Start a daemon thread, report if it raises or exits unexpectedly."""
    def wrap():
        try:
            target()
            reason = 'exited unexpectedly'
        except Exception as err:
            logger.error(f'{name}: {traceback.format_exc()}')
            reason = f'{type(err).__name__}: {err}'
        report_fault(name, reason)
    t = threading.Thread(target=wrap, name=name, daemon=True)
    threads[name] = t
    t.start()
    return t


async def watch_service(check=None):
    """Answer 'get_faults' queries and check threads every second.
    check: optional callback for extra checks (e.g. device thread)."""
    sock = CDWebSocket(ws_ns, 'sys')
    while True:
        try:
            dat, src = await sock.recvfrom(timeout=1)
        except asyncio.TimeoutError:
            for name, t in threads.items():
                if not t.is_alive():
                    report_fault(name, 'thread is dead')
            if check:
                try:
                    check()
                except Exception as err:
                    logger.error(f'watch check: {err}')
            continue

        if dat['action'] == 'get_faults':
            await sock.sendto(faults, src)
        else:
            await sock.sendto('err: sys: unknown cmd', src)
