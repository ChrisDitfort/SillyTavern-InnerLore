/**
 * Pure state and rendering helpers for InnerLore.
 *
 * This module deliberately has no SillyTavern or DOM dependencies so its canon
 * merge rules can be tested outside the browser.
 */

export const STORE_VERSION = 4;

/**
 * Version of the compact, card-backed expression foundation expected by the
 * live narration path.  Keep this separate from STORE_VERSION so a saved chat
 * cannot look upgraded merely because normalizeStore rewrote its envelope.
 */
// v2 records that readiness was validated as a complete four-part foundation
// and that transactional rebuilds preserve its branch-safe card provenance.
export const EXPRESSION_FOUNDATION_VERSION = 2;

export const ENTITY_TYPES = Object.freeze([
    'character',
    'location',
    'item',
    'faction',
    'organization',
    'creature',
    'event',
    'concept',
]);

export const BRAIN_CATEGORIES = Object.freeze([
    'identity',
    'memory',
    'belief',
    'opinion',
    'desire',
    'fear',
    'goal',
    'plan',
    'secret',
    'relationship',
    'emotion',
    'conflict',
]);

/** Durable first-person identity facets. These are descriptive lenses, not an emotion engine. */
export const PERSISTENT_SELF_KINDS = Object.freeze([
    'personal_anchor',
    'self_concept',
    'trait',
    'value',
    'worldview',
    'fear',
    'insecurity',
    'desire',
    'emotional_need',
    'contradiction',
    'bias',
    'belief',
    'opinion',
    'goal',
    'plan',
    'behavioral_tendency',
    'secret',
    'memory',
    'relationship_stance',
]);

/** Textual habits which let the narrator perform an NPC rather than explain them. */
export const VOICE_KINDS = Object.freeze([
    'vocabulary',
    'formality',
    'cadence',
    'humor',
    'sarcasm',
    'profanity',
    'verbal_habit',
    'hesitation',
    'emotional_openness',
    'thought_style',
    'pressure_shift',
    'emphasis',
    'avoidance',
]);

/** Qualitative, subjective relationship aspects. Several contradictory aspects may coexist. */
export const RELATIONSHIP_ASPECT_KINDS = Object.freeze([
    'trust',
    'affection',
    'respect',
    'fear',
    'resentment',
    'attraction',
    'dependency',
    'belief',
    'expectation',
    'conflict',
    'shared_experience',
]);

export const EMOTIONAL_INTENSITIES = Object.freeze([
    'low',
    'moderate',
    'high',
    'overwhelming',
]);

/** Stable, queryable spatial assertions attached to location records. */
export const SPATIAL_INVARIANT_KINDS = Object.freeze([
    'topology',
    'entrance',
    'connection',
    'fixture',
    'containment',
    'placement',
    'orientation',
    'condition',
    'other',
]);

export const SPATIAL_RELATIONS = Object.freeze([
    'shape',
    'entrance_at',
    'door_at',
    'opens',
    'fixed_to',
    'located_at',
    'beneath',
    'inside',
    'contains',
    'connected_to',
    'adjacent_to',
    'oriented_to',
    'part_of',
    'has_condition',
    'other',
]);

export const THOUGHT_RETENTIONS = Object.freeze([
    'durable',
    'scene',
]);

/** Provenance controls whether a durable psychological field is branch-safe. */
export const PSYCHOLOGY_BASES = Object.freeze([
    'character_card',
    'story',
    'consolidated',
]);

const ENTITY_ARRAY_LIMITS = Object.freeze({
    aliases: 20,
    facts: 80,
    relationships: 40,
    history: 50,
    unresolved: 40,
    keys: 30,
});

const ACTIVE_STATUSES = new Set(['active', 'inactive', 'destroyed', 'lost', 'unknown']);
const CONFIDENCE_VALUES = new Set(['confirmed', 'inferred']);
const THOUGHT_RETENTION_VALUES = new Set(THOUGHT_RETENTIONS);
const DURABLE_THOUGHT_CATEGORIES = new Set([
    'identity',
    'memory',
    'belief',
    'opinion',
    'desire',
    'fear',
    'goal',
    'plan',
    'secret',
    'relationship',
    'conflict',
]);

export function clamp(value, minimum, maximum) {
    const number = Number(value);
    if (!Number.isFinite(number)) return minimum;
    return Math.min(maximum, Math.max(minimum, number));
}

export function cleanString(value, maximumLength = 10_000) {
    if (typeof value !== 'string') return '';
    return value
        .normalize('NFKC')
        .replace(/\u0000/g, '')
        .replace(/[ \t]+/g, ' ')
        .replace(/\s*\n\s*/g, '\n')
        .trim()
        .slice(0, maximumLength)
        .trim();
}

const CONTEXT_STOP_WORDS = new Set([
    'about', 'after', 'again', 'against', 'also', 'among', 'another', 'around', 'because',
    'been', 'before', 'being', 'below', 'between', 'both', 'could', 'does', 'doing', 'down',
    'during', 'each', 'from', 'further', 'have', 'having', 'here', 'hers', 'herself', 'himself',
    'into', 'itself', 'just', 'more', 'most', 'myself', 'once', 'only', 'other', 'otherwise',
    'ours', 'ourselves', 'over', 'same', 'should', 'some', 'such', 'than', 'that', 'their',
    'theirs', 'them', 'themselves', 'then', 'there', 'these', 'they', 'this', 'those', 'through',
    'under', 'until', 'very', 'what', 'when', 'where', 'which', 'while', 'who', 'whom', 'whose',
    'will', 'with', 'would', 'your', 'yours', 'yourself', 'yourselves',
    'and', 'are', 'but', 'can', 'did', 'for', 'had', 'has', 'her', 'him', 'his', 'its', 'may',
    'not', 'our', 'out', 'she', 'the', 'was', 'were', 'you',
    'inner', 'lore', 'canon', 'current', 'overview', 'open', 'relevant', 'state',
]);

