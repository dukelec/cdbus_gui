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
  --ip6-prefix PREFIX   # default: fdcd::
  --port-base  BASE     # default: 0xcd00
"""

import os, sys, re
import _thread
import socket, select, ipaddress, struct
import time, datetime
import copy, json5
import asyncio, aiohttp
import websockets
from cd_ws import CDWebSocket, CDWebSocketNS
from web_serve import ws_ns, start_web

sys.path.append(os.path.join(os.path.dirname(__file__), 'pycdnet'))

from cdnet.utils.log import *
from cdnet.utils.cd_args import CdArgs


csa = {
    'async_loop': None,
    'udp': False,
    'udp_socks': {},    # port: sock
    'net': 0x00,        # local net
    'mac': 0x00,        # local mac
    'proxy': None,      # cdbus frame proxy socket
    'cfgs': [],         # config list
    'palloc': {},       # ports alloc, url_path: []
}

args = CdArgs()
if args.get("--help", "-h") != None:
    print(__doc__)
    exit()

csa['net'] = int(args.get("--local-net", dft="0x00"), 0)
csa['mac'] = int(args.get("--local-mac", dft="0x00"), 0)
udp_ip_prefix = args.get("--ip6-prefix", dft="fdcd::")
udp_port_base = int(args.get("--port-base", dft="0xcd00"), 0)

if args.get("--verbose", "-v") != None:
    logger_init(logging.VERBOSE)
elif args.get("--debug", "-d") != None:
    logger_init(logging.DEBUG)
else:
    logger_init(logging.INFO)

logging.getLogger('websockets').setLevel(logging.WARNING)
logger = logging.getLogger(f'cdgui')


def addr_ip2cdnet(addr):
    full_ip = ipaddress.IPv6Address(addr).exploded
    tmp = full_ip[32:]
    return tmp[0:5] + ':' + tmp[5:]

def addr_cdnet2ip(addr):
    tmp = addr.split(':')
    return f'{udp_ip_prefix}{tmp[0]}:{tmp[1]}{tmp[2]}'


# proxy to html: ('/x0:00:dev_mac', host_port) <- ('server', 'proxy'): { 'src': src, 'dat': payloads }
async def proxy_rx_rpt(rx):
    src, dst, dat = rx
    logger.debug(f'rx_rpt: src: {src}, dst: {dst}, dat: {dat}')
    if dst[1] == 0x9:
        time_str = datetime.datetime.now().strftime("%H:%M:%S.%f")[:-3].encode()
        # dbg and dev_info msg also send to index.html 
        dat4idx = re.sub(b'\n(?!$)', b'\n' + b' ' * 25, dat) # except the end '\n'
        dat4idx = time_str + b' [' + src[0].encode() + b']' + b': ' + dat4idx
        await csa['proxy'].sendto({'src': src, 'dat': dat4idx}, (f'/', 0x9))
        dat = re.sub(b'\n(?!$)', b'\n' + b' ' * 14, dat)
        dat = time_str + b': ' + dat
    ret = await csa['proxy'].sendto({'src': src, 'dat': dat}, (f'/{src[0]}', dst[1]))
    if ret:
        logger.warning(f'rx_rpt err: {ret}: /{src[0]}:{dst[1]}, {dat}')


def udp_socks_update():
    new_ports = []
    for url in csa['palloc']:
        for p in csa['palloc'][url]:
            if p not in new_ports:
                new_ports.append(p)
    for p in list(csa['udp_socks'].keys()):
        if p not in new_ports:
            csa['udp_socks'][p].close()
            del(csa['udp_socks'][p])
    for p in new_ports:
        if p not in csa['udp_socks']:
            s = socket.socket(socket.AF_INET6, socket.SOCK_DGRAM)
            s.setsockopt(socket.IPPROTO_IPV6, socket.IPV6_RECVPKTINFO, 1)
            s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            s.bind(('::', p + udp_port_base))
            csa['udp_socks'][p] = s


def proxy_rx():
    logger.info('start proxy_rx')
    while True:
        try:
            readable, _, _ = select.select(csa['udp_socks'].values(), [], [], 0.5)
            if not readable:
                continue
            for s in readable:
                dat, ancdata, _, src_addr = s.recvmsg(1024, 1024)
                dst_ip = None
                for cmsg_level, cmsg_type, cmsg_data in ancdata:
                    if cmsg_level == socket.IPPROTO_IPV6 and cmsg_type == socket.IPV6_PKTINFO:
                        dst_ip = socket.inet_ntop(socket.AF_INET6, cmsg_data[:16])
                        break
                if not dst_ip:
                    continue
                dst_ip = addr_ip2cdnet(dst_ip)
                dst_port = s.getsockname()[1] - udp_port_base
                src_ip = addr_ip2cdnet(src_addr[0])
                src_port = src_addr[1]
                rx = (src_ip, src_port), (dst_ip, dst_port), dat
                asyncio.run_coroutine_threadsafe(proxy_rx_rpt(rx), csa['async_loop']).result()
        except Exception as err:
            logger.warning(f'proxy_rx: err: {err}')

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
            dst_ip = addr_cdnet2ip(wc_dat['dst'][0])
            dst_port = wc_dat['dst'][1]
            src_ip = addr_cdnet2ip(f'{wc_src[0][1:3]}:{csa["net"]:02x}:{csa["mac"]:02x}')
            src_port = wc_src[1]
            s = csa['udp_socks'][src_port]
            pktinfo = socket.inet_pton(socket.AF_INET6, src_ip) + struct.pack("@I", 0)
            ancdata = [(socket.IPPROTO_IPV6, socket.IPV6_PKTINFO, pktinfo)]
            s.sendmsg([wc_dat['dat']], ancdata, 0, (dst_ip, dst_port))
        except Exception as err:
            logger.warning(f'proxy_tx: err: {err}')


async def dev_service(): # cdbus tty setup
    sock = CDWebSocket(ws_ns, 'dev')
    while True:
        dat, src = await sock.recvfrom()
        logger.debug(f'dev ser: {dat}')
        
        if dat['action'] == 'get':
            await sock.sendto('udp', src)
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
            udp_socks_update()
            await sock.sendto('successed', src)
        
        elif dat['action'] == 'get_port':
            if dat['port']:
                if dat['port'] not in csa['palloc'][path]:
                    csa['palloc'][path].append(dat['port'])
                    logger.debug(f'port alloc {dat["port"]}')
                    udp_socks_update()
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
                udp_socks_update()
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

