#!/usr/bin/env python3
#
# Software License Agreement (MIT License)
#
# Author: Duke Fong <d@d-l.io>
#
# Static asset caching: pages (.html) are always revalidated (no-cache), and every url they
# use for our own css / js carries ?v=<version-content hash> (the ?v=__V__ placeholder in the
# source is filled in when the file is sent), such urls are cached for a year as immutable.
# Change any front end file and the hash changes -> the urls change -> the browser is bound to
# fetch the new files, and it can never pair an old script with a new page.
# The version is rechecked on every request, so editing a front end file takes effect on the next
# reload without restarting the tool: were it pinned at startup, an edited file would keep the old
# ?v= url and the browser would go on using its cached copy of the file before the edit.
# Third party files under libs/ carry their version in the file name, they are immutable as they
# are (a new version means a new file name).
#

import os
import re
import hashlib
import asyncio
import mimetypes
import umsgpack
import logging
import websockets
from urllib.parse import parse_qs
from websockets.server import serve
from http import HTTPStatus
from cd_ws import CDWebSocket, CDWebSocketNS

ws_ns = CDWebSocketNS('server')
logger = logging.getLogger(f'cdgui.web')

WS_CLOSE_DUPLICATE = 4001 # close code: the same page is already opened in another window

HTML = os.path.realpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'html'))
TOKEN = '__V__'         # the version placeholder in our own front end files (written as ?v=__V__)
IMMUTABLE = 'public, max-age=31536000, immutable'
INJECT_EXT = ('.html', '.js')   # our own files the placeholder is filled in for (libs/ excluded)


def own_files():
    # all our own front end files, libs/ excluded (those are versioned by their file name)
    paths = []
    for root, dirs, files in os.walk(HTML):
        dirs[:] = [d for d in dirs if d != 'libs']
        paths += [os.path.join(root, f) for f in files]
    return sorted(paths)


_ver_cache = {'sig': None, 'ver': '0'}

def get_asset_ver():
    # "version-content hash", e.g. v3.0-1a2b3c4d5e: the version comes from VERSION in html/common.js,
    # the hash from the content of all our own front end files. Called for every request, but all it
    # normally does is stat them; the hash is recomputed only once something really changed, so the
    # version follows the files right away without making the browser re-download an unchanged one.
    try:
        paths = own_files()
        sig = []
        for p in paths:
            st = os.stat(p)
            sig.append((p, st.st_mtime_ns, st.st_size))
        sig = tuple(sig)
        if sig != _ver_cache['sig']:
            h = hashlib.sha1()
            for p in paths:
                with open(p, 'rb') as fh:
                    h.update(os.path.relpath(p, HTML).encode() + fh.read())
            with open(os.path.join(HTML, 'common.js'), encoding='utf-8') as f:
                m = re.search(r"VERSION\s*=\s*'([^']+)'", f.read())
            v = m.group(1) if m else '0'
            _ver_cache['sig'] = sig
            _ver_cache['ver'] = f'{v}-{h.hexdigest()[:10]}'
    except OSError:
        pass        # a file is being written right now, keep the version we had
    return _ver_cache['ver']


async def http_file_server(path, request):
    if "upgrade" in request.get("Connection", "").lower():
        return None
    path, _, query = path.partition('?')
    if path.endswith('/'):
        path += 'index.html'
    response_headers = [
        ('Server', 'asyncio'),
        ('Connection', 'close'),
    ]
    full_path = os.path.realpath(os.path.join(HTML, path[1:]))
    log_str = f'GET {path}'

    # Validate the path
    if os.path.commonpath((HTML, full_path)) != HTML or \
            not os.path.exists(full_path) or not os.path.isfile(full_path):
        logger.warning(f'{log_str} 404 NOT FOUND')
        return HTTPStatus.NOT_FOUND, response_headers, b'404 NOT FOUND'

    in_libs = os.path.relpath(full_path, HTML).split(os.sep)[0] == 'libs'
    ext = os.path.splitext(full_path)[1]
    if not in_libs and ext in INJECT_EXT:
        # our own html / js: fill in the version placeholder before sending
        with open(full_path, encoding='utf-8') as f:
            body = f.read().replace(TOKEN, get_asset_ver()).encode()
        content_type = ('text/html' if ext == '.html' else 'text/javascript') + '; charset=utf-8'
    else:
        with open(full_path, 'rb') as f:
            body = f.read()
        content_type = mimetypes.MimeTypes().guess_type(full_path)[0] or 'application/octet-stream'

    # a url with ?v= only ever serves one content, so it may be cached for good; pages are
    # revalidated every time, an unchanged one costs a 304 without the body
    response_headers.append(('Cache-Control', IMMUTABLE if (in_libs or 'v' in parse_qs(query)) else 'no-cache'))
    etag = f'"{hashlib.sha1(body).hexdigest()[:20]}"'
    response_headers.append(('ETag', etag))
    if etag in [t.strip() for t in request.get('If-None-Match', '').split(',')]:
        logger.info(f'{log_str} 304 NOT MODIFIED')
        return HTTPStatus.NOT_MODIFIED, response_headers, b''

    logger.info(f'{log_str} 200 OK')
    response_headers.append(('Content-Length', str(len(body))))
    response_headers.append(('Content-Type', content_type))
    return HTTPStatus.OK, response_headers, body


async def ws_handler(ws, path):
    try:
        logger.info(f'ws: connect, path: {path}')
        if path in ws_ns.connections:
            logger.warning(f'ws: only allow one connection for: {path}')
            await ws.close(WS_CLOSE_DUPLICATE, 'duplicate connection')
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

