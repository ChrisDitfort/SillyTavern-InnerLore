/**
 * The game's full screens, opened from the menu at the bottom: the inventory
 * (purse and belongings, what is here and for sale, how people and groups
 * regard the player, the ledger of recent changes) and trade (the people and
 * bodies here, with what can be bought, sold, swapped or taken).
 * The planner's prepared material is narrator-only and never shown here.
 */

import { canonicalNameKey, cleanString, escapeHtml, resolveLocationReference } from './core.js?v=49';
import { gameOverview, normalizeGameState, placeRefOf, tradeOverview } from './game.js?v=6';

const STYLE_ID = 'il_game_inline_styles_v3';
const STYLES = `
/* An explicit size: a theme or extension can transform <html>, and inset:0 then measures against it, not the screen. */
.il-screen{--il-gold:#ecd9ac;--il-line:rgba(255,255,255,.09);--il-muted:#8f99a8;--il-gutter:22px;position:fixed;top:0;left:0;width:100vw;height:100vh;height:100dvh;z-index:31000;background:#070a0f;display:flex;justify-content:center;color:#d6dbe4;font-size:12.5px;line-height:1.4}
.il-screen *{box-sizing:border-box}
.il-game-panel{width:100%;max-width:820px;height:100%;display:flex;flex-direction:column;padding:env(safe-area-inset-top) env(safe-area-inset-right) 0 env(safe-area-inset-left)}
.il-game-head{display:flex;align-items:center;gap:12px;padding:12px var(--il-gutter) 10px}
.il-game-title{flex:1;min-width:0}
.il-game-kicker{display:block;font-size:.66em;letter-spacing:.18em;text-transform:uppercase;color:#7d8796}
.il-game-title h3{margin:1px 0 0;font-size:1.12em;color:var(--il-gold);font-weight:650;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.il-game-close{flex:none;width:38px;height:38px;border-radius:12px;border:1px solid var(--il-line);background:rgba(255,255,255,.04);color:#cfd6e0;display:grid;place-items:center;cursor:pointer;padding:0}
.il-game-close:hover{border-color:rgba(226,201,154,.45);color:var(--il-gold)}
.il-game-close svg{width:18px;height:18px}
.il-game-tabs{display:flex;gap:4px;margin:0 var(--il-gutter) 8px;padding:3px;border-radius:12px;background:rgba(255,255,255,.04);border:1px solid var(--il-line)}
.il-game-tab{flex:1;border:0;background:none;color:#9aa3b0;padding:9px 4px;border-radius:9px;font:inherit;font-size:.88em;cursor:pointer;white-space:nowrap}
.il-game-tab.is-active{background:rgba(226,201,154,.16);color:var(--il-gold)}
.il-game-body{flex:1;overflow-y:auto;padding:6px var(--il-gutter) calc(18px + env(safe-area-inset-bottom,0px))}
.il-game-purse{display:flex;align-items:center;gap:12px;padding:12px;border-radius:14px;border:1px solid rgba(226,201,154,.22);background:linear-gradient(135deg,rgba(226,201,154,.10),rgba(255,255,255,.02));margin-bottom:10px}
.il-game-purse svg{flex:none;width:30px;height:30px;color:var(--il-gold)}
.il-game-purse b{display:block;color:var(--il-gold);font-size:1.06em}
.il-game-purse small{color:var(--il-muted)}
.il-game-section{margin:14px 0 6px;font-size:.68em;letter-spacing:.16em;text-transform:uppercase;color:#7d8796;font-weight:600}
.il-game-list{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:5px}
.il-game-row{border:1px solid var(--il-line);border-radius:11px;background:rgba(255,255,255,.03)}
.il-game-row>button{display:flex;align-items:flex-start;gap:9px;width:100%;padding:8px 14px;border:0;background:none;color:inherit;font:inherit;text-align:left;cursor:pointer}
.il-game-row>button:hover{background:rgba(255,255,255,.03)}
.il-game-row.is-nested{margin-left:18px}
.il-game-main{flex:1;min-width:0}
.il-game-main b{font-weight:600;color:#e4e8ef}
.il-game-main small{display:block;color:var(--il-muted);font-size:.82em;overflow-wrap:anywhere}
.il-game-side{flex:none;text-align:right;font-size:.82em;color:var(--il-gold);white-space:nowrap}
.il-game-qty{color:#9fb0c2;font-weight:500;margin-left:4px}
.il-game-more{display:none;padding:0 10px 9px 10px;font-size:.84em;color:#aab3c0}
.il-game-row.is-open .il-game-more{display:block}
.il-game-more ol{margin:6px 0 0;padding-left:18px}
.il-game-tier{display:inline-block;font-size:.66em;letter-spacing:.1em;text-transform:uppercase;padding:2px 7px;border-radius:999px;border:1px solid var(--il-line);color:#c9cfd9;margin-left:6px;vertical-align:1px}
.il-game-tier.is-good{border-color:rgba(142,230,162,.45);color:#bfeec9}
.il-game-tier.is-bad{border-color:rgba(240,128,128,.45);color:#f3c0c0}
.il-game-bar{position:relative;height:6px;border-radius:3px;background:rgba(255,255,255,.07);margin-top:6px;overflow:hidden}
.il-game-bar span{position:absolute;top:0;bottom:0;border-radius:3px}
.il-game-bar::after{content:'';position:absolute;left:50%;top:0;bottom:0;width:1px;background:rgba(255,255,255,.22)}
.il-game-bar.is-plain::after{display:none}
.il-game-empty{color:#6d7684;font-style:italic;font-size:.88em;margin:6px 0}
.il-game-change{display:flex;gap:9px;padding:7px 4px;border-bottom:1px solid var(--il-line);font-size:.9em}
.il-game-confirm{display:flex;align-items:center;gap:10px;padding:9px 12px;margin:6px 0;border-radius:12px;border:1px dashed rgba(226,201,154,.45);background:rgba(226,201,154,.06)}
.il-game-confirm .il-game-main{flex:1;min-width:0}
.il-game-confirm .il-game-main small{color:var(--il-muted);font-size:.82em}
.il-game-confirm-actions{display:flex;gap:6px;flex:none}
.il-game-note{color:var(--il-muted);font-size:.86em;margin:4px 0 8px}
.il-game-change small{flex:none;color:#7d8796;min-width:44px}
.il-trade-partners{display:flex;gap:6px;overflow-x:auto;margin:0 var(--il-gutter) 8px;padding-bottom:2px;scrollbar-width:none}
.il-trade-partners::-webkit-scrollbar{display:none}
.il-trade-partner{flex:none;padding:8px 13px;border-radius:999px;border:1px solid var(--il-line);background:rgba(255,255,255,.03);color:#c4ccd7;font:inherit;font-size:.88em;cursor:pointer;white-space:nowrap}
.il-trade-partner.is-active{border-color:rgba(226,201,154,.5);background:rgba(226,201,154,.14);color:var(--il-gold)}
.il-trade-partner.is-body{border-style:dashed}
.il-trade-row{display:flex;align-items:center;gap:8px;padding:8px 14px}
.il-trade-row .il-game-main{flex:1;min-width:0}
.il-trade-actions{display:flex;flex-wrap:wrap;justify-content:flex-end;gap:6px;flex:none;max-width:52%}
.il-trade-act{border:1px solid rgba(226,201,154,.38);background:rgba(226,201,154,.09);color:var(--il-gold);border-radius:9px;padding:6px 11px;font:inherit;font-size:.82em;cursor:pointer;white-space:nowrap}
.il-trade-act.is-quiet{border-color:var(--il-line);background:rgba(255,255,255,.03);color:#c4ccd7}
.il-trade-act:hover{border-color:rgba(226,201,154,.7)}
.il-trade-note{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:10px 12px;margin:8px 0;border-radius:12px;border:1px dashed rgba(226,201,154,.38);color:#d9c9a3;font-size:.9em}
.il-trade-meta{color:var(--il-muted);font-size:.86em;margin:2px 0 4px}
.il-trade-wide{display:flex;flex-wrap:wrap;gap:8px;margin:10px 0 4px}
`;

