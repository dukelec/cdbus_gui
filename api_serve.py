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
# The serial port is set up on the index page, of which there is only one as
# well, so /api/serial goes there.

import os
import asyncio
import datetime
import json
import json5
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
    'backs': {},    # ws path: [future], waiting for a reloaded page to say hello
    'id': 0,
    'allow_iap': True
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


def brief(v, n=100):
    s = v if isinstance(v, str) else json.dumps(v, ensure_ascii=False, default=str)
    return s if len(s) <= n else s[:n] + '...'


async def api_log(path, text, err=False):
    """Print what the api is doing into the device page log and into the index
    page log, the same two places a device debug message goes. What is done on
    the index page itself goes to its log only."""
    ts = datetime.datetime.now().strftime('%H:%M:%S.%f')[:-3]
    addr = path.lstrip('/') or 'serial'
    body = f'\x1b[0;{"31" if err else "36"}m[api] {text}\x1b[0m\n'
    src = (addr, 'api')
    if path != '/':
        await api['sock'].sendto({'src': src, 'dat': f'{ts}: {body}'.encode()}, (path, 9))
    await api['sock'].sendto({'src': src, 'dat': f'{ts} [{addr}]: {body}'.encode()}, ('/', 9))


def page_of(dev):
    path = find_page(dev)
    if not path:
        opened = [i.get('name') or i.get('tgt') for i in list_pages().values()]
        raise web.HTTPNotFound(text=f'err: no page opened for device "{dev}", opened: {opened}\n')
    return path


async def call(dev, cmd, args=None, timeout=20):
    return await call_path(page_of(dev), cmd, args, timeout)


async def call_index(cmd, args=None, timeout=10):
    if '/' not in ws_ns.connections:
        raise web.HTTPNotFound(text='err: the index page is not opened, the serial port is set up '
                                    'there, open the tool\'s start page in the browser\n')
    return await call_path('/', cmd, args, timeout)


async def call_path(path, cmd, args=None, timeout=20):
    await api_log(path, f'{cmd} {brief(args or {})}')

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
        await api_log(path, f'{cmd} err: {rep["err"]}', True)
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
            info = dat.get('args') or {}
            api['pages'][src[0]] = info
            logger.info(f'api: page online: {src[0]}: {info}')
            await sock.sendto({'allow_iap': api['allow_iap']}, src)
            for fut in api['backs'].pop(src[0], []):   # a reload is over
                if not fut.done():
                    fut.set_result(info)
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
        raise web.HTTPBadRequest(text=f'err: reg read disabled: {name}, it is in no R group, '
                                      f'see GET /api/dev/{{dev}}/groups\n')
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
    for k in ('label', 'cal', 'overlay', 'save'):  # only touch what the caller sent
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


async def h_groups_get(request):
    args = {'set': request.query.get('set') or None}
    return web.json_response(await call(request.match_info['dev'], 'groups_get', args))


async def h_groups_post(request):
    try:
        body = json.loads(await request.text())
    except Exception as err:
        raise web.HTTPBadRequest(text=f'err: body is not json: {err}\n')
    if not isinstance(body, dict):
        raise web.HTTPBadRequest(text='err: body must be a json object: '
                                      '{"r": [["first", "last"], ["name"]], "w": [...]}\n')
    args = {k: body[k] for k in ('set', 'r', 'w', 'save') if k in body}  # null means the file's
    return web.json_response(await call(request.match_info['dev'], 'groups_set', args, timeout=30))


def cfg_load_err(cfg):
    """Why the page could not load its config file, read the way the backend reads it for the page."""
    if not cfg:
        return None
    try:
        with open(os.path.join('configs', cfg)) as c_file:
            json5.load(c_file)
    except (OSError, ValueError) as err:
        return f'{cfg}: {err}'
    return None


