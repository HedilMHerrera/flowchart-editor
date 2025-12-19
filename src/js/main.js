const state = {
    tabs: {
        1: {
            shapes: [],
            connections: [],
            shapeIdCounter: 0,
            connectionIdCounter: 0
        }
    },
    currentTabId: 1,
    nextTabId: 2,
    selectedShapes: [],
    selectedConnection: null,
    draggedShape: null,
    dragOffset: { x: 0, y: 0 },
    isConnecting: false,
    connectionStart: null,
    tempLine: null,
    clipboard: [],
    undoStack: [],
    redoStack: []
};

function getCurrentTab() {
    return state.tabs[state.currentTabId];
}

function getCurrentShapes() {
    return getCurrentTab().shapes;
}

function getCurrentConnections() {
    return getCurrentTab().connections;
}

const svgCanvas = document.getElementById('svgCanvas');
const shapesLayer = document.getElementById('shapesLayer');
const connectionsLayer = document.getElementById('connectionsLayer');
const symbolItems = document.querySelectorAll('.symbol-item');
const tabsContainer = document.getElementById('tabsContainer');

let db;
try {
    db = new PouchDB('flow-editor');
} catch (e) {
    console.error('Error en la inicialización de PouchDB:', e);
}

function createNewTab() {
    const tabId = state.nextTabId++;
    state.tabs[tabId] = {
        shapes: [],
        connections: [],
        shapeIdCounter: 0,
        connectionIdCounter: 0
    };

    const tab = document.createElement('div');
    tab.className = 'tab';
    tab.dataset.tabId = tabId;
    tab.innerHTML = `
        <span>pestaña ${tabId}</span>
        <div class="tab-close">x</div>
    `;

    const addButton = tabsContainer.querySelector('.tab-add');
    tabsContainer.insertBefore(tab, addButton);

    switchToTab(tabId);
    autoSave();
}

function switchToTab(tabId) {
    tabsContainer.querySelectorAll('.tab').forEach(tab => {
        tab.classList.remove('active');
    });

    const selectedTab = tabsContainer.querySelector(`[data-tab-id="${tabId}"]`);
    if (selectedTab) {
        selectedTab.classList.add('active');
    }

    state.currentTabId = tabId;
    clearSelection();
    redrawCanvas();
}

function closeTab(tabId) {
    const tabCount = Object.keys(state.tabs).length;
    if (tabCount === 1) {
        getCurrentTab().shapes = [];
        getCurrentTab().connections = [];
        getCurrentTab().shapeIdCounter = 0;
        getCurrentTab().connectionIdCounter = 0;
        redrawCanvas();
        autoSave();
        return;
    }

    delete state.tabs[tabId];

    const tabElement = tabsContainer.querySelector(`[data-tab-id="${tabId}"]`);
    if (tabElement) {
        tabElement.remove();
    }

    if (state.currentTabId === tabId) {
        const remainingTabId = parseInt(Object.keys(state.tabs)[0]);
        switchToTab(remainingTabId);
    }

    autoSave();
}

tabsContainer.addEventListener('click', (e) => {
    const tab = e.target.closest('.tab');
    const closeBtn = e.target.closest('.tab-close');
    const addBtn = e.target.closest('.tab-add');

    if (closeBtn && tab) {
        e.stopPropagation();
        const tabId = parseInt(tab.dataset.tabId);
        closeTab(tabId);
    } else if (tab) {
        const tabId = parseInt(tab.dataset.tabId);
        switchToTab(tabId);
    } else if (addBtn) {
        createNewTab();
    }
});

function createShape(type, x, y, text = '') {
    const currentTab = getCurrentTab();
    const id = `shape-${currentTab.shapeIdCounter++}`;
    const shape = {
        id,
        type,
        x,
        y,
        text: text || getDefaultText(type),
        width: type === 'decision' ? 120 : type === 'input' ? 100 : type === 'document' ? 100 : 100,
        height: type === 'decision' ? 120 : type === 'input' ? 60 : type === 'document' ? 70 : type === 'start' ? 60 : 80
    };
    currentTab.shapes.push(shape);
    renderShape(shape);
    expandCanvasToFitShapes();
    saveState();
    autoSave();
    return shape;
}

function getDefaultText(type) {
    const texts = {
        start: 'Inicio/Fin',
        process: 'Proceso',
        decision: 'Condición',
        input: 'Entrada/Salida',
        document: 'Documento',
        comment: 'Comentario'
    };
    return texts[type] || 'Texto';
}

