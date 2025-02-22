#!/usr/bin/env python3
#
# Software License Agreement (MIT License)
#
# Author: Duke Fong <d@d-l.io>
#

import os
import asyncio
import mimetypes
import umsgpack
import logging
import websockets
from websockets.server import serve
from http import HTTPStatus
from cd_ws import CDWebSocket, CDWebSocketNS

ws_ns = CDWebSocketNS('server')
logger = logging.getLogger(f'cdgui.web')


async def http_file_server(path, request):
    if "upgrade" in request.get("Connection", "").lower():
        return None
    path = path.split('?')[0]
    if path == '/':
        path = '/index.html'
    response_headers = [
        ('Server', 'asyncio'),
        ('Connection', 'close'),
    ]
    server_root = os.path.join(os.getcwd(), 'html')
    full_path = os.path.realpath(os.path.join(server_root, path[1:]))
    log_str = f'GET {path}'

    # Validate the path
    if os.path.commonpath((server_root, full_path)) != server_root or \
            not os.path.exists(full_path) or not os.path.isfile(full_path):
        logger.warning(f'{log_str} 404 NOT FOUND')
        return HTTPStatus.NOT_FOUND, response_headers, b'404 NOT FOUND'

    logger.info(f'{log_str} 200 OK')
    with open(full_path, 'rb') as f:
        body = f.read()
    response_headers.append(('Content-Length', str(len(body))))
    response_headers.append(('Content-Type', mimetypes.MimeTypes().guess_type(full_path)[0] or \
            'application/octet-stream'))
    return HTTPStatus.OK, response_headers, body


async def ws_handler(ws, path):
    try:
        logger.info(f'ws: connect, path: {path}')
        if path in ws_ns.connections:
            logger.warning(f'ws: only allow one connection for: {path}')
            return
        ws_ns.connections[path] = ws
        while True:
            msg_ = await ws.recv()
            msg = umsgpack.unpackb(msg_)
            if msg['dst'][0] != 'server':
                logger.warning('ws: addr error')
                return
            sock = ws_ns.sockets[msg['dst'][1]]
            sock.recv_q.put_nowait((msg['dat'], msg['src']))
    
    except websockets.exceptions.ConnectionClosed:
        pass
    #except:
    #    pass
    
    del ws_ns.connections[path]
    logger.info(f'ws: disconnect, path: {path}')


async def start_web(addr='localhost', port=8910):                                                     
    server = await serve(ws_handler, addr, port, process_request=http_file_server)
    await server.wait_closed()

