#!/usr/bin/env python3
#
# Software License Agreement (MIT License)
#
# Author: Duke Fong <d@d-l.io>

"""CDBUS GUI Tool

Args:
  --help    | -h    # this help message
  --verbose | -v    # debug level: verbose
  --debug   | -d    # debug level: debug
"""

import os, sys
import _thread
import datetime
import copy
import json5
import asyncio
import aiohttp
import websockets
from intelhex import IntelHex
from time import sleep
from cd_ws import CDWebSocket, CDWebSocketNS
from web_serve import ws_ns, start_web

sys.path.append(os.path.join(os.path.dirname(__file__), 'pycdnet'))

from cdnet.utils.log import *
from cdnet.utils.cd_args import CdArgs
from cdnet.dev.cdbus_serial import CDBusSerial
from cdnet.utils.serial_get_port import get_ports
from cdnet.dispatch import *
from cdnet.parser import *


args = CdArgs()
if args.get("--help", "-h") != None:
    print(__doc__)
    exit()

if args.get("--verbose", "-v") != None:
    logger_init(logging.VERBOSE)
elif args.get("--debug", "-d") != None:
    logger_init(logging.DEBUG)
else:
    logger_init(logging.INFO)

logging.getLogger('websockets').setLevel(logging.WARNING)
logger = logging.getLogger(f'cdgui')

csa = {
    'async_loop': None,
    'dev': None,    # serial device
    'net': 0x00,    # local net
    'mac': 0x00,    # local mac
    'proxy': None,  # cdbus frame proxy socket
    'cfgs': [],     # config list
    'palloc': {},   # ports alloc, url_path: []
    'l0_last_src_port': None,
    'l0_last_dst_port': None
}

# proxy to html: ('/x0:00:dev_mac', host_port) <- ('server', 'proxy'): { 'src': src, 'dat': payloads }
async def proxy_rx_rpt(rx):
    src, dst, dat = rx
    ret = await csa['proxy'].sendto({'src': src, 'dat': dat}, (f'/{src[0]}', dst[1]))
    if ret:
        logger.warning(f'rx_rpt err: {ret}: /{src[0]}:{dst[1]}, {dat}')
    
    logger.debug(f'rx_rpt: src: {src}, dst: {dst}, dat: {dat}')
    if (src[1] == 0x9 or dst[1] == 0x9) or src[1] == 0x1: # dbg and dev_info msg also send to index.html
        await csa['proxy'].sendto({'src': src, 'dat': dat}, (f'/', 0x9))

def proxy_rx():
    logger.info('start proxy_rx')
    while True:
        if not csa['dev']:
            sleep(0.5)
            continue
        frame = csa['dev'].recv(timeout=0.5)
        if frame:
            try:
                if frame[3] & 0x80:
                    rx = cdnet_l1.from_frame(frame, csa['net'])
                    logger.log(logging.VERBOSE, f'proxy_rx l1: {frame}')
                else:
                    rx = cdnet_l0.from_frame(frame, csa['net'], csa['l0_last_dst_port'])
                    if frame[3] & 0x40: # l0 reply
                        rx = rx[0], (rx[1][0], csa['l0_last_src_port']), rx[2]
                        csa['l0_last_src_port'] = None
                        csa['l0_last_dst_port'] = None
                    logger.log(logging.VERBOSE, f'proxy_rx l0: {frame}')
                asyncio.run_coroutine_threadsafe(proxy_rx_rpt(rx), csa['async_loop']).result()
            except:
                logger.warning('proxy_rx fmt err', frame)
    
    logger.info('exit proxy_rx')

_thread.start_new_thread(proxy_rx, ())

# proxy to dev, ('/x0:00:dev_mac', host_port) -> ('server', 'proxy'): { 'dst': dst, 'dat': payloads }
async def cdbus_proxy_service():
    while True:
        frame = None
        wc_dat, wc_src = await csa['proxy'].recvfrom()
        logger.debug(f'proxy_tx: {wc_dat}, src {wc_src}')
        if len(wc_src[0]) != 9:
            logger.warning(f'proxy_tx: wc_src err: {wc_src}')
            return
        try:
            if wc_src[0][1:3] != '00':
                dst_mac = int(wc_dat['dst'][0].split(':')[2], 16)
                frame = cdnet_l1.to_frame((f'{wc_src[0][1:3]}:{csa["net"]:02x}:{csa["mac"]:02x}', wc_src[1]), \
                                           wc_dat['dst'], wc_dat['dat'], csa['mac'], dst_mac)
                logger.log(logging.VERBOSE, f'proxy_tx frame l1: {frame}')
            else:
                frame = cdnet_l0.to_frame((f'{wc_src[0][1:3]}:{csa["net"]:02x}:{csa["mac"]:02x}', CDN_DEF_PORT), \
                                           wc_dat['dst'], wc_dat['dat'])
                csa['l0_last_src_port'] = wc_src[1]
                csa['l0_last_dst_port'] = wc_dat['dst'][1]
                logger.log(logging.VERBOSE, f'proxy_tx frame l0: {frame}')
                print('csa[l0_last_src_port]:', csa['l0_last_src_port'])
                print((f'{wc_src[0][1:3]}:{csa["net"]:02x}:{csa["mac"]:02x}', CDN_DEF_PORT), wc_dat['dst'])
        except:
            logger.warning('proxy_tx: fmt err')
        
        if frame and csa['dev']:
            csa['dev'].send(frame)