const ICON = {
    back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M19 12H5M11 18l-6-6 6-6"/></svg>',
    purse: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><ellipse cx="12" cy="5.6" rx="7" ry="2.6"/><path d="M5 5.6v4.2c0 1.4 3.1 2.6 7 2.6s7-1.2 7-2.6V5.6"/><path d="M5 9.8V14c0 1.4 3.1 2.6 7 2.6s7-1.2 7-2.6V9.8"/><path d="M5 14v4.2c0 1.4 3.1 2.6 7 2.6s7-1.2 7-2.6V14"/></svg>',
};

const TABS = [['bag', 'Bag'], ['here', 'Here'], ['people', 'People'], ['ledger', 'Ledger']];

function ensureStyles() {
    if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = STYLES;
    document.head.appendChild(style);
}

function tierClass(score) {
    if (score >= 8) return 'is-good';
    if (score <= -8) return 'is-bad';
    return '';
}

/** A centred bar: green to the right for regard, red to the left for hostility. */
function scoreBar(score) {
    const value = Math.max(-100, Math.min(100, Number(score) || 0));
    const width = Math.abs(value) / 2;
    const left = value >= 0 ? 50 : 50 - width;
    const colour = value >= 0 ? 'rgba(142,230,162,.75)' : 'rgba(240,128,128,.75)';
    return `<div class="il-game-bar" aria-hidden="true"><span style="left:${left}%;width:${width}%;background:${colour}"></span></div>`;
}

