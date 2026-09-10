CDBUS GUI Tool
=======================================

CDBUS GUI is an open-source, cross-platform serial debugging tool supporting register read/write, waveform plotting, log printing, IAP upgrades, and more.

#### Download:
`git clone --recursive https://github.com/dukelec/cdbus_gui`


#### Dependence:
Python version >= 3.8  
`pip3 install json5 websockets pyserial u-msgpack-python aiohttp IntelHex`

#### Usage:
Run `main.py`, then open the following URL in your web browser: http://localhost:8910

The underlying protocol for serial port is CDBUS, which uses the following frame format:  
`src, dst, len, [payload], crc_l, crc_h`

Each frame includes a 3-byte header, a variable-length payload, and a 2-byte CRC (identical to Modbus CRC).  
For more information on the CDBUS protocol, please refer to:
 - https://cdbus.org

The payload is encoded using the CDNET protocol. For detailed information, please refer to:
 - https://github.com/dukelec/cdnet
 - https://github.com/dukelec/cdnet/wiki/CDNET-Intro-and-Demo


### Index Page
 - "Serial": The first field accepts a port name or matching string (e.g., `ACM0`, `Bridge`, `2E3C:5740`), with wildcard support.  
   The second field is the baud rate, supporting arbitrary values.
 - "Available": Lists all serial ports on the computer.
 - "Devices": Quickly open the debug page for each device (list expands automatically).
 - "Logs": Aggregates logs from all devices.  
   (Pressing `Enter` inserts a blank line; Holding `Alt` or `Ctrl + Alt` allows block selection.)
 - Auto-reconnect supported for serial ports.
 - Modified settings are saved automatically.
 - Supports ANSI color codes.

<img src="doc/p1.avif">  


### Device Page
 - Displays registers for reading and writing.
 - Hover over a register to view its description, type, and default value.
 - Registers are grouped for atomic R/W; groups can be edited freely.
 - `R` reads a group, `W` writes it. `Read All` / `Write All` act on all groups.
 - Supports arrays and multiple formats, displayed in hexadecimal (`H`) or as byte arrays (`B`).
 - Small notches on the `R`/`W` buttons indicate gaps; groups are read before writing so that the data in gaps remains unchanged.

<img src="doc/p2.avif">  

<img src="doc/p3.avif">  

#### Waveform Plots:
 - Supports real-time display and long data recording, including FFT visualization.
 - Supports multiple windows with adjustable sizes.
 - Mouse wheel with `Shift` or `Ctrl` scales the `X` or `Y` axis; by default, both axes scale together.
 - Touchscreen zoom and independent `X`/`Y` scaling are supported.
 - Double-click to reset the view (zoom to fit). Hold the left or middle mouse button to pan.
 - Individual channels can be toggled on or off for clarity.
 - Multiple plots can be started or stopped simultaneously via the `dbg_raw_msk` register.
 - Supports formula-based waveforms (e.g., `u_cal` below). Click `Re-Calc` to refresh the plot after modifying or adding formulas.

<img src="doc/p4.avif">  

<img src="doc/p5.avif">  


#### Picture Preview:
 - Preview images (e.g., JPEG files) sent from the device.

<img src="doc/p6.avif">  


#### IAP and Data Import/Export:
 - IAP supports readback verification, device-side CRC validation, or no validation.
 - IAP supports Intel HEX files with multiple segments.
 - Register data, log outputs, and waveform data can be exported and imported together (in MessagePack format).
 - Waveform data can also be exported as CSV for AI analysis, with selectable plot, series, X range, decimation step, and significant digits to save tokens.


### External API

Lets a script (or an AI agent) drive the tool from outside: read and write
registers, read the log, start and stop waveforms, fetch waveform data, and
run an IAP upgrade.

Requests are relayed to the device page in the browser, and the page does the
real work, the same way it does when you click a button. So a script and the
user share one state: the waveform keeps being drawn, register boxes update,
and every API call is printed in the page log window next to the device's own
output, which makes it easy to watch what a script is doing.

The page for the device must be opened in the browser. The server listens on
`localhost:8911` by default, use `--api-port` to change it, `--api-port 0` to
disable it. IAP is refused unless the backend is started with `--api-iap`.

`{dev}` below is the device address (e.g. `00:00:fe`) or the name you gave it
on the index page. `GET http://localhost:8911/` prints this list.

