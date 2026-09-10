#!/usr/bin/env python3
#
# Software License Agreement (MIT License)
#
# Author: Duke Fong <d@d-l.io>
#
# Write a few values back into a json5 config file, in place.
#
# Reading the file and dumping it again would drop every comment, the hex
# literals and the hand made layout, so instead the raw text is scanned for
# the value that belongs to a key path, and only that span is replaced. Byte
# for byte, nothing else in the file changes. Comments inside a replaced span
# are lost, which is why only the spans the user actually changed are sent.

import os
import json
import json5
import shutil

BAK = '.bak' # must not end with .json, the config list would pick it up


# ---------------------------------------------------------------- scanner

def _skip_ws(s, i):
    while i < len(s):
        if s[i] in ' \t\r\n':
            i += 1
        elif s.startswith('//', i):
            j = s.find('\n', i)
            i = len(s) if j < 0 else j + 1
        elif s.startswith('/*', i):
            j = s.find('*/', i)
            if j < 0:
                raise ValueError('unterminated comment')
            i = j + 2
        else:
            break
    return i


def _scan_str(s, i):
    q = s[i]
    i += 1
    while i < len(s):
        if s[i] == '\\':
            i += 2
            continue
        if s[i] == q:
            return i + 1
        i += 1
    raise ValueError('unterminated string')


def _scan_bare(s, i):
    j = i
    while j < len(s) and s[j] not in ',:{}[]"\'/ \t\r\n':
        j += 1
    if j == i:
        raise ValueError(f'unexpected char at offset {i}: {s[i]!r}')
    return j


def _scan_val(s, i):
    """Return the offset just past the value starting at i."""
    i = _skip_ws(s, i)
    if i >= len(s):
        raise ValueError('unexpected end of file')
    if s[i] in '"\'':
        return _scan_str(s, i)
    if s[i] not in '{[':
        return _scan_bare(s, i)
    close = '}' if s[i] == '{' else ']'
    i += 1
    while True:
        i = _skip_ws(s, i)
        if i >= len(s):
            raise ValueError('unbalanced brackets')
        if s[i] == close:
            return i + 1
        if s[i] in ',:':
            i += 1
        elif s[i] in '"\'':
            i = _scan_str(s, i)
        elif s[i] in '{[':
            i = _scan_val(s, i)
        else:
            i = _scan_bare(s, i)


def _members(s, i):
    """i is at '{'. Yield (key, key_start, val_start, val_end) for each member."""
    i += 1
    while True:
        i = _skip_ws(s, i)
        if i >= len(s):
            raise ValueError('unexpected end of object')
        if s[i] == '}':
            return
        if s[i] == ',':
            i += 1
            continue
        k_start = i
        if s[i] in '"\'':
            k_end = _scan_str(s, i)
            k = s[k_start + 1:k_end - 1]
        else:
            k_end = _scan_bare(s, i)
            k = s[k_start:k_end]
        i = _skip_ws(s, k_end)
        if i >= len(s) or s[i] != ':':
            raise ValueError(f'expected ":" after key {k!r}')
        i = _skip_ws(s, i + 1)
        v_start = i
        v_end = _scan_val(s, i)
        yield k, k_start, v_start, v_end
        i = v_end


def _member(s, i, key):
    """i is at '{'. Return (val_start, val_end, key_start) of `key`, or None."""
    for k, k_start, v_start, v_end in _members(s, i):
        if k == key:
            return v_start, v_end, k_start
    return None


def _item(s, i, n):
    """i is at '['. Return (start, end) of item n, or None."""
    i += 1
    idx = 0
    while True:
        i = _skip_ws(s, i)
        if i >= len(s):
            raise ValueError('unexpected end of array')
        if s[i] == ']':
            return None
        if s[i] == ',':
            i += 1
            continue
        start = i
        end = _scan_val(s, i)
        if idx == n:
            return start, end
        idx += 1
        i = end


def find_value(s, path):
    """Locate the value at a key path, e.g. ['plot', 'plots', 0, 'label'].
    Returns (start, end, key_start) or None."""
    start = _skip_ws(s, 0)
    end = _scan_val(s, start)
    k_start = start
    for p in path:
        if s[start] not in '{[':
            return None
        if isinstance(p, int):
            r = _item(s, start, p)
            if not r:
                return None
            start, end = r
        else:
            r = _member(s, start, p)
            if not r:
                return None
            start, end, k_start = r
    return start, end, k_start


# ---------------------------------------------------------------- format

def _j(v):
    return json.dumps(v, ensure_ascii=False)