function itemRow(item, { nested = false } = {}) {
    const details = [item.condition, item.container ? `in the ${item.container}` : '', item.place].filter(Boolean).join(' · ');
    const history = (item.history || []).slice(-6).map(step => (
        `<li>${escapeHtml(step.label || 'moved')}${step.note ? ` — ${escapeHtml(step.note)}` : ''} <small>(message ${step.at})</small></li>`
    )).join('');
    return `<li class="il-game-row${nested ? ' is-nested' : ''}">
        <button type="button" data-toggle="1">
            <span class="il-game-main"><b>${escapeHtml(item.name)}</b>${item.quantity > 1 ? `<span class="il-game-qty">×${item.quantity}</span>` : ''}${details ? `<small>${escapeHtml(details)}</small>` : ''}</span>
            <span class="il-game-side">${escapeHtml(item.price ? `${item.price}${item.seller ? ` · ${item.seller}` : ''}` : item.value)}</span>
        </button>
        <div class="il-game-more">${item.description ? `<div>${escapeHtml(item.description)}</div>` : ''}${history ? `<ol>${history}</ol>` : item.description ? '' : '<div>No history recorded yet.</div>'}</div>
    </li>`;
}

/** A left-to-right bar for a gift's level. */
function giftBar(level) {
    const value = Math.max(0, Math.min(100, Number(level) || 0));
    return `<div class="il-game-bar is-plain" aria-hidden="true"><span style="left:0;width:${value}%;background:rgba(167,139,250,.75)"></span></div>`;
}

function standingRow(record, { person = false } = {}) {
    const reason = record.notes?.at(-1)?.reason;
    return `<li class="il-game-row">
        <button type="button" ${person ? `data-person="${escapeHtml(record.name)}"` : 'data-toggle="1"'}>
            <span class="il-game-main"><b>${escapeHtml(record.name)}</b><span class="il-game-tier ${tierClass(record.score)}">${escapeHtml(record.tier)}</span>
            ${reason ? `<small>${escapeHtml(reason)}</small>` : ''}${record.gifts?.length ? `<small>Gifts: ${escapeHtml(record.gifts.map(gift => `${gift.name} (${gift.tier})`).join(', '))}</small>` : ''}${scoreBar(record.score)}</span>
            <span class="il-game-side">${record.score > 0 ? '+' : ''}${record.score}</span>
        </button>
        ${person ? '' : `<div class="il-game-more"><ol>${(record.notes || []).slice(-6).map(note => `<li>${note.delta > 0 ? '+' : ''}${note.delta}${note.reason ? ` — ${escapeHtml(note.reason)}` : ''}</li>`).join('')}</ol></div>`}
    </li>`;
}