async def h_reload(request):
    """Reload the page, to take in an edited config file for one, and return once the new page
    is up and has said hello. The page is left alone when its config file does not load: it
    would come back as a dead page with nothing but an error banner."""
    dev = request.match_info['dev']
    path = page_of(dev)
    err = await asyncio.get_running_loop().run_in_executor(
            None, cfg_load_err, api['pages'][path].get('cfg'))
    if err:
        await api_log(path, f'reload refused: {err}', True)
        raise web.HTTPBadRequest(text=f'err: the config file does not load, page not reloaded: {err}\n')

    back = asyncio.get_running_loop().create_future()
    api['backs'].setdefault(path, []).append(back)
    old = api['pages'][path]
    timeout = 30
    try:
        await call(dev, 'reload')
        # gone until it says hello again, or for good if it can't; the new page's hello may
        # in theory already be in, so drop only the entry of the page that was told to go
        if api['pages'].get(path) is old:
            del api['pages'][path]
        try:
            info = await asyncio.wait_for(back, timeout)
        except asyncio.TimeoutError:
            raise web.HTTPGatewayTimeout(text=f'err: the page did not come back within {timeout}s '
                                              'of the reload, see the page in the browser for why\n')
    finally:
        backs = api['backs'].get(path, [])
        if back in backs:
            backs.remove(back)
        if not backs:
            api['backs'].pop(path, None)

    errs = info.get('cfg_errors') or []
    if errs:
        await api_log(path, f'reloaded, config errors: {brief(errs)}', True)
        return as_text('ok, but the page reports config file errors, related functions may not work:\n' +
                       ''.join(f'  {e}\n' for e in errs))
    await api_log(path, 'reloaded')
    return as_text('ok')


async def h_serial_get(request):
    return web.json_response(await call_index('serial_get'))


async def h_serial_open(request):
    body = (await request.text()).strip()
    try:
        args = json.loads(body) if body else {}
    except Exception as err:
        raise web.HTTPBadRequest(text=f'err: body is not json: {err}\n')
    if not isinstance(args, dict):
        raise web.HTTPBadRequest(text='err: body must be a json object: {"port": "ACM0", "baud": 115200}\n')
    args = {k: args[k] for k in ('port', 'baud') if k in args}
    return web.json_response(await call_index('serial_open', args))


async def h_serial_close(request):
    return web.json_response(await call_index('serial_close'))


async def h_iap_post(request):
    if not api['allow_iap']:
        raise web.HTTPForbidden(text='err: iap is disabled, the backend was started with --api-no-iap\n')
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

  GET    /api/serial                      serial port in use, its state, the
                                          ports there are (index page opened)
  POST   /api/serial/open                 body {"port":"ACM0","baud":115200},
                                          fills in the index page and opens,
                                          either one left out keeps the box's
  POST   /api/serial/close                close the serial port
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
                                          "overlay" sets the shared reg_overlay
                                          list, "save":true keeps the choice in
                                          the browser across page reloads
  GET    /api/dev/{dev}/plot/{idx}        waveform as csv
                                          [?tail=N | ?start=X&end=X]
                                          [&step=N&digits=N&series=a,b&fmt=json]
  DELETE /api/dev/{dev}/plot/{idx}        clear waveform buffer
  GET    /api/dev/{dev}/groups            R / W button groups of the set in use
                                          [?set=less]
  POST   /api/dev/{dev}/groups            change them, body
                                          {"r":[["first","last"],["name"]],"w":[...]}
                                          a side left out stays, null puts back the
                                          config file's, "set":"less" switches the
                                          set first, "save":true keeps it all in
                                          the browser across page reloads
  POST   /api/dev/{dev}/reload            reload the page, e.g. after editing its
                                          config file, returns once it is back
  POST   /api/dev/{dev}/iap               body {"path":..,"action":..,"check":..}
                                          refused if the backend runs --api-no-iap
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
        web.get('/api/serial', h_serial_get),
        web.post('/api/serial/open', h_serial_open),
        web.post('/api/serial/close', h_serial_close),
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
        web.get('/api/dev/{dev}/groups', h_groups_get),
        web.post('/api/dev/{dev}/groups', h_groups_post),
        web.post('/api/dev/{dev}/reload', h_reload),
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


def api_init(csa, addr='localhost', port=8911, allow_iap=True):
    api['allow_iap'] = allow_iap
    api['sock'] = CDWebSocket(ws_ns, 'api')
    cd_watch.create_task(api_service(), 'api_service')
    cd_watch.create_task(start_api(addr, port), 'api_server')