def _style(path):
    last = path[-1]
    if last in ('reg_r', 'reg_w', 'less_r', 'less_w'):
        return 'compact'
    if last == 'label':
        return 'inline'
    if last == 'cal':
        return 'dict'
    if last == 'reg_overlay':
        return 'overlay'
    raise ValueError(f'config key is not writable: {last}')


def _fmt(val, style, indent, nl='\n'):
    pad = ' ' * (indent + 4)
    if style == 'compact':      # one long line, as the reg groups are written
        return json.dumps(val, separators=(',', ':'), ensure_ascii=False)
    if style == 'inline':
        return _j(val)
    if style == 'dict':
        if not val:
            return '{}'
        rows = [f'{pad}{_j(k)}: {_j(v)}' for k, v in val.items()]
        return '{' + nl + (',' + nl).join(rows) + nl + ' ' * indent + '}'
    if style == 'overlay':
        if not val:
            return '[]'
        rows = []
        for o in val:
            base = f'0x{o[0]:04x}' if isinstance(o[0], int) else _j(o[0])
            rows.append(f'{pad}[{base}, {o[1]}, {o[2]}, {_j(o[3])}, {_j(o[4])}]')
        return '[' + nl + (',' + nl).join(rows) + nl + ' ' * indent + ']'
    raise ValueError(f'unknown style: {style}')


# ---------------------------------------------------------------- write

def cfg_path(cfg_dir, name):
    """Resolve a config name inside cfg_dir, refuse anything that escapes it."""
    if not name or not name.endswith('.json'):
        raise ValueError(f'not a config file name: {name}')
    root = os.path.realpath(cfg_dir)
    full = os.path.realpath(os.path.join(root, name))
    if os.path.commonpath((root, full)) != root or os.path.dirname(full) != root:
        raise ValueError(f'config file is outside {cfg_dir}: {name}')
    if not os.path.isfile(full):
        raise ValueError(f'config file not found: {name}')
    if not os.access(full, os.W_OK):
        raise ValueError(f'config file is not writable: {name}')
    return full


def _col(s, i):
    return i - (s.rfind('\n', 0, i) + 1)


def _edit(s, path, val, nl):
    """Return (start, end, text): the span to replace, empty for an insert."""
    style = _style(path)
    if len(path) == 1:
        p_start = _skip_ws(s, 0)
    else:
        r = find_value(s, path[:-1])
        if not r:
            raise ValueError(f'key not found: {".".join(map(str, path[:-1]))}')
        p_start = r[0]
    last = path[-1]

    if isinstance(last, int):
        r = _item(s, p_start, last)
        if not r:
            raise ValueError(f'index not found: {".".join(map(str, path))}')
        return r[0], r[1], _fmt(val, style, _col(s, r[0]), nl)

    if s[p_start] != '{':
        raise ValueError(f'not an object: {".".join(map(str, path[:-1]))}')
    members = list(_members(s, p_start))
    for k, k_start, v_start, v_end in members:
        if k == last:
            return v_start, v_end, _fmt(val, style, _col(s, k_start), nl)

    # the key is not in the file yet, add it to the end of the object
    if members:
        indent = _col(s, members[0][1])
        at = members[-1][3]
        head = ',' + nl + ' ' * indent
        tail = ''
    else:
        indent = _col(s, p_start) + 4
        at = p_start + 1
        head = nl + ' ' * indent
        tail = nl + ' ' * (indent - 4)
    return at, at, head + _j(last) + ': ' + _fmt(val, style, indent, nl) + tail


def update_cfg(cfg_dir, name, vals):
    """vals: [{'path': [...], 'val': ...}]. Returns the list of paths written."""
    full = cfg_path(cfg_dir, name)
    with open(full, encoding='utf-8', newline='') as f:
        text = f.read()
    nl = '\r\n' if '\r\n' in text else '\n'

    edits = []
    for v in vals:
        path = v['path']
        if not isinstance(path, list) or not path:
            raise ValueError(f'bad key path: {path}')
        edits.append(_edit(text, path, v['val'], nl))

    for start, end, new in sorted(edits, reverse=True):
        text = text[:start] + new + text[end:]

    json5.loads(text) # never leave a file we cannot read back

    tmp = full + '.tmp'
    try:
        with open(tmp, 'w', encoding='utf-8', newline='') as f:
            f.write(text)
        shutil.copymode(full, tmp) # os.replace would drop the original mode
        shutil.copy2(full, full + BAK) # one step back, overwritten every time
        os.replace(tmp, full)
    finally:
        if os.path.exists(tmp):
            os.remove(tmp)
    return ['.'.join(map(str, v['path'])) for v in vals]