```
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
```

A script can also choose what a plot samples, without editing the config file
or reloading the page. `label` is the channel list, the same thing the `plot`
section of the config file holds: the first entry names the x axis, the rest
are register names, which may index an array or a struct array member, e.g.
`dbg_raw[0]`, and may name a `reg_overlay` entry. `cal` are the derived
series, javascript expressions over
`_d`, where `_d[0]` is x and `_d[1]` is the first channel. Send only `label`
to keep the current formulas, `"cal": null` to drop them all. The reply is the
new series list.

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

Waveform data can be large, so narrow it down on the server side with `tail`
or an `start`/`end` range, thin it with `step`, and cut the precision with
`digits`, the same options the `Export CSV` dialog offers.

```shell
curl localhost:8911/api/dev/motor/reg/pid_speed_kp
curl -X PUT -d 0.35 localhost:8911/api/dev/motor/reg/pid_speed_kp
curl -X POST -d 1 localhost:8911/api/dev/motor/plot/0/en
curl 'localhost:8911/api/dev/motor/plot/0?tail=500&series=meas_pos&digits=4'
```

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


### JSON Format
 - The register list can be auto-generated by the MCU (printed when it powers up).
 - Uses JSON5 format, supporting hexadecimal values and comments.
 - The "fmt" string with "[]" is an array, which displays all data in one text box.
 - "{}" denotes struct arrays; each array element has its own text box containing multiple members of the struct.

