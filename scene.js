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
    clipAtBoundary,
    contextSimilarity,
    contextTokens,
    textMentions,
    uniqueStrings,
} from './core.js';

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

const DORMANT_LOCATION = /\b(?:not\s+visited|only\s+mentioned|rejected|declined|abandoned\s+for|left\s+behind|previous\s+scene)\b/iu;
const MOVEMENT_CUE_GLOBAL = /\b(?:arrive|arrived|come|came|coming|descend|descended|enter|entered|follow|followed|go|goes|going|head|headed|lead|leads|leading|led|leave|left|move|moved|reach|reached|return|returned|step|stepped|travel|travelled|walk|walked)\b/giu;
const MOVEMENT_REJECTED = /\b(?:cannot|can't|couldn't|doesn't|didn't|refuse|refused|remain|remained|stay|stayed|stop|stopped|unable\s+to)\b/iu;
const MOVEMENT_CONFIRMED = /\b(?:arrived|descended|entered|followed|inside|reached|returned|stairwell|travelled|walked)\b/iu;
const DEFERRED_MOVEMENT = /\b(?:afterwards?|eventually|later|next\s+(?:day|evening|morning|night|week)|someday|tomorrow|tonight\s+after|when\s+(?:I|we|he|she|they)\s+(?:can|finish|have|return))\b/iu;
const LOCALLY_ABSENT_OBJECT = /\b(?:left\s+behind|not\s+(?:carried|carrying|here|present)|remained\s+(?:behind|outside|upstairs|downstairs)|still\s+(?:behind|outside|upstairs|downstairs|elsewhere)|without\s+(?:the|a|an|his|her|their))\b/iu;
const LOCATION_PREPOSITION = /\b(into|inside|within|towards?|through|at|in|to)\s+((?:(?:the|a|an)\s+)?[\p{L}\p{N}'’_-]+(?:\s+[\p{L}\p{N}'’_-]+){0,5})/giu;
const LOCATION_STOP_WORDS = new Set([
    'after', 'and', 'as', 'because', 'before', 'but', 'from', 'later', 'once', 'so', 'then',
    'there', 'they', 'until', 'when', 'where', 'were', 'which', 'while', 'who', 'with', 'you',
]);
const LOCATION_POSSESSIVES = new Set(['her', 'his', 'its', 'my', 'our', 'their', 'your']);
const LOCATION_NON_NOUNS = new Set([
    'arrive', 'come', 'descend', 'enter', 'follow', 'go', 'head', 'lead', 'leave', 'move', 'reach',
    'return', 'step', 'travel', 'walk',
]);

function relevantMessages(messages, maximum = 6) {
    return (Array.isArray(messages) ? messages : [])
        .map((message, index) => ({ message, index }))
        .filter(({ message }) => message
            && (!message.is_system || message.extra?.sc_ghosted === true)
            && cleanString(message.mes))
        .slice(-Math.max(1, maximum));
}

function recordReferences(record) {
    return uniqueStrings([record?.name, ...(record?.aliases || []), ...(record?.keys || [])], 40);
}