/** Items in a bag listed under the bag; everything else in order. */
function nestedItems(items) {
    const byContainer = new Map();
    const top = [];
    for (const item of items) {
        if (item.container) {
            const key = canonicalNameKey(item.container);
            byContainer.set(key, [...(byContainer.get(key) || []), item]);
        } else {
            top.push(item);
        }
    }
    const rows = [];
    for (const item of top) {
        rows.push(itemRow(item));
        for (const inside of byContainer.get(canonicalNameKey(item.name)) || []) rows.push(itemRow(inside, { nested: true }));
        byContainer.delete(canonicalNameKey(item.name));
    }
    for (const leftovers of byContainer.values()) for (const item of leftovers) rows.push(itemRow(item, { nested: true }));
    return rows.join('');
}

export function renderGameTab(tab, overview, { place = '' } = {}) {
    const empty = text => `<p class="il-game-empty">${escapeHtml(text)}</p>`;
    if (tab === 'here') {
        const here = overview.here.length ? `<ul class="il-game-list">${overview.here.map(item => itemRow(item)).join('')}</ul>` : empty('Nothing tracked lies here yet.');
        const sale = overview.forSale.length
            ? `<ul class="il-game-list">${overview.forSale.map(entry => `<li class="il-game-row"><button type="button"><span class="il-game-main"><b>${escapeHtml(entry.name)}</b>${entry.seller ? `<small>${escapeHtml(entry.seller)}</small>` : ''}</span><span class="il-game-side">${escapeHtml(`${entry.price}${entry.per ? ` ${entry.per}` : ''}`)}</span></button></li>`).join('')}</ul>`
            : empty('No prices known here yet.');
        const bodies = (overview.bodies || []).map(body => `<div class="il-game-section">${escapeHtml(body.name)}${body.cause ? ` · ${escapeHtml(body.cause)}` : ''}</div>${body.items.length
            ? `<ul class="il-game-list">${body.items.map(item => itemRow(item)).join('')}</ul>`
            : empty('Nothing can be seen on the body; searching it may turn something up.')}`).join('');
        return `<div class="il-game-section">At ${escapeHtml(place || 'this place')}</div>${here}${bodies}<div class="il-game-section">For sale</div>${sale}`;
    }
    if (tab === 'people') {
        const people = overview.people.length
            ? `<ul class="il-game-list">${overview.people.map(record => standingRow(record, { person: true })).join('')}</ul>`
            : empty('Nobody has formed an opinion of you yet.');
        const contacts = overview.device?.present
            ? `<div class="il-game-section">${escapeHtml(overview.device.name || 'phone')} contacts</div>${overview.contacts?.length
                ? `<ul class="il-game-list">${overview.contacts.map(contact => `<li class="il-game-row"><button type="button" data-person="${escapeHtml(contact.name)}"><span class="il-game-main"><b>${escapeHtml(contact.name)}</b>${contact.number ? `<small>${escapeHtml(contact.number)}</small>` : ''}</span></button></li>`).join('')}</ul>`
                : empty('No contacts yet.')}`
            : '';
        const groups = overview.reputation.length
            ? `<ul class="il-game-list">${overview.reputation.map(record => standingRow(record)).join('')}</ul>`
            : empty('No group knows your name yet.');
        return `<div class="il-game-section">How people regard you</div>${people}<div class="il-game-section">Reputation</div>${groups}${contacts}`;
    }
    if (tab === 'ledger') {
        const pending = (overview.pending || []).length
            ? `<div class="il-game-section">Awaiting your word</div><div class="il-game-note">The story told of these without the game tools; nothing moves until you say so.</div>${overview.pending.map(entry => `<div class="il-game-confirm" data-pending="${escapeHtml(entry.id)}"><span class="il-game-main"><b>${escapeHtml(entry.text)}</b>${entry.evidence ? `<small>${escapeHtml(entry.evidence)}</small>` : ''}</span><span class="il-game-confirm-actions"><button type="button" class="il-trade-act" data-confirm="${escapeHtml(entry.id)}" data-accept="1">Yes, that happened</button><button type="button" class="il-trade-act is-quiet" data-confirm="${escapeHtml(entry.id)}" data-accept="0">No</button></span></div>`).join('')}<div class="il-game-section">Recorded</div>`
            : '';
        const recorded = overview.ledger.length
            ? overview.ledger.map(change => `<div class="il-game-change"><small>msg ${change.at}</small><span>${escapeHtml(change.text)}</span></div>`).join('')
            : empty('No purchases, gifts or losses recorded yet.');
        return `${pending}${recorded}`;
    }
    const purse = `<div class="il-game-purse">${ICON.purse}<div><b>${escapeHtml(overview.purse.text)}</b><small>${escapeHtml(overview.carryingValue ? `Belongings worth about ${overview.carryingValue}` : 'Purse')}</small></div></div>`;
    const bag = overview.carrying.length
        ? `<ul class="il-game-list">${nestedItems(overview.carrying)}</ul>`
        : empty('You are not carrying anything the ledger knows about yet.');
    const gifts = overview.abilities?.length
        ? `<ul class="il-game-list">${overview.abilities.map(gift => `<li class="il-game-row"><button type="button" data-toggle="1"><span class="il-game-main"><b>${escapeHtml(gift.name)}</b><span class="il-game-tier ${gift.level >= 40 ? 'is-good' : ''}">${escapeHtml(gift.tier)}</span>${giftBar(gift.level)}</span><span class="il-game-side">${gift.level}</span></button><div class="il-game-more">${escapeHtml(gift.note || 'Judged from the story and your character.')}</div></li>`).join('')}</ul>`
        : empty(overview.abilitiesJudged ? 'No notable gifts: the world has weighed it.' : 'Nothing judged yet. Reaching for someone\'s mind, or for a phone, asks the world what you can do.');
    const awaiting = (overview.pending || []).length
        ? `<div class="il-game-confirm"><span class="il-game-main"><b>${overview.pending.length === 1 ? 'One exchange awaits' : `${overview.pending.length} exchanges await`} your word</b><small>Told in the story without the game tools; see the Ledger tab.</small></span><span class="il-game-confirm-actions"><button type="button" class="il-trade-act is-quiet" data-tab="ledger">Review</button></span></div>`
        : '';
    return `${purse}${awaiting}<div class="il-game-section">Carrying</div>${bag}<div class="il-game-section">Gifts and skills</div>${gifts}`;
}

