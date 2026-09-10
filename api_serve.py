#!/usr/bin/env python3
#
# Software License Agreement (MIT License)
#
# Author: Duke Fong <d@d-l.io>
#
# External control API, for scripts (e.g. let an AI tune PID automatically):
#
#   script --HTTP--> api_serve --websocket--> device web page --> device
#
# The web page does the real work, because it owns the config file, the
# register groups, the plot buffers and the log. So a script sees exactly
# what the user sees, waveforms keep showing up in the browser, and every
# step the script takes is printed in the page log window.
#
# Only one page is allowed per device address, so "the page" is unambiguous.

import asyncio
import json
import logging
from aiohttp import web
from cd_ws import CDWebSocket
from web_serve import ws_ns
import cd_watch

logger = logging.getLogger('cdgui.api')

api = {
    'sock': None,   # CDWebSocket on port 'api'
    'pages': {},    # ws path: {'tgt': , 'name': , 'cfg': , 'plots': }
    'waits': {},    # req id: future
    'id': 0,
    'allow_iap': False
}


def list_pages():
    for path in list(api['pages'].keys()):
        if path not in ws_ns.connections:
            logger.info(f'page gone: {path}')
            del api['pages'][path]
    return api['pages']


def find_page(dev):
    """Match a device by its address, or by the name given on the index page."""
    pages = list_pages()
    for path, info in pages.items():
        if dev == info.get('tgt') or dev == path.lstrip('/'):
            return path
    for path, info in pages.items():
        if dev == info.get('name'):
            return path
    return None


async def call(dev, cmd, args=None, timeout=20):
    path = find_page(dev)
    if not path:
        opened = [i.get('name') or i.get('tgt') for i in list_pages().values()]
        raise web.HTTPNotFound(text=f'err: no page opened for device "{dev}", opened: {opened}\n')

    api['id'] = (api['id'] + 1) & 0xffffff
    rid = api['id']
    fut = asyncio.get_running_loop().create_future()
    api['waits'][rid] = fut
    try:
        ret = await api['sock'].sendto({'id': rid, 'cmd': cmd, 'args': args or {}}, (path, 'api'))
        if ret:
            raise web.HTTPServiceUnavailable(text=f'err: send to page failed: {ret}\n')
        rep = await asyncio.wait_for(fut, timeout)
    except asyncio.TimeoutError:
        raise web.HTTPGatewayTimeout(text=f'err: page did not answer "{cmd}" in {timeout}s\n')
    finally:
        api['waits'].pop(rid, None)

    if rep.get('err'):
        raise web.HTTPBadRequest(text=f'err: {rep["err"]}\n')
    return rep.get('ret')


async def api_service():
    sock = api['sock']
    while True:
        dat, src = await sock.recvfrom()
        if not isinstance(dat, dict):
            logger.warning(f'api: bad msg from {src}: {dat}')
            continue

        if dat.get('cmd') == 'hello':
            api['pages'][src[0]] = dat.get('args') or {}
            logger.info(f'api: page online: {src[0]}: {api["pages"][src[0]]}')
            await sock.sendto({'allow_iap': api['allow_iap']}, src)
            continue

        fut = api['waits'].get(dat.get('id'))
        if fut and not fut.done():
            fut.set_result(dat)
        else:
            logger.warning(f'api: drop late reply: {dat.get("id")}')


# ---------------------------------------------------------------- routes

def q_int(request, key, dft=None):
    v = request.query.get(key)
    if v is None or v == '':
        return dft
    try:
        return int(v, 0)
    except ValueError:
        raise web.HTTPBadRequest(text=f'err: "{key}" is not an integer: {v}\n')


def q_float(request, key, dft=None):
    v = request.query.get(key)
    if v is None or v == '':
        return dft
    try:
        return float(v)
    except ValueError:
        raise web.HTTPBadRequest(text=f'err: "{key}" is not a number: {v}\n')


def m_int(request, key):
    try:
        return int(request.match_info[key], 0)
    except ValueError:
        raise web.HTTPBadRequest(text=f'err: "{key}" is not an integer: {request.match_info[key]}\n')


