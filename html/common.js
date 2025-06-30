/*
 * Software License Agreement (MIT License)
 *
 * Author: Duke Fong <d@d-l.io>
 */

let csa = {
    arg: {},            // url args
    db: null,
    
    ws_ns: null,
    cmd_sock: null,
    
    cfg: {},            // device config
    plugins: []         // registered plugins
};


async function alloc_port(port=null) {
    csa.cmd_sock.flush();
    if (port == 'clr_all') {
        await csa.cmd_sock.sendto({'action': 'clr_all'}, ['server', 'port']);
        let ret = await csa.cmd_sock.recvfrom(1000);
        console.log(`clr_all ports ret: ${ret[0]}`);
    } else {
        await csa.cmd_sock.sendto({'action': 'get_port', 'port': port}, ['server', 'port']);
        let ret = await csa.cmd_sock.recvfrom(1000);
        //console.log(`alloc port: ${ret[0]}`);
        return ret[0];
    }
}

export { csa, alloc_port };