async def dev_service(): # cdbus tty setup
    sock = CDWebSocket(ws_ns, 'dev')
    while True:
        dat, src = await sock.recvfrom()
        logger.debug(f'dev ser: {dat}')
        
        if dat['action'] == 'get':
            ports = get_ports()
            if csa['dev']:
                await sock.sendto({'ports': ports, 'port': csa['dev'].portstr, 'online': csa['dev'].online, 'net': csa['net'], 'mac': csa['mac']}, src)
            else:
                await sock.sendto({'ports': ports, 'port': None, 'online': False, 'net': csa['net'], 'mac': csa['mac']}, src)
        
        elif dat['action'] == 'open' and not csa['dev']:
            try:
                csa['dev'] = CDBusSerial(dat['port'], baud=dat['baud'])
                await sock.sendto('successed', src)
            except Exception as err:
                logger.warning(f'open dev err: {err}')
                await sock.sendto(f'err: {err}', src)
        
        elif dat['action'] == 'close' and csa['dev']:
            logger.info('stop dev')
            csa['dev'].stop()
            logger.info('stop finished')
            csa['dev'] = None
            await sock.sendto('successed', src)
        
        elif dat['action'] == 'set_local':
            logger.info('set_local')
            csa['net'] = dat['net']
            csa['mac'] = dat['mac']
            await sock.sendto('successed', src)
        
        else:
            await sock.sendto('err: dev: unknown cmd', src)
            

async def cfgs_service(): # read configs
    for cfg in os.listdir('configs'):
        if cfg.endswith('.json'):
            csa['cfgs'].append(cfg)
    
    sock = CDWebSocket(ws_ns, 'cfgs')
    while True:
        dat, src = await sock.recvfrom()
        logger.debug(f'cfgs ser: {dat}')
        
        if dat['action'] == 'get_cfgs':
            await sock.sendto(csa['cfgs'], src)
        
        elif dat['action'] == 'get_cfg':
            with open(os.path.join('configs', dat['cfg'])) as c_file:
                c = json5.load(c_file)
                await sock.sendto(c, src)
        
        else:
            await sock.sendto('err: cfgs: unknown cmd', src)


async def port_service(): # alloc ports
    sock = CDWebSocket(ws_ns, 'port')
    while True:
        dat, src = await sock.recvfrom()
        path = src[0]
        logger.debug(f'port ser: {dat}, path: {path}')
        
        if path not in csa['palloc']:
            csa['palloc'][path] = []
        
        if dat['action'] == 'clr_all':
            logger.debug(f'port clr_all')
            csa['palloc'][path] = []
            await sock.sendto('successed', src)
        
        elif dat['action'] == 'get_port':
            if dat['port']:
                if dat['port'] not in csa['palloc'][path]:
                    csa['palloc'][path].append(dat['port'])
                    logger.debug(f'port alloc {dat["port"]}')
                    await sock.sendto(dat['port'], src)
                else:
                    logger.error(f'port alloc error')
                    await sock.sendto(-1, src)
            else:
                p = -1
                for i in range(0x80, 0x100):
                    if i not in csa['palloc'][path]:
                        p = i
                        csa['palloc'][path].append(p)
                        break
                logger.debug(f'port alloc: {p}')
                await sock.sendto(p, src)
        
        else:
            await sock.sendto('err: port: unknown cmd', src)


async def open_brower():
    proc = await asyncio.create_subprocess_shell('/opt/google/chrome/chrome --app=http://localhost:8910')
    await proc.communicate()
    #proc = await asyncio.create_subprocess_shell('chromium --app=http://localhost:8910')
    #await proc.communicate()
    logger.info('open brower done.')


if __name__ == "__main__":
    csa['proxy'] = CDWebSocket(ws_ns, 'proxy')
    csa['async_loop'] = asyncio.get_event_loop();
    csa['async_loop'].create_task(start_web())
    csa['async_loop'].create_task(cfgs_service())
    csa['async_loop'].create_task(dev_service())
    csa['async_loop'].create_task(port_service())
    csa['async_loop'].create_task(cdbus_proxy_service())
    
    from plugins.iap import iap_init
    iap_init(csa)
    
    #csa['async_loop'].create_task(open_brower())
    logger.info('Please open url: http://localhost:8910')
    csa['async_loop'].run_forever()

