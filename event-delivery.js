/**
 * Generation-time delivery for editor-authored events.
 *
 * World Progression normally commits elapsed time after a completed reply.
 * A high-confidence user-authored time skip can therefore cross an event
 * threshold before that background pass finishes. This module produces a
 * provisional prompt for that reply and persistently re-emits already
 * observable events until completed narration establishes them.
 */

import { canonicalNameKey, cleanString, contextTokens } from './core.js';
import { listTriggerEventRecords, triggerEventTimeThreshold } from './trigger-events.js';

const MAX_PREVIEW_SECONDS = 10 * 365 * 24 * 60 * 60;
const NUMBER_WORDS = Object.freeze({
    a: 1,
    an: 1,
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
    eleven: 11,
    twelve: 12,
    thirteen: 13,
    fourteen: 14,
    fifteen: 15,
    sixteen: 16,
    seventeen: 17,
    eighteen: 18,
    nineteen: 19,
    twenty: 20,
    thirty: 30,
    forty: 40,
    fifty: 50,
    sixty: 60,
    ninety: 90,
    half: 0.5,
});
const NUMBER_SOURCE = String.raw`(?:\d+(?:\.\d+)?|a|an|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|ninety|half|a few|several|some)`;
const UNIT_SOURCE = String.raw`(?:seconds?|secs?|minutes?|mins?|hours?|hrs?|days?|weeks?)`;
// Natural-language time skips often qualify the duration ("three full days",
// "a whole hour"). Keep the qualifier inside the duration grammar so the
// amount and unit remain capture groups 1 and 2 for every pattern.
const DURATION_SOURCE = String.raw`(${NUMBER_SOURCE})\s*(?:(?:full|whole|complete|entire)\s+)?(${UNIT_SOURCE})`;
const ADVANCE_PATTERNS = [
    new RegExp(String.raw`\b${DURATION_SOURCE}\s+(?:(?:have|has|had)\s+)?(?:pass(?:es|ed)?|elapse(?:s|d)?|go(?:es|ne)?\s+by|later)\b`, 'giu'),
    new RegExp(String.raw`\bafter\s+${DURATION_SOURCE}\b`, 'giu'),
    new RegExp(String.raw`\b(?:i|you|we|they|he|she)\s+(?:wait(?:ed|s)?|slept|sleep|rest(?:ed|s)?|travel(?:led|ed|s)?)\s+(?:for\s+)?${DURATION_SOURCE}\b`, 'giu'),
];

function amountValue(rawValue) {
    const value = cleanString(rawValue, 40).toLocaleLowerCase();
    const numeric = Number(value);
    if (Number.isFinite(numeric)) return numeric;
    if (value === 'a few' || value === 'several' || value === 'some') return 3;
    return NUMBER_WORDS[value] ?? 0;
}

function unitSeconds(rawUnit) {
    const unit = cleanString(rawUnit, 40).toLocaleLowerCase();
    if (unit.startsWith('sec')) return 1;
    if (unit.startsWith('min')) return 60;
    if (unit.startsWith('hour') || unit.startsWith('hr')) return 3_600;
    if (unit.startsWith('day')) return 86_400;
    if (unit.startsWith('week')) return 604_800;
    return 0;
}

export function explicitUserTimeAdvanceSeconds(textValue) {
    const text = cleanString(textValue, 20_000);
    if (!text) return 0;
    let maximum = 0;
    for (const pattern of ADVANCE_PATTERNS) {
        pattern.lastIndex = 0;
        for (const match of text.matchAll(pattern)) {
            const seconds = amountValue(match[1]) * unitSeconds(match[2]);
            if (Number.isFinite(seconds)) maximum = Math.max(maximum, seconds);
        }
    }
    return Math.min(MAX_PREVIEW_SECONDS, Math.max(0, Math.round(maximum)));
}

