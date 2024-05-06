/*
 * Software License Agreement (MIT License)
 *
 * Author: Duke Fong <d@d-l.io>
 */

let shift_key = false;
let ctrl_key = false;

window.addEventListener('keydown', function(e) {
    if (e.keyCode == 16)
        shift_key = true;
    if (e.keyCode == 17)
        ctrl_key = true;
});
window.addEventListener('keyup', function(e) {
    if (e.keyCode == 16)
        shift_key = false;
    if (e.keyCode == 17)
        ctrl_key = false;
});


function wheelZoomPlugin(opts) {
    let factor = opts.factor || 0.75;

    let xMin, xMax, yMin, yMax, xRange, yRange;

    function clamp(nRange, nMin, nMax, fRange, fMin, fMax) {
        if (nRange > fRange) {
            nMin = fMin;
            nMax = fMax;
        }
        else if (nMin < fMin) {
            nMin = fMin;
            nMax = fMin + nRange;
        }
        else if (nMax > fMax) {
            nMax = fMax;
            nMin = fMax - nRange;
        }

        return [nMin, nMax];
    }

    return {
        hooks: {
            ready: u => {
                xMin = u.scales.x.min;
                xMax = u.scales.x.max;
                yMin = u.scales.y.min;
                yMax = u.scales.y.max;

                xRange = xMax - xMin;
                yRange = yMax - yMin;

                let plot = u.root.querySelector(".u-over");
                //let rect = plot.getBoundingClientRect();

                // wheel drag pan
                plot.addEventListener("mousedown", e => {
                    if (e.button == 0 || e.button == 1) {
                    //    plot.style.cursor = "move";
                        e.preventDefault();

                        let left0 = e.clientX;
                        let top0 = e.clientY;

                        let scXMin0 = u.scales.x.min;
                        let scXMax0 = u.scales.x.max;
                        let scYMin0 = u.scales.y.min;
                        let scYMax0 = u.scales.y.max;

                        let xUnitsPerPx = u.posToVal(1, 'x') - u.posToVal(0, 'x');
                        let yUnitsPerPx = u.posToVal(1, 'y') - u.posToVal(0, 'y');

                        function onmove(e) {
                            e.preventDefault();

                            let left1 = e.clientX;
                            let top1 = e.clientY;

                            let dx = xUnitsPerPx * (left1 - left0);
                            let dy = yUnitsPerPx * (top1 - top0);

                            u.batch(() => {
                                u.setScale("x", {
                                    min: scXMin0 - dx,
                                    max: scXMax0 - dx,
                                });

                                u.setScale("y", {
                                    min: scYMin0 - dy,
                                    max: scYMax0 - dy,
                                });
                            });
                        }

                        function onup(e) {
                            document.removeEventListener("mousemove", onmove);
                            document.removeEventListener("mouseup", onup);
                        }

                        document.addEventListener("mousemove", onmove);
                        document.addEventListener("mouseup", onup);
                    }
                });

                // wheel scroll zoom
                plot.addEventListener("wheel", e => {
                    e.preventDefault();

                    let {left, top} = u.cursor;
                    let rect = plot.getBoundingClientRect();
                    
                    let leftPct = left/rect.width;
                    let btmPct = 1 - top/rect.height;
                    let xVal = u.posToVal(left, "x");
                    let yVal = u.posToVal(top, "y");
                    let oxRange = u.scales.x.max - u.scales.x.min;
                    let oyRange = u.scales.y.max - u.scales.y.min;
                    
                    let factor_x = shift_key ? 1.0 : factor;
                    let factor_y = ctrl_key ? 1.0 : factor;

                    let nxRange = e.deltaY < 0 ? oxRange * factor_x : oxRange / factor_x;
                    let nxMin = xVal - leftPct * nxRange;
                    let nxMax = nxMin + nxRange;
                    //[nxMin, nxMax] = clamp(nxRange, nxMin, nxMax, xRange, xMin, xMax);

                    let nyRange = e.deltaY < 0 ? oyRange * factor_y : oyRange / factor_y;
                    let nyMin = yVal - btmPct * nyRange;
                    let nyMax = nyMin + nyRange;
                    //[nyMin, nyMax] = clamp(nyRange, nyMin, nyMax, yRange, yMin, yMax);

                    u.batch(() => {
                        u.setScale("x", {
                            min: nxMin,
                            max: nxMax,
                        });

                        u.setScale("y", {
                            min: nyMin,
                            max: nyMax,
                        });
                    });
                });
            }
        }
    };
}

function touchZoomPlugin(opts) {
    function init(u, opts, data) {
        let plot = u.root.querySelector(".u-over");
        let rect, oxRange, oyRange, xVal, yVal;
        let fr = {x: 0, y: 0, dx: 0, dy: 0};
        let to = {x: 0, y: 0, dx: 0, dy: 0};

        function storePos(t, e) {
            let ts = e.touches;

            let t0 = ts[0];
            let t0x = t0.clientX - rect.left;
            let t0y = t0.clientY - rect.top;

            if (ts.length == 1) {
                t.x = t0x;
                t.y = t0y;
                t.d = t.dx = t.dy = 1;
            }
            else {
                let t1 = e.touches[1];
                let t1x = t1.clientX - rect.left;
                let t1y = t1.clientY - rect.top;

                let xMin = Math.min(t0x, t1x);
                let yMin = Math.min(t0y, t1y);
                let xMax = Math.max(t0x, t1x);
                let yMax = Math.max(t0y, t1y);

                // midpts
                t.y = (yMin+yMax)/2;
                t.x = (xMin+xMax)/2;

                t.dx = xMax - xMin;
                t.dy = yMax - yMin;

                // dist
                t.d = Math.sqrt(t.dx * t.dx + t.dy * t.dy);
            }
        }

        let rafPending = false;

        function zoom() {
            rafPending = false;

            let left = to.x;
            let top = to.y;

            // non-uniform scaling
            let xFactor = fr.dx / to.dx;
            let yFactor = fr.dy / to.dy;

            // uniform x/y scaling
            //let xFactor = fr.d / to.d;
            //let yFactor = fr.d / to.d;

            let leftPct = left/rect.width;
            let btmPct = 1 - top/rect.height;

            let nxRange = oxRange * xFactor;
            let nxMin = xVal - leftPct * nxRange;
            let nxMax = nxMin + nxRange;

            let nyRange = oyRange * yFactor;
            let nyMin = yVal - btmPct * nyRange;
            let nyMax = nyMin + nyRange;

            u.batch(() => {
                u.setScale("x", {
                    min: nxMin,
                    max: nxMax,
                });

                u.setScale("y", {
                    min: nyMin,
                    max: nyMax,
                });
            });
        }

        function touchmove(e) {
            storePos(to, e);

            if (!rafPending) {
                rafPending = true;
                requestAnimationFrame(zoom);
            }
        }

        plot.addEventListener("touchstart", function(e) {
            e.preventDefault();
            rect = plot.getBoundingClientRect();

            storePos(fr, e);

            oxRange = u.scales.x.max - u.scales.x.min;
            oyRange = u.scales.y.max - u.scales.y.min;

            let left = fr.x;
            let top = fr.y;

            xVal = u.posToVal(left, "x");
            yVal = u.posToVal(top, "y");

            document.addEventListener("touchmove", touchmove, {passive: true});
        });

        plot.addEventListener("touchend", function(e) {
            document.removeEventListener("touchmove", touchmove, {passive: true});
        });
    }

    return {
        hooks: {
            init
        }
    };
}


export {
    wheelZoomPlugin, touchZoomPlugin
};