/** The scene's place as the game state names it. */
function scenePlace(store, scene) {
    const entities = store?.entities || {};
    const name = cleanString(scene?.location?.name, 240);
    const record = name ? ((scene.location.id && entities[scene.location.id]) || resolveLocationReference(entities, name)) : null;
    return placeRefOf(record, name);
}

export function createGamePanel({ onPerson, onConfirm } = {}) {
    let overlay = null;
    let body = null;
    let activeTab = 'bag';
    let last = null;

    const close = () => overlay?.classList.add('displayNone');
    const ensure = () => {
        ensureStyles();
        if (overlay) return;
        overlay = document.createElement('div');
        overlay.id = 'il_game_overlay';
        overlay.className = 'il-screen displayNone';
        overlay.setAttribute('role', 'dialog');
        overlay.setAttribute('aria-label', 'Inventory and standing');
        overlay.innerHTML = `
            <div class="il-game-panel">
                <div class="il-game-head">
                    <button type="button" class="il-game-close" aria-label="Back to the story" title="Back to the story">${ICON.back}</button>
                    <div class="il-game-title"><span class="il-game-kicker">Inventory</span><h3></h3></div>
                </div>
                <div class="il-game-tabs" role="tablist">${TABS.map(([id, label]) => `<button type="button" class="il-game-tab" role="tab" data-tab="${id}">${label}</button>`).join('')}</div>
                <div class="il-game-body"></div>
            </div>`;
        document.body.appendChild(overlay);
        body = overlay.querySelector('.il-game-body');
        overlay.addEventListener('click', event => {
            if (event.target === overlay || event.target.closest('.il-game-close')) return close();
            const tab = event.target.closest('[data-tab]');
            if (tab) {
                activeTab = tab.dataset.tab;
                return paint();
            }
            const confirm = event.target.closest('[data-confirm]');
            if (confirm) {
                confirm.disabled = true;
                return onConfirm?.(confirm.dataset.confirm, confirm.dataset.accept === '1');
            }
            const person = event.target.closest('[data-person]');
            if (person) return onPerson?.(person.dataset.person);
            const toggle = event.target.closest('[data-toggle]');
            if (toggle) toggle.closest('.il-game-row')?.classList.toggle('is-open');
        });
        overlay.addEventListener('keydown', event => {
            if (event.key === 'Escape') close();
        });
    };
    const paint = () => {
        if (!overlay || !last) return;
        overlay.querySelectorAll('.il-game-tab').forEach(button => button.classList.toggle('is-active', button.dataset.tab === activeTab));
        overlay.querySelector('.il-game-title h3').textContent = last.overview.purse.text;
        body.innerHTML = renderGameTab(activeTab, last.overview, { place: last.place?.name });
    };
    return {
        open(tab = activeTab) {
            ensure();
            activeTab = TABS.some(([id]) => id === tab) ? tab : 'bag';
            overlay.classList.remove('displayNone');
            paint();
            overlay.querySelector('.il-game-close').focus({ preventScroll: true });
        },
        refresh(store, scene, playerName) {
            const place = scenePlace(store, scene);
            const present = (scene?.participants || []).map(person => person.name);
            last = {
                place,
                overview: gameOverview(normalizeGameState(store?.game), { playerName, place, present }),
            };
            if (overlay && !overlay.classList.contains('displayNone')) paint();
        },
        isOpen: () => Boolean(overlay && !overlay.classList.contains('displayNone')),
        close,
    };
}