def as_text(val):
    if isinstance(val, str):
        return web.Response(text=val if val.endswith('\n') else val + '\n')
    return web.json_response(val)


async def h_devs(request):
    pages = list_pages()
    ret = [{'tgt': i.get('tgt'), 'name': i.get('name'), 'cfg': i.get('cfg'),
            'plots': i.get('plots', 0)} for i in pages.values()]
    return web.json_response(ret)


async def h_info(request):
    return web.json_response(await call(request.match_info['dev'], 'info'))


async def h_reg_get(request):
    names = request.query.get('names')
    args = {'names': [n for n in names.split(',') if n] if names else None}
    return web.json_response(await call(request.match_info['dev'], 'reg_read', args, timeout=60))


async def h_reg_get_one(request):
    name = request.match_info['name']
    ret = await call(request.match_info['dev'], 'reg_read', {'names': [name]})
    if ret.get(name) is None:
        raise web.HTTPBadRequest(text=f'err: reg read disabled: {name}\n')
    return as_text(ret[name])


async def h_reg_put_one(request):
    name = request.match_info['name']
    val = (await request.text()).strip()
    args = {'vals': {name: val}, 'refresh': request.query.get('refresh', '1') != '0'}
    await call(request.match_info['dev'], 'reg_write', args, timeout=60)
    return as_text('ok')


async def h_reg_post(request):
    try:
        vals = json.loads(await request.text())
    except Exception as err:
        raise web.HTTPBadRequest(text=f'err: body is not json: {err}\n')
    if not isinstance(vals, dict):
        raise web.HTTPBadRequest(text='err: body must be a json object: {"reg_name": "value"}\n')
    args = {'vals': {k: str(v) for k, v in vals.items()},
            'refresh': request.query.get('refresh', '1') != '0'}
    await call(request.match_info['dev'], 'reg_write', args, timeout=60)
    return as_text('ok')


async def h_log(request):
    args = {'since': q_int(request, 'since', 0), 'max': q_int(request, 'max', 100000)}
    return web.json_response(await call(request.match_info['dev'], 'log_read', args))


async def h_log_clear(request):
    await call(request.match_info['dev'], 'log_clear')
    return as_text('ok')


async def h_plot_en(request):
    body = (await request.text()).strip().lower()
    en = body not in ('0', 'false', 'off', 'no')
    args = {'idx': m_int(request, 'idx'), 'en': en}
    await call(request.match_info['dev'], 'plot_en', args, timeout=30)
    return as_text('ok')


async def h_plot_cfg(request):
    try:
        body = json.loads(await request.text())
    except Exception as err:
        raise web.HTTPBadRequest(text=f'err: body is not json: {err}\n')
    if not isinstance(body, dict):
        raise web.HTTPBadRequest(text='err: body must be a json object: '
                                      '{"label": [...], "cal": {...}}\n')
    args = {'idx': m_int(request, 'idx')}
    for k in ('label', 'cal'):  # only touch what the caller sent
        if k in body:
            args[k] = body[k]
    return web.json_response(await call(request.match_info['dev'], 'plot_cfg', args, timeout=30))


async def h_plot_get(request):
    series = request.query.get('series')
    args = {
        'idx':    m_int(request, 'idx'),
        'start':  q_float(request, 'start'),
        'end':    q_float(request, 'end'),
        'tail':   q_int(request, 'tail'),
        'step':   q_int(request, 'step', 1),
        'digits': q_int(request, 'digits', 6),
        'series': [s for s in series.split(',') if s] if series else None,
        'fmt':    request.query.get('fmt', 'csv')
    }
    ret = await call(request.match_info['dev'], 'plot_read', args, timeout=30)
    if args['fmt'] == 'csv':
        return web.Response(text=ret, content_type='text/csv')
    return web.json_response(ret)


async def h_plot_clear(request):
    args = {'idx': m_int(request, 'idx')}
    await call(request.match_info['dev'], 'plot_clear', args)
    return as_text('ok')