export function pendingExplicitUserTimeAdvanceSeconds(messagesValue, startIndexValue = 0, endIndexValue) {
    const messages = Array.isArray(messagesValue) ? messagesValue : [];
    const startIndex = Math.max(0, Number.isInteger(startIndexValue) ? startIndexValue : 0);
    const endIndex = Math.min(
        messages.length - 1,
        Number.isInteger(endIndexValue) ? endIndexValue : messages.length - 1,
    );
    let total = 0;
    for (let index = startIndex; index <= endIndex; index++) {
        const message = messages[index];
        if (!message?.is_user || message.is_system) continue;
        total += explicitUserTimeAdvanceSeconds(message.mes);
        if (total >= MAX_PREVIEW_SECONDS) return MAX_PREVIEW_SECONDS;
    }
    return total;
}

function timeThresholdWouldBeReached(record, clock, previewSeconds) {
    if (record.triggerAfterSeconds === null) return false;
    const threshold = triggerEventTimeThreshold(record);
    const elapsed = record.triggerTimeCertainty === 'definite'
        ? Number(clock?.minimumSeconds) || 0
        : Number(clock?.estimatedSeconds) || 0;
    return elapsed + previewSeconds >= threshold;
}

function thresholdWouldBeReached(record, clock, previewSeconds) {
    if (!timeThresholdWouldBeReached(record, clock, previewSeconds)) return false;
    const hasAction = Boolean(record.actionCondition);
    return record.triggerMode !== 'all' || !hasAction || record.runtime.actionMatched;
}

function renderDeliveryRecord(record, kind) {
    const threshold = kind === 'time_preview' ? 'CROSSED_THIS_TURN' : 'ALREADY_OBSERVABLE';
    const onsetOnly = /\b(?:begins?|starts?|commences?)\b/iu.test(`${record.description || ''} ${record.consequences || ''}`);
    const payload = {
        title: record.title,
        ...(record.description ? { detail: record.description } : {}),
        ...(record.consequences ? { consequences: record.consequences } : {}),
        ...(onsetOnly ? { delivery_boundary: 'onset_only_do_not_complete' } : {}),
    };
    return [
        `<event mode="must_happen_now" threshold="${threshold}" identity_policy="supplied_only">`,
        JSON.stringify(payload),
        '</event>',
    ].join('\n');
}

function actorCanBeLatestPlayer(record, playerNameValue) {
    if (record.actorScope === 'any' || record.actorScope === 'player') return true;
    if (record.actorScope === 'npc') return false;
    const playerName = canonicalNameKey(playerNameValue);
    return Boolean(playerName && playerName === canonicalNameKey(record.actorName));
}

const SAME_REPLY_ACTION_PREDICATES = new Set([
    'accept', 'attack', 'break', 'bring', 'cancel', 'carry', 'choose', 'close', 'cut', 'deliver',
    'destroy', 'dismiss', 'drop', 'enter', 'fire', 'give', 'hand', 'kill', 'leave', 'lock', 'loose',
    'lower', 'open', 'pull', 'raise', 'recover', 'refuse', 'release', 'repair', 'return', 'shoot',
    'sign', 'strike', 'take', 'throw', 'unlock', 'use',
]);

function predicateForms(root) {
    const forms = new Set([root, `${root}s`, `${root}es`, `${root}ed`, `${root}ing`]);
    if (root.endsWith('e')) {
        forms.add(`${root}d`);
        forms.add(`${root.slice(0, -1)}ing`);
    }
    if (root.endsWith('y')) {
        forms.add(`${root.slice(0, -1)}ies`);
        forms.add(`${root.slice(0, -1)}ied`);
    }
    return forms;
}

const SAME_REPLY_PREDICATE_FORMS = new Map([...SAME_REPLY_ACTION_PREDICATES]
    .map(root => [root, predicateForms(root)]));

function actionPredicateRoots(value) {
    const words = canonicalNameKey(value).split(/\s+/u).filter(Boolean);
    return new Set([...SAME_REPLY_PREDICATE_FORMS]
        .filter(([, forms]) => words.some(word => forms.has(word)))
        .map(([root]) => root));
}

