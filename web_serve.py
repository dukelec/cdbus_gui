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
import websockets
from http import HTTPStatus
from cd_ws import CDWebSocket, CDWebSocketNS

ws_ns = CDWebSocketNS('server')


# https://gist.github.com/artizirk/04eb23d957d7916c01ca632bb27d5436

class FileServer(websockets.WebSocketServerProtocol):
    async def process_request(self, path, request_headers):
        if "Upgrade" in request_headers:
            return  # Probably a WebSocket connection
        path = path.split('?')[0]
        if path == '/':
            path = '/index.html'
        response_headers = [
            ('Server', 'asyncio'),
            ('Connection', 'close'),
        ]
        server_root = os.path.join(os.getcwd(), 'html')
        full_path = os.path.realpath(os.path.join(server_root, path[1:]))
        print("GET", path, end=' ')

        # Validate the path
        if os.path.commonpath((server_root, full_path)) != server_root or \
                not os.path.exists(full_path) or not os.path.isfile(full_path):
            print("404 NOT FOUND")
            return HTTPStatus.NOT_FOUND, [], b'404 NOT FOUND'

        print("200 OK")
        body = open(full_path, 'rb').read()
        response_headers.append(('Content-Length', str(len(body))))
        response_headers.append(('Content-Type', mimetypes.MimeTypes().guess_type(full_path)[0]))
        return HTTPStatus.OK, response_headers, body


async def serve(ws, path):
    try:
        print(f'ws: connect, path: {path}')
        if path in ws_ns.connections:
            print(f'ws: only allow one connection for: {path}')
            return
        ws_ns.connections[path] = ws
        while True:
            msg_ = await ws.recv()
            msg = umsgpack.unpackb(msg_)
            if msg['dst'][0] != 'server':
                print('ws: addr error')
                return
            sock = ws_ns.sockets[msg['dst'][1]]
            sock.recv_q.put_nowait((msg['dat'], msg['src']))
    
    except websockets.exceptions.ConnectionClosed:
        pass
    #except:
    #    pass
    
    del ws_ns.connections[path]
    print(f'ws: disconnect, path: {path}')


def start_web(addr='localhost', port=8080):
    start_server = websockets.serve(serve, addr, port, create_protocol=FileServer)
    asyncio.get_event_loop().run_until_complete(start_server)
    #asyncio.get_event_loop().run_forever()