**E.g.** `cdstep-v6.json`
```json5
{
    "reg": {
        // fmt: [c]: string, b: int8_t, B: uint8_t, h: int16_t, H: uint16_t, i: int32_t, I: uint32_t
        //       q: int64_t, Q: uint64_t, f: float, d: double
        // show: 0: normal, 1: hex, 2: bytes
        "list": [
            [ 0x0000, 2, "H", 1, "magic_code", "Magic code: 0xcdcd" ],
            [ 0x0002, 2, "H", 1, "conf_ver", "Config version" ],
            [ 0x0004, 1, "B", 0, "conf_from", "0: default config, 1: all from flash, 2: partly from flash" ],
            [ 0x0005, 1, "B", 0, "do_reboot", "1: reboot to bl, 2: reboot to app" ],
            [ 0x0007, 1, "b", 0, "save_conf", "Write 1 to save current config to flash" ],

            [ 0x000c, 1, "B", 1, "bus_cfg_mac", "RS-485 port id, range: 0~254" ],
            [ 0x0010, 4, "I", 0, "bus_cfg_baud_l", "RS-485 baud rate for first byte" ],
            [ 0x0014, 4, "I", 0, "bus_cfg_baud_h", "RS-485 baud rate for follow bytes" ],
            // ...

            [ 0x00bc, 4, "i", 0, "tc_pos", "Set target position" ],
            [ 0x00c0, 4, "I", 0, "tc_speed", "Set target speed" ],
            [ 0x00c4, 4, "I", 0, "tc_accel", "Set target accel" ],
            [ 0x00c8, 4, "I", 0, "tc_accel_emg", "Set emergency accel" ],

            [ 0x00d4, 4, "f", 0, "pid_pos_kp", "" ],
            [ 0x00d8, 4, "f", 0, "pid_pos_ki", "" ],
            [ 0x00dc, 4, "f", 0, "pid_pos_kd", "" ],
            [ 0x0100, 4, "i", 0, "cal_pos", "PID input position" ],
            [ 0x0104, 4, "f", 0, "cal_speed", "PID output speed" ],

            [ 0x0108, 1, "B", 0, "state", "0: disable drive, 1: enable drive" ],

            // --------------- Follows are not writable: -------------------
            [ 0x0109, 1, "B", 0, "tc_state", "t_curve: 0: stop, 1: run" ],
            [ 0x010c, 4, "i", 0, "cur_pos", "Motor current position" ],
            [ 0x0110, 4, "f", 0, "tc_vc", "Motor current speed" ],
            [ 0x0114, 4, "f", 0, "tc_ac", "Motor current accel" ],

            [ 0x0124, 4, "I", 0, "loop_cnt", "Count for plot" ],
            [ 0x0128, 10, "[c]", 0, "string_test", "String test" ]
        ],
        
        // button groups
        "reg_r": [["magic_code","save_conf"],["bus_cfg_mac","bus_cfg_tx_pre_len"],["dbg_en"],["qxchg_mcast"],
                  ["qxchg_set","qxchg_ret"],["dbg_raw_msk"],["dbg_raw[0]","dbg_raw[1]"],["ref_volt","lim_en"],
                  ["tc_pos","tc_accel"],["tc_accel_emg"],["pid_pos_kp","pid_pos_kd"],["cal_pos","cal_speed"],
                  ["state"],["tc_state","cur_pos"],["tc_vc","tc_ac"],["loop_cnt"],["string_test"]],
        "reg_w": [["magic_code","conf_ver"],["do_reboot"],["save_conf"],["bus_cfg_mac"],["bus_cfg_baud_l","bus_cfg_baud_h"],
                  ["bus_cfg_filter_m"],["bus_cfg_mode"],["bus_cfg_tx_permit_len","bus_cfg_tx_pre_len"],["dbg_en"],
                  ["qxchg_mcast"],["qxchg_set","qxchg_ret"],["dbg_raw_msk"],["dbg_raw[0]","dbg_raw[1]"],
                  ["ref_volt","md_val"],["set_home"],["lim_en"],["tc_pos"],["tc_speed","tc_accel"],["tc_accel_emg"],
                  ["pid_pos_kp","pid_pos_kd"],["state"],["string_test"]],
        "less_r": [["tc_pos","tc_accel"],["state","loop_cnt"]],
        "less_w": [["tc_pos"],["tc_speed","tc_accel"],["state"]]
    },
    
    "plot": {
        "mask": "dbg_raw_msk",
        "reg_overlay": [
            // addr, ofs, len, type, name
            //[0x1234, 8, 4, "f", "name"],
            ["pid_pos_ki", 20, 4, "i", "pid target"],
            ["pid_pos_ki", 24, 4, "f", "i_term"],
            ["pid_pos_ki", 28, 4, "i", "last_in"]
        ],
        "plots": [
            {
                // "color": ["black", "red", "green"]
                "cfg_reg": "dbg_raw[0]",
                "x_fmt": "H1",
                "label": ["N", "tc_pos", "tc_state", "cal_pos", "cur_pos", "tc_vc", "tc_ac"],
                "cal": {
                    "pos_err": "_d[4].at(-1) - _d[3].at(-1)" // data4 - data3
                },
                "fft": {
                    "sample_rate": 5000,
                    "size": 4096
                }
            }, {
                "cfg_reg": "dbg_raw[1]",
                "x_fmt": "H1",
                "label": ["N", "pid target", "i_term", "last_in", "cal_speed"]
            }
        ]
    },
    
    "iap": { "reboot": 0x0005, "keep_bl": 0x0006, "batch_pkts": 3 }
}
```

 - "reg_r" and "reg_w" are the default register group configurations; you can leave them empty and edit via the UI (after editing, the browser debug window will print them; "less_r" and "less_w" work the same way).
 - The "x_fmt" of "plot" data corresponds to two packet formats:
   * "x1 a1 b1 a2 b2 …" – x-axis data is shared across groups. "H" denotes a uint16_t counter, incremented each loop; a number after "H" gives the delta to recover subsequent x values.
   * "x1 a1 b1 x2 a2 b2 …" – each data set has its own x value, suitable for variable loop periods.


### More Info
As a side note, `CDNET Address` refers to the IPv6 concept, allowing strings to represent different addresses, defined as follows.

```
/* CDNET Address string formats:
*
*            localhost      local link     unique local    multicast
*             10:00:00
* level0:                    00:NN:MM
* level1:                    80:NN:MM        a0:NN:MM       f0:MH:ML
*
* Notes:
*   NN: net_id, MM: mac_addr, MH/ML: multicast_id (H: high byte, L: low byte)
*/
```

 - Broadcast and multicast can also use the "link-local" format; the "multicast" format is generally not needed for simple cases.
 - "Unique local" is used only across network segments — for example, when multiple subnets each contain multiple devices.

Serial CDNET packets can be directly mapped to UDP packets, enabling multiple software applications to access the same serial device. Please refer to:
https://github.com/dukelec/cdnet_tun

To access a serial device via UDP, run the `main_udp.py` program instead.