function renderShape(shape) {
    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    g.setAttribute('class', 'shape-group');
    g.setAttribute('data-id', shape.id);
    g.setAttribute('transform', `translate(${shape.x}, ${shape.y})`);

    let shapeElement;
    switch (shape.type) {
        case 'start':
            shapeElement = document.createElementNS('http://www.w3.org/2000/svg', 'ellipse');
            shapeElement.setAttribute('cx', shape.width / 2);
            shapeElement.setAttribute('cy', shape.height / 2);
            shapeElement.setAttribute('rx', shape.width / 2);
            shapeElement.setAttribute('ry', shape.height / 2);
            break;
        case 'process':
            shapeElement = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
            shapeElement.setAttribute('width', shape.width);
            shapeElement.setAttribute('height', shape.height);
            shapeElement.setAttribute('rx', 5);
            break;
        case 'decision':
            shapeElement = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
            const points = `${shape.width / 2},0 ${shape.width},${shape.height / 2} ${shape.width / 2},${shape.height} 0,${shape.height / 2}`;
            shapeElement.setAttribute('points', points);
            break;
        case 'input':
            shapeElement = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
            const inputPoints = `${shape.width * 0.15},0 ${shape.width},0 ${shape.width * 0.85},${shape.height} 0,${shape.height}`;
            shapeElement.setAttribute('points', inputPoints);
            break;
        case 'document':
            shapeElement = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            const docPath = `M0,0 L${shape.width},0 L${shape.width},${shape.height * 0.8} Q${shape.width * 0.75},${shape.height * 0.9} ${shape.width * 0.5},${shape.height * 0.8} Q${shape.width * 0.25},${shape.height * 0.7} 0,${shape.height * 0.8} Z`;
            shapeElement.setAttribute('d', docPath);
            break;
        case 'comment':
            shapeElement = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            const foldSize = 15;
            const commentPath = `M0,0 L${shape.width - foldSize},0 L${shape.width - foldSize},${foldSize} L${shape.width},${foldSize} L${shape.width},${shape.height} L0,${shape.height} Z M${shape.width - foldSize},0 L${shape.width},${foldSize} L${shape.width - foldSize},${foldSize} Z`;
            shapeElement.setAttribute('d', commentPath);
            break;
    }
    shapeElement.setAttribute('class', 'shape-element');

    let fillColor = '#ff6b35';
    if (shape.type === 'start') {
        fillColor = '#91e69f';
    } else if (shape.type === 'process' || shape.type === 'input' || shape.type === 'document') {
        fillColor = '#5ac56c';
    } else if (shape.type === 'decision') {
        fillColor = '#4cd4e6';
    } else if (shape.type === 'comment') {
        fillColor = '#bfc9d1';
    }
    shapeElement.setAttribute('fill', fillColor);
    shapeElement.setAttribute('stroke', 'none');
    shapeElement.setAttribute('stroke-width', '0');
    g.appendChild(shapeElement);

    const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    text.setAttribute('class', 'shape-text');
    if (shape.type === 'comment') {
        text.classList.add('comment-text');
        text.setAttribute('fill', '#222');
    }
    text.setAttribute('x', shape.width / 2);
    text.setAttribute('y', shape.height / 2);

    wrapText(text, shape.text, shape.width - 20);
    g.appendChild(text);

    if (shape.type !== 'comment') {
        const points = getConnectionPoints(shape);
        points.forEach((point, index) => {
            const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
            circle.setAttribute('class', 'connection-point');
            circle.setAttribute('cx', point.x);
            circle.setAttribute('cy', point.y);
            circle.setAttribute('r', 5);
            circle.setAttribute('data-point', index);
            g.appendChild(circle);
        });

        const resizeHandle = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        resizeHandle.setAttribute('class', 'resize-handle');
        resizeHandle.setAttribute('x', shape.width - 8);
        resizeHandle.setAttribute('y', shape.height - 8);
        resizeHandle.setAttribute('width', 8);
        resizeHandle.setAttribute('height', 8);
        g.appendChild(resizeHandle);
    } else {
        const resizeHandle = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        resizeHandle.setAttribute('class', 'resize-handle');
        resizeHandle.setAttribute('x', shape.width - 8);
        resizeHandle.setAttribute('y', shape.height - 8);
        resizeHandle.setAttribute('width', 8);
        resizeHandle.setAttribute('height', 8);
        g.appendChild(resizeHandle);
    }

    shapesLayer.appendChild(g);
}

