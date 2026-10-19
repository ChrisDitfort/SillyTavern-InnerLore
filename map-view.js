/**
 * InnerLore world map: a full-screen SVG view of the chat's living world.
 * Locations render from the store's entities (card seeds carry canonical
 * coordinates; discovered places auto-place near their parent), NPCs stand at
 * the place the curator last recorded them, and the player's position follows
 * the compiled scene focus. Places the player has not explored stay under fog.
 * The map is a view over InnerLore state - it never generates or stores
 * anything of its own.
 */

import {
    canonicalNameKey,
    cleanString,
    curatedLocationOf,
    resolveLocationReference,
} from './core.js?v=47';
import { deriveSceneState } from './scene.js?v=5';

const MAP_VIEWBOX = { width: 1000, height: 700 };
const MAX_NODE_CHIPS = 4;
// World units around a visited place that the fog lifts from; a place inside
// that circle is seen, though not yet visited.
const REVEAL_RADIUS = 120;
const MIN_SCALE = 0.6;
const MAX_SCALE = 8;
// Scene locations a reply establishes on its own. "Where the present cast is"
// and curated-state matches lean on today's records, so for past replies they
// would mark places the player never went.
const EXPLORING_SOURCES = new Set(['explicit movement in latest turn', 'named in latest turn']);

/**
 * Self-injected styles: extension CSS loads without a cache-buster, so a
 * stale stylesheet would leave these elements unstyled and invisible while
 * the (cache-busted) JavaScript runs the newest logic. Injecting the styles
 * from the module guarantees markup and styling always match.
 */
