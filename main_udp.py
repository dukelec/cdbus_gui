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
  --local-ip6 ADDRS     # local bind addresses, comma separated, default: :: (any)
  --ip6-prefix PREFIX   # default: fdcd::
  --port-base BASE      # default: 0xcd00
  --http-port HTTP_PORT # default: 8910
  --api-port API_PORT   # external api, default: 8911, 0: disable
  --api-no-iap          # refuse iap through the external api
"""

import os, sys, re
import socket, select, ipaddress
import time, datetime
import copy, json5
import asyncio, aiohttp
import websockets
from cd_ws import CDWebSocket, CDWebSocketNS
from web_serve import ws_ns, start_web, get_asset_ver
import cd_watch
import cfg_edit
import cd_pcap

sys.path.append(os.path.join(os.path.dirname(__file__), 'pycdnet'))

from cdnet.utils.log import *
from cdnet.utils.cd_args import CdArgs


csa = {
    'async_loop': None,
    'udp': False,
    'udp_socks': {},    # port: {local_ip: sock}
    'proxy': None,      # cdbus frame proxy socket
    'cfgs': [],         # config list
    'palloc': {},       # ports alloc, url_path: []
}

args = CdArgs()
if args.get("--help", "-h") != None:
    print(__doc__)
    exit()

udp_local_ips = [str(ipaddress.IPv6Address(a.strip())) for a in args.get("--local-ip6", dft="::").split(',')]
udp_ip_prefix = args.get("--ip6-prefix", dft="fdcd::")
udp_port_base = int(args.get("--port-base", dft="0xcd00"), 0)
http_port = int(args.get("--http-port", dft="8910"), 0)
api_port = int(args.get("--api-port", dft="8911"), 0)
api_iap = args.get("--api-no-iap") == None

if args.get("--verbose", "-v") != None:
    logger_init(logging.VERBOSE)
elif args.get("--debug", "-d") != None:
    logger_init(logging.DEBUG)
else:
    logger_init(logging.INFO)

logging.getLogger('websockets').setLevel(logging.WARNING)
logger = logging.getLogger(f'cdgui')


# a cdnet address is 3 bytes, level:net:mac, mapped onto the last 3 bytes of the ipv6 address
udp_ip_net = ipaddress.IPv6Network(f'{udp_ip_prefix}0:0/104', strict=False)

# level byte of each local address, None: any address
udp_local_lv = {ip: None if ipaddress.IPv6Address(ip).is_unspecified else ipaddress.IPv6Address(ip).packed[13]
                for ip in udp_local_ips}

def addr_ip2cdnet(addr):
    full_ip = ipaddress.IPv6Address(addr).exploded
    tmp = full_ip[32:]
    return tmp[0:5] + ':' + tmp[5:]

def addr_cdnet2ip(addr):
    tmp = addr.split(':')
    return f'{udp_ip_prefix}{tmp[0]}:{tmp[1]}{tmp[2]}'


# proxy to html: ('/x0:00:dev_mac', host_port) <- ('server', 'proxy'): { 'src': src, 'dat': payloads }
async def proxy_rx_rpt(rx):
    src, dst_port, dat = rx
    logger.debug(f'rx_rpt: src: {src}, dst_port: {dst_port}, dat: {dat}')
    if dst_port == 0x9 or src[1] == 0x1:
        time_str = datetime.datetime.now().strftime("%H:%M:%S.%f")[:-3].encode()
        # dbg and dev_info msg also send to index.html 
        dat4idx = re.sub(b'\n(?!$)', b'\n' + b' ' * 25, dat) # except the end '\n'
        dat4idx = time_str + b' [' + src[0].encode() + b']' + b': ' + dat4idx
        if src[1] == 0x1:
            dat4idx += b'\n'
        await csa['proxy'].sendto({'src': src, 'dat': dat4idx}, (f'/', 0x9))
        if dst_port == 0x9:
            dat = re.sub(b'\n(?!$)', b'\n' + b' ' * 14, dat)
            dat = time_str + b': ' + dat
    ret = await csa['proxy'].sendto({'src': src, 'dat': dat}, (f'/{src[0]}', dst_port))
    if ret:
        logger.warning(f'rx_rpt err: {ret}: /{src[0]}:{dst_port}, {dat}')


proxy_rx_pause = False
proxy_rx_paused = False

# wait for the receive thread to say it is paused (or running again), a bounded wait: were the
# thread dead the watchdog has said so already, hanging the port service too would help no one
async def proxy_rx_wait(paused, timeout=2.0):
    for _ in range(int(timeout / 0.05)):
        if proxy_rx_paused == paused:
            return
        await asyncio.sleep(0.05)
    logger.warning(f'proxy_rx did not {"pause" if paused else "resume"} in {timeout}s')

async def udp_socks_update(remove=False):
    global proxy_rx_pause
    if remove: # a socket is only closed while the thread is not selecting on it
        proxy_rx_pause = True
        await proxy_rx_wait(True)
    new_ports = []
    for url in csa['palloc']:
        for p in csa['palloc'][url]:
            if p not in new_ports:
                new_ports.append(p)
    # proxy_rx reads csa['udp_socks'] once per round. It is never changed in place but replaced as
    # a whole, so the thread sees either the old set or the new one, never a dict changing under
    # its iteration (which raised "dictionary changed size" on it now and then)
    old_socks = csa['udp_socks']
    new_socks = {}
    # a level 0 answer comes back to the l0 address of the tun (e.g. fdcd::) and a level 1
    # answer to the l1 one (e.g. fdcd::80:00), bind both, or :: (the default) for any
    all_bound = True
    for p in new_ports:
        socks = new_socks[p] = dict(old_socks.get(p, {}))
        for ip in udp_local_ips:
            if ip in socks:
                continue
            s = socket.socket(socket.AF_INET6, socket.SOCK_DGRAM)
            s.setsockopt(socket.IPPROTO_IPV6, socket.IPV6_V6ONLY, 1)
            try:
                s.bind((ip, p + udp_port_base))
                socks[ip] = s
            except OSError as err:
                s.close()
                all_bound = False
                cd_watch.report_fault('udp', f'bind [{ip}]:{p + udp_port_base}: {err}')
    csa['udp_socks'] = new_socks
    for p in old_socks:
        if p not in new_socks:
            for s in old_socks[p].values():
                s.close()
    if all_bound:
        cd_watch.clear_fault('udp') # a failed address is retried on the next port alloc
    if remove:
        proxy_rx_pause = False
        await proxy_rx_wait(False) # so the next pause starts from a thread known to be running


def proxy_rx():
    global proxy_rx_paused
    logger.info('start proxy_rx')
    while True:
        try:
            if proxy_rx_pause:
                proxy_rx_paused = True
                time.sleep(0.1)
                continue
            proxy_rx_paused = False
            socks = [x for v in csa['udp_socks'].values() for x in v.values()]
            if not socks: # nothing bound before the first page opens; select() on nothing is an error on windows
                time.sleep(0.2)
                continue
            readable, _, _ = select.select(socks, [], [], 0.2)
            if not readable:
                continue
            for s in readable:
                dat, src_addr = s.recvfrom(256)
                if ipaddress.IPv6Address(src_addr[0]) not in udp_ip_net:
                    logger.debug(f'proxy_rx: skip src: {src_addr}')
                    continue
                dst_port = s.getsockname()[1] - udp_port_base
                src_ip = addr_ip2cdnet(src_addr[0])
                src_port = src_addr[1]
                rx = (src_ip, src_port), dst_port, dat
                asyncio.run_coroutine_threadsafe(proxy_rx_rpt(rx), csa['async_loop']).result()
        except Exception as err:
            logger.warning(f'proxy_rx: err: {err}')

# send from a local address of the same level as the dst, else from the first one
def udp_sock_pick(socks, dst):
    if not socks:
        return None
    l0 = dst.startswith('00:')
    for ip, s in socks.items():
        lv = udp_local_lv[ip]
        if lv == None or (lv == 0) == l0:
            return s
    return next(iter(socks.values()))

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
            src_port = wc_src[1]
            s = udp_sock_pick(csa['udp_socks'].get(src_port), wc_dat['dst'][0])
            if not s:
                logger.warning(f'proxy_tx: port {src_port:#x} not bound')
                continue
            s.sendto(wc_dat['dat'], (dst_ip, dst_port))
        except Exception as err:
            logger.warning(f'proxy_tx: err: {err}')


async def dev_service(): # cdbus tty setup
    sock = CDWebSocket(ws_ns, 'dev')
    while True:
        dat, src = await sock.recvfrom()
        logger.debug(f'dev ser: {dat}')
        
        if isinstance(dat, dict) and dat.get('action') == 'get':
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
            try:
                with open(cfg_edit.cfg_path('configs', dat['cfg'], write=False)) as c_file:
                    c = json5.load(c_file)
            except (OSError, ValueError) as err:
                logger.warning(f'cfgs: get_cfg {dat.get("cfg")}: {err}')
                c = f'err: {err}'
            await sock.sendto(c, src)
        
        elif dat['action'] == 'set_cfg':
            # write the values edited on the web page back into the json5 file
            try:
                done = cfg_edit.update_cfg('configs', dat['cfg'], dat['vals'])
                logger.info(f'cfgs: {dat["cfg"]}: updated {done}')
                await sock.sendto('successed', src)
            except Exception as err:
                logger.warning(f'cfgs: set_cfg {dat.get("cfg")}: {err}')
                await sock.sendto(f'err: {err}', src)
        
        else:
            await sock.sendto('err: cfgs: unknown cmd', src)


async def port_handle(sock, dat, src):
    path = src[0]
    if path not in csa['palloc']:
        csa['palloc'][path] = []
    
    if dat['action'] == 'clr_all':
        logger.debug(f'port clr_all')
        csa['palloc'][path] = []
        await udp_socks_update(True)
        await sock.sendto('successed', src)
    
    elif dat['action'] == 'get_port':
        if dat['port']:
            if dat['port'] not in csa['palloc'][path]:
                csa['palloc'][path].append(dat['port'])
                logger.debug(f'port alloc {dat["port"]}')
                await udp_socks_update()
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
            await udp_socks_update()
            await sock.sendto(p, src)
    
    else:
        await sock.sendto('err: port: unknown cmd', src)

async def port_service(): # alloc ports
    sock = CDWebSocket(ws_ns, 'port')
    while True:
        dat, src = await sock.recvfrom()
        logger.debug(f'port ser: {dat}, path: {src[0]}')
        try:
            await port_handle(sock, dat, src)
        except Exception as err: # one bad request must not take the service down with it
            logger.warning(f'port ser: {dat}: {err}')
            await sock.sendto(f'err: port: {err}', src)


async def open_brower():
    proc = await asyncio.create_subprocess_shell(f'/opt/google/chrome/chrome --app=http://localhost:{http_port}')
    await proc.communicate()
    #proc = await asyncio.create_subprocess_shell(f'chromium --app=http://localhost:{http_port}')
    #await proc.communicate()
    logger.info('open brower done.')


if __name__ == "__main__":
    csa['async_loop'] = asyncio.new_event_loop()
    asyncio.set_event_loop(csa['async_loop'])
    csa['proxy'] = CDWebSocket(ws_ns, 'proxy')
    cd_watch.init(csa['async_loop'])
    cd_watch.start_thread(proxy_rx, 'proxy_rx')
    cd_watch.create_task(start_web(port=http_port), 'web_server', fatal=True)
    cd_watch.create_task(cfgs_service(), 'cfgs_service')
    cd_watch.create_task(dev_service(), 'dev_service')
    cd_watch.create_task(port_service(), 'port_service')
    cd_watch.create_task(cd_pcap.rec_service(None, ws_ns), 'rec_service') # no bus here: marks are dropped, the rest refused
    cd_watch.create_task(cdbus_proxy_service(), 'proxy_tx')
    cd_watch.create_task(cd_watch.watch_service(), 'watch_service')
    
    from plugins.iap import iap_init
    iap_init(csa)
    
    if api_port:
        from api_serve import api_init
        api_init(csa, port=api_port, allow_iap=api_iap)
    
    #csa['async_loop'].create_task(open_brower())
    logger.info(f'Please open url: http://localhost:{http_port} , web {get_asset_ver()}')
    csa['async_loop'].run_forever()
    sys.exit(cd_watch.exit_code)