/** "the mended net", but "Old Fen's knife" and "a bowl of soup" as they are. */
function theName(name) {
    return /^(?:the|a|an|some|\d)\b/iu.test(name) || /^\p{Lu}/u.test(name) ? name : `the ${name}`;
}

function myName(name) {
    return `my ${name.replace(/^(?:the|a|an|some|my)\s+/iu, '')}`;
}

/**
 * The player's move for a trade button, written as a turn for the story to
 * narrate: nothing changes hands until the reply shows it.
 */
export function tradeAction(act, partner, item = null, offered = null) {
    const who = partner?.name || 'them';
    const thing = item ? theName(item.name) : '';
    switch (act) {
    case 'buy': return `Buy ${thing} from ${who} for ${item.price}.`;
    case 'service': return `Buy ${item.name} from ${who} for ${item.price}${item.per ? ` ${item.per}` : ''}.`;
    case 'ask': return `Ask ${who} what they want for ${thing}.`;
    case 'sell': return `Offer to sell ${myName(item.name)} to ${who}${item.value ? ` for ${item.value}` : ''}.`;
    case 'swap': return `Offer ${who} ${myName(offered.name)} in trade for ${thing}.`;
    case 'take': return `Take ${thing} from ${who}.`;
    case 'search': return `Search ${who}.`;
    case 'strip': return `Take everything of use from ${who}.`;
    default: return '';
    }
}

