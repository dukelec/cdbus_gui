#!/usr/bin/env python3
#
# Software License Agreement (MIT License)
#
# Author: Duke Fong <d@d-l.io>

"""CDBUS GUI Tool

Args:
  --help    | -h        # this help message
  --verbose | -v        # debug level: verbose
  --debug   | -d        # debug level: debug
  --local-net LOCAL_NET # default: 0
  --local-mac LOCAL_MAC # default: 0
"""

import os, sys, re
import _thread
import time, datetime
import copy, json5
import asyncio, aiohttp
import websockets
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

csa = {
    'async_loop': None,
    'dev': None,    # serial device
    'net': 0x00,    # local net
    'mac': 0x00,    # local mac
    'proxy': None,  # cdbus frame proxy socket
    'cfgs': [],     # config list
    'palloc': {},   # ports alloc, url_path: []
}

args = CdArgs()
if args.get("--help", "-h") != None:
    print(__doc__)
    exit()

csa['net'] = int(args.get("--local-net", dft="0x00"), 0)
csa['mac'] = int(args.get("--local-mac", dft="0x00"), 0)

if args.get("--verbose", "-v") != None:
    logger_init(logging.VERBOSE)
elif args.get("--debug", "-d") != None:
    logger_init(logging.DEBUG)
else:
    logger_init(logging.INFO)

logging.getLogger('websockets').setLevel(logging.WARNING)
logger = logging.getLogger(f'cdgui')


# proxy to html: ('/x0:00:dev_mac', host_port) <- ('server', 'proxy'): { 'src': src, 'dat': payloads }
async def proxy_rx_rpt(rx):
    src, dst, dat = rx
    logger.debug(f'rx_rpt: src: {src}, dst: {dst}, dat: {dat}')
    if dst[1] == 0x9 or src[1] == 0x1:
        time_str = datetime.datetime.now().strftime("%H:%M:%S.%f")[:-3].encode()
        # dbg and dev_info msg also send to index.html 
        dat4idx = re.sub(b'\n(?!$)', b'\n' + b' ' * 25, dat) # except the end '\n'
        dat4idx = time_str + b' [' + src[0].encode() + b']' + b': ' + dat4idx
        if src[1] == 0x1:
            dat4idx += b'\n'
        await csa['proxy'].sendto({'src': src, 'dat': dat4idx}, (f'/', 0x9))
        dat = re.sub(b'\n(?!$)', b'\n' + b' ' * 14, dat)
        dat = time_str + b': ' + dat
    ret = await csa['proxy'].sendto({'src': src, 'dat': dat}, (f'/{src[0]}', dst[1]))
    if ret:
        logger.warning(f'rx_rpt err: {ret}: /{src[0]}:{dst[1]}, {dat}')

def proxy_rx():
    logger.info('start proxy_rx')
    while True:
        if not csa['dev']:
            sleep(0.5)
            continue
        frame = None
        try:
            frame = csa['dev'].recv(timeout=0.5)
            if frame:
                if frame[3] & 0x80:
                    rx = cdnet_l1.from_frame(frame, csa['net'])
                    logger.log(logging.VERBOSE, f'proxy_rx l1: {frame}')
                else:
                    rx = cdnet_l0.from_frame(frame, csa['net'])
                    logger.log(logging.VERBOSE, f'proxy_rx l0: {frame}')
                asyncio.run_coroutine_threadsafe(proxy_rx_rpt(rx), csa['async_loop']).result()
        except Exception as err:
            logger.warning(f'proxy_rx: err: {err}', frame)

_thread.start_new_thread(proxy_rx, ())

# proxy to dev, ('/x0:00:dev_mac', host_port) -> ('server', 'proxy'): { 'dst': dst, 'dat': payloads }
async def cdbus_proxy_service():
    while True:
        try:
            wc_dat, wc_src = await asyncio.wait_for(csa['proxy'].recvfrom(), 0.2)
        except asyncio.TimeoutError:
            continue
        try:
            logger.debug(f'proxy_tx: {wc_dat}, src {wc_src}')
            if len(wc_src[0]) != 9:
                logger.warning(f'proxy_tx: wc_src err: {wc_src}')
                continue
            dst_mac = int(wc_dat['dst'][0].split(':')[2], 16)
            if wc_src[0][1:3] != '00':
                frame = cdnet_l1.to_frame((f'{wc_src[0][1:3]}:{csa["net"]:02x}:{csa["mac"]:02x}', wc_src[1]), \
                                           wc_dat['dst'], wc_dat['dat'], csa['mac'], dst_mac)
                logger.log(logging.VERBOSE, f'proxy_tx frame l1: {frame}')
            else:
                frame = cdnet_l0.to_frame((f'{wc_src[0][1:3]}:{csa["net"]:02x}:{csa["mac"]:02x}', wc_src[1]), \
                                           wc_dat['dst'], wc_dat['dat'])
                logger.log(logging.VERBOSE, f'proxy_tx frame l0: {frame}')
            if csa['dev']:
                csa['dev'].send(frame)
        except Exception as err:
            logger.warning(f'proxy_tx: fmt err: {err}')


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
                for i in range(0x40, 0x80):
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
    csa['async_loop'] = asyncio.new_event_loop()
    asyncio.set_event_loop(csa['async_loop'])
    csa['proxy'] = CDWebSocket(ws_ns, 'proxy')
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

