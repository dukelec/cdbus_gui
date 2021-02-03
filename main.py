#!/usr/bin/env python3

import os, sys
import _thread
import datetime
import copy
import json5
import asyncio
import aiohttp
import websockets
from time import sleep
from serial.tools import list_ports
from cd_ws import CDWebSocket, CDWebSocketNS
from web_serve import ws_ns, start_web

sys.path.append(os.path.join(os.path.dirname(__file__), 'pycdnet'))

from cdnet.utils.log import *
from cdnet.utils.cd_args import CdArgs
from cdnet.dev.cdbus_serial import CDBusSerial
from cdnet.dev.cdbus_bridge import CDBusBridge
from cdnet.utils.serial_get_port import get_ports
from cdnet.dispatch import *
from cdnet.parser import *

#logger_init(logging.VERBOSE)
#logger_init(logging.DEBUG)
logger_init(logging.INFO)
logging.getLogger('websockets').setLevel(logging.WARNING)

csa = {
    'async_loop': None,
    'dev': None,    # serial device
    'net': 0x00,    # local net
    'mac': 0x00,    # local mac
    'proxy': None,  # cdbus frame proxy socket
    'cfgs': []      # config list
}

# only support dev address in format 80:NN:MM and a0:NN:MM
# proxy to html: ('/80:00:dev_mac', host_port) <- ('server', 'proxy'): { 'src': src, 'seq': seq, 'dat': payloads }
async def cdbus_rx_rpt(rx):
    src, dst, dat, seq = rx
    ret = await csa['proxy'].sendto({'src': src, 'seq': seq, 'dat': dat}, (f'/{src[0]}', dst[1]))
    if ret:
        print(f'proxy -> html, {ret}: /{src[0]}:{dst[1]}, {dat}')
    
    print(src, dst)
    if src[1] == 0x9 or src[1] == 0x1: # dbg and dev_info msg also send to index.html
        await csa['proxy'].sendto({'src': src, 'seq': seq, 'dat': dat}, (f'/', 0x9))

def cdbus_rx():
    print('start cdbus_rx')
    while True:
        if not csa['dev']:
            sleep(0.5)
            continue
        frame = csa['dev'].recv(timeout=0.5)
        if frame:
            try:
                rx = cdnet_l1.from_frame(frame, csa['net'])
                print('cdbus_rx', frame)
                asyncio.run_coroutine_threadsafe(cdbus_rx_rpt(rx), csa['async_loop']).result()
                print('cdbus_rx done')
            except:
                print('cdbus_rx fmt err', frame)
    
    print('exit cdbus_rx')

_thread.start_new_thread(cdbus_rx, ())

# proxy to dev, ('/80:00:dev_mac', host_port) -> ('server', 'proxy'): { 'dst': dst, 'seq': seq, 'dat': payloads }
async def cdbus_proxy_service():
    while True:
        frame = None
        wc_dat, wc_src = await csa['proxy'].recvfrom()
        print('cdbus ser', wc_dat)
        if len(wc_src[0]) != 9:
            print(f'proxy to dev: wc_src err: {wc_src}')
            return
        try:
            seq = wc_dat['seq'] if 'seq' in wc_dat else None
            frame = cdnet_l1.to_frame((f'{wc_src[0][1:3]}:{csa["net"]:02x}:{csa["mac"]:02x}', wc_src[1]), \
                                       wc_dat['dst'], wc_dat['dat'], csa['mac'], seq)
            print('cdbus_tx frame', frame)
        except:
            print('cdbus_tx fmt err')
        
        if frame and csa['dev']:
            csa['dev'].send(frame)
            print('cdbus_tx done')


async def dev_service(): # cdbus hw setup
    sock = CDWebSocket(ws_ns, 'dev')
    while True:
        dat, src = await sock.recvfrom()
        print('dev ser', dat)
        
        if dat['action'] == 'get':
            ports = get_ports()
            if csa['dev']:
                await sock.sendto({'ports': ports, 'port': csa['dev'].portstr, 'online': csa['dev'].online, 'net': csa['net'], 'mac': csa['mac']}, src)
            else:
                await sock.sendto({'ports': ports, 'port': None, 'online': False, 'net': csa['net'], 'mac': csa['mac']}, src)
        
        elif dat['action'] == 'open' and not csa['dev']:
            try:
                if dat['bridge']:
                    csa['dev'] = CDBusBridge(dat['port'])
                else:
                    csa['dev'] = CDBusSerial(dat['port'], baud=dat['baud'])
                await sock.sendto('successed', src)
            except Exception as err:
                print('open dev err:', err)
                await sock.sendto(f'err: {err}', src)
        
        elif dat['action'] == 'close' and csa['dev']:
            print('stop dev')
            csa['dev'].stop()
            print('stop finished')
            csa['dev'] = None
            await sock.sendto('successed', src)
        
        elif dat['action'] == 'set_local':
            print('set_local')
            csa['net'] = dat['net']
            csa['mac'] = dat['mac']
            await sock.sendto('successed', src)
        
        else:
            await sock.sendto('err: dev: unknown cmd', src)
            

async def file_service(): # config r/w
    for cfg in os.listdir('configs'):
        if cfg.endswith('.json'):
            csa['cfgs'].append(cfg)
    
    sock = CDWebSocket(ws_ns, 'file')
    while True:
        dat, src = await sock.recvfrom()
        print('file ser', dat)
        
        if dat['action'] == 'get_cfgs':
            await sock.sendto(csa['cfgs'], src)
        
        elif dat['action'] == 'get_cfg':
            with open(os.path.join('configs', dat['cfg'])) as c_file:
                c = json5.load(c_file)
                await sock.sendto(c, src)
        
        elif dat['action'] == 'get_bin':
            with open(dat['path'], 'rb') as b_file:
                await sock.sendto(b_file.read(), src)
        
        else:
            await sock.sendto('err: file: unknown cmd', src)


async def open_brower():
    proc = await asyncio.create_subprocess_shell('/opt/google/chrome/chrome --app=http://localhost:8910')
    await proc.communicate()
    #proc = await asyncio.create_subprocess_shell('chromium --app=http://localhost:8910')
    #await proc.communicate()
    print('open brower done.')


if __name__ == "__main__":
    start_web(None)
    csa['proxy'] = CDWebSocket(ws_ns, 'proxy')
    csa['async_loop'] = asyncio.get_event_loop();
    asyncio.get_event_loop().create_task(file_service())
    asyncio.get_event_loop().create_task(dev_service())
    asyncio.get_event_loop().create_task(cdbus_proxy_service())
    #asyncio.get_event_loop().create_task(open_brower())
    print('Please open url: http://localhost:8910')
    asyncio.get_event_loop().run_forever()