async def h_iap_post(request):
    if not api['allow_iap']:
        raise web.HTTPForbidden(text='err: iap is disabled, start the backend with --api-iap\n')
    try:
        args = json.loads(await request.text())
    except Exception as err:
        raise web.HTTPBadRequest(text=f'err: body is not json: {err}\n')
    await call(request.match_info['dev'], 'iap_start', args, timeout=30)
    return as_text('ok')


async def h_iap_get(request):
    return web.json_response(await call(request.match_info['dev'], 'iap_status'))


async def h_iap_stop(request):
    await call(request.match_info['dev'], 'iap_stop')
    return as_text('ok')


HELP = '''\
CDBUS GUI external API. A page for the device must be opened in the browser.
{dev} is the device address (e.g. 80:00:fe) or the name set on the index page.

  GET    /api/devs                        list opened device pages
  GET    /api/dev/{dev}/info              device info, reg list, plot list
  GET    /api/dev/{dev}/reg               read all readable regs      [?names=a,b]
  GET    /api/dev/{dev}/reg/{name}        read one reg
  PUT    /api/dev/{dev}/reg/{name}        write one reg, body is the value
  POST   /api/dev/{dev}/reg               write regs, body {"name": val, ...}
                                          both writes accept ?refresh=0 to skip
                                          the read-back before write
  GET    /api/dev/{dev}/log               log text        [?since=N&max=N]
  DELETE /api/dev/{dev}/log               drop buffered log
  POST   /api/dev/{dev}/plot/{idx}/en     body "1" or "0", start/stop waveform
  POST   /api/dev/{dev}/plot/{idx}/cfg    pick channels, body
                                          {"label":["N","a","b"],"cal":{"e":"..."}}
  GET    /api/dev/{dev}/plot/{idx}        waveform as csv
                                          [?tail=N | ?start=X&end=X]
                                          [&step=N&digits=N&series=a,b&fmt=json]
  DELETE /api/dev/{dev}/plot/{idx}        clear waveform buffer
  POST   /api/dev/{dev}/iap               body {"path":..,"action":..,"check":..}
  GET    /api/dev/{dev}/iap               iap progress
  DELETE /api/dev/{dev}/iap               stop a running iap
'''


async def h_help(request):
    return web.Response(text=HELP)


async def start_api(addr, port):
    app = web.Application()
    app.add_routes([
        web.get('/', h_help),
        web.get('/api', h_help),
        web.get('/api/devs', h_devs),
        web.get('/api/dev/{dev}/info', h_info),
        web.get('/api/dev/{dev}/reg', h_reg_get),
        web.post('/api/dev/{dev}/reg', h_reg_post),
        web.get('/api/dev/{dev}/reg/{name}', h_reg_get_one),
        web.put('/api/dev/{dev}/reg/{name}', h_reg_put_one),
        web.get('/api/dev/{dev}/log', h_log),
        web.delete('/api/dev/{dev}/log', h_log_clear),
        web.post('/api/dev/{dev}/plot/{idx}/en', h_plot_en),
        web.post('/api/dev/{dev}/plot/{idx}/cfg', h_plot_cfg),
        web.get('/api/dev/{dev}/plot/{idx}', h_plot_get),
        web.delete('/api/dev/{dev}/plot/{idx}', h_plot_clear),
        web.post('/api/dev/{dev}/iap', h_iap_post),
        web.get('/api/dev/{dev}/iap', h_iap_get),
        web.delete('/api/dev/{dev}/iap', h_iap_stop),
    ])
    runner = web.AppRunner(app, access_log=None)
    await runner.setup()
    site = web.TCPSite(runner, addr, port)
    await site.start()
    logger.info(f'api server on http://{addr}:{port}')
    while True:
        await asyncio.sleep(3600)


def api_init(csa, addr='localhost', port=8911, allow_iap=False):
    api['allow_iap'] = allow_iap
    api['sock'] = CDWebSocket(ws_ns, 'api')
    cd_watch.create_task(api_service(), 'api_service')
    cd_watch.create_task(start_api(addr, port), 'api_server')
