#!/usr/bin/env python3
#
# Software License Agreement (MIT License)
#
# Author: Duke Fong <d@d-l.io>

from intelhex import IntelHex
import asyncio
from cd_ws import CDWebSocket
from web_serve import ws_ns
import cd_watch
from cdnet.utils.log import *


def select_ihex_file_wx():
    import wx

    app = wx.GetApp()
    own_app = app is None
    if own_app:
        app = wx.App(False)
    dialog = wx.FileDialog(
        None, 'Select Intel HEX firmware',
        wildcard='Intel HEX (*.hex;*.ihex)|*.hex;*.ihex|All files (*.*)|*.*',
        style=wx.FD_OPEN | wx.FD_FILE_MUST_EXIST)
    try:
        if dialog.ShowModal() == wx.ID_OK:
            return dialog.GetPath()
        return ''
    finally:
        dialog.Destroy()
        if own_app:
            app.Destroy()


def select_ihex_file_tk():
    import tkinter as tk
    from tkinter import filedialog

    root = tk.Tk()
    root.withdraw()
    try:
        root.attributes('-topmost', True)
    except tk.TclError:
        pass
    try:
        return filedialog.askopenfilename(
            title='Select Intel HEX firmware',
            filetypes=[('Intel HEX', ('*.hex', '*.ihex')), ('All files', '*.*')])
    finally:
        root.destroy()


def select_ihex_file():
    try:
        return select_ihex_file_wx()
    except Exception as err:
        logging.warning(f'wx file chooser unavailable, fallback to Tk: {err}')
        return select_ihex_file_tk()


async def iap_service(): # config r/w    
    logger = logging.getLogger(f'cdgui.iap')
    sock = CDWebSocket(ws_ns, 'iap')
    while True:
        dat, src = await sock.recvfrom()
        logger.debug(f'iap ser: {dat}')
        
        if dat['action'] == 'get_ihex':
            ret = []
            ih = IntelHex()
            try:
                ih.loadhex(dat['path'])
                segs = ih.segments()
                logger.info(f'parse ihex file, segments: {[list(map(hex, l)) for l in segs]} (end addr inclusive)')
                for seg in segs:
                    s = [seg[0], ih.tobinstr(seg[0], size=seg[1]-seg[0])]
                    ret.append(s)
            except Exception as err:
                logger.error(f'parse ihex file error: {err}')
            await sock.sendto(ret, src)

        elif dat['action'] == 'select_ihex':
            try:
                loop = asyncio.get_running_loop()
                path = await loop.run_in_executor(None, select_ihex_file)
            except Exception as err:
                logger.error(f'select ihex file error: {err}')
                path = ''
            await sock.sendto(path, src)
        
        else:
            await sock.sendto('err: iap: unknown cmd', src)

def iap_init(csa):
    cd_watch.create_task(iap_service(), 'iap_service')