function wrapText(textElement, text, maxWidth) {

    while (textElement.firstChild) textElement.removeChild(textElement.firstChild);

    const paragraphs = text.split(/\r?\n/);
    const allLines = [];
    const lineHeight = 16;
    paragraphs.forEach(paragraph => {
        const words = paragraph.split(' ');
        let line = '';

        const tempTspan = document.createElementNS('http://www.w3.org/2000/svg', 'tspan');
        tempTspan.setAttribute('x', textElement.getAttribute('x'));
        textElement.appendChild(tempTspan);
        words.forEach((word, i) => {
            const testLine = line ? line + ' ' + word : word;
            tempTspan.textContent = testLine;
            const bbox = textElement.getBBox();
            if (bbox.width > maxWidth && line) {
                allLines.push(line);
                line = word;
            } else {
                line = testLine;
            }
        });
        if (line) allLines.push(line);
        tempTspan.remove();
    });

    const totalHeight = allLines.length * lineHeight;
    const yStart = parseFloat(textElement.getAttribute('y')) - totalHeight / 2 + lineHeight / 2;

    if (textElement.classList.contains('comment-text')) {
        textElement.setAttribute('fill', '#222');
    }
    allLines.forEach((l, idx) => {
        const tspan = document.createElementNS('http://www.w3.org/2000/svg', 'tspan');
        tspan.textContent = l;
        tspan.setAttribute('x', textElement.getAttribute('x'));
        tspan.setAttribute('y', yStart + idx * lineHeight);
        if (textElement.classList.contains('comment-text')) {
            tspan.setAttribute('fill', '#222');
        }
        textElement.appendChild(tspan);
    });
}

function getConnectionPoints(shape) {
    const w = shape.width;
    const h = shape.height;

    if (shape.type === 'decision') {
        return [
            { x: w / 2, y: 0 },
            { x: w, y: h / 2 },
            { x: 0, y: h / 2 },
        ];
    }

    return [
        { x: w / 2, y: 0 },
        { x: w, y: h / 2 },
        { x: w / 2, y: h },
        { x: 0, y: h / 2 },
    ];
}

symbolItems.forEach(item => {
    item.addEventListener('pointerdown', (e) => {
        const shapeType = item.dataset.shape;
        const clone = item.cloneNode(true);
        clone.style.position = 'fixed';
        clone.style.pointerEvents = 'none';
        clone.style.opacity = '0.7';
        clone.style.left = e.clientX - 25 + 'px';
        clone.style.top = e.clientY - 25 + 'px';
        document.body.appendChild(clone);

        const moveHandler = (e) => {
            clone.style.left = e.clientX - 25 + 'px';
            clone.style.top = e.clientY - 25 + 'px';
        };

        const upHandler = (e) => {
            document.removeEventListener('pointermove', moveHandler);
            document.removeEventListener('pointerup', upHandler);
            clone.remove();

            const canvasRect = svgCanvas.getBoundingClientRect();
            if (e.clientX >= canvasRect.left && e.clientX <= canvasRect.right &&
                e.clientY >= canvasRect.top && e.clientY <= canvasRect.bottom) {
                const x = e.clientX - canvasRect.left - 50;
                const y = e.clientY - canvasRect.top - 40;
                createShape(shapeType, x, y);
            }
        };

        document.addEventListener('pointermove', moveHandler);
        document.addEventListener('pointerup', upHandler);
    });
});

svgCanvas.addEventListener('pointerdown', (e) => {
    const target = e.target;
    const shapeGroup = target.closest('.shape-group');

    if (target.classList.contains('connection-point')) {
        startConnection(shapeGroup, parseInt(target.dataset.point));
        return;
    }

    if (target.classList.contains('resize-handle')) {
        startResize(shapeGroup, e);
        return;
    }

    if (shapeGroup) {
        const shapeId = shapeGroup.dataset.id;

        if (!e.ctrlKey && !state.selectedShapes.includes(shapeId)) {
            clearSelection();
        }

        selectShape(shapeId);

        const shape = getCurrentShapes().find(s => s.id === shapeId);
        const rect = svgCanvas.getBoundingClientRect();
        state.dragOffset = {
            x: e.clientX - rect.left - shape.x,
            y: e.clientY - rect.top - shape.y
        };
        state.draggedShape = shapeId;
    } else if (target.classList.contains('connection-line')) {
        clearSelection();
        selectConnection(target.dataset.id);
    } else {
        clearSelection();
    }
});

let resizingShape = null;
let resizeStartSize = { width: 0, height: 0 };
let resizeStartPos = { x: 0, y: 0 };

function startResize(shapeGroup, e) {
    const shapeId = shapeGroup.dataset.id;
    const shape = getCurrentShapes().find(s => s.id === shapeId);
    resizingShape = shape;
    resizeStartSize = { width: shape.width, height: shape.height };
    const rect = svgCanvas.getBoundingClientRect();
    resizeStartPos = { x: e.clientX - rect.left, y: e.clientY - rect.top };
}

