#!/usr/bin/env python3
#
# Software License Agreement (MIT License)
#
# Author: Duke Fong <d@d-l.io>

"""Client for the CDBUS GUI external API (see api_serve.py).

The gui backend must be running and a page for the device must be opened in
the browser. Everything this client does shows up on that page, so you can
watch a script work, and the waveform is drawn as usual.

Standalone use prints the device info:
  ./cdg_api.py --dev NAME [--url http://localhost:8911]
"""

import json
import time
import urllib.request
import urllib.parse
import urllib.error


class CdgApi:
    def __init__(self, dev, url='http://localhost:8911', timeout=70):
        self.base = f'{url.rstrip("/")}/api/dev/{urllib.parse.quote(dev)}'
        self.timeout = timeout

    def _req(self, method, path, query=None, body=None):
        url = self.base + path
        if query:
            url += '?' + urllib.parse.urlencode({k: v for k, v in query.items() if v is not None})
        dat = None if body is None else (body if isinstance(body, bytes) else str(body).encode())
        req = urllib.request.Request(url, data=dat, method=method)
        try:
            with urllib.request.urlopen(req, timeout=self.timeout) as f:
                return f.read().decode()
        except urllib.error.HTTPError as err:
            raise RuntimeError(err.read().decode().strip()) from None

    # ---------------------------------------------------------- basics

    def info(self):
        return json.loads(self._req('GET', '/info'))

    def get(self, *names):
        """get('pid_pos_kp') -> str, get('a', 'b') -> dict"""
        if len(names) == 1:
            return self._req('GET', f'/reg/{urllib.parse.quote(names[0])}').strip()
        q = {'names': ','.join(names)} if names else None
        return json.loads(self._req('GET', '/reg', q))

    def set(self, vals=None, refresh=True, **kw):
        """set(pid_pos_kp=0.5) or set({'pid_pos_kp': 0.5})"""
        vals = dict(vals or {}, **kw)
        q = None if refresh else {'refresh': '0'}
        self._req('POST', '/reg', q, json.dumps({k: str(v) for k, v in vals.items()}))

    def log(self, since=0, max_len=100000):
        return json.loads(self._req('GET', '/log', {'since': since, 'max': max_len}))

    def log_clear(self):
        self._req('DELETE', '/log')

    # ---------------------------------------------------------- plot

    def plot_en(self, idx, en=True):
        self._req('POST', f'/plot/{idx}/en', None, '1' if en else '0')

    def plot_clear(self, idx):
        self._req('DELETE', f'/plot/{idx}')

    def plot(self, idx, tail=None, start=None, end=None, step=1, digits=6, series=None):
        """Return (labels, rows), rows are lists of numbers, first column is x."""
        q = {'tail': tail, 'start': start, 'end': end, 'step': step, 'digits': digits,
             'series': ','.join(series) if series else None, 'fmt': 'json'}
        r = json.loads(self._req('GET', f'/plot/{idx}', q))
        return r['labels'], r['rows']

    def capture(self, idx, secs, setup=None, series=None, step=1, digits=6):
        """Clear the plot, run `setup()`, record for `secs`, return (labels, rows)."""
        self.plot_clear(idx)
        self.plot_en(idx, True)
        if setup:
            setup()
        time.sleep(secs)
        return self.plot(idx, series=series, step=step, digits=digits)

    # ---------------------------------------------------------- iap

    def iap_stop(self):
        self._req('DELETE', '/iap')

    def iap(self, path, action='bl_full', check='none', wait=True, timeout=300):
        self._req('POST', '/iap', None, json.dumps({'path': path, 'action': action, 'check': check}))
        if not wait:
            return None
        end = time.time() + timeout
        while time.time() < end:
            time.sleep(1)
            st = json.loads(self._req('GET', '/iap'))
            if not st['running']:
                return st
        self.iap_stop()
        raise RuntimeError('iap timeout')


def col(labels, rows, name):
    i = labels.index(name)
    return [r[i] for r in rows]


def step_metrics(y, target, rate=1.0, start=0.0, tol=0.02):
    """Step response metrics of series `y`, sampled at `rate` Hz.

    Returns overshoot in percent of the step, 10-90% rise time, settling time
    into the +-tol band, and the remaining error at the end. Times are None
    when the response never got there.
    """
    span = target - start
    if not y or span == 0:
        return None
    peak = max(y) if span > 0 else min(y)
    dt = 1.0 / rate

    def cross(level, above):
        for i, v in enumerate(y):
            if (v >= level) if above else (v <= level):
                return i * dt
        return None

    up = span > 0
    t10 = cross(start + span * 0.1, up)
    t90 = cross(start + span * 0.9, up)
    band = abs(span) * tol
    settle = None
    for i in range(len(y) - 1, -1, -1):
        if abs(y[i] - target) > band:
            settle = (i + 1) * dt if i + 1 < len(y) else None
            break
    else:
        settle = 0.0
    return {
        'overshoot': round((peak - target) / span * 100, 2),
        'rise': None if t10 is None or t90 is None else round(t90 - t10, 4),
        'settle': None if settle is None else round(settle, 4),
        'err_end': round(target - y[-1], 3),
        'peak': peak
    }


if __name__ == '__main__':
    import sys, os
    sys.path.append(os.path.join(os.path.dirname(__file__), '..', 'pycdnet'))
    from cdnet.utils.cd_args import CdArgs

    args = CdArgs()
    dev = args.get('--dev')
    if args.get('--help', '-h') != None or not dev:
        print(__doc__)
        exit(0 if dev else -1)
    a = CdgApi(dev, args.get('--url', dft='http://localhost:8911'))
    info = a.info()
    print(f'{info["name"]} <{info["tgt"]} | {info["cfg"]}>: {info["info"]}')
    print(f'regs: {len(info["regs"])}, plots: {len(info["plots"])}')
    for p in info['plots']:
        print(f'  plot{p["idx"]}: en={p["en"]}, len={p["len"]}, series={p["labels"]}')