const MAP_STYLE_ID = 'il_map_inline_styles_v2';
const MAP_STYLES = `
#il_map_overlay{--il-gold:#ecd9ac;--il-gold-dim:rgba(226,201,154,.16);--il-line:rgba(255,255,255,.09);--il-muted:#8f99a8;position:fixed;inset:0;width:100vw;height:100vh;height:100dvh;z-index:31000;background:#070a0f;display:flex;flex-direction:column;color:#d6dbe4;font-size:14px;line-height:1.35;padding:env(safe-area-inset-top) env(safe-area-inset-right) 0 env(safe-area-inset-left);box-sizing:border-box}
#il_map_overlay *{box-sizing:border-box}
.il-map-header{display:flex;align-items:center;gap:10px;padding:8px 10px;background:linear-gradient(180deg,rgba(17,20,27,.98),rgba(11,13,18,.96));border-bottom:1px solid rgba(226,201,154,.14);flex:none}
.il-map-iconbtn{flex:none;width:40px;height:40px;border-radius:12px;border:1px solid var(--il-line);background:rgba(255,255,255,.04);color:#cfd6e0;display:grid;place-items:center;cursor:pointer;padding:0}
.il-map-iconbtn:hover{border-color:rgba(226,201,154,.45);color:var(--il-gold)}
.il-map-iconbtn svg{width:18px;height:18px}
.il-map-heading{flex:1 1 auto;min-width:0;display:flex;flex-direction:column}
.il-map-kicker{font-size:.66em;letter-spacing:.18em;text-transform:uppercase;color:#7d8796}
.il-map-where{font-weight:600;color:var(--il-gold);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.il-map-views{flex:none;display:inline-flex;padding:3px;border-radius:12px;background:rgba(255,255,255,.04);border:1px solid var(--il-line)}
.il-map-view-btn{border:0;background:none;color:#9aa3b0;padding:7px 12px;border-radius:9px;font:inherit;font-size:.85em;cursor:pointer;white-space:nowrap}
.il-map-view-btn.is-active{background:var(--il-gold-dim);color:var(--il-gold)}
.il-map-body{flex:1 1 auto;position:relative;min-height:0;display:flex;overflow:hidden}
#il_map_svg{flex:1 1 auto;width:100%;height:100%;min-width:0;display:block;touch-action:none;cursor:grab;background:#0a1524;user-select:none;-webkit-user-select:none}
#il_map_svg.is-dragging{cursor:grabbing}
.il-map-controls{position:absolute;right:12px;bottom:calc(14px + env(safe-area-inset-bottom,0px));display:flex;flex-direction:column;gap:8px;z-index:2}
.il-map-ctl{width:46px;height:46px;border-radius:14px;border:1px solid rgba(255,255,255,.12);background:rgba(13,16,22,.92);color:var(--il-gold);display:grid;place-items:center;cursor:pointer;box-shadow:0 6px 16px rgba(0,0,0,.45);padding:0}
.il-map-ctl svg{width:20px;height:20px}
.il-map-ctl:hover{border-color:rgba(226,201,154,.5)}
.il-map-legend{position:absolute;left:12px;bottom:calc(14px + env(safe-area-inset-bottom,0px));right:72px;display:flex;flex-wrap:wrap;gap:6px;z-index:2;pointer-events:none}
.il-map-pill{pointer-events:auto;display:inline-flex;align-items:center;gap:6px;padding:7px 11px;border-radius:999px;background:rgba(13,16,22,.92);border:1px solid var(--il-line);font:inherit;font-size:.78em;color:#aab3c0;box-shadow:0 4px 12px rgba(0,0,0,.35)}
button.il-map-pill{cursor:pointer}
button.il-map-pill:hover{border-color:rgba(226,201,154,.45);color:var(--il-gold)}
.il-map-key{width:9px;height:9px;border-radius:50%;flex:none}
.il-map-key.is-you{background:#8fb7e8;box-shadow:0 0 0 3px rgba(143,183,232,.25)}
.il-map-key.is-visited{background:#e2c99a}
.il-map-key.is-seen{border:1.5px solid #9fb0c2}
.il-map-sheet{position:absolute;top:0;right:0;bottom:0;width:340px;max-width:88vw;background:#0c0e13;border-left:1px solid rgba(226,201,154,.14);box-shadow:-12px 0 28px rgba(0,0,0,.45);display:flex;flex-direction:column;z-index:3}
.il-map-sheet-head{display:flex;align-items:flex-start;gap:10px;padding:14px 14px 10px;border-bottom:1px solid var(--il-line)}
.il-map-sheet-title{flex:1;min-width:0}
.il-map-sheet-title h3{margin:2px 0 0;font-size:1.12em;color:var(--il-gold);font-weight:650;overflow-wrap:anywhere}
.il-map-tags{display:flex;flex-wrap:wrap;gap:5px}
.il-map-tag{font-size:.66em;letter-spacing:.12em;text-transform:uppercase;padding:2px 7px;border-radius:999px;border:1px solid var(--il-line);color:#9fb0c2}
.il-map-tag.is-you{border-color:rgba(143,183,232,.5);color:#cfe3f7}
.il-map-tag.is-visited{border-color:rgba(226,201,154,.4);color:var(--il-gold)}
.il-map-sheet-body{flex:1;overflow-y:auto;padding:12px 14px calc(18px + env(safe-area-inset-bottom,0px))}
.il-map-sheet-body p{margin:0 0 10px;font-size:.92em}
.il-map-now{color:#a9dcb3}
.il-map-facts{margin:0 0 12px;padding-left:18px;font-size:.88em;color:#aab3c0}
.il-map-section{margin:14px 0 6px;font-size:.68em;letter-spacing:.16em;text-transform:uppercase;color:#7d8796;font-weight:600}
.il-map-people{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:5px}
.il-map-person{display:flex;align-items:center;gap:9px;width:100%;padding:7px 9px;border-radius:11px;border:1px solid var(--il-line);background:rgba(255,255,255,.03);color:inherit;font:inherit;font-size:.9em;text-align:left;cursor:pointer}
.il-map-person:hover{border-color:rgba(226,201,154,.4)}
.il-map-person small{display:block;color:var(--il-muted);font-size:.82em}
.il-map-person.is-dormant{opacity:.6}
.il-map-face{flex:none;width:28px;height:28px;border-radius:50%;display:grid;place-items:center;font-size:.72em;font-weight:700;color:#0d1016;background:hsl(var(--hue,210) 34% 64%)}
.il-map-empty{color:#6d7684;font-style:italic;font-size:.88em}
.il-map-hit{fill:transparent}
.il-map-mark{transform:scale(var(--il-map-k,1))}
.il-map-node{cursor:pointer}
.il-map-pin{fill:#e2c99a;stroke:#1a1f17;stroke-width:2}
.il-map-node.is-seen .il-map-pin{fill:#101722;stroke:#9fb0c2;stroke-width:1.8}
.il-map-node.is-provisional .il-map-pin{fill:#7fa9c9}
.il-map-node.is-region .il-map-pin{fill:none;stroke:#8fa3b8;stroke-dasharray:3 3}
.il-map-node.is-selected .il-map-pin{stroke:#fff6dc;stroke-width:3}
.il-map-label{fill:#e4e8ef;font-size:13px;font-family:serif;font-weight:600;paint-order:stroke;stroke:rgba(8,11,16,.92);stroke-width:3.5px;stroke-linejoin:round}
.il-map-node.is-seen .il-map-label{fill:#9fb0c2;font-weight:400;font-style:italic}
.il-map-node.is-region .il-map-label{font-style:italic;letter-spacing:2px;fill:#9fb0c2;font-weight:400}
.il-map-count circle{fill:#9c8eee;stroke:#0d1016;stroke-width:2}
.il-map-count text{fill:#0d1016;font-size:10px;font-weight:700;font-family:sans-serif}
.il-map-link{stroke:rgba(200,183,138,.32);stroke-width:1.4;stroke-dasharray:3 5;fill:none}
.il-map-chips{display:flex;flex-wrap:wrap;gap:3px;justify-content:center;pointer-events:none}
.il-map-chip{font:600 10px/1 sans-serif;padding:3px 6px;border-radius:999px;background:rgba(13,16,22,.88);border:1px solid rgba(255,255,255,.14);color:#c9cfd9;white-space:nowrap}
.il-map-chip.is-active{border-color:#8ee6a2;color:#c4f2cf}
.il-map-chip.is-recent{border-color:#f5d77d;color:#f0e2b0}
.il-map-chip.is-dormant{opacity:.6}
#il_map_svg.is-far .il-map-chips-wrap,#il_map_svg.is-far .il-map-node.is-seen .il-map-label{display:none}
.il-map-count{display:none}
#il_map_svg.is-far .il-map-count{display:inline}
.il-map-you-ring{fill:none;stroke:#8fb7e8;stroke-width:2.5;transform-box:fill-box;transform-origin:center;animation:il-map-pulse 2.4s ease-out infinite}
.il-map-you-dot{fill:#8fb7e8;stroke:#eef6ff;stroke-width:2.5}
@keyframes il-map-pulse{0%{transform:scale(.6);opacity:.95}100%{transform:scale(1.9);opacity:0}}
@media (prefers-reduced-motion:reduce){.il-map-you-ring{animation:none;opacity:.6}}
.il-scene-link{stroke:rgba(156,142,238,.38);stroke-width:1.6;stroke-dasharray:none}
@media (max-width:720px){
.il-map-header{gap:8px;padding:6px 8px}
.il-map-iconbtn{width:38px;height:38px}
.il-map-view-btn{padding:7px 10px}
.il-map-sheet{top:auto;left:0;right:0;width:auto;max-width:none;max-height:58%;border-left:0;border-top:1px solid rgba(226,201,154,.18);border-radius:18px 18px 0 0;box-shadow:0 -12px 28px rgba(0,0,0,.5)}
.il-map-sheet::before{content:'';display:block;width:42px;height:4px;border-radius:2px;background:rgba(255,255,255,.18);margin:8px auto 0}
.il-map-ctl{width:44px;height:44px}
}
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

/** Initials and a stable hue for a person's portrait. */
export function personBadge(name) {
    const words = cleanString(name, 160).split(/\s+/).filter(word => /\p{L}/u.test(word));
    const initials = words.slice(0, 2).map(word => word.match(/\p{L}/u)[0].toUpperCase()).join('') || '?';
    return { initials, hue: hashStringLite(canonicalNameKey(name)) % 360 };
}

const ICON = {
    close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true"><line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/></svg>',
    plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>',
    minus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true"><line x1="5" y1="12" x2="19" y2="12"/></svg>',
    locate: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2.5" fill="currentColor"/><line x1="12" y1="1.5" x2="12" y2="4.5"/><line x1="12" y1="19.5" x2="12" y2="22.5"/><line x1="1.5" y1="12" x2="4.5" y2="12"/><line x1="19.5" y1="12" x2="22.5" y2="12"/></svg>',
};

/** Continent art: sea, coastline, and softly tinted regions with labels. */
function worldArt() {
    return `
<radialGradient id="il-map-sea" cx="50%" cy="50%" r="75%">
    <stop offset="0%" stop-color="#12233a"/>
    <stop offset="100%" stop-color="#0a1524"/>
</radialGradient>
<rect x="-2000" y="-2000" width="5000" height="4700" fill="#0a1524"/>
<rect x="0" y="0" width="1000" height="700" fill="url(#il-map-sea)"/>
<g opacity="0.45" stroke="#1d3450" stroke-width="1">
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
 * Fog over everything the player has not explored: a hatched shroud with
 * soft-edged holes around each visited place. Overlapping holes only clear
 * more fog, never less.
 */
