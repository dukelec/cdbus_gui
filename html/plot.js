/*
 * Software License Agreement (MIT License)
 *
 * Author: Duke Fong <d@d-l.io>
 */

import { escape_html, date2num, val2hex, dat2str, dat2hex, hex2dat,
         read_file, download, readable_size, blob2dat } from './utils/helper.js';
import { csa } from './ctrl.js';
import { wheelZoomPlugin, touchZoomPlugin } from './plot_zoom.js';


function make_chart(eid, name, series) {
    let opts = {
        title: name,
        width: 1200,
        height: 400,
        plugins: [
            wheelZoomPlugin({factor: 0.90}),
            touchZoomPlugin()
        ],
        cursor: {
            drag: { x: true, y: true, dist: 10 }
        },
        scales: {
            x: {
                range(u, dataMin, dataMax) {
                    if (dataMin == null)
                        return [0, 100];
                    return [dataMin, dataMax];
                },
                time: false,
            },
            y: {
                range(u, dataMin, dataMax) {
                    if (dataMin == null)
                        return [0, 100];
                    return [dataMin, dataMax];
                    //return uPlot.rangeNum(dataMin, dataMax, 0.1, true);
                },
                //auto: false,
            }
        },
        series: series
    };

    const data = [
        [ 1, 2, 3, 4, 5, 6, 7],
        [40,43,60,65,71,73,80],
        [18,24,37,55,55,60,63],
        [ 1, 2, 3, 4, 5, 6, 7],
        [40,43,60,65,71,73,80],
        [18,24,37,55,55,60,63],
    ];

    console.log(opts, eid);
    let u = new uPlot(opts, null, document.getElementById(eid));
    u.setData(data);
    return u;
}


function init_plots() {
    let list = document.getElementById('plot_list');
    csa.plots = [];
    
    for (let i = 0; i < csa.cfg_plot.fmt.length; i++) {
        let f = csa.cfg_plot.fmt[i];
        let f_fmt = f.split(' - ')[0];
        let f_str = f.slice(f_fmt.length + ' - '.length);
        let series_num = f_fmt.split('.')[1].length + 1;
        let series = [];
        for (let s = 0; s < series_num; s++) {
            let color = csa.cfg_plot.length > i ? csa.cfg_plot[i][s] : null;
            if (!color)
                color = csa.cfg_plot.color_dft[s];
            if (!color)
                color = csa.cfg_plot.color_dft[0];
            let name = f_str.split(',')[s];
            if (!name)
                name = '~';
            else
                name = name.trim();
            series.push({ label: name, stroke: color });
        }
        
        list.insertAdjacentHTML('beforeend', `<div id="plot${i}"></div>`);
        csa.plots.push(make_chart(`plot${i}`, `Plot${i}`, series));
    }
}


export { init_plots };