/**
 * The game action a trade button stands for, for the game system to apply
 * when the sentence is sent. Asking, searching and stripping a body are the
 * story's to tell, so they carry no action.
 */
export function tradePanelAction(act, partner, item = null, offered = null) {
    if (!partner || !item) return null;
    switch (act) {
    case 'buy':
    case 'service': return { kind: 'buy', item: item.name, person: partner.name, price: item.price || null, quantity: 1 };
    case 'sell': return { kind: 'sell', item: item.name, person: partner.name, price: item.value || null, quantity: 1 };
    case 'swap': return offered ? { kind: 'swap', item: item.name, offer: offered.name, person: partner.name } : null;
    case 'take': return { kind: 'take', item: item.name, person: partner.name, quantity: 1 };
    default: return null;
    }
}

function tradeRow(item, actions, side = item.price || item.value) {
    return `<li class="il-game-row il-trade-row">
        <span class="il-game-main"><b>${escapeHtml(item.name)}</b>${item.quantity > 1 ? `<span class="il-game-qty">×${item.quantity}</span>` : ''}${item.description ? `<small>${escapeHtml(item.description)}</small>` : ''}${side ? `<small class="il-trade-price">${escapeHtml(side)}</small>` : ''}</span>
        <span class="il-trade-actions">${actions.map(([act, label, quiet]) => `<button type="button" class="il-trade-act${quiet ? ' is-quiet' : ''}" data-act="${act}" data-key="${escapeHtml(item.key)}">${escapeHtml(label)}</button>`).join('')}</span>
    </li>`;
}

/** One partner's page of the trade screen. `swapFor` is their item the player is choosing an offer for. */
export function renderTradePartner(overview, partner, { swapFor = null } = {}) {
    const empty = text => `<p class="il-game-empty">${escapeHtml(text)}</p>`;
    if (!partner) return empty('Nobody here to trade with, and nothing to loot.');
    if (partner.kind === 'body') {
        return `<p class="il-trade-meta">${escapeHtml(partner.cause ? `Dead: ${partner.cause}.` : 'Dead.')} What they carried is still on them.</p>
            <div class="il-trade-wide"><button type="button" class="il-trade-act" data-act="search">Search the body</button>${partner.wares.length ? '<button type="button" class="il-trade-act is-quiet" data-act="strip">Take everything</button>' : ''}</div>
            <div class="il-game-section">Visible on the body</div>
            ${partner.wares.length ? `<ul class="il-game-list">${partner.wares.map(item => tradeRow(item, [['take', 'Take']])).join('')}</ul>` : empty('Nothing can be seen without searching.')}`;
    }
    const swap = swapFor ? partner.wares.find(item => item.key === swapFor) : null;
    const wares = partner.wares.length
        ? `<ul class="il-game-list">${partner.wares.map(item => tradeRow(item, [
            item.price ? ['buy', 'Buy'] : ['ask', 'Ask price'],
            ['swap', 'Swap', true],
        ])).join('')}</ul>`
        : empty(`${partner.name} shows nothing for sale.`);
    const services = partner.services.length
        ? `<div class="il-game-section">Services and goods</div><ul class="il-game-list">${partner.services.map(item => tradeRow(item, [['service', 'Buy']], `${item.price}${item.per ? ` ${item.per}` : ''}`)).join('')}</ul>`
        : '';
    const mine = overview.mine.length
        ? `<ul class="il-game-list">${overview.mine.map(item => tradeRow(item, swap ? [['offer', 'Offer this']] : [['sell', 'Sell', true]])).join('')}</ul>`
        : empty('You carry nothing to sell.');
    return `<p class="il-trade-meta">${escapeHtml(partner.coin ? `${partner.name} carries ${partner.coin}.` : `How much coin ${partner.name} has is not known.`)}</p>
        <div class="il-game-section">Their wares</div>${wares}${services}
        ${swap ? `<div class="il-trade-note"><span>Choose what to offer for ${escapeHtml(theName(swap.name))}.</span><button type="button" class="il-trade-act is-quiet" data-act="cancel">Cancel</button></div>` : ''}
        <div class="il-game-section">Your things</div>${mine}`;
}