function referenceMatch(candidate, record) {
    const wanted = canonicalNameKey(candidate).replace(/^(?:the|a|an)\s+/u, '');
    if (!wanted) return false;
    return recordReferences(record).some(reference => {
        const key = canonicalNameKey(reference).replace(/^(?:the|a|an)\s+/u, '');
        return key === wanted || (wanted.length >= 4 && (key.includes(wanted) || wanted.includes(key)));
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

function explicitMovementLocation(text, entities) {
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
        const known = locations.find(record => referenceMatch(candidate, record));
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
        const score = (known ? 100 : 0) + (['into', 'inside', 'within', 'at', 'in'].includes(preposition) ? 30 : 10);
        if (!result || score > result.score) {
            result = known
                ? { id: known.id, name: known.name, source: 'explicit movement in latest turn', confidence: 1, score }
                : { id: '', name: candidate, source: 'explicit movement in latest turn', confidence: 0.92, score };
        }
    }
    if (result) delete result.score;
    return result;
}

function locationRanking(store, latestText, focusText, participantNames, currentIndex) {
    return Object.values(store?.entities || {})
        .filter(record => record?.type === 'location' && record.enabled !== false)
        .map(record => {
            const references = recordReferences(record);
            const latestMention = textMentions(latestText, references);
            const focusMention = textMentions(focusText, references);
            const state = cleanString(record.currentState, 3_000);
            const stateSimilarity = contextSimilarity(state, latestText);
            const focusSimilarity = contextSimilarity(`${record.summary || ''} ${state}`, focusText);
            const participantMatches = participantNames.filter(name => textMentions(state, [name])).length;
            const age = Math.max(0, currentIndex - (Number(record.lastSeenMessage) || 0));
            const dormant = DORMANT_LOCATION.test(state);
            const score = (latestMention ? 1_400 : 0)
                + (focusMention ? 700 : 0)
                + stateSimilarity * 700
                + focusSimilarity * 300
                + participantMatches * 180
                + Math.max(0, 100 - age * 12)
                + (Number(record.importance) || 50)
                - (dormant ? 1_200 : 0);
            return { record, latestMention, focusMention, stateSimilarity, participantMatches, dormant, score };
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
        const references = recordReferences(record);
        // A curated away-state ("gone home", "departed") outranks mere name
        // mentions: narration often names an absent character (writing their
        // testimony, recalling them) without them being in the room.
        const curatedAway = ABSENT_STATE.test(record.currentState || '');
        if (textMentions(latestText, references) && !curatedAway) addParticipant(record, 'named in latest turn', 1);
        else if (textMentions(exchangeText, references) && !curatedAway) addParticipant(record, 'named in latest exchange', 0.95);
        else if (textMentions(focusText, references) && !curatedAway) {
            addParticipant(record, 'active in recent scene', 0.78);
        }
    }

    const participantNames = [...participantMap.values()].map(item => item.name);
    const directedLocation = explicitMovementLocation(latestUserText, store?.entities);
    const narratedLocation = explicitMovementLocation(latestText, store?.entities);
    // Keep an explicit player-directed move as current after the story reply
    // confirms the transition. A clear refusal/stoppage prevents that carryover.
    let location = narratedLocation || (directedLocation && (
        latest?.message?.is_user || MOVEMENT_CONFIRMED.test(latestText) || !MOVEMENT_REJECTED.test(latestText)
    ) ? directedLocation : null);
    if (!location) {
        const ranked = locationRanking(store, latestText || exchangeText, focusText, participantNames, currentIndex);
        const best = ranked[0];
        if (best && (best.latestMention || best.focusMention || best.stateSimilarity >= 0.18 || best.participantMatches >= 2)) {
            location = {
                id: best.record.id,
                name: best.record.name,
                source: best.latestMention ? 'named in latest turn' : 'curated current-scene state',
                confidence: best.latestMention ? 1 : Math.min(0.9, 0.62 + best.stateSimilarity),
            };
        }
    }

    // A character not named in the recent focus may still be present when its
    // objective current-state text explicitly places it at the selected place.
    if (location?.name) {
        for (const record of characters) {
            if (participantMap.has(record.id) || ABSENT_STATE.test(record.currentState || '')) continue;
            if (textMentions(record.currentState || '', [location.name])) {
                addParticipant(record, 'curated at current location', 0.72);
            }
        }
    }

    const addressed = characters
        .filter(record => !referenceMatch(playerName, record) && textMentions(latestUserText, recordReferences(record)))
        .map(record => ({ id: record.id, name: record.name }));
    const objects = Object.values(store?.entities || {})
        .filter(record => record?.type === 'item' && record.enabled !== false)
        .filter(record => textMentions(latestText, recordReferences(record)) || textMentions(exchangeText, recordReferences(record)))
        .filter(record => !ABSENT_STATE.test(record.currentState || ''))
        .filter(record => !referenceLocallyAbsent(latestText, record))
        .slice(0, 8)
        .map(record => ({ id: record.id, name: record.name, reason: 'named in latest exchange' }));

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
        participants: [...participantMap.values()],
        addressed,
        objects,
    };
}

export function renderSceneState(scene, maximumLength = 1_200) {
    if (!scene) return '';
    const maximum = Math.max(240, Number(maximumLength) || 1_200);
    const opening = [
        '<inner_lore_current_scene compiled="true">',
        'This is a relevance map compiled from the latest turn and established current state, not permission to invent missing facts.',
    ];
    const details = [];
    if (scene.location?.name) details.push(`Location/focus: ${scene.location.name} (${scene.location.source}).`);
    if (scene.participants?.length) details.push(`Present or directly engaged: ${scene.participants.map(item => item.name).join('; ')}.`);
    if (scene.addressed?.length) details.push(`Directly addressed or affected by the newest player turn: ${scene.addressed.map(item => item.name).join('; ')}.`);
    if (scene.objects?.length) details.push(`Objects currently in play: ${scene.objects.map(item => item.name).join('; ')}.`);
    if (scene.latestUserName) {
        details.push(`Newest player-turn source: ${scene.latestUserName}. Preserve that turn's speaker and actor ownership.`);
    }
    details.push(
        'Prefer this immediate scene over merely recent alternatives or objects elsewhere. Do not force every listed element into the prose.',
    );
    const closing = '</inner_lore_current_scene>';
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
