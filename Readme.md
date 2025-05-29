CDBUS GUI Tool
=======================================

#### Let's start by listing one of the features of this tool:
When a master board is controlling a slave, the PC can be hooked up to the same RS-485 bus (CDBUS) and the PC can read and write to the slave, view slave print messages, and view data waveforms without interfering with the control of the slave by the existing master board.


#### Download this tool:
`git clone --recursive https://github.com/dukelec/cdbus_gui`


#### Dependence:
Python version >= 3.8  
`pip3 install pythoncrc json5 websockets pyserial u-msgpack-python aiohttp IntelHex`

#### Usage:
Run `main.py` or `start.sh`, then open url in your web browser: http://localhost:8910

The code architecture is python + web, where python communicates with each web page through a single websocket pipe.  
The web side is bare javascript (vanilla, es6), so you don't need to learn a specific front-end framework to get involved in code editing. It is also convenient to use this app as a template for some product-specific software.  

The protocol between mcu and python is cdnet, currently only the minimal version of the level 1 format is used.  
The protocol between python and the web is similar to cdnet, with arbitrary strings used instead of addresses and ports.  

The firmware on the mcu side of the following demonstration, as well as the usage of cdnet, can be roughly referred to in this project: https://github.com/dukelec/cdstep  


### Index Page
 - "Available" lists all the serial ports of your computer, just paste any sub string of them and fill in the first input box of "Serial". The advantage of this is that if the port changes, you can still open the correct serial port. Or you can select the serial port that is plugged into the specified USB port.
 - During use, the serial port will automatically reconnect if it is dropped. On the right is the python background print: successfully reconnected again after unplugging and plugging.
 - "Devices" is mainly to choose which slave to debug, supports debugging multiple devices at the same time, the number of devices is unlimited.
 - "Logs" is the message printed by all devices on the bus, while each device's respective page prints only its own debug message.
 - Printing supports color (ANSI), just like the terminal under Linux, so it is easy to locate errors quickly in many logs.
 - The Logs window can be resized at will.
 - Edited data is automatically saved.

<img src="doc/p1.avif">  


### Device Page
The following is the debug window for a specific device, starting with the data list read and write (commonly known as registers).
 - Mouse over the register name and data, it will prompt the register description, and the default data respectively (the default data is also read from the device).
 - The reading and writing of registers is done by group, which can ensure the consistency of a group of data.
 - Groups can be edited at will.
 - Tapping R on a group will read all the data in that group, and W will write a group of data. Tapping Read All and Write All at the top reads and writes each group in turn.
 - The list is configured by the json file of different devices, where the register list is printed out automatically when the device is powered on, just copy and paste it into the json template.
 - Arrays and multiple data formats are supported, and can be set to display in hexadecimal (data box with H flag) or as uint8_t arrays (with B flag).
 - Inside the same group, there are some with a small notch, indicating a hole between two registers. The group is read back before the first write to avoid modifying the data in the hole, which may be empty or any reserved vendor register(s).

<img src="doc/p2.avif">  

<img src="doc/p3.avif">  

 - This is the Log debug on the Device page, which can also be changed to any size.
 - Further below is the waveform window, which also supports size selection.

<img src="doc/p4.avif">  


#### Waveform windows:
 - The value of the currently selected data is indicated below each window, which is convenient and accurate.
 - You can turn on and off a certain curve at will, so it is not easy to mess up when there are many curves. (tc_speed is off in the figure, but the value is still displayed.)
 - The mouse wheel can be used with shift or ctrl to scale the x and y axes respectively, and the default is to scale both axes together.
 - Touch screen zooming is supported, as well as different scaling of x and y axes.
 - Double-click to restore the default diagram (zoom to fit). Hold down left (or middle) mouse button to pan (touchpad is also possible).
 - Data depth can be set and old data is automatically deleted to facilitate dynamic data display (oscilloscope effect).
 - The number of waveform windows is not limited.
 - You can start and stop multiple plots at the same time by directly setting the `dbg_raw_msk` register.

<img src="doc/p5.avif">  