function fogLayer(reveals) {
    const holes = reveals
        .map(point => `<circle cx="${point.x}" cy="${point.y}" r="${point.radius}" fill="url(#il-fog-hole)"/>`)
        .join('');
    return `
<pattern id="il-fog-hatch" width="12" height="12" patternUnits="userSpaceOnUse" patternTransform="rotate(35)">
    <rect width="12" height="12" fill="#090c12"/>
    <line x1="0" y1="0" x2="0" y2="12" stroke="#121823" stroke-width="2"/>
</pattern>
<radialGradient id="il-fog-hole">
    <stop offset="0%" stop-color="#000" stop-opacity="1"/>
    <stop offset="62%" stop-color="#000" stop-opacity="1"/>
    <stop offset="100%" stop-color="#000" stop-opacity="0"/>
</radialGradient>
<mask id="il-fog-mask" maskUnits="userSpaceOnUse" x="-2000" y="-2000" width="5000" height="4700">
    <rect x="-2000" y="-2000" width="5000" height="4700" fill="#fff"/>
    ${holes}
</mask>
<rect class="il-map-fog" x="-2000" y="-2000" width="5000" height="4700" fill="url(#il-fog-hatch)" mask="url(#il-fog-mask)"/>`;
}

/** Locations and tracked NPCs (the player's own record excluded). */
function worldRecords(store, playerName) {
    const entities = Object.values(store?.entities || {});
    const playerKey = canonicalNameKey(playerName);
    return {
        locations: entities.filter(entity => entity?.type === 'location' && entity.enabled !== false),
        characters: entities.filter(entity => entity?.type === 'character' && entity.enabled !== false
            && !(playerKey && [entity.name, ...(entity.aliases || [])].some(name => canonicalNameKey(name) === playerKey))),
    };
}

function playerRecordOf(store, playerName) {
    const playerKey = canonicalNameKey(playerName);
    if (!playerKey) return null;
    return Object.values(store?.entities || {}).find(entity => entity?.type === 'character' && entity.enabled !== false
        && [entity.name, ...(entity.aliases || [])].some(name => canonicalNameKey(name) === playerKey)) || null;
}

function placeKeys(record) {
    return [record?.name, ...(record?.aliases || [])].map(canonicalNameKey).filter(Boolean);
}

/** The scene's location as a known record, or its raw name for a new place. */
export function resolveSceneLocation(store, scene) {
    const location = scene?.location;
    if (!location?.name) return { record: null, name: '' };
    const byId = location.id && store?.entities?.[location.id];
    const record = (byId?.type === 'location' ? byId : null)
        || resolveLocationReference(store?.entities, location.name);
    return { record, name: record?.name || location.name };
}

const explorationCache = new Map();

/**
 * The places the player has explored, as canonical name keys: every scene
 * location a completed reply establishes (named there, or reached by explicit
 * movement), the current scene's location, and where the curator last
 * recorded the player - together with every place that contains them.
 * Derived from the chat itself, so swipes, edits and rebuilds never leave a
 * stale record behind; per-reply results are cached by content.
 */
export function exploredPlaces(messages, store, playerName = '', scene = null) {
    const entities = store?.entities || {};
    const signature = hashStringLite(Object.values(entities)
        .filter(entity => entity?.type === 'location' && entity.enabled !== false)
        .map(entity => entity.id).sort().join('|'));
    const keys = new Set();
    const explore = name => {
        let record = resolveLocationReference(entities, name);
        if (!record) {
            const key = canonicalNameKey(name);
            if (key) keys.add(key);
            return;
        }
        const visited = new Set();
        while (record && !visited.has(record.id)) {
            visited.add(record.id);
            for (const key of placeKeys(record)) keys.add(key);
            record = record.parentLocationName ? resolveLocationReference(entities, record.parentLocationName) : null;
        }
    };
    const list = Array.isArray(messages) ? messages : [];
    for (let index = 0; index < list.length; index++) {
        const message = list[index];
        if (!message || message.is_user || (message.is_system && message.extra?.sc_ghosted !== true)) continue;
        const text = cleanString(message.mes);
        if (!text) continue;
        const cacheKey = `${signature}:${index}:${text.length}:${hashStringLite(text)}`;
        if (!explorationCache.has(cacheKey)) {
            // The scene reads only the last few messages, so hand it just those:
            // the whole history before each reply made a long chat quadratic.
            const location = deriveSceneState(list.slice(Math.max(0, index - 11), index + 1), store, {
                currentIndex: index,
                playerName,
                lookbackMessages: 4,
            }).location;
            if (explorationCache.size > 5_000) explorationCache.clear();
            explorationCache.set(cacheKey, location?.name && EXPLORING_SOURCES.has(location.source) ? location.name : '');
        }
        const name = explorationCache.get(cacheKey);
        if (name) explore(name);
    }
    if (scene?.location?.name) explore(scene.location.name);
    const player = playerRecordOf(store, playerName);
    const playerAt = curatedLocationOf(entities, player || {})?.name || cleanString(player?.currentLocationName, 160);
    if (playerAt) explore(playerAt);
    return keys;
}

/**
 * Where every tracked NPC is right now, best evidence first. The curator's
 * current_location is the authority; until the curator has processed the
 * newest reply, an NPC the scene compiler finds present in it stands at the
 * scene location, so the map moves the moment a reply lands. Without either,
 * the most specific known place named in the curated current state is used.
 * Background text (summary, history) never places anyone: it says where a
 * person comes from, not where they are.
 */
export function placeCharacters(store, scene, playerName = '') {
    const { characters } = worldRecords(store, playerName);
    const sceneLocation = resolveSceneLocation(store, scene);
    const processedIndex = Number.isInteger(store?.lastProcessedIndex) ? store.lastProcessedIndex : -1;
    const curatorBehind = Number.isInteger(scene?.latestMessageIndex) && processedIndex < scene.latestMessageIndex;
    const present = new Map((scene?.participants || [])
        .filter(item => Number(item?.confidence) >= 0.9 || item?.reason === 'curated at current location')
        .map(item => [canonicalNameKey(item?.name), item]));
    const placements = [];
    for (const character of characters) {
        const curated = curatedLocationOf(store?.entities, character);
        const curatedName = curated?.name || cleanString(character.currentLocationName, 160);
        const inScene = sceneLocation.name && [character.name, ...(character.aliases || [])]
            .some(name => present.has(canonicalNameKey(name)));
        let placement = null;
        if (inScene && (curatorBehind || !curatedName)) {
            placement = { location: sceneLocation.record, name: sceneLocation.name, source: 'scene' };
        } else if (curatedName) {
            placement = { location: curated, name: curatedName, source: 'curated' };
        } else {
            const stated = resolveLocationReference(store?.entities, character.currentState);
            if (stated) placement = { location: stated, name: stated.name, source: 'current state' };
        }
        placements.push({ character, ...(placement || { location: null, name: '', source: 'unknown' }) });
    }
    return placements;
}