function sameReplyActionIsRelevant(record, latestTextValue, playerNameValue) {
    const conditionTokens = contextTokens(record.actionCondition, 100);
    const latestTokens = new Set(contextTokens(latestTextValue, 400));
    if (!conditionTokens.length || !latestTokens.size) return false;
    const actorTokens = new Set([
        ...contextTokens(playerNameValue, 10),
        'player',
    ]);
    const comparable = conditionTokens.filter(token => !actorTokens.has(token));
    const conditionPredicates = actionPredicateRoots(record.actionCondition);
    const latestPredicates = actionPredicateRoots(latestTextValue);
    if (![...conditionPredicates].some(root => latestPredicates.has(root))) return false;
    const overlap = comparable.filter(token => latestTokens.has(token));
    const nonPredicateOverlap = overlap.filter(token => actionPredicateRoots(token).size === 0);
    const required = Math.max(2, Math.ceil(comparable.length * 0.35));
    return nonPredicateOverlap.length >= 1 && overlap.length >= Math.min(comparable.length, required);
}

function renderAttemptRecord(record) {
    const onsetOnly = /\b(?:begins?|starts?|commences?)\b/iu.test(`${record.description || ''} ${record.consequences || ''}`);
    return [
        '<event mode="conditional_same_reply" identity_policy="supplied_only">',
        JSON.stringify({
            condition: record.actionCondition,
            title: record.title,
            ...(record.description ? { detail: record.description } : {}),
            ...(record.consequences ? { consequences: record.consequences } : {}),
            ...(onsetOnly ? { delivery_boundary: 'onset_only_do_not_complete' } : {}),
        }),
        '</event>',
    ].join('\n');
}

