/**
 * InnerLore world map: a full-screen SVG view of the chat's living world.
 * Locations render from the store's entities (card seeds carry canonical
 * coordinates; discovered places auto-place near their parent), NPCs line up
 * with their location from the curator's containment records and current
 * state, and the player's position follows the compiled scene focus. The map
 * is a view over InnerLore state - it never generates or stores anything of
 * its own.
 */

const MAP_VIEWBOX = { width: 1000, height: 700 };

/**
 * Self-injected styles: extension CSS loads without a cache-buster, so a
 * stale stylesheet would leave these elements unstyled and invisible while
 * the (cache-busted) JavaScript runs the newest logic. Injecting the styles
 * from the module guarantees markup and styling always match.
 */
const MAP_STYLE_ID = 'il_map_inline_styles';
const MAP_STYLES = `
#il_map_overlay{position:fixed;inset:0;width:100vw;height:100vh;height:100dvh;z-index:31000;background:rgba(8,10,14,.96);display:flex;flex-direction:column;padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left);box-sizing:border-box}
.il-map-header{display:flex;align-items:center;gap:10px;padding:8px 12px;border-bottom:1px solid #333;flex-wrap:wrap;min-height:44px}
.il-map-title{font-weight:600;letter-spacing:.04em;color:#cfd8e6;white-space:nowrap}
.il-map-hint{flex:1 1 160px;font-size:.75em;color:#7a8494;min-width:140px}
.il-map-views{display:inline-flex;gap:4px}
.il-map-view-btn{padding:6px 12px;border-radius:8px;border:1px solid #5a5a66;background:rgba(22,22,28,.9);color:#9aa3b0;font-size:.85em;cursor:pointer;min-height:30px}
.il-map-view-btn.is-active{border-color:#c8b78a;color:#e2c99a}
.il-map-zoom{display:inline-flex;gap:4px}
.il-map-zoom-btn{width:34px;height:34px;border-radius:8px;border:1px solid #5a5a66;background:rgba(22,22,28,.9);color:#c8b78a;font-size:16px;line-height:1;cursor:pointer;display:inline-flex;align-items:center;justify-content:center}
.il-map-close{min-height:34px}
.il-map-body{flex:1 1 auto;display:flex;min-height:0;position:relative}
#il_map_svg{flex:1 1 auto;width:100%;height:100%;min-width:0;cursor:grab;touch-action:none;display:block}
#il_map_svg:active{cursor:grabbing}
.il-map-hit{fill:transparent}
.il-map-node{cursor:pointer}
.il-map-dot{fill:#9db4a4;stroke:#1b211c;stroke-width:1.5}
.il-map-place .il-map-dot{fill:#c8b78a}
.il-map-discovered .il-map-dot{fill:#7fa9c9}
.il-map-region .il-map-dot{fill:none;stroke:#8fa3b8;stroke-dasharray:3 3}
.il-map-label{fill:#d8dee8;font-size:12px;font-family:serif;paint-order:stroke;stroke:rgba(10,14,18,.85);stroke-width:3px}
.il-map-region .il-map-label{font-style:italic;letter-spacing:2px;fill:#9fb0c2}
.il-map-link{stroke:rgba(140,160,180,.25);stroke-width:1.2;stroke-dasharray:4 5}
.il-map-npc-ring{fill:none;stroke:rgba(156,142,238,.6);stroke-width:1.5}
.il-map-player-halo{fill:none;stroke:#8fb7e8;stroke-width:2;opacity:.8}
.il-map-player-dot{fill:#8fb7e8;stroke:#e8f2ff;stroke-width:2}
.il-map-player-label{fill:#cfe3f7;font-size:13px;font-weight:600;paint-order:stroke;stroke:rgba(10,14,18,.85);stroke-width:3px}
.il-map-chips{display:flex;flex-wrap:wrap;gap:3px;justify-content:center;pointer-events:none}
.il-map-chip{font-size:10px;line-height:1;padding:2px 5px;border-radius:6px;border:1px solid #5a5a66;background:rgba(22,22,28,.85);color:#b9bec8;white-space:nowrap}
.il-map-chip.is-active{border-color:#8ee6a2;color:#b9f0c6}
.il-map-chip.is-recent{border-color:#f5d77d;color:#f0e2b0}
.il-map-chip.is-dormant{opacity:.55}
.il-map-detail{width:300px;max-width:46vw;border-left:1px solid #333;background:rgba(16,18,24,.96);padding:14px 16px;overflow-y:auto;color:#c9cfd9;box-sizing:border-box}
.il-map-detail h3{margin:0 0 8px;color:#e2c99a}
.il-map-detail-summary{font-size:.9em}
.il-map-detail-state{font-size:.85em;color:#9fd6a8}
.il-map-detail-facts{margin:8px 0;padding-left:18px;font-size:.85em;color:#a8b0bc}
.il-map-detail-npcs ul{list-style:none;margin:6px 0 0;padding:0;display:flex;flex-direction:column;gap:4px}
.il-map-detail-npcs li{font-size:.85em;padding:3px 8px;border-radius:6px;border:1px solid #444}
.il-map-detail-npcs li.is-active{border-color:#8ee6a2;color:#b9f0c6}
.il-map-detail-npcs li.is-recent{border-color:#f5d77d;color:#f0e2b0}
.il-map-detail-npcs li.is-dormant{opacity:.55}
.il-map-toggle{pointer-events:auto;display:inline-flex;align-items:center;padding:4px 8px;border-radius:9px;border:1px solid #5a5a66;background:rgba(22,22,28,.88);color:#c8b78a;cursor:pointer}
.il-map-toggle svg{width:16px;height:16px;display:block}
#il_minimap{position:fixed;right:12px;top:calc(env(safe-area-inset-top,0px) + 54px);z-index:40000;width:190px;border:1px solid #5a5a66;border-radius:12px;background:rgba(16,18,24,.92);box-shadow:0 4px 14px rgba(0,0,0,.4);color:#c9cfd9;font-size:.8em;cursor:grab;touch-action:none}
.il-minimap-head{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:7px 10px 4px;border-bottom:1px solid #333}
.il-minimap-loc{font-weight:600;color:#e2c99a}
.il-minimap-expand{cursor:pointer;color:#8fb7e8;padding:2px 4px}
.il-minimap-body{padding:6px 10px 8px}
.il-minimap-near{display:flex;flex-direction:column;gap:3px;color:#a8b0bc}
.il-minimap-near.is-empty{font-style:italic;color:#6d7684}
.il-minimap-dots{display:flex;gap:4px;margin-top:6px}
.il-minimap-dots i{width:7px;height:7px;border-radius:50%;background:#5a5a66}
.il-minimap-dots i.is-on{background:#8ee6a2;box-shadow:0 0 6px rgba(142,230,162,.7)}
.il-scene-link{stroke:rgba(156,142,238,.4);stroke-width:1.6;stroke-dasharray:none}
.il-scene-dot{stroke-width:2.5;filter:drop-shadow(0 0 6px rgba(200,183,138,.45))}
@media (max-width:720px){.il-map-hint{display:none}.il-map-title{font-size:.92em}.il-map-detail{position:absolute;left:0;right:0;bottom:0;width:auto;max-width:none;max-height:46%;border-left:none;border-top:1px solid #333;border-radius:14px 14px 0 0}#il_minimap{width:156px;right:8px;top:calc(env(safe-area-inset-top,0px) + 60px);font-size:.75em}}
@media (max-width:400px){.il-map-header{gap:6px;padding:6px 8px}.il-map-zoom-btn{width:30px;height:30px}}
`;