svgCanvas.addEventListener('pointermove', (e) => {
    if (state.draggedShape) {
        const rect = svgCanvas.getBoundingClientRect();
        const x = e.clientX - rect.left - state.dragOffset.x;
        const y = e.clientY - rect.top - state.dragOffset.y;

        state.selectedShapes.forEach(shapeId => {
            const shape = getCurrentShapes().find(s => s.id === shapeId);
            shape.x = x;
            shape.y = y;
            updateShapePosition(shape);
        });
    } else if (resizingShape) {
        const rect = svgCanvas.getBoundingClientRect();
        const currentX = e.clientX - rect.left;
        const currentY = e.clientY - rect.top;
        const deltaX = currentX - resizeStartPos.x;
        const deltaY = currentY - resizeStartPos.y;

        resizingShape.width = Math.max(60, resizeStartSize.width + deltaX);
        resizingShape.height = Math.max(40, resizeStartSize.height + deltaY);

        updateShapeRender(resizingShape);
    } else if (state.isConnecting && state.tempLine) {
        const rect = svgCanvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        state.tempLine.setAttribute('x2', x);
        state.tempLine.setAttribute('y2', y);
    }
});

svgCanvas.addEventListener('pointerup', () => {
    if (state.draggedShape) {
        saveState();
        autoSave();
        state.draggedShape = null;
    }
    if (resizingShape) {
        saveState();
        autoSave();
        resizingShape = null;
    }
});

function updateShapePosition(shape) {
    const g = shapesLayer.querySelector(`[data-id="${shape.id}"]`);
    if (g) {
        g.setAttribute('transform', `translate(${shape.x}, ${shape.y})`);
        updateConnections(shape.id);
    }
    expandCanvasToFitShapes();
}

function updateShapeRender(shape) {
    const g = shapesLayer.querySelector(`[data-id="${shape.id}"]`);
    if (g) {
        g.remove();
        renderShape(shape);

        const newG = shapesLayer.querySelector(`[data-id="${shape.id}"]`);
        if (newG) {
            const textElement = newG.querySelector('.shape-text');
            if (textElement) {
                wrapText(textElement, shape.text, shape.width - 20);
            }
        }
        updateConnections(shape.id);
    }
    expandCanvasToFitShapes();

    function expandCanvasToFitShapes() {
        const shapes = getCurrentShapes();
        if (shapes.length === 0) return;
        let minX = 0, minY = 0, maxX = 0, maxY = 0;
        shapes.forEach(s => {
            minX = Math.min(minX, s.x);
            minY = Math.min(minY, s.y);
            maxX = Math.max(maxX, s.x + s.width);
            maxY = Math.max(maxY, s.y + s.height);
        });

        maxX += 40;
        maxY += 40;
        svgCanvas.setAttribute('width', maxX);
        svgCanvas.setAttribute('height', maxY);
    }
}

function canConnect(shapeId, direction) {
    const shape = getCurrentShapes().find(s => s.id === shapeId);
    if (!shape) return false;

    const connections = getCurrentConnections();
    const outgoing = connections.filter(c => c.fromId === shapeId);
    const incoming = connections.filter(c => c.toId === shapeId);

    switch (shape.type) {
        case 'start':
            if (direction === 'in') return incoming.length === 0;
            if (direction === 'out') return outgoing.length === 0;
            break;
        case 'process':
            if (direction === 'out') return outgoing.length === 0;
            if (direction === 'in') return true;
            break;
        case 'input':
            if (direction === 'out') return outgoing.length === 0;
            if (direction === 'in') return incoming.length === 0;
            break;
        case 'decision':
            if (direction === 'in') return incoming.length === 0;
            if (direction === 'out') return outgoing.length < 2;
            break;
        case 'document':
            if (direction === 'out') return false;
            if (direction === 'in') return incoming.length === 0;
            break;
        default:
            return true;
    }
    return true;
}

function startConnection(shapeGroup, pointIndex) {
    const shapeId = shapeGroup.dataset.id;

    if (!canConnect(shapeId, 'out')) {
        return;
    }

    const shape = getCurrentShapes().find(s => s.id === shapeId);
    const points = getConnectionPoints(shape);
    const point = points[pointIndex];

    state.isConnecting = true;
    state.connectionStart = { shapeId, pointIndex, x: shape.x + point.x, y: shape.y + point.y };

    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('x1', state.connectionStart.x);
    line.setAttribute('y1', state.connectionStart.y);
    line.setAttribute('x2', state.connectionStart.x);
    line.setAttribute('y2', state.connectionStart.y);
    line.setAttribute('stroke', '#333');
    line.setAttribute('stroke-width', '2');
    line.setAttribute('marker-end', 'url(#arrowhead)');
    connectionsLayer.appendChild(line);
    state.tempLine = line;
}

