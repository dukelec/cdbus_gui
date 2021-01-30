/*
 * Copyright (c) 2019, Kudo, Inc.
 * All rights reserved.
 *
 * Author: Duke Fong <d@d-l.io>
 */


let shift_key = false;
let ctrl_key = false;

// For desktop
function pinchZoomWheelEvent(stage) {
    if (stage) {
        stage.getContent().addEventListener('wheel', (wheelEvent) => {
            wheelEvent.preventDefault();
            const oldScaleX = stage.scaleX();
            const oldScaleY = stage.scaleY();

            const pointer = stage.getPointerPosition();
            const startPos = {
                x: pointer.x / oldScaleX - stage.x() / oldScaleX,
                y: pointer.y / oldScaleY - stage.y() / oldScaleY,
            };

            const deltaYBounded = !(wheelEvent.deltaY % 1) ? Math.abs(Math.min(-10, Math.max(10, wheelEvent.deltaY))) : Math.abs(wheelEvent.deltaY);
            //const scaleBy = 1.00 + deltaYBounded / 100;
            const scaleBy = 1.00 + deltaYBounded / 1000;
            let newScaleX = wheelEvent.deltaY > 0 ? oldScaleX / scaleBy : oldScaleX * scaleBy;
            let newScaleY = wheelEvent.deltaY > 0 ? oldScaleY / scaleBy : oldScaleY * scaleBy;
            newScaleX = Math.min(Math.max(newScaleX, 0.1), 10);
            newScaleY = Math.min(Math.max(newScaleY, 0.1), 10);
            if (shift_key)
                newScaleX = oldScaleX;
            if (ctrl_key)
                newScaleY = oldScaleY;
            stage.scale({
                x: newScaleX,
                y: newScaleY
            });

            const newPosition = {
                x: (pointer.x / newScaleX - startPos.x) * newScaleX,
                y: (pointer.y / newScaleY - startPos.y) * newScaleY,
            };
            stage.position(newPosition);
            stage.batchDraw();
        });
    }
}


// For mobile
let lastDist;
let point;

function getDistance(p1, p2) {
    return Math.sqrt(Math.pow((p2.x - p1.x), 2) + Math.pow((p2.y - p1.y), 2));
}

function clientPointerRelativeToStage(clientX, clientY, stage) {
    return {
        x: clientX - stage.getContent().offsetLeft,
        y: clientY - stage.getContent().offsetTop,
    }
}

function pinchZoomTouchEvent(stage) {
    if (stage) {
        stage.getContent().addEventListener('touchmove', (evt) => {
            const t1 = evt.touches[0];
            const t2 = evt.touches[1];
            evt.preventDefault();

            if (t1 && t2) {
                evt.stopPropagation();
                const oldScale = stage.scaleX();

                const dist = getDistance({
                    x: t1.clientX,
                    y: t1.clientY
                }, {
                    x: t2.clientX,
                    y: t2.clientY
                });
                if (!lastDist) lastDist = dist;
                const delta = dist - lastDist;

                const px = (t1.clientX + t2.clientX) / 2;
                const py = (t1.clientY + t2.clientY) / 2;
                const pointer = point || clientPointerRelativeToStage(px, py, stage);
                if (!point) point = pointer;

                const startPos = {
                    x: pointer.x / oldScale - stage.x() / oldScale,
                    y: pointer.y / oldScale - stage.y() / oldScale,
                };

                const scaleBy = 1.00 + Math.abs(delta) / 100;
                let newScale = delta < 0 ? oldScale / scaleBy : oldScale * scaleBy;
                newScale = Math.min(Math.max(newScale, 0.1), 10);
                stage.scale({
                    x: newScale,
                    y: newScale
                });

                const newPosition = {
                    x: (pointer.x / newScale - startPos.x) * newScale,
                    y: (pointer.y / newScale - startPos.y) * newScale,
                };

                stage.position(newPosition);
                stage.batchDraw();
                lastDist = dist;
            }
        }, false);

        stage.getContent().addEventListener('touchend', (evt) => {
            lastDist = 0;
            point = undefined;
        }, false);
    }
}

function konva_zoom(stage) {
    lastDist = undefined;
    point = undefined;
    pinchZoomWheelEvent(stage);
    pinchZoomTouchEvent(stage);
}


let stageWidth, stageHeight, resp_stage;

function fitStageIntoParentContainer() {
    var container = document.getElementById('konva-parent');
    if (!container) {
        console.log('konva resize, no state');
        return;
    }
    var containerWidth = container.offsetWidth;
    if (containerWidth < 100) { // avoid 0
        containerWidth = Math.max(window.screen.width, window.innerWidth) - 20;
        console.warn('konva resize 0, parent width:', containerWidth);
    }
    var scale = containerWidth / stageWidth;
    console.log('konva resize', stageWidth);
    resp_stage.width(stageWidth * scale);
    resp_stage.height(stageHeight * scale);
    resp_stage.scale({ x: scale, y: scale });
    resp_stage.draw();
}

function konva_responsive(stage, w, h) {
    resp_stage = stage;
    stageWidth = w;
    stageHeight = h;
    fitStageIntoParentContainer();
    window.addEventListener('resize', fitStageIntoParentContainer);
    
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
    
}


export { konva_zoom, konva_responsive };
