#!/usr/bin/env python3
#
# Software License Agreement (MIT License)
#
# Author: Duke Fong <d@d-l.io>

from intelhex import IntelHex
from cd_ws import CDWebSocket
from web_serve import ws_ns
from cdnet.utils.log import *


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
        
        else:
            await sock.sendto('err: iap: unknown cmd', src)

def iap_init(csa):
    csa['async_loop'].create_task(iap_service())