svgCanvas.addEventListener('pointerup', (e) => {
    if (state.isConnecting) {
        const target = e.target;
        if (target.classList.contains('connection-point')) {
            const shapeGroup = target.closest('.shape-group');
            const endShapeId = shapeGroup.dataset.id;
            const endPointIndex = parseInt(target.dataset.point);

            if (endShapeId !== state.connectionStart.shapeId && canConnect(endShapeId, 'in')) {
                createConnection(
                    state.connectionStart.shapeId,
                    state.connectionStart.pointIndex,
                    endShapeId,
                    endPointIndex
                );
            }
        }

        if (state.tempLine) {
            state.tempLine.remove();
            state.tempLine = null;
        }
        state.isConnecting = false;
        state.connectionStart = null;
    }
});

function createConnection(fromId, fromPoint, toId, toPoint) {
    const currentTab = getCurrentTab();
    const id = `conn-${currentTab.connectionIdCounter++}`;
    const connection = { id, fromId, fromPoint, toId, toPoint };
    currentTab.connections.push(connection);
    renderConnection(connection);
    saveState();
    autoSave();
}

function renderConnection(conn) {
    const fromShape = getCurrentShapes().find(s => s.id === conn.fromId);
    const toShape = getCurrentShapes().find(s => s.id === conn.toId);
    if (!fromShape || !toShape) return;

    const fromPoints = getConnectionPoints(fromShape);
    const toPoints = getConnectionPoints(toShape);

    let fromIdx = conn.fromPoint;
    let toIdx = conn.toPoint;

    if (toShape.type === 'decision') {

        toIdx = 0;
    }
    if (fromShape.type === 'decision') {

        if (conn.fromPoint !== 1 && conn.fromPoint !== 2) {
            fromIdx = 1;
        }
    }

    const from = fromPoints[fromIdx];
    const to = toPoints[toIdx];
    const startX = fromShape.x + from.x;
    const startY = fromShape.y + from.y;
    const endX = toShape.x + to.x;
    const endY = toShape.y + to.y;

    let pathD = '';
    const offset = 32;
    let color = '#333';

    if (fromShape.type === 'start') {
        pathD = `M ${startX} ${startY} L ${endX} ${endY}`;
    }

    else if (fromShape.type === 'process') {

        if (fromIdx === 0 || fromIdx === 2) {
            pathD = `M ${startX} ${startY} L ${endX} ${endY}`;
        }
        else if (fromIdx === 1 || fromIdx === 3) {

            if (Math.abs(startY - endY) < 20) {
                pathD = `M ${startX} ${startY} L ${endX} ${endY}`;
            } else {
                if (endY > startY) {
                    if (endX < startX) {
                        pathD = `M ${startX} ${startY} L ${startX - offset} ${startY} L ${startX - offset} ${endY} L ${endX} ${endY}`;
                    } else {
                        pathD = `M ${startX} ${startY} L ${startX + offset} ${startY} L ${startX + offset} ${endY} L ${endX} ${endY}`;
                    }
                } else {
                    pathD = `M ${startX} ${startY} L ${endX} ${endY}`;
                }
            }
        }
    }

    else if (fromShape.type === 'decision') {
        if (fromIdx === 1) {
            if (Math.abs(startY - endY) < 20) {
                pathD = `M ${startX} ${startY} L ${endX} ${endY}`;
            } else if (endY > startY) {
                pathD = `M ${startX} ${startY} L ${endX} ${startY} L ${endX} ${endY}`;
            } else {
                pathD = `M ${startX} ${startY} L ${endX} ${endY}`;
            }
            color = '#2ecc40';
        } else if (fromIdx === 2) {
            if (Math.abs(startY - endY) < 20) {
                pathD = `M ${startX} ${startY} L ${endX} ${endY}`;
            } else if (endY > startY) {
                pathD = `M ${startX} ${startY} L ${endX} ${startY} L ${endX} ${endY}`;
            } else {
                pathD = `M ${startX} ${startY} L ${endX} ${endY}`;
            }
            color = '#ff4136';
        } else {
            pathD = `M ${startX} ${startY} L ${endX} ${endY}`;
        }
    } else if (toShape.type === 'decision') {
        pathD = `M ${startX} ${startY} L ${endX} ${endY}`;
    } else {
        if (Math.abs(startX - endX) > Math.abs(startY - endY)) {
            pathD = `M ${startX} ${startY} L ${endX} ${startY} L ${endX} ${endY}`;
        } else {
            pathD = `M ${startX} ${startY} L ${startX} ${endY} L ${endX} ${endY}`;
        }
    }

    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', pathD);
    path.setAttribute('class', 'connection-line');
    path.setAttribute('data-id', conn.id);
    path.setAttribute('marker-end', 'url(#arrowhead)');
    path.setAttribute('stroke', color);
    connectionsLayer.appendChild(path);

    if (fromShape.type === 'decision') {
        const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        label.setAttribute('class', 'arrow-label');
        label.setAttribute('data-conn-id', conn.id);
        const labelText = fromIdx === 2 ? 'NO' : fromIdx === 1 ? 'SI' : '';
        label.textContent = labelText;
        label.setAttribute('fill', color);
        const labelX = startX + (fromIdx === 1 ? offset / 2 : fromIdx === 2 ? -offset / 2 : 0);
        const labelY = startY - 6;
        label.setAttribute('x', labelX);
        label.setAttribute('y', labelY);
        connectionsLayer.appendChild(label);
    }
}