function contextStem(value) {
    let token = value.replace(/[’']s$/u, '');
    if (token.length > 6 && token.endsWith('ing')) token = token.slice(0, -3);
    else if (token.length > 5 && token.endsWith('ied')) token = `${token.slice(0, -3)}y`;
    else if (token.length > 5 && token.endsWith('ed')) token = token.slice(0, -2);
    else if (token.length > 5 && token.endsWith('es')) token = token.slice(0, -2);
    else if (token.length > 4 && token.endsWith('s')) token = token.slice(0, -1);
    return token;
}

/** Content words used for deterministic relevance and near-duplicate checks. */
export function contextTokens(value, maximum = 160) {
    const matches = cleanString(value, 200_000).toLocaleLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}'’_-]*/gu) || [];
    const result = [];
    const seen = new Set();
    for (const raw of matches) {
        const token = contextStem(raw.replace(/^[-_]+|[-_]+$/gu, ''));
        if (token.length < 3 || CONTEXT_STOP_WORDS.has(token) || seen.has(token)) continue;
        seen.add(token);
        result.push(token);
        if (result.length >= Math.max(1, maximum)) break;
    }
    return result;
}

/** Lexical containment score in the range 0–1; deliberately local and model-free. */
export function contextSimilarity(left, right) {
    const leftTokens = new Set(contextTokens(left));
    const rightTokens = new Set(contextTokens(right));
    if (!leftTokens.size || !rightTokens.size) return 0;
    let intersection = 0;
    for (const token of leftTokens) if (rightTokens.has(token)) intersection++;
    if (!intersection) return 0;
    const containment = intersection / Math.min(leftTokens.size, rightTokens.size);
    const union = leftTokens.size + rightTokens.size - intersection;
    return Math.max(containment, intersection / Math.max(1, union));
}

/** Clip prompt material at a sentence, clause, or word boundary, never mid-word. */
export function clipAtBoundary(value, maximumLength = 1_000) {
    const text = cleanString(value, 500_000);
    const maximum = Math.max(1, Number(maximumLength) || 1);
    if (text.length <= maximum) return text;
    if (maximum <= 2) return '…'.slice(0, maximum);
    const candidate = text.slice(0, maximum - 1).trimEnd();
    const floor = Math.floor(candidate.length * 0.5);
    const sentenceBreaks = [
        candidate.lastIndexOf('\n'),
        candidate.lastIndexOf('. ') + 1,
        candidate.lastIndexOf('? ') + 1,
        candidate.lastIndexOf('! ') + 1,
        candidate.lastIndexOf('; ') + 1,
        candidate.lastIndexOf(': ') + 1,
    ].filter(index => index >= floor);
    let end = sentenceBreaks.length ? Math.max(...sentenceBreaks) : candidate.lastIndexOf(' ');
    if (end < Math.min(12, floor)) end = candidate.length;
    return `${candidate.slice(0, end).trimEnd().replace(/[,:;\-–—]+$/u, '')}…`;
}

export function normalizeName(value) {
    return cleanString(value, 160)
        .replace(/^["'“”‘’`]+|["'“”‘’`]+$/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}

export function canonicalNameKey(value) {
    return normalizeName(value)
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLocaleLowerCase()
        .replace(/[^\p{L}\p{N}]+/gu, ' ')
        .trim();
}

export function isSummaryceptionGhosted(message) {
    return message?.extra?.sc_ghosted === true;
}

export function normalizeEntityType(value) {
    const raw = canonicalNameKey(value).replace(/\s+/g, '_');
    const aliases = {
        npc: 'character',
        person: 'character',
        people: 'character',
        place: 'location',
        building: 'location',
        region: 'location',
        object: 'item',
        artifact: 'item',
        weapon: 'item',
        group: 'faction',
        guild: 'organization',
        species: 'creature',
        monster: 'creature',
        incident: 'event',
        rule: 'concept',
        custom: 'concept',
    };
    const normalized = aliases[raw] || raw;
    return ENTITY_TYPES.includes(normalized) ? normalized : 'concept';
}

export function entityId(type, name) {
    return `${normalizeEntityType(type)}:${canonicalNameKey(name)}`;
}

export function uniqueStrings(values, limit = 50) {
    const result = [];
    const seen = new Set();
    for (const value of Array.isArray(values) ? values : []) {
        const cleaned = cleanString(value, 1_000);
        const key = canonicalNameKey(cleaned);
        if (!cleaned || !key || seen.has(key)) continue;
        seen.add(key);
        result.push(cleaned);
        if (result.length >= limit) break;
    }
    return result;
}

function removeStrings(values, removals) {
    const removalKeys = new Set(uniqueStrings(removals).map(canonicalNameKey));
    if (!removalKeys.size) return [...values];
    return values.filter(value => !removalKeys.has(canonicalNameKey(value)));
}

function mergeStrings(existing, additions, removals, limit) {
    const kept = removeStrings(uniqueStrings(existing, limit), removals);
    return uniqueStrings([...kept, ...uniqueStrings(additions, limit)], limit);
}

const CHARACTER_DIALOGUE_LEDGER = /^.{0,100}\b(?:admitted|argued|asked|called|claimed|demanded|explained|insisted|offered|promised|questioned|replied|said|stated|thanked|told|warned)\b/iu;

/**
 * Public character facts are durable continuity, not a transcript of what the
 * character said. Dialogue outcomes belong in history/progression, while
 * subjective stances belong in that character's private mind.
 */
export function compactEntityFacts(record, values = record?.facts) {
    const facts = uniqueStrings(values, ENTITY_ARRAY_LIMITS.facts);
    if (normalizeEntityType(record?.type) !== 'character') return facts;
    return facts.filter(value => !CHARACTER_DIALOGUE_LEDGER.test(value));
}

function unresolvedSemanticKey(value, record) {
    let key = canonicalNameKey(value);
    const references = uniqueStrings([record?.name, ...(record?.aliases || [])])
        .map(canonicalNameKey)
        .filter(Boolean)
        .sort((a, b) => b.length - a.length);
    for (const reference of references) {
        key = ` ${key} `.split(` ${reference} `).join(' ').trim();
    }
    const referentialFillers = new Set(['a', 'an', 'the', 'it', 'its', 'this', 'that']);
    const reduced = key.split(/\s+/u).filter(token => token && !referentialFillers.has(token)).join(' ');
    return reduced || canonicalNameKey(value);
}

function mergeUnresolved(existing, additions, removals, record, limit) {
    const exactRemovalKeys = new Set(uniqueStrings(removals).map(canonicalNameKey));
    const semanticRemovalKeys = new Set(uniqueStrings(removals).map(value => unresolvedSemanticKey(value, record)));
    const kept = uniqueStrings(existing, limit).filter(value => (
        !exactRemovalKeys.has(canonicalNameKey(value))
        && !semanticRemovalKeys.has(unresolvedSemanticKey(value, record))
    ));
    const result = [...kept];
    const seen = new Set(kept.map(value => unresolvedSemanticKey(value, record)));
    for (const addition of uniqueStrings(additions, limit)) {
        const key = unresolvedSemanticKey(addition, record);
        if (!key || seen.has(key)
            || result.some(existingValue => contextSimilarity(existingValue, addition) >= 0.78)) continue;
        seen.add(key);
        result.push(addition);
        if (result.length >= limit) break;
    }
    return result;
}

function normalizeSpatialKey(value) {
    return canonicalNameKey(value).replace(/\s+/gu, '_').slice(0, 120);
}

function normalizeSpatialEnum(value, allowed, fallback) {
    const normalized = canonicalNameKey(value).replace(/\s+/gu, '_');
    return allowed.has(normalized) ? normalized : fallback;
}

function keyedSpatialValues(value) {
    if (Array.isArray(value)) return value.map(item => [item?.key, item]);
    if (!value || typeof value !== 'object') return [];
    return Object.entries(value);
}

function normalizeSpatialInvariant(value, fallbackKey = '', messageIndex = -1) {
    const source = typeof value === 'string' ? { statement: value } : value;
    if (!source || typeof source !== 'object') return null;
    const key = normalizeSpatialKey(source.key ?? fallbackKey);
    const subject = cleanString(source.subject, 240);
    const relation = normalizeSpatialEnum(source.relation, SPATIAL_RELATION_VALUES, 'other');
    const object = cleanString(source.object ?? source.target, 500);
    const statement = cleanString(source.statement ?? source.fact ?? source.value, 1_200);
    if (!key || (!statement && !(subject && object))) return null;
    return {
        key,
        kind: normalizeSpatialEnum(source.kind, SPATIAL_INVARIANT_KIND_VALUES, 'other'),
        subject,
        relation,
        object,
        statement: statement || `${subject} ${relation.replaceAll('_', ' ')} ${object}`,
        confidence: normalizeConfidence(source.confidence),
        sourceMessage: Number.isInteger(source.sourceMessage)
            ? source.sourceMessage
            : Number.isInteger(source.source_message) ? source.source_message : messageIndex,
        updatedAt: Math.max(0, Number(source.updatedAt ?? source.updated_at) || Date.now()),
    };
}

/** Normalize keyed spatial assertions without turning ordinary prose into topology. */
export function normalizeEntitySpatial(value, options = {}) {
    const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    const maximum = clamp(options.maximum ?? 80, 1, 200);
    const messageIndex = Number.isInteger(options.messageIndex) ? options.messageIndex : -1;
    const invariants = {};
    for (const [fallbackKey, raw] of keyedSpatialValues(source.invariants ?? source.set ?? source)) {
        const invariant = normalizeSpatialInvariant(raw, fallbackKey, messageIndex);
        if (!invariant) continue;
        invariants[invariant.key] = invariant;
        if (Object.keys(invariants).length >= maximum) break;
    }
    return { invariants };
}

function spatialPatchSet(patch) {
    if (!patch || typeof patch !== 'object') return [];
    return Array.isArray(patch.set)
        ? patch.set
        : keyedSpatialValues(patch.invariants).map(([key, value]) => (
            typeof value === 'string' ? { key, statement: value } : { key, ...value }
        ));
}

function spatialPatchDelete(patch) {
    if (!patch || typeof patch !== 'object') return [];
    return Array.isArray(patch.delete) ? patch.delete : [];
}

function mergeSpatialPatch(existing, patch, options = {}) {
    const state = normalizeEntitySpatial(existing, options);
    const target = state.invariants;
    for (const rawKey of spatialPatchDelete(patch)) {
        const key = normalizeSpatialKey(rawKey);
        if (key) delete target[key];
    }
    for (const [index, raw] of spatialPatchSet(patch).slice(0, 80).entries()) {
        const invariant = normalizeSpatialInvariant(raw, `spatial_${index + 1}`, options.messageIndex);
        if (!invariant) continue;
        const prior = target[invariant.key];
        if (prior
            && prior.kind === invariant.kind
            && prior.subject === invariant.subject
            && prior.relation === invariant.relation
            && prior.object === invariant.object
            && prior.statement === invariant.statement
            && prior.confidence === invariant.confidence) continue;
        target[invariant.key] = invariant;
    }
    return normalizeEntitySpatial(state, options);
}

function normalizeThoughtKey(value) {
    const key = canonicalNameKey(value).replace(/\s+/g, '_').slice(0, 80);
    return key || '';
}

function normalizeThoughtRetention(value, category = 'belief') {
    const normalized = canonicalNameKey(value).replace(/\s+/g, '_');
    if (THOUGHT_RETENTION_VALUES.has(normalized)) return normalized;
    return DURABLE_THOUGHT_CATEGORIES.has(category) ? 'durable' : 'scene';
}

const PERSISTENT_SELF_KIND_VALUES = new Set(PERSISTENT_SELF_KINDS);
const VOICE_KIND_VALUES = new Set(VOICE_KINDS);
const RELATIONSHIP_ASPECT_KIND_VALUES = new Set(RELATIONSHIP_ASPECT_KINDS);
const EMOTIONAL_INTENSITY_VALUES = new Set(EMOTIONAL_INTENSITIES);
const SPATIAL_INVARIANT_KIND_VALUES = new Set(SPATIAL_INVARIANT_KINDS);
const SPATIAL_RELATION_VALUES = new Set(SPATIAL_RELATIONS);
const PSYCHOLOGY_BASIS_VALUES = new Set(PSYCHOLOGY_BASES);

const LEGACY_FACET_KIND = Object.freeze({
    identity: 'self_concept',
    memory: 'memory',
    belief: 'belief',
    opinion: 'opinion',
    desire: 'desire',
    fear: 'fear',
    goal: 'goal',
    plan: 'plan',
    secret: 'secret',
    relationship: 'relationship_stance',
    conflict: 'contradiction',
});

function normalizePsychologyKind(value, allowed, fallback) {
    const kind = canonicalNameKey(value).replace(/\s+/g, '_');
    return allowed.has(kind) ? kind : fallback;
}

function normalizeConfidence(value) {
    const confidence = canonicalNameKey(value);
    return CONFIDENCE_VALUES.has(confidence) ? confidence : 'inferred';
}

function normalizePsychologyBasis(value) {
    const basis = canonicalNameKey(value).replace(/\s+/g, '_');
    return PSYCHOLOGY_BASIS_VALUES.has(basis) ? basis : '';
}

function keyedPsychologyValues(value) {
    if (Array.isArray(value)) return value.map(item => [item?.key, item]);
    if (!value || typeof value !== 'object') return [];
    return Object.entries(value);
}

function normalizePsychologyEntries(value, options = {}) {
    const allowed = options.allowed || PERSISTENT_SELF_KIND_VALUES;
    const fallbackKind = options.fallbackKind || 'belief';
    const maximum = clamp(options.maximum ?? 80, 1, 200);
    const result = {};
    for (const [fallbackKey, raw] of keyedPsychologyValues(value)) {
        const source = typeof raw === 'string' ? { statement: raw } : raw;
        if (!source || typeof source !== 'object') continue;
        const key = normalizeThoughtKey(source.key ?? fallbackKey);
        const statement = cleanString(source.statement ?? source.thought ?? source.value, 1_200);
        if (!key || !statement) continue;
        result[key] = {
            key,
            kind: normalizePsychologyKind(source.kind ?? source.category, allowed, fallbackKind),
            statement,
            confidence: normalizeConfidence(source.confidence),
            basis: normalizePsychologyBasis(source.basis),
            sourceMessage: Number.isInteger(source.sourceMessage)
                ? source.sourceMessage
                : Number.isInteger(source.source_message) ? source.source_message : -1,
            updatedAt: Math.max(0, Number(source.updatedAt ?? source.updated_at) || Date.now()),
        };
        if (Object.keys(result).length >= maximum) break;
    }
    return result;
}

function normalizeDurableCandidates(value, maximum = 40) {
    const result = {};
    for (const [fallbackKey, raw] of keyedPsychologyValues(value)) {
        const source = typeof raw === 'string' ? { statement: raw } : raw;
        if (!source || typeof source !== 'object') continue;
        const key = normalizeThoughtKey(source.key ?? fallbackKey);
        const statement = cleanString(source.statement ?? source.thought ?? source.value, 1_200);
        if (!key || !statement) continue;
        result[key] = {
            key,
            kind: normalizePsychologyKind(source.kind, PERSISTENT_SELF_KIND_VALUES, 'belief'),
            statement,
            confidence: normalizeConfidence(source.confidence),
            observations: clamp(source.observations ?? 1, 1, 20),
            firstSourceMessage: Number.isInteger(source.firstSourceMessage)
                ? source.firstSourceMessage
                : Number.isInteger(source.first_source_message) ? source.first_source_message : -1,
            lastSourceMessage: Number.isInteger(source.lastSourceMessage)
                ? source.lastSourceMessage
                : Number.isInteger(source.last_source_message) ? source.last_source_message : -1,
            updatedAt: Math.max(0, Number(source.updatedAt ?? source.updated_at) || Date.now()),
        };
        if (Object.keys(result).length >= maximum) break;
    }
    return result;
}

function normalizeRelationshipRecord(value, fallbackTarget = '') {
    const source = value && typeof value === 'object' ? value : {};
    const target = normalizeName(source.target || fallbackTarget);
    if (!target) return null;
    return {
        id: canonicalNameKey(target),
        target,
        aliases: uniqueStrings(source.aliases, 20)
            .filter(alias => canonicalNameKey(alias) !== canonicalNameKey(target)),
        aspects: normalizePsychologyEntries(source.aspects, {
            allowed: RELATIONSHIP_ASPECT_KIND_VALUES,
            fallbackKind: 'belief',
            maximum: 24,
        }),
        firstSeenMessage: Number.isInteger(source.firstSeenMessage)
            ? source.firstSeenMessage
            : Number.isInteger(source.first_seen_message) ? source.first_seen_message : -1,
        lastUpdatedMessage: Number.isInteger(source.lastUpdatedMessage)
            ? source.lastUpdatedMessage
            : Number.isInteger(source.last_updated_message) ? source.last_updated_message : -1,
        revision: Math.max(0, Number(source.revision) || 0),
        createdAt: Math.max(0, Number(source.createdAt ?? source.created_at) || Date.now()),
        updatedAt: Math.max(0, Number(source.updatedAt ?? source.updated_at) || Date.now()),
    };
}

function normalizeRelationships(value, maximum = 30) {
    const pairs = Array.isArray(value)
        ? value.map(item => [item?.target, item])
        : value && typeof value === 'object' ? Object.entries(value) : [];
    const result = {};
    for (const [fallbackTarget, raw] of pairs) {
        const relationship = normalizeRelationshipRecord(raw, fallbackTarget);
        if (!relationship) continue;
        result[relationship.id] = relationship;
        if (Object.keys(result).length >= maximum) break;
    }
    return result;
}

function normalizeEmotion(value) {
    const source = typeof value === 'string' ? { name: value } : value;
    if (!source || typeof source !== 'object') return null;
    const name = cleanString(source.name ?? source.emotion, 100);
    if (!name) return null;
    const intensity = canonicalNameKey(source.intensity).replace(/\s+/g, '_');
    return {
        name,
        intensity: EMOTIONAL_INTENSITY_VALUES.has(intensity) ? intensity : 'moderate',
        cause: cleanString(source.cause, 500),
    };
}

/** Normalize the replaceable, transient subjective lens for one completed scene. */
export function normalizeCurrentMind(value, options = {}) {
    if (!value || typeof value !== 'object') return null;
    const fallbackMessageIndex = Number.isInteger(options.messageIndex) ? options.messageIndex : -1;
    const sourceMessage = Number.isInteger(value.sourceMessage)
        ? value.sourceMessage
        : Number.isInteger(value.source_message) ? value.source_message : fallbackMessageIndex;
    const current = {
        perception: cleanString(value.perception, 1_000),
        interpretation: cleanString(value.interpretation, 1_000),
        emotions: (Array.isArray(value.emotions) ? value.emotions : [])
            .map(normalizeEmotion)
            .filter(Boolean)
            .slice(0, 5),
        attention: cleanString(value.attention ?? value.focus, 500),
        expectation: cleanString(value.expectation, 700),
        immediateGoal: cleanString(value.immediateGoal ?? value.immediate_goal, 700),
        relevantMemoryKeys: uniqueStrings(
            value.relevantMemoryKeys ?? value.relevant_memory_keys,
            8,
        ).map(normalizeThoughtKey).filter(Boolean),
        innerThoughts: uniqueStrings(value.innerThoughts ?? value.inner_thoughts, 4),
        impulse: cleanString(value.impulse, 700),
        restraint: cleanString(value.restraint, 700),
        conflict: cleanString(value.conflict ?? value.internal_conflict, 900),
        intention: cleanString(value.intention ?? value.decision, 700),
        sourceMessage,
        updatedAt: Math.max(0, Number(value.updatedAt ?? value.updated_at) || Date.now()),
    };
    const meaningful = current.perception || current.interpretation || current.emotions.length
        || current.attention || current.expectation || current.immediateGoal
        || current.innerThoughts.length || current.impulse || current.restraint
        || current.conflict || current.intention;
    return meaningful ? current : null;
}

/** Count compact psychological records without treating a current-mind snapshot as a memory ledger. */
export function brainPsychologyCount(brain) {
    const selfCount = Object.keys(brain?.persistentSelf?.facets || {}).length;
    const voiceCount = Object.keys(brain?.persistentSelf?.voice || {}).length;
    const relationshipCount = Object.values(brain?.persistentSelf?.relationships || {})
        .reduce((sum, relationship) => sum + Object.keys(relationship?.aspects || {}).length, 0);
    return selfCount + voiceCount + relationshipCount + (brain?.currentMind ? 1 : 0);
}

/**
 * Normalize a v2 NPC brain. Durable legacy thoughts are migrated once into
 * Persistent Self; scene-local legacy thoughts are deliberately discarded so
 * old momentary reactions do not become permanent memories.
 */
export function normalizeBrainRecord(value, fallbackName = '') {
    const source = value && typeof value === 'object' ? value : {};
    const name = normalizeName(source.name || fallbackName);
    if (!name) return null;
    const persistentSource = source.persistentSelf ?? source.persistent_self;
    const persistentObject = persistentSource && typeof persistentSource === 'object' ? persistentSource : {};
    const facets = normalizePsychologyEntries(persistentObject.facets, {
        allowed: PERSISTENT_SELF_KIND_VALUES,
        fallbackKind: 'belief',
        maximum: 80,
    });

    // Import only durable psychological meaning from the old flat ledger.
    // This adapter is intentionally one-way: normalized brains never retain a
    // parallel `thoughts` structure.
    for (const thought of Object.values(source.thoughts || {})) {
        if (!thought || typeof thought !== 'object') continue;
        const category = normalizePsychologyKind(thought.category, new Set(BRAIN_CATEGORIES), 'belief');
        if (category === 'emotion' || normalizeThoughtRetention(thought.retention, category) !== 'durable') continue;
        const key = normalizeThoughtKey(thought.key);
        const statement = cleanString(thought.thought ?? thought.value, 1_200);
        if (!key || !statement || facets[key]) continue;
        facets[key] = {
            key,
            kind: LEGACY_FACET_KIND[category] || 'belief',
            statement,
            confidence: normalizeConfidence(thought.confidence),
            basis: normalizePsychologyBasis(thought.basis),
            sourceMessage: Number.isInteger(thought.sourceMessage) ? thought.sourceMessage : -1,
            updatedAt: Math.max(0, Number(thought.updatedAt) || Date.now()),
        };
    }

    return {
        psychologyVersion: 2,
        id: canonicalNameKey(name),
        name,
        identityKind: normalizeIdentityKind(source.identityKind ?? source.identity_kind),
        aliases: uniqueStrings(source.aliases, 20)
            .filter(alias => canonicalNameKey(alias) !== canonicalNameKey(name)),
        persistentSelf: {
            facets,
            voice: normalizePsychologyEntries(persistentObject.voice, {
                allowed: VOICE_KIND_VALUES,
                fallbackKind: 'thought_style',
                maximum: 40,
            }),
            relationships: normalizeRelationships(persistentObject.relationships, 30),
        },
        durableCandidates: normalizeDurableCandidates(source.durableCandidates ?? source.durable_candidates),
        consolidation: {
            totalMerged: Math.max(0, Number(source.consolidation?.totalMerged) || 0),
            lastMerged: Math.max(0, Number(source.consolidation?.lastMerged) || 0),
            lastMessage: Number.isInteger(source.consolidation?.lastMessage)
                ? source.consolidation.lastMessage
                : -1,
            updatedAt: Math.max(0, Number(source.consolidation?.updatedAt) || 0),
        },
        currentMind: normalizeCurrentMind(source.currentMind ?? source.current_mind),
        active: source.active !== false,
        enabled: source.enabled !== false,
        pinned: Boolean(source.pinned),
        firstSeenMessage: Number.isInteger(source.firstSeenMessage) ? source.firstSeenMessage : -1,
        lastSeenMessage: Number.isInteger(source.lastSeenMessage) ? source.lastSeenMessage : -1,
        revision: Math.max(0, Number(source.revision) || 0),
        createdAt: Math.max(0, Number(source.createdAt) || Date.now()),
        updatedAt: Math.max(0, Number(source.updatedAt) || Date.now()),
    };
}

export function createEmptyStore(chatId = '') {
    return {
        version: STORE_VERSION,
        // This constructor is also used for already-initialized transactional
        // working stores. normalizeStore deliberately resets a missing or
        // pre-v4 saved envelope to 0, so a brand-new chat still has to earn
        // readiness through a real curator pass.
        expressionFoundationVersion: EXPRESSION_FOUNDATION_VERSION,
        chatId: cleanString(chatId, 300),
        lorebookName: '',
        entities: {},
        brains: {},
        progression: null,
        lastProcessedIndex: -1,
        processedFingerprints: {},
        checkpoints: [],
        assistantTurnsSincePass: 0,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        lastRunAt: 0,
        lastRunStats: null,
        lastError: '',
        lastFailureAt: 0,
        consecutiveFailures: 0,
        nextRetryAt: 0,
        lastOutputRecovery: null,
        needsRebuild: false,
    };
}

export function normalizeStore(value, chatId = '') {
    const base = createEmptyStore(chatId);
    const source = value && typeof value === 'object' ? value : {};
    const sourceStoreVersion = Math.max(0, Number(source.version) || 0);
    const store = { ...base, ...source };
    store.version = STORE_VERSION;
    // Stores written before v4 predate mandatory card-backed thought,
    // outward-voice, emphasis, and personal-anchor foundations.  Do not grant
    // them the new capability version simply by normalizing the JSON wrapper;
    // index.js will rebuild them before a story request relies on those fields.
    store.expressionFoundationVersion = sourceStoreVersion >= STORE_VERSION
        ? Math.max(0, Number(source.expressionFoundationVersion) || 0)
        : 0;
    store.chatId = cleanString(store.chatId || chatId, 300);
    store.lorebookName = cleanString(store.lorebookName, 180);
    store.entities = store.entities && typeof store.entities === 'object' ? store.entities : {};
    for (const record of Object.values(store.entities)) {
        if (!record || typeof record !== 'object') continue;
        if (normalizeEntityType(record.type) === 'location') {
            record.spatial = normalizeEntitySpatial(record.spatial, {
                messageIndex: Number.isInteger(record.lastSeenMessage) ? record.lastSeenMessage : -1,
            });
        }
    }
    reconcileCanonicalEntities(store);
    const rawBrains = store.brains && typeof store.brains === 'object' ? store.brains : {};
    store.brains = {};
    for (const [fallbackName, rawBrain] of Object.entries(rawBrains)) {
        const brain = normalizeBrainRecord(rawBrain, fallbackName);
        if (brain) store.brains[brain.id] = brain;
    }
    store.progression = store.progression && typeof store.progression === 'object' ? store.progression : null;
    store.processedFingerprints = store.processedFingerprints && typeof store.processedFingerprints === 'object'
        ? store.processedFingerprints
        : {};
    store.lastProcessedIndex = Number.isInteger(store.lastProcessedIndex) ? store.lastProcessedIndex : -1;
    store.checkpoints = Array.isArray(store.checkpoints)
        ? store.checkpoints.filter(checkpoint => checkpoint && typeof checkpoint === 'object' && Number.isInteger(checkpoint.index))
        : [];
    store.assistantTurnsSincePass = Math.max(0, Number(store.assistantTurnsSincePass) || 0);
    store.lastError = cleanString(store.lastError, 2_000);
    store.lastFailureAt = Math.max(0, Number(store.lastFailureAt) || 0);
    store.consecutiveFailures = Math.max(0, Number(store.consecutiveFailures) || 0);
    store.nextRetryAt = Math.max(0, Number(store.nextRetryAt) || 0);
    store.lastOutputRecovery = store.lastOutputRecovery && typeof store.lastOutputRecovery === 'object'
        ? store.lastOutputRecovery
        : null;
    store.needsRebuild = Boolean(store.needsRebuild);
    return store;
}

/**
 * Build a conservative, read-only prompt view of the state that existed before
 * a changed assistant message. SillyTavern emits MESSAGE_SWIPED before it
 * starts the replacement generation, so fully quarantining the store at that
 * point would make the reswipe run without any NPC mind at all.
 *
 * This is not a reconstructed persistent store. It deliberately drops records
 * whose only known value may have come from the discarded suffix, and it never
 * carries World Progression forward. The normal history rebuild remains the
 * authority after the replacement response arrives.
 */
export function createHistoryPrefixPromptStore(value, changedIndex) {
    const boundary = Math.max(0, Number.isInteger(changedIndex) ? changedIndex : 0);
    const source = normalizeStore(value, value?.chatId || '');
    const store = typeof structuredClone === 'function'
        ? structuredClone(source)
        : JSON.parse(JSON.stringify(source));
    const beforeBoundary = messageIndex => !Number.isInteger(messageIndex)
        || messageIndex < 0
        || messageIndex < boundary;

    // Entity records do not yet retain field-level provenance. Keep explicit
    // manual overrides, but otherwise omit any record touched in the changed
    // suffix rather than risk leaking discarded canon into the replacement.
    store.entities = Object.fromEntries(Object.entries(store.entities || {}).filter(([, record]) => (
        record?.manualOverride === true
        || (beforeBoundary(record?.firstSeenMessage) && beforeBoundary(record?.lastSeenMessage))
    )));

    const filteredBrains = {};
    for (const [id, brain] of Object.entries(store.brains || {})) {
        const hasCardPsychology = [
            ...Object.values(brain?.persistentSelf?.facets || {}),
            ...Object.values(brain?.persistentSelf?.voice || {}),
            ...Object.values(brain?.persistentSelf?.relationships || {})
                .flatMap(relationship => Object.values(relationship?.aspects || {})),
        ].some(entry => entry?.basis === 'character_card');
        if (!beforeBoundary(brain?.firstSeenMessage) && !hasCardPsychology) continue;
        const keepPsychologyEntries = entries => Object.fromEntries(
            Object.entries(entries || {}).filter(([, entry]) => (
                entry?.basis === 'character_card' || beforeBoundary(entry?.sourceMessage)
            )),
        );
        brain.persistentSelf = brain.persistentSelf && typeof brain.persistentSelf === 'object'
            ? brain.persistentSelf
            : { facets: {}, voice: {}, relationships: {} };
        brain.persistentSelf.facets = keepPsychologyEntries(brain.persistentSelf.facets);
        brain.persistentSelf.voice = keepPsychologyEntries(brain.persistentSelf.voice);
        brain.persistentSelf.relationships = Object.fromEntries(
            Object.entries(brain.persistentSelf.relationships || {}).flatMap(([relationshipId, relationship]) => {
                relationship.aspects = keepPsychologyEntries(relationship?.aspects);
                if (!beforeBoundary(relationship?.firstSeenMessage)
                    && !Object.values(relationship.aspects).some(entry => entry?.basis === 'character_card')) return [];
                return Object.keys(relationship.aspects).length ? [[relationshipId, relationship]] : [];
            }),
        );
        if (!beforeBoundary(brain.currentMind?.sourceMessage)) brain.currentMind = null;
        const lastSeenMessage = Number.isInteger(brain.lastSeenMessage) ? brain.lastSeenMessage : -1;
        brain.lastSeenMessage = Math.min(lastSeenMessage, boundary - 1);
        const hasPersistentSelf = Object.keys(brain.persistentSelf.facets).length
            || Object.keys(brain.persistentSelf.voice).length
            || Object.keys(brain.persistentSelf.relationships).length;
        if (hasPersistentSelf || brain.currentMind) filteredBrains[id] = brain;
    }
    store.brains = filteredBrains;

    // Progression clocks and records are accumulative and cannot be rolled
    // back safely from only their latest value. Omitting them for one reswipe
    // is safer than delivering an event from a discarded branch.
    store.progression = null;
    store.processedFingerprints = Object.fromEntries(
        Object.entries(store.processedFingerprints || {})
            .filter(([index]) => Number(index) < boundary),
    );
    store.lastProcessedIndex = Math.min(store.lastProcessedIndex, boundary - 1);
    store.assistantTurnsSincePass = 0;
    store.needsRebuild = false;
    return store;
}

/**
 * Identify endings that strongly indicate a provider stopped in the middle of
 * prose. This deliberately ignores length: a short reply may be complete, and
 * a long reply can still be severed during its final sentence.
 *
 * @param {unknown} value Generated story text
 * @returns {string} A diagnostic reason, or an empty string for a plausible ending
 */
export function incompleteProseReason(value) {
    const text = cleanString(value, 120_000).trim();
    if (!text) return 'empty output';

    const tail = text.slice(-320).trim();
    // Balance delimiters over the whole reply. Counting only the tail can
    // begin inside a valid quotation and misclassify its closing mark.
    const count = character => [...text].filter(value => value === character).length;
    const unmatchedPairs = [
        ['“', '”', 'unclosed quotation'],
        ['(', ')', 'unclosed parenthesis'],
        ['[', ']', 'unclosed bracket'],
        ['{', '}', 'unclosed brace'],
    ];
    for (const [opening, closing, reason] of unmatchedPairs) {
        if (count(opening) > count(closing)) return reason;
    }

    const straightQuotes = (text.match(/(?<!\\)"/gu) || []).length;
    if (straightQuotes % 2 === 1) return 'unclosed quotation';

    if (/[,:;([{]\s*$/u.test(tail)) return 'unfinished punctuation';
    if (/\b(?:a|an|the|and|or|but|because|if|when|while|that|which|who|whose|is|are|was|were|be|been|being|to|of|for|from|with|without|at|in|on|by|into|onto|than|then|this|these|those|my|your|his|her|their|our|its)\s*$/iu.test(tail)) {
        return 'trailing connector';
    }

    if (text.length < 20) return '';

    // Complete roleplay prose normally ends in sentence punctuation, a closed
    // quotation, or a Markdown emphasis marker. An alphanumeric tail is a
    // strong cutoff signal under InnerLore's "finish every sentence" contract.
    if (!/[.!?…"'’”)}\]*_`]$/u.test(tail)) return 'missing terminal punctuation';
    return '';
}

/**
 * Reject output that exposes narrator-only control text as well as output that
 * was cut off. Providers occasionally prepend a system instruction verbatim
 * before otherwise valid prose; a complete sentence check cannot catch that.
 * Keep the signatures deliberately narrow so ordinary story dialogue about
 * instructions or word counts is not treated as a failed generation.
 *
 * @param {unknown} value Generated story text
 * @returns {string} A diagnostic reason, or an empty string for usable prose
 */
export function generatedProseIssue(value) {
    const text = cleanString(value, 120_000).trim();
    if (!text) return 'empty output';

    if (/<\/?(?:inner_lore_[a-z0-9_]+|context_contract|latest_turn_contract|turn_source_attribution|literal_expression_gate|expression_style_guidance|private_specificity_gate|surface_novelty_gate|final_surface_validation)\b/iu.test(text)
        || /\b(?:priority|narrator_only|mandatory|identity_policy)=["'](?:hard|soft|absolute|true|false|supplied_only)["']/iu.test(text)) {
        return 'internal prompt markup exposed';
    }

    const instructionLine = /(?:^|\n)\s*(?:#{1,6}\s*)?(?:(?:(?:aim for|finish in|write|respond in|target)\s+(?:roughly\s+)?|keep (?:the |your )?(?:reply|response)\s+(?:to\s+)?)\d+\s*[–—-]\s*\d+(?:\s*words?\b|(?=[A-Z]))|never write the player character(?:'|’)s (?:dialogue|thoughts?|decisions?|actions?)\b|do not prematurely resolve the scene\b|do not recap the user(?:'|’)s action\b|do not (?:quote|paraphrase) the user(?:'|’)s message\b|key facts from the latest user turn\b|facts about the world as currently established\b|write the next turn of (?:an?\s+)?(?:immersive\s+)?roleplay\b|the following editor-authored event\b|these are user-authored director events\b|begin or concretely establish every listed event\b|case stress is required in this reply\b|required lens terms\b|control data\s*[—:-]\s*never quote\b)/iu;
    if (instructionLine.test(text.slice(0, 1_500))) return 'prompt instruction echo';

    const leading = text.slice(0, 400);
    if (/^aim\s+for\s+(?:roughly\s+|about\s+|approximately\s+)?\d{2,4}(?=[A-Z]|\b)/iu.test(leading)) {
        return 'prompt instruction echo';
    }
    const leadingMetaInstruction = /^(?:(?:do not|never)\s+(?:(?:write|invent|supply|control|decide|choose)\b[^\n]{0,180}\b(?:player|user|character|dialogue|thought|decision|move|reaction)\b|(?:quote|paraphrase|recap|mention|expose)\b[^\n]{0,180}\b(?:prompt|instruction|control|user|message)\b|(?:prematurely\s+)?(?:resolve|conclude|finish)\b[^\n]{0,120}\b(?:scene|story|reply|beat)\b)|(?:leave|keep)\s+(?:the\s+)?scene\s+(?:open|unresolved)\b|(?:preserve|respect)\b[^\n]{0,120}\bplayer agency\b)/iu;
    if (leadingMetaInstruction.test(leading)) return 'prompt instruction echo';

    // Some providers concatenate a much broader turn-contract directive
    // directly onto otherwise natural prose (without a newline or space).
    // Restrict this grammar to the absolute beginning so quoted dialogue and
    // ordinary discussion of writing instructions remain valid story text.
    const leadingContractDirective = /^(?:\s*(?:[-*]\s*)?)(?:do not (?:end\b[^\n]{0,100}\b(?:sentence|quotation|dialogue|action)|preempt\b[^\n]{0,100}\b(?:user|player)|start\b[^\n]{0,100}\b(?:name|card)|begin\b[^\n]{0,100}\bmeta-commentary|include\b[^\n]{0,160}\b(?:draft|revision|schema|benchmark|contract|trigger|event|block|packet|instruction)|reveal\b[^\n]{0,120}\b(?:private|narrator|state)|reference\b[^\n]{0,120}\b(?:system|control|prompt)|write\b[^\n]{0,160}\b(?:player|user|rowan)(?:'|’)s\b)|never (?:end\b[^\n]{0,100}\b(?:unfinished|quotation|dash|ellipsis|dialogue)|mention\b[^\n]{0,160}\b(?:control|schema|context|benchmark|target|trigger|system)|replay\b[^\n]{0,120}\bcompleted)|keep (?:the |your )?(?:reply|response)\b[^\n]{0,120}\b(?:words?|range|roughly|around|within)|use vivid,? concrete detail\b|leave (?:the )?(?:next turn|scene)\b[^\n]{0,100}\b(?:open|unresolved)|no meta-commentary\b|avoid quoted strings?\b[^\n]{0,100}\bcontrol|advance one meaningful beat\b|continue unfinished actions?\b[^\n]{0,120}\b(?:scene|time)|after reading the full history\b|your last reply was flagged as invalid\b)/iu;
    if (leadingContractDirective.test(leading)) return 'prompt instruction echo';

    return incompleteProseReason(text);
}

const OPTION_COUNT_WORDS = Object.freeze({
    one: 1,
    two: 2,
    three: 3,
    four: 4,
    five: 5,
    six: 6,
    seven: 7,
    eight: 8,
    nine: 9,
    ten: 10,
});

function expectedOptionCount(value) {
    const match = cleanString(value, 8_000).match(
        /\b(one|two|three|four|five|six|seven|eight|nine|ten|\d{1,2})\s+(?:fixed\s+|possible\s+|valid\s+|allowed\s+|only\s+)?(?:options?|choices?|alternatives?)\b/iu,
    );
    if (!match) return 0;
    const count = OPTION_COUNT_WORDS[match[1].toLocaleLowerCase()] ?? Number(match[1]);
    return count >= 2 && count <= 10 ? count : 0;
}

function cleanOptionLabel(value) {
    return cleanString(value, 160)
        .replace(/^(?:are|is|between|either|only|namely|choose|select|pick)\s+/iu, '')
        .replace(/^[\s:;,.\-–—|/]+|[\s:;,.!?\-–—|/]+$/gu, '')
        .replace(/^["'“”‘’`]+|["'“”‘’`]+$/gu, '')
        .trim();
}

/**
 * Conservatively extract a closed set of user-authored choices. Natural uses
 * of "or" are ignored unless the user also marks the list as fixed (for
 * example "Two options", "the only choices", or "choose between").
 */
export function extractExplicitChoiceSet(value) {
    const text = cleanString(value, 8_000);
    if (!text) return [];

    const expectedCount = expectedOptionCount(text);
    const closedSetSignal = Boolean(expectedCount)
        || /\b(?:the\s+)?only\s+(?:valid\s+|allowed\s+)?(?:options?|choices?|alternatives?)\b/iu.test(text)
        || /\b(?:choose|select|pick|decide|vote)\s+(?:only\s+)?between\b/iu.test(text)
        || /\b(?:options?|choices?|alternatives?)\s*(?:are|:)\s*(?:either\s+)?/iu.test(text);
    if (!closedSetSignal) return [];

    let searchStart = 0;
    const countSignal = text.match(
        /\b(?:one|two|three|four|five|six|seven|eight|nine|ten|\d{1,2})\s+(?:fixed\s+|possible\s+|valid\s+|allowed\s+|only\s+)?(?:options?|choices?|alternatives?)\b/iu,
    );
    const namedSignal = text.match(
        /\b(?:(?:the\s+)?only\s+(?:valid\s+|allowed\s+)?(?:options?|choices?|alternatives?)|(?:choose|select|pick|decide|vote)\s+(?:only\s+)?between|(?:options?|choices?|alternatives?)\s*(?:are|:))/iu,
    );
    const signal = countSignal || namedSignal;
    if (signal) searchStart = signal.index + signal[0].length;

    let remainder = text.slice(searchStart).replace(/^[\s:;,.\-–—]+/u, '').trim();
    if (!remainder) return [];

    // A count may be stated as its own sentence: "Two options. A or B."
    // Limit parsing to the immediately following clause so later prose cannot
    // accidentally become part of an option label.
    const clauseMatch = remainder.match(/^([^\n.!?]+)(?:[.!?]|$)/u);
    const clause = cleanString(clauseMatch?.[1] || remainder, 1_000);
    if (!clause) return [];

    const quoted = [...clause.matchAll(/["“”'‘’]([^"“”'‘’]{1,160})["“”'‘’]/gu)]
        .map(match => cleanOptionLabel(match[1]))
        .filter(Boolean);
    let labels = quoted.length >= 2
        ? quoted
        : clause.split(/\s*(?:,|;|\||\/|\bor\b|\bversus\b|\bvs\.?\b)\s*/iu)
            .map(cleanOptionLabel)
            .filter(Boolean);

    labels = uniqueStrings(labels, 10);
    if (labels.length < 2) return [];
    if (expectedCount && labels.length !== expectedCount) return [];
    if (labels.some(label => label.length > 120 || label.split(/\s+/u).length > 16)) return [];
    return labels;
}

/**
 * Build a high-salience, scenario-independent contract for the next story
 * generation. It quotes the newest user turn and, only when explicit syntax is
 * present, makes its closed option set machine-obvious near the end of context.
 */
export function buildLatestTurnContract(messages, options = {}) {
    const chat = Array.isArray(messages) ? messages : [];
    const latestUser = [...chat].reverse().find(message => (
        message?.is_user
        && (!message.is_system || message.extra?.sc_ghosted === true)
        && cleanString(message.mes)
    ));
    if (!latestUser) return '';

    const latestText = cleanString(latestUser.mes, 4_000);
    const playerName = cleanString(options.playerName || latestUser.name, 160) || 'the player character';
    const choices = extractExplicitChoiceSet(latestText);
    const lines = [
        '<latest_turn_contract priority="immediate">',
        'The newest user turn below is the immediate authority for this reply. Follow it literally when it conflicts with older assistant suggestions.',
        '<turn_source_attribution priority="hard">',
        `PLAYER CHARACTER: ${JSON.stringify(playerName)}.`,
        'The user-message envelope is hard source metadata. In the newest user turn, every otherwise-unattributed first-person statement, bare roleplay action, and standalone quoted line is spoken or performed by the player character above.',
        'A character name or title used only in direct address is the recipient, not the speaker. Never transfer the player character\'s dialogue, gratitude, question, decision, reaction, or action to the character being addressed or to any nearby NPC.',
        'Assign a clause to another character only when the user explicitly makes that character or role its grammatical actor or speaker, labels their dialogue, or gives an unmistakable narration direction about them. That local override does not change ownership of the rest of the user turn.',
        'NPCs must respond to the actual speaker or actor and use the correct form of address. A later story reply cannot retroactively change who authored or performed the user turn.',
        '</turn_source_attribution>',
        '<latest_user_turn_verbatim>',
        latestText,
        '</latest_user_turn_verbatim>',
    ];
    if (choices.length) {
        lines.push(
            `CLOSED CHOICE SET (${choices.length}): ${choices.map(choice => JSON.stringify(choice)).join(' | ')}`,
            'Use these exact user-authored labels. Every earlier alternative outside this set is invalid for the requested decision; do not rename, normalize, merge, or substitute an option. Do not mention or smuggle a superseded alternative back in as a destination, mechanism, consequence, synonym, gloss, definition, or implementation of an allowed label. If a label\'s meaning has not been established, render it as the bare label without an appositive, em-dash explanation, inferred consequence, or invented definition.',
        );
    }
    if (/\b(?:no\s+objections?|accept(?:s|ed|ing)?\s+(?:the|any|whatever)\s+(?:result|decision|outcome)|abide\s+by|defer\s+to|yield\s+to|leave\s+(?:it|this|the\s+decision)\s+to)\b/iu.test(latestText)) {
        lines.push('USER HAS YIELDED TO THE OUTCOME: Resolve the requested process without asking the user to vote, break a tie, choose again, approve the result, or supply another decision. Do not manufacture a deadlock that merely returns the yielded choice to the user.');
    }
    if (/\b(?:vote|voting|ballot|tally|poll)\b/iu.test(latestText)) {
        lines.push('MANDATORY OUTCOME THIS TURN: Complete the requested vote, state the final tally, and identify the winning option before stopping. A few sample votes followed by suspense is not a completed reply. Every counted vote must be attributable to a proper-named voter portrayed in this reply, and the stated tally must match those votes. Portray the necessary NPC votes without inventing a choice for the user.');
    } else if (/\b(?:decide|decision|judg(?:e|ment)|select(?:ion)?|choose|choice|test|trial|check|result|outcome)\b/iu.test(latestText)) {
        lines.push('MANDATORY OUTCOME THIS TURN: Carry the requested procedure through to its clear result before stopping. Do not replace an available result with suspense or a partial sample.');
    }
    const identityPlaceholders = uniqueStrings(options.identityPlaceholders, 8);
    if (identityPlaceholders.length) {
        lines.push(
            `REQUIRED IDENTITY REPAIRS: ${identityPlaceholders.map(name => JSON.stringify(name)).join(' | ')}`,
            'InnerLore has identified these as stable role/descriptor placeholders without an established public proper name. If any such person appears, first reveal a fitting stable public name together with the existing role in the form “Name, the Role,” then use that identity consistently. The existing lore and private-mind notes belong to the same person and transfer to the revealed name. Do not force a name when the story deliberately establishes concealed, unknown, or canonical anonymity.',
        );
    }
    if (options.expressionSurfaceCooldown) {
        lines.push(
            '<surface_novelty_gate priority="hard" narrator_only="true">',
            'InnerLore supplied recent-expression excerpts as a surface cooldown. Keep the NPC\'s underlying mind continuous, but do not repeat a cooled gesture, prop interaction, gaze beat, bodily tell, metaphor, self-command, dialogue scaffold, stammer pattern, or conspicuous phrase simply because it expressed the trait before.',
            'A persistent anchor is an interpretive lens, not an instruction to mention or touch the same object every turn. If a supplied Current Mind line itself contains a cooled realization, preserve its motive, conflict, or intention and invent a different character-compatible manifestation. Reuse only for an explicit new trigger whose callback escalates, changes meaning, or pays off.',
            'Surface novelty must not flatten personality: replace the spent realization with fresh concrete behaviour, private inference, syntax, restraint, or task-directed action that still belongs recognizably to this NPC.',
            '</surface_novelty_gate>',
        );
    }
    const expressionEmphasisAnchor = cleanString(options.expressionEmphasisAnchor, 500);
    if (options.expressionCaseStressRequired) {
        lines.push(
            '<expression_style_guidance priority="soft" narrator_only="true">',
            ...(expressionEmphasisAnchor ? [`INDIVIDUAL SURFACE POLICY: ${JSON.stringify(expressionEmphasisAnchor)}.`] : []),
            'The newest event places the focal NPC under pressure supported by this individual policy. When it reads naturally, prefer one sparse case shift inside direct private thought and another character-specific construction change such as interruption, repetition, fragmentation, punctuation, lower-case compression, or sentence-length shift.',
            'This is expressive guidance, not a literal completion condition. Preserve psychological truth, continuity, readability, and the player\'s agency ahead of any typographic device; never capitalize a whole passage or expose prompt terminology.',
            '</expression_style_guidance>',
        );
    } else if (options.expressionCaseStressPermitted) {
        lines.push(
            '<expression_style_guidance priority="soft" narrator_only="true">',
            ...(expressionEmphasisAnchor ? [`INDIVIDUAL SURFACE POLICY: ${JSON.stringify(expressionEmphasisAnchor)}.`] : []),
            'Use the individual surface policy only when the newest event supplies its pressure. Case contrast, interruption, repetition, fragments, punctuation, or sentence-length shifts are optional tools rather than a checklist. If the trigger is absent, keep the typography restrained. Keep every mark character-specific and sparse; never expose prompt terminology.',
            '</expression_style_guidance>',
        );
    }
    const expressionAnchor = cleanString(options.expressionIdentityAnchor, 500);
    const expressionVoiceAnchor = cleanString(options.expressionVoiceAnchor, 500);
    const expressionOuterVoiceAnchor = cleanString(options.expressionOuterVoiceAnchor, 500);
    const expressionTerms = uniqueStrings(options.expressionAnchorTerms, 5)
        .map(term => cleanString(term, 80))
        .filter(Boolean);
    if (expressionAnchor) {
        const expressionCharacter = cleanString(options.expressionCharacterName, 160) || 'the focal NPC';
        lines.push(
            '<private_specificity_gate priority="hard" narrator_only="true">',
            `FOCAL NPC: ${JSON.stringify(expressionCharacter)}.`,
            `STABLE PRIVATE LENS: ${JSON.stringify(expressionAnchor)}.`,
            ...(expressionVoiceAnchor ? [`INDIVIDUAL THOUGHT FORM: ${JSON.stringify(expressionVoiceAnchor)}.`] : []),
            ...(expressionOuterVoiceAnchor ? [`INDIVIDUAL SPOKEN FORM: ${JSON.stringify(expressionOuterVoiceAnchor)}.`] : []),
            ...(expressionEmphasisAnchor ? [`INDIVIDUAL SURFACE POLICY: ${JSON.stringify(expressionEmphasisAnchor)}.`] : []),
            ...(expressionTerms.length ? [`SUGGESTED LENS VOCABULARY: ${expressionTerms.map(term => JSON.stringify(term)).join(' | ')}.`] : []),
            `At least one direct private-thought beat must freshly connect the newest event to this particular lens in the supplied thought form.${expressionTerms.length ? ' The suggested vocabulary identifies the intended semantic lens; use a listed word only when it fits naturally, and freely express the same idea without copying it.' : ''} The NPC's self-label, distinctive need, value, feared judgment, contradiction, or personal priority must reach the page rather than becoming only a generic consequence. Do not copy the full note; transform it into fresh inference, self-judgment, desire, or decision. Before returning, remove the name mentally: the cognition must still reveal this person. Generic fear, generic bravery, generic compliance, and generic self-commands do not satisfy this gate.`,
            ...(expressionOuterVoiceAnchor ? [options.expressionSurfaceCooldown
                ? 'At least one spoken passage must perform the psychological pressure behind the INDIVIDUAL SPOKEN FORM without mechanically repeating its most obvious recent tic. If the cooldown already contains its stammer, false-start, clipped-answer, or other scaffold, choose another compatible cue such as correction, fragment, qualifier, evasion, precision shift, formality shift, silence, or sentence-length change. Narrator commentary followed by polished generic dialogue does not count.'
                : 'At least one spoken passage must substantially perform the INDIVIDUAL SPOKEN FORM in its literal construction. A token stammer, one clipped word, or narrator commentary followed by otherwise polished generic dialogue does not count; sustain the supported cadence through a second natural cue such as a false start, correction, fragment, qualifier, evasion, precision shift, formality shift, or sentence-length change. Choose cues licensed by the supplied form rather than adding a generic verbal tic.'] : []),
            ...(expressionEmphasisAnchor ? ['Use the INDIVIDUAL SURFACE POLICY as a palette, not a quota. Prefer enough variation that the private and public registers do not read as the same polished prose with quotation marks changed, while keeping the result natural and character-specific.'] : []),
            '</private_specificity_gate>',
        );
    }
    lines.push(
        'If the user requests a vote, judgment, procedure, test, or outcome, carry it through to a clear result in this reply unless the user explicitly pauses it.',
        'IDENTITY GATE: Give recurring or consequential speaking and deciding characters a stable proper name together with their role. Repair an established recurring role-placeholder at its first relevant appearance in the form “Name, the Role.” A transient one-scene actor supplied by an editor event may remain role-based unless canon or the event supplies a name; never invent a proper name merely to satisfy event delivery. Preserve deliberate canonical anonymity.',
        'Do not end mid-sentence or mid-quotation.',
        '</latest_turn_contract>',
    );
    return lines.join('\n');
}

function findEntityRecord(store, operation) {
    const wantedType = normalizeEntityType(operation.type);
    const wantedNames = uniqueStrings([operation.name, ...(operation.aliases || [])]).map(canonicalNameKey);
    const directId = entityId(wantedType, operation.name);
    if (store.entities[directId]) return [directId, store.entities[directId]];

    for (const [id, record] of Object.entries(store.entities)) {
        if (normalizeEntityType(record.type) !== wantedType) continue;
        const recordNames = uniqueStrings([record.name, ...(record.aliases || [])]).map(canonicalNameKey);
        if (wantedNames.some(name => recordNames.includes(name))) return [id, record];
    }

    // Locations are authoritative containers. If a curator later labels the
    // exact same named place as an item (or upgrades a provisional item to a
    // location), target the existing record instead of creating a second
    // cross-type identity.
    if (['location', 'item'].includes(wantedType)) {
        for (const [id, record] of Object.entries(store.entities)) {
            if (!['location', 'item'].includes(normalizeEntityType(record.type))) continue;
            const recordNames = uniqueStrings([record.name, ...(record.aliases || [])]).map(canonicalNameKey);
            if (wantedNames.some(name => recordNames.includes(name))) return [id, record];
        }
    }

    // The same living physical subject can be inconsistently labelled as an
    // item, creature, or character across curator passes. Prefer the most
    // specific established living type instead of fragmenting one identity.
    if (['character', 'creature', 'item'].includes(wantedType)) {
        const priority = { character: 3, creature: 2, item: 1 };
        const candidates = Object.entries(store.entities)
            .filter(([, record]) => ['character', 'creature', 'item'].includes(normalizeEntityType(record.type)))
            .filter(([, record]) => {
                const recordNames = uniqueStrings([record.name, ...(record.aliases || [])]).map(canonicalNameKey);
                return wantedNames.some(name => recordNames.includes(name));
            })
            .sort((a, b) => priority[normalizeEntityType(b[1].type)] - priority[normalizeEntityType(a[1].type)]);
        if (candidates.length) return candidates[0];
    }

    return [directId, null];
}

const EXPLICIT_LOCATION_SUFFIX = /\b(?:abbey|academy|alley|arena|barracks|bay|bridge|camp|castle|cathedral|cave|chamber|chapel|city|clinic|courtyard|crypt|district|dock|docks|estate|farm|forest|fort|fortress|garden|gate|garrison|grove|hall|harbor|harbour|hideout|hill|hospital|house|inn|island|keep|kitchen|laboratory|library|manor|market|mine|monastery|mountain|office|palace|park|plaza|port|prison|quarry|range|residence|river|road|room|ruins|sanctuary|school|shop|shrine|square|stable|station|street|tavern|temple|tower|town|trail|valley|village|warehouse|watchhouse|well|workshop|yard)\b$/iu;

/**
 * Extract locations that the passage explicitly declares as places whose
 * layout is being established. This narrow grammar is intentionally stronger
 * than generic proper-name extraction: it should not turn every capitalized
 * noun or conversational use of "at" into an automatic lore record.
 */
export function extractDeclaredLocationNames(value, maximum = 20) {
    const text = cleanString(value, 200_000);
    const names = [];
    const expression = /\bat\s+(?:the\s+)?([^.!?\n:]{2,100}?)\s+I\s+(?:(?:stop|pause)\s+to\s+)?(?:establish|define|record)\b/giu;
    for (const match of text.matchAll(expression)) {
        const name = normalizeName(match[1]).replace(/^["'“”‘’]+|["'“”‘’,;]+$/gu, '').trim();
        if (!name || name.split(/\s+/u).length > 8 || !EXPLICIT_LOCATION_SUFFIX.test(name)) continue;
        if (!names.some(item => canonicalNameKey(item) === canonicalNameKey(name))) names.push(name);
        if (names.length >= Math.max(1, Math.min(50, Number(maximum) || 20))) break;
    }
    return names;
}

/**
 * Keep a curator from replacing a specifically declared sublocation with a
 * broader nearby place. Model-authored detail is retained; only the location
 * identity is aligned, and an omitted declared location receives a minimal
 * seed so later passes have a stable canonical target.
 */
export function alignExplicitLocationOperations(store, operations, passage) {
    const anchors = extractDeclaredLocationNames(passage);
    if (!anchors.length) return Array.isArray(operations) ? operations : [];
    const aligned = (Array.isArray(operations) ? operations : []).map(operation => (
        operation && typeof operation === 'object' ? cloneRecord(operation) : operation
    ));
    const anchorByKey = new Map(anchors.map(name => [canonicalNameKey(name), name]));
    const claimed = new Set(aligned
        .filter(operation => normalizeEntityType(operation?.type) === 'location')
        .map(operation => canonicalNameKey(operation?.name))
        .filter(key => anchorByKey.has(key)));

    for (const operation of aligned) {
        if (!operation || normalizeEntityType(operation.type) !== 'location') continue;
        const operationKey = canonicalNameKey(operation.name);
        if (!operationKey || anchorByKey.has(operationKey)) continue;
        const body = [
            operation.summary,
            operation.description,
            operation.currentState ?? operation.current_state,
            ...(Array.isArray(operation.facts) ? operation.facts : []),
            operation.spatial ? JSON.stringify(operation.spatial) : '',
        ].filter(Boolean).join('\n');
        const candidates = anchors
            .filter(anchor => !claimed.has(canonicalNameKey(anchor)))
            .map(anchor => {
                const anchorKey = canonicalNameKey(anchor);
                let score = 0;
                if (canonicalPhrasePresent(body, anchor)) score += 100;
                if (anchorKey.startsWith(`${operationKey} `)) score += 80;
                if (operationKey.startsWith(`${anchorKey} `)) score += 60;
                return { anchor, anchorKey, score };
            })
            .filter(candidate => candidate.score > 0)
            .sort((a, b) => b.score - a.score || b.anchor.length - a.anchor.length);
        const selected = candidates[0];
        if (!selected) continue;
        const existingContainer = Object.values(store?.entities || {}).find(record => (
            normalizeEntityType(record?.type) === 'location'
            && canonicalNameKey(record.name) === operationKey
            && selected.anchorKey.startsWith(`${operationKey} `)
        ));
        operation.name = selected.anchor;
        if (existingContainer && !normalizeName(operation.parentLocation ?? operation.parent_location)) {
            operation.parent_location = existingContainer.name;
        }
        claimed.add(selected.anchorKey);
    }

    const existingKeys = new Set(Object.values(store?.entities || {})
        .filter(record => normalizeEntityType(record?.type) === 'location')
        .flatMap(record => [record.name, ...(record.aliases || [])])
        .map(canonicalNameKey));
    const outputKeys = new Set(aligned
        .filter(operation => normalizeEntityType(operation?.type) === 'location')
        .map(operation => canonicalNameKey(operation?.name)));
    for (const anchor of anchors) {
        const key = canonicalNameKey(anchor);
        if (existingKeys.has(key) || outputKeys.has(key)) continue;
        aligned.push({
            type: 'location',
            name: anchor,
            importance: 70,
            summary: `${anchor} is an explicitly established location.`,
            keys: [anchor],
        });
        outputKeys.add(key);
    }
    return aligned;
}

function authoritativeEntityType(store, requestedTypeValue, name, aliases = []) {
    const requestedType = normalizeEntityType(requestedTypeValue);
    const [, existing] = findEntityRecord(store, { type: requestedType, name, aliases });
    const existingType = normalizeEntityType(existing?.type);
    if (['location', 'item'].includes(requestedType)
        && (requestedType === 'location' || existingType === 'location')) return 'location';
    if (['character', 'creature', 'item'].includes(requestedType)
        && ['character', 'creature', 'item'].includes(existingType)) {
        const priority = { character: 3, creature: 2, item: 1 };
        return priority[existingType] > priority[requestedType] ? existingType : requestedType;
    }
    return requestedType;
}

function makeEntityRecord(operation, messageIndex) {
    const type = normalizeEntityType(operation.type);
    const name = normalizeName(operation.name);
    return {
        id: entityId(type, name),
        type,
        name,
        identityKind: normalizeEntityType(type) === 'character'
            ? normalizeIdentityKind(operation.identityKind ?? operation.identity_kind)
            : '',
        aliases: [],
        keys: [],
        importance: 50,
        summary: '',
        description: '',
        facts: [],
        relationships: [],
        history: [],
        currentState: '',
        spatial: type === 'location' ? { invariants: {} } : undefined,
        parentLocationId: '',
        parentLocationName: '',
        unresolved: [],
        status: 'active',
        firstSeenMessage: messageIndex,
        lastSeenMessage: messageIndex,
        revision: 0,
        enabled: true,
        pinned: false,
        manualContent: '',
        manualOverride: false,
        entryUid: null,
        renderedHash: '',
        createdAt: Date.now(),
        updatedAt: Date.now(),
    };
}

function operationText(operation, camelName, snakeName, maximumLength) {
    return cleanString(operation[camelName] ?? operation[snakeName], maximumLength);
}

function operationArray(operation, camelName, snakeName) {
    const value = operation[camelName] ?? operation[snakeName];
    return Array.isArray(value) ? value : [];
}

function normalizeIdentityKind(value) {
    const kind = canonicalNameKey(value).replace(/\s+/g, '_');
    return ['descriptor', 'public_name'].includes(kind) ? kind : 'unknown';
}

function identityDescriptorKey(value) {
    const words = canonicalNameKey(value).split(/\s+/u).filter(Boolean);
    while (words.length > 1 && GENERIC_IDENTITY_PREFIXES.has(words[0])) words.shift();
    return words.join(' ');
}

function recordHasDescriptorIdentity(record) {
    if (normalizeIdentityKind(record?.identityKind) === 'descriptor') return true;
    const name = normalizeName(record?.name);
    if (/^(?:the|a|an)\s+/iu.test(name)) return true;
    const descriptorKey = identityDescriptorKey(name);
    return Boolean(descriptorKey) && uniqueStrings(record?.aliases, 30).some(alias => (
        /^(?:the|a|an)\s+/iu.test(alias)
        && identityDescriptorKey(alias) === descriptorKey
    ));
}

function cloneRecord(value) {
    return typeof structuredClone === 'function'
        ? structuredClone(value)
        : JSON.parse(JSON.stringify(value));
}

function entitySemanticSignature(record) {
    if (!record || typeof record !== 'object') return '';
    const {
        revision: _revision,
        createdAt: _createdAt,
        updatedAt: _updatedAt,
        firstSeenMessage: _firstSeenMessage,
        lastSeenMessage: _lastSeenMessage,
        entryUid: _entryUid,
        renderedHash: _renderedHash,
        ...semantic
    } = record;
    return JSON.stringify(semantic);
}

function canonicalPhrasePresent(textValue, phraseValue) {
    const text = canonicalNameKey(textValue);
    const phrase = canonicalNameKey(phraseValue);
    return Boolean(phrase && ` ${text} `.includes(` ${phrase} `));
}

function mergeCanonicalEntityPair(primary, duplicate) {
    primary.aliases = mergeStrings(primary.aliases || [], [duplicate.name, ...(duplicate.aliases || [])], [], ENTITY_ARRAY_LIMITS.aliases)
        .filter(alias => canonicalNameKey(alias) !== canonicalNameKey(primary.name));
    primary.keys = mergeStrings(primary.keys || [], duplicate.keys || [], [], ENTITY_ARRAY_LIMITS.keys);
    primary.importance = Math.max(Number(primary.importance) || 0, Number(duplicate.importance) || 0);
    if (!primary.summary || (duplicate.summary || '').length > primary.summary.length) primary.summary = duplicate.summary || primary.summary;
    if (!primary.description || (duplicate.description || '').length > primary.description.length) primary.description = duplicate.description || primary.description;
    if (!primary.currentState) primary.currentState = duplicate.currentState || '';
    primary.facts = mergeStrings(primary.facts || [], duplicate.facts || [], [], ENTITY_ARRAY_LIMITS.facts);
    primary.relationships = mergeStrings(primary.relationships || [], duplicate.relationships || [], [], ENTITY_ARRAY_LIMITS.relationships);
    primary.history = mergeStrings(primary.history || [], duplicate.history || [], [], ENTITY_ARRAY_LIMITS.history);
    primary.unresolved = mergeUnresolved(primary.unresolved || [], duplicate.unresolved || [], [], primary, ENTITY_ARRAY_LIMITS.unresolved);
    if (normalizeEntityType(primary.type) === 'location') {
        primary.spatial = normalizeEntitySpatial({
            invariants: {
                ...normalizeEntitySpatial(duplicate.spatial).invariants,
                ...normalizeEntitySpatial(primary.spatial).invariants,
            },
        });
    }
    if (duplicate.manualOverride && !primary.manualOverride) {
        primary.manualOverride = true;
        primary.manualContent = duplicate.manualContent || '';
    }
    primary.enabled = primary.enabled !== false || duplicate.enabled !== false;
    primary.pinned = Boolean(primary.pinned || duplicate.pinned);
    primary.firstSeenMessage = Math.min(
        Number.isInteger(primary.firstSeenMessage) ? primary.firstSeenMessage : Number.MAX_SAFE_INTEGER,
        Number.isInteger(duplicate.firstSeenMessage) ? duplicate.firstSeenMessage : Number.MAX_SAFE_INTEGER,
    );
    if (primary.firstSeenMessage === Number.MAX_SAFE_INTEGER) primary.firstSeenMessage = -1;
    primary.lastSeenMessage = Math.max(Number(primary.lastSeenMessage) || -1, Number(duplicate.lastSeenMessage) || -1);
    primary.revision = Math.max(Number(primary.revision) || 0, Number(duplicate.revision) || 0) + 1;
    primary.updatedAt = Date.now();
}

/** Collapse compatible physical identities that share one exact canonical name. */
export function reconcileCanonicalEntities(store) {
    const groups = new Map();
    for (const [id, record] of Object.entries(store?.entities || {})) {
        if (!['location', 'item', 'character', 'creature'].includes(normalizeEntityType(record?.type))) continue;
        const key = canonicalNameKey(record.name);
        if (!key) continue;
        const group = groups.get(key) || [];
        group.push([id, record]);
        groups.set(key, group);
    }
    const changedIds = [];
    const removedIds = [];
    for (const group of groups.values()) {
        if (group.length < 2) continue;
        const location = group.find(([, record]) => normalizeEntityType(record.type) === 'location');
        const character = group.find(([, record]) => normalizeEntityType(record.type) === 'character');
        const creature = group.find(([, record]) => normalizeEntityType(record.type) === 'creature');
        const primaryEntry = location || character || creature;
        if (!primaryEntry) continue;
        const [primaryId, primary] = primaryEntry;
        const primaryType = normalizeEntityType(primary.type);
        const compatibleTypes = primaryType === 'location'
            ? new Set(['location', 'item'])
            : new Set(['character', 'creature', 'item']);
        for (const [duplicateId, duplicate] of group) {
            if (duplicateId === primaryId || !compatibleTypes.has(normalizeEntityType(duplicate.type))) continue;
            mergeCanonicalEntityPair(primary, duplicate);
            delete store.entities[duplicateId];
            removedIds.push(duplicateId);
        }
        primary.type = primaryType;
        primary.id = entityId(primaryType, primary.name);
        if (primary.id !== primaryId) {
            delete store.entities[primaryId];
            removedIds.push(primaryId);
        }
        store.entities[primary.id] = primary;
        changedIds.push(primary.id);
    }
    return { reconciled: removedIds.length, changedIds: uniqueStrings(changedIds), removedIds: uniqueStrings(removedIds) };
}

function inferParentLocation(store, record, operation, messageIndex) {
    if (normalizeEntityType(record.type) !== 'location') return;
    const explicitName = normalizeName(
        operation.parentLocation ?? operation.parent_location
        ?? operation.partOfLocation ?? operation.part_of_location,
    );
    let parent = explicitName
        ? Object.values(store.entities).find(candidate => (
            normalizeEntityType(candidate.type) === 'location'
            && canonicalNameKey(candidate.name) === canonicalNameKey(explicitName)
        ))
        : null;
    if (!parent) {
        parent = Object.values(store.entities).find(candidate => {
            if (candidate === record || normalizeEntityType(candidate.type) !== 'location') return false;
            return Object.values(candidate.spatial?.invariants || {}).some(invariant => {
                const relation = canonicalNameKey(invariant.relation).replace(/\s+/gu, '_');
                if (relation === 'contains') return canonicalPhrasePresent(invariant.object, record.name);
                if (['inside', 'located_at', 'part_of'].includes(relation)) {
                    return canonicalPhrasePresent(invariant.subject, record.name);
                }
                return false;
            });
        });
    }
    if (!parent || canonicalNameKey(parent.name) === canonicalNameKey(record.name)) return;
    record.parentLocationId = parent.id;
    record.parentLocationName = parent.name;
    record.relationships = mergeStrings(record.relationships || [], [`Part of ${parent.name}.`], [], ENTITY_ARRAY_LIMITS.relationships);
    record.spatial = mergeSpatialPatch(record.spatial, {
        set: [{
            key: 'parent_location',
            kind: 'containment',
            subject: record.name,
            relation: 'part_of',
            object: parent.name,
            statement: `${record.name} is part of ${parent.name}.`,
            confidence: 'confirmed',
        }],
    }, { messageIndex });
}

/**
 * Merge model-proposed entity patches without allowing omission to delete canon.
 * Explicit remove_* arrays are required to remove established list facts.
 */
export function mergeEntityOperations(store, operations, options = {}) {
    const enabledTypes = new Set((options.enabledTypes || ENTITY_TYPES).map(normalizeEntityType));
    const minimumImportance = clamp(options.minimumImportance ?? 35, 0, 100);
    const maximumOperations = clamp(options.maximumOperations ?? 12, 1, 50);
    const messageIndex = Number.isInteger(options.messageIndex) ? options.messageIndex : -1;
    const initialReconciliation = reconcileCanonicalEntities(store);
    const allOperations = Array.isArray(operations) ? operations : [];
    const prioritizedOperations = allOperations
        .map((operation, originalIndex) => {
            const requestedType = normalizeEntityType(operation?.type);
            const type = authoritativeEntityType(store, requestedType, operation?.name, operation?.aliases);
            const [, existing] = operation && typeof operation === 'object'
                ? findEntityRecord(store, operation)
                : ['', null];
            const worldStatePriority = ['location', 'item'].includes(type) ? 1 : 0;
            return { operation, originalIndex, existing: Boolean(existing), worldStatePriority };
        })
        .sort((a, b) => (
            b.worldStatePriority - a.worldStatePriority
            || Number(b.existing) - Number(a.existing)
            || clamp(b.operation?.importance ?? 50, 0, 100) - clamp(a.operation?.importance ?? 50, 0, 100)
            || a.originalIndex - b.originalIndex
        ))
        .slice(0, maximumOperations)
        .map(item => item.operation);
    const truncated = Math.max(0, allOperations.length - prioritizedOperations.length);
    const result = {
        created: 0,
        updated: initialReconciliation.reconciled,
        skipped: truncated,
        truncated,
        reconciled: initialReconciliation.reconciled,
        changedIds: [...initialReconciliation.changedIds],
        removedIds: [...initialReconciliation.removedIds],
    };

    for (const rawOperation of prioritizedOperations) {
        if (!rawOperation || typeof rawOperation !== 'object') {
            result.skipped++;
            continue;
        }

        const operation = rawOperation;
        let type = normalizeEntityType(operation.type);
        const name = normalizeName(operation.name);
        type = authoritativeEntityType(store, type, name, operation.aliases);
        if (!name || name.length < 2 || !enabledTypes.has(type)) {
            result.skipped++;
            continue;
        }

        let [id, record] = findEntityRecord(store, { ...operation, type, name });
        const isNew = !record;
        const importance = clamp(operation.importance ?? record?.importance ?? 50, 0, 100);
        if (isNew && importance < minimumImportance) {
            result.skipped++;
            continue;
        }

        const existingReference = record;
        const originalRecord = isNew ? null : cloneRecord(record);
        if (isNew) {
            record = makeEntityRecord({ ...operation, type, name }, messageIndex);
            id = record.id;
        } else {
            // Build the candidate away from the live store so a no-op model
            // patch cannot mutate timestamps, revisions, or array order.
            record = cloneRecord(record);
        }

        const previousName = record.name;
        const operationAliases = operationArray(operation, 'aliases', 'aliases');
        const operationKeys = operationArray(operation, 'keys', 'keys');
        const explicitlyLinksPriorIdentity = uniqueStrings([...operationAliases, ...operationKeys], 60)
            .some(value => canonicalNameKey(value) === canonicalNameKey(previousName));
        const promoteName = !isNew
            && Boolean(operation.promoteName ?? operation.promote_name)
            && canonicalNameKey(name) !== canonicalNameKey(previousName)
            && explicitlyLinksPriorIdentity
            && recordHasDescriptorIdentity(record);
        const canonicalName = isNew || promoteName ? name : previousName;
        record.type = type;
        // A model may refer to an established record by an alias. Never let that
        // silently rename the canonical record (and therefore its stable id).
        record.name = canonicalName;
        const proposedIdentityKind = normalizeIdentityKind(operation.identityKind ?? operation.identity_kind);
        if (type === 'character') {
            if (promoteName) record.identityKind = 'public_name';
            else if (isNew || normalizeIdentityKind(record.identityKind) === 'unknown') {
                record.identityKind = proposedIdentityKind;
            }
        }
        record.importance = importance;
        record.aliases = mergeStrings(
            record.aliases || [],
            [
                ...operationAliases,
                ...(promoteName ? [previousName] : []),
                ...(canonicalName !== name ? [name] : []),
            ],
            operationArray(operation, 'removeAliases', 'remove_aliases'),
            ENTITY_ARRAY_LIMITS.aliases,
        ).filter(alias => canonicalNameKey(alias) !== canonicalNameKey(canonicalName));
        record.keys = mergeStrings(
            record.keys || [],
            [name, ...record.aliases, ...operationKeys],
            operationArray(operation, 'removeKeys', 'remove_keys'),
            ENTITY_ARRAY_LIMITS.keys,
        );

        const summary = operationText(operation, 'summary', 'summary', 2_500);
        const description = operationText(operation, 'description', 'description', 8_000);
        const currentState = operationText(operation, 'currentState', 'current_state', 3_000);
        const status = canonicalNameKey(operation.status).replace(/\s+/g, '_');

        if (summary) record.summary = summary;
        if (description && (!record.description || description.length >= Math.min(160, record.description.length * 0.55))) {
            record.description = description;
        }
        if (currentState) record.currentState = currentState;
        if (ACTIVE_STATUSES.has(status)) record.status = status;

        if (type === 'location' && operation.spatial && typeof operation.spatial === 'object') {
            record.spatial = mergeSpatialPatch(record.spatial, operation.spatial, { messageIndex });
        } else if (type === 'location') {
            record.spatial = normalizeEntitySpatial(record.spatial, { messageIndex });
        }

        record.facts = mergeStrings(
            compactEntityFacts(record),
            compactEntityFacts(record, operationArray(operation, 'facts', 'facts')),
            operationArray(operation, 'removeFacts', 'remove_facts'),
            ENTITY_ARRAY_LIMITS.facts,
        );
        record.relationships = mergeStrings(
            record.relationships || [],
            operationArray(operation, 'relationships', 'relationships'),
            operationArray(operation, 'removeRelationships', 'remove_relationships'),
            ENTITY_ARRAY_LIMITS.relationships,
        );
        record.history = mergeStrings(
            record.history || [],
            operationArray(operation, 'history', 'history'),
            operationArray(operation, 'removeHistory', 'remove_history'),
            ENTITY_ARRAY_LIMITS.history,
        );
        record.unresolved = mergeUnresolved(
            record.unresolved || [],
            operationArray(operation, 'unresolved', 'unresolved'),
            [
                ...operationArray(operation, 'resolveThreads', 'resolve_threads'),
                ...operationArray(operation, 'removeUnresolved', 'remove_unresolved'),
            ],
            record,
            ENTITY_ARRAY_LIMITS.unresolved,
        );
        inferParentLocation(store, record, operation, messageIndex);

        record.id = entityId(record.type, record.name);
        if (!isNew && entitySemanticSignature(record) === entitySemanticSignature(originalRecord)) {
            result.skipped++;
            continue;
        }

        record.lastSeenMessage = Math.max(Number(record.lastSeenMessage) || -1, messageIndex);
        record.firstSeenMessage = Number.isInteger(record.firstSeenMessage) ? record.firstSeenMessage : messageIndex;
        record.revision = Math.max(0, Number(record.revision) || 0) + 1;
        record.updatedAt = Date.now();
        if (record.id !== id) {
            delete store.entities[id];
            id = record.id;
        } else if (!isNew && existingReference) {
            for (const key of Object.keys(existingReference)) delete existingReference[key];
            Object.assign(existingReference, record);
            record = existingReference;
        }
        if (promoteName) promoteBrainIdentity(store, previousName, canonicalName, record.aliases);
        store.entities[id] = record;
        result.changedIds.push(id);
        if (isNew) result.created++;
        else result.updated++;
    }

    store.updatedAt = Date.now();
    return result;
}

function findBrain(store, operation) {
    const wanted = uniqueStrings([operation.character, operation.name, ...(operation.aliases || [])]).map(canonicalNameKey);
    for (const [id, brain] of Object.entries(store.brains)) {
        const known = uniqueStrings([brain.name, ...(brain.aliases || [])]).map(canonicalNameKey);
        if (wanted.some(name => known.includes(name))) return [id, brain];
    }
    const name = normalizeName(operation.character || operation.name);
    return [canonicalNameKey(name), null];
}

function promoteBrainIdentity(store, previousName, publicName, aliases = []) {
    const [oldId, brain] = findBrain(store, { character: previousName });
    if (!brain || canonicalNameKey(brain.name) === canonicalNameKey(publicName)) return;
    brain.aliases = mergeStrings(brain.aliases || [], [previousName, ...aliases], [], 20)
        .filter(alias => canonicalNameKey(alias) !== canonicalNameKey(publicName));
    brain.name = normalizeName(publicName);
    brain.identityKind = 'public_name';
    brain.id = canonicalNameKey(brain.name);
    brain.revision = Math.max(0, Number(brain.revision) || 0) + 1;
    brain.updatedAt = Date.now();
    delete store.brains[oldId];
    store.brains[brain.id] = brain;
}

function normalizeSetOperations(value) {
    if (Array.isArray(value)) return value;
    if (!value || typeof value !== 'object') return [];
    return Object.entries(value).map(([key, item]) => (
        typeof item === 'string' ? { key, statement: item } : { key, ...item }
    ));
}

function makeBrain(name, messageIndex, identityKind = 'unknown') {
    return {
        psychologyVersion: 2,
        id: canonicalNameKey(name),
        name,
        identityKind: normalizeIdentityKind(identityKind),
        aliases: [],
        persistentSelf: {
            facets: {},
            voice: {},
            relationships: {},
        },
        durableCandidates: {},
        currentMind: null,
        active: true,
        enabled: true,
        pinned: false,
        firstSeenMessage: messageIndex,
        lastSeenMessage: messageIndex,
        revision: 0,
        createdAt: Date.now(),
        updatedAt: Date.now(),
    };
}

function psychologyPatchSet(patch) {
    if (!patch || typeof patch !== 'object') return [];
    return normalizeSetOperations(patch.set ?? patch.facets);
}

function psychologyPatchDelete(patch) {
    if (!patch || typeof patch !== 'object') return [];
    return operationArray(patch, 'delete', 'delete');
}

function mergePsychologyPatch(existing, patch, options = {}) {
    const target = existing && typeof existing === 'object' ? existing : {};
    const allowed = options.allowed || PERSISTENT_SELF_KIND_VALUES;
    const fallbackKind = options.fallbackKind || 'belief';
    const maximumChanges = clamp(options.maximumChanges ?? 6, 0, 50);
    const maximumEntries = clamp(options.maximumEntries ?? 30, 1, 200);
    const messageIndex = Number.isInteger(options.messageIndex) ? options.messageIndex : -1;

    for (const rawKey of psychologyPatchDelete(patch)) {
        const key = normalizeThoughtKey(rawKey);
        if (key) delete target[key];
    }

    const proposals = psychologyPatchSet(patch)
        .map((raw, originalIndex) => {
            if (!raw || typeof raw !== 'object') return null;
            const key = normalizeThoughtKey(raw.key);
            const statement = cleanString(raw.statement ?? raw.thought ?? raw.value, 1_200);
            if (!key || !statement) return null;
            return { raw, key, statement, originalIndex, updatesExisting: Boolean(target[key]) };
        })
        .filter(Boolean)
        .sort((a, b) => Number(b.updatesExisting) - Number(a.updatesExisting) || a.originalIndex - b.originalIndex)
        .slice(0, maximumChanges);

    let changed = 0;
    for (const proposal of proposals) {
        const { raw, key, statement } = proposal;
        const next = {
            key,
            kind: normalizePsychologyKind(raw.kind ?? raw.category, allowed, fallbackKind),
            statement,
            confidence: normalizeConfidence(raw.confidence),
            basis: normalizePsychologyBasis(raw.basis) || target[key]?.basis || 'story',
            sourceMessage: messageIndex,
            updatedAt: Date.now(),
        };
        const prior = target[key];
        if (prior
            && prior.kind === next.kind
            && prior.statement === next.statement
            && prior.confidence === next.confidence
            && prior.basis === next.basis) continue;
        target[key] = next;
        changed++;
    }

    const protectedKinds = new Set(options.protectedKinds || []);
    const ordered = Object.values(target)
        .sort((a, b) => (
            Number(protectedKinds.has(b.kind)) - Number(protectedKinds.has(a.kind))
            || (Number(b.updatedAt) || 0) - (Number(a.updatedAt) || 0)
            || String(a.key).localeCompare(String(b.key))
        ))
        .slice(0, maximumEntries);
    return {
        entries: Object.fromEntries(ordered.map(item => [item.key, item])),
        changed,
    };
}

const CONSOLIDATION_NEGATIONS = new Set([
    'no', 'not', 'never', 'without', 'cannot', 'cant', 'wont', 'dont', 'doesnt', 'didnt', 'isnt', 'arent', 'wasnt', 'werent',
]);

function psychologyNegationSignature(value) {
    return [...new Set(canonicalNameKey(value).split(/\s+/gu)
        .filter(token => CONSOLIDATION_NEGATIONS.has(token)))]
        .sort()
        .join('|');
}

// High lexical overlap can hide a materially different counter, date, named
// person, or named place (for example, “trust Rowan” versus “trust Ivo”). Do
// not consolidate across those hard anchors even when the surrounding phrase
// is otherwise identical.
function psychologyAnchorSignature(value) {
    const text = cleanString(value, 1_200);
    const numbers = [...text.matchAll(/\b\p{N}+(?:[.,:]\p{N}+)*\b/gu)].map(match => match[0]);
    const names = [...text.matchAll(/\b\p{Lu}[\p{L}\p{M}'’-]*\b/gu)]
        .map(match => canonicalNameKey(match[0]))
        .filter(name => name && name !== 'i');
    return JSON.stringify({
        numbers: [...new Set(numbers)].sort(),
        names: [...new Set(names)].sort(),
    });
}

function consolidationPriority(entry, protectedKinds) {
    const basis = entry.basis === 'character_card' ? 3 : entry.basis === 'consolidated' ? 2 : 1;
    const confidence = entry.confidence === 'confirmed' ? 1 : 0;
    const protectedKind = protectedKinds.has(entry.kind) ? 1 : 0;
    const source = Number.isInteger(entry.sourceMessage) && entry.sourceMessage >= 0
        ? -entry.sourceMessage
        : Number.MIN_SAFE_INTEGER;
    return [basis, protectedKind, confidence, source];
}

function compareConsolidationPriority(left, right, protectedKinds) {
    const a = consolidationPriority(left, protectedKinds);
    const b = consolidationPriority(right, protectedKinds);
    for (let index = 0; index < a.length; index++) if (a[index] !== b[index]) return a[index] - b[index];
    return 0;
}

function consolidatePsychologyEntries(entriesValue, options = {}) {
    const threshold = clamp(options.similarity ?? 0.88, 0.75, 0.99);
    const protectedKinds = new Set(options.protectedKinds || []);
    const entries = Object.values(entriesValue || {}).map(cloneRecord);
    const removed = new Set();
    let merged = 0;
    for (let leftIndex = 0; leftIndex < entries.length; leftIndex++) {
        if (removed.has(leftIndex)) continue;
        for (let rightIndex = leftIndex + 1; rightIndex < entries.length; rightIndex++) {
            if (removed.has(rightIndex)) continue;
            const left = entries[leftIndex];
            const right = entries[rightIndex];
            if (left.kind !== right.kind
                || psychologyNegationSignature(left.statement) !== psychologyNegationSignature(right.statement)
                || psychologyAnchorSignature(left.statement) !== psychologyAnchorSignature(right.statement)
                || contextSimilarity(left.statement, right.statement) < threshold) continue;
            const rightWins = compareConsolidationPriority(right, left, protectedKinds) > 0;
            const survivorIndex = rightWins ? rightIndex : leftIndex;
            const duplicateIndex = rightWins ? leftIndex : rightIndex;
            const survivor = entries[survivorIndex];
            const duplicate = entries[duplicateIndex];
            if (survivor.basis !== 'character_card') survivor.basis = 'consolidated';
            if (duplicate.confidence === 'confirmed') survivor.confidence = 'confirmed';
            if (duplicate.statement.length > survivor.statement.length && survivor.basis !== 'character_card') {
                survivor.statement = duplicate.statement;
            }
            survivor.sourceMessage = Math.max(
                Number(survivor.sourceMessage) || -1,
                Number(duplicate.sourceMessage) || -1,
            );
            survivor.updatedAt = Math.max(Number(survivor.updatedAt) || 0, Number(duplicate.updatedAt) || 0, Date.now());
            removed.add(duplicateIndex);
            merged++;
            if (duplicateIndex === leftIndex) break;
        }
    }
    return {
        entries: Object.fromEntries(entries.filter((_, index) => !removed.has(index)).map(entry => [entry.key, entry])),
        merged,
    };
}

/** Deduplicate semantically equivalent durable psychology while retaining contradictions. */
export function consolidateBrainRecord(brainValue, options = {}) {
    const brain = brainValue && typeof brainValue === 'object' ? brainValue : null;
    if (!brain) return { brain, merged: 0 };
    brain.persistentSelf = brain.persistentSelf || { facets: {}, voice: {}, relationships: {} };
    const facets = consolidatePsychologyEntries(brain.persistentSelf.facets, {
        similarity: options.similarity,
        protectedKinds: ['personal_anchor', 'self_concept', 'value', 'fear', 'desire', 'emotional_need', 'contradiction', 'secret', 'goal'],
    });
    const voice = consolidatePsychologyEntries(brain.persistentSelf.voice, {
        similarity: options.similarity,
        protectedKinds: ['thought_style', 'cadence', 'vocabulary', 'pressure_shift', 'emotional_openness', 'emphasis'],
    });
    brain.persistentSelf.facets = facets.entries;
    brain.persistentSelf.voice = voice.entries;
    let merged = facets.merged + voice.merged;
    for (const relationship of Object.values(brain.persistentSelf.relationships || {})) {
        const aspects = consolidatePsychologyEntries(relationship.aspects, {
            similarity: options.similarity,
            protectedKinds: ['trust', 'affection', 'respect', 'fear', 'resentment', 'conflict'],
        });
        relationship.aspects = aspects.entries;
        merged += aspects.merged;
    }
    const previous = brain.consolidation && typeof brain.consolidation === 'object' ? brain.consolidation : {};
    brain.consolidation = {
        totalMerged: Math.max(0, Number(previous.totalMerged) || 0) + merged,
        lastMerged: merged,
        lastMessage: Number.isInteger(options.messageIndex) ? options.messageIndex : -1,
        updatedAt: Date.now(),
    };
    return { brain, merged };
}

const SIGNIFICANT_SINGLE_PASS_FACET_KINDS = new Set([
    'memory', 'secret', 'goal', 'plan', 'self_concept', 'contradiction',
]);

function gateStoryFacetPatch(brain, patch, options = {}) {
    const minimum = clamp(options.minimumStoryObservations ?? 1, 1, 5);
    brain.durableCandidates = normalizeDurableCandidates(brain.durableCandidates);
    const pending = brain.durableCandidates;
    const deletions = psychologyPatchDelete(patch);
    for (const rawKey of deletions) {
        const key = normalizeThoughtKey(rawKey);
        if (key) delete pending[key];
    }
    if (minimum <= 1) return { patch, deferred: 0, promoted: 0 };

    const admitted = [];
    let deferred = 0;
    let promoted = 0;
    const messageIndex = Number.isInteger(options.messageIndex) ? options.messageIndex : -1;
    for (const raw of psychologyPatchSet(patch)) {
        if (!raw || typeof raw !== 'object') continue;
        const key = normalizeThoughtKey(raw.key);
        const statement = cleanString(raw.statement ?? raw.thought ?? raw.value, 1_200);
        if (!key || !statement) continue;
        const kind = normalizePsychologyKind(raw.kind ?? raw.category, PERSISTENT_SELF_KIND_VALUES, 'belief');
        const basis = normalizePsychologyBasis(raw.basis) || 'story';
        const updatesExisting = Boolean(brain.persistentSelf?.facets?.[key]);
        const significant = canonicalNameKey(raw.promotion ?? raw.durability).replace(/\s+/gu, '_') === 'significant_event'
            && SIGNIFICANT_SINGLE_PASS_FACET_KINDS.has(kind)
            && normalizeConfidence(raw.confidence) === 'confirmed';
        if (updatesExisting || basis === 'character_card' || basis === 'consolidated' || significant) {
            admitted.push(raw);
            delete pending[key];
            continue;
        }

        const prior = pending[key];
        const independentlyRepeated = prior
            && prior.lastSourceMessage !== messageIndex
            && contextSimilarity(prior.statement, statement) >= 0.68;
        const observations = independentlyRepeated ? prior.observations + 1 : 1;
        pending[key] = {
            key,
            kind,
            statement,
            confidence: normalizeConfidence(raw.confidence),
            observations,
            firstSourceMessage: prior?.firstSourceMessage ?? messageIndex,
            lastSourceMessage: messageIndex,
            updatedAt: Date.now(),
        };
        if (observations >= minimum) {
            admitted.push({ ...raw, basis: 'consolidated' });
            delete pending[key];
            promoted++;
        } else {
            deferred++;
        }
    }

    brain.durableCandidates = Object.fromEntries(Object.values(pending)
        .sort((left, right) => right.updatedAt - left.updatedAt)
        .slice(0, 40)
        .map(candidate => [candidate.key, candidate]));
    return {
        patch: { ...(patch && typeof patch === 'object' ? patch : {}), set: admitted, delete: deletions },
        deferred,
        promoted,
    };
}

function legacyMindPatch(operation) {
    const durable = [];
    const scene = [];
    for (const raw of normalizeSetOperations(operation?.set)) {
        if (!raw || typeof raw !== 'object') continue;
        const category = normalizePsychologyKind(raw.category, new Set(BRAIN_CATEGORIES), 'belief');
        const statement = cleanString(raw.thought ?? raw.statement ?? raw.value, 1_200);
        if (!statement) continue;
        if (category === 'emotion' || normalizeThoughtRetention(raw.retention, category) === 'scene') {
            scene.push(statement);
            continue;
        }
        durable.push({
            key: raw.key,
            kind: LEGACY_FACET_KIND[category] || 'belief',
            statement,
            confidence: raw.confidence,
        });
    }
    return {
        persistentSelf: {
            set: durable,
            delete: operationArray(operation || {}, 'delete', 'delete'),
        },
        scene,
    };
}

function findRelationship(persistentSelf, raw) {
    const wanted = uniqueStrings([raw?.target, ...(raw?.aliases || [])]).map(canonicalNameKey);
    for (const [id, relationship] of Object.entries(persistentSelf.relationships || {})) {
        const known = uniqueStrings([relationship.target, ...(relationship.aliases || [])]).map(canonicalNameKey);
        if (wanted.some(name => known.includes(name))) return [id, relationship];
    }
    const target = normalizeName(raw?.target);
    return [canonicalNameKey(target), null];
}

function mergeRelationshipPatches(brain, patches, options = {}) {
    const maximumRelationships = clamp(options.maximumRelationships ?? 20, 1, 50);
    const maximumAspects = clamp(options.maximumAspects ?? 16, 1, 50);
    const maximumChanges = clamp(options.maximumChanges ?? 6, 0, 50);
    const messageIndex = Number.isInteger(options.messageIndex) ? options.messageIndex : -1;
    let remainingChanges = maximumChanges;
    const relationships = brain.persistentSelf.relationships;

    for (const raw of (Array.isArray(patches) ? patches : []).slice(0, maximumRelationships)) {
        if (!raw || typeof raw !== 'object') continue;
        const target = normalizeName(raw.target);
        if (!target || canonicalNameKey(target) === canonicalNameKey(brain.name)) continue;
        let [id, relationship] = findRelationship(brain.persistentSelf, raw);
        if (raw.remove === true) {
            if (relationship) delete relationships[id];
            continue;
        }
        if (!remainingChanges && !psychologyPatchDelete(raw).length) continue;
        const isNew = !relationship;
        if (isNew) {
            relationship = normalizeRelationshipRecord({ target, aliases: raw.aliases }, target);
            id = relationship.id;
        }
        relationship.aliases = mergeStrings(
            relationship.aliases || [],
            [
                ...(raw.aliases || []),
                ...(canonicalNameKey(target) !== canonicalNameKey(relationship.target) ? [target] : []),
            ],
            operationArray(raw, 'removeAliases', 'remove_aliases'),
            20,
        ).filter(alias => canonicalNameKey(alias) !== canonicalNameKey(relationship.target));
        const merged = mergePsychologyPatch(relationship.aspects, raw, {
            allowed: RELATIONSHIP_ASPECT_KIND_VALUES,
            fallbackKind: 'belief',
            maximumChanges: remainingChanges,
            maximumEntries: maximumAspects,
            messageIndex,
            protectedKinds: ['trust', 'affection', 'respect', 'fear', 'resentment', 'conflict'],
        });
        relationship.aspects = merged.entries;
        remainingChanges = Math.max(0, remainingChanges - merged.changed);
        relationship.firstSeenMessage = Number.isInteger(relationship.firstSeenMessage) && relationship.firstSeenMessage >= 0
            ? relationship.firstSeenMessage
            : messageIndex;
        relationship.lastUpdatedMessage = messageIndex;
        relationship.revision = Math.max(0, Number(relationship.revision) || 0) + 1;
        relationship.updatedAt = Date.now();
        relationships[id] = relationship;
        if (!remainingChanges) break;
    }

    const ordered = Object.values(relationships)
        .sort((a, b) => (
            (Number(b.lastUpdatedMessage) || -1) - (Number(a.lastUpdatedMessage) || -1)
            || (Number(b.updatedAt) || 0) - (Number(a.updatedAt) || 0)
        ))
        .slice(0, maximumRelationships);
    brain.persistentSelf.relationships = Object.fromEntries(ordered.map(item => [item.id, item]));
}

/**
 * Merge AI-curated NPC psychology into isolated v2 brains.
 *
 * Persistent Self is patched by stable keys; Current Mind is a complete,
 * replaceable snapshot. The legacy flat patch shape is accepted only as a
 * one-way input adapter so existing queued responses and rebuild fixtures do
 * not create a second storage model.
 */
export function mergeMindOperations(store, operations, options = {}) {
    const maximumOperations = clamp(options.maximumOperations ?? 12, 1, 50);
    const maximumThoughts = clamp(options.maximumThoughts ?? 30, 4, 200);
    const maximumThoughtChanges = clamp(options.maximumThoughtChanges ?? 6, 1, 50);
    const maximumSceneThoughts = clamp(options.maximumSceneThoughts ?? 4, 0, 20);
    const messageIndex = Number.isInteger(options.messageIndex) ? options.messageIndex : -1;
    const allOperations = Array.isArray(operations) ? operations : [];
    const truncated = Math.max(0, allOperations.length - maximumOperations);
    const result = {
        created: 0,
        updated: 0,
        skipped: truncated,
        truncated,
        changedIds: [],
        deferredFacetCandidates: 0,
        promotedFacetCandidates: 0,
        consolidatedEntries: 0,
    };

    for (const operation of allOperations.slice(0, maximumOperations)) {
        if (!operation || typeof operation !== 'object') {
            result.skipped++;
            continue;
        }
        const name = normalizeName(operation.character || operation.name);
        if (!name || name.length < 2) {
            result.skipped++;
            continue;
        }

        let [id, brain] = findBrain(store, operation);
        const isNew = !brain;
        const proposedIdentityKind = normalizeIdentityKind(operation.identityKind ?? operation.identity_kind);
        if (isNew) brain = makeBrain(name, messageIndex, proposedIdentityKind);

        const previousName = brain.name;
        const operationAliases = operationArray(operation, 'aliases', 'aliases');
        const explicitlyLinksPriorIdentity = uniqueStrings(operationAliases, 30)
            .some(value => canonicalNameKey(value) === canonicalNameKey(previousName));
        const promoteName = !isNew
            && Boolean(operation.promoteName ?? operation.promote_name)
            && canonicalNameKey(name) !== canonicalNameKey(previousName)
            && explicitlyLinksPriorIdentity
            && recordHasDescriptorIdentity(brain);
        const canonicalName = isNew || promoteName ? name : previousName;
        brain.name = canonicalName;
        if (promoteName) brain.identityKind = 'public_name';
        else if (isNew || normalizeIdentityKind(brain.identityKind) === 'unknown') {
            brain.identityKind = proposedIdentityKind;
        }
        brain.aliases = mergeStrings(
            brain.aliases || [],
            [
                ...operationAliases,
                ...(promoteName ? [previousName] : []),
                ...(canonicalName !== name ? [name] : []),
            ],
            operationArray(operation, 'removeAliases', 'remove_aliases'),
            20,
        ).filter(alias => canonicalNameKey(alias) !== canonicalNameKey(canonicalName));

        brain.persistentSelf = brain.persistentSelf || { facets: {}, voice: {}, relationships: {} };
        brain.persistentSelf.facets = brain.persistentSelf.facets || {};
        brain.persistentSelf.voice = brain.persistentSelf.voice || {};
        brain.persistentSelf.relationships = brain.persistentSelf.relationships || {};

        const legacy = legacyMindPatch(operation);
        const proposedPersistentPatch = operation.persistentSelf ?? operation.persistent_self ?? legacy.persistentSelf;
        const gatedPersistent = gateStoryFacetPatch(brain, proposedPersistentPatch, {
            minimumStoryObservations: options.minimumStoryFacetObservations,
            messageIndex,
        });
        const persistentPatch = gatedPersistent.patch;
        result.deferredFacetCandidates += gatedPersistent.deferred;
        result.promotedFacetCandidates += gatedPersistent.promoted;
        const voicePatch = operation.voice;
        const voiceProposalCount = psychologyPatchSet(voicePatch).length;
        const relationshipProposalCount = (Array.isArray(operation.relationships) ? operation.relationships : [])
            .reduce((sum, patch) => sum + psychologyPatchSet(patch).length, 0);
        const existingVoiceKinds = new Set(Object.values(brain.persistentSelf.voice).map(entry => entry.kind));
        const voiceNeedsFoundation = !existingVoiceKinds.has('thought_style')
            || ![...existingVoiceKinds].some(kind => (
                ['cadence', 'hesitation', 'emotional_openness', 'pressure_shift'].includes(kind)
            ));
        const voiceNeedsEmphasis = !existingVoiceKinds.has('emphasis');
        const reservedVoiceTarget = (voiceNeedsFoundation ? 2 : 1) + (voiceNeedsEmphasis ? 1 : 0);
        const reservedVoiceChanges = voiceProposalCount
            ? Math.min(voiceProposalCount, reservedVoiceTarget, maximumThoughtChanges)
            : 0;
        const reservedRelationshipChanges = relationshipProposalCount
            ? Math.min(1, Math.max(0, maximumThoughtChanges - reservedVoiceChanges))
            : 0;
        const maximumFacetChanges = Math.max(
            0,
            maximumThoughtChanges - reservedVoiceChanges - reservedRelationshipChanges,
        );
        let remainingDurableChanges = maximumThoughtChanges;
        const facetMerge = mergePsychologyPatch(brain.persistentSelf.facets, persistentPatch, {
            allowed: PERSISTENT_SELF_KIND_VALUES,
            fallbackKind: 'belief',
            maximumChanges: maximumFacetChanges,
            maximumEntries: maximumThoughts,
            messageIndex,
            protectedKinds: ['personal_anchor', 'self_concept', 'value', 'fear', 'desire', 'emotional_need', 'contradiction', 'secret', 'goal'],
        });
        brain.persistentSelf.facets = facetMerge.entries;
        remainingDurableChanges = Math.max(0, remainingDurableChanges - facetMerge.changed);

        if (voicePatch && typeof voicePatch === 'object') {
            const maximumVoiceChanges = Math.max(0, remainingDurableChanges - reservedRelationshipChanges);
            const voiceMerge = mergePsychologyPatch(brain.persistentSelf.voice, voicePatch, {
                allowed: VOICE_KIND_VALUES,
                fallbackKind: 'thought_style',
                maximumChanges: maximumVoiceChanges,
                maximumEntries: 20,
                messageIndex,
                protectedKinds: ['thought_style', 'cadence', 'vocabulary', 'pressure_shift', 'emotional_openness', 'emphasis'],
            });
            brain.persistentSelf.voice = voiceMerge.entries;
            remainingDurableChanges = Math.max(0, remainingDurableChanges - voiceMerge.changed);
        }

        mergeRelationshipPatches(brain, operation.relationships, {
            maximumChanges: remainingDurableChanges,
            maximumRelationships: 20,
            maximumAspects: 16,
            messageIndex,
        });

        const hasCurrentMindPatch = Object.hasOwn(operation, 'currentMind') || Object.hasOwn(operation, 'current_mind');
        if (hasCurrentMindPatch) {
            const rawCurrentMind = operation.currentMind ?? operation.current_mind;
            if (rawCurrentMind === null) {
                // A nullable JSON field is too easy for a curator to emit while
                // making an unrelated voice-only patch. Clearing a still-live
                // subjective state must be deliberate; ordinary snapshots age
                // out of prompt retrieval without becoming durable memory.
                if (operation.clearCurrentMind === true
                    || operation.clear_current_mind === true
                    || operation.active === false) brain.currentMind = null;
            } else {
                brain.currentMind = normalizeCurrentMind(
                    { ...rawCurrentMind, sourceMessage: messageIndex },
                    { messageIndex },
                );
            }
        } else if (legacy.scene.length) {
            brain.currentMind = normalizeCurrentMind({
                inner_thoughts: legacy.scene.slice(0, maximumSceneThoughts),
                source_message: messageIndex,
            }, { messageIndex });
        }
        if (brain.currentMind) {
            brain.currentMind.innerThoughts = brain.currentMind.innerThoughts.slice(0, maximumSceneThoughts);
            brain.currentMind.emotions = brain.currentMind.emotions.slice(0, Math.max(1, maximumSceneThoughts));
        }
        result.consolidatedEntries += consolidateBrainRecord(brain, {
            similarity: options.consolidationSimilarity,
            messageIndex,
        }).merged;
        brain.active = operation.active === undefined ? true : Boolean(operation.active);
        brain.firstSeenMessage = Number.isInteger(brain.firstSeenMessage) ? brain.firstSeenMessage : messageIndex;
        brain.lastSeenMessage = Math.max(Number(brain.lastSeenMessage) || -1, messageIndex);
        brain.revision = Math.max(0, Number(brain.revision) || 0) + 1;
        brain.updatedAt = Date.now();
        brain.psychologyVersion = 2;
        brain.id = canonicalNameKey(brain.name);

        if (brain.id !== id) {
            delete store.brains[id];
            id = brain.id;
        }
        store.brains[id] = brain;
        result.changedIds.push(id);
        if (isNew) result.created++;
        else result.updated++;
    }

    store.updatedAt = Date.now();
    return result;
}

function section(title, values) {
    const cleanValues = uniqueStrings(values, 100);
    if (!cleanValues.length) return '';
    return `${title}:\n${cleanValues.map(value => `- ${value}`).join('\n')}`;
}

export function renderLoreContent(record) {
    if (record?.manualOverride && cleanString(record.manualContent)) {
        return cleanString(record.manualContent, 20_000);
    }

    const title = normalizeName(record?.name) || 'Unnamed entity';
    const type = normalizeEntityType(record?.type);
    const blocks = [`[InnerLore ${type}: ${title}]`];
    if (cleanString(record?.summary)) blocks.push(`Overview: ${cleanString(record.summary)}`);
    if (cleanString(record?.description)) blocks.push(`Description: ${cleanString(record.description)}`);
    const facts = section('Established facts', compactEntityFacts(record));
    const spatial = section(
        'Spatial invariants',
        Object.values(record?.spatial?.invariants || {}).map(invariant => (
            `[${invariant.key}] ${invariant.statement}`
        )),
    );
    const relationships = section('Relationships and associations', record?.relationships);
    const history = section('Relevant history', record?.history);
    if (facts) blocks.push(facts);
    if (spatial) blocks.push(spatial);
    if (relationships) blocks.push(relationships);
    if (history) blocks.push(history);
    if (cleanString(record?.parentLocationName)) {
        blocks.push(`Contained by location: ${cleanString(record.parentLocationName, 240)}`);
    }
    if (cleanString(record?.currentState)) blocks.push(`Current state: ${cleanString(record.currentState)}`);
    const unresolved = section('Unresolved or uncertain', record?.unresolved);
    if (unresolved) blocks.push(unresolved);
    if (record?.status && record.status !== 'active') blocks.push(`Status: ${record.status}.`);
    return blocks.join('\n\n').trim();
}

function nearDuplicate(value, references, threshold = 0.82) {
    const text = cleanString(value, 5_000);
    if (!text) return false;
    const key = canonicalNameKey(text);
    return (references || []).some(reference => {
        const other = cleanString(reference, 5_000);
        if (!other) return false;
        const otherKey = canonicalNameKey(other);
        if (key.length >= 28 && (key.includes(otherKey) || otherKey.includes(key))) return true;
        return contextSimilarity(text, other) >= threshold;
    });
}

function rankedContextValues(values, focusText, maximum = 8) {
    return uniqueStrings(values, 100)
        .map((value, index, all) => ({
            value,
            score: contextSimilarity(value, focusText) * 1_000 + index / Math.max(1, all.length),
        }))
        .sort((a, b) => b.score - a.score)
        .slice(0, maximum)
        .map(item => item.value);
}

function appendBoundedLine(lines, line, maximumLength, claimRegistry, options = {}) {
    const text = cleanString(line, 20_000);
    if (!text) return { added: false, clipped: false };
    const claim = cleanString(options.claim ?? text.replace(/^[^:]{1,30}:\s*/u, ''), 10_000);
    if (!options.always && nearDuplicate(claim, options.externalConcepts, options.externalThreshold ?? 0.86)) {
        options.onDuplicate?.(claim);
        return { added: false, clipped: false };
    }
    if (!options.always && nearDuplicate(claim, claimRegistry, options.internalThreshold ?? 0.82)) {
        options.onDuplicate?.(claim);
        return { added: false, clipped: false };
    }
    const used = lines.join('\n').length;
    const separator = lines.length ? 1 : 0;
    const remaining = maximumLength - used - separator;
    if (remaining < 24) return { added: false, clipped: false };
    const rendered = clipAtBoundary(text, remaining);
    if (!rendered) return { added: false, clipped: false };
    lines.push(rendered);
    if (!options.always && claim) claimRegistry.push(claim);
    return { added: true, clipped: rendered.length < text.length };
}

/**
 * Render the high-value delta of an entity. Current state and explicit open
 * threads always precede historical detail, and every field is clipped at a
 * natural language boundary instead of slicing the finished record mid-word.
 */
export function renderCompactEntity(record, maximumLength = 1_800, options = {}) {
    const maximum = clamp(maximumLength, 120, 10_000);
    const lines = [];
    const claims = options.claimRegistry || [];
    const externalConcepts = Array.isArray(options.externalConcepts) ? options.externalConcepts : [];
    const focusText = cleanString(options.focusText, 30_000);
    let duplicateCount = 0;
    const append = (label, value, appendOptions = {}) => appendBoundedLine(
        lines,
        label ? `${label}: ${cleanString(value, 10_000)}` : value,
        maximum,
        claims,
        {
            externalConcepts,
            onDuplicate: () => { duplicateCount++; },
            ...appendOptions,
        },
    );

    append('', `${record.name} (${record.type})`, { always: true });
    if (record.currentState && !options.suppressCurrentState) {
        const currentBudget = record.unresolved?.length
            ? Math.max(80, Math.floor(maximum * 0.4))
            : Math.max(100, Math.floor(maximum * 0.6));
        append('Current', clipAtBoundary(record.currentState, currentBudget), { externalConcepts: [] });
    }
    for (const thread of rankedContextValues(record.unresolved, focusText, 3)) {
        append('Open', clipAtBoundary(thread, Math.max(80, Math.floor(maximum * 0.3))), { externalConcepts: [] });
    }
    if (record.manualOverride && record.manualContent) append('Manual', record.manualContent, { externalConcepts: [] });
    if (record.summary) append('Overview', record.summary);
    for (const relationship of rankedContextValues(record.relationships, focusText, 3)) {
        append('Association', relationship);
    }
    for (const fact of rankedContextValues(compactEntityFacts(record), focusText, 5)) append('Canon', fact);
    if (record.status && record.status !== 'active') append('Status', `${record.status}.`);

    const text = cleanString(lines.join('\n'), maximum);
    if (options.diagnostics && typeof options.diagnostics === 'object') {
        options.diagnostics.duplicatesSuppressed = (options.diagnostics.duplicatesSuppressed || 0) + duplicateCount;
        options.diagnostics.clipped = text.length >= maximum - 1;
    }
    return text;
}

function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function textMentions(text, names) {
    const source = cleanString(text, 200_000);
    if (!source) return false;
    return uniqueStrings(names, 40).some(name => {
        const escaped = escapeRegExp(name);
        if (!escaped) return false;
        try {
            return new RegExp(`(^|[^\\p{L}\\p{N}])${escaped}(?=$|[^\\p{L}\\p{N}])`, 'iu').test(source);
        } catch {
            return source.toLocaleLowerCase().includes(name.toLocaleLowerCase());
        }
    });
}

const GENERIC_IDENTITY_PREFIXES = new Set([
    'a', 'an', 'the', 'this', 'that', 'his', 'her', 'its', 'our', 'their', 'your',
    'baron', 'baroness', 'brother', 'captain', 'chief', 'commander', 'count', 'countess',
    'dame', 'doctor', 'dr', 'duchess', 'duke', 'elder', 'father', 'king', 'lady', 'lord',
    'master', 'mistress', 'mother', 'prince', 'princess', 'professor', 'queen', 'saint',
    'ser', 'sir', 'sister', 'st',
]);

function identityReferenceUses(source, reference) {
    const core = normalizeName(reference).replace(/^(?:the|a|an)\s+/iu, '');
    if (!core) return { descriptor: false, publicName: false };
    let expression;
    try {
        expression = new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRegExp(core)}(?=$|[^\\p{L}\\p{N}])`, 'giu');
    } catch {
        return { descriptor: false, publicName: false };
    }

    let descriptor = false;
    let publicName = false;
    for (const match of source.matchAll(expression)) {
        const start = (match.index || 0) + String(match[1] || '').length;
        const before = source.slice(Math.max(0, start - 80), start);
        const prefix = canonicalNameKey(before.match(/([\p{L}.'’\-]+)\s*$/u)?.[1]);
        if (GENERIC_IDENTITY_PREFIXES.has(prefix)) descriptor = true;
        else publicName = true;
    }
    return { descriptor, publicName };
}

/**
 * Find consequential character records that are still keyed only by a role or
 * descriptor. This is evidence-based: the current story must use every known
 * reference behind a determiner/title and never as a standalone public name.
 */
export function findUnresolvedIdentityPlaceholders(entities, recentText, maximum = 8) {
    const source = cleanString(recentText, 200_000);
    if (!source) return [];
    return Object.values(entities || {})
        .filter(record => normalizeEntityType(record?.type) === 'character' && record?.enabled !== false)
        .map(record => {
            const uses = uniqueStrings([record.name, ...(record.aliases || [])], 30)
                .map(reference => identityReferenceUses(source, reference));
            return {
                record,
                descriptor: uses.some(use => use.descriptor),
                publicName: uses.some(use => use.publicName),
            };
        })
        .filter(item => item.descriptor && !item.publicName)
        .sort((a, b) => (
            (Number(b.record.lastSeenMessage) || -1) - (Number(a.record.lastSeenMessage) || -1)
            || (Number(b.record.importance) || 0) - (Number(a.record.importance) || 0)
        ))
        .slice(0, clamp(maximum, 1, 20))
        .map(item => normalizeName(item.record.name))
        .filter(Boolean);
}

/** Keep recency accurate even when the curator correctly omits an unchanged record. */
export function refreshMentionRecency(store, passage, messageIndex, options = {}) {
    const index = Number.isInteger(messageIndex) ? messageIndex : -1;
    const result = { entities: 0, brains: 0 };

    if (options.entities !== false) {
        for (const record of Object.values(store?.entities || {})) {
            if (!textMentions(passage, [record.name, ...(record.aliases || []), ...(record.keys || [])])) continue;
            const parsed = Number(record.lastSeenMessage);
            const previous = Number.isFinite(parsed) ? parsed : -1;
            record.lastSeenMessage = Math.max(previous, index);
            if (record.lastSeenMessage !== previous) result.entities++;
        }
    }

    if (options.brains !== false) {
        for (const brain of Object.values(store?.brains || {})) {
            if (!textMentions(passage, [brain.name, ...(brain.aliases || [])])) continue;
            const parsed = Number(brain.lastSeenMessage);
            const previous = Number.isFinite(parsed) ? parsed : -1;
            brain.lastSeenMessage = Math.max(previous, index);
            if (brain.lastSeenMessage !== previous) result.brains++;
        }
    }

    if (result.entities || result.brains) store.updatedAt = Date.now();
    return result;
}

const DORMANT_CONTEXT_STATE = /\b(?:absent|away|departed|elsewhere|left\s+behind|no\s+longer\s+(?:here|present)|not\s+present|not\s+visited|only\s+mentioned|off[ -]?screen|previous\s+scene|rejected|declined)\b/iu;

function takeRankedWithWorldDiversity(ranked, maximumEntries, sceneAware = false) {
    const selected = [];
    const selectedRecords = new Set();
    const add = item => {
        if (!item || selectedRecords.has(item.record)) return;
        selected.push(item);
        selectedRecords.add(item.record);
    };

    for (const item of ranked) {
        if (!item.record.pinned || selected.length >= maximumEntries) continue;
        add(item);
    }

    // Crowded casts should not displace a location or item that is genuinely
    // part of the current focus. Under scene-aware compilation, a merely recent
    // object elsewhere must not gain a slot solely because of its type.
    for (const type of ['location', 'item']) {
        if (selected.length >= maximumEntries) break;
        add(ranked.find(item => item.record.type === type && (
            !sceneAware || item.sceneRelevant || item.latestMentioned || item.focusMentioned
        )));
    }

    for (const item of ranked) {
        if (selected.length >= maximumEntries) break;
        add(item);
    }
    return selected.slice(0, maximumEntries);
}

export function rankRelevantEntities(entities, recentText, options = {}) {
    const currentIndex = Number.isInteger(options.currentIndex) ? options.currentIndex : Number.MAX_SAFE_INTEGER;
    const recencyMessages = clamp(options.recencyMessages ?? 12, 0, 200);
    const scene = options.scene && typeof options.scene === 'object' ? options.scene : null;
    const sceneAware = Boolean(scene);
    const latestText = cleanString(options.latestText || scene?.latestText, 30_000);
    const focusText = cleanString(scene?.focusText || latestText, 40_000);
    const sceneIds = new Set([
        scene?.location?.id,
        ...(scene?.participants || []).map(item => item.id),
        ...(scene?.objects || []).map(item => item.id),
    ].filter(Boolean));
    const hasStrongScene = Boolean(scene?.location || scene?.participants?.length || latestText);
    return Object.values(entities || {})
        .filter(record => record?.enabled !== false)
        .map(record => {
            const references = [record.name, ...(record.aliases || []), ...(record.keys || [])];
            const latestMentioned = textMentions(latestText, references);
            const focusMentioned = textMentions(focusText, references);
            const mentioned = textMentions(recentText, references);
            const recalled = textMentions(options.recalledText, references);
            const age = currentIndex - (Number(record.lastSeenMessage) || 0);
            const recent = age >= 0 && age <= recencyMessages;
            const unresolved = Boolean(record.unresolved?.length);
            const sceneRelevant = sceneIds.has(record.id);
            const dormant = ['destroyed', 'lost', 'inactive'].includes(record.status)
                || DORMANT_CONTEXT_STATE.test(`${record.currentState || ''} ${record.summary || ''}`);
            const reasons = [];
            if (record.pinned) reasons.push('pinned');
            if (sceneRelevant) reasons.push('current scene');
            if (latestMentioned) reasons.push('latest turn');
            else if (focusMentioned) reasons.push('scene focus');
            else if (mentioned) reasons.push('recent history');
            if (recalled) reasons.push('summary recall');
            if (unresolved) reasons.push('open thread');
            if (dormant && !sceneRelevant && !latestMentioned) reasons.push('dormant/elsewhere');
            const score = (record.pinned ? 10_000 : 0)
                + (sceneRelevant ? 4_500 : 0)
                + (latestMentioned ? 3_500 : 0)
                + (focusMentioned ? 1_700 : 0)
                + (mentioned ? 300 : 0)
                + (recalled ? 250 : 0)
                + (recent ? 250 - Math.min(220, age * 20) : 0)
                + (unresolved ? 220 : 0)
                + clamp(record.importance ?? 50, 0, 100)
                + Math.min(30, Number(record.revision) || 0)
                - (dormant && !sceneRelevant && !latestMentioned ? 3_000 : 0);
            const eligible = !sceneAware
                ? (record.pinned || mentioned || recalled || recent || unresolved)
                : (record.pinned || sceneRelevant || latestMentioned || focusMentioned
                    || (recalled && !hasStrongScene)
                    || (unresolved && (!hasStrongScene || latestMentioned || focusMentioned || sceneRelevant))
                    || (!hasStrongScene && recent));
            return {
                record,
                mentioned,
                latestMentioned,
                focusMentioned,
                recalled,
                recent,
                unresolved,
                sceneRelevant,
                dormant,
                reasons,
                eligible,
                score,
            };
        })
        .sort((a, b) => b.score - a.score || a.record.name.localeCompare(b.record.name));
}

export function selectRelevantEntities(entities, recentText, options = {}) {
    const maximumEntries = clamp(options.maximumEntries ?? 6, 1, 30);
    const sceneAware = Boolean(options.scene && typeof options.scene === 'object');
    return takeRankedWithWorldDiversity(
        rankRelevantEntities(entities, recentText, options).filter(item => item.eligible),
        maximumEntries,
        sceneAware,
    )
        .map(item => item.record);
}

export function rankRelevantBrains(brains, recentText, options = {}) {
    const currentIndex = Number.isInteger(options.currentIndex) ? options.currentIndex : Number.MAX_SAFE_INTEGER;
    const recencyMessages = clamp(options.recencyMessages ?? 8, 0, 200);
    const scene = options.scene && typeof options.scene === 'object' ? options.scene : null;
    const sceneAware = Boolean(scene);
    const latestText = cleanString(options.latestText || scene?.latestText, 30_000);
    const focusText = cleanString(scene?.focusText || latestText, 40_000);
    const participantIds = new Set((scene?.participants || []).map(item => item.id).filter(Boolean));
    const participantNames = new Set((scene?.participants || []).map(item => canonicalNameKey(item.name)));
    const hasStrongScene = Boolean(scene?.participants?.length || latestText);
    return Object.values(brains || {})
        .filter(brain => brain?.enabled !== false && brainPsychologyCount(brain) > 0)
        .map(brain => {
            const references = [brain.name, ...(brain.aliases || [])];
            const latestMentioned = textMentions(latestText, references);
            const focusMentioned = textMentions(focusText, references);
            const mentioned = textMentions(recentText, [brain.name, ...(brain.aliases || [])]);
            const age = currentIndex - (Number(brain.lastSeenMessage) || 0);
            const recent = age >= 0 && age <= recencyMessages;
            const sceneRelevant = participantIds.has(brain.id) || participantNames.has(canonicalNameKey(brain.name));
            const reasons = [];
            if (brain.pinned) reasons.push('pinned');
            if (sceneRelevant) reasons.push('current scene');
            if (latestMentioned) reasons.push('latest turn');
            else if (focusMentioned) reasons.push('scene focus');
            else if (mentioned) reasons.push('recent history');
            const score = (brain.pinned ? 10_000 : 0)
                + (sceneRelevant ? 4_000 : 0)
                + (latestMentioned ? 3_000 : 0)
                + (focusMentioned ? 1_500 : 0)
                + (mentioned ? 250 : 0)
                + (brain.active ? 200 : 0)
                + (recent ? 200 - Math.min(180, age * 20) : 0)
                + Math.min(100, brainPsychologyCount(brain) * 4);
            const eligible = !sceneAware
                ? (brain.pinned || mentioned || (brain.active && recent))
                : (brain.pinned || sceneRelevant || latestMentioned || focusMentioned
                    || (!hasStrongScene && brain.active && recent));
            return {
                brain,
                mentioned,
                latestMentioned,
                focusMentioned,
                recent,
                sceneRelevant,
                reasons,
                eligible,
                score,
            };
        })
        .sort((a, b) => b.score - a.score || a.brain.name.localeCompare(b.brain.name));
}

export function selectRelevantBrains(brains, recentText, options = {}) {
    const maximumBrains = clamp(options.maximumBrains ?? 4, 1, 20);
    return rankRelevantBrains(brains, recentText, options)
        .filter(item => item.eligible)
        .slice(0, maximumBrains)
        .map(item => item.brain);
}

function allocateRankedBudgets(items, totalBudget, options = {}) {
    const minimum = clamp(options.minimum ?? 160, 80, 2_000);
    const maximum = clamp(options.maximum ?? 1_800, minimum, 10_000);
    const separatorCost = 2;
    const count = Math.min(
        items.length,
        Math.max(1, Math.floor((totalBudget + separatorCost) / (minimum + separatorCost))),
    );
    const selected = items.slice(0, count);
    if (!selected.length) return [];
    const available = Math.max(0, totalBudget - Math.max(0, count - 1) * separatorCost);
    const budgets = selected.map(item => ({
        item,
        budget: Math.min(minimum, Math.floor(available / count)),
        weight: 1
            + (item.sceneRelevant ? 2.5 : 0)
            + (item.latestMentioned ? 2 : 0)
            + (item.focusMentioned ? 1 : 0)
            + (item.unresolved ? 0.5 : 0),
    }));
    let remaining = Math.max(0, available - budgets.reduce((sum, entry) => sum + entry.budget, 0));
    while (remaining > 0) {
        const eligible = budgets.filter(entry => entry.budget < maximum);
        if (!eligible.length) break;
        const totalWeight = eligible.reduce((sum, entry) => sum + entry.weight, 0);
        let distributed = 0;
        for (const entry of eligible) {
            const share = Math.max(1, Math.floor(remaining * entry.weight / Math.max(1, totalWeight)));
            const addition = Math.min(share, maximum - entry.budget, remaining - distributed);
            entry.budget += addition;
            distributed += addition;
            if (distributed >= remaining) break;
        }
        if (!distributed) break;
        remaining -= distributed;
    }
    return budgets;
}

function facetRanking(brain, options = {}) {
    const currentIndex = Number.isInteger(options.currentIndex) ? options.currentIndex : Number.MAX_SAFE_INTEGER;
    const focusText = cleanString(options.scene?.focusText || options.focusText, 40_000);
    const externalConcepts = Array.isArray(options.externalConcepts) ? options.externalConcepts : [];
    const relevantMemoryKeys = new Set(brain?.currentMind?.relevantMemoryKeys || []);
    const kindPriority = {
        personal_anchor: 270,
        self_concept: 240,
        contradiction: 220,
        emotional_need: 210,
        fear: 200,
        desire: 190,
        value: 180,
        goal: 170,
        secret: 160,
        behavioral_tendency: 150,
        worldview: 140,
        belief: 130,
        insecurity: 125,
        bias: 115,
        memory: 100,
        opinion: 90,
        plan: 80,
        relationship_stance: 70,
        trait: 60,
    };
    return Object.values(brain?.persistentSelf?.facets || {})
        .map(facet => {
            const source = Number(facet.sourceMessage);
            const age = Number.isFinite(source) && Number.isFinite(currentIndex)
                ? Math.max(0, currentIndex - source)
                : Number.MAX_SAFE_INTEGER;
            const similarity = contextSimilarity(facet.statement, focusText);
            const progressionDuplicate = ['goal', 'plan', 'desire'].includes(facet.kind)
                && nearDuplicate(facet.statement, externalConcepts, 0.58);
            const score = similarity * 1_000
                + (kindPriority[facet.kind] || 0)
                + (relevantMemoryKeys.has(facet.key) ? 700 : 0)
                + (facet.confidence === 'confirmed' ? 25 : 0)
                + Math.max(0, 100 - Math.min(100, age * 5))
                - (progressionDuplicate ? 700 : 0);
            return { facet, age, similarity, progressionDuplicate, score };
        })
        .filter(item => !item.progressionDuplicate)
        .sort((a, b) => b.score - a.score || String(a.facet.key).localeCompare(String(b.facet.key)));
}

function relationshipRanking(brain, options = {}) {
    const focusText = cleanString(options.scene?.focusText || options.focusText, 40_000);
    const latestText = cleanString(options.scene?.latestText, 30_000);
    const participantNames = new Set((options.scene?.participants || []).map(item => canonicalNameKey(item.name)));
    return Object.values(brain?.persistentSelf?.relationships || {})
        .map(relationship => {
            const references = [relationship.target, ...(relationship.aliases || [])];
            const latestMentioned = textMentions(latestText, references);
            const focusMentioned = textMentions(focusText, references);
            const participant = participantNames.has(canonicalNameKey(relationship.target));
            const aspectSimilarity = Math.max(0, ...Object.values(relationship.aspects || {})
                .map(aspect => contextSimilarity(aspect.statement, focusText)));
            const score = (latestMentioned ? 2_000 : 0)
                + (focusMentioned ? 1_200 : 0)
                + (participant ? 900 : 0)
                + aspectSimilarity * 500
                + Math.min(100, Number(relationship.revision) || 0);
            return {
                relationship,
                latestMentioned,
                focusMentioned,
                participant,
                score,
                eligible: latestMentioned || focusMentioned || participant || aspectSimilarity >= 0.35,
            };
        })
        .filter(item => item.eligible)
        .sort((a, b) => b.score - a.score || a.relationship.target.localeCompare(b.relationship.target));
}

function currentMindIsFresh(brain, options = {}) {
    if (!brain?.currentMind) return false;
    const currentIndex = Number.isInteger(options.currentIndex) ? options.currentIndex : Number.MAX_SAFE_INTEGER;
    const maximumAge = clamp(options.maximumSceneThoughtAge ?? 6, 1, 100);
    const source = Number(brain.currentMind.sourceMessage);
    return Number.isFinite(source) && Number.isFinite(currentIndex)
        && currentIndex >= source
        && currentIndex - source <= maximumAge;
}

function selectedVoice(brain, focusText, maximum = 3) {
    const priorities = {
        thought_style: 500,
        pressure_shift: 480,
        emphasis: 470,
        cadence: 420,
        emotional_openness: 400,
        vocabulary: 360,
        formality: 340,
        humor: 320,
        sarcasm: 300,
        profanity: 280,
        hesitation: 260,
        avoidance: 240,
        verbal_habit: 200,
    };
    const ranked = Object.values(brain?.persistentSelf?.voice || {})
        .map(entry => ({
            entry,
            score: (priorities[entry.kind] || 0) + contextSimilarity(entry.statement, focusText) * 600,
        }))
        .sort((a, b) => b.score - a.score || String(a.entry.key).localeCompare(String(b.entry.key)));
    const chosen = [];
    const takeFirst = predicate => {
        if (chosen.length >= maximum) return;
        const match = ranked.find(item => !chosen.includes(item) && predicate(item.entry));
        if (match) chosen.push(match);
    };

    // Lexical overlap with the newest scene must not crowd out the two voice
    // roles that actually make prose recognizable: private sentence formation
    // and outward/pressure realization. A dedicated emphasis entry receives a
    // third reserved slot when the prompt budget permits it.
    takeFirst(entry => entry.kind === 'thought_style');
    takeFirst(entry => [
        'pressure_shift', 'hesitation', 'cadence', 'emotional_openness',
        'formality', 'avoidance',
    ].includes(entry.kind));
    if (maximum >= 3) takeFirst(entry => entry.kind === 'emphasis');
    for (const item of ranked) {
        if (chosen.length >= maximum) break;
        if (!chosen.includes(item)) chosen.push(item);
    }
    return chosen.map(item => item.entry);
}

function emphasisPermitsCaseStress(entry) {
    const statement = cleanString(entry?.statement, 2_000);
    if (!statement) return false;
    const clauses = statement.split(/(?<=[.;])\s+/u);
    const privateClauses = clauses.filter(clause => /\b(?:private|inner|thought|internally)\b/iu.test(clause));
    const relevant = (privateClauses.length ? privateClauses : clauses).join(' ');
    const mentionsCase = /\b(?:capitali[sz](?:e|ed|ation)|capitals?|upper.?case|lower.?case|case stress|case shift)\b/iu.test(relevant);
    const forbidsCase = /\b(?:avoid|avoids|never|without|forbid|reject)[^.]{0,90}\b(?:capitals?|upper.?case|lower.?case|case stress|case shift)\b/iu.test(relevant)
        || /\bnot\s+(?:through|with|using)\s+(?:capitals?|upper.?case|lower.?case|case stress)\b/iu.test(relevant);
    return mentionsCase && !forbidsCase;
}

const GENERIC_EXPRESSION_ANCHOR_TERMS = new Set([
    'anyone', 'anything', 'everyone', 'everything', 'someone', 'something',
    'probably', 'whatever', 'always', 'never', 'really', 'person', 'people',
    'want', 'need', 'fear', 'think', 'feel', 'thing', 'things', 'myself', 'yourself',
    'expect', 'expected', 'try', 'trying', 'afraid', 'scared', 'anxious', 'angry',
    'sad', 'happy', 'embarrassed', 'terrified', 'believe', 'feeling',
]);

function expressionAnchorTerms(value, maximum = 5, excludedText = '') {
    const words = cleanString(value, 2_000).toLocaleLowerCase()
        .match(/[\p{L}\p{N}][\p{L}\p{N}'’_-]*/gu) || [];
    const excluded = new Set(contextTokens(excludedText, 600));
    const result = [];
    for (const raw of words) {
        const token = raw.replace(/[’']s$/u, '').replace(/^[-_]+|[-_]+$/gu, '');
        const stem = contextTokens(token, 1)[0] || token;
        if (token.length < 3
            || CONTEXT_STOP_WORDS.has(token)
            || GENERIC_EXPRESSION_ANCHOR_TERMS.has(token)
            || excluded.has(stem)
            || result.includes(token)) continue;
        result.push(token);
        if (result.length >= Math.max(1, maximum)) break;
    }
    return result;
}

const PRIVATE_EXPRESSION_LENS_KINDS = new Set([
    'personal_anchor', 'self_concept', 'contradiction', 'fear', 'insecurity', 'desire',
    'emotional_need', 'value', 'worldview', 'bias', 'secret', 'relationship_stance',
]);

function selectExpressionAnchor(selectedFacets, currentMind, recentExpressionText) {
    const candidates = selectedFacets.filter(facet => PRIVATE_EXPRESSION_LENS_KINDS.has(facet.kind));
    if (!candidates.length) {
        const statement = cleanString(currentMind?.interpretation, 2_000);
        return {
            statement,
            freshTerms: expressionAnchorTerms(statement, 5, recentExpressionText),
            rotated: false,
            facet: null,
        };
    }
    if (!cleanString(recentExpressionText)) {
        return {
            statement: candidates[0].statement,
            freshTerms: expressionAnchorTerms(candidates[0].statement),
            rotated: false,
            facet: candidates[0],
        };
    }

    const ranked = candidates.map((facet, index) => {
        const allTerms = expressionAnchorTerms(facet.statement, 10);
        const freshTerms = expressionAnchorTerms(facet.statement, 10, recentExpressionText);
        const used = Math.max(0, allTerms.length - freshTerms.length);
        const freshness = allTerms.length ? freshTerms.length / allTerms.length : 0;
        return { facet, index, freshTerms, used, freshness };
    }).sort((left, right) => (
        right.freshness - left.freshness
        || left.used - right.used
        || left.index - right.index
    ));
    const chosen = ranked[0];
    return {
        statement: chosen.facet.statement,
        freshTerms: chosen.freshTerms.slice(0, 5),
        rotated: chosen.index > 0,
        facet: chosen.facet,
    };
}

function recentlySpentSurface(value, recentExpressionText, threshold = 0.45) {
    const text = cleanString(value, 4_000);
    const tokens = contextTokens(text, 80);
    if (!text || tokens.length < 3 || !cleanString(recentExpressionText)) return false;
    const recentTokens = new Set(contextTokens(recentExpressionText, 600));
    const overlap = tokens.filter(token => recentTokens.has(token)).length;
    // Requiring two shared content concepts prevents one generic verb from
    // cooling an otherwise new line, while the ratio catches paraphrased
    // repetitions such as "hand out of pocket" after "hand reached pocket".
    return overlap >= 2 && overlap / tokens.length >= threshold;
}

/** Render only scene-relevant psychology for the narration model's Expression layer. */
export function renderBrain(brain, maximumLength = 2_000, options = {}) {
    const maximum = clamp(maximumLength, 100, 10_000);
    const maximumFacets = clamp(options.maximumThoughts ?? (options.scene ? 6 : 200), 1, 200);
    const focusText = cleanString(options.scene?.focusText || options.focusText, 40_000);
    const rankedFacets = facetRanking(brain, options);
    const selectedFacets = [];
    const selectedStatements = [];
    let duplicatesSuppressed = 0;
    const addFacet = item => {
        if (nearDuplicate(item.facet.statement, selectedStatements, 0.74)) {
            duplicatesSuppressed++;
            return false;
        }
        selectedFacets.push(item.facet);
        selectedStatements.push(item.facet.statement);
        return true;
    };

    // Preserve a compact, category-diverse identity foundation even when an
    // immediate scene has much more lexical overlap with a recent belief.
    const foundationKinds = new Set([
        'personal_anchor', 'self_concept', 'value', 'worldview', 'fear', 'insecurity', 'desire',
        'emotional_need', 'contradiction', 'behavioral_tendency',
    ]);
    const foundationLimit = maximumFacets >= 5 ? 2 : maximumFacets >= 3 ? 1 : 0;
    const usedFoundationKinds = new Set();
    for (const item of rankedFacets.filter(candidate => foundationKinds.has(candidate.facet.kind))) {
        if (selectedFacets.length >= foundationLimit) break;
        if (usedFoundationKinds.has(item.facet.kind)) continue;
        if (addFacet(item)) usedFoundationKinds.add(item.facet.kind);
    }
    const kindCounts = new Map();
    for (const facet of selectedFacets) kindCounts.set(facet.kind, (kindCounts.get(facet.kind) || 0) + 1);
    for (const item of rankedFacets) {
        if (selectedFacets.length >= maximumFacets || selectedFacets.includes(item.facet)) continue;
        const kindLimit = item.facet.kind === 'contradiction'
            ? Math.max(1, Math.floor(maximumFacets / 3))
            : maximumFacets;
        if ((kindCounts.get(item.facet.kind) || 0) >= kindLimit) continue;
        if (addFacet(item)) kindCounts.set(item.facet.kind, (kindCounts.get(item.facet.kind) || 0) + 1);
    }

    const voice = selectedVoice(brain, focusText, maximumFacets >= 5 ? 3 : 2);
    const emphasisVoice = voice.find(entry => entry.kind === 'emphasis');
    const caseStressPermitted = emphasisPermitsCaseStress(emphasisVoice);
    const relationships = relationshipRanking(brain, options).slice(0, 2);
    const currentMind = currentMindIsFresh(brain, options) ? brain.currentMind : null;
    const recentExpressionText = cleanString(options.recentExpressionText, 4_000);
    const expressionAnchor = selectExpressionAnchor(selectedFacets, currentMind, recentExpressionText);
    const privateAnchor = expressionAnchor.statement;
    const renderedFacets = expressionAnchor.rotated && expressionAnchor.facet
        ? [
            expressionAnchor.facet,
            ...selectedFacets.filter(facet => (
                facet !== expressionAnchor.facet && facet.kind !== 'personal_anchor'
            )),
        ]
        : selectedFacets;
    const thoughtVoice = voice.find(entry => entry.kind === 'thought_style');
    const outwardVoice = voice.find(entry => (
        ['pressure_shift', 'hesitation', 'cadence', 'emotional_openness', 'formality', 'avoidance'].includes(entry.kind)
    ));
    const lines = [];
    const claims = [];
    let facetsRendered = 0;
    let voiceRendered = 0;
    let relationshipsRendered = 0;
    let relationshipAspectsSelected = 0;
    let currentMindRendered = false;
    let cooledSurfaceDetails = 0;
    const appendFacet = facet => {
        const result = appendBoundedLine(
            lines,
            `- [${facet.kind}; ${facet.confidence}] ${facet.statement}`,
            maximum,
            claims,
            { claim: facet.statement, internalThreshold: 0.74 },
        );
        if (result.added) facetsRendered++;
        return result.added;
    };
    const appendVoice = entry => {
        const result = appendBoundedLine(
            lines,
            `- [${entry.kind}] ${entry.statement}`,
            maximum,
            claims,
            { claim: entry.statement, internalThreshold: 0.76 },
        );
        if (result.added) voiceRendered++;
        return result.added;
    };
    appendBoundedLine(lines, `${brain.name}:`, maximum, claims, { always: true });

    const pressuredCurrentMind = Boolean(currentMind) && (
        (currentMind.emotions || []).some(emotion => ['high', 'overwhelming'].includes(emotion.intensity))
        || Boolean(currentMind.conflict)
        || (Boolean(currentMind.impulse) && Boolean(currentMind.restraint))
    );
    if (pressuredCurrentMind) {
        const publicFilter = [
            { value: currentMind.restraint, threshold: 0.3 },
            { value: currentMind.conflict, threshold: 0.45 },
            { value: currentMind.impulse, threshold: 0.3 },
        ].find(item => !recentlySpentSurface(item.value, recentExpressionText, item.threshold))?.value
            || currentMind.conflict || '';
        const fallbackVoice = voice.find(entry => (
            entry !== thoughtVoice && entry !== outwardVoice && entry !== emphasisVoice
        ));
        const pressureLanguage = [...new Set([thoughtVoice, outwardVoice, emphasisVoice, fallbackVoice]
            .filter(Boolean)
            .slice(0, 3))]
            .map(entry => entry.statement)
            .join(' ');
        appendBoundedLine(
            lines,
            'Expression synthesis for the newest event (compose fresh language; never quote these notes as a list):',
            maximum,
            claims,
            { always: true },
        );
        if (recentExpressionText) appendBoundedLine(
            lines,
            '- Surface cooldown is active: preserve the psychology, but do not reuse a conspicuous recent gesture, prop interaction, gaze beat, body response, metaphor, self-command, dialogue scaffold, or sentence pattern. If a Current Mind line repeats one, translate its motive into a different compatible realization.',
            maximum,
            claims,
            { always: true },
        );
        if (privateAnchor) appendBoundedLine(
            lines,
            `- Private lens that must become audible in direct thought: ${privateAnchor}`,
            maximum,
            claims,
            { always: true },
        );
        if (publicFilter) appendBoundedLine(
            lines,
            `- What outward expression must filter, conceal, or struggle against: ${publicFilter}`,
            maximum,
            claims,
            { always: true },
        );
        if (pressureLanguage) appendBoundedLine(
            lines,
            recentExpressionText
                ? `- Underlying pressure-language tendency: ${pressureLanguage} Preserve its character logic, but if its obvious device appears in cooldown, use a different compatible construction instead of repeating the tic.`
                : `- Supported pressure-language tendency that must be literally perceptible in thought or dialogue construction: ${pressureLanguage}`,
            maximum,
            claims,
            { always: true },
        );
        appendBoundedLine(
            lines,
            '- Anti-generic check: do not substitute polished bravery; controlled speech must expose its cost in private syntax.',
            maximum,
            claims,
            { always: true },
        );
        appendBoundedLine(
            lines,
            '- Literal surface gate: neutral polished construction throughout is a miss. Perform at least two supported shifts across thought and speech—case contrast, punctuation/interruption, repetition, fragments/restarts, length change, profanity, or silence. Fit this NPC and moment; avoid fixed emotion mappings and decorative excess.',
            maximum,
            claims,
            { always: true },
        );
        if (emphasisVoice) appendBoundedLine(
            lines,
            '- Case-policy gate: if the supplied emphasis tendency permits case stress, make one meaningful case shift visible in this high-stakes beat; other punctuation does not replace it. If that tendency explicitly avoids capitals, honour the restraint and intensify through its supported alternatives.',
            maximum,
            claims,
            { always: true },
        );
    } else if (voice.length && options.scene) {
        appendBoundedLine(
            lines,
            'Stable expression fallback: no fresh transient mind is safe to inject, so infer the reaction only from the newest event; if this NPC reacts, still perform the supplied personality and voice through literal word choice, cadence, case, punctuation, repetition, interruption, or restraint rather than narrator labels or uniformly polished prose.',
            maximum,
            claims,
            { always: true },
        );
    }

    if (renderedFacets.length) {
        appendBoundedLine(lines, 'Persistent Self:', maximum, claims, { always: true });
        appendFacet(renderedFacets[0]);
    }

    if (voice.length) {
        appendBoundedLine(lines, 'Individual voice:', maximum, claims, { always: true });
        appendVoice(voice[0]);
    }

    if (currentMind) {
        currentMindRendered = appendBoundedLine(
            lines,
            'Current Mind (transient subjective lens):',
            maximum,
            claims,
            { always: true },
        ).added;
        for (const emotion of currentMind.emotions || []) {
            const cause = emotion.cause ? ` — ${emotion.cause}` : '';
            appendBoundedLine(lines, `- Emotion: ${emotion.name} (${emotion.intensity})${cause}`, maximum, claims, {
                claim: `${emotion.name} ${emotion.cause}`,
            });
        }
        for (const thought of currentMind.innerThoughts || []) {
            if (recentlySpentSurface(thought, recentExpressionText)) {
                cooledSurfaceDetails++;
                continue;
            }
            appendBoundedLine(lines, `- Unfiltered inner thought: ${thought}`, maximum, claims, { claim: thought });
        }
        for (const [label, value] of [
            ['Impulse', currentMind.impulse],
            ['Restraint', currentMind.restraint],
            ['Internal conflict', currentMind.conflict],
            ['Decision/intention', currentMind.intention],
        ]) {
            if (['Impulse', 'Restraint'].includes(label)
                && recentlySpentSurface(value, recentExpressionText, 0.3)) {
                cooledSurfaceDetails++;
                continue;
            }
            if (value) appendBoundedLine(lines, `- ${label}: ${value}`, maximum, claims, { claim: value });
        }
        // Lower-priority reconstruction detail follows the expressive core so
        // a tight per-NPC budget never keeps perception while clipping the
        // thought/restraint/decision which actually differentiates prose.
        for (const [label, value] of [
            ['Interpretation', currentMind.interpretation],
            ['Expectation', currentMind.expectation],
            ['Immediate goal', currentMind.immediateGoal],
            ['Attention', currentMind.attention],
            ['Perception', currentMind.perception],
        ]) {
            const surfaceThreshold = label === 'Attention' ? 0.3 : 0.45;
            if (['Interpretation', 'Attention'].includes(label)
                && recentlySpentSurface(value, recentExpressionText, surfaceThreshold)) {
                cooledSurfaceDetails++;
                continue;
            }
            if (value) appendBoundedLine(lines, `- ${label}: ${value}`, maximum, claims, { claim: value });
        }
    }

    for (const item of relationships) {
        const relationship = item.relationship;
        const headingAdded = appendBoundedLine(
            lines,
            `Subjective relationship with ${relationship.target}:`,
            maximum,
            claims,
            { always: true },
        ).added;
        let aspectsAdded = 0;
        const aspects = Object.values(relationship.aspects || {})
            .sort((a, b) => (
                contextSimilarity(b.statement, focusText) - contextSimilarity(a.statement, focusText)
                || (Number(b.updatedAt) || 0) - (Number(a.updatedAt) || 0)
            ))
            .slice(0, 3);
        for (const aspect of aspects) {
            if (appendBoundedLine(
                lines,
                `- [${aspect.kind}; ${aspect.confidence}] ${aspect.statement}`,
                maximum,
                claims,
                { claim: aspect.statement, internalThreshold: 0.74 },
            ).added) {
                aspectsAdded++;
                relationshipAspectsSelected++;
            }
        }
        if (headingAdded && aspectsAdded) relationshipsRendered++;
    }

    if (renderedFacets.length > 1) {
        appendBoundedLine(lines, 'Other relevant persistent state:', maximum, claims, { always: true });
        for (const facet of renderedFacets.slice(1)) appendFacet(facet);
    }
    if (voice.length > 1) {
        appendBoundedLine(lines, 'Other relevant voice cues:', maximum, claims, { always: true });
        for (const entry of voice.slice(1)) appendVoice(entry);
    }

    if (options.diagnostics && typeof options.diagnostics === 'object') {
        options.diagnostics.duplicatesSuppressed = (options.diagnostics.duplicatesSuppressed || 0) + duplicatesSuppressed;
        options.diagnostics.facetsSelected = facetsRendered;
        options.diagnostics.facetsAvailable = Object.keys(brain?.persistentSelf?.facets || {}).length;
        options.diagnostics.voiceSelected = voiceRendered;
        options.diagnostics.relationshipsSelected = relationshipsRendered;
        options.diagnostics.relationshipAspectsSelected = relationshipAspectsSelected;
        options.diagnostics.currentMindIncluded = currentMindRendered;
        options.diagnostics.pressuredCurrentMind = pressuredCurrentMind;
        options.diagnostics.caseStressPermitted = caseStressPermitted;
        options.diagnostics.expressionAnchor = cleanString(privateAnchor, 500);
        options.diagnostics.expressionVoiceAnchor = cleanString(thoughtVoice?.statement, 500);
        options.diagnostics.expressionOuterVoiceAnchor = cleanString(outwardVoice?.statement, 500);
        options.diagnostics.expressionEmphasisAnchor = cleanString(emphasisVoice?.statement, 500);
        options.diagnostics.expressionAnchorTerms = expressionAnchor.freshTerms;
        options.diagnostics.expressionAnchorRotated = expressionAnchor.rotated;
        options.diagnostics.cooledSurfaceDetails = cooledSurfaceDetails;
    }
    return cleanString(lines.join('\n'), maximum);
}

/** Build continuity context plus structured selection diagnostics. */
export function compilePromptInjection(store, recentText, settings = {}) {
    if (!settings.enabled) {
        return {
            text: '',
            blocks: { minds: '', lore: '' },
            selectedBrains: [],
            selectedEntities: [],
            omittedEntities: [],
            duplicatesSuppressed: 0,
        };
    }
    const currentIndex = Number.isInteger(settings.currentIndex) ? settings.currentIndex : Number.MAX_SAFE_INTEGER;
    const scene = settings.scene && typeof settings.scene === 'object' ? settings.scene : null;
    const latestText = cleanString(settings.latestText || scene?.latestText, 30_000);
    const focusText = cleanString(scene?.focusText || latestText || recentText, 40_000);
    const externalConcepts = Array.isArray(settings.externalConcepts) ? settings.externalConcepts : [];
    const recentExpressionText = cleanString(settings.recentExpressionText, 4_000);
    const blocks = { minds: '', lore: '' };
    const selectedBrains = [];
    const selectedEntities = [];
    const omittedEntities = [];
    let duplicatesSuppressed = 0;

    if (settings.innerSelfEnabled !== false) {
        const ranked = rankRelevantBrains(store.brains, recentText, {
            currentIndex,
            recencyMessages: settings.brainRecencyMessages,
            scene,
            latestText,
        });
        const eligibleRanked = ranked.filter(item => item.eligible);
        const maximumBrains = clamp(settings.maximumActiveBrains ?? 4, 1, 20);
        const allocations = allocateRankedBudgets(
            eligibleRanked.slice(0, maximumBrains),
            clamp(settings.brainInjectionBudget ?? 3_500, 500, 30_000),
            { minimum: 320, maximum: 3_200 },
        );
        const rendered = [];
        for (const { item, budget } of allocations) {
            const diagnostics = {};
            const text = renderBrain(item.brain, budget, {
                scene,
                focusText,
                currentIndex,
                maximumThoughts: settings.maximumInjectedThoughtsPerBrain ?? 6,
                maximumSceneThoughtAge: settings.maximumSceneThoughtAge ?? 6,
                externalConcepts,
                recentExpressionText,
                diagnostics,
            });
            if (!text) continue;
            rendered.push(text);
            duplicatesSuppressed += diagnostics.duplicatesSuppressed || 0;
            selectedBrains.push({
                id: item.brain.id,
                name: item.brain.name,
                score: Math.round(item.score),
                reasons: item.reasons,
                characters: text.length,
                facetsSelected: diagnostics.facetsSelected || 0,
                facetsAvailable: diagnostics.facetsAvailable || 0,
                voiceSelected: diagnostics.voiceSelected || 0,
                relationshipsSelected: diagnostics.relationshipsSelected || 0,
                relationshipAspectsSelected: diagnostics.relationshipAspectsSelected || 0,
                currentMindIncluded: Boolean(diagnostics.currentMindIncluded),
                pressuredCurrentMind: Boolean(diagnostics.pressuredCurrentMind),
                caseStressPermitted: Boolean(diagnostics.caseStressPermitted),
                expressionAnchor: diagnostics.expressionAnchor || '',
                expressionVoiceAnchor: diagnostics.expressionVoiceAnchor || '',
                expressionOuterVoiceAnchor: diagnostics.expressionOuterVoiceAnchor || '',
                expressionEmphasisAnchor: diagnostics.expressionEmphasisAnchor || '',
                expressionAnchorTerms: diagnostics.expressionAnchorTerms || [],
                expressionAnchorRotated: Boolean(diagnostics.expressionAnchorRotated),
                cooledSurfaceDetails: diagnostics.cooledSurfaceDetails || 0,
            });
        }
        if (rendered.length) {
            const cooldown = recentExpressionText
                ? `<recent_expression_cooldown priority="hard">
The excerpts below are already-spent Expression, not wording to continue or imitate. Preserve the underlying personality, emotion, relationship, and intention, but change their realization in the next reply. Do not reuse the same conspicuous gesture, prop interaction, gaze movement, body response, metaphor, sensory cue, self-command, dialogue scaffold, or sentence pattern merely to prove continuity. A stable personal anchor colours interpretation; it is never a compulsory prop or ritual on every turn. If Current Mind repeats a cooled surface, keep its psychological meaning and express it through another compatible channel. Reuse is allowed only when the newest event explicitly makes it necessary and the callback escalates, changes meaning, or pays off; otherwise choose a fresh concrete behaviour and fresh private wording.

${recentExpressionText}
</recent_expression_cooldown>

`
                : '';
            blocks.minds = `<inner_lore_private_minds narrator_only="true">
These notes are subjective and compartmentalized. A character knows only their own mind and established knowledge; never let one character know another's secrets or expose these labels.

Current Mind is the NPC's entering subjective state and may predate the newest turn. Reconstruct a fresh event → perception → interpretation → emotion → thought → conflict → intention → expression instead of reciting it.

A selected Current Mind grants the narrator close access unless canon forbids it. For a focal NPC facing meaningful stakes, braid observable physical behaviour, at least one short, unmistakably direct private-thought fragment in their literal voice, and dialogue containing only what they reveal.

Literalize the mind instead of translating it into narrator explanation. Italics or a fragment marker alone do not make a thought psychologically real. A thought that merely repeats or paraphrases the newest event, states the obvious, or names an emotion does not qualify; add this NPC's inference, self-judgment, desire, fear, memory, contradiction, self-command, impulse, or decision in their rhythm. Use one to three short direct-thought beats, normally in single-asterisk italics without labels. Stored thoughts are evidence, not quotations. Do not explain the same thought again, or force direct thought into neutral logistics, offscreen action, or every paragraph.

When restraint or conflict exists, make the thought-speech gap materially visible through concealment, denial, redirection, or leakage; rewording alone is not tension. Let voice, relationships, intensity, and restraint shape syntax naturally—never by a mechanical emotion-to-style rule or catchphrase. Under pressure, uniformly polished neutral construction is a failure unless that exact control belongs to the NPC, and even then private syntax must show its cost. Make personality visibly alter literal word choice and sentence construction. Where individually supported, use meaningful case contrast (including lower-case compression or selective CAPITAL stress), punctuation and interruption, repetition, fragments, restarts, sentence-length shifts, profanity, pauses, or silence. Use more than one supported surface choice across a high-stakes focal reaction, but never decorate every line or use every device. When a supplied emphasis tendency permits case stress, one meaningful case shift must appear in the high-stakes beat; if it explicitly avoids capitals, honour that and use its supported alternatives. Narrator commentary about how the voice sounds does not count. Keep viewpoint shifts and private knowledge distinct.

${cooldown}${rendered.join('\n\n')}
</inner_lore_private_minds>`;
        }
    }

    if (settings.autoLoreEnabled !== false) {
        const ranked = rankRelevantEntities(store.entities, recentText, {
            currentIndex,
            recencyMessages: settings.loreRecencyMessages,
            recalledText: settings.recalledText,
            scene,
            latestText,
        });
        const eligibleRanked = ranked.filter(item => item.eligible);
        const maximumEntries = clamp(settings.maximumInjectedEntities ?? 6, 1, 30);
        const selectedRanked = takeRankedWithWorldDiversity(eligibleRanked, maximumEntries, Boolean(scene));
        const selectedRecords = new Set(selectedRanked.map(item => item.record));
        for (const item of ranked) {
            if (!selectedRecords.has(item.record)) {
                omittedEntities.push({
                    id: item.record.id,
                    name: item.record.name,
                    type: item.record.type,
                    reasons: item.reasons,
                    score: Math.round(item.score),
                });
            }
        }
        const allocations = allocateRankedBudgets(
            selectedRanked,
            clamp(settings.loreInjectionBudget ?? 5_000, 500, 50_000),
            {
                minimum: 240,
                maximum: clamp(settings.perEntityInjectionLimit ?? 1_800, 240, 10_000),
            },
        );
        const rendered = [];
        const claimRegistry = [];
        for (const { item, budget } of allocations) {
            const diagnostics = {};
            const suppressCurrentState = Boolean(
                scene?.location?.source === 'explicit movement in latest turn'
                && (scene.participants || []).some(participant => participant.id === item.record.id),
            );
            const text = renderCompactEntity(item.record, budget, {
                focusText,
                externalConcepts,
                claimRegistry,
                suppressCurrentState,
                diagnostics,
            });
            if (!text) continue;
            rendered.push(text);
            duplicatesSuppressed += diagnostics.duplicatesSuppressed || 0;
            selectedEntities.push({
                id: item.record.id,
                name: item.record.name,
                type: item.record.type,
                score: Math.round(item.score),
                reasons: item.reasons,
                characters: text.length,
                clipped: Boolean(diagnostics.clipped),
            });
        }
        if (rendered.length) {
            blocks.lore = `<inner_lore_world_reference>
Treat confirmed details below as continuity reference. Current state and explicit open threads have priority over older facts. Preserve stated uncertainty. Do not force every detail into the next reply; use only what is naturally relevant to the compiled scene.

${rendered.join('\n\n')}
</inner_lore_world_reference>`;
        }
    }

    const text = [blocks.minds, blocks.lore].filter(Boolean).join('\n\n');
    return {
        text,
        blocks,
        selectedBrains,
        selectedEntities,
        omittedEntities,
        duplicatesSuppressed,
        characters: text.length,
    };
}

export function buildPromptInjection(store, recentText, settings = {}) {
    return compilePromptInjection(store, recentText, settings).text;
}

/** Extract the first balanced JSON object from reasoning tags or fenced output. */
export function extractJsonObject(value) {
    const text = String(value ?? '')
        .replace(/<think>[\s\S]*?<\/think>/gi, '')
        .replace(/<thinking>[\s\S]*?<\/thinking>/gi, '')
        .replace(/```(?:json)?/gi, '')
        .replace(/```/g, '')
        .trim();
    const start = text.indexOf('{');
    if (start < 0) throw new Error('The model response contained no JSON object.');

    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let index = start; index < text.length; index++) {
        const character = text[index];
        if (inString) {
            if (escaped) escaped = false;
            else if (character === '\\') escaped = true;
            else if (character === '"') inString = false;
            continue;
        }
        if (character === '"') {
            inString = true;
            continue;
        }
        if (character === '{') depth++;
        if (character === '}') depth--;
        if (depth === 0) {
            const candidate = text.slice(start, index + 1);
            try {
                return JSON.parse(candidate);
            } catch (error) {
                const repaired = candidate.replace(/,\s*([}\]])/g, '$1');
                try {
                    return JSON.parse(repaired);
                } catch {
                    throw new Error(`The model returned malformed JSON: ${error.message}`);
                }
            }
        }
    }
    throw new Error('The model response ended before its JSON object was complete.');
}

export function hashString(value) {
    const text = String(value ?? '');
    let hash = 0x811c9dc5;
    for (let index = 0; index < text.length; index++) {
        hash ^= text.charCodeAt(index);
        hash = Math.imul(hash, 0x01000193);
    }
    return (hash >>> 0).toString(16).padStart(8, '0');
}

export function messageFingerprint(message) {
    const role = message?.is_system && !isSummaryceptionGhosted(message)
        ? 'system'
        : (message?.is_user ? 'user' : 'assistant');
    return hashString(`${role}\n${cleanString(message?.mes, 100_000)}`);
}

/** Text used only as a lower-priority retrieval hint for structured lore. */
export function summaryceptionRecallText(chatMetadata, maximumCharacters = 24_000, maximumSnippets = 6) {
    const layers = chatMetadata?.summaryception?.layers;
    if (!Array.isArray(layers)) return '';
    // Only the newest low-level summaries represent recently compressed story.
    // Deep historical layers are already injected by SummarySception itself;
    // using every one as an activation key would keep obsolete lore permanently
    // resident in InnerLore's separate bounded prompt block.
    const lowestNonemptyLayer = layers.find(layer => Array.isArray(layer) && layer.length) || [];
    const snippets = lowestNonemptyLayer.slice(-clamp(maximumSnippets, 1, 30));
    const parts = snippets.map(snippet => cleanString(snippet?.text, 20_000)).filter(Boolean);
    const combined = cleanString(parts.join('\n'), 500_000);
    const maximum = clamp(maximumCharacters, 1_000, 100_000);
    if (combined.length <= maximum) return combined;
    const olderBudget = Math.floor(maximum / 3);
    const recentBudget = maximum - olderBudget - 23;
    return `${combined.slice(0, olderBudget).trimEnd()}\n[older summaries clipped]\n${combined.slice(-recentBudget).trimStart()}`;
}

export function snapshotMessageRange(messages, startIndex, endIndex) {
    const snapshot = {};
    const start = Math.max(0, Number(startIndex) || 0);
    const end = Math.min(messages.length - 1, Number.isInteger(endIndex) ? endIndex : messages.length - 1);
    for (let index = start; index <= end; index++) {
        const message = messages[index];
        snapshot[index] = message ? messageFingerprint(message) : null;
    }
    return snapshot;
}

export function messageRangeMatchesSnapshot(messages, snapshot) {
    for (const [rawIndex, fingerprint] of Object.entries(snapshot || {})) {
        const index = Number(rawIndex);
        const message = messages[index];
        if ((message ? messageFingerprint(message) : null) !== fingerprint) return false;
    }
    return true;
}

// ---------------------------------------------------------------------------
// Incremental derivation (Phase 2)
//
// The derived store (entities, brains, progression) is a pure fold of
// analyzeRange over completed message batches. A checkpoint is a deep copy of
// that fold at a given message index. When history changes (edit/swipe/delete)
// the rebuild can restore the newest checkpoint whose recorded history still
// matches the chat and re-derive only the messages after it, instead of
// replaying the whole conversation from an empty store. Checkpoints form a
// bounded exponential-ish ladder so recent edits resume cheaply while older
// history stays coverable, keeping saved chat metadata bounded.
// ---------------------------------------------------------------------------

export const MAX_STORE_CHECKPOINTS = 6;

// Fields that together fully capture the analyzeRange fold. Transient status,
// timing, and error fields are intentionally excluded from a checkpoint.
export const CHECKPOINT_FIELDS = Object.freeze([
    'entities',
    'brains',
    'progression',
    'lastProcessedIndex',
    'processedFingerprints',
    'expressionFoundationVersion',
    'lorebookName',
]);

function deepCloneValue(value) {
    if (value === undefined) return undefined;
    return typeof structuredClone === 'function'
        ? structuredClone(value)
        : JSON.parse(JSON.stringify(value));
}

/** Deep-copy the derived fold of a store into a checkpoint tagged by index. */
export function createStoreCheckpoint(store) {
    const index = Number.isInteger(store?.lastProcessedIndex) ? store.lastProcessedIndex : -1;
    const checkpoint = { index };
    for (const field of CHECKPOINT_FIELDS) checkpoint[field] = deepCloneValue(store?.[field]);
    return checkpoint;
}

/** Restore a checkpoint's derived fold into a working store (in place). */
export function applyStoreCheckpoint(targetStore, checkpoint) {
    for (const field of CHECKPOINT_FIELDS) {
        if (checkpoint && Object.hasOwn(checkpoint, field)) {
            targetStore[field] = deepCloneValue(checkpoint[field]);
        }
    }
    return targetStore;
}

/**
 * The first processed message index whose current content no longer matches the
 * fingerprint recorded when it was analyzed. Returns Infinity when every tracked
 * message still matches (no divergence — nothing to rebuild).
 */
export function firstDivergenceIndex(messages, processedFingerprints) {
    let earliest = Number.POSITIVE_INFINITY;
    for (const [rawIndex, fingerprint] of Object.entries(processedFingerprints || {})) {
        const index = Number(rawIndex);
        if (!Number.isInteger(index) || index >= earliest) continue;
        const message = messages[index];
        const current = message ? messageFingerprint(message) : null;
        if (current !== fingerprint) earliest = index;
    }
    return earliest;
}

/**
 * Choose the highest-index checkpoint that sits strictly before the divergence
 * point and whose own recorded history still matches the chat (so it is not
 * derived from a discarded branch). Returns null when no checkpoint qualifies,
 * in which case the caller must fall back to a full rebuild.
 */
export function selectResumeCheckpoint(checkpoints, messages, divergenceIndex) {
    if (!Array.isArray(checkpoints)) return null;
    let best = null;
    for (const checkpoint of checkpoints) {
        const index = Number(checkpoint?.index);
        if (!Number.isInteger(index) || index < 0) continue;
        if (index >= divergenceIndex) continue;
        if (best && index <= best.index) continue;
        if (!messageRangeMatchesSnapshot(messages, checkpoint.processedFingerprints || {})) continue;
        best = checkpoint;
    }
    return best;
}

/**
 * Bound a checkpoint set to at most `maxCheckpoints`, always keeping the oldest
 * and newest and thinning the most redundant (smallest surrounding span)
 * interior checkpoint first. This preserves fine recent granularity and coarse
 * older coverage without unbounded metadata growth.
 */
export function pruneCheckpointLadder(checkpoints, maxCheckpoints = MAX_STORE_CHECKPOINTS) {
    const list = (Array.isArray(checkpoints) ? checkpoints : [])
        .filter(checkpoint => Number.isInteger(checkpoint?.index))
        .sort((a, b) => a.index - b.index);
    const limit = Math.max(1, Number(maxCheckpoints) || MAX_STORE_CHECKPOINTS);
    while (list.length > limit) {
        let dropAt = -1;
        let smallestSpan = Number.POSITIVE_INFINITY;
        for (let i = 1; i < list.length - 1; i++) {
            const span = list[i + 1].index - list[i - 1].index;
            if (span < smallestSpan) {
                smallestSpan = span;
                dropAt = i;
            }
        }
        if (dropAt === -1) break;
        list.splice(dropAt, 1);
    }
    return list;
}

/**
 * Insert/replace a checkpoint at its index and return the pruned ladder.
 */
export function recordCheckpoint(checkpoints, checkpoint, maxCheckpoints = MAX_STORE_CHECKPOINTS) {
    if (!Number.isInteger(checkpoint?.index)) return Array.isArray(checkpoints) ? checkpoints : [];
    const deduped = (Array.isArray(checkpoints) ? checkpoints : [])
        .filter(existing => Number.isInteger(existing?.index) && existing.index !== checkpoint.index);
    deduped.push(checkpoint);
    return pruneCheckpointLadder(deduped, maxCheckpoints);
}

export function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}
