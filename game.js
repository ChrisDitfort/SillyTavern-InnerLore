/**
 * InnerLore game layer: money, possessions and where every tracked object
 * is, prices, how each person regards the player, reputation with groups,
 * and the scenes the planner prepares ahead of the narrator.
 *
 * State is an append-only journal of normalized operations, each tagged with
 * the message it came from. The visible state is always the replay of that
 * journal, so the state before any message (a swipe, an edit) is rebuilt
 * exactly instead of guessed from the latest values.
 *
 * Pure module: no SillyTavern or DOM dependencies.
 */

import {
    canonicalNameKey,
    clamp,
    cleanString,
    cleanTextMentions,
    clipAtBoundary,
    normalizeEntityType,
    normalizeName,
    resolveLocationReference,
    shortCharacterReferences,
    uniqueStrings,
} from './core.js?v=48';

export const GAME_VERSION = 1;

export const ITEM_KINDS = Object.freeze([
    'weapon', 'armor', 'tool', 'clothing', 'food', 'drink', 'medicine', 'document', 'key',
    'container', 'valuable', 'trade_good', 'material', 'curio', 'mount', 'vehicle', 'body', 'other',
]);
export const PRICE_KINDS = Object.freeze(['item', 'food', 'drink', 'lodging', 'service', 'transport', 'fee', 'other']);
export const REPUTATION_KINDS = Object.freeze(['faction', 'organization', 'place', 'people', 'other']);
const REMOVAL_REASONS = new Set(['consumed', 'destroyed', 'lost']);
const ITEM_KIND_SET = new Set(ITEM_KINDS);
const PRICE_KIND_SET = new Set(PRICE_KINDS);
const REPUTATION_KIND_SET = new Set(REPUTATION_KINDS);
const MOVE_VERBS = new Set(['take', 'drop', 'give', 'put', 'steal', 'buy', 'sell', 'trade', 'loot', 'find', 'throw', 'hide', 'carry', 'lend', 'return', 'move']);

const MAX_JOURNAL_ENTRIES = 4_000;
const JOURNAL_COMPACT_TO = 2_500;
const MAX_NOTES = 12;
const MAX_ITEM_HISTORY = 12;
const SCORE_LIMIT = 100;
/** Largest single change to a standing or reputation. Ordinary beats move a few points. */
export const MAX_SCORE_DELTA = 25;
const MAX_QUANTITY = 1_000_000;
const MAX_AMOUNT = 1_000_000_000_000;

const PLAYER_WORDS = new Set(['player', 'you', 'me', 'myself', 'the player', 'player character', 'pc', 'self', 'yourself']);
const WORLD_WORDS = new Set(['world', 'nobody', 'no one', 'none', 'unknown', 'ground', 'found', 'nowhere']);

export const DEFAULT_CURRENCY = Object.freeze({
    name: 'coin',
    units: Object.freeze([Object.freeze({ name: 'coin', plural: 'coins', value: 1 })]),
});

// Relationship standing: how one person regards the player.
const STANDING_TIERS = [
    [60, 'close'], [25, 'friendly'], [8, 'warm'], [-7, 'neutral'], [-24, 'wary'], [-59, 'unfriendly'], [-Infinity, 'hostile'],
];
// Reputation: how a group, place or people regards the player.
const REPUTATION_TIERS = [
    [60, 'honoured'], [25, 'respected'], [8, 'liked'], [-7, 'neutral'], [-24, 'disliked'], [-59, 'distrusted'], [-Infinity, 'reviled'],
];

export function standingTier(score) {
    const value = Number(score) || 0;
    return STANDING_TIERS.find(([floor]) => value >= floor)[1];
}

export function reputationTier(score) {
    const value = Number(score) || 0;
    return REPUTATION_TIERS.find(([floor]) => value >= floor)[1];
}

function signed(value) {
    const number = Math.round(Number(value) || 0);
    return number > 0 ? `+${number}` : String(number);
}

/** lower_snake_case key for an item, price or stage. */
export function gameKey(value) {
    return canonicalNameKey(value).replace(/\s+/gu, '_').slice(0, 80);
}

/** "the lean sailor", "Lean Sailor" and "lean sailor" are one key. */
function nameKey(value) {
    return canonicalNameKey(value).replace(/^(?:the|a|an)\s+/u, '');
}

const NAME_FILLER = new Set(['a', 'an', 'the', 'of', 'and', 'for', 'per', 'with', 'to', 'in', 'on', 'at', 'some', 'one', 's']);

function contentWords(value) {
    return new Set(canonicalNameKey(value).split(' ')
        .map(word => word.replace(/(?:es|s)$/u, ''))
        .filter(word => word.length > 1 && !NAME_FILLER.has(word)));
}

/** "ale" and "a tankard of ale", "bed under the eaves" and "a night's bed under the eaves". */
function wordsContained(a, b) {
    const small = a.size <= b.size ? a : b;
    const large = small === a ? b : a;
    return small.size > 0 && [...small].every(word => large.has(word));
}

/** The last content word of a name: "leather courier's satchel" is a satchel. */
function headNoun(value) {
    const words = canonicalNameKey(value).split(' ').map(word => word.replace(/(?:es|s)$/u, '')).filter(word => word.length > 1 && !NAME_FILLER.has(word));
    return words.at(-1) || '';
}

/** A place's key without a leading article: "the Old Quay" is "Old Quay". */
function placeNameKey(value) {
    return canonicalNameKey(value).replace(/^(?:the|a|an)\s+/u, '');
}

function placeKey(value) {
    return placeNameKey(value).replace(/\s+/gu, '_').slice(0, 80);
}

/** The reputation record a group name means: exact, article-free, or the one closest by words. */
function findGroup(reputation, name) {
    const wanted = placeNameKey(name);
    if (!wanted) return null;
    const records = Object.values(reputation || {});
    const exact = records.find(record => placeNameKey(record.name) === wanted);
    if (exact) return exact;
    const words = contentWords(name);
    const close = records
        .map(record => {
            const theirs = contentWords(record.name);
            if (!wordsContained(theirs, words)) return null;
            const shared = [...theirs].filter(word => words.has(word)).length;
            return { record, overlap: shared / (theirs.size + words.size - shared) };
        })
        .filter(match => match && match.overlap >= 0.5)
        .sort((a, b) => b.overlap - a.overlap);
    // "Port Vell fishermen" is the "Port Vell Harbour fishermen", not "Port Vell".
    return close.length && (close.length === 1 || close[0].overlap > close[1].overlap) ? close[0].record : null;
}

/** A prepared person's own lean; older stages stored it as an absolute standing. */
function leanOf(person) {
    if (Number.isFinite(person?.lean)) return person.lean;
    return Number.isFinite(person?.standing) ? person.standing : null;
}

/**
 * How a prepared person regards the player on meeting them: their group's
 * reputation as it stands now, shifted by their own lean. Null when the
 * person has neither a known group nor a lean.
 */
export function firstImpression(state, person) {
    const lean = leanOf(person);
    const group = person?.group ? findGroup(state?.reputation, person.group) : null;
    if (!group && lean === null) return null;
    return { score: clamp((group?.score || 0) + (lean || 0), -SCORE_LIMIT, SCORE_LIMIT), lean: lean || 0, group };
}

function impressionReason(impression) {
    if (!impression.group) return 'first impression (prepared by the planner)';
    const { group, lean } = impression;
    const temper = lean > 0 ? `, warmer by nature (${signed(lean)})` : lean < 0 ? `, cooler by nature (${signed(lean)})` : '';
    return `first impression: shares ${group.name}'s view (${reputationTier(group.score)}, ${signed(group.score)})${temper}`;
}

// --- state -----------------------------------------------------------------

const DERIVED_FIELDS = Object.freeze(['currency', 'purse', 'items', 'prices', 'standings', 'reputation', 'stages', 'purses', 'dead']);

function emptyDerived() {
    return {
        currency: null,
        // amount null: never established. minimum: only a lower bound is known.
        purse: { amount: null, minimum: false, since: -1 },
        items: {},
        prices: {},
        standings: {},
        reputation: {},
        stages: {},
        // The coin other people carry, by person. amount null: never established.
        purses: {},
        // Who has died: where, how, and the key of their body.
        dead: {},
    };
}

function cloneValue(value) {
    if (value === undefined) return undefined;
    return typeof structuredClone === 'function' ? structuredClone(value) : JSON.parse(JSON.stringify(value));
}

export function createGameState() {
    return {
        version: GAME_VERSION,
        ...emptyDerived(),
        journal: [],
        // A compacted prefix of the journal, folded into a snapshot.
        base: null,
        sequence: 0,
        derivedSequence: 0,
        lastProcessedIndex: -1,
        processedFingerprints: {},
        // The newest message already scanned for prepared people and objects.
        introducedThrough: -1,
        lastRunStats: null,
        lastError: '',
        planner: { lastRunIndex: -1, kitOffered: false, lastRunStats: null, lastError: '' },
    };
}

function validEntry(entry) {
    return entry && typeof entry === 'object'
        && Number.isInteger(entry.seq)
        && Number.isInteger(entry.at)
        && entry.op && typeof entry.op === 'object'
        && typeof entry.op.type === 'string';
}

function replay(base, journal, boundary = Number.POSITIVE_INFINITY) {
    const derived = base?.derived ? cloneValue(base.derived) : emptyDerived();
    for (const field of DERIVED_FIELDS) if (derived[field] === undefined) derived[field] = emptyDerived()[field];
    for (const entry of journal) {
        if (entry.at >= boundary) continue;
        reduceEntry(derived, entry);
    }
    return derived;
}

export function normalizeGameState(value) {
    const fresh = createGameState();
    if (!value || typeof value !== 'object') return fresh;
    const state = { ...fresh, ...value };
    state.version = GAME_VERSION;
    state.journal = Array.isArray(value.journal) ? value.journal.filter(validEntry) : [];
    state.base = value.base && typeof value.base === 'object' && value.base.derived && typeof value.base.derived === 'object'
        ? value.base
        : null;
    state.sequence = Math.max(
        Number.isInteger(value.sequence) ? value.sequence : 0,
        state.base?.seq || 0,
        ...state.journal.map(entry => entry.seq),
    );
    state.lastProcessedIndex = Number.isInteger(value.lastProcessedIndex) ? value.lastProcessedIndex : -1;
    state.introducedThrough = Number.isInteger(value.introducedThrough) ? value.introducedThrough : -1;
    state.processedFingerprints = value.processedFingerprints && typeof value.processedFingerprints === 'object'
        ? value.processedFingerprints
        : {};
    state.planner = {
        ...fresh.planner,
        ...(value.planner && typeof value.planner === 'object' ? value.planner : {}),
    };
    state.lastError = cleanString(value.lastError, 1_000);
    // The visible state is the journal's replay. Trust a saved copy only
    // when it was derived from exactly this journal.
    const savedIsCurrent = value.derivedSequence === state.sequence
        && DERIVED_FIELDS.every(field => value[field] && typeof value[field] === 'object');
    if (!savedIsCurrent) {
        Object.assign(state, replay(state.base, state.journal));
        state.derivedSequence = state.sequence;
    }
    return state;
}

/**
 * A state ready to read. A current one is used as it is; anything else,
 * including a save from before a derived field existed, is normalized.
 */
function readableState(value) {
    return value?.journal && DERIVED_FIELDS.every(field => value[field] && typeof value[field] === 'object')
        ? value
        : normalizeGameState(value);
}

/**
 * The game as it stood before message `boundary`: every operation recorded
 * from that message on is left out. Used for a reswipe, which must not see
 * purchases or moves from the reply it replaces, and for rebuilds.
 * `keepSources` keeps only entries from those sources (a manual rebuild keeps
 * the planner's material and re-reads every reply).
 */