export function createTradePanel({ onAction } = {}) {
    let overlay = null;
    let body = null;
    let last = null;
    let partnerName = '';
    let swapFor = null;

    const close = () => overlay?.classList.add('displayNone');
    const partner = () => last?.partners.find(entry => entry.name === partnerName) || last?.partners[0] || null;
    const ensure = () => {
        ensureStyles();
        if (overlay) return;
        overlay = document.createElement('div');
        overlay.id = 'il_trade_overlay';
        overlay.className = 'il-screen displayNone';
        overlay.setAttribute('role', 'dialog');
        overlay.setAttribute('aria-label', 'Trade');
        overlay.innerHTML = `
            <div class="il-game-panel">
                <div class="il-game-head">
                    <button type="button" class="il-game-close" aria-label="Back to the story" title="Back to the story">${ICON.back}</button>
                    <div class="il-game-title"><span class="il-game-kicker">Trade</span><h3></h3></div>
                </div>
                <div class="il-trade-partners" role="tablist" aria-label="Who to trade with"></div>
                <div class="il-game-body"></div>
            </div>`;
        document.body.appendChild(overlay);
        body = overlay.querySelector('.il-game-body');
        overlay.addEventListener('click', event => {
            if (event.target.closest('.il-game-close')) return close();
            const chip = event.target.closest('[data-partner]');
            if (chip) {
                partnerName = chip.dataset.partner;
                swapFor = null;
                return paint();
            }
            const button = event.target.closest('[data-act]');
            if (!button) return;
            const current = partner();
            const act = button.dataset.act;
            const key = button.dataset.key;
            if (act === 'cancel') {
                swapFor = null;
                return paint();
            }
            if (act === 'swap') {
                swapFor = key;
                return paint();
            }
            const theirs = current?.wares.find(item => item.key === key) || current?.services?.find(item => item.key === key) || null;
            const mine = last.mine.find(item => item.key === key) || null;
            const wanted = act === 'offer' ? current.wares.find(item => item.key === swapFor) : null;
            const text = act === 'offer'
                ? tradeAction('swap', current, wanted, mine)
                : tradeAction(act, current, act === 'sell' ? mine : theirs);
            if (!text) return;
            const action = tradePanelAction(act === 'offer' ? 'swap' : act, current, act === 'sell' ? mine : (wanted || theirs), mine);
            swapFor = null;
            close();
            onAction?.(text, action);
        });
        overlay.addEventListener('keydown', event => {
            if (event.key === 'Escape') close();
        });
    };
    const paint = () => {
        if (!overlay || !last) return;
        const current = partner();
        partnerName = current?.name || '';
        overlay.querySelector('.il-game-title h3').textContent = last.purse;
        overlay.querySelector('.il-trade-partners').innerHTML = last.partners.map(entry => (
            `<button type="button" class="il-trade-partner${entry.kind === 'body' ? ' is-body' : ''}${entry.name === partnerName ? ' is-active' : ''}" role="tab" data-partner="${escapeHtml(entry.name)}">${escapeHtml(entry.name)}</button>`
        )).join('');
        body.innerHTML = renderTradePartner(last, current, { swapFor });
    };
    return {
        open() {
            ensure();
            swapFor = null;
            overlay.classList.remove('displayNone');
            paint();
            overlay.querySelector('.il-game-close').focus({ preventScroll: true });
        },
        refresh(store, scene, playerName) {
            last = tradeOverview(normalizeGameState(store?.game), {
                place: scenePlace(store, scene),
                present: (scene?.participants || []).map(person => person.name),
                playerName,
            });
            if (overlay && !overlay.classList.contains('displayNone')) paint();
        },
        isOpen: () => Boolean(overlay && !overlay.classList.contains('displayNone')),
        close,
    };
}