function npcChip(character, chatLength) {
    const age = chatLength - (Number.isFinite(character.lastSeenMessage) ? character.lastSeenMessage : -1);
    return {
        name: character.name,
        state: cleanString(character.currentState, 240),
        active: age <= 8,
        recent: age <= 24,
    };
}

/** Nudge auto-placed nodes off their neighbours so labels stay readable. */
function separateAutoPlaced(nodes) {
    for (const node of nodes) {
        if (!node.autoPlaced) continue;
        const seed = hashStringLite(node.name);
        for (let attempt = 0; attempt < 8; attempt++) {
            const crowded = nodes.some(other => other !== node
                && Number.isFinite(other.x) && Math.hypot(other.x - node.x, other.y - node.y) < 26);
            if (!crowded) break;
            const angle = ((seed % 360) + attempt * 47) * Math.PI / 180;
            node.x = Math.min(960, Math.max(40, node.x + Math.cos(angle) * 28));
            node.y = Math.min(660, Math.max(40, node.y + Math.sin(angle) * 28));
        }
    }
}

/**
 * Fog of war over a built model. Visited places and those inside their
 * revealed circle stay; everything else - and anyone standing there - is
 * hidden. Without exploration data the whole map is shown.
 */
function applyFog(model, explored) {
    if (!(explored instanceof Set)) {
        for (const node of model.nodes) node.visited = true;
        model.reveals = null;
        return model;
    }
    const isVisited = node => node.provisional === true || node === model.player?.node
        || [node.name, ...(node.aliases || [])].some(name => explored.has(canonicalNameKey(name)));
    const visited = model.nodes.filter(isVisited);
    for (const node of visited) node.visited = true;
    model.reveals = visited.map(node => ({
        x: node.x, y: node.y, radius: node === model.player?.node ? REVEAL_RADIUS * 1.15 : REVEAL_RADIUS,
    }));
    const kept = [];
    for (const node of model.nodes) {
        const seen = !node.visited && visited.some(other => Math.hypot(other.x - node.x, other.y - node.y) <= REVEAL_RADIUS * 0.85);
        if (node.visited || seen) {
            kept.push(node);
            continue;
        }
        for (const chip of node.npcs) model.elsewhere.push({ ...chip, reason: 'unexplored' });
    }
    model.nodes = kept;
    return model;
}

/**
 * Build the render model: nodes from location entities, NPC chips from where
 * each NPC currently is (see placeCharacters), and the player marker from the
 * compiled scene. With `explored` (see exploredPlaces) the unexplored world
 * stays under fog; people at hidden or unknown places are listed in
 * `elsewhere` instead of on the map.
 */