export function gameStateBefore(value, boundary, options = {}) {
    const state = normalizeGameState(cloneValue(value));
    const limit = Number.isFinite(boundary) ? boundary : Number.POSITIVE_INFINITY;
    const keep = Array.isArray(options.keepSources) ? new Set(options.keepSources) : null;
    state.journal = state.journal.filter(entry => entry.at < limit && (!keep || keep.has(entry.source)));
    if (keep && !keep.has('ledger')) {
        state.lastProcessedIndex = -1;
        state.processedFingerprints = {};
    }
    Object.assign(state, replay(state.base, state.journal));
    state.sequence = Math.max(state.base?.seq || 0, ...state.journal.map(entry => entry.seq), 0);
    state.derivedSequence = state.sequence;
    state.lastProcessedIndex = Math.min(state.lastProcessedIndex, limit - 1);
    state.processedFingerprints = Object.fromEntries(Object.entries(state.processedFingerprints || {})
        .filter(([index]) => Number(index) < limit));
    state.introducedThrough = Math.min(state.introducedThrough, limit - 1);
    state.planner = { ...state.planner, lastRunIndex: Math.min(state.planner.lastRunIndex ?? -1, limit - 1) };
    return state;
}

function compactJournal(state) {
    if (state.journal.length <= MAX_JOURNAL_ENTRIES) return;
    const fold = state.journal.slice(0, state.journal.length - JOURNAL_COMPACT_TO);
    const keep = state.journal.slice(fold.length);
    state.base = {
        at: fold.at(-1).at,
        seq: fold.at(-1).seq,
        derived: replay(state.base, fold),
    };
    state.journal = keep;
}

// --- money -----------------------------------------------------------------

export function normalizeCurrency(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const units = (Array.isArray(raw.units) ? raw.units : [])
        .map(unit => ({
            name: normalizeName(unit?.name).slice(0, 60),
            plural: normalizeName(unit?.plural).slice(0, 60),
            abbreviation: normalizeName(unit?.abbreviation ?? unit?.abbr).slice(0, 8),
            value: Number(unit?.value),
        }))
        .filter(unit => unit.name && Number.isFinite(unit.value) && unit.value > 0);
    if (!units.length) {
        const single = normalizeName(raw.name);
        return single ? { name: single, units: [{ name: single, plural: '', abbreviation: '', value: 1 }] } : null;
    }
    // Whole-number values with the smallest unit worth 1.
    const smallest = Math.min(...units.map(unit => unit.value));
    const seen = new Set();
    const normalized = units
        .map(unit => ({ ...unit, value: Math.max(1, Math.round(unit.value / smallest)) }))
        .sort((a, b) => b.value - a.value)
        .filter(unit => {
            const key = nameKey(unit.name);
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        })
        .slice(0, 6);
    return { name: normalizeName(raw.name).slice(0, 60) || normalized.at(-1).name, units: normalized };
}

function unitPlural(unit) {
    if (unit.plural) return unit.plural;
    const name = unit.name;
    if (/(?:s|x|ch|sh)$/iu.test(name)) return `${name}es`;
    if (/[^aeiou]y$/iu.test(name)) return `${name.slice(0, -1)}ies`;
    return `${name}s`;
}

function findUnit(token, currency) {
    const wanted = nameKey(token);
    if (!wanted) return null;
    const units = (currency || DEFAULT_CURRENCY).units;
    const exact = units.find(unit => [unit.name, unit.plural, unitPlural(unit), unit.abbreviation]
        .filter(Boolean)
        .some(label => nameKey(label) === wanted));
    if (exact) return exact;
    const singular = wanted.replace(/(?:es|s)$/u, '');
    const loose = units.find(unit => {
        const words = nameKey(unit.name).split(' ');
        return words.includes(wanted) || words.includes(singular) || nameKey(unit.name).startsWith(singular);
    });
    if (loose) return loose;
    // gp / sp / cp style shorthand.
    if (/^[a-z]p$/u.test(wanted)) return units.find(unit => nameKey(unit.name).startsWith(wanted[0])) || null;
    return null;
}

/**
 * An amount in the currency's smallest unit. Accepts a number with a unit
 * ("3", "silver"), a phrase ("2 silver 3 copper", "1 gold crown"), or a bare
 * number in the smallest unit. Returns null when nothing usable is given.
 */