function updateConnections(shapeId) {
    getCurrentConnections().forEach(conn => {
        if (conn.fromId === shapeId || conn.toId === shapeId) {
            const path = connectionsLayer.querySelector(`path[data-id="${conn.id}"]`);
            const label = connectionsLayer.querySelector(`text[data-conn-id="${conn.id}"]`);

            if (path) {
                path.remove();
            }
            if (label) {
                label.remove();
            }

            renderConnection(conn);
        }
    });
}

function selectShape(shapeId) {
    if (!state.selectedShapes.includes(shapeId)) {
        state.selectedShapes.push(shapeId);
    }
    const g = shapesLayer.querySelector(`[data-id="${shapeId}"]`);
    if (g) g.classList.add('selected');
}

function selectConnection(connId) {
    state.selectedConnection = connId;
    const path = connectionsLayer.querySelector(`[data-id="${connId}"]`);
    if (path) path.classList.add('selected');
}

function clearSelection() {
    state.selectedShapes.forEach(id => {
        const g = shapesLayer.querySelector(`[data-id="${id}"]`);
        if (g) g.classList.remove('selected');
    });
    state.selectedShapes = [];

    if (state.selectedConnection) {
        const path = connectionsLayer.querySelector(`[data-id="${state.selectedConnection}"]`);
        if (path) path.classList.remove('selected');
        state.selectedConnection = null;
    }
}

svgCanvas.addEventListener('dblclick', (e) => {
    const shapeGroup = e.target.closest('.shape-group');
    if (shapeGroup) {
        const shapeId = shapeGroup.dataset.id;
        const shape = getCurrentShapes().find(s => s.id === shapeId);
        editShapeText(shape, shapeGroup);
    }
});

function editShapeText(shape, shapeGroup) {
    const canvasRect = svgCanvas.getBoundingClientRect();
    const shapeCenterX = shape.x + shape.width / 2;
    const shapeCenterY = shape.y + shape.height / 2;
    const textElement = shapeGroup.querySelector('.shape-text');

    const maxWidth = shape.width - 20;
    const words = shape.text.split(' ');
    let lines = [];
    let line = '';
    const lineHeight = 16;
    const tempTspan = document.createElementNS('http://www.w3.org/2000/svg', 'tspan');
    tempTspan.setAttribute('x', textElement.getAttribute('x'));
    textElement.appendChild(tempTspan);
    words.forEach((word) => {
        const testLine = line ? line + ' ' + word : word;
        tempTspan.textContent = testLine;
        const bbox = textElement.getBBox();
        if (bbox.width > maxWidth && line) {
            lines.push(line);
            line = word;
        } else {
            line = testLine;
        }
    });
    if (line) lines.push(line);
    tempTspan.remove();

    const textarea = document.createElement('textarea');
    textarea.className = 'text-editor';
    textarea.value = shape.text;
    textarea.style.left = (canvasRect.left + shape.x + 10) + 'px';
    textarea.style.top = (canvasRect.top + shape.y + (shape.height - lines.length * lineHeight) / 2) + 'px';
    textarea.style.width = maxWidth + 'px';
    textarea.style.height = (lines.length * lineHeight + 8) + 'px';
    textarea.style.textAlign = 'center';
    textarea.style.resize = 'none';
    textarea.style.fontFamily = 'inherit';
    textarea.style.fontSize = '14px';
    textarea.style.lineHeight = lineHeight + 'px';
    textarea.style.overflow = 'hidden';

    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();

    textarea.addEventListener('input', () => {
        const value = textarea.value;
        const words = value.split(' ');
        let lines = [];
        let line = '';
        tempTspan.textContent = '';
        textElement.appendChild(tempTspan);
        words.forEach((word) => {
            const testLine = line ? line + ' ' + word : word;
            tempTspan.textContent = testLine;
            const bbox = textElement.getBBox();
            if (bbox.width > maxWidth && line) {
                lines.push(line);
                line = word;
            } else {
                line = testLine;
            }
        });
        if (line) lines.push(line);
        tempTspan.remove();
        textarea.style.height = (lines.length * lineHeight + 8) + 'px';
    });

    const finishEdit = () => {
        shape.text = textarea.value;
        while (textElement.firstChild) textElement.removeChild(textElement.firstChild);
        wrapText(textElement, textarea.value, maxWidth);
        textarea.remove();
        saveState();
        autoSave();
    };

    textarea.addEventListener('blur', finishEdit);
    textarea.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            finishEdit();
        }
        if (e.key === 'Escape') {
            textarea.value = shape.text;
            finishEdit();
        }
    });
}

