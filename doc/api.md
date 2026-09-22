CDBUS GUI External API
=======================================

Lets a script (or an AI agent) drive the tool from outside: open and close
the serial port, read and write registers, change the R / W button groups,
read the log, start and stop waveforms, fetch waveform data, reload the page
and run an IAP upgrade.

Requests are relayed to the device page in the browser, and the page does the
real work, the same way it does when you click a button. So a script and the
user share one state: the waveform keeps being drawn, register boxes update,
and every API call is printed in the device page log window next to the
device's own output, and in the aggregated log on the index page, which makes
it easy to watch what a script is doing.

The page for the device must be opened in the browser. The server listens on
`localhost:8911` by default, use `--api-port` to change it, `--api-port 0` to
disable it. IAP is allowed, start the backend with `--api-no-iap` to refuse it.

The api is for scripts on this machine. A request made by a web page of some
other site through the browser carries that site's `Origin` header and is
refused (403), as is a websocket connection to the tool from such a page:
otherwise any website open in the browser could drive the device. curl and the
python wrapper send no `Origin` and go through.

`{dev}` below is the device address (e.g. `00:00:fe`) or the name you gave it
on the index page. `GET http://localhost:8911/` prints this list.


### Endpoints

```
GET    /api/serial                      serial port in use, its state, the
                                        ports there are (index page opened)
POST   /api/serial/open                 body {"port":"ACM0","baud":115200}
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
                                        {"label":["N","a","b"],"cal":{"e":"..."},
                                         "overlay":[...], "save":false}
GET    /api/dev/{dev}/plot/{idx}        waveform as csv
                                        [?tail=N | ?start=X&end=X]
                                        [&step=N&digits=N&series=a,b&fmt=json]
DELETE /api/dev/{dev}/plot/{idx}        clear waveform buffer
GET    /api/dev/{dev}/groups            R / W button groups of the set in use
                                        [?set=less]
POST   /api/dev/{dev}/groups            change them, body
                                        {"r":[["first","last"],["name"]],"w":[...],
                                         "set":"less", "save":false}
POST   /api/dev/{dev}/reload            reload the page, e.g. after editing its
                                        config file, returns once it is back
POST   /api/dev/{dev}/iap               body {"path":..,"action":..,"check":..}
                                        refused if the backend runs --api-no-iap
GET    /api/dev/{dev}/iap               iap progress
DELETE /api/dev/{dev}/iap               stop a running iap
```


### Serial Port

The serial port is set up on the index page, so `/api/serial` needs the index
page opened, the way a device call needs the device page. It does what the
`Open` and `Close` buttons there do: `open` fills in the two boxes, which are
kept as if typed in, and opens; a field left out keeps what its box has.
`port` is matched the way the box matches it, a device path or any part of a
line of `ports`. A port that is already open is not replaced, close it first,
e.g. to change the baud rate. Each call returns the state after it:

```shell
curl -X POST localhost:8911/api/serial/close
curl -X POST localhost:8911/api/serial/open -d '{"port":"ACM0","baud":921600}'
{"port": "/dev/ttyACM0", "baud": 921600, "state": "online",
 "input": {"port": "ACM0", "baud": "921600"}, "ports": [...], "net": 0, "mac": 0}
```

`state` is `online`, `connecting` (the port is not there, it is retried every
half second, as it is when a USB device is unplugged), `offline` (nothing is
open) or `dead` (the thread reading the port has died, close and open again).
A backend started as `main_udp.py` has no serial port, the calls are refused.


### Waveform Channels

A script can also choose what a plot samples, without editing the config file
or reloading the page. `label` is the channel list, the same thing the `plot`
section of the config file holds: the first entry names the x axis, the rest
are register names, which may index an array or a struct array member, e.g.
`dbg_raw[0]`, and may name a `reg_overlay` entry. `cal` are the derived
series, javascript expressions over
`_d`, where `_d[0]` is x and `_d[1]` is the first channel. `overlay` is the
`reg_overlay` list, shared by every plot of the device, entries are
`[base, ofs, len, fmt, name]`. Send only `label` to keep the current formulas,
`"cal": null` to drop them all, and leave a field out to leave it alone. The
reply is the new series list.