export function compileTriggerEventDeliveryPreview(stateValue, messagesValue, options = {}) {
    const state = stateValue && typeof stateValue === 'object' ? stateValue : {};
    const messages = Array.isArray(messagesValue) ? messagesValue : [];
    const currentIndex = Number.isInteger(options.currentIndex) ? options.currentIndex : messages.length - 1;
    const progressionIndex = Number.isInteger(state.lastProcessedIndex) ? state.lastProcessedIndex : -1;
    const generationId = cleanString(options.generationId, 240);
    const records = listTriggerEventRecords(state);
    const observable = records.filter(record => record.enabled
        && record.status === 'observable'
        && record.runtime.deliveryStatus !== 'failed'
        && (record.runtime.deliveryStatus !== 'injected'
            || record.runtime.deliveryInjectionReceipts?.some(receipt => receipt.generationId === generationId)));
    const provisional = [];
    const attemptPreviews = [];
    let previewSeconds = 0;
    for (const record of records) {
        if (!record.enabled
            || record.status !== 'armed'
            || record.createdAtMessage >= currentIndex
            || record.activationVisibility !== 'observable') continue;
        // A relative timer starts where the event was created. Do not count an
        // older, still-unprocessed time skip toward a newly created watcher.
        const recordStart = record.timeBasis === 'after_creation'
            ? Math.max(progressionIndex + 1, record.createdAtMessage + 1)
            : progressionIndex + 1;
        const recordPreviewSeconds = pendingExplicitUserTimeAdvanceSeconds(messages, recordStart, currentIndex);
        previewSeconds = Math.max(previewSeconds, recordPreviewSeconds);
        if (thresholdWouldBeReached(record, state.clock, recordPreviewSeconds)) provisional.push(record);
    }

    const attemptMessageIndex = Number.isInteger(options.attemptMessageIndex)
        ? Math.max(0, Math.min(currentIndex, options.attemptMessageIndex))
        : currentIndex;
    const latestMessage = messages[attemptMessageIndex];
    if (latestMessage?.is_user && !latestMessage.is_system) {
        const maximumAttemptPreviews = Math.max(1, Math.min(20, Number(options.maximumAttemptPreviews) || 8));
        const candidates = records
            .filter(record => record.enabled
                && record.status === 'armed'
                && record.actionTiming === 'same_reply_attempt'
                && Boolean(record.actionCondition)
                && !record.runtime.actionMatched
                && record.createdAtMessage < attemptMessageIndex
                && record.activationVisibility === 'observable'
                && actorCanBeLatestPlayer(record, options.playerName)
                && sameReplyActionIsRelevant(record, latestMessage.mes, options.playerName))
            .sort((a, b) => b.priority - a.priority || a.title.localeCompare(b.title));
        for (const record of candidates) {
            if (record.triggerMode === 'all' && record.triggerAfterSeconds !== null) {
                const recordStart = record.timeBasis === 'after_creation'
                    ? Math.max(progressionIndex + 1, record.createdAtMessage + 1)
                    : progressionIndex + 1;
                const recordPreviewSeconds = pendingExplicitUserTimeAdvanceSeconds(messages, recordStart, attemptMessageIndex);
                if (!timeThresholdWouldBeReached(record, state.clock, recordPreviewSeconds)) continue;
            }
            attemptPreviews.push(record);
            if (attemptPreviews.length >= maximumAttemptPreviews) break;
        }
    }

    const provisionalIds = new Set(provisional.map(record => record.id));
    const mandatoryRecords = [...observable, ...provisional]
        .filter((record, index, values) => values.findIndex(item => item.id === record.id) === index)
        .sort((a, b) => b.priority - a.priority || a.title.localeCompare(b.title));
    const mandatoryIds = new Set(mandatoryRecords.map(record => record.id));
    const conditionalRecords = attemptPreviews.filter(record => !mandatoryIds.has(record.id));
    const recordsToSend = [...mandatoryRecords, ...conditionalRecords];
    if (!recordsToSend.length) return { text: '', records: [], deliveries: [], previewSeconds };

    const lines = [
        `<inner_lore_trigger_delivery schema="2" control="private" mandatory="${mandatoryRecords.length ? 'true' : 'false'}">`,
        'CONTROL DATA — NEVER QUOTE, PARAPHRASE, SUMMARIZE, LABEL, OR DISPLAY THIS BLOCK. Render only natural story prose.',
    ];
    if (mandatoryRecords.length) {
        lines.push(
            provisional.length
                ? `TIME_EVIDENCE: the player's explicit advance crosses ${provisional.length} event threshold${provisional.length === 1 ? '' : 's'} now (up to ${previewSeconds} exact story seconds across relevant unprocessed player turns).`
                : 'TIME_EVIDENCE: each event below is observable and has not yet appeared in completed narration.',
            'DELIVERY_MODE: MUST_HAPPEN_NOW. Concretely establish every listed event in this reply; do not merely foreshadow, postpone, or discuss it.',
            'EVENT_COMPLETION: a reference to the event title or actor alone is insufficient. Physically stage the supplied action and make every concrete appearance, object, and message detail in each event detail observable before ending. This delivery outranks routine scene continuation.',
            'STATE_BOUNDARY: wording such as “begins”, “starts”, or “begins lowering” is an exact transition boundary. Establish its onset but do not complete, finish, close, arrive at the endpoint, or advance beyond the supplied state.',
            'IDENTITY_POLICY: SUPPLIED_ONLY. Do not invent a proper name for an unnamed event actor unless established canon already supplies one.',
            'AGENCY_AND_KNOWLEDGE: do not invent player actions, choices, dialogue, or private knowledge. Give characters only evidence they can observe or already know.',
            'CONTINUITY: if the immediately preceding story already began the same event while state caught up, continue its consequences instead of replaying its entrance.',
            ...mandatoryRecords.map(record => renderDeliveryRecord(
                record,
                provisionalIds.has(record.id) ? 'time_preview' : 'observable',
            )),
        );
    }
    if (conditionalRecords.length) {
        lines.push(
            'DELIVERY_MODE: CONDITIONAL_SAME_REPLY. Apply an event only if the newest player message concretely attempts its condition and the narrated outcome permits completion; an intention, hypothetical, refusal, or failed attempt is not success.',
            'When a condition matches, establish the event in this reply. Preserve player agency and use only names supplied by the event or established canon.',
            'Respect exact state boundaries: “begins” or “starts” authorizes onset, never completion or the endpoint.',
            ...conditionalRecords.map(renderAttemptRecord),
        );
    }
    lines.push('</inner_lore_trigger_delivery>');
    const deliveries = [
        ...mandatoryRecords.map(record => ({
            definitionId: record.id,
            kind: provisionalIds.has(record.id) ? 'time_preview' : 'observable',
        })),
        ...conditionalRecords.map(record => ({ definitionId: record.id, kind: 'attempt_preview' })),
    ];
    return { text: lines.join('\n'), records: recordsToSend, deliveries, previewSeconds };
}