#### Picture preview:
 - Preview jpeg images sent from device, e.g: MCU. (Visit: https://github.com/dukelec/cdcam)

(Tips: You can string multiple cameras, multiple servo motors and other devices on a single RS-485 bus, simplifying costs and wiring.)

<img src="doc/p6.avif">  


#### The last are IAP and data export and import:
 - IAP supports overall readback validation, device side calculation of crc for validation, and no validation.
 - IAP supports intel hex file with multiple segments.
 - When the register format is changed, it can be migrated by exporting and importing.
 - Waveform data and log printing will be exported at the same time.

For example, if you are doing motor control, you can ask your customer to send you the waveform he collected for analysis, so as to remotely assist the customer in adjusting PID and other parameters.


### JSON Format
Finally, there is the json configuration:
 - The top "reg" is printed out when the device is powered up (it is also automatically generated on the mcu side, so you don't have to fill in the address, size and data type yourself, and it is not error-prone).
 - For easy reading, there are hexadecimal numbers and comments, so the json5 format is used.
 - The "fmt" string with "[]" is an array, which displays all data in one edit box.
 - The ones with "{}" are also arrays, each group occupies one edit box, and each box supports multiple data, which is convenient for struct arrays.

**E.g.** `cdstep-v7.json`
```json5
{
    "reg": {
        // fmt: [c]: string, b: int8_t, B: uint8_t, h: int16_t, H: uint16_t, i: int32_t, I: uint32_t, f: float
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
                  ["qxchg_set","qxchg_ret"],["dbg_raw_msk"],["dbg_raw_th"],["dbg_raw[0]","dbg_raw[1]"],["ref_volt","lim_en"],
                  ["tc_pos","tc_accel"],["tc_accel_emg"],["pid_pos_kp","pid_pos_kd"],["cal_pos","cal_speed"],
                  ["state"],["tc_state","cur_pos"],["tc_vc","tc_ac"],["loop_cnt"],["string_test"]],
        "reg_w": [["magic_code","conf_ver"],["do_reboot"],["save_conf"],["bus_cfg_mac"],["bus_cfg_baud_l","bus_cfg_baud_h"],
                  ["bus_cfg_filter_m"],["bus_cfg_mode"],["bus_cfg_tx_permit_len","bus_cfg_tx_pre_len"],["dbg_en"],
                  ["qxchg_mcast"],["qxchg_set","qxchg_ret"],["dbg_raw_msk"],["dbg_raw_th"],["dbg_raw[0]","dbg_raw[1]"],
                  ["ref_volt","md_val"],["set_home"],["lim_en"],["tc_pos"],["tc_speed","tc_accel"],["tc_accel_emg"],
                  ["pid_pos_kp","pid_pos_kd"],["state"],["string_test"]],
        "less_r": [["tc_pos","tc_accel"],["state","loop_cnt"]],
        "less_w": [["tc_pos"],["tc_speed","tc_accel"],["state"]]
    },
    
    "plot": {
        "mask": "dbg_raw_msk",
        "fmt": [
            "I1.iBiiff - N, tc_pos, tc_state, cal_pos, cur_pos, tc_vc, tc_va",
            "I1.ifif - N, pid target, i_term, last_in, cal_speed",
        ],
        "color": [],
        "cal": [
            [ "pos_err: _d[4].at(-1) - _d[3].at(-1)" ] // data4 - data3
        ]
    },
    
    "iap": { "reboot": 0x0005, "keep_bl": 0x0006 }
}
```

 - "reg_r" and "reg_w" are the default register group config, you can left them empty and edit on the UI.
 - The "fmt" of the "plot" data corresponds to two packet formats: "x1 a1 b1 a2 b2 ..." and "x1 a1 b1 x2 a2 b2 ...".
 - The former is an x-axis data shared between multiple groups of data in each packet. The first character "I" of fmt is the format of x, which represents uint32_t, generally a count variable in mcu, with 1 added to each loop and a fixed loop period. The number after "I" represents the delta between x1 and x2, thus recovering x2 x3 ...
 - The latter is the one without a number after "I", where each set of data inside a package has an x value, suitable for scenarios where the loop period changes.

(Notes: The "reg_r", "reg_w", "less_r" and "less_w" will be printed in the console when the editing is finished.)


### More Info
As a side note, `cdnet ip` is a reference to the concept of ipv6, which facilitates the use of strings to represent different addresses (for efficiency, mcu uses a 3-byte uint8_t array) and is defined as follows.

```
/* CDNET address string formats:
*
*              local link     unique local    multicast
* level0:       00:NN:MM
* level1:       80:NN:MM        a0:NN:MM       f0:MH:ML
*
* Notes:
*   NN: net_id, MM: mac_addr, MH+ML: multicast_id (H: high byte, L: low byte)
*/
```

 - Broadcast and multicast can also use the "local link" format, there is no need to use the "multicast" format for simple occasions.
 - "unique local" is used only when cross-segment, for example, there are multiple network segments, each subnet has multiple devices.

The cdnet ip address can be directly mapped to a standard ipv6 address, so that the computer can interact with mcu through standard udp programming, and the code on the mcu side does not need to change, so the overhead is very small and there is no need to run the ipv6 protocol stack.