export function buildMapModel(store, scene, playerName = '', options = {}) {
    const { locations } = worldRecords(store, playerName);
    const nodes = locations.map(location => ({
        id: location.id,
        name: location.name,
        aliases: location.aliases || [],
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
    const nodeById = new Map(nodes.map(node => [node.id, node]));

    // Auto-placement for discovered places without card coordinates: near the
    // parent when known (placing the parent first, whatever the order), else a
    // deterministic scatter band across the map.
    const placing = new Set();
    const place = node => {
        if (Number.isFinite(node.x) && Number.isFinite(node.y)) return;
        if (placing.has(node)) return;
        placing.add(node);
        const seedHash = hashStringLite(node.name);
        const parentRecord = node.parent ? resolveLocationReference(store?.entities, node.parent) : null;
        const parent = parentRecord && parentRecord.id !== node.id ? nodeById.get(parentRecord.id) : null;
        if (parent) place(parent);
        if (parent && Number.isFinite(parent.x) && Number.isFinite(parent.y)) {
            node.x = parent.x + ((seedHash % 40) - 20);
            node.y = parent.y + 30 + (seedHash % 25);
        } else {
            node.x = 280 + (seedHash % 440);
            node.y = 160 + ((seedHash >> 3) % 380);
        }
        node.autoPlaced = true;
    };
    for (const node of nodes) place(node);

    // A place named in play that the curator has not recorded yet still gets
    // a provisional node, so the player and the NPCs there stay on the map.
    const provisional = new Map();
    const provisionalNode = name => {
        const key = canonicalNameKey(name);
        if (!provisional.has(key)) {
            const seedHash = hashStringLite(name);
            const node = {
                id: `provisional:${key}`, name, aliases: [], region: false,
                x: 300 + (seedHash % 400), y: 180 + ((seedHash >> 3) % 340), importance: 40, parent: '',
                summary: 'Reached in the story; not yet recorded as a location.', description: '', facts: [],
                currentState: '', npcs: [], autoPlaced: true, provisional: true,
            };
            provisional.set(key, node);
            nodes.push(node);
        }
        return provisional.get(key);
    };

    const chatLength = Number.isFinite(scene?.chatLength) ? scene.chatLength : 1_000_000;
    const elsewhere = [];
    for (const placement of placeCharacters(store, scene, playerName)) {
        const chip = npcChip(placement.character, chatLength);
        const host = placement.location ? nodeById.get(placement.location.id)
            : placement.name ? provisionalNode(placement.name) : null;
        if (host) host.npcs.push(chip);
        else elsewhere.push({ ...chip, reason: 'unknown' });
    }

    const sceneLocation = resolveSceneLocation(store, scene);
    const playerNode = sceneLocation.record ? nodeById.get(sceneLocation.record.id)
        : sceneLocation.name ? provisionalNode(sceneLocation.name) : null;
    separateAutoPlaced(nodes);
    const model = {
        nodes,
        elsewhere,
        player: playerNode ? { name: playerName || 'You', x: playerNode.x, y: playerNode.y, node: playerNode } : null,
    };
    return applyFog(model, options.explored);
}

/**
 * Scene view model: the local bubble around the current scene - the location
 * itself, its parent, the places it contains, and the NPCs at each of them,
 * laid out as a "you are here" cluster. Contained places the player has not
 * explored are only counted (`hiddenNearby`).
 */
export function buildSceneModel(store, scene, playerName = '', chatLength = 1_000_000, options = {}) {
    const { locations } = worldRecords(store, playerName);
    const sceneLocation = resolveSceneLocation(store, scene);
    const focus = sceneLocation.record;
    const hostName = sceneLocation.name || 'Somewhere';
    const explored = options.explored instanceof Set ? options.explored : null;

    const node = (name, x, y, extra = {}) => ({
        id: 'scene:' + canonicalNameKey(name), name, aliases: [], region: false, x, y, importance: 50,
        parent: '', summary: '', description: '', facts: [], currentState: '',
        npcs: [], visited: true, ...extra,
    });

    const center = node(hostName, 500, 340, {
        importance: 90, summary: focus?.summary || '', currentState: focus?.currentState || '', facts: focus?.facts || [],
    });
    const model = { nodes: [center], elsewhere: [], hiddenNearby: 0, player: { name: playerName || 'You', x: 500, y: 340, node: center } };
    const nodeByLocationId = new Map(focus ? [[focus.id, center]] : []);

    const parent = focus?.parentLocationName ? resolveLocationReference(store?.entities, focus.parentLocationName) : null;
    if (parent && parent.id !== focus.id) {
        const parentNode = node(parent.name, 500, 140, {
            region: true, summary: parent.summary || '', currentState: parent.currentState || '', facts: parent.facts || [],
        });
        model.nodes.push(parentNode);
        nodeByLocationId.set(parent.id, parentNode);
    }
    const allChildren = focus
        ? locations.filter(location => location.id !== focus.id
            && resolveLocationReference(store?.entities, location.parentLocationName)?.id === focus.id)
        : [];
    const children = explored
        ? allChildren.filter(child => placeKeys(child).some(key => explored.has(key)))
        : allChildren;
    model.hiddenNearby = allChildren.length - children.length;
    children.slice(0, 8).forEach((child, index, shown) => {
        const angle = (Math.PI * 2 * index) / Math.max(4, shown.length) - Math.PI / 2;
        const childNode = node(child.name, 500 + Math.cos(angle) * 200, 340 + Math.sin(angle) * 155, {
            summary: child.summary || '', currentState: child.currentState || '', facts: child.facts || [],
            importance: child.importance || 50,
        });
        model.nodes.push(childNode);
        nodeByLocationId.set(child.id, childNode);
    });

    // Everyone here, and everyone in the places around it; NPCs elsewhere in
    // the world belong to the world view, not this one.
    for (const placement of placeCharacters(store, scene, playerName)) {
        const host = placement.location ? nodeByLocationId.get(placement.location.id)
            : (!focus && placement.name && canonicalNameKey(placement.name) === canonicalNameKey(hostName) ? center : null);
        if (host) host.npcs.push(npcChip(placement.character, chatLength));
    }
    return model;
}

/**
 * What the HUD needs about the player's surroundings: who is here, the
 * explored places around (inside this one, or sharing its parent), and how
 * many unexplored ones are still hidden.
 */
export function describeSurroundings(store, scene, playerName = '', explored = null) {
    const sceneLocation = resolveSceneLocation(store, scene);
    const focus = sceneLocation.record;
    const here = sceneLocation.name || '';
    if (!store) return { here, withYou: [], nearby: [], hiddenNearby: 0 };
    const { locations } = worldRecords(store, playerName);
    const parentId = location => resolveLocationReference(store.entities, location?.parentLocationName)?.id || '';
    const focusParent = focus ? parentId(focus) : '';
    const around = focus
        ? locations.filter(location => location.id !== focus.id
            && (parentId(location) === focus.id || (focusParent && parentId(location) === focusParent)))
        : [];
    const known = explored instanceof Set
        ? around.filter(location => placeKeys(location).some(key => explored.has(key)))
        : around;
    const placements = placeCharacters(store, scene, playerName);
    const peopleAt = location => placements.filter(placement => placement.location?.id === location.id).length;
    const withYou = placements
        .filter(placement => (focus ? placement.location?.id === focus.id
            : placement.name && canonicalNameKey(placement.name) === canonicalNameKey(here)))
        .map(placement => ({ name: placement.character.name, state: cleanString(placement.character.currentState, 240) }));
    return {
        here,
        withYou,
        nearby: known.map(location => ({ name: location.name, people: peopleAt(location) })),
        hiddenNearby: around.length - known.length,
    };
}

/** Scene-view backdrop: a focused spotlight instead of the continent art. */
function sceneArt() {
    return `
<radialGradient id="il-scene-spot" gradientUnits="userSpaceOnUse" cx="500" cy="340" r="620">
    <stop offset="0%" stop-color="#252c3a"/>
    <stop offset="55%" stop-color="#151a24"/>
    <stop offset="100%" stop-color="#0a0d13"/>
</radialGradient>
<rect x="-2000" y="-2000" width="5000" height="4700" fill="url(#il-scene-spot)"/>
<circle cx="500" cy="340" r="250" fill="none" stroke="#3a4356" stroke-width="1.5" stroke-dasharray="2 6" opacity="0.8"/>
<circle cx="500" cy="340" r="340" fill="none" stroke="#2c3342" stroke-width="1" stroke-dasharray="2 8" opacity="0.6"/>`;
}

/** Render the map model into the overlay's SVG element. */
function renderModel(container, model, options = {}) {
    const sceneMode = options.scene === true;
    const links = [];
    for (const node of model.nodes) {
        if (!node.parent) continue;
        const parentKey = canonicalNameKey(node.parent);
        const parent = model.nodes.find(candidate => candidate !== node && canonicalNameKey(candidate.name) === parentKey);
        if (parent && !parent.region) links.push([node, parent]);
    }
    const linkMarkup = links.map(([node, parent]) =>
        `<line class="il-map-link" vector-effect="non-scaling-stroke" x1="${node.x}" y1="${node.y}" x2="${parent.x}" y2="${parent.y}"/>`).join('')
        + (sceneMode
            ? model.nodes.slice(1).map(node => `<line class="il-map-link il-scene-link" vector-effect="non-scaling-stroke" x1="500" y1="340" x2="${node.x}" y2="${node.y}"/>`).join('')
            : '');

    const nodeMarkup = model.nodes.map(node => {
        const classes = ['il-map-node', node.visited ? 'is-visited' : 'is-seen'];
        if (node.region) classes.push('is-region');
        if (node.provisional) classes.push('is-provisional');
        if (node.id === options.selectedId) classes.push('is-selected');
        const npcs = [...node.npcs].sort((a, b) => Number(b.active) - Number(a.active) || Number(b.recent) - Number(a.recent));
        const overflow = npcs.length - MAX_NODE_CHIPS;
        const chips = npcs.slice(0, MAX_NODE_CHIPS)
            .map(chip => `<span class="il-map-chip ${chip.active ? 'is-active' : chip.recent ? 'is-recent' : 'is-dormant'}">${svgEscape(chip.name)}</span>`)
            .join('') + (overflow > 0 ? `<span class="il-map-chip is-dormant">+${overflow}</span>` : '');
        const isCenter = sceneMode && node === model.nodes[0];
        const pinRadius = sceneMode ? (isCenter ? 15 : node.region ? 7 : 11) : (node.region ? 6 : node.visited ? 8 : 6);
        return `<g class="${classes.join(' ')}" data-node-id="${svgEscape(node.id)}" transform="translate(${node.x}, ${node.y})"><g class="il-map-mark">
            <circle class="il-map-hit" r="24"/>
            <circle class="il-map-pin" r="${pinRadius}"/>
            ${node.npcs.length && !node.region ? `<g class="il-map-count" transform="translate(${pinRadius + 4}, ${pinRadius + 4})"><circle r="8"/><text text-anchor="middle" dy="3.5">${node.npcs.length}</text></g>` : ''}
            <text class="il-map-label" y="${-pinRadius - 8}" text-anchor="middle">${svgEscape(node.name)}</text>
            ${chips ? `<foreignObject class="il-map-chips-wrap" x="-95" y="${pinRadius + 5}" width="190" height="48"><div class="il-map-chips" xmlns="http://www.w3.org/1999/xhtml">${chips}</div></foreignObject>` : ''}
        </g></g>`;
    }).join('');

    const youMarkup = model.player
        ? `<g class="il-map-you" transform="translate(${model.player.x}, ${model.player.y})" pointer-events="none"><g class="il-map-mark">
            <circle class="il-map-you-ring" r="16"/>
            <circle class="il-map-you-dot" r="6"/>
        </g></g>`
        : '';

    const art = sceneMode ? sceneArt() : worldArt();
    const fog = !sceneMode && Array.isArray(model.reveals) ? fogLayer(model.reveals) : '';
    container.innerHTML = `${art}${fog}${linkMarkup}${nodeMarkup}${youMarkup}`;
}

/* View geometry. The view is a centre point and a zoom in world units; the
 * SVG viewBox always has the element's own aspect ratio, so one world unit is
 * the same size on both axes and screen and world points convert exactly.
 * At scale 1 the whole world fits the element. */

function unitsPerPixel(view, size) {
    return Math.max(MAP_VIEWBOX.width / size.width, MAP_VIEWBOX.height / size.height) / view.scale;
}

export function clampScale(scale) {
    return Math.min(MAX_SCALE, Math.max(MIN_SCALE, Number(scale) || 1));
}

/** The viewBox for a view on an element of `size` ({ width, height } in px). */
export function viewBoxFor(view, size) {
    const units = unitsPerPixel(view, size);
    const width = size.width * units;
    const height = size.height * units;
    return { x: view.cx - width / 2, y: view.cy - height / 2, width, height };
}

/** The world point under `point` (px from the element's top-left corner). */
export function screenToWorld(view, size, point) {
    const box = viewBoxFor(view, size);
    const units = unitsPerPixel(view, size);
    return { x: box.x + point.x * units, y: box.y + point.y * units };
}

/** Move the view so the world point `anchor` sits under screen `point`. */
export function anchorView(view, size, anchor, point) {
    const units = unitsPerPixel(view, size);
    return {
        ...view,
        cx: anchor.x - (point.x - size.width / 2) * units,
        cy: anchor.y - (point.y - size.height / 2) * units,
    };
}

/** Zoom to `scale` keeping the world point under screen `point` in place. */
export function zoomAround(view, size, point, scale) {
    const anchor = screenToWorld(view, size, point);
    return anchorView({ ...view, scale: clampScale(scale) }, size, anchor, point);
}

/** A view showing `bounds` ({ x, y, width, height } in world units) whole. */
export function fitView(bounds, size, maximumScale = 3) {
    const fitAll = Math.max(MAP_VIEWBOX.width / size.width, MAP_VIEWBOX.height / size.height);
    const needed = Math.max(bounds.width / size.width, bounds.height / size.height, 1e-6);
    return {
        cx: bounds.x + bounds.width / 2,
        cy: bounds.y + bounds.height / 2,
        scale: clampScale(Math.min(maximumScale, fitAll / needed)),
    };
}

function keepInWorld(view) {
    const margin = 150;
    return {
        scale: clampScale(view.scale),
        cx: Math.min(MAP_VIEWBOX.width + margin, Math.max(-margin, view.cx)),
        cy: Math.min(MAP_VIEWBOX.height + margin, Math.max(-margin, view.cy)),
    };
}

/** The explored part of the world, or the whole world when nothing is fogged. */
function explorationBounds(model) {
    if (!Array.isArray(model?.reveals) || !model.reveals.length) {
        return { x: 0, y: 0, width: MAP_VIEWBOX.width, height: MAP_VIEWBOX.height };
    }
    const xs = model.reveals.flatMap(point => [point.x - point.radius, point.x + point.radius]);
    const ys = model.reveals.flatMap(point => [point.y - point.radius, point.y + point.radius]);
    return { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) };
}

function personRow(person) {
    const badge = personBadge(person.name);
    const status = person.active ? 'here recently' : person.recent ? 'seen lately' : 'not seen for a while';
    return `<li><button type="button" class="il-map-person${person.active || person.recent ? '' : ' is-dormant'}" data-person="${svgEscape(person.name)}">
        <span class="il-map-face" style="--hue:${badge.hue}">${svgEscape(badge.initials)}</span>
        <span><b>${svgEscape(person.name)}</b><small>${svgEscape(person.state || status)}</small></span>
    </button></li>`;
}

/**
 * Create the panel object: { open(view), refresh(store, scene, playerName), close() }.
 * `onPerson(name)` opens a person's card. The overlay is created lazily on
 * first open.
 */
export function createMapPanel({ onPerson } = {}) {
    let overlay = null;
    let svg = null;
    let sheet = null;
    let view = null;
    let activeView = 'world';
    let lastInputs = null;
    let lastModel = null;
    let selectedId = '';
    let frame = 0;

    const size = () => {
        const rect = svg.getBoundingClientRect();
        return { width: rect.width, height: rect.height, left: rect.left, top: rect.top };
    };
    const measurable = () => svg && size().width > 2 && size().height > 2;

    const applyView = () => {
        if (!measurable()) return;
        const current = size();
        if (!view) view = initialView(current);
        view = keepInWorld(view);
        const box = viewBoxFor(view, current);
        svg.setAttribute('viewBox', `${box.x} ${box.y} ${box.width} ${box.height}`);
        svg.style.setProperty('--il-map-k', String(unitsPerPixel(view, current)));
        svg.classList.toggle('is-far', activeView === 'world' && view.scale < 1.4);
    };
    const scheduleView = () => {
        cancelAnimationFrame(frame);
        frame = requestAnimationFrame(applyView);
    };

    // The world view opens on the explored region with the player in it; the
    // scene view is laid out for the whole frame.
    function initialView(current) {
        if (activeView === 'scene') return { cx: 500, cy: 350, scale: 1 };
        const fitted = fitView(explorationBounds(lastModel), current);
        if (!lastModel?.player) return fitted;
        const shown = viewBoxFor(fitted, current);
        const { x, y } = lastModel.player;
        const inside = x > shown.x + 40 && x < shown.x + shown.width - 40 && y > shown.y + 40 && y < shown.y + shown.height - 40;
        return inside ? fitted : { cx: x, cy: y, scale: Math.max(fitted.scale, 1.8) };
    }

    function recenter() {
        if (!measurable()) return;
        if (activeView === 'world' && lastModel?.player) {
            view = { cx: lastModel.player.x, cy: lastModel.player.y, scale: Math.max(view?.scale || 1, 2.2) };
        } else {
            view = null;
        }
        applyView();
    }

    const ensureOverlay = () => {
        ensureInlineStyles();
        if (overlay) return;
        overlay = document.createElement('div');
        overlay.id = 'il_map_overlay';
        overlay.className = 'displayNone';
        overlay.setAttribute('role', 'dialog');
        overlay.setAttribute('aria-label', 'InnerLore map');
        overlay.innerHTML = `
            <div class="il-map-header">
                <button type="button" class="il-map-iconbtn il-map-close" aria-label="Close the map" title="Close">${ICON.close}</button>
                <div class="il-map-heading">
                    <span class="il-map-kicker">World map</span>
                    <span class="il-map-where"></span>
                </div>
                <span class="il-map-views" role="tablist">
                    <button type="button" class="il-map-view-btn is-active" data-view="world" role="tab">World</button>
                    <button type="button" class="il-map-view-btn" data-view="scene" role="tab">Here</button>
                </span>
            </div>
            <div class="il-map-body">
                <svg id="il_map_svg" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid meet"></svg>
                <div class="il-map-legend"></div>
                <div class="il-map-controls">
                    <button type="button" class="il-map-ctl" data-zoom="in" aria-label="Zoom in" title="Zoom in">${ICON.plus}</button>
                    <button type="button" class="il-map-ctl" data-zoom="out" aria-label="Zoom out" title="Zoom out">${ICON.minus}</button>
                    <button type="button" class="il-map-ctl" data-zoom="recenter" aria-label="Centre on you" title="Centre on you">${ICON.locate}</button>
                </div>
                <aside class="il-map-sheet displayNone" aria-live="polite"></aside>
            </div>`;
        document.body.appendChild(overlay);
        svg = overlay.querySelector('#il_map_svg');
        sheet = overlay.querySelector('.il-map-sheet');
        overlay.querySelector('.il-map-close').addEventListener('click', close);
        overlay.addEventListener('keydown', event => {
            if (event.key === 'Escape') close();
        });
        sheet.addEventListener('click', event => {
            const person = event.target.closest('[data-person]');
            if (person) onPerson?.(person.dataset.person);
            if (event.target.closest('.il-map-sheet-close')) hideSheet();
        });
        overlay.querySelector('.il-map-legend').addEventListener('click', event => {
            if (event.target.closest('[data-elsewhere]')) showElsewhere();
        });

        // One finger pans, two pinch around their midpoint, the wheel zooms
        // around the cursor. Each gesture pins a world point to the fingers
        // (or cursor), so the map under them never drifts.
        const pointers = new Map();
        let gesture = null;
        const pointOf = event => {
            const current = size();
            return { x: event.clientX - current.left, y: event.clientY - current.top };
        };
        const startPan = point => {
            gesture = { kind: 'pan', anchor: screenToWorld(view, size(), point), from: point, moved: false };
        };
        svg.addEventListener('pointerdown', event => {
            if (!view) return;
            const point = pointOf(event);
            pointers.set(event.pointerId, point);
            if (pointers.size === 1) {
                startPan(point);
                gesture.node = event.target.closest?.('[data-node-id]')?.dataset.nodeId || '';
            } else if (pointers.size === 2) {
                const [a, b] = [...pointers.values()];
                const middle = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
                gesture = {
                    kind: 'pinch',
                    anchor: screenToWorld(view, size(), middle),
                    scale: view.scale,
                    distance: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)),
                    moved: true,
                };
            }
            svg.setPointerCapture?.(event.pointerId);
        });
        svg.addEventListener('pointermove', event => {
            if (!pointers.has(event.pointerId) || !gesture) return;
            const point = pointOf(event);
            pointers.set(event.pointerId, point);
            const current = size();
            if (gesture.kind === 'pinch' && pointers.size >= 2) {
                const [a, b] = [...pointers.values()];
                const middle = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
                const scale = clampScale(gesture.scale * Math.hypot(a.x - b.x, a.y - b.y) / gesture.distance);
                view = anchorView({ ...view, scale }, current, gesture.anchor, middle);
            } else if (gesture.kind === 'pan') {
                if (!gesture.moved && Math.hypot(point.x - gesture.from.x, point.y - gesture.from.y) < 6) return;
                gesture.moved = true;
                svg.classList.add('is-dragging');
                view = anchorView(view, current, gesture.anchor, point);
            }
            scheduleView();
        });
        const release = event => {
            if (!pointers.has(event.pointerId)) return;
            const tapped = event.type === 'pointerup' && pointers.size === 1 && gesture?.kind === 'pan'
                && !gesture.moved && gesture.node;
            const tappedNode = tapped ? gesture.node : '';
            pointers.delete(event.pointerId);
            svg.classList.remove('is-dragging');
            if (pointers.size === 1) startPan([...pointers.values()][0]);
            else if (pointers.size === 0) gesture = null;
            if (tappedNode) {
                const node = lastModel?.nodes.find(candidate => candidate.id === tappedNode);
                if (node) showDetail(node);
            }
        };
        svg.addEventListener('pointerup', release);
        svg.addEventListener('pointercancel', release);
        svg.addEventListener('wheel', event => {
            event.preventDefault();
            if (!view) return;
            view = zoomAround(view, size(), pointOf(event), view.scale * (event.deltaY < 0 ? 1.2 : 1 / 1.2));
            scheduleView();
        }, { passive: false });
        svg.addEventListener('dblclick', event => {
            if (!view) return;
            view = zoomAround(view, size(), pointOf(event), view.scale * 2);
            scheduleView();
        });
        for (const button of overlay.querySelectorAll('.il-map-view-btn')) {
            button.addEventListener('click', () => setView(button.dataset.view));
        }
        for (const button of overlay.querySelectorAll('.il-map-ctl')) {
            button.addEventListener('click', () => {
                if (button.dataset.zoom === 'recenter') return recenter();
                if (!view || !measurable()) return;
                const current = size();
                const middle = { x: current.width / 2, y: current.height / 2 };
                view = zoomAround(view, current, middle, view.scale * (button.dataset.zoom === 'in' ? 1.5 : 1 / 1.5));
                applyView();
            });
        }
        if (typeof window !== 'undefined') window.addEventListener('resize', scheduleView);
    };

    function setView(next) {
        activeView = next === 'scene' ? 'scene' : 'world';
        if (!overlay) return;
        for (const button of overlay.querySelectorAll('.il-map-view-btn')) {
            button.classList.toggle('is-active', button.dataset.view === activeView);
        }
        overlay.querySelector('.il-map-kicker').textContent = activeView === 'scene' ? 'Around you' : 'World map';
        view = null;
        hideSheet();
        if (lastInputs) refresh(lastInputs.store, lastInputs.scene, lastInputs.playerName);
    }

    function hideSheet() {
        sheet?.classList.add('displayNone');
        if (selectedId) {
            selectedId = '';
            svg?.querySelector('.is-selected')?.classList.remove('is-selected');
        }
    }

    function showSheet(html) {
        sheet.innerHTML = html;
        sheet.classList.remove('displayNone');
    }

    function showDetail(node) {
        if (!sheet) return;
        selectedId = node.id;
        svg.querySelector('.is-selected')?.classList.remove('is-selected');
        svg.querySelector(`[data-node-id="${CSS.escape(node.id)}"]`)?.classList.add('is-selected');
        const here = lastModel?.player?.node === node;
        const tags = [
            here ? '<span class="il-map-tag is-you">You are here</span>' : '',
            node.visited ? '<span class="il-map-tag is-visited">Explored</span>' : '<span class="il-map-tag">Seen from afar</span>',
            node.provisional ? '<span class="il-map-tag">Not yet recorded</span>' : '',
        ].join('');
        const facts = node.facts.slice(0, 6)
            .map(fact => `<li>${svgEscape(typeof fact === 'string' ? fact : fact?.statement || '')}</li>`).join('');
        const people = node.npcs.length
            ? `<ul class="il-map-people">${node.npcs.map(personRow).join('')}</ul>`
            : '<p class="il-map-empty">No one we know of is here.</p>';
        showSheet(`
            <div class="il-map-sheet-head">
                <div class="il-map-sheet-title"><div class="il-map-tags">${tags}</div><h3>${svgEscape(node.name)}</h3></div>
                <button type="button" class="il-map-iconbtn il-map-sheet-close" aria-label="Close details">${ICON.close}</button>
            </div>
            <div class="il-map-sheet-body">
                ${node.summary ? `<p>${svgEscape(node.summary)}</p>` : ''}
                ${node.currentState ? `<p class="il-map-now"><b>Now:</b> ${svgEscape(node.currentState)}</p>` : ''}
                ${facts ? `<ul class="il-map-facts">${facts}</ul>` : ''}
                <div class="il-map-section">People here</div>
                ${people}
            </div>`);
    }

    function showElsewhere() {
        const people = lastModel?.elsewhere || [];
        const unknown = people.filter(person => person.reason === 'unknown');
        const hidden = people.filter(person => person.reason !== 'unknown');
        const list = items => `<ul class="il-map-people">${items.map(personRow).join('')}</ul>`;
        hideSheet();
        showSheet(`
            <div class="il-map-sheet-head">
                <div class="il-map-sheet-title"><div class="il-map-tags"><span class="il-map-tag">Off the map</span></div><h3>Elsewhere</h3></div>
                <button type="button" class="il-map-iconbtn il-map-sheet-close" aria-label="Close">${ICON.close}</button>
            </div>
            <div class="il-map-sheet-body">
                ${hidden.length ? `<div class="il-map-section">Somewhere unexplored</div>${list(hidden)}` : ''}
                ${unknown.length ? `<div class="il-map-section">Whereabouts unknown</div>${list(unknown)}` : ''}
                ${!people.length ? '<p class="il-map-empty">Everyone we know of is on the map.</p>' : ''}
            </div>`);
    }

    function renderLegend() {
        const legend = overlay.querySelector('.il-map-legend');
        const away = lastModel?.elsewhere?.length || 0;
        if (activeView === 'scene') {
            const hidden = lastModel?.hiddenNearby || 0;
            const inside = (lastModel?.nodes || []).filter(node => !node.region).length - 1;
            legend.innerHTML = hidden
                ? `<span class="il-map-pill">${hidden} unexplored place${hidden === 1 ? '' : 's'} nearby</span>`
                : (inside > 0 ? '' : '<span class="il-map-pill">Nothing discovered inside yet - explore to reveal it</span>');
            return;
        }
        legend.innerHTML = (lastModel?.nodes.length
            ? '<span class="il-map-pill"><span class="il-map-key is-you"></span>You<span class="il-map-key is-visited"></span>Explored<span class="il-map-key is-seen"></span>Seen</span>'
            : '<span class="il-map-pill">Nothing explored yet - the map fills in as you travel</span>')
            + (away ? `<button type="button" class="il-map-pill" data-elsewhere="1">Elsewhere · ${away}</button>` : '');
    }

    function refresh(store, scene, playerName) {
        ensureOverlay();
        lastInputs = { store, scene, playerName };
        overlay.querySelector('.il-map-where').textContent = resolveSceneLocation(store, scene).name || scene?.location?.name || 'Somewhere';
        if (!store) {
            svg.innerHTML = '<text x="500" y="350" text-anchor="middle" fill="#8fa3b8" font-size="18" font-family="serif" font-style="italic">World state is still loading…</text>';
            return;
        }
        const chat = (typeof window !== 'undefined' && window.SillyTavern?.getContext?.()?.chat) || [];
        const explored = exploredPlaces(chat, store, playerName, scene);
        const enrichedScene = { ...scene, chatLength: chat.length };
        lastModel = activeView === 'scene'
            ? buildSceneModel(store, enrichedScene, playerName, chat.length, { explored })
            : buildMapModel(store, enrichedScene, playerName, { explored });
        if (selectedId && !lastModel.nodes.some(node => node.id === selectedId)) hideSheet();
        renderModel(svg, lastModel, { scene: activeView === 'scene', selectedId });
        renderLegend();
        applyView();
    }

    function open(next) {
        ensureOverlay();
        if (next && next !== activeView) setView(next);
        overlay.classList.remove('displayNone');
        overlay.tabIndex = -1;
        overlay.focus?.({ preventScroll: true });
        scheduleView();
    }

    function close() {
        overlay?.classList.add('displayNone');
    }

    return { open, refresh, close };
}