document.addEventListener('keydown', (e) => {
    if (e.key === 'Delete') {
        deleteSelected();
    }

    if (e.ctrlKey && e.key === 'z') {
        e.preventDefault();
        undo();
    }

    if (e.ctrlKey && e.key === 'y') {
        e.preventDefault();
        redo();
    }

    if (e.ctrlKey && e.key === 'c') {
        e.preventDefault();
        copy();
    }

    if (e.ctrlKey && e.key === 'v') {
        e.preventDefault();
        paste();
    }
});

function deleteSelected() {
    if (state.selectedShapes.length > 0) {
        state.selectedShapes.forEach(shapeId => {
            const g = shapesLayer.querySelector(`[data-id="${shapeId}"]`);
            if (g) g.remove();

            const currentTab = getCurrentTab();
            currentTab.connections = currentTab.connections.filter(conn => {
                if (conn.fromId === shapeId || conn.toId === shapeId) {
                    const path = connectionsLayer.querySelector(`path[data-id="${conn.id}"]`);
                    const label = connectionsLayer.querySelector(`text[data-conn-id="${conn.id}"]`);
                    if (path) path.remove();
                    if (label) label.remove();
                    return false;
                }
                return true;
            });

            currentTab.shapes = currentTab.shapes.filter(s => s.id !== shapeId);
        });
        state.selectedShapes = [];
        saveState();
        autoSave();
    } else if (state.selectedConnection) {
        const path = connectionsLayer.querySelector(`path[data-id="${state.selectedConnection}"]`);
        const label = connectionsLayer.querySelector(`text[data-conn-id="${state.selectedConnection}"]`);
        if (path) path.remove();
        if (label) label.remove();
        const currentTab = getCurrentTab();
        currentTab.connections = currentTab.connections.filter(c => c.id !== state.selectedConnection);
        state.selectedConnection = null;
        saveState();
        autoSave();
    }
}

function copy() {
    state.clipboard = state.selectedShapes.map(id => {
        const shape = getCurrentShapes().find(s => s.id === id);
        return { ...shape };
    });
}

function paste() {
    if (state.clipboard.length > 0) {
        clearSelection();
        state.clipboard.forEach(shape => {
            const newShape = createShape(shape.type, shape.x + 20, shape.y + 20, shape.text);
            selectShape(newShape.id);
        });
    }
}

function saveState() {
    const snapshot = {
        shapes: JSON.parse(JSON.stringify(getCurrentShapes())),
        connections: JSON.parse(JSON.stringify(getCurrentConnections()))
    };
    state.undoStack.push(snapshot);
    state.redoStack = [];
}

function undo() {
    if (state.undoStack.length > 1) {
        const current = state.undoStack.pop();
        state.redoStack.push(current);
        const previous = state.undoStack[state.undoStack.length - 1];
        restoreState(previous);
    }
}

function redo() {
    if (state.redoStack.length > 0) {
        const next = state.redoStack.pop();
        state.undoStack.push(next);
        restoreState(next);
    }
}

function restoreState(snapshot) {
    const currentTab = getCurrentTab();
    currentTab.shapes = JSON.parse(JSON.stringify(snapshot.shapes));
    currentTab.connections = JSON.parse(JSON.stringify(snapshot.connections));
    redrawCanvas();
}

function redrawCanvas() {
    shapesLayer.innerHTML = '';
    connectionsLayer.innerHTML = '';
    getCurrentShapes().forEach(shape => {
        renderShape(shape);
        const g = shapesLayer.querySelector(`[data-id="${shape.id}"]`);
        if (g) {
            const textElement = g.querySelector('.shape-text');
            if (textElement) {
                wrapText(textElement, shape.text, shape.width - 20);
            }
        }
    });
    getCurrentConnections().forEach(renderConnection);
}

let autoSaveTimeout;
function autoSave() {
    clearTimeout(autoSaveTimeout);
    autoSaveTimeout = setTimeout(() => {
        saveToDB();
    }, 3000);
}