export function parseMoney(value, unit, currency) {
    const active = currency?.units?.length ? currency : DEFAULT_CURRENCY;
    if (typeof value === 'number' && Number.isFinite(value)) {
        const found = unit ? findUnit(unit, active) : null;
        if (unit && !found) return null;
        const amount = Math.round(value * (found?.value || 1));
        return amount >= 0 && amount <= MAX_AMOUNT ? amount : null;
    }
    const text = cleanString(String(value ?? ''), 200).toLocaleLowerCase();
    if (!text) return null;
    let total = 0;
    let matched = false;
    const pattern = /(\d+(?:[.,]\d+)?)\s*([\p{L}][\p{L}'’ -]*?)(?=\s*(?:\d|,|and\b|&|$))/gu;
    for (const match of text.matchAll(pattern)) {
        const found = findUnit(match[2].trim(), active);
        if (!found) continue;
        total += Number(match[1].replace(',', '.')) * found.value;
        matched = true;
    }
    if (!matched) {
        const bare = Number(text.replace(/[^\d.]/gu, ''));
        if (!/\d/u.test(text) || !Number.isFinite(bare)) return null;
        const found = unit ? findUnit(unit, active) : null;
        total = bare * (found?.value || 1);
    }
    const amount = Math.round(total);
    return amount >= 0 && amount <= MAX_AMOUNT ? amount : null;
}

/** "3 silver, 4 copper" for an amount in the smallest unit. */
export function formatMoney(amount, currency) {
    const active = currency?.units?.length ? currency : DEFAULT_CURRENCY;
    let remaining = Math.max(0, Math.round(Number(amount) || 0));
    if (!remaining) return 'nothing';
    const parts = [];
    for (const unit of active.units) {
        const count = Math.floor(remaining / unit.value);
        if (!count) continue;
        remaining -= count * unit.value;
        parts.push(`${count} ${count === 1 ? unit.name : unitPlural(unit)}`);
    }
    return parts.join(', ');
}

// --- holders -----------------------------------------------------------------

function holderKey(holder) {
    if (!holder) return '';
    if (holder.kind === 'player') return 'player';
    if (holder.kind === 'item') return `item:${holder.key}`;
    return `${holder.kind}:${holder.id || nameKey(holder.name)}`;
}

function sameHolder(a, b) {
    return holderKey(a) === holderKey(b);
}

function holderSlug(holder) {
    if (!holder) return 'nowhere';
    if (holder.kind === 'player') return 'player';
    if (holder.kind === 'item') return holder.key;
    return gameKey(holder.name) || holder.kind;
}

/** A short label: "you", "Mara Quell", "Salt Lantern (behind the bar)". */
export function holderLabel(holder, place = '', playerLabel = 'you') {
    if (!holder) return 'unknown';
    const base = holder.kind === 'player' ? playerLabel : holder.name || holder.key || 'unknown';
    const spot = cleanString(place, 120);
    if (holder.kind === 'item') return `in ${base}${spot ? ` (${spot})` : ''}`;
    return spot ? `${base} (${spot})` : base;
}

/**
 * Resolve a holder phrase from a model to a canonical holder. The context
 * carries the player identity, the lore entities, and the current state.
 */
export function resolveHolder(raw, context = {}) {
    const hint = raw && typeof raw === 'object' ? cleanString(raw.kind, 20).toLocaleLowerCase() : '';
    const text = normalizeName(raw && typeof raw === 'object' ? (raw.name ?? raw.key ?? '') : raw);
    if (!text) return null;
    const key = nameKey(text);
    if (WORLD_WORDS.has(key)) return { kind: 'world', name: 'the world' };
    if (hint === 'player' || PLAYER_WORDS.has(key) || (context.playerKeys || new Set()).has(key)) {
        return { kind: 'player', name: context.playerName || 'Player' };
    }
    const items = context.items || {};
    const active = item => (item?.status === 'active' ? item : null);
    const itemByKey = active(items[gameKey(text)]);
    const itemByName = () => Object.values(items).find(item => item.status === 'active' && nameKey(item.name) === key) || null;
    if (hint === 'item') {
        const item = itemByKey || itemByName();
        return item ? { kind: 'item', key: item.key, name: item.name } : null;
    }
    if (itemByKey && !hint) return { kind: 'item', key: itemByKey.key, name: itemByKey.name };
    const entities = context.entities || {};
    if (hint !== 'location') {
        const person = findPerson(entities, text);
        if (person) return { kind: 'character', name: person.name, id: person.id };
        const planned = plannedPeople(context.stages).find(person => nameKey(person.name) === key);
        if (planned) return { kind: 'character', name: planned.name };
        if (hint === 'character') return { kind: 'character', name: text };
    }
    const location = resolveLocationReference(entities, text);
    const exactPlace = location && [location.name, ...(location.aliases || [])].some(name => nameKey(name) === key);
    if (exactPlace) return { kind: 'location', name: location.name, id: location.id };
    if (!hint) {
        const item = itemByName();
        if (item) return { kind: 'item', key: item.key, name: item.name };
    }
    if (location) return { kind: 'location', name: location.name, id: location.id };
    const stage = context.stages?.[placeKey(text)];
    if (stage) return { kind: 'location', name: stage.place, ...(stage.placeId ? { id: stage.placeId } : {}) };
    // An unrecorded place.
    return { kind: hint === 'location' ? 'location' : 'place', name: text };
}

/** A known person by full name or alias, then by an unambiguous given name or surname ("Mara"). */
function findPerson(entities, name) {
    const key = nameKey(name);
    if (!key) return null;
    const people = Object.values(entities || {}).filter(record => (
        ['character', 'creature'].includes(normalizeEntityType(record?.type)) && record.enabled !== false
    ));
    const exact = people.find(record => [record.name, ...(record.aliases || [])].some(candidate => nameKey(candidate) === key));
    if (exact) return exact;
    const characters = people.filter(record => normalizeEntityType(record.type) === 'character');
    const short = people.filter(record => shortCharacterReferences(record, characters).some(reference => nameKey(reference) === key));
    return short.length === 1 ? short[0] : null;
}

function plannedPeople(stages) {
    return Object.values(stages || {}).flatMap(stage => stage.people || []);
}

// Roles a place has one of. The planner may not prepare a second innkeeper
// for an inn whose landlady the story has shown, nor a second old man by the fire.
const SINGULAR_ROLES = [
    ['innkeeper', ['innkeeper', 'inn keeper', 'landlord', 'landlady', 'proprietor', 'proprietress', 'host', 'hostess', 'barkeep', 'barkeeper', 'barman', 'barmaid', 'tapster', 'publican', 'taverner', 'tavern keeper', 'alewife']],
    ['harbour master', ['harbour master', 'harbourmaster', 'harbormaster', 'harbor master', 'port master', 'portmaster', 'dockmaster', 'dock master', 'wharfinger']],
    ['captain', ['captain', 'skipper', 'shipmaster', 'ship master']],
    ['priest', ['priest', 'priestess', 'cleric', 'chaplain', 'vicar', 'abbot', 'abbess', 'curate', 'parson']],
    ['smith', ['blacksmith', 'smith', 'farrier', 'armourer', 'armorer']],
    ['healer', ['healer', 'physician', 'doctor', 'surgeon', 'apothecary', 'herbalist', 'midwife']],
    ['cook', ['cook', 'chef']],
    ['elder', ['old man', 'old woman', 'elder', 'greybeard', 'old sailor', 'old fisherman', 'old regular', 'old salt', 'old timer', 'elderly man', 'elderly woman', 'elderly sailor', 'elderly patron', 'elderly regular', 'old patron']],
    ['shopkeeper', ['shopkeeper', 'storekeeper', 'chandler', 'grocer']],
    ['steward', ['steward', 'butler', 'majordomo', 'housekeeper']],
    ['constable', ['constable', 'sheriff', 'bailiff', 'magistrate', 'watch captain', 'captain of the watch', 'sergeant of the watch']],
];

/** The singular role a role label or description names, or ''. A single word must be the head ("ship's captain", not "captain's clerk"). */
export function singularRoleOf(text) {
    const key = canonicalNameKey(text);
    if (!key) return '';
    for (const [group, words] of SINGULAR_ROLES) {
        for (const word of words) {
            const w = canonicalNameKey(word);
            const hit = w.includes(' ') ? ` ${key} `.includes(` ${w} `) : (key === w || key.endsWith(` ${w}`));
            if (hit) return group;
        }
    }
    return '';
}

export function relatedPlaces(a, b, entities) {
    const ka = placeKey(a);
    const kb = placeKey(b);
    if (!ka || !kb) return false;
    if (ka === kb || ka.includes(kb) || kb.includes(ka)) return true;
    const parentOf = name => placeKey(resolveLocationReference(entities, name)?.parentLocationName || '');
    return parentOf(a) === kb || parentOf(b) === ka;
}

/** Known people at (or described with) this place, with the singular role each holds. */
export function singularRolesHeldAt(place, entities) {
    // The place and the place it is part of: the Common Room's innkeeper is the Salt Lantern's.
    // placeKey gives a slug (salt_lantern); the text checks need the phrase.
    const keys = [placeKey(place), placeKey(resolveLocationReference(entities, place)?.parentLocationName || '')].filter(Boolean).map(key => key.replace(/_/gu, ' '));
    const held = [];
    for (const record of Object.values(entities || {})) {
        if (!['character', 'creature'].includes(normalizeEntityType(record?.type)) || record.enabled === false || record.player) continue;
        const text = ` ${canonicalNameKey(`${record.summary || ''} ${record.description || ''} ${record.currentState || ''}`)} `;
        const here = relatedPlaces(record.currentLocationName, place, entities) || keys.some(key => text.includes(` ${key} `));
        if (!here) continue;
        let group = singularRoleOf(text);
        // "The woman who runs the Salt Lantern" keeps the place without a title.
        if (!group && keys.some(key => new RegExp(`\\b(?:runs|keeps|manages|owns)\\s+(?:the\\s+)?${key.replace(/\s+/gu, '\\s+')}\\b`, 'iu').test(text))) group = 'innkeeper';
        if (group) held.push({ group, name: record.name });
    }
    return held;
}

// --- operations ----------------------------------------------------------------

function itemRecord(op, at) {
    return {
        key: op.key,
        baseKey: op.baseKey || op.key,
        name: op.name,
        kind: op.kind || 'other',
        quantity: op.quantity ?? 1,
        value: op.value ?? null,
        holder: op.holder,
        place: op.place || '',
        owner: op.owner || '',
        condition: op.condition || '',
        description: op.description || '',
        price: op.price ?? null,
        seller: op.seller || '',
        hidden: Boolean(op.hidden),
        planned: Boolean(op.planned),
        stage: op.stage || '',
        status: 'active',
        since: at,
        firstSeen: at,
        history: [],
    };
}

const ITEM_FACT_FIELDS = Object.freeze(['name', 'kind', 'value', 'condition', 'description', 'owner', 'price', 'seller', 'place', 'hidden']);

function mergeSupplied(target, op, fields = ITEM_FACT_FIELDS) {
    for (const field of fields) {
        const value = op[field];
        if (value === undefined || value === null || value === '') continue;
        target[field] = value;
    }
}

function pushHistory(item, entry) {
    item.history = [...(item.history || []), entry].slice(-MAX_ITEM_HISTORY);
}

function pushNote(record, note) {
    record.notes = [...(record.notes || []), note].slice(-MAX_NOTES);
}

function findStack(items, baseKey, holder) {
    return Object.values(items).find(item => item.status === 'active'
        && (item.baseKey || item.key) === baseKey
        && sameHolder(item.holder, holder));
}

function stackKey(items, baseKey, holder) {
    const key = `${baseKey}@${holderSlug(holder)}`;
    if (!items[key]) return key;
    for (let suffix = 2; suffix < 1_000; suffix++) if (!items[`${key}_${suffix}`]) return `${key}_${suffix}`;
    return `${key}_${Date.now()}`;
}

/** Whether an item is on the player, directly or inside something they carry. */
export function isCarried(items, item, depth = 0) {
    if (!item || item.status !== 'active' || depth > 6) return false;
    if (item.holder?.kind === 'player') return true;
    if (item.holder?.kind === 'item') return isCarried(items, items[item.holder.key], depth + 1);
    return false;
}

function rootHolder(items, item, depth = 0) {
    if (!item || depth > 6) return null;
    if (item.holder?.kind === 'item') return rootHolder(items, items[item.holder.key], depth + 1) || item.holder;
    return item.holder;
}

/** The key of the body an item lies on, directly or in a container on it. */
function bodyHolding(items, item, depth = 0) {
    if (!item || depth > 6 || item.holder?.kind !== 'item') return null;
    const holder = items[item.holder.key];
    if (holder?.bodyOf) return holder.key;
    return bodyHolding(items, holder, depth + 1);
}

function personPurse(derived, name, at) {
    const key = nameKey(name);
    return derived.purses[key] ??= { key, name, amount: null, minimum: false, since: at, updated: at };
}

/**
 * Apply one journal entry to the derived state. Every state-dependent rule
 * (a payment capped by the purse, a split stack) lives here, so a replay of
 * the same journal always lands on the same state.
 */
function reduceEntry(derived, entry) {
    const { op, at } = entry;
    const items = derived.items;
    switch (op.type) {
    case 'currency.set':
        derived.currency = op.currency;
        return { ok: true };
    case 'purse.set':
        derived.purse = { amount: op.amount, minimum: false, since: at };
        return { ok: true };
    case 'money': {
        const purse = derived.purse;
        let shortfall = 0;
        if (op.from?.kind === 'player') {
            if (purse.amount === null) {
                // Never counted: the payment happened, the total stays unknown.
                purse.spent = (purse.spent || 0) + op.amount;
            } else {
                if (op.amount > purse.amount) {
                    if (!purse.minimum) shortfall = op.amount - purse.amount;
                    purse.minimum = false;
                }
                purse.amount = Math.max(0, purse.amount - op.amount);
            }
        }
        if (op.to?.kind === 'player') {
            if (purse.amount === null) purse.minimum = true;
            purse.amount = (purse.amount ?? 0) + op.amount;
        }
        // Other people's coin. Paying from a purse nobody counted leaves it unknown.
        const payer = op.from?.kind === 'character' ? derived.purses[nameKey(op.from.name)] : null;
        if (payer && payer.amount !== null) {
            payer.amount = Math.max(0, payer.amount - op.amount);
            payer.updated = at;
        }
        if (op.to?.kind === 'character') {
            const payee = personPurse(derived, op.to.name, at);
            if (payee.amount === null) payee.minimum = true;
            payee.amount = (payee.amount ?? 0) + op.amount;
            payee.updated = at;
        }
        return { ok: true, shortfall, fromPlayer: op.from?.kind === 'player' };
    }
    case 'item.add': {
        const existing = items[op.key];
        if (existing && existing.status === 'active') {
            if (existing.planned) {
                // The planner re-staged it, or the ledger met it in the story:
                // keep its prepared facts and take whatever is new.
                mergeSupplied(existing, op);
                existing.holder = op.holder;
                if (op.quantity) existing.quantity = op.quantity;
                existing.planned = Boolean(op.planned);
                if (!op.planned) existing.hidden = Boolean(op.hidden);
                existing.since = at;
                return { ok: true };
            }
            if (sameHolder(existing.holder, op.holder)) {
                existing.quantity = Math.min(MAX_QUANTITY, existing.quantity + (op.quantity ?? 1));
                mergeSupplied(existing, op, ['value', 'condition', 'description', 'owner', 'price', 'seller', 'place']);
                return { ok: true };
            }
            const key = stackKey(items, existing.baseKey || existing.key, op.holder);
            items[key] = itemRecord({ ...op, key, baseKey: existing.baseKey || existing.key }, at);
            return { ok: true, key };
        }
        items[op.key] = itemRecord(op, at);
        if (existing) items[op.key].history = existing.history || [];
        return { ok: true };
    }
    case 'item.move': {
        let item = items[op.key];
        if (!item || item.status !== 'active') {
            if (!op.name) return { ok: false, reason: `unknown item ${op.key}` };
            items[op.key] = itemRecord({ ...op, holder: op.to, quantity: op.quantity ?? 1 }, at);
            pushHistory(items[op.key], { at, from: '', to: holderKey(op.to), label: op.how || 'appears', note: op.note || '' });
            return { ok: true };
        }
        item.planned = false;
        item.hidden = false;
        const moving = op.quantity && op.quantity < item.quantity ? op.quantity : item.quantity;
        const from = holderKey(item.holder);
        const fromPlayer = isCarried(items, item);
        if (moving < item.quantity) {
            item.quantity -= moving;
            const baseKey = item.baseKey || item.key;
            const target = findStack(items, baseKey, op.to);
            if (target) {
                target.quantity += moving;
                pushHistory(target, { at, from, to: holderKey(op.to), label: op.how || 'move', note: op.note || '' });
                return { ok: true, key: target.key, fromPlayer };
            }
            const key = stackKey(items, baseKey, op.to);
            items[key] = { ...cloneValue(item), key, baseKey, quantity: moving, holder: op.to, place: op.place || '', since: at, history: [] };
            if (op.how === 'buy' || op.how === 'sell') Object.assign(items[key], { price: null, seller: '' });
            pushHistory(items[key], { at, from, to: holderKey(op.to), label: op.how || 'move', note: op.note || '' });
            return { ok: true, key, fromPlayer };
        }
        item.holder = op.to;
        item.place = op.place || '';
        item.since = at;
        if (op.how === 'buy' || op.how === 'sell' || op.how === 'steal') {
            item.price = null;
            item.seller = '';
        }
        if (op.owner !== undefined) item.owner = op.owner;
        else if (op.how === 'buy' && op.to?.kind === 'player') item.owner = '';
        mergeSupplied(item, op, ['value']);
        pushHistory(item, { at, from, to: holderKey(op.to), label: op.how || 'move', note: op.note || '' });
        return { ok: true, fromPlayer };
    }
    case 'item.update': {
        const item = items[op.key];
        if (!item || item.status !== 'active') return { ok: false, reason: `unknown item ${op.key}` };
        for (const [field, value] of Object.entries(op.fields || {})) item[field] = value;
        if (op.fields?.quantity === 0) item.status = 'consumed';
        item.planned = op.fields?.planned ?? false;
        return { ok: true };
    }
    case 'item.remove': {
        const item = items[op.key];
        if (!item || item.status !== 'active') return { ok: false, reason: `unknown item ${op.key}` };
        const quantity = op.quantity && op.quantity < item.quantity ? op.quantity : item.quantity;
        const fromPlayer = isCarried(items, item);
        item.quantity -= quantity;
        item.planned = false;
        if (item.quantity <= 0) {
            item.quantity = 0;
            item.status = op.reason;
        }
        pushHistory(item, { at, from: holderKey(item.holder), to: '', label: op.reason, note: op.note || '' });
        return { ok: true, fromPlayer };
    }
    case 'price.set':
        derived.prices[op.key] = {
            key: op.key, name: op.name, kind: op.kind, amount: op.amount, per: op.per || '',
            seller: op.seller || '', place: op.place || null, since: at,
        };
        return { ok: true };
    case 'price.remove':
        if (!derived.prices[op.key]) return { ok: false, reason: `unknown price ${op.key}` };
        delete derived.prices[op.key];
        return { ok: true };
    case 'person.alias': {
        // One person under two keys (an article variant, or a descriptor the
        // story later named): fold the older records into the canonical one.
        const from = nameKey(op.from);
        const to = nameKey(op.to);
        if (!from || !to || from === to) return { ok: false, reason: 'alias needs two different people' };
        let folded = 0;
        for (const table of [derived.standings, derived.purses, derived.dead]) {
            if (!table[from]) continue;
            folded += 1;
            if (!table[to]) {
                table[to] = { ...table[from], key: to, name: op.name || table[from].name };
            } else if (table === derived.standings) {
                const keep = table[to];
                const other = table[from];
                // The later-updated record carries the score; every note survives.
                if ((other.updated ?? other.since ?? -1) > (keep.updated ?? keep.since ?? -1)) keep.score = other.score;
                keep.notes = [...(keep.notes || []), ...(other.notes || [])].sort((a, b) => (a.at ?? 0) - (b.at ?? 0)).slice(-MAX_NOTES);
                keep.group ||= other.group;
                keep.since = Math.min(keep.since ?? at, other.since ?? at);
                keep.updated = Math.max(keep.updated ?? -1, other.updated ?? -1);
            } else if (table === derived.purses && table[to].amount === null) {
                table[to] = { ...table[from], key: to, name: table[to].name };
            }
            delete table[from];
        }
        for (const item of Object.values(items)) {
            if (item.holder?.kind === 'character' && nameKey(item.holder.name) === from) { item.holder = { ...item.holder, name: op.name || op.to }; folded += 1; }
            if (item.holder?.kind === 'place' && nameKey(item.holder.name) === from) { item.holder = { kind: 'character', name: op.name || op.to }; folded += 1; }
        }
        return folded ? { ok: true } : { ok: false, reason: `nothing recorded under ${op.from}` };
    }
    case 'standing.change':
    case 'reputation.change': {
        const table = op.type === 'standing.change' ? derived.standings : derived.reputation;
        const meeting = op.type === 'standing.change' && (op.group || Number.isFinite(op.lean));
        const changes = Boolean(op.delta) || (op.set !== undefined && op.set !== null);
        // Keys from older journals carried articles; derive the key from the name.
        const key = (op.type === 'standing.change' ? nameKey(op.name) : op.key) || op.key;
        if (meeting && !changes && table[key]) return { ok: false, reason: `${op.name} already has a standing; group and lean only set a first impression` };
        let record = table[key];
        if (!record) {
            // Someone met for the first time starts from their group's view, shifted by their lean.
            const impression = meeting ? firstImpression(derived, op) : null;
            record = table[key] = {
                key, name: op.name, score: impression?.score || 0, since: at, notes: [],
                ...(op.type === 'reputation.change' ? { kind: op.kind || 'other' } : {}),
                ...(op.group ? { group: impression?.group?.name || op.group } : {}),
            };
            if (impression) {
                record.updated = at;
                pushNote(record, { at, delta: impression.score, reason: impressionReason(impression) });
            }
        } else if (op.group && !record.group) {
            record.group = op.group;
        }
        if (op.kind && op.type === 'reputation.change') record.kind = op.kind;
        if (!changes) return { ok: true };
        const before = record.score;
        record.score = clamp(op.set !== undefined && op.set !== null ? op.set : before + (op.delta || 0), -SCORE_LIMIT, SCORE_LIMIT);
        record.updated = at;
        pushNote(record, { at, delta: record.score - before, reason: op.reason || '' });
        return { ok: true };
    }
    case 'stage.set': {
        const previous = derived.stages[op.key];
        const introduced = new Map((previous?.people || [])
            .filter(person => person.introduced)
            .map(person => [nameKey(person.name), person]));
        derived.stages[op.key] = {
            key: op.key,
            place: op.place,
            placeId: op.placeId || previous?.placeId || '',
            summary: op.summary || '',
            hooks: op.hooks || [],
            people: (op.people || []).map(person => ({
                ...person,
                introduced: introduced.has(nameKey(person.name)),
                introducedAt: introduced.get(nameKey(person.name))?.introducedAt ?? null,
            })),
            preparedAt: at,
            clockSeconds: op.clockSeconds ?? null,
        };
        return { ok: true };
    }
    case 'introduce': {
        if (op.kind === 'item') {
            const item = items[op.key];
            if (!item || !item.planned) return { ok: false, reason: `no planned item ${op.key}` };
            item.planned = false;
            item.hidden = false;
            return { ok: true };
        }
        const stage = derived.stages[op.stage];
        const person = stage?.people?.find(candidate => nameKey(candidate.name) === nameKey(op.name));
        if (!person || person.introduced) return { ok: false, reason: `no planned person ${op.name}` };
        person.introduced = true;
        person.introducedAt = at;
        const key = nameKey(person.name);
        const impression = firstImpression(derived, person);
        if (impression && !derived.standings[key]) {
            derived.standings[key] = {
                key, name: person.name, score: impression.score, since: at, updated: at,
                ...(person.group ? { group: impression.group?.name || person.group } : {}),
                notes: [{ at, delta: impression.score, reason: impressionReason(impression) }],
            };
        }
        if (Number.isFinite(person.coin) && !derived.purses[key]) {
            derived.purses[key] = { key, name: person.name, amount: person.coin, minimum: false, since: at, updated: at };
        }
        // What they carry comes into the story with them; tucked-away things stay hidden.
        for (const item of Object.values(items)) {
            if (item.status === 'active' && item.planned && item.holder?.kind === 'character' && nameKey(item.holder.name) === key) item.planned = false;
        }
        return { ok: true };
    }
    case 'person.dies': {
        const key = nameKey(op.name) || op.key;
        if (derived.dead[key]) return { ok: false, reason: `${op.name} is already dead` };
        // The body lies where they fell and holds everything they carried.
        const base = `body_of_${gameKey(op.name)}`.slice(0, 72);
        let bodyKey = base;
        for (let n = 2; items[bodyKey]; n += 1) bodyKey = `${base}_${n}`;
        const body = { kind: 'item', key: bodyKey, name: `${op.name}'s body` };
        items[bodyKey] = { ...itemRecord({ key: bodyKey, name: body.name, kind: 'body', holder: op.place, description: op.cause }, at), bodyOf: op.name };
        pushHistory(items[bodyKey], { at, from: '', to: holderKey(op.place), label: 'died', note: op.cause || '' });
        for (const item of Object.values(items)) {
            if (item.status !== 'active' || item.holder?.kind !== 'character' || nameKey(item.holder.name) !== key) continue;
            const from = holderKey(item.holder);
            item.holder = body;
            item.place = '';
            // What the story never showed them carrying is found only by searching.
            if (item.planned) Object.assign(item, { planned: false, hidden: true });
            pushHistory(item, { at, from, to: holderKey(body), label: 'left on the body', note: '' });
        }
        derived.dead[key] = { key, name: op.name, at, place: op.place, cause: op.cause || '', body: bodyKey };
        return { ok: true };
    }
    default:
        return { ok: false, reason: `unknown operation ${op.type}` };
    }
}

function quantityOf(value, fallback = undefined) {
    if (value === undefined || value === null || value === '') return fallback;
    const number = Math.round(Number(value));
    return Number.isFinite(number) && number >= 0 ? Math.min(MAX_QUANTITY, number) : fallback;
}

function textField(value, maximum = 300) {
    return clipAtBoundary(cleanString(typeof value === 'string' ? value : value == null ? '' : String(value), maximum * 2), maximum);
}

function scoreDelta(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return null;
    return clamp(Math.round(number), -MAX_SCORE_DELTA, MAX_SCORE_DELTA);
}

function noteOf(raw) {
    return textField(raw?.reason || raw?.evidence || '', 200);
}

/**
 * Build the resolution context for one batch of operations from the live
 * state and lore.
 */
export function gameContext(state, options = {}) {
    const playerName = normalizeName(options.playerName) || 'Player';
    const playerKeys = new Set([nameKey(playerName), ...(options.playerAliases || []).map(nameKey)].filter(Boolean));
    return {
        playerName,
        playerKeys,
        entities: options.entities || {},
        items: state.items,
        prices: state.prices,
        stages: state.stages,
        currency: state.currency,
        scenePlace: options.scenePlace || null,
        people: new Set([...Object.keys(state.purses || {}), ...Object.keys(state.dead || {}), ...Object.keys(state.standings || {})]),
        // Places where the story itself has stated prices: the planner adds none there.
        storyPricedPlaces: new Set((state.journal || [])
            .filter(entry => entry?.source === 'ledger' && entry.op?.type === 'price.set' && entry.op.place?.name)
            .map(entry => placeKey(entry.op.place.name))),
    };
}

function canonicalPerson(name, context) {
    return findPerson(context.entities, name)?.name || normalizeName(name);
}

function placeRef(raw, context) {
    const text = normalizeName(raw);
    if (!text) return null;
    const location = resolveLocationReference(context.entities, text);
    if (location) return { name: location.name, id: location.id };
    return { name: text };
}

/**
 * Who pays or is paid. Coins on a body are the dead person's, and a name the
 * game already knows as a person (an unnamed "young fisherman") is that person.
 */
function moneyParty(raw, context) {
    const holder = resolveHolder(raw, context);
    if (!holder) return { kind: 'world', name: 'the world' };
    const body = holder.kind === 'item' ? context.items?.[holder.key] : null;
    if (body?.bodyOf) return { kind: 'character', name: body.bodyOf };
    if (holder.kind === 'place' && context.people?.has(nameKey(holder.name))) return { kind: 'character', name: holder.name };
    return holder;
}

/**
 * Turn a parsed ledger or planner payload into canonical operations, with
 * every name resolved against the lore and the current game state. Returns
 * { ops, rejected } so the caller can report what was refused and why.
 *
 * Record fields (both passes):
 * - objects: key, op (add|move|take|drop|give|put|steal|buy|sell|find|update|consumed|destroyed|lost),
 *   name, kind, quantity, value, price, unit (for value and price), holder (who or what has it),
 *   to (where it goes), location (the planner's prepared place), place (the spot: "behind the bar"),
 *   owner, seller, condition, description, hidden, how, reason, evidence.
 * - money: from, to, amount, unit, reason, evidence. One side must be the player or a person.
 * - deaths: character, place (where the body lies), cause, evidence.
 * - prices: key, name, kind, price, unit, per, seller, location, remove.
 * - standings: character, delta, set, group and lean (a first meeting), reason, evidence.
 *   reputation: group, kind, delta, set, reason, evidence.
 * - planner only: stages (place, summary, hooks) and people (name, location, role, appearance,
 *   manner, wants, secret, group, lean, coin, sells; standing is read as lean).
 */
export function normalizeGameRecords(payload, gameContextValue, options = {}) {
    let context = gameContextValue;
    const ops = [];
    const rejected = [];
    const reject = (record, reason) => rejected.push({
        record: textField(record?.key || record?.name || record?.character || record?.group || record?.place || '', 80),
        reason,
    });
    const source = options.source === 'planner' ? 'planner' : 'ledger';
    // The planner may hand the player a purse and belongings once, when the
    // story has given them none; afterwards only the story changes them.
    const startingKit = source === 'planner' && options.allowStartingKit === true;
    let currency = context.currency;
    const currencyRaw = payload?.currency;
    if (currencyRaw && typeof currencyRaw === 'object' && Object.keys(currencyRaw).length) {
        const normalized = normalizeCurrency(currencyRaw);
        if (!normalized) reject(currencyRaw, 'currency has no usable units');
        else if (context.currency && source === 'planner') reject(currencyRaw, 'the currency is already established');
        else {
            ops.push({ type: 'currency.set', currency: normalized });
            currency = normalized;
        }
    }
    const money = (value, unit) => parseMoney(value, unit, currency);

    const purse = payload?.purse;
    if (purse && typeof purse === 'object' && (purse.set ?? purse.amount) !== undefined) {
        const amount = money(purse.set ?? purse.amount, purse.unit);
        if (amount === null) reject(purse, 'purse amount is not a usable sum');
        else if (source === 'planner' && !startingKit) reject(purse, 'the player already has a purse');
        else ops.push({ type: 'purse.set', amount });
    }

    // Places this planner payload prepares; an object or price names one of
    // them with location, or belongs to the only one.
    const stagePlaces = (Array.isArray(payload?.stages) ? payload.stages : [])
        .map(stage => placeRef(stage?.place || stage?.name, context))
        .filter(Boolean);
    const plannerPlace = raw => {
        const named = placeRef(raw?.location, context);
        if (named) return named;
        return stagePlaces.length === 1 ? stagePlaces[0] : null;
    };

    // Objects added earlier in this payload can already hold later ones
    // ("the sea-chart, in the satchel" right after the satchel), and people
    // prepared in it can carry them.
    const items = { ...context.items };
    const payloadPeople = (Array.isArray(payload?.people) ? payload.people : [])
        .map(person => normalizeName(person?.name)).filter(Boolean);
    context = {
        ...context,
        items,
        stages: source === 'planner' && payloadPeople.length
            ? { ...context.stages, __payload: { place: '', people: payloadPeople.map(name => ({ name })) } }
            : context.stages,
    };
    const carriedNow = () => Object.values(items).filter(item => item.status === 'active' && isCarried(items, item));
    for (const raw of Array.isArray(payload?.objects) ? payload.objects : []) {
        if (!raw || typeof raw !== 'object') continue;
        const name = normalizeName(raw.name);
        const key = gameKey(raw.key || name);
        if (!key) {
            reject(raw, 'object has no key or name');
            continue;
        }
        const known = items[key]?.status === 'active';
        const action = cleanString(String(raw.op || raw.action || ''), 20).toLocaleLowerCase() || (known ? 'update' : 'add');
        const note = noteOf(raw);
        const unit = raw.unit;
        if (action === 'add' || (source === 'planner' && !known)) {
            if (!name) {
                reject(raw, 'a new object needs a name');
                continue;
            }
            const location = source === 'planner' ? plannerPlace(raw) : null;
            let holder = raw.holder ? resolveHolder(raw.holder, context) : null;
            if (!holder && location) holder = { kind: 'location', ...location };
            if (!holder && source === 'ledger' && context.scenePlace) holder = { kind: 'location', ...context.scenePlace };
            if (!holder || holder.kind === 'world') {
                reject(raw, 'object has no holder');
                continue;
            }
            if (source === 'planner' && holder.kind === 'player' && !startingKit) {
                reject(raw, 'the planner cannot give the player belongings once play has begun');
                continue;
            }
            // The ledger may already have recorded what the opening shows the
            // player carrying: the kit never adds a second satchel or knife.
            if (source === 'planner' && holder.kind === 'player'
                && carriedNow().some(item => headNoun(item.name) && headNoun(item.name) === headNoun(name))) {
                reject(raw, 'the player already carries one');
                continue;
            }
            const kind = cleanString(String(raw.kind || ''), 30).toLocaleLowerCase();
            ops.push({
                type: 'item.add',
                key,
                name: name.slice(0, 120),
                kind: ITEM_KIND_SET.has(kind) ? kind : 'other',
                quantity: quantityOf(raw.quantity, 1) || 1,
                value: raw.value !== undefined ? money(raw.value, raw.value_unit ?? unit) : null,
                holder,
                place: textField(raw.place, 120),
                owner: raw.owner ? canonicalPerson(raw.owner, context) : '',
                condition: textField(raw.condition, 160),
                description: textField(raw.description, 400),
                price: raw.price !== undefined && raw.price !== null ? money(raw.price, raw.price_unit ?? unit) : null,
                seller: raw.seller ? canonicalPerson(raw.seller, context) : '',
                hidden: raw.hidden === true,
                // A planner object is prepared material until the story shows it;
                // belongings it hands the player are theirs at once.
                planned: source === 'planner' && holder.kind !== 'player',
                stage: source === 'planner' && location ? placeKey(location.name) : '',
                note,
            });
            if (!known) items[key] = { key, name: name.slice(0, 120), status: 'active', holder };
            continue;
        }
        if (source === 'planner') {
            reject(raw, 'the planner only prepares new objects; the story moves them');
            continue;
        }
        if (['move', 'take', 'drop', 'give', 'put', 'steal', 'buy', 'sell', 'trade', 'loot', 'find'].includes(action)) {
            const to = resolveHolder(raw.to ?? raw.holder, context);
            if (!to || to.kind === 'world') {
                reject(raw, 'move has no destination');
                continue;
            }
            const how = cleanString(String(raw.how || ''), 20).toLocaleLowerCase();
            const kind = cleanString(String(raw.kind || ''), 30).toLocaleLowerCase();
            ops.push({
                type: 'item.move',
                key,
                to,
                place: textField(raw.place, 120),
                quantity: quantityOf(raw.quantity),
                how: MOVE_VERBS.has(how) ? how : action,
                ...(raw.owner !== undefined ? { owner: raw.owner ? canonicalPerson(raw.owner, context) : '' } : {}),
                ...(!known && name ? { name: name.slice(0, 120), kind: ITEM_KIND_SET.has(kind) ? kind : 'other' } : {}),
                ...(raw.value !== undefined ? { value: money(raw.value, raw.value_unit ?? unit) } : {}),
                note,
            });
            continue;
        }
        if (REMOVAL_REASONS.has(action) || action === 'remove') {
            const reason = REMOVAL_REASONS.has(action) ? action : (REMOVAL_REASONS.has(raw.reason) ? raw.reason : 'consumed');
            ops.push({ type: 'item.remove', key, quantity: quantityOf(raw.quantity), reason, note });
            continue;
        }
        if (action === 'update') {
            const fields = {};
            if (name) fields.name = name.slice(0, 120);
            const kind = cleanString(String(raw.kind || ''), 30).toLocaleLowerCase();
            if (ITEM_KIND_SET.has(kind)) fields.kind = kind;
            if (raw.quantity !== undefined) {
                const quantity = quantityOf(raw.quantity);
                if (quantity !== undefined) fields.quantity = quantity;
            }
            if (raw.value !== undefined) fields.value = money(raw.value, raw.value_unit ?? unit);
            if (raw.price !== undefined) fields.price = raw.price === null ? null : money(raw.price, raw.price_unit ?? unit);
            if (raw.seller !== undefined) fields.seller = raw.seller ? canonicalPerson(raw.seller, context) : '';
            for (const field of ['condition', 'description', 'place']) {
                if (raw[field] !== undefined) fields[field] = textField(raw[field], field === 'description' ? 400 : 160);
            }
            if (raw.owner !== undefined) fields.owner = raw.owner ? canonicalPerson(raw.owner, context) : '';
            if (raw.hidden !== undefined) fields.hidden = raw.hidden === true;
            if (!Object.keys(fields).length) {
                reject(raw, 'update changes nothing');
                continue;
            }
            ops.push({ type: 'item.update', key, fields, note });
            continue;
        }
        reject(raw, `unknown object op "${action}"`);
    }

    for (const raw of Array.isArray(payload?.money) ? payload.money : []) {
        if (!raw || typeof raw !== 'object') continue;
        if (source === 'planner') {
            reject(raw, 'the planner does not move money');
            continue;
        }
        const amount = money(raw.amount, raw.unit);
        const from = moneyParty(raw.from, context);
        const to = moneyParty(raw.to, context);
        if (!amount) {
            reject(raw, 'money record has no usable amount');
            continue;
        }
        if (![from, to].some(side => side.kind === 'player' || side.kind === 'character')) {
            reject(raw, 'money must reach or leave a person');
            continue;
        }
        if (from.kind === to.kind && (from.kind === 'player' || nameKey(from.name) === nameKey(to.name))) {
            reject(raw, 'nobody pays themselves');
            continue;
        }
        ops.push({ type: 'money', amount, from, to, reason: textField(raw.reason || raw.for, 160), note: noteOf(raw) });
    }

    for (const raw of Array.isArray(payload?.prices) ? payload.prices : []) {
        if (!raw || typeof raw !== 'object') continue;
        const name = normalizeName(raw.name);
        const key = gameKey(raw.key || name);
        if (!key) continue;
        if (raw.remove === true) {
            ops.push({ type: 'price.remove', key });
            continue;
        }
        const amount = money(raw.price ?? raw.amount, raw.unit);
        if (amount === null || !name) {
            reject(raw, 'price needs a name and an amount');
            continue;
        }
        const kind = cleanString(String(raw.kind || ''), 20).toLocaleLowerCase();
        const where = source === 'planner'
            ? plannerPlace(raw)
            : placeRef(raw.location, context) || context.scenePlace || null;
        // "bed under the eaves" and "a night's bed under the eaves" at the
        // same place are one price: the story's newest figure wins, and the
        // planner never overrides one the story already stated.
        const words = contentWords(name);
        const existing = Object.values(context.prices || {}).find(price => price.key === key
            || (samePlace(price.place, where) && wordsContained(contentWords(price.name), words)));
        if (existing && source === 'planner') {
            reject(raw, `already priced as ${existing.name}`);
            continue;
        }
        if (source === 'planner' && where?.name && context.storyPricedPlaces?.has(placeKey(where.name))) {
            reject(raw, 'the story has already stated prices here');
            continue;
        }
        ops.push({
            type: 'price.set',
            key: existing?.key || key,
            name: name.slice(0, 120),
            kind: PRICE_KIND_SET.has(kind) ? kind : 'other',
            amount,
            per: textField(raw.per, 40),
            seller: raw.seller ? canonicalPerson(raw.seller, context) : '',
            place: where,
        });
    }

    const scoreRecords = (list, type, nameField) => {
        for (const raw of Array.isArray(list) ? list : []) {
            if (!raw || typeof raw !== 'object') continue;
            if (source === 'planner') {
                reject(raw, 'standing changes come from the story, not the planner');
                continue;
            }
            const rawName = normalizeName(raw[nameField] ?? raw.name);
            if (!rawName || context.playerKeys.has(nameKey(rawName))) {
                reject(raw, 'standing needs a person or group other than the player');
                continue;
            }
            const name = type === 'standing.change' ? canonicalPerson(rawName, context) : rawName;
            const delta = scoreDelta(raw.delta);
            const set = raw.set !== undefined && raw.set !== null && Number.isFinite(Number(raw.set))
                ? clamp(Math.round(Number(raw.set)), -SCORE_LIMIT, SCORE_LIMIT)
                : null;
            // A first meeting may name the person's group and lean even when nothing changed.
            const group = type === 'standing.change' ? textField(raw.group, 120) : '';
            const lean = type === 'standing.change' && raw.lean !== null && raw.lean !== '' && Number.isFinite(Number(raw.lean))
                ? clamp(Math.round(Number(raw.lean)), -40, 40)
                : null;
            if (!delta && set === null && !group && lean === null) {
                reject(raw, 'standing change is zero');
                continue;
            }
            const kind = cleanString(String(raw.kind || ''), 20).toLocaleLowerCase();
            ops.push({
                type,
                key: nameKey(name),
                name: name.slice(0, 120),
                delta: delta || 0,
                set,
                reason: textField(raw.reason || raw.evidence, 200),
                ...(group ? { group } : {}),
                ...(lean !== null ? { lean } : {}),
                ...(type === 'reputation.change' ? { kind: REPUTATION_KIND_SET.has(kind) ? kind : 'other' } : {}),
            });
        }
    };
    scoreRecords(payload?.standings, 'standing.change', 'character');
    scoreRecords(payload?.reputation, 'reputation.change', 'group');

    for (const raw of Array.isArray(payload?.deaths) ? payload.deaths : []) {
        if (!raw || typeof raw !== 'object') continue;
        if (source === 'planner') {
            reject(raw, 'deaths come from the story, not the planner');
            continue;
        }
        const rawName = normalizeName(raw.character ?? raw.name);
        if (!rawName || context.playerKeys.has(nameKey(rawName))) {
            reject(raw, 'a death needs someone other than the player');
            continue;
        }
        const place = placeRef(raw.place, context) || context.scenePlace;
        if (!place?.name) {
            reject(raw, 'a death needs the place where the body lies');
            continue;
        }
        const name = canonicalPerson(rawName, context).slice(0, 120);
        ops.push({
            type: 'person.dies',
            key: nameKey(name),
            name,
            place: { kind: 'location', name: place.name, ...(place.id ? { id: place.id } : {}) },
            cause: textField(raw.cause || raw.how || raw.reason, 160),
            note: noteOf(raw),
        });
    }

    // "Harbour Master Oswin Pell" is the "Harbour Master Pell" lore already has.
    const knownPerson = name => Boolean(findPerson(context.entities, name)) || Object.values(context.entities || {}).some(record => (
        ['character', 'creature'].includes(normalizeEntityType(record?.type))
        && [record.name, ...(record.aliases || [])].some(known => wordsContained(contentWords(known), contentWords(name)))
    ));
    // Singular roles already prepared elsewhere (not yet met), so two stages never share an innkeeper.
    const preparedRoles = Object.entries(context.stages || {})
        .filter(([stageKey]) => stageKey !== '__payload')
        .flatMap(([stageKey, stage]) => (stage.people || []).filter(person => !person.introduced)
            .map(person => ({ group: singularRoleOf(person.role), place: stage.place, stage: stageKey, name: person.name }))
            .filter(item => item.group));
    for (const place of stagePlaces) {
        const raw = payload.stages.find(stage => placeRef(stage?.place || stage?.name, context)?.name === place.name) || {};
        const key = placeKey(place.name);
        const people = [];
        const rolesHeld = singularRolesHeldAt(place.name, context.entities);
        for (const person of Array.isArray(payload?.people) ? payload.people : []) {
            if (!person || typeof person !== 'object' || !normalizeName(person.name)) continue;
            const target = plannerPlace(person);
            if (!target || placeKey(target.name) !== key) continue;
            if (knownPerson(person.name)) {
                reject(person, 'already a known person; the curator tracks where known people are');
                continue;
            }
            // One person per singular role at a place: the story's innkeeper,
            // harbour master or old man by the fire is never doubled.
            const group = singularRoleOf(person.role) || (/^old\s/iu.test(normalizeName(person.name)) ? 'elder' : '');
            if (group) {
                const holder = rolesHeld.find(item => item.group === group);
                if (holder) { reject(person, `the story already has the ${group} here: ${holder.name}`); continue; }
                const prepared = preparedRoles.find(item => item.group === group && item.stage !== key
                    && nameKey(item.name) !== nameKey(person.name) && relatedPlaces(item.place, place.name, context.entities));
                if (prepared) { reject(person, `already prepared as the ${group} at ${prepared.place}: ${prepared.name}`); continue; }
                preparedRoles.push({ group, place: place.name, stage: key, name: normalizeName(person.name) });
            }
            const lean = person.lean ?? person.standing;
            people.push({
                name: normalizeName(person.name).slice(0, 120),
                role: textField(person.role, 120),
                appearance: textField(person.appearance, 240),
                manner: textField(person.manner ?? person.disposition, 200),
                wants: textField(person.wants, 200),
                secret: textField(person.secret, 200),
                sells: uniqueStrings(Array.isArray(person.sells) ? person.sells : [], 8).map(value => textField(value, 80)),
                // The money they carry, in the smallest unit; null when the planner gave none.
                coin: person.coin !== undefined && person.coin !== null && person.coin !== '' ? money(person.coin, person.coin_unit) : null,
                group: textField(person.group, 120),
                // How much warmer or cooler than their group; older outputs called it standing.
                lean: Number.isFinite(Number(lean)) && lean !== null && lean !== ''
                    ? clamp(Math.round(Number(lean)), -40, 40)
                    : null,
            });
        }
        ops.push({
            type: 'stage.set',
            key,
            place: place.name,
            placeId: place.id || '',
            summary: textField(raw.summary, 400),
            hooks: uniqueStrings(Array.isArray(raw.hooks) ? raw.hooks : [], 6).map(value => textField(value, 200)),
            people: people.slice(0, Math.max(1, Math.min(8, Number(options.maximumPeoplePerStage) || 8))),
            clockSeconds: Number.isFinite(options.clockSeconds) ? options.clockSeconds : null,
        });
    }
    // A starting purse that cannot pay for the lodging and meals priced in
    // the same answer empties on the first night: raise it to a modest float.
    const adjusted = [];
    const purseOp = startingKit ? ops.find(op => op.type === 'purse.set') : null;
    if (purseOp) {
        const priced = kind => Math.max(0, ...ops.filter(op => op.type === 'price.set' && op.kind === kind).map(op => op.amount));
        const lodging = priced('lodging');
        const meal = Math.max(priced('food'), priced('drink'));
        if (lodging > 0 && purseOp.amount < lodging + 2 * meal) {
            const raised = Math.min(3 * lodging + 4 * meal, 20 * lodging);
            adjusted.push({ record: 'purse', from: purseOp.amount, to: raised, reason: 'starting purse raised to cover the staged lodging and meals' });
            purseOp.amount = raised;
        }
    }
    return { ops, rejected, adjusted };
}

/**
 * Validate and apply canonical operations, recording each that applies in
 * the journal under `messageIndex`.
 */
/**
 * Standings, purses and deaths keyed by a name the lore has since folded into
 * another person (a descriptor the story later named): one person.alias op
 * per fold, so the journal stays append-only and replays deterministically.
 */
export function reconcileGameIdentities(value, entities) {
    const state = normalizeGameState(value);
    const ops = [];
    const seen = new Set();
    for (const table of [state.standings, state.purses, state.dead]) {
        for (const record of Object.values(table || {})) {
            const person = findPerson(entities, record.name);
            if (!person) continue;
            const canonical = nameKey(person.name);
            if (!canonical || canonical === record.key || seen.has(record.key)) continue;
            seen.add(record.key);
            ops.push({ type: 'person.alias', from: record.key, to: canonical, name: person.name });
        }
    }
    return ops;
}

/**
 * Prices the planner prepared for a place where the story has now stated a
 * price of the same kind: the story's price wins, the prepared ones go. Returns
 * price.remove ops for the journal.
 */
export function supersededPlannerPrices(value, appliedOps) {
    const state = normalizeGameState(value);
    const plannerOnly = new Map();
    for (const entry of state.journal || []) {
        const op = entry?.op;
        if (!op) continue;
        if (op.type === 'price.set') { if (entry.source === 'planner') plannerOnly.set(op.key, op); else plannerOnly.delete(op.key); }
        if (op.type === 'price.remove') plannerOnly.delete(op.key);
    }
    const stated = (Array.isArray(appliedOps) ? appliedOps : []).filter(op => op?.type === 'price.set');
    const ops = [];
    for (const [key, price] of plannerOnly) {
        if (!state.prices[key]) continue;
        const hit = stated.find(op => op.key !== key && op.kind === price.kind && samePlace(op.place, price.place));
        if (hit) ops.push({ type: 'price.remove', key, name: price.name, reason: `the story priced ${hit.name} here` });
    }
    return ops;
}

export function applyGameOperations(value, operations, options = {}) {
    const state = normalizeGameState(value);
    const messageIndex = Number.isInteger(options.messageIndex) ? options.messageIndex : -1;
    const source = cleanString(options.source, 20) || 'ledger';
    const applied = [];
    const rejected = [...(options.rejected || [])];
    for (const op of Array.isArray(operations) ? operations : []) {
        if (!op || typeof op.type !== 'string') continue;
        const entry = { seq: state.sequence + 1, at: messageIndex, source, op };
        const result = reduceEntry(state, entry);
        if (!result.ok) {
            rejected.push({ record: op.key || op.name || op.type, reason: result.reason });
            continue;
        }
        if (result.fromPlayer) entry.fromPlayer = true;
        state.sequence = entry.seq;
        state.journal.push(entry);
        applied.push({ ...entry, ...(result.shortfall ? { shortfall: result.shortfall } : {}), ...(result.key ? { resultKey: result.key } : {}) });
    }
    compactJournal(state);
    state.derivedSequence = state.sequence;
    return { state, applied, rejected };
}

// --- queries ------------------------------------------------------------------

function activeItems(state) {
    return Object.values(state?.items || {}).filter(item => item.status === 'active' && item.quantity > 0);
}

export function carriedItems(state) {
    const items = state?.items || {};
    return activeItems(state).filter(item => isCarried(items, item));
}

/** A place as the game layer refers to it: name, record id, and the record's aliases. */
export function placeRefOf(record, fallbackName = '') {
    if (record) return { name: record.name, id: record.id, aliases: (record.aliases || []).slice(0, 20) };
    const name = normalizeName(fallbackName);
    return name ? { name } : null;
}

function placeKeys(place) {
    return new Set([place.name, ...(place.aliases || [])].map(placeNameKey).filter(Boolean));
}

// A place recorded under a provisional name ("the harbour") is the same
// place once lore names it and keeps that phrase as an alias.
function samePlace(ref, place) {
    if (!ref || !place) return false;
    if (place.id && ref.id) return place.id === ref.id;
    return placeKeys(place).has(placeNameKey(ref.name));
}

function placeMatches(holder, place) {
    if (!holder || !place) return false;
    if (holder.kind !== 'location' && holder.kind !== 'place') return false;
    if (place.id && holder.id) return place.id === holder.id;
    return placeKeys(place).has(placeNameKey(holder.name));
}

/** Items lying at a place, directly or in a container there. Planned items are left out unless asked for. */
export function itemsAtPlace(state, place, { includePlanned = false } = {}) {
    if (!place) return [];
    const items = state?.items || {};
    return activeItems(state).filter(item => {
        if (item.planned && !includePlanned) return false;
        const root = rootHolder(items, item);
        return placeMatches(root, place);
    });
}

export function pricesAtPlace(state, place, presentNames = []) {
    const present = new Set(presentNames.map(nameKey));
    return Object.values(state?.prices || {}).filter(price => (
        samePlace(price.place, place)
        || (price.seller && present.has(nameKey(price.seller)))
    ));
}

export function stageFor(state, place) {
    if (!place) return null;
    const stages = Object.values(state?.stages || {});
    const keys = placeKeys(place);
    const exact = stages.find(stage => place.id && stage.placeId === place.id)
        || stages.find(stage => keys.has(placeNameKey(stage.place)));
    if (exact) return exact;
    // A stage prepared under a provisional name ("the harbour") belongs to
    // the place lore later records as "Port Vell harbour".
    const words = contentWords(place.name);
    return stages.find(stage => {
        if (stage.placeId) return false;
        const stageWords = contentWords(stage.place);
        return stageWords.size > 0 && [...stageWords].every(word => words.has(word));
    }) || null;
}

/** The place, also answering to the name its stage was prepared under. */
export function placeWithStage(state, place) {
    const stage = stageFor(state, place);
    if (!place || !stage || placeKeys(place).has(placeNameKey(stage.place))) return place;
    return { ...place, aliases: [...(place.aliases || []), stage.place] };
}

function whereText(item) {
    const spot = cleanString(item.place, 120);
    if (item.holder?.kind === 'item') return `in the ${item.holder.name || item.holder.key}${spot ? `, ${spot}` : ''}`;
    return spot;
}

function itemLine(item, currency, { showValue = true, showPlace = false } = {}) {
    const label = item.quantity > 1 ? `${item.name} ×${item.quantity}` : item.name;
    const notes = [];
    if (item.condition) notes.push(item.condition);
    const where = showPlace ? whereText(item) : '';
    if (where) notes.push(where);
    if (showValue && Number.isFinite(item.value) && item.value > 0) notes.push(`worth ${formatMoney(item.value, currency)}${item.quantity > 1 ? ' each' : ''}`);
    if (Number.isFinite(item.price) && item.price !== null) notes.push(`for sale at ${formatMoney(item.price, currency)}${item.seller ? ` from ${item.seller}` : ''}`);
    return notes.length ? `${label} (${notes.join('; ')})` : label;
}

function purseText(state) {
    const purse = state?.purse || {};
    if (purse.amount === null || purse.amount === undefined) {
        return `not yet established; the story may reveal it${purse.spent ? ` (${formatMoney(purse.spent, state.currency)} spent so far)` : ''}`;
    }
    if (!purse.amount && !purse.minimum) return 'empty';
    const text = formatMoney(purse.amount, state.currency);
    return purse.minimum ? `at least ${text} (the full amount was never established)` : text;
}

function entryText(entry, state, playerName) {
    const op = entry.op;
    const currency = state.currency;
    const who = holder => (holder?.kind === 'player' ? playerName : holderLabel(holder));
    switch (op.type) {
    case 'money':
        if (op.from?.kind === 'player') return `paid ${formatMoney(op.amount, currency)} to ${who(op.to)}${op.reason ? ` for ${op.reason}` : ''}`;
        if (op.to?.kind === 'player') return `received ${formatMoney(op.amount, currency)} from ${who(op.from)}${op.reason ? ` (${op.reason})` : ''}`;
        return `${who(op.from)} paid ${formatMoney(op.amount, currency)} to ${who(op.to)}${op.reason ? ` for ${op.reason}` : ''}`;
    case 'person.dies':
        return `${op.name} died${op.cause ? ` (${op.cause})` : ''}`;
    case 'item.move': {
        const name = `${state.items[op.key]?.name || op.name || op.key}${op.quantity > 1 ? ` ×${op.quantity}` : ''}`;
        if (op.to?.kind === 'player') return `${op.how === 'buy' ? 'bought' : op.how === 'steal' ? 'stole' : 'got'} ${name}`;
        return `${name} → ${holderLabel(op.to, op.place, playerName)}`;
    }
    case 'item.add':
        return op.holder?.kind === 'player' ? `got ${op.name}${op.quantity > 1 ? ` ×${op.quantity}` : ''}` : '';
    case 'item.remove': {
        const name = state.items[op.key]?.name || op.key;
        return `${name} ${op.reason}`;
    }
    case 'purse.set':
        return `purse counted: ${formatMoney(op.amount, currency)}`;
    case 'standing.change':
        return `${op.name} ${op.set !== null && op.set !== undefined ? `now ${signed(op.set)}` : signed(op.delta)}${op.reason ? `: ${op.reason}` : ''}`;
    case 'reputation.change':
        return `standing with ${op.name} ${op.set !== null && op.set !== undefined ? `now ${signed(op.set)}` : signed(op.delta)}${op.reason ? `: ${op.reason}` : ''}`;
    default:
        return '';
    }
}

function involvesPlayer(entry, items) {
    const op = entry.op;
    // A first meeting where nothing happened shows as the person's standing, not as a change.
    if (op.type === 'standing.change') return Boolean(op.delta) || (op.set !== undefined && op.set !== null);
    if (op.type === 'money') return op.from?.kind === 'player' || op.to?.kind === 'player';
    if (op.type === 'purse.set' || op.type === 'reputation.change' || op.type === 'person.dies') return true;
    if (op.type === 'item.move') return op.to?.kind === 'player' || entry.fromPlayer === true;
    if (op.type === 'item.add') return op.holder?.kind === 'player' && entry.source !== 'planner';
    if (op.type === 'item.remove') return entry.fromPlayer === true;
    return false;
}

/** The newest player-facing changes, newest last. */
export function recentGameChanges(state, playerName = 'You', limit = 6) {
    const items = state?.items || {};
    return (state?.journal || [])
        .filter(entry => involvesPlayer(entry, items))
        .slice(-limit)
        .map(entry => ({ at: entry.at, text: entryText(entry, state, playerName) }))
        .filter(change => change.text);
}

// --- planner targets ----------------------------------------------------------

/**
 * Places the scene planner should prepare: where the player is when it has
 * no stage (or the stage has gone stale in story time), then places the
 * player can go next. `scene` is the compiled scene; `camera` its frame.
 */
export function plannerTargets(state, options = {}) {
    const store = options.store || {};
    const entities = store.entities || {};
    const maximum = Math.max(0, Math.min(4, Number(options.maximum) || 2));
    const staleSeconds = Math.max(0, Number(options.staleSeconds) || 8 * 3_600);
    const clock = Number(options.clockSeconds);
    const targets = [];
    const seen = new Set();
    const consider = (name, reason) => {
        if (!name || targets.length >= maximum) return;
        const place = placeRefOf(resolveLocationReference(entities, name), name);
        const key = placeKey(place.name);
        if (!key || seen.has(key)) return;
        seen.add(key);
        const stage = stageFor(state, place);
        const stale = stage && Number.isFinite(clock) && Number.isFinite(stage.clockSeconds)
            && clock - stage.clockSeconds > staleSeconds;
        if (stage && !stale) return;
        targets.push({ ...place, reason: stale ? `${reason}; stage is stale` : reason });
    };
    consider(options.scene?.location?.name, options.heading ? 'the player is heading here now' : 'the player is here');
    if (options.prefetch !== false) {
        for (const way of options.camera?.waysOn || []) {
            if (targets.length >= maximum) break;
            // The town around the inn is not somewhere to walk into next.
            if (!way?.name || way.relation === 'the wider place') continue;
            consider(way.name, `reachable from here (${cleanString(way.relation, 60)})`);
        }
    }
    return targets;
}

/**
 * Whether the player's purse has never been counted. The planner may then
 * hand out a starting purse and belongings once, alongside anything the
 * story has already shown them carrying.
 */
export function needsStartingKit(state) {
    return state?.purse?.amount === null || state?.purse?.amount === undefined;
}

// --- introductions --------------------------------------------------------------

/**
 * Operations marking planned people and objects that a finished reply has
 * now shown. Only names at the scene's place count.
 */
export function introductionOperations(state, text, scenePlace) {
    const source = cleanString(text, 60_000);
    const place = placeWithStage(state, scenePlace);
    if (!source || !place) return [];
    const ops = [];
    const stage = stageFor(state, place);
    for (const person of stage?.people || []) {
        if (person.introduced) continue;
        const names = uniqueStrings([person.name, person.name.split(/\s+/u)[0]].filter(name => name.length >= 3), 4);
        if (cleanTextMentions(source, names)) ops.push({ type: 'introduce', kind: 'person', stage: stage.key, name: person.name });
    }
    for (const item of itemsAtPlace(state, place, { includePlanned: true })) {
        if (!item.planned) continue;
        if (cleanTextMentions(source, [item.name])) ops.push({ type: 'introduce', kind: 'item', key: item.key });
    }
    return ops;
}

// --- narrator packet ------------------------------------------------------------

/**
 * The game block of the state macro: money, possessions, what is here and
 * for sale, how the people here regard the player, reputation, the planner's
 * prepared material, and the newest changes. Lines are added in priority
 * order until the budget is used.
 */
export function renderGamePacket(value, options = {}) {
    const state = readableState(value);
    const maximum = Math.max(400, Number(options.maximumCharacters) || 3_000);
    const pov = normalizeName(options.playerName) || 'the player character';
    const scene = options.scene || null;
    const entities = options.store?.entities || {};
    const herePlace = scene?.location?.name
        ? placeWithStage(state, placeRefOf((scene.location.id && entities[scene.location.id]) || resolveLocationReference(entities, scene.location.name), scene.location.name))
        : null;
    const present = uniqueStrings([
        ...(options.camera?.withYou || []).map(person => person.name),
        ...(scene?.participants || []).map(person => person.name),
    ], 12).filter(name => nameKey(name) !== nameKey(pov));
    const currency = state.currency;
    const carrying = carriedItems(state);
    const here = herePlace ? itemsAtPlace(state, herePlace) : [];
    const heldHere = activeItems(state).filter(item => !item.planned && item.holder?.kind === 'character'
        && present.some(name => nameKey(name) === nameKey(item.holder.name)));
    const prices = herePlace ? pricesAtPlace(state, herePlace, present) : [];
    const onBody = item => Boolean(bodyHolding(state.items, item));
    const bodies = here.filter(item => item.bodyOf);
    const stock = here.filter(item => Number.isFinite(item.price) && item.price !== null && !onBody(item));
    const stage = herePlace ? stageFor(state, herePlace) : null;

    const lines = [];
    lines.push(`Purse: ${purseText(state)}.`);
    lines.push(carrying.length
        ? `Carrying: ${carrying.map(item => itemLine(item, currency, { showPlace: item.holder?.kind === 'item' })).join('; ')}.`
        : `Carrying: nothing tracked yet.`);
    const shownHere = here.filter(item => !item.hidden && !item.bodyOf && !onBody(item) && !(Number.isFinite(item.price) && item.price !== null));
    if (herePlace && shownHere.length) {
        lines.push(`Here at ${herePlace.name}: ${shownHere.slice(0, 14).map(item => itemLine(item, currency, { showValue: false, showPlace: true })).join('; ')}.`);
    }
    if (bodies.length) {
        const bodyLine = body => {
            const dead = state.dead[nameKey(body.bodyOf)];
            const coin = state.purses[nameKey(body.bodyOf)];
            const bits = [
                ...here.filter(item => bodyHolding(state.items, item) === body.key)
                    .map(item => `${itemLine(item, currency, { showValue: true })}${item.hidden ? ' [hidden until searched]' : ''}`),
                ...(coin?.amount ? [`${formatMoney(coin.amount, currency)} in coin`] : []),
            ];
            return `${body.name}${dead?.cause ? ` (${dead.cause})` : ''}: ${bits.length ? bits.join(', ') : 'nothing tracked'}`;
        };
        lines.push(`Bodies here (what they carried stays on them until taken): ${bodies.slice(0, 4).map(bodyLine).join('; ')}.`);
    }
    const coinHere = present.map(name => state.purses[nameKey(name)])
        .filter(purse => purse && purse.amount !== null && !state.dead[purse.key]);
    if (coinHere.length) {
        lines.push(`Coin carried by people here: ${coinHere.map(purse => `${purse.name} ${purse.minimum ? 'at least ' : ''}${formatMoney(purse.amount, currency)}`).join('; ')}.`);
    }
    if (heldHere.length) {
        lines.push(`Held by people here: ${heldHere.slice(0, 10).map(item => `${item.holder.name}: ${itemLine(item, currency, { showValue: false })}${item.hidden ? ' [hidden]' : ''}`).join('; ')}.`);
    }
    const sale = [
        ...prices.map(price => `${price.name} ${formatMoney(price.amount, currency)}${price.per ? ` ${price.per}` : ''}${price.seller ? ` (${price.seller})` : ''}`),
        ...stock.map(item => `${item.name}${item.quantity > 1 ? ` ×${item.quantity}` : ''} ${formatMoney(item.price, currency)}${item.quantity > 1 ? ' each' : ''}${item.seller ? ` (${item.seller})` : ''}`),
    ];
    if (sale.length) lines.push(`For sale here: ${sale.slice(0, 14).join('; ')}.`);
    const standingLine = name => {
        const record = state.standings[nameKey(name)];
        if (!record) return '';
        const reason = record.notes?.at(-1)?.reason;
        return `${record.name}: ${standingTier(record.score)} (${signed(record.score)})${reason ? ` - ${clipAtBoundary(reason, 90)}` : ''}`;
    };
    const people = present.map(standingLine).filter(Boolean);
    if (people.length) lines.push(`How the people here regard ${pov}: ${people.join('; ')}.`);
    const groups = Object.values(state.reputation || {})
        .sort((a, b) => (Number(b.updated) || 0) - (Number(a.updated) || 0) || Math.abs(b.score) - Math.abs(a.score))
        .slice(0, 5);
    if (groups.length) {
        lines.push(`${pov}'s reputation: ${groups.map(group => `${group.name}: ${reputationTier(group.score)} (${signed(group.score)})`).join('; ')}.`);
    }
    const recent = recentGameChanges(state, pov, 5);
    if (recent.length) lines.push(`Recent changes: ${recent.map(change => change.text).join('; ')}.`);
    if (stage) {
        const prepared = [];
        const waiting = (stage.people || []).filter(person => !person.introduced);
        if (stage.summary) prepared.push(`Now: ${stage.summary}`);
        for (const person of waiting.slice(0, 4)) {
            // The narrator who introduces them needs their attitude in that same reply.
            const impression = firstImpression(state, person);
            const regard = impression ? `regards ${pov}: ${standingTier(impression.score)} (${signed(impression.score)})${impression.group ? ` as one of ${impression.group.name}` : ''}` : '';
            const belongings = activeItems(state).filter(item => item.holder?.kind === 'character' && nameKey(item.holder.name) === nameKey(person.name))
                .map(item => `${item.name}${item.hidden ? ' (hidden)' : ''}`);
            const carries = [Number.isFinite(person.coin) ? formatMoney(person.coin, currency) : '', ...belongings].filter(Boolean);
            const bits = [person.role, person.appearance, person.manner, person.wants ? `wants ${person.wants}` : '', person.secret ? `secret: ${person.secret}` : '', person.sells?.length ? `sells ${person.sells.join(', ')}` : '', carries.length ? `carries ${carries.join(', ')}` : '', regard]
                .filter(Boolean);
            prepared.push(`${person.name}${bits.length ? ` (${bits.join('; ')})` : ''}`);
        }
        const plannedItems = itemsAtPlace(state, herePlace, { includePlanned: true }).filter(item => (item.planned || item.hidden) && !onBody(item));
        for (const item of plannedItems.slice(0, 6)) {
            prepared.push(`${itemLine(item, currency, { showPlace: true })}${item.hidden ? ' [hidden until found]' : ''}${item.description ? `: ${clipAtBoundary(item.description, 120)}` : ''}`);
        }
        for (const hook of (stage.hooks || []).slice(0, 3)) prepared.push(`Hook: ${hook}`);
        if (prepared.length) {
            // Optional colour: whole parts are dropped to fit, never cut mid-hook.
            lines.push({
                head: `Prepared for ${stage.place} (narrator-only; bring these in when the scene calls for them, never all at once, and only as ${pov} would notice them): `,
                parts: prepared,
            });
        }
    }

    const opening = [
        `<inner_lore_game_state pov=${JSON.stringify(pov)} compiled="true">`,
        `This is the game ledger: money, possessions, where tracked objects are, prices, and how people regard ${pov}. Keep the story consistent with it. ${pov} can spend only the money in the purse and use only what they carry or can reach here; a purchase costs the listed price unless the story bargains it; an object stays where it was last put until someone moves it. People act on how they regard ${pov}. The ledger is updated from each finished reply, so show changes happening in the story; never recite the ledger or its numbers.`,
    ];
    const closing = '</inner_lore_game_state>';
    const included = [];
    const fits = line => [...opening, ...included, line, closing].join('\n').length <= maximum;
    for (const line of lines) {
        if (line.parts) {
            const kept = [];
            for (const part of line.parts) {
                if (fits(`${line.head}${[...kept, part].join(' | ')}.`)) kept.push(part);
            }
            if (kept.length) included.push(`${line.head}${kept.join(' | ')}.`);
            continue;
        }
        if (fits(line)) {
            included.push(line);
            continue;
        }
        const used = [...opening, ...included, closing].join('\n').length + 1;
        if (maximum - used >= 60) included.push(clipAtBoundary(line, maximum - used));
    }
    return [...opening, ...included, closing].join('\n');
}

// --- view model for the HUD -----------------------------------------------------------

export function gameOverview(value, options = {}) {
    const state = readableState(value);
    const playerName = normalizeName(options.playerName) || 'You';
    const currency = state.currency;
    const place = placeWithStage(state, options.place || null);
    const describe = item => ({
        key: item.key,
        name: item.name,
        quantity: item.quantity,
        kind: item.kind,
        condition: item.condition,
        description: item.description,
        place: item.place,
        container: item.holder?.kind === 'item' ? item.holder.name : '',
        value: Number.isFinite(item.value) && item.value > 0 ? formatMoney(item.value, currency) : '',
        price: Number.isFinite(item.price) && item.price !== null ? formatMoney(item.price, currency) : '',
        seller: item.seller,
        hidden: item.hidden,
        planned: item.planned,
        history: (item.history || []).map(step => ({ at: step.at, label: step.label, note: step.note })),
    });
    const totalValue = carriedItems(state).reduce((sum, item) => sum + (Number(item.value) || 0) * item.quantity, 0);
    return {
        purse: {
            text: purseText(state),
            amount: state.purse?.amount ?? null,
            known: state.purse?.amount !== null && state.purse?.amount !== undefined,
            currency: currency?.name || DEFAULT_CURRENCY.name,
        },
        carryingValue: totalValue ? formatMoney(totalValue, currency) : '',
        carrying: carriedItems(state).map(describe),
        here: place ? itemsAtPlace(state, place)
            .filter(item => !item.hidden && !item.bodyOf && !bodyHolding(state.items, item) && !(Number.isFinite(item.price) && item.price !== null))
            .map(describe) : [],
        bodies: place ? itemsAtPlace(state, place).filter(item => item.bodyOf).map(body => ({
            name: body.name,
            cause: state.dead[nameKey(body.bodyOf)]?.cause || '',
            items: itemsAtPlace(state, place).filter(item => !item.hidden && bodyHolding(state.items, item) === body.key).map(describe),
        })) : [],
        forSale: place ? [
            ...pricesAtPlace(state, place, options.present || []).map(price => ({
                name: price.name, price: formatMoney(price.amount, currency), per: price.per, seller: price.seller, kind: price.kind,
            })),
            ...itemsAtPlace(state, place)
                .filter(item => Number.isFinite(item.price) && item.price !== null && !bodyHolding(state.items, item))
                .map(item => ({ name: item.name, price: formatMoney(item.price, currency), per: item.quantity > 1 ? 'each' : '', seller: item.seller, kind: 'item' })),
        ] : [],
        people: Object.values(state.standings || {})
            .sort((a, b) => (Number(b.updated) || 0) - (Number(a.updated) || 0))
            .map(record => ({ name: record.name, score: record.score, tier: standingTier(record.score), notes: record.notes || [] })),
        reputation: Object.values(state.reputation || {})
            .sort((a, b) => Math.abs(b.score) - Math.abs(a.score))
            .map(record => ({ name: record.name, kind: record.kind, score: record.score, tier: reputationTier(record.score), notes: record.notes || [] })),
        ledger: recentGameChanges(state, playerName, 40).reverse(),
    };
}

/** Counts for diagnostics and the run summary. */
/**
 * What the trade screen offers: the people here with what they sell or carry
 * openly and the coin they have, the bodies here with what can be seen on
 * them, and the player's own things. A seller's prepared stock with a price is
 * on offer; anything hidden or private stays off the screen.
 */
export function tradeOverview(value, options = {}) {
    const state = readableState(value);
    const currency = state.currency;
    const items = state.items || {};
    const place = placeWithStage(state, options.place || null);
    const coin = amount => (Number.isFinite(amount) && amount > 0 ? formatMoney(amount, currency) : '');
    const priced = item => Number.isFinite(item.price) && item.price !== null;
    const ware = item => ({
        key: item.key,
        name: item.name,
        quantity: item.quantity,
        description: item.description || item.condition || '',
        price: priced(item) ? formatMoney(item.price, currency) : '',
        value: coin(item.value),
    });
    const here = place ? itemsAtPlace(state, place, { includePlanned: true }) : [];
    const stage = place ? stageFor(state, place) : null;
    const prices = place ? pricesAtPlace(state, place, options.present || []) : [];
    const player = nameKey(options.playerName || '');
    const names = uniqueStrings([
        ...(options.present || []),
        ...(stage?.people || []).filter(person => person.introduced).map(person => person.name),
        ...here.filter(item => item.seller && priced(item) && !item.hidden).map(item => item.seller),
        ...prices.map(price => price.seller).filter(Boolean),
    ], 16).filter(name => nameKey(name) && nameKey(name) !== player && !state.dead[nameKey(name)]);
    const people = names.map(name => {
        const key = nameKey(name);
        const carried = activeItems(state).filter(item => item.holder?.kind === 'character' && nameKey(item.holder.name) === key
            && !item.hidden && (!item.planned || priced(item)));
        const stock = here.filter(item => item.seller && nameKey(item.seller) === key && priced(item) && !item.hidden
            && !bodyHolding(items, item) && !carried.includes(item));
        const purse = state.purses[key];
        return {
            kind: 'person',
            name,
            coin: purse && purse.amount !== null ? `${purse.minimum ? 'at least ' : ''}${formatMoney(purse.amount, currency)}` : '',
            wares: [...carried, ...stock].map(ware),
            services: prices.filter(price => price.seller && nameKey(price.seller) === key)
                .map(price => ({ key: price.key, name: price.name, price: formatMoney(price.amount, currency), per: price.per || '' })),
        };
    });
    const bodies = here.filter(item => item.bodyOf).map(body => ({
        kind: 'body',
        name: body.name,
        person: body.bodyOf,
        cause: state.dead[nameKey(body.bodyOf)]?.cause || '',
        wares: here.filter(item => !item.hidden && bodyHolding(items, item) === body.key).map(ware),
    }));
    return { purse: purseText(state), mine: carriedItems(state).map(ware), partners: [...people, ...bodies] };
}

export function getGameStats(value) {
    const state = readableState(value);
    return {
        items: activeItems(state).length,
        carried: carriedItems(state).length,
        prices: Object.keys(state.prices || {}).length,
        standings: Object.keys(state.standings || {}).length,
        reputation: Object.keys(state.reputation || {}).length,
        stages: Object.keys(state.stages || {}).length,
        journal: state.journal.length,
        purse: state.purse?.amount ?? null,
    };
}

// --- help for smaller ledger models ------------------------------------------

const NUMBER_WORDS = Object.freeze({
    a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
    eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, twenty: 20, thirty: 30, forty: 40, fifty: 50, hundred: 100,
});
// Old-money words that carry their own count.
const COUNTED_PENCE = Object.freeze({
    tuppence: 2, twopence: 2, threepence: 3, fourpence: 4, fivepence: 5, sixpence: 6, sevenpence: 7,
    eightpence: 8, ninepence: 9, tenpence: 10, elevenpence: 11,
});
const escapePattern = text => text.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
const countOf = word => (/^\d+$/u.test(word) ? Number(word) : NUMBER_WORDS[word.toLowerCase()]);

/**
 * Every amount of money PASSAGE names, in the world's units, so a smaller
 * ledger model can account for each one. "A shilling and six" is old money
 * for one shilling and six of the next unit down.
 */
export function amountMentions(text, currencyValue) {
    const currency = currencyValue?.units?.length ? currencyValue : DEFAULT_CURRENCY;
    const units = currency.units;
    const words = new Map();
    for (const unit of units) {
        for (const word of [unit.name, unitPlural(unit), `${unit.name}s`]) if (word) words.set(word.toLowerCase(), unit);
        if (/^penny$/iu.test(unit.name)) for (const word of ['pence', 'pennies']) words.set(word, unit);
    }
    const unitPattern = [...words.keys()].sort((a, b) => b.length - a.length).map(escapePattern).join('|');
    const number = `(\\d+|${Object.keys(NUMBER_WORDS).join('|')})`;
    const pattern = new RegExp(`\\b${number}\\s+(${unitPattern})\\b(?:\\s+and\\s+${number}\\b(?!\\s+(?:${unitPattern})\\b))?`, 'giu');
    const found = new Map();
    const passage = String(text || '');
    for (const match of passage.matchAll(pattern)) {
        const unit = words.get(match[2].toLowerCase());
        let amount = countOf(match[1]) * unit.value;
        if (match[3]) {
            const smaller = units.find(candidate => candidate.value < unit.value);
            if (smaller) amount += countOf(match[3]) * smaller.value;
        }
        if (amount > 0) found.set(match[0].toLowerCase(), { text: match[0], amount });
    }
    const penny = units.find(unit => unit.value === 1 && /penny/iu.test(unit.name));
    if (penny) {
        for (const match of passage.matchAll(new RegExp(`\\b(${Object.keys(COUNTED_PENCE).join('|')})\\b`, 'giu'))) {
            found.set(match[0].toLowerCase(), { text: match[0], amount: COUNTED_PENCE[match[0].toLowerCase()] });
        }
    }
    return [...found.values()].map(item => ({ ...item, formatted: formatMoney(item.amount, currency) }));
}

/** Tracked objects PASSAGE names, by full name or head noun, with who holds them. */
export function objectsNamedIn(value, text) {
    const state = readableState(value);
    const passage = String(text || '').toLowerCase();
    const holderName = holder => (holder?.kind === 'player' ? 'the player' : holder?.kind === 'item' ? `inside ${state.items[holder.key]?.name || holder.key}` : holder?.name || 'someone');
    return activeItems(state)
        .filter(item => !item.bodyOf && !item.planned)
        .filter(item => {
            const name = String(item.name || '').toLowerCase();
            const head = name.split(/\s+/u).filter(word => word.length > 2).at(-1);
            return name && (passage.includes(name) || (head && new RegExp(`\\b${escapePattern(head)}s?\\b`, 'u').test(passage)));
        })
        .map(item => ({ key: item.key, name: item.name, holder: holderName(item.holder) }));
}

const EVIDENCE_LISTS = ['objects', 'money', 'standings', 'reputation', 'deaths'];
const plainWords = text => String(text || '').toLowerCase().replace(/[‘’]/gu, "'").replace(/[“”]/gu, '"')
    .replace(/[^\p{L}\p{N}' ]+/gu, ' ').replace(/\s+/gu, ' ').trim();

/**
 * Drop ledger records whose quoted evidence is not in PASSAGE: the quote, or
 * at least three quarters of its words, must be there. A record without
 * evidence is kept.
 */
export function groundedRecords(payload, passage) {
    const text = ` ${plainWords(passage)} `;
    const passageWords = new Set(text.split(' ').filter(Boolean));
    const dropped = [];
    const grounded = evidence => {
        const quote = plainWords(evidence);
        if (!quote || text.includes(` ${quote} `) || text.includes(quote)) return true;
        const words = quote.split(' ').filter(word => word.length > 3);
        if (!words.length) return true;
        return words.filter(word => passageWords.has(word)).length / words.length >= 0.75;
    };
    const result = { ...payload };
    for (const list of EVIDENCE_LISTS) {
        if (!Array.isArray(payload?.[list])) continue;
        result[list] = payload[list].filter(record => {
            const keep = grounded(record?.evidence);
            if (!keep) dropped.push({ list, evidence: cleanString(record?.evidence, 160) });
            return keep;
        });
    }
    return { payload: result, dropped };
}