function ensureInlineStyles() {
    if (typeof document === 'undefined') return;
    if (document.getElementById(MAP_STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = MAP_STYLE_ID;
    style.textContent = MAP_STYLES;
    document.head.appendChild(style);
}

function svgEscape(value) {
    return String(value ?? '')
        .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;').replaceAll("'", '&apos;');
}

function hashStringLite(value) {
    let hash = 0;
    for (let i = 0; i < String(value).length; i++) {
        hash = (hash * 31 + String(value).charCodeAt(i)) | 0;
    }
    return Math.abs(hash);
}

/** Continent art: sea, coastline, and softly tinted regions with labels. */
function worldArt() {
    return `
<defs>
    <radialGradient id="il-map-sea" cx="50%" cy="50%" r="75%">
        <stop offset="0%" stop-color="#12233a"/>
        <stop offset="100%" stop-color="#0a1524"/>
    </radialGradient>
    <filter id="il-map-glow" x="-60%" y="-60%" width="220%" height="220%">
        <feGaussianBlur stdDeviation="3" result="blur"/>
        <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
</defs>
<rect x="0" y="0" width="1000" height="700" fill="url(#il-map-sea)"/>
<g opacity="0.5" stroke="#1d3450" stroke-width="1">
    ${Array.from({ length: 12 }, (_, i) => `<line x1="0" y1="${i * 60}" x2="1000" y2="${i * 60}"/>`).join('')}
    ${Array.from({ length: 17 }, (_, i) => `<line x1="${i * 60}" y1="0" x2="${i * 60}" y2="700"/>`).join('')}
</g>
<path d="M 250 40 C 330 15, 520 25, 610 55 C 700 20, 830 35, 905 80 C 965 120, 975 210, 950 260 C 985 330, 955 420, 900 470 C 905 540, 850 600, 780 615 C 720 665, 600 670, 540 630 C 470 675, 360 660, 320 610 C 250 620, 200 560, 215 500 C 160 470, 150 380, 195 330 C 150 270, 175 160, 230 120 C 235 80, 240 55, 250 40 Z"
    fill="#232a24" stroke="#3d4a3a" stroke-width="3"/>
<g opacity="0.55">
    <ellipse cx="450" cy="310" rx="150" ry="120" fill="#2c3a2a" opacity="0.5"/>
    <ellipse cx="730" cy="290" rx="120" ry="100" fill="#3a3a3f" opacity="0.45"/>
    <ellipse cx="640" cy="500" rx="110" ry="70" fill="#3b2f3a" opacity="0.45"/>
    <ellipse cx="580" cy="150" rx="140" ry="70" fill="#2e3c2c" opacity="0.45"/>
    <ellipse cx="780" cy="145" rx="90" ry="55" fill="#41454c" opacity="0.5"/>
    <ellipse cx="880" cy="300" rx="80" ry="120" fill="#4a3c34" opacity="0.4"/>
    <ellipse cx="770" cy="455" rx="90" ry="60" fill="#25302c" opacity="0.5"/>
    <ellipse cx="505" cy="525" rx="80" ry="55" fill="#2a3038" opacity="0.45"/>
    <ellipse cx="350" cy="180" rx="90" ry="50" fill="#28362a" opacity="0.45"/>
</g>
<g fill="#8fa3b8" font-family="serif" opacity="0.6" font-style="italic" letter-spacing="4">
    <text x="500" y="70" font-size="26" text-anchor="middle">THE SUNDERED REACH</text>
    <text x="185" y="600" font-size="13">THE MIRROR SEA</text>
</g>`;
}

/**
 * Build the render model: nodes from location entities, NPC chips from
 * character entities (containment first, then current-state text matching),
 * and the player marker from the compiled scene.
 */
export function buildMapModel(store, scene, playerName = '') {
    const entities = Object.values(store?.entities || {});
    const locations = entities.filter(entity => entity?.type === 'location' && entity.enabled !== false);
    const characters = entities.filter(entity => entity?.type === 'character' && entity.enabled !== false);
    const keyOf = name => String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

    const byKey = new Map();
    for (const location of locations) {
        for (const candidate of [location.name, ...(location.aliases || []), ...(location.keys || [])]) {
            const key = keyOf(candidate);
            if (key && !byKey.has(key)) byKey.set(key, location);
        }
    }

    const nodes = locations.map(location => ({
        id: location.id,
        name: location.name,
        region: location.map?.region === true,
        x: location.map?.x,
        y: location.map?.y,
        importance: location.importance || 50,
        parent: location.parentLocationName || '',
        summary: location.summary || '',
        description: location.description || '',
        facts: location.facts || [],
        currentState: location.currentState || '',
        lastSeenMessage: location.lastSeenMessage,
        npcs: [],
    }));
    const nodeByKey = new Map(nodes.map(node => [keyOf(node.name), node]));
    const nodeById = new Map(nodes.map(node => [node.id, node]));

    // Auto-placement for discovered places without card coordinates: near the
    // parent when known, else a deterministic scatter band across the map.
    for (const node of nodes) {
        if (Number.isFinite(node.x) && Number.isFinite(node.y)) continue;
        const parent = node.parent && nodeByKey.get(keyOf(node.parent));
        const seedHash = hashStringLite(node.name);
        if (parent && Number.isFinite(parent.x)) {
            node.x = parent.x + ((seedHash % 40) - 20);
            node.y = parent.y + 30 + (seedHash % 25);
        } else {
            node.x = 280 + (seedHash % 440);
            node.y = 160 + ((seedHash >> 3) % 380);
        }
        node.autoPlaced = true;
    }

    const chatLength = Number.isFinite(scene?.chatLength) ? scene.chatLength : 1_000_000;
    for (const character of characters) {
        let host = (character.parentLocationName && nodeByKey.get(keyOf(character.parentLocationName))) || null;
        if (!host) {
            const haystack = `${character.currentState || ''} ${character.summary || ''} ${(character.history || []).slice(-3).map(item => typeof item === 'string' ? item : item?.statement || '').join(' ')}`;
            for (const [key, location] of byKey.entries()) {
                if (key.length > 3 && haystack.toLowerCase().includes(key)) {
                    host = nodeById.get(location.id) || nodeByKey.get(key);
                    if (host) break;
                }
            }
        }
        const age = chatLength - (Number.isFinite(character.lastSeenMessage) ? character.lastSeenMessage : -1);
        const chip = {
            name: character.name,
            active: age <= 8,
            recent: age <= 24,
        };
        if (host) host.npcs.push(chip);
        else if (nodeByKey.has('__unplaced__')) nodeByKey.get('__unplaced__').npcs.push(chip);
        else {
            const elsewhere = {
                id: '__elsewhere__', name: 'Elsewhere', region: false,
                x: 500, y: 660, importance: 0, parent: '', summary: 'NPCs with no known location yet.',
                description: '', facts: [], currentState: '', npcs: [chip], autoPlaced: true,
            };
            nodes.push(elsewhere);
            nodeById.set(elsewhere.id, elsewhere);
            nodeByKey.set('__unplaced__', elsewhere);
        }
    }

    const sceneKey = keyOf(scene?.location?.name || '');
    const playerNode = sceneKey ? (nodeByKey.get(sceneKey) || null) : null;
    return {
        nodes,
        player: playerNode ? { name: playerName || 'You', x: playerNode.x, y: playerNode.y, node: playerNode } : null,
    };
}

/**
 * Scene view model: the local bubble around the current scene - the location
 * itself, its parent region, the places it contains, and everyone present,
 * laid out as a "you are here" cluster.
 */
export function buildSceneModel(store, scene, playerName = '', chatLength = 1_000_000) {
    const keyOf = name => String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    const entities = Object.values(store?.entities || {});
    const locations = entities.filter(entity => entity?.type === 'location' && entity.enabled !== false);
    const characters = entities.filter(entity => entity?.type === 'character' && entity.enabled !== false);
    const byKey = new Map();
    for (const location of locations) byKey.set(keyOf(location.name), location);

    const focusKey = keyOf(scene?.location?.name || '');
    const focus = focusKey ? byKey.get(focusKey) : null;
    const hostName = focus?.name || scene?.location?.name || 'Somewhere';

    const node = (name, x, y, extra = {}) => ({
        id: 'scene:' + keyOf(name), name, region: false, x, y, importance: 50,
        parent: '', summary: '', description: '', facts: [], currentState: '',
        npcs: [], ...extra,
    });

    const center = node(hostName, 500, 340, { importance: 90 });
    const model = { nodes: [center], player: { name: playerName || 'You', x: 500, y: 340, node: center } };

    const parentName = focus?.parentLocationName || '';
    if (parentName && byKey.has(keyOf(parentName))) {
        const parent = byKey.get(keyOf(parentName));
        model.nodes.push(node(parent.name, 500, 160, {
            region: true, summary: parent.summary || '', currentState: parent.currentState || '', facts: parent.facts || [],
        }));
    }
    const children = locations
        .filter(location => keyOf(location.parentLocationName) === keyOf(hostName) && keyOf(location.name) !== focusKey)
        .slice(0, 8);
    children.forEach((child, index) => {
        const angle = (Math.PI * 2 * index) / Math.max(4, children.length) - Math.PI / 2;
        model.nodes.push(node(child.name, 500 + Math.cos(angle) * 190, 340 + Math.sin(angle) * 150, {
            summary: child.summary || '', currentState: child.currentState || '', facts: child.facts || [],
            importance: child.importance || 50,
        }));
    });

    // Everyone present: scene participants first, then containment and
    // current-state matching, exactly like the world map.
    const sceneNames = new Set((scene?.participants || []).map(item => keyOf(item?.name)));
    for (const character of characters) {
        const age = chatLength - (Number.isFinite(character.lastSeenMessage) ? character.lastSeenMessage : -1);
        const chip = { name: character.name, active: age <= 8, recent: age <= 24 };
        let hosted = sceneNames.has(keyOf(character.name));
        if (!hosted && focus) {
            hosted = keyOf(character.parentLocationName) === keyOf(hostName);
        }
        if (hosted) center.npcs.push(chip);
        else if (model.nodes.length > 1) model.nodes[1].npcs.push(chip);
    }
    return model;
}

/** Scene-view backdrop: a focused spotlight instead of the continent art. */
function sceneArt() {
    return `
<defs>
    <radialGradient id="il-scene-spot" cx="50%" cy="46%" r="65%">
        <stop offset="0%" stop-color="#2a3140"/>
        <stop offset="55%" stop-color="#171d28"/>
        <stop offset="100%" stop-color="#0b0f16"/>
    </radialGradient>
</defs>
<rect x="0" y="0" width="1000" height="700" fill="url(#il-scene-spot)"/>
<circle cx="500" cy="340" r="240" fill="none" stroke="#3a4356" stroke-width="1.5" stroke-dasharray="2 6" opacity="0.8"/>
<circle cx="500" cy="340" r="330" fill="none" stroke="#2c3342" stroke-width="1" stroke-dasharray="2 8" opacity="0.6"/>
<text x="500" y="668" text-anchor="middle" fill="#5f6a7a" font-size="14" font-family="serif" font-style="italic">current scene</text>`;
}

/** Render the map model into the overlay's SVG element. */
function renderModel(container, model, callbacks, options = {}) {
    const sceneMode = options.scene === true;
    const links = [];
    for (const node of model.nodes) {
        if (!node.parent) continue;
        const parentKey = node.parent.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
        const parent = model.nodes.find(candidate => candidate !== node
            && candidate.name.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim() === parentKey);
        if (parent && !parent.region) links.push([node, parent]);
    }
    const linkMarkup = links.map(([node, parent]) =>
        `<line class="il-map-link${sceneMode ? ' il-scene-link' : ''}" x1="${node.x}" y1="${node.y}" x2="${parent.x}" y2="${parent.y}"/>`).join('')
        + (sceneMode
            ? model.nodes.filter(node => node !== model.nodes[0])
                .map(node => `<line class="il-scene-link" x1="500" y1="340" x2="${node.x}" y2="${node.y}"/>`).join('')
            : '');

    const nodeMarkup = model.nodes.map(node => {
        const classes = ['il-map-node', node.region ? 'il-map-region' : 'il-map-place'];
        if (node.autoPlaced) classes.push('il-map-discovered');
        const npcs = [...node.npcs].sort((a, b) => Number(b.active) - Number(a.active) || Number(b.recent) - Number(a.recent));
        const chips = npcs.map(chip => `<span class="il-map-chip ${chip.active ? 'is-active' : chip.recent ? 'is-recent' : 'is-dormant'}">${svgEscape(chip.name)}</span>`).join('');
        const isPlayerHere = model.player?.node === node;
        return `<g class="${classes.join(' ')}" data-node-id="${svgEscape(node.id)}" transform="translate(${node.x}, ${node.y})">
            <circle class="il-map-hit" r="26"/>
            ${isPlayerHere ? `<circle class="il-map-player-halo" r="26"/>` : ''}
            <circle class="il-map-dot${sceneMode ? ' il-scene-dot' : ''}" r="${sceneMode ? (node === model.nodes[0] ? 14 : node.region ? 6 : 11) : (node.region ? 5 : 9)}"/>
            ${!node.region && node.npcs.length ? `<circle class="il-map-npc-ring" r="14"/>` : ''}
            <text class="il-map-label" y="${node.region ? -10 : -16}" text-anchor="middle">${svgEscape(node.name)}</text>
            ${chips ? `<foreignObject x="-90" y="10" width="180" height="52"><div class="il-map-chips" xmlns="http://www.w3.org/1999/xhtml">${chips}</div></foreignObject>` : ''}
        </g>`;
    }).join('');

    const playerMarkup = model.player
        ? `<g class="il-map-player" transform="translate(${model.player.x}, ${model.player.y})">
            <circle class="il-map-player-dot" r="7" filter="url(#il-map-glow)"/>
            <text class="il-map-player-label" y="-30" text-anchor="middle">${svgEscape(model.player.name)}</text>
        </g>`
        : '';

    if (sceneMode && model.nodes.length <= 2) {
        const hint = `<text x="500" y="560" text-anchor="middle" fill="#8fa3b8" font-size="16" font-family="serif" font-style="italic">No discovered places inside yet - explore to reveal them</text>`;
        container.innerHTML = `${sceneArt()}${linkMarkup}${nodeMarkup}${playerMarkup}${hint}`;
    } else {
        container.innerHTML = `${(sceneMode ? sceneArt() : worldArt())}${linkMarkup}${nodeMarkup}${playerMarkup}`;
    }
    for (const element of container.querySelectorAll('[data-node-id]')) {
        element.addEventListener('click', () => {
            const node = model.nodes.find(candidate => candidate.id === element.dataset.nodeId);
            if (node) callbacks.onSelect?.(node);
        });
    }
}

/**
 * Create the panel object: { open(), refresh(store, scene, playerName), close() }.
 * The overlay is created lazily on first open.
 */
export function createMapPanel() {
    let overlay = null;
    let svg = null;
    let detail = null;
    let view = { x: 0, y: 0, scale: 1 };
    let drag = null;
    let lastModel = null;
    let activeView = 'world';
    let lastInputs = null;

    const applyView = () => {
        if (!svg) return;
        const { width, height } = MAP_VIEWBOX;
        if (activeView === 'scene') {
            svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
            return;
        }
        svg.setAttribute('viewBox', `${view.x} ${view.y} ${width / view.scale} ${height / view.scale}`);
    };

    const ensureOverlay = () => {
        ensureInlineStyles();
        if (overlay) return;
        overlay = document.createElement('div');
        overlay.id = 'il_map_overlay';
        overlay.className = 'displayNone';
        overlay.innerHTML = `
            <div class="il-map-header">
                <span class="il-map-title">InnerLore — map</span>
                <span class="il-map-views">
                    <button type="button" class="il-map-view-btn is-active" data-view="world">World</button>
                    <button type="button" class="il-map-view-btn" data-view="scene">Scene</button>
                </span>
                <span class="il-map-hint">drag to pan · pinch or wheel to zoom · tap a place for details</span>
                <span class="il-map-zoom">
                    <button type="button" class="il-map-zoom-btn" data-zoom="out" aria-label="Zoom out">−</button>
                    <button type="button" class="il-map-zoom-btn" data-zoom="reset" aria-label="Reset view">⌖</button>
                    <button type="button" class="il-map-zoom-btn" data-zoom="in" aria-label="Zoom in">+</button>
                </span>
                <button type="button" class="il-map-close menu_button">Close</button>
            </div>
            <div class="il-map-body">
                <svg id="il_map_svg" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid meet"></svg>
                <aside class="il-map-detail displayNone"></aside>
            </div>`;
        document.body.appendChild(overlay);
        svg = overlay.querySelector('#il_map_svg');
        detail = overlay.querySelector('.il-map-detail');
        overlay.querySelector('.il-map-close').addEventListener('click', close);
        const pointers = new Map();
        let pinch = null;
        svg.addEventListener('pointerdown', event => {
            pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
            svg.setPointerCapture(event.pointerId);
            if (pointers.size === 1) {
                drag = { x: event.clientX, y: event.clientY, viewX: view.x, viewY: view.y };
            } else if (pointers.size === 2) {
                const [a, b] = [...pointers.values()];
                drag = null;
                pinch = {
                    distance: Math.hypot(a.x - b.x, a.y - b.y),
                    scale: view.scale,
                    cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2,
                    viewX: view.x, viewY: view.y,
                };
            }
        });
        svg.addEventListener('pointermove', event => {
            if (!pointers.has(event.pointerId)) return;
            pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
            if (pinch && pointers.size >= 2) {
                const [a, b] = [...pointers.values()];
                const distance = Math.hypot(a.x - b.x, a.y - b.y);
                const rect = svg.getBoundingClientRect();
                const nextScale = Math.min(6, Math.max(0.7, pinch.scale * (distance / Math.max(1, pinch.distance))));
                // Keep the pinch midpoint anchored while zooming.
                const factor = (MAP_VIEWBOX.width / rect.width);
                const cxMap = pinch.viewX + (pinch.cx - rect.left) * factor / view.scale;
                const cyMap = pinch.viewY + (pinch.cy - rect.top) * (MAP_VIEWBOX.height / rect.height) / view.scale;
                view.scale = nextScale;
                view.x = cxMap - (pinch.cx - rect.left) * factor / nextScale;
                view.y = cyMap - (pinch.cy - rect.top) * (MAP_VIEWBOX.height / rect.height) / nextScale;
                applyView();
            } else if (drag) {
                const rect = svg.getBoundingClientRect();
                const factor = (MAP_VIEWBOX.width / rect.width) / view.scale;
                view.x = drag.viewX - (event.clientX - drag.x) * factor;
                view.y = drag.viewY - (event.clientY - drag.y) * factor;
                applyView();
            }
        });
        const releasePointer = event => {
            pointers.delete(event.pointerId);
            if (pointers.size < 2) pinch = null;
            if (pointers.size === 0) drag = null;
        };
        svg.addEventListener('pointerup', releasePointer);
        svg.addEventListener('pointercancel', releasePointer);
        svg.addEventListener('wheel', event => {
            event.preventDefault();
            view.scale = Math.min(6, Math.max(0.7, view.scale * (event.deltaY < 0 ? 1.15 : 0.87)));
            applyView();
        }, { passive: false });
        for (const button of overlay.querySelectorAll('.il-map-view-btn')) {
            button.addEventListener('click', () => {
                activeView = button.dataset.view === 'scene' ? 'scene' : 'world';
                for (const other of overlay.querySelectorAll('.il-map-view-btn')) {
                    other.classList.toggle('is-active', other === button);
                }
                view = { x: 0, y: 0, scale: 1 };
                if (lastInputs) refresh(lastInputs.store, lastInputs.scene, lastInputs.playerName);
            });
        }
        for (const button of overlay.querySelectorAll('.il-map-zoom-btn')) {
            button.addEventListener('click', () => {
                if (button.dataset.zoom === 'reset') {
                    view = { x: 0, y: 0, scale: 1 };
                } else {
                    view.scale = Math.min(6, Math.max(0.7, view.scale * (button.dataset.zoom === 'in' ? 1.3 : 0.77)));
                }
                applyView();
            });
        }
    };

    function showDetail(node) {
        if (!detail) return;
        const npcs = node.npcs.length
            ? node.npcs.map(chip => `<li class="${chip.active ? 'is-active' : chip.recent ? 'is-recent' : 'is-dormant'}">${svgEscape(chip.name)}</li>`).join('')
            : '<li class="is-dormant">(no tracked NPCs presently here)</li>';
        const facts = node.facts.length ? node.facts.map(fact => `<li>${svgEscape(typeof fact === 'string' ? fact : fact?.statement || '')}</li>`).join('') : '';
        detail.innerHTML = `
            <h3>${svgEscape(node.name)}</h3>
            ${node.summary ? `<p class="il-map-detail-summary">${svgEscape(node.summary)}</p>` : ''}
            ${node.currentState ? `<p class="il-map-detail-state"><b>Now:</b> ${svgEscape(node.currentState)}</p>` : ''}
            ${facts ? `<ul class="il-map-detail-facts">${facts}</ul>` : ''}
            <div class="il-map-detail-npcs"><b>Present</b><ul>${npcs}</ul></div>`;
        detail.classList.remove('displayNone');
    }

    function refresh(store, scene, playerName) {
        ensureOverlay();
        lastInputs = { store, scene, playerName };
        if (!store) {
            if (svg) svg.innerHTML = '<text x="500" y="350" text-anchor="middle" fill="#8fa3b8" font-size="18" font-family="serif" font-style="italic">World state is still loading…</text>';
            return;
        }
        const chat = (typeof window !== 'undefined' && window.SillyTavern?.getContext?.()?.chat) || [];
        const enrichedScene = { ...scene, chatLength: chat.length };
        lastModel = activeView === 'scene'
            ? buildSceneModel(store, enrichedScene, playerName, chat.length)
            : buildMapModel(store, enrichedScene, playerName);
        renderModel(svg, lastModel, { onSelect: showDetail }, { scene: activeView === 'scene' });
        applyView();
    }

    function open() {
        ensureOverlay();
        overlay.classList.remove('displayNone');
    }

    function close() {
        overlay?.classList.add('displayNone');
    }

    return { open, refresh, close };
}

/**
 * Floating minimap: a small draggable widget showing the current location,
 * its nearest neighbors, and NPC activity dots. Clicking it opens the full
 * map on the scene view. Its position persists in localStorage.
 */
export function createMinimap(openFullMap, versionText = '') {
    let element = null;
    let drag = null;
    let hiddenByUser = false;
    try {
        hiddenByUser = globalThis.localStorage?.getItem('innerlore:minimap:hidden') === '1';
    } catch { /* no storage */ }

    const restorePosition = () => {
        try {
            const saved = JSON.parse(globalThis.localStorage?.getItem('innerlore:minimap:pos') || 'null');
            if (saved && Number.isFinite(saved.x) && Number.isFinite(saved.y)) {
                element.style.right = 'auto';
                element.style.bottom = 'auto';
                element.style.left = Math.max(8, Math.min(saved.x, window.innerWidth - 200)) + 'px';
                element.style.top = Math.max(8, Math.min(saved.y, window.innerHeight - 160)) + 'px';
            }
        } catch { /* no storage */ }
    };

    const persistPosition = () => {
        try {
            const rect = element.getBoundingClientRect();
            globalThis.localStorage?.setItem('innerlore:minimap:pos', JSON.stringify({ x: rect.left, y: rect.top }));
        } catch { /* no storage */ }
    };

    const ensure = () => {
        ensureInlineStyles();
        if (element) return;
        element = document.createElement('div');
        element.id = 'il_minimap';
        element.className = 'displayNone';
        // Critical placement lives on the element itself: no stylesheet,
        // stale or missing, can make the panel invisible.
        element.style.position = 'fixed';
        element.style.right = '12px';
        // Top-right: the bottom edge is crowded on mobile browsers (floating
        // toolbars) and SillyTavern's send form; the top-right corner under
        // the cast bar is the only reliably clear mobile real estate.
        element.style.top = 'calc(env(safe-area-inset-top, 0px) + 54px)';
        element.style.zIndex = '40000';
        element.style.width = '190px';
        element.style.border = '1px solid #8fb7e8';
        element.style.borderRadius = '12px';
        element.style.background = 'rgba(16, 18, 24, 0.95)';
        element.style.boxShadow = '0 4px 14px rgba(0, 0, 0, 0.5)';
        element.style.color = '#e2c99a';
        element.style.fontSize = '0.85em';
        element.style.padding = '8px 10px';
        element.innerHTML = `
            <div class="il-minimap-head">
                <span class="il-minimap-loc"></span>
                <span class="il-minimap-expand" title="Open the full map" role="button" tabindex="0">⤢</span>
            </div>
            <div class="il-minimap-body"></div>`;
        document.body.appendChild(element);
        restorePosition();
        element.querySelector('.il-minimap-expand').addEventListener('click', event => {
            event.stopPropagation();
            openFullMap?.();
        });
        element.addEventListener('pointerdown', event => {
            if (event.target.closest('.il-minimap-expand')) return;
            drag = { x: event.clientX, y: event.clientY, left: element.offsetLeft, top: element.offsetTop };
            element.setPointerCapture(event.pointerId);
        });
        element.addEventListener('pointermove', event => {
            if (!drag) return;
            element.style.right = 'auto';
            element.style.bottom = 'auto';
            element.style.left = Math.max(4, drag.left + event.clientX - drag.x) + 'px';
            element.style.top = Math.max(4, drag.top + event.clientY - drag.y) + 'px';
        });
        const release = () => {
            if (drag) {
                drag = null;
                persistPosition();
            }
        };
        element.addEventListener('pointerup', release);
        element.addEventListener('pointercancel', release);
    };

    ensure();
    if (hiddenByUser) element.classList.add('displayNone');

    return {
        toggle() {
            try {
                ensure();
            } catch (error) {
                console.error('[InnerLore] Could not create the location panel:', error);
                (globalThis.toastr?.error?.('InnerLore could not create the location panel: ' + (error?.message || error), 'InnerLore'));
                return false;
            }
            const nowVisible = element.classList.toggle('displayNone') === false;
            hiddenByUser = !nowVisible;
            try {
                globalThis.localStorage?.setItem('innerlore:minimap:hidden', nowVisible ? '0' : '1');
            } catch { /* no storage */ }
            const suffix = versionText ? ` (${versionText})` : '';
            (globalThis.toastr?.info?.((nowVisible ? 'Location panel shown' : 'Location panel hidden') + suffix, 'InnerLore', { timeOut: 4_000 }));
            return nowVisible;
        },
        refresh(store, scene) {
            try {
                ensure();
            } catch (error) {
                console.error('[InnerLore] Could not create the location panel:', error);
                return;
            }
            if (hiddenByUser) {
                element.classList.add('displayNone');
                return;
            }
            // Show the shell even before the store attaches: the scene's
            // location name is enough for the panel to be useful, and a
            // visible shell prevents refresh cycles from hiding a panel the
            // user just toggled on.
            element.classList.remove('displayNone');
            if (!store) {
                const fallback = scene?.location?.name;
                element.querySelector('.il-minimap-loc').textContent = fallback || 'Loading world…';
                element.querySelector('.il-minimap-body').innerHTML = '<div class="il-minimap-near is-empty">World state is loading…</div>';
                return;
            }
            const keyOf = name => String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
            const entities = Object.values(store.entities || {});
            const locations = entities.filter(entity => entity?.type === 'location' && entity.enabled !== false);
            const byKey = new Map(locations.map(location => [keyOf(location.name), location]));
            const focusKey = keyOf(scene?.location?.name || '');
            const focus = byKey.get(focusKey);
            const here = focus?.name || scene?.location?.name || 'Somewhere';
            const neighbors = locations
                .filter(location => keyOf(location.name) !== focusKey
                    && (keyOf(location.parentLocationName) === focusKey
                        || (focus && keyOf(location.parentLocationName) === keyOf(focus.parentLocationName || '') && keyOf(location.parentLocationName))))
                .slice(0, 4);
            const chat = (typeof window !== 'undefined' && window.SillyTavern?.getContext?.()?.chat) || [];
            const activeNearby = entities
                .filter(entity => entity?.type === 'character' && entity.enabled !== false
                    && chat.length - (Number.isFinite(entity.lastSeenMessage) ? entity.lastSeenMessage : -1) <= 8)
                .slice(0, 6);
            element.querySelector('.il-minimap-loc').textContent = here;
            element.querySelector('.il-minimap-body').innerHTML =
                (neighbors.length
                    ? `<div class="il-minimap-near">${neighbors.map(n => `<span>${svgEscape(n.name)}</span>`).join('')}</div>`
                    : '<div class="il-minimap-near is-empty">No nearby places discovered yet</div>')
                + (activeNearby.length
                    ? `<div class="il-minimap-dots">${activeNearby.map(() => '<i class="is-on"></i>').join('')}</div>`
                    : '');
            element.classList.remove('displayNone');
        },
        hide() {
            element?.classList.add('displayNone');
        },
    };
}