A change made through the API is not kept: a page reload goes back to what the
user picked in the browser, or to the config file. Pass `"save": true` to make
it stick, which is the same thing the dialog does.

Two limits worth knowing. The config register holds a fixed number of slots,
6 for a 24 byte `dbg_raw`, and one slot covers one contiguous address range,
so listing registers that sit next to each other costs fewer slots than
scattered ones. And more channels means fewer samples per packet, so the
effective sample rate drops. `GET .../info` reports `slots` and `slots_used`
for each plot, along with the current `label`, `cal` and the `reg_overlay`
list, which is what a script needs to decide.

A rejected config changes nothing: the previous channels keep streaming. Note
that `Re-Calc` re-reads the formulas from the config file on disk, so it
discards formulas set through the API, and those file formulas may not line up
with a channel list the API changed.

```shell
curl -X POST localhost:8911/api/dev/motor/plot/0/cfg \
     -d '{"label":["N","tgt_pos","meas_pos"],"cal":{"err":"_d[1].at(-1)-_d[2].at(-1)"}}'
```


### Register Groups

A register can only be read or written through a group that covers it, the
same as on the page, where a register outside every group has a dead `R` or
`W` button. `GET .../info` flags each register with `r` and `w`, and
`GET .../groups` lists the groups of the set in use, written the way the
config file writes them: `["first", "last"]` covers every register from
`first` to `last`, `["name"]` a single one. A group takes whole registers, not
one element of a `{}` register. `POST .../groups` replaces them: send `r`
and / or `w`, a side left out stays as it is, `null` puts back what the config
file has. `"set": "less"` switches the page to that set first, the same as
picking it in the drop-down. The groups are checked before anything changes:
an unknown register, a group whose `last` comes before its `first`, or two
groups that overlap are refused. The reply is the groups now in use.

```shell
curl -X POST localhost:8911/api/dev/motor/groups \
     -d '{"w":[["tc_pos"],["tc_speed","tc_accel"],["pid_pos_kp","pid_pos_kd"]]}'
```

As with the plot channels, a change is not kept: a page reload goes back to
the groups the user has. `"save": true` keeps the set in use and its groups in
the browser, which is what `Button Edit` does. Writing them into the config
file is left to `Update Config File` on the page. While the user has
`Button Edit` on, a change is refused.


### Page Reload

`POST .../reload` reloads the device page, which is how a config file edited
on disk takes effect. It checks the config file first, and one that does not
load is reported and the page is left running as it is. Otherwise the call
returns once the reloaded page is back, with the config file problems the page
reports, if any, the same ones its error banner lists (`GET .../info` has them
as `cfg_errors`). A reload starts the log and the waveforms over, drops what
the API changed without saving, and is refused while an IAP is running or
`Button Edit` is on.


### Waveform Data

Waveform data can be large, so narrow it down on the server side with `tail`
or an `start`/`end` range, thin it with `step`, and cut the precision with
`digits`, the same options the `Export CSV` dialog offers.

```shell
curl localhost:8911/api/dev/motor/reg/pid_speed_kp
curl -X PUT -d 0.35 localhost:8911/api/dev/motor/reg/pid_speed_kp
curl -X POST -d 1 localhost:8911/api/dev/motor/plot/0/en
curl 'localhost:8911/api/dev/motor/plot/0?tail=500&series=meas_pos&digits=4'
```


### Python Wrapper

`tools/cdg_api.py` wraps the same thing for python, including a `capture()`
helper and `step_metrics()` for overshoot / rise time / settling time:

```python
from cdg_api import CdgApi, col, step_metrics

a = CdgApi('motor')
a.set(pid_pos_kp=4.0)
labels, rows = a.capture(0, 2.0, setup=lambda: a.set(tgt_pos=20000, refresh=False),
                         series=['meas_pos'])
print(step_metrics(col(labels, rows, 'meas_pos'), 20000, rate=200))
```

Commands are serialized, one finishes before the next starts, and they do not
interleave with the page's own periodic register read. Keep timing sensitive
steps inside one call: host round trip time is not repeatable, so set the
parameters first, then start the capture, rather than trying to align them
from the script.
