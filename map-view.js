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

/** Render the map model into the overlay's SVG element. */
function renderModel(container, model, callbacks) {
    const links = [];
    for (const node of model.nodes) {
        if (!node.parent) continue;
        const parentKey = node.parent.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
        const parent = model.nodes.find(candidate => candidate !== node
            && candidate.name.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim() === parentKey);
        if (parent && !parent.region) links.push([node, parent]);
    }
    const linkMarkup = links.map(([node, parent]) =>
        `<line class="il-map-link" x1="${node.x}" y1="${node.y}" x2="${parent.x}" y2="${parent.y}"/>`).join('');

    const nodeMarkup = model.nodes.map(node => {
        const classes = ['il-map-node', node.region ? 'il-map-region' : 'il-map-place'];
        if (node.autoPlaced) classes.push('il-map-discovered');
        const npcs = [...node.npcs].sort((a, b) => Number(b.active) - Number(a.active) || Number(b.recent) - Number(a.recent));
        const chips = npcs.map(chip => `<span class="il-map-chip ${chip.active ? 'is-active' : chip.recent ? 'is-recent' : 'is-dormant'}">${svgEscape(chip.name)}</span>`).join('');
        const isPlayerHere = model.player?.node === node;
        return `<g class="${classes.join(' ')}" data-node-id="${svgEscape(node.id)}" transform="translate(${node.x}, ${node.y})">
            ${isPlayerHere ? `<circle class="il-map-player-halo" r="26"/>` : ''}
            <circle class="il-map-dot" r="${node.region ? 5 : 9}"/>
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

    container.innerHTML = `${worldArt()}${linkMarkup}${nodeMarkup}${playerMarkup}`;
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

    const applyView = () => {
        if (!svg) return;
        const { width, height } = MAP_VIEWBOX;
        svg.setAttribute('viewBox', `${view.x} ${view.y} ${width / view.scale} ${height / view.scale}`);
    };

    const ensureOverlay = () => {
        if (overlay) return;
        overlay = document.createElement('div');
        overlay.id = 'il_map_overlay';
        overlay.className = 'displayNone';
        overlay.innerHTML = `
            <div class="il-map-header">
                <span class="il-map-title">InnerLore — world map</span>
                <span class="il-map-hint">drag to pan · wheel to zoom · click a place for details</span>
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
        svg.addEventListener('pointerdown', event => {
            drag = { x: event.clientX, y: event.clientY, viewX: view.x, viewY: view.y };
            svg.setPointerCapture(event.pointerId);
        });
        svg.addEventListener('pointermove', event => {
            if (!drag) return;
            const rect = svg.getBoundingClientRect();
            const factor = (MAP_VIEWBOX.width / rect.width) / view.scale;
            view.x = drag.viewX - (event.clientX - drag.x) * factor;
            view.y = drag.viewY - (event.clientY - drag.y) * factor;
            applyView();
        });
        svg.addEventListener('pointerup', () => { drag = null; });
        svg.addEventListener('wheel', event => {
            event.preventDefault();
            view.scale = Math.min(6, Math.max(0.7, view.scale * (event.deltaY < 0 ? 1.15 : 0.87)));
            applyView();
        }, { passive: false });
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
        if (!store) return;
        const chat = (typeof window !== 'undefined' && window.SillyTavern?.getContext?.()?.chat) || [];
        const enrichedScene = { ...scene, chatLength: chat.length };
        lastModel = buildMapModel(store, enrichedScene, playerName);
        renderModel(svg, lastModel, { onSelect: showDetail });
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