async function saveToDB() {
    if (!db) return;
    try {
        const doc = {
            _id: 'diagram:current',
            tabs: state.tabs,
            currentTabId: state.currentTabId,
            nextTabId: state.nextTabId,
            timestamp: new Date().toISOString()
        };

        const existing = await db.get('diagram:current').catch(() => null);
        if (existing) {
            doc._rev = existing._rev;
        }

        await db.put(doc);
    } catch (e) {
        console.error('[v0] PouchDB save error:', e);
    }
}

function showSaveMessage() {
    const message = document.createElement('div');
    message.className = 'save-message';
    message.textContent = 'Diagrama guardado';
    document.body.appendChild(message);

    setTimeout(() => {
        message.remove();
    }, 2000);
}

async function loadFromDB() {
    if (!db) return;
    try {
        const doc = await db.get('diagram:current');
        state.tabs = doc.tabs || { 1: { shapes: [], connections: [], shapeIdCounter: 0, connectionIdCounter: 0 } };
        state.currentTabId = doc.currentTabId || 1;
        state.nextTabId = doc.nextTabId || 2;

        const existingTabs = tabsContainer.querySelectorAll('.tab');
        existingTabs.forEach(tab => tab.remove());

        Object.keys(state.tabs).forEach(tabId => {
            const tab = document.createElement('div');
            tab.className = 'tab';
            if (parseInt(tabId) === state.currentTabId) {
                tab.classList.add('active');
            }
            tab.dataset.tabId = tabId;
            tab.innerHTML = `
                <span>pestaña ${tabId}</span>
                <div class="tab-close">x</div>
            `;
            const addButton = tabsContainer.querySelector('.tab-add');
            tabsContainer.insertBefore(tab, addButton);
        });

        redrawCanvas();
        saveState();
    } catch (e) {
        saveState();
    }
}

let fileHandle = null;

async function saveToFileSystem() {
    const data = {
        tabs: state.tabs,
        currentTabId: state.currentTabId,
        nextTabId: state.nextTabId,
        version: '1.0'
    };

    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });

    if ('showSaveFilePicker' in window) {
        try {
            fileHandle = await window.showSaveFilePicker({
                suggestedName: 'diagrama.json',
                types: [{
                    description: 'JSON Files',
                    accept: { 'application/json': ['.json'] }
                }]
            });
            const writable = await fileHandle.createWritable();
            await writable.write(blob);
            await writable.close();
            return;
        } catch (e) {
            if (e.name === 'AbortError') {
                return;
            }
            console.error('[v0] File System Access API error:', e);
        }
    }

    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'diagrama.json';
    a.click();
    URL.revokeObjectURL(a.href);
}

async function loadFromFileSystem() {

    if ('showOpenFilePicker' in window) {
        try {
            const [handle] = await window.showOpenFilePicker({
                types: [{
                    description: 'JSON Files',
                    accept: { 'application/json': ['.json'] }
                }]
            });
            fileHandle = handle;
            const file = await handle.getFile();
            const text = await file.text();
            const data = JSON.parse(text);
            loadDiagramData(data);
            return;
        } catch (e) {
            if (e.name === 'AbortError') {
                return;
            }
            console.error('[v0] File System Access API error:', e);
        }
    }

    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = async (e) => {
        const file = e.target.files[0];
        if (file) {
            const text = await file.text();
            const data = JSON.parse(text);
            loadDiagramData(data);
        }
    };
    input.click();
}

function loadDiagramData(data) {
    state.tabs = data.tabs || { 1: { shapes: [], connections: [], shapeIdCounter: 0, connectionIdCounter: 0 } };
    state.currentTabId = data.currentTabId || 1;
    state.nextTabId = data.nextTabId || 2;

    const existingTabs = tabsContainer.querySelectorAll('.tab');
    existingTabs.forEach(tab => tab.remove());

    Object.keys(state.tabs).forEach(tabId => {
        const tab = document.createElement('div');
        tab.className = 'tab';
        if (parseInt(tabId) === state.currentTabId) {
            tab.classList.add('active');
        }
        tab.dataset.tabId = tabId;
        tab.innerHTML = `
            <span>pestaña ${tabId}</span>
            <div class="tab-close">x</div>
        `;
        const addButton = tabsContainer.querySelector('.tab-add');
        tabsContainer.insertBefore(tab, addButton);
    });

    redrawCanvas();
    saveState();
    autoSave();
}

document.getElementById('btnSave').addEventListener('click', async () => {
    await saveToDB();
    showSaveMessage();
});

document.getElementById('btnOpen').addEventListener('click', loadFromFileSystem);
document.getElementById('btnDownload').addEventListener('click', saveToFileSystem);

window.addEventListener('load', () => {
    loadFromDB();
});

window.addEventListener('beforeunload', () => {
    saveToDB();
});