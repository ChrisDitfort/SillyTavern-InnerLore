/**
 * Deterministic current-scene compilation.
 *
 * This module does not invent narrative state. It ranks explicit names,
 * movement phrases, and already-curated current-state text so the prompt can
 * privilege what is happening now without another model request.
 */

import {
    canonicalNameKey,
    cleanString,
    cleanTextMentions,
    clipAtBoundary,
    contextSimilarity,
    contextTokens,
    curatedLocationOf,
    resolveLocationReference,
    shortCharacterReferences,
    textMentions,
    uniqueStrings,
} from './core.js?v=49';

const ABSENT_STATE = /\b(?:absent|away|departed|elsewhere|left\s+(?:the|this|that|the\s+scene)|gone\s+home|went\s+home|headed\s+home|returned\s+home|on\s+(?:his|her|their|its)\s+way\s+home|no\s+longer\s+(?:here|present)|not\s+present|off[ -]?screen|outside\s+the\s+scene)\b/iu;
const PLACE_HEAD_NOUNS = new Set([
    'house', 'home', 'room', 'chamber', 'hall', 'kitchen', 'larder', 'pantry', 'cellar',
    'yard', 'courtyard', 'garden', 'stable', 'barn', 'shed', 'workshop', 'forge',
    'street', 'lane', 'road', 'path', 'alley', 'square', 'market', 'plaza',
    'tavern', 'inn', 'pub', 'bar', 'cafe', 'restaurant', 'shop', 'store', 'bakery',
    'range', 'field', 'meadow', 'forest', 'wood', 'woods', 'grove', 'thicket', 'valley',
    'hill', 'mountain', 'ridge', 'cliff', 'beach', 'shore', 'coast', 'bank', 'river', 'stream', 'brook',
    'bridge', 'gate', 'wall', 'tower', 'keep', 'castle', 'fort', 'citadel', 'palace', 'manor',
    'village', 'town', 'city', 'hamlet', 'camp', 'tent', 'cabin', 'cottage', 'hut',
    'temple', 'chapel', 'shrine', 'church', 'cathedral', 'crypt', 'graveyard', 'cemetery',
    'dungeon', 'cave', 'cavern', 'mine', 'quarry', 'dock', 'docks', 'pier', 'wharf', 'quay', 'harbor', 'harbour', 'port',
    'deck', 'ship', 'boat', 'carriage', 'wagon', 'train', 'station', 'office', 'library', 'study',
    'barracks', 'armory', 'armoury', 'arena', 'stadium', 'bathhouse', 'well', 'spring', 'oasis',
    'border', 'frontier', 'outpost', 'wilderness', 'upstairs', 'downstairs', 'doorway', 'doorstep',
]);

// Things that "run", "lead" or "climb" without anyone moving: a street that
// runs toward the harbour is not the player heading there.
const TOPOGRAPHY_SUBJECTS = new Set([
    ...PLACE_HEAD_NOUNS, 'track', 'trail', 'stair', 'stairs', 'steps', 'staircase', 'corridor', 'passage', 'way', 'slope',
    'canal', 'tunnel', 'causeway', 'avenue', 'boulevard', 'highway', 'ladder', 'gangway', 'ramp', 'rail', 'fence', 'hedge',
]);

const DORMANT_LOCATION = /\b(?:not\s+visited|only\s+mentioned|rejected|declined|abandoned\s+for|left\s+behind|previous\s+scene)\b/iu;
const MOVEMENT_CUE_GLOBAL = /\b(?:arrives?|arrived|comes?|came|coming|descends?|descended|enters?|entered|follows?|followed|go|goes|going|went|heads?|headed|lead|leads|leading|led|leaves?|left|moves?|moved|reach|reaches|reached|returns?|returned|steps?|stepped|travels?|travelled|traveled|walks?|walked|runs?|ran|hurr(?:y|ies|ied)|rush(?:es|ed)?|climbs?|climbed|cross(?:es|ed)?|push(?:es|ed)?|slips?|slipped|ducks?|ducked|wanders?|wandered|strides?|strode|march(?:es|ed)?|rides?|rode|sails?|sailed)\b/giu;
const MOVEMENT_REJECTED = /\b(?:cannot|can't|couldn't|doesn't|didn't|refuse|refused|remain|remained|stay|stayed|stop|stopped|unable\s+to)\b/iu;
const MOVEMENT_CONFIRMED = /\b(?:arrived|descended|entered|followed|inside|reached|returned|stairwell|travelled|walked|ran|climbed|crossed|pushed|hurried|rushed)\b/iu;
const DEFERRED_MOVEMENT = /\b(?:afterwards?|eventually|(?<!\b(?:minutes?|hours?|days?|weeks?|months?|years?|moments?)\s)later|next\s+(?:day|evening|morning|night|week)|someday|tomorrow|tonight\s+after|when\s+(?:I|we|he|she|they)\s+(?:can|finish|have|return))\b/iu;
const LOCALLY_ABSENT_OBJECT = /\b(?:left\s+behind|not\s+(?:carried|carrying|here|present)|remained\s+(?:behind|outside|upstairs|downstairs)|still\s+(?:behind|outside|upstairs|downstairs|elsewhere)|without\s+(?:the|a|an|his|her|their))\b/iu;
const LOCATION_PREPOSITION = /\b(into|onto|inside|within|towards?|through|at|in|to)\s+((?:(?:the|a|an)\s+)?[\p{L}\p{N}'’_-]+(?:\s+[\p{L}\p{N}'’_-]+){0,5})/giu;
const LOCATION_STOP_WORDS = new Set([
    'after', 'and', 'as', 'because', 'before', 'but', 'from', 'later', 'once', 'so', 'then',
    'there', 'they', 'until', 'when', 'where', 'were', 'which', 'while', 'who', 'with', 'you',
]);
const LOCATION_POSSESSIVES = new Set(['her', 'his', 'its', 'my', 'our', 'their', 'your']);
const LOCATION_NON_NOUNS = new Set([
    'arrive', 'come', 'descend', 'enter', 'follow', 'go', 'head', 'lead', 'leave', 'move', 'reach',
    'return', 'step', 'travel', 'walk',
]);

// Parts of a building or yard. An unresolved move to one of these ("up to the
// attic") is a move within the place the player already is.
const INTERIOR_PART_WORDS = new Set([
    'room', 'hall', 'kitchen', 'cellar', 'basement', 'yard', 'courtyard', 'garden', 'stable', 'stables',
    'stairs', 'staircase', 'stairwell', 'upstairs', 'downstairs', 'corridor', 'passage', 'landing', 'attic',
    'loft', 'bar', 'taproom', 'parlour', 'parlor', 'porch', 'balcony', 'roof', 'doorway', 'doorstep', 'chamber',
    'study', 'library', 'pantry', 'larder', 'shed', 'workshop', 'vault', 'lobby', 'foyer', 'gallery',
]);
// A place seen, pointed at, or come from is not where the player is.
const DISTANT_VIEW = /\b(?:points?|pointed|pointing|see|sees|saw|seen|glimpse[sd]?|views?|window|distance|distant|far\s+(?:off|away|below|above)|beyond|horizon|would\s+be|in\s+the\s+direction\s+of)\b/iu;
const VIEWING_TURN = /\b(?:look|looks|looking|gaze|gazes|peer|peers|watch|watches|glance|glances|stare|stares|listen|listens)\b/iu;
const QUOTED_SPEECH = /"[^"\n]{0,800}"|“[^”\n]{0,800}”/gu;

/** Text with quoted speech blanked out (same length, so indices still line up). */
function withoutQuotedSpeech(text) {
    return String(text || '').replace(QUOTED_SPEECH, match => ' '.repeat(match.length));
}

/** A location's recorded parent place, by id first and by name otherwise. */
function parentPlace(entities, record) {
    const byId = record?.parentLocationId && entities?.[record.parentLocationId];
    if (byId?.type === 'location' && byId.enabled !== false && byId.id !== record.id) return byId;
    const named = record?.parentLocationName ? resolveLocationReference(entities, record.parentLocationName) : null;
    return named && named.id !== record?.id ? named : null;
}

/**
 * The places around an anchor, nearest first: the anchor, the places it
 * contains, the places that contain it, and everything else those contain.
 */
function locationFamily(entities, anchor) {
    if (!anchor) return [];
    const locations = Object.values(entities || {}).filter(record => record?.type === 'location' && record.enabled !== false);
    const parents = new Map(locations.map(record => [record.id, parentPlace(entities, record)?.id || '']));
    const family = [{ record: anchor, distance: 0 }];
    const seen = new Set([anchor.id]);
    const add = (record, distance) => {
        if (!record || seen.has(record.id)) return;
        seen.add(record.id);
        family.push({ record, distance });
    };
    for (const record of locations) if (parents.get(record.id) === anchor.id) add(record, 1);
    let ancestor = entities[parents.get(anchor.id)];
    for (let depth = 1; ancestor && depth <= 4; depth++) {
        add(ancestor, depth);
        for (const record of locations) if (parents.get(record.id) === ancestor.id) add(record, depth + 1);
        ancestor = entities[parents.get(ancestor.id)];
    }
    return family.sort((a, b) => a.distance - b.distance);
}

/** Short names a place goes by inside its parent ("Stable Yard" and "yard" for "Salt Lantern Stable Yard"). */
function placePartKeys(entities, record) {
    const strip = key => key.replace(/^(?:the|a|an)\s+/u, '');
    const name = strip(canonicalNameKey(record.name));
    const parent = parentPlace(entities, record);
    const parentKey = parent ? strip(canonicalNameKey(parent.name)) : '';
    const keys = [name, ...(record.aliases || []).map(alias => strip(canonicalNameKey(alias)))];
    if (parentKey && name.startsWith(`${parentKey} `)) keys.push(name.slice(parentKey.length + 1));
    const last = name.split(' ').at(-1);
    if (INTERIOR_PART_WORDS.has(last)) keys.push(last);
    return uniqueStrings(keys.filter(Boolean), 12);
}

/**
 * Resolve a phrase for part of a place ("the yard", "the common room") to the
 * recorded place it means, searching outward from where the player is: a
 * place whose own short name matches, else the nearest place whose recorded
 * layout mentions the phrase.
 */
function resolvePlacePhrase(phrase, entities, anchor) {
    const core = canonicalNameKey(phrase).replace(/^(?:the|a|an)\s+/u, '');
    if (!core || !anchor) return null;
    const family = locationFamily(entities, anchor);
    const named = family.find(({ record }) => placePartKeys(entities, record).includes(core));
    if (named) return { record: named.record, part: '' };
    // Only parts of a building are looked up in recorded layouts; "the
    // harbour" seen from a window is a place of its own.
    const head = core.split(' ').at(-1);
    if (!INTERIOR_PART_WORDS.has(head) || /\p{Lu}/u.test(cleanString(phrase).replace(/^(?:the|a|an)\s+/iu, ''))) return null;
    const familyIds = new Set(family.map(({ record }) => record.id));
    for (const { record } of family) {
        for (const invariant of Object.values(record.spatial?.invariants || {})) {
            if (!textMentions(`${invariant.object || ''}\n${invariant.statement || ''}`, [core])) continue;
            // "Room Two is at the end of the corridor" puts the player in Room Two.
            const subject = resolveLocationReference(entities, invariant.subject);
            if (subject && familyIds.has(subject.id) && subject.id !== record.id) return { record: subject, part: '' };
            return { record, part: cleanString(phrase, 80) };
        }
        if (textMentions(`${record.summary || ''}\n${record.description || ''}`, [core])) return { record, part: cleanString(phrase, 80) };
    }
    return { record: anchor, part: cleanString(phrase, 80) };
}

/** Whether every mention of a place in the text is a view, a pointing, an origin, or quoted speech. */
function onlyDistantMentions(text, references, viewingTurn) {
    const source = cleanString(text, 30_000);
    const quotedSpans = [...source.matchAll(QUOTED_SPEECH)].map(match => [match.index, match.index + match[0].length]);
    const sentences = source.split(/(?<=[.!?])\s+|\n+/u);
    let offset = 0;
    let anyNear = false;
    for (const sentence of sentences) {
        const start = source.indexOf(sentence, offset);
        offset = Math.max(offset, start + sentence.length);
        if (!textMentions(sentence, references)) continue;
        const quoted = quotedSpans.some(([from, to]) => start >= from && start + sentence.length <= to + 1);
        const origin = references.some(reference => new RegExp(`\\bfrom\\s+(?:the\\s+)?${reference.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}`, 'iu').test(sentence));
        if (!(viewingTurn || quoted || origin || DISTANT_VIEW.test(sentence))) anyNear = true;
    }
    return !anyNear;
}

/** Where most of the present cast is recorded, for resolving part-of-place phrases. */
function castAnchor(entities, castRecords) {
    const counts = new Map();
    for (const record of castRecords) {
        const place = curatedLocationOf(entities, record);
        if (place) counts.set(place.id, (counts.get(place.id) || 0) + 1);
    }
    const best = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
    return best ? entities[best[0]] : null;
}

function relevantMessages(messages, maximum = 6) {
    return (Array.isArray(messages) ? messages : [])
        .map((message, index) => ({ message, index }))
        .filter(({ message }) => message
            && (!message.is_system || message.extra?.sc_ghosted === true)
            // A private conversation (a text, a thought, a quiet word) is not
            // narration: nobody moves and nobody arrives because of it.
            && !message.extra?.inner_lore_private
            && cleanString(message.mes))
        .slice(-Math.max(1, maximum));
}

function recordReferences(record) {
    return uniqueStrings([record?.name, ...(record?.aliases || []), ...(record?.keys || [])], 40);
}

/**
 * Whether text names a character: full name, alias, or key, or - matched
 * case-sensitively - an unshared given name or surname ("Wren" for "Wren
 * Halloway"), which is how narration usually refers to someone present.
 */
function mentionsCharacter(text, record, characters) {
    if (textMentions(text, recordReferences(record))) return true;
    const source = cleanString(text, 200_000);
    return shortCharacterReferences(record, characters).some(name => {
        const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        return new RegExp(`(^|[^\\p{L}\\p{N}])${escaped}(?=$|[^\\p{L}\\p{N}])`, 'u').test(source);
    });
}

function referenceMatch(candidate, record) {
    const wanted = canonicalNameKey(candidate).replace(/^(?:the|a|an)\s+/u, '');
    if (!wanted) return false;
    return recordReferences(record).some(reference => {
        const key = canonicalNameKey(reference).replace(/^(?:the|a|an)\s+/u, '');
        if (key === wanted) return true;
        // Substring matches are only trustworthy for long, distinctive names;
        // short generic words ("city") must not match compound aliases
        // ("eldest blood-city") or the scene relocates to the wrong place.
        const shorter = Math.min(key.length, wanted.length);
        if (shorter < 8) return false;
        const wholeWord = (haystack, needle) => (` ${haystack} `).includes(` ${needle} `);
        return wholeWord(key, wanted) || wholeWord(wanted, key);
    });
}

function cleanLocationCandidate(raw) {
    const words = cleanString(raw, 160).split(/\s+/u);
    const kept = [];
    for (const word of words) {
        const key = canonicalNameKey(word.replace(/[^\p{L}\p{N}'’_-]/gu, ''));
        if (!key || LOCATION_STOP_WORDS.has(key)) break;
        if (!kept.length && LOCATION_POSSESSIVES.has(key)) continue;
        kept.push(word.replace(/[,;:.!?]+$/u, ''));
        if (kept.length >= 5) break;
    }
    const candidate = cleanString(kept.join(' '), 100)
        .replace(/^(?:a|an)\s+/iu, '')
        .replace(/[,:;.!?]+$/u, '')
        .trim();
    if (!candidate || /^(?:him|her|me|them|us|you|it)$/iu.test(candidate)) return '';
    return candidate;
}

/**
 * A preposition is a movement destination only when the nearest movement verb
 * belongs to the same short phrase. This prevents a distant verb from turning
 * an infinitive such as "books I want you to study" into movement to a Study.
 */
function hasLinkedMovementCue(source, prepositionIndex, rawCandidate) {
    const before = source.slice(Math.max(0, prepositionIndex - 140), prepositionIndex);
    const clauseStart = Math.max(
        before.lastIndexOf('.'),
        before.lastIndexOf('!'),
        before.lastIndexOf('?'),
        before.lastIndexOf(';'),
        before.lastIndexOf('\n'),
    );
    const clause = before.slice(clauseStart + 1);
    const cues = [...clause.matchAll(MOVEMENT_CUE_GLOBAL)];
    const cue = cues.at(-1);
    if (!cue) return false;
    const subjectWords = canonicalNameKey(clause.slice(0, cue.index || 0)).split(/\s+/u).filter(Boolean).slice(-3);
    if (subjectWords.length && TOPOGRAPHY_SUBJECTS.has(subjectWords.at(-1))) return false;
    const between = cleanString(clause.slice((cue.index || 0) + cue[0].length), 120);
    const bridgeWords = canonicalNameKey(between).split(/\s+/u).filter(Boolean);
    // Permit a short object/companion phrase ("lead her down into" or
    // "walk with Mara to"), but not an intervening clause whose earlier verb
    // is unrelated to the candidate destination.
    if (bridgeWords.length > 5) return false;

    // Do not turn the idiom "come out in pieces" (or equivalent wording)
    // into a fictional location named "pieces". A destination needs a
    // spatial movement clause, not an expression describing speech or an
    // object's condition.
    if (/^(?:out|off)(?:\s+(?:in|into|through))?$/iu.test(between)
        && /\b(?:come|comes|came|coming)\b/iu.test(cue[0])) return false;

    // A clearly deferred appointment is not the current scene location. The
    // scheduled destination can still be tracked by World Progression.
    const destinationWindow = `${clause} ${cleanString(rawCandidate, 180)}`;
    return !DEFERRED_MOVEMENT.test(destinationWindow);
}

function referenceLocallyAbsent(text, record) {
    const sentences = cleanString(text, 30_000).split(/(?<=[.!?])\s+|\n+/u);
    return sentences.some(sentence => (
        textMentions(sentence, recordReferences(record)) && LOCALLY_ABSENT_OBJECT.test(sentence)
    ));
}

function explicitMovementLocation(text, entities, anchor = null) {
    const source = cleanString(text, 20_000);
    const characters = Object.values(entities || {}).filter(record => record?.type === 'character');
    const locations = Object.values(entities || {}).filter(record => record?.type === 'location' && record.enabled !== false);
    let result = null;
    for (const match of source.matchAll(LOCATION_PREPOSITION)) {
        if (!hasLinkedMovementCue(source, match.index || 0, match[2])) continue;
        const candidate = cleanLocationCandidate(match[2]);
        const candidateCore = canonicalNameKey(candidate).replace(/^(?:the|a|an)\s+/u, '');
        if (!candidate || LOCATION_NON_NOUNS.has(candidateCore)
            || characters.some(record => referenceMatch(candidate, record))) continue;
        // "Highmarket Gate" is the gate, not the town that also matches it.
        let known = locations
            .filter(record => referenceMatch(candidate, record))
            .sort((a, b) => Number(canonicalNameKey(b.name) === candidateCore) - Number(canonicalNameKey(a.name) === candidateCore)
                || b.name.length - a.name.length)[0];
        let part = '';
        if (!known) {
            const resolved = resolvePlacePhrase(candidate, entities, anchor);
            if (resolved) ({ record: known, part } = resolved);
        }
        if (!known) {
            // Unknown (not-yet-curated) locations are only trusted when the
            // phrase's head noun is a place word or it contains a proper noun.
            // Prose phrases ("in small exact letters", "through the brow")
            // otherwise leak into the scene as fake locations.
            const words = candidate.split(/\s+/u).filter(Boolean);
            const head = canonicalNameKey(words[words.length - 1] || '');
            const hasProper = words.some((word, index) => index > 0 || !/^(?:the|a|an)$/iu.test(word)
                ? /\p{Lu}/u.test(word) : false);
            if (!PLACE_HEAD_NOUNS.has(head) && !hasProper) continue;
        }
        const preposition = canonicalNameKey(match[1]);
        const score = (known ? (part ? 60 : 100) : 0) + (['into', 'onto', 'inside', 'within', 'at', 'in'].includes(preposition) ? 30 : 10);
        if (!result || score > result.score) {
            result = known
                ? { id: known.id, name: known.name, ...(part ? { part } : {}), source: 'explicit movement in latest turn', confidence: part ? 0.95 : 1, score }
                : { id: '', name: candidate, source: 'explicit movement in latest turn', confidence: 0.92, score };
        }
    }
    if (result) delete result.score;
    return result;
}

function locationRanking(store, latestText, focusText, participantNames, currentIndex, castRecords = [], playerRecord = null, viewingTurn = false) {
    const castLocations = castRecords.map(record => ({
        location: curatedLocationOf(store?.entities, record),
        weight: record === playerRecord ? 2 : 1,
    })).filter(item => item.location);
    const locations = Object.values(store?.entities || {})
        .filter(record => record?.type === 'location' && record.enabled !== false);
    const allReferences = locations.flatMap(record => recordReferences(record).map(reference => ({ id: record.id, reference })));
    // "Highmarket Gate" names the gate, not the town: a place is only
    // mentioned where its name stands on its own, outside any longer known
    // place name that contains it.
    const ownMentions = (text, record, references) => {
        const keys = references.map(reference => reference.toLocaleLowerCase());
        let remaining = text;
        for (const { id, reference } of allReferences) {
            const lower = reference.toLocaleLowerCase();
            if (id === record.id || !keys.some(key => lower.length > key.length && lower.includes(key))) continue;
            remaining = remaining.replace(new RegExp(reference.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'giu'), ' ');
        }
        return cleanTextMentions(remaining, references);
    };
    // Each passage is cleaned and tokenized once, not once per location.
    const latestClean = cleanString(latestText, 200_000);
    const focusClean = cleanString(focusText, 200_000);
    const latestTokens = new Set(contextTokens(latestClean));
    const focusTokens = new Set(contextTokens(focusClean));
    return locations
        .map(record => {
            const references = recordReferences(record);
            const latestMention = ownMentions(latestClean, record, references)
                && !onlyDistantMentions(latestClean, references, viewingTurn);
            const focusMention = ownMentions(focusClean, record, references);
            const state = cleanString(record.currentState, 3_000);
            const stateSimilarity = contextSimilarity(state, latestTokens);
            const focusSimilarity = contextSimilarity(`${record.summary || ''} ${state}`, focusTokens);
            const participantMatches = participantNames.filter(name => textMentions(state, [name])).length;
            const age = Math.max(0, currentIndex - (Number(record.lastSeenMessage) || 0));
            const dormant = DORMANT_LOCATION.test(state);
            // Where the present cast is curated to be: the fallback when the
            // newest prose names no place at all.
            const castHere = castLocations
                .filter(item => item.location.id === record.id)
                .reduce((sum, item) => sum + item.weight, 0);
            const score = (latestMention ? 1_400 : 0)
                + (focusMention ? 700 : 0)
                + stateSimilarity * 700
                + focusSimilarity * 300
                + participantMatches * 180
                + castHere * 450
                + Math.max(0, 100 - age * 12)
                + (Number(record.importance) || 50)
                - (dormant ? 1_200 : 0);
            return { record, latestMention, focusMention, stateSimilarity, participantMatches, castHere, dormant, score };
        })
        .sort((a, b) => b.score - a.score || a.record.name.localeCompare(b.record.name));
}

/** Build a compact, evidence-derived scene focus from selected chat history. */
export function deriveSceneState(messages, store, options = {}) {
    const relevant = relevantMessages(messages, Math.max(2, Number(options.lookbackMessages) || 4));
    const latest = relevant.at(-1);
    const latestUser = [...relevant].reverse().find(({ message }) => message.is_user);
    const latestText = cleanString(latest?.message?.mes, 20_000);
    const latestUserText = cleanString(latestUser?.message?.mes, 20_000);
    const exchangeText = relevant.slice(-2).map(({ message }) => cleanString(message.mes, 12_000)).join('\n');
    const focusText = relevant.map(({ message }) => cleanString(message.mes, 8_000)).join('\n');
    const currentIndex = Number.isInteger(options.currentIndex)
        ? options.currentIndex
        : (latest?.index ?? -1);
    const playerName = cleanString(options.playerName || latestUser?.message?.name, 160) || 'Player';
    const characters = Object.values(store?.entities || {})
        .filter(record => record?.type === 'character' && record.enabled !== false);

    const participantMap = new Map();
    const addParticipant = (record, reason, confidence = 1) => {
        const id = record?.id || `character:${canonicalNameKey(record?.name)}`;
        const name = cleanString(record?.name, 160);
        if (!name || participantMap.has(id)) return;
        participantMap.set(id, { id, name, reason, confidence });
    };
    const playerRecord = characters.find(record => referenceMatch(playerName, record));
    if (playerRecord) addParticipant(playerRecord, 'player character', 1);
    else if (playerName && playerName !== 'Player') addParticipant({ name: playerName }, 'player character', 1);

    for (const record of characters) {
        // A curated away-state ("gone home", "departed") outranks mere name
        // mentions: narration often names an absent character (writing their
        // testimony, recalling them) without them being in the room.
        const curatedAway = ABSENT_STATE.test(record.currentState || '');
        if (mentionsCharacter(latestText, record, characters) && !curatedAway) addParticipant(record, 'named in latest turn', 1);
        else if (mentionsCharacter(exchangeText, record, characters) && !curatedAway) addParticipant(record, 'named in latest exchange', 0.95);
        else if (mentionsCharacter(focusText, record, characters) && !curatedAway) {
            addParticipant(record, 'active in recent scene', 0.78);
        }
    }

    const participantNames = [...participantMap.values()].map(item => item.name);
    const entities = store?.entities || {};
    // Where the curator last recorded the player. Once it has read the newest
    // reply it is the authority; until then it is the best guess, because a
    // place merely named in prose is often seen, pointed at, or remembered.
    const playerPlace = playerRecord ? curatedLocationOf(entities, playerRecord) : null;
    const latestReply = [...relevant].reverse().find(({ message }) => !message.is_user);
    const curatorCurrent = Boolean(playerPlace && latestReply)
        && Number.isInteger(store?.lastProcessedIndex) && store.lastProcessedIndex >= latestReply.index;
    const recorded = playerPlace ? {
        id: playerPlace.id,
        name: playerPlace.name,
        source: curatorCurrent ? 'curated player location' : 'last recorded player location',
        confidence: curatorCurrent ? 1 : 0.85,
    } : null;
    const anchor = playerPlace || castAnchor(entities, characters.filter(record => participantMap.has(record.id)));
    const directedLocation = explicitMovementLocation(latestUserText, entities, anchor);
    // When the player only looks, the narration's roads and steps are views.
    const viewingTurn = VIEWING_TURN.test(latestUserText) && !directedLocation;
    const narratedLocation = viewingTurn ? null : explicitMovementLocation(withoutQuotedSpeech(latestText), entities, anchor);
    const pendingCommand = latest?.message?.is_user;
    // Keep an explicit player-directed move as current after the story reply
    // confirms the transition. A clear refusal/stoppage prevents that carryover.
    const confirmedDirection = directedLocation && (
        pendingCommand || MOVEMENT_CONFIRMED.test(latestText) || !MOVEMENT_REJECTED.test(latestText)
    ) ? directedLocation : null;
    const moves = [narratedLocation, confirmedDirection].filter(Boolean);
    // Of two known destinations, one inside the other is the more precise.
    const insideOf = (inner, outer) => {
        for (let place = parentPlace(entities, entities[inner.id]), depth = 0; place && depth < 6; place = parentPlace(entities, place), depth++) {
            if (place.id === outer.id) return true;
        }
        return false;
    };
    moves.sort((a, b) => Number(Boolean(a.id && b.id && insideOf(b, a))) - Number(Boolean(a.id && b.id && insideOf(a, b))));
    let location = null;
    if (pendingCommand && directedLocation) location = directedLocation;
    else if (curatorCurrent) location = recorded;
    else {
        location = moves.find(move => move.id && !move.part)
            || moves.find(move => move.id)
            || moves.find(move => !move.id)
            || null;
    }
    if (!location) {
        const castRecords = characters.filter(record => participantMap.has(record.id));
        const ranked = locationRanking(
            store, latestText || exchangeText, focusText, participantNames, currentIndex, castRecords, playerRecord, viewingTurn,
        );
        const best = ranked[0];
        // A place plainly named where the player is beats the last record;
        // weaker signals do not.
        if (recorded && !best?.latestMention) location = recorded;
        else if (best && (best.latestMention || best.focusMention || best.stateSimilarity >= 0.18
            || best.participantMatches >= 2 || best.castHere >= 1)) {
            const castOnly = !best.latestMention && !best.focusMention && best.stateSimilarity < 0.18
                && best.participantMatches < 2;
            location = {
                id: best.record.id,
                name: best.record.name,
                source: best.latestMention ? 'named in latest turn'
                    : castOnly ? 'where the present cast is' : 'curated current-scene state',
                confidence: best.latestMention ? 1 : Math.min(0.9, 0.62 + best.stateSimilarity),
            };
        }
    }

    // A character not named in the recent focus may still be present when its
    // curated current location, or its objective current-state text, places
    // it at the selected place.
    if (location?.name) {
        for (const record of characters) {
            if (participantMap.has(record.id) || ABSENT_STATE.test(record.currentState || '')) continue;
            const curated = curatedLocationOf(store?.entities, record);
            const atLocation = curated
                ? (curated.id === location.id || canonicalNameKey(curated.name) === canonicalNameKey(location.name))
                : textMentions(record.currentState || '', [location.name]);
            if (atLocation) addParticipant(record, 'curated at current location', 0.72);
        }
    }

    const addressed = characters
        .filter(record => !referenceMatch(playerName, record) && mentionsCharacter(latestUserText, record, characters))
        .map(record => ({ id: record.id, name: record.name }));
    const objects = Object.values(store?.entities || {})
        .filter(record => record?.type === 'item' && record.enabled !== false)
        .filter(record => textMentions(latestText, recordReferences(record)) || textMentions(exchangeText, recordReferences(record)))
        .filter(record => !ABSENT_STATE.test(record.currentState || ''))
        .filter(record => !referenceLocallyAbsent(latestText, record))
        .slice(0, 8)
        .map(record => ({ id: record.id, name: record.name, reason: 'named in latest exchange' }));

    // The place that contains the scene, and parts of the surrounding place
    // named in the newest turns ("the yard"), so their layout reaches context.
    const places = [];
    const here = location?.id ? entities[location.id] : null;
    const container = here ? parentPlace(entities, here) : null;
    if (container) places.push({ id: container.id, name: container.name, reason: 'contains the scene' });
    if (here) {
        const named = `${latestUserText}\n${latestText}`;
        for (const { record } of locationFamily(entities, here)) {
            if (record.id === here.id || places.some(place => place.id === record.id)) continue;
            if (textMentions(named, placePartKeys(entities, record))) places.push({ id: record.id, name: record.name, reason: 'named part' });
            if (places.length >= 4) break;
        }
    }

    return {
        currentIndex,
        latestMessageIndex: latest?.index ?? -1,
        latestUserIndex: latestUser?.index ?? -1,
        latestUserName: playerName,
        latestText,
        latestUserText,
        exchangeText,
        focusText,
        focusTokens: contextTokens(focusText, 240),
        location,
        places,
        participants: [...participantMap.values()],
        addressed,
        objects,
    };
}

// Spatial relations that describe a way out of, or into, a place.
const WAY_RELATIONS = new Set(['connected_to', 'adjacent_to', 'entrance_at', 'door_at', 'opens']);
const MAXIMUM_WAYS_ON = 8;

/**
 * What the player character can perceive and reach right now, assembled from
 * the compiled scene and curated world: where they are, who is with them,
 * who was only mentioned, objects in play, and the ways on from here.
 */
export function deriveCameraFrame(scene, store, options = {}) {
    const entities = store?.entities || {};
    const playerName = cleanString(options.playerName || scene?.latestUserName, 160) || 'Player';
    const playerKey = canonicalNameKey(playerName);
    const where = cleanString(scene?.location?.name, 240);
    const byId = scene?.location?.id && entities[scene.location.id];
    const here = byId?.type === 'location' ? byId : resolveLocationReference(entities, where);
    const parentOf = record => parentPlace(entities, record);
    const parent = here ? parentOf(here) : null;

    // Places that contain the current one: a person recorded there (the
    // city, while the scene is one of its streets) is not elsewhere.
    const enclosing = new Set();
    for (let place = parent; place && !enclosing.has(place.id) && enclosing.size < 8; place = parentOf(place)) {
        enclosing.add(place.id);
    }
    const withYou = [];
    const unconfirmed = [];
    const elsewhere = [];
    for (const participant of scene?.participants || []) {
        if (canonicalNameKey(participant.name) === playerKey) continue;
        const record = entities[participant.id];
        const curated = record ? curatedLocationOf(entities, record) : null;
        const curatedHere = Boolean(curated && here && curated.id === here.id);
        // Only a known place can rule someone out: an unresolved phrase
        // ("the stairs") may well be inside where they were recorded.
        if (curated && here && !curatedHere && !enclosing.has(curated.id)) {
            elsewhere.push({ name: participant.name, at: curated.name });
        } else if (curatedHere || participant.reason === 'named in latest turn'
            || (!curated && participant.reason === 'named in latest exchange')) {
            withYou.push({ name: participant.name, state: cleanString(record?.currentState, 240) });
        } else {
            unconfirmed.push({ name: participant.name });
        }
    }

    const waysOn = [];
    const seen = new Set(here ? [here.id] : []);
    const addWay = (record, relation) => {
        if (!record || seen.has(record.id) || record.enabled === false) return;
        seen.add(record.id);
        waysOn.push({ name: record.name, relation });
    };
    if (here) {
        const locations = Object.values(entities).filter(record => record?.type === 'location' && record.enabled !== false);
        if (parent) addWay(parent, 'the wider place');
        for (const record of locations) if (parentOf(record)?.id === here.id) addWay(record, 'inside');
        if (parent) for (const record of locations) if (parentOf(record)?.id === parent.id) addWay(record, `also in ${parent.name}`);
        for (const invariant of Object.values(here.spatial?.invariants || {})) {
            if (!WAY_RELATIONS.has(invariant?.relation) || !cleanString(invariant.statement)) continue;
            const target = resolveLocationReference(entities, invariant.object);
            if (target && target.id !== here.id) addWay(target, cleanString(invariant.statement, 200));
            else if (!target) waysOn.push({ name: '', relation: cleanString(invariant.statement, 200) });
        }
    }

    return {
        pov: playerName,
        where,
        part: cleanString(scene?.location?.part, 80),
        within: parent?.name || '',
        time: cleanString(options.clockLabel, 120),
        withYou,
        unconfirmed,
        elsewhere,
        addressed: (scene?.addressed || []).map(item => item.name).filter(Boolean),
        objects: (scene?.objects || []).map(item => item.name).filter(Boolean),
        waysOn: waysOn.slice(0, MAXIMUM_WAYS_ON),
        latestUserName: cleanString(scene?.latestUserName, 160),
    };
}

/** Render the camera frame as the narrator's opening context block. */
export function renderCameraPacket(frame, maximumLength = 1_800) {
    if (!frame) return '';
    const maximum = Math.max(240, Number(maximumLength) || 1_800);
    const pov = frame.pov || 'the player character';
    const opening = [
        `<inner_lore_camera pov=${JSON.stringify(pov)} compiled="true">`,
        `The camera is ${pov}'s eyes and ears. Build the reply from what ${pov} can see, hear and reach from here. This is compiled state, not permission to invent missing facts; where it disagrees with the newest story turns, the story wins.`,
        `Behind the camera: the private minds, world reference and progression that follow steer what people do and what happens next. ${pov} never sees them directly, only words, actions and visible evidence. Do not force every listed element into the prose.`,
    ];
    const details = [];
    if (frame.where) {
        const within = frame.within ? `, within ${frame.within}` : '';
        const part = frame.part ? ` (${frame.part})` : '';
        details.push(`Where: ${frame.where}${part}${within}.${frame.time ? ` Story time: ${frame.time}.` : ''}`);
    }
    if (frame.withYou.length) {
        details.push(`With ${pov}: ${frame.withYou.map(item => (item.state ? `${item.name} (${item.state})` : item.name)).join('; ')}.`);
    }
    if (frame.addressed.length) details.push(`Directly addressed or affected by ${pov}'s newest turn: ${frame.addressed.join('; ')}.`);
    if (frame.objects.length) details.push(`Objects in play: ${frame.objects.join('; ')}.`);
    if (frame.waysOn.length) {
        details.push(`Ways on from here: ${frame.waysOn.map(way => (way.name ? `${way.name} (${way.relation})` : way.relation)).join('; ')}. Show them as ${pov} would notice them; a place ${pov} has not been to is seen only from outside.`);
    }
    if (frame.unconfirmed.length) {
        details.push(`Recently in the scene, presence not confirmed now: ${frame.unconfirmed.map(item => item.name).join('; ')}.`);
    }
    if (frame.elsewhere.length) {
        details.push(`Mentioned but last recorded elsewhere, so not in view unless the story brings them: ${frame.elsewhere.map(item => `${item.name} (at ${item.at})`).join('; ')}.`);
    }
    if (frame.latestUserName) {
        details.push(`Newest player-turn source: ${frame.latestUserName}. Preserve that turn's speaker and actor ownership.`);
    }
    const closing = '</inner_lore_camera>';
    const included = [];
    for (const detail of details) {
        const candidate = [...opening, ...included, detail, closing].join('\n');
        if (candidate.length <= maximum) {
            included.push(detail);
            continue;
        }
        const used = [...opening, ...included, closing].join('\n').length + 1;
        const remaining = maximum - used;
        if (remaining >= 40) included.push(clipAtBoundary(detail, remaining));
        break;
    }
    return [...opening, ...included, closing].join('\n');
}
