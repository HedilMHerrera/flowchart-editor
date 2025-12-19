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
