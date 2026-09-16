/**
 * Pure World Progression Engine state, scheduling, and prompt-injection helpers.
 *
 * The progression store is deliberately separate from public lore. A simulated
 * off-screen event is a narrator proposal until the story reveals it; keeping
 * those records here prevents speculative state from leaking into World Info.
 */

import { canonicalNameKey, clamp, cleanString, contextSimilarity, uniqueStrings } from './core.js';
import {
    evaluateTriggerEvents,
    getTriggerEventStats,
    listTriggerEventRecords,
    normalizeTriggerEventCollections,
    triggerEventAgentSnapshot,
} from './trigger-events.js';
import {
    getEventDirectorStats,
    normalizeEventDirectorMetadata,
    normalizeEventProposalMap,
} from './event-director.js';

export const PROGRESSION_VERSION = 3;

const YEAR_SECONDS = 365 * 24 * 60 * 60;
// A passage may legitimately skip centuries in speculative fiction. This is a
// numerical sanity ceiling, not a pacing rule.
const MAX_STEP_SECONDS = 1_000_000 * YEAR_SECONDS;
const MAX_LOG_ENTRIES = 160;
const FINAL_STATUSES = new Set(['completed', 'failed', 'cancelled']);
const GOAL_STATUSES = new Set(['active', 'blocked', 'completed', 'failed', 'cancelled']);
const PROCESS_STATUSES = new Set(['active', 'paused', 'completed', 'failed', 'cancelled']);
const EVENT_STATUSES = new Set([
    'latent',
    'scheduled',
    'possibly_due',
    'due',
    'occurred_offscreen',
    'revealed',
    'cancelled',
]);
const VISIBILITIES = new Set(['public', 'private', 'narrator']);
const DURATION_UNIT_SECONDS = Object.freeze({
    second: 1,
    minute: 60,
    hour: 3_600,
    day: 86_400,
    week: 604_800,
    month: 2_592_000,
    year: YEAR_SECONDS,
});
const NUMBER_WORD_VALUES = Object.freeze({
    zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5,
    six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
    eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15,
    sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20,
});

function numberOr(value, fallback = 0) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
}

function canonicalTextKey(value, maximumLength = 200_000) {
    return cleanString(value, maximumLength)
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/gu, '')
        .toLocaleLowerCase()
        .replace(/[^\p{L}\p{N}]+/gu, ' ')
        .trim();
}

function normalizeKey(value, fallback = '') {
    return canonicalNameKey(value || fallback).replace(/\s+/g, '_').slice(0, 120);
}

function readField(source, ...names) {
    for (const name of names) {
        if (source && Object.hasOwn(source, name)) return source[name];
    }
    return undefined;
}

function normalizeDurationRange(value, fallback = null) {
    if (value === undefined || value === null || value === '') return fallback;
    if (typeof value === 'number' || typeof value === 'string') {
        const estimate = clamp(value, 0, MAX_STEP_SECONDS);
        return { minimumSeconds: estimate, estimatedSeconds: estimate, maximumSeconds: estimate };
    }
    if (typeof value !== 'object' || Array.isArray(value)) return fallback;

    const rawEstimate = readField(value, 'estimated_seconds', 'estimate_seconds', 'estimatedSeconds', 'estimate', 'seconds');
    const rawMinimum = readField(value, 'minimum_seconds', 'min_seconds', 'minimumSeconds', 'minimum', 'min');
    const rawMaximum = readField(value, 'maximum_seconds', 'max_seconds', 'maximumSeconds', 'maximum', 'max');
    const estimate = clamp(rawEstimate ?? rawMinimum ?? rawMaximum ?? 0, 0, MAX_STEP_SECONDS);
    const minimum = clamp(rawMinimum ?? estimate, 0, MAX_STEP_SECONDS);
    const maximum = clamp(rawMaximum ?? estimate, 0, MAX_STEP_SECONDS);
    const orderedMinimum = Math.min(minimum, estimate, maximum);
    const orderedMaximum = Math.max(minimum, estimate, maximum);
    return {
        minimumSeconds: orderedMinimum,
        estimatedSeconds: clamp(estimate, orderedMinimum, orderedMaximum),
        maximumSeconds: orderedMaximum,
    };
}

function normalizeAbsoluteRange(value, fallback = null) {
    const range = normalizeDurationRange(value, fallback);
    if (!range) return null;
    return {
        minimumSeconds: Math.max(0, numberOr(range.minimumSeconds)),
        estimatedSeconds: Math.max(0, numberOr(range.estimatedSeconds)),
        maximumSeconds: Math.max(0, numberOr(range.maximumSeconds)),
    };
}

function normalizeTimeline(value) {
    if (!Array.isArray(value)) return [];
    return value.slice(0, 60).map((item, index) => {
        if (!item || typeof item !== 'object') return null;
        const duration = normalizeDurationRange(item.duration ?? item, null);
        const description = cleanString(item.description || item.segment || item.action, 500);
        if (!duration || !description) return null;
        return {
            key: normalizeKey(item.key, `segment_${index + 1}`),
            description,
            actor: cleanString(item.actor, 160),
            kind: normalizeKey(item.kind, 'action'),
            parallelGroup: normalizeKey(
                readField(item, 'parallel_group', 'parallelGroup', 'overlap_group', 'overlapGroup'),
                `sequential_${index + 1}`,
            ),
            overlapConfirmed: readField(item, 'overlap_confirmed', 'overlapConfirmed') === true,
            overlapEvidence: cleanString(readField(item, 'overlap_evidence', 'overlapEvidence'), 500),
            duration,
            evidence: cleanString(item.evidence, 500),
        };
    }).filter(Boolean);
}

function explicitNumber(value) {
    const direct = Number(String(value).trim());
    if (Number.isFinite(direct) && direct >= 0) return direct;
    const normalized = canonicalNameKey(value);
    if (Object.hasOwn(NUMBER_WORD_VALUES, normalized)) return NUMBER_WORD_VALUES[normalized];
    return null;
}

/**
 * Extract only declarative elapsed-time anchors (for example, “three full
 * days pass”). Future deadlines such as “in five days” are deliberately not
 * matched. Adjacent player/story restatements count once.
 */
export function extractDeterministicElapsedAnchors(passageText) {
    const source = cleanString(passageText, 200_000);
    if (!source) return { totalSeconds: 0, anchors: [] };
    const blocks = [];
    const blockPattern = /\[message\s+(\d+);\s*([^\]]+)\]\n([\s\S]*?)(?=\n+\[message\s+\d+;|$)/gu;
    for (const match of source.matchAll(blockPattern)) {
        blocks.push({ messageIndex: Number(match[1]), role: cleanString(match[2], 120), text: match[3] });
    }
    if (!blocks.length) blocks.push({ messageIndex: -1, role: '', text: source });
    const amountPattern = '(?:\\d+(?:\\.\\d+)?|zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty)';
    const pattern = new RegExp(`\\b(${amountPattern})\\s+(?:full\\s+|whole\\s+)?(seconds?|minutes?|hours?|days?|weeks?|months?|years?)\\s+(pass(?:es|ed)?|elaps(?:e|es|ed)|go(?:es)?\\s+by|went\\s+by)\\b`, 'giu');
    const anchors = [];
    for (const block of blocks) {
        for (const match of block.text.matchAll(pattern)) {
            const prefix = block.text.slice(Math.max(0, match.index - 28), match.index);
            if (/\b(?:if|when|unless|before|should|would|could|will)\s*$/iu.test(prefix)) continue;
            const amount = explicitNumber(match[1]);
            const unit = canonicalNameKey(match[2]).replace(/s$/u, '');
            if (amount === null || !DURATION_UNIT_SECONDS[unit]) continue;
            const seconds = amount * DURATION_UNIT_SECONDS[unit];
            if (!Number.isFinite(seconds) || seconds < 0 || seconds > MAX_STEP_SECONDS) continue;
            const duplicate = anchors.find(previous => (
                previous.seconds === seconds
                && previous.unit === unit
                && previous.messageIndex >= 0
                && block.messageIndex >= 0
                && Math.abs(previous.messageIndex - block.messageIndex) <= 1
                && previous.role !== block.role
            ));
            if (duplicate) {
                duplicate.evidence.push(cleanString(match[0], 240));
                continue;
            }
            anchors.push({
                seconds,
                amount,
                unit,
                messageIndex: block.messageIndex,
                role: block.role,
                evidence: [cleanString(match[0], 240)],
            });
        }
    }
    return {
        totalSeconds: anchors.reduce((sum, anchor) => sum + anchor.seconds, 0),
        anchors,
    };
}

function durationFromTimeline(timeline) {
    if (!timeline.length) return null;
    const groups = new Map();
    for (let index = 0; index < timeline.length; index++) {
        const segment = timeline[index];
        // Sequential is the safe default. A model may reuse a group merely
        // because two actions occur in one exchange; local calculation accepts
        // overlap only when it explicitly confirms and supports simultaneity.
        const effectiveGroup = segment.overlapConfirmed && segment.overlapEvidence
            ? segment.parallelGroup
            : `sequential_${index + 1}`;
        const current = groups.get(effectiveGroup) || {
            minimumSeconds: 0,
            estimatedSeconds: 0,
            maximumSeconds: 0,
        };
        current.minimumSeconds = Math.max(current.minimumSeconds, segment.duration.minimumSeconds);
        current.estimatedSeconds = Math.max(current.estimatedSeconds, segment.duration.estimatedSeconds);
        current.maximumSeconds = Math.max(current.maximumSeconds, segment.duration.maximumSeconds);
        groups.set(effectiveGroup, current);
    }
    const total = { minimumSeconds: 0, estimatedSeconds: 0, maximumSeconds: 0 };
    for (const duration of groups.values()) {
        total.minimumSeconds += duration.minimumSeconds;
        total.estimatedSeconds += duration.estimatedSeconds;
        total.maximumSeconds += duration.maximumSeconds;
    }
    return total;
}

function normalizeClock(value = {}) {
    const source = value && typeof value === 'object' ? value : {};
    const minimum = Math.max(0, numberOr(readField(source, 'minimumSeconds', 'minimum_seconds')));
    const estimated = Math.max(minimum, numberOr(readField(source, 'estimatedSeconds', 'estimated_seconds'), minimum));
    const maximum = Math.max(estimated, numberOr(readField(source, 'maximumSeconds', 'maximum_seconds'), estimated));
    return {
        minimumSeconds: minimum,
        estimatedSeconds: estimated,
        maximumSeconds: maximum,
        confidence: clamp(source.confidence ?? 1, 0, 1),
        currentTimeLabel: cleanString(readField(source, 'currentTimeLabel', 'current_time_label'), 240),
        lastExactAnchor: cleanString(readField(source, 'lastExactAnchor', 'last_exact_anchor'), 240),
        lastDuration: normalizeDurationRange(readField(source, 'lastDuration', 'last_duration'), null),
        lastReportedDuration: normalizeDurationRange(readField(source, 'lastReportedDuration', 'last_reported_duration'), null),
        lastTimeline: normalizeTimeline(readField(source, 'lastTimeline', 'last_timeline')),
        lastBasis: uniqueStrings(readField(source, 'lastBasis', 'last_basis') || [], 12),
        lastCompletedActions: uniqueStrings(readField(source, 'lastCompletedActions', 'last_completed_actions') || [], 12),
        updatedAtMessage: Number.isInteger(source.updatedAtMessage) ? source.updatedAtMessage : -1,
    };
}

export function createProgressionState() {
    return {
        version: PROGRESSION_VERSION,
        clock: normalizeClock(),
        goals: {},
        processes: {},
        events: {},
        eventDefinitions: {},
        eventRuntime: {},
        eventProposals: {},
        eventDirector: normalizeEventDirectorMetadata({}),
        lastTriggerDeliveryPrompt: null,
        lastTriggerEvaluatorRequest: null,
        log: [],
        lastProcessedIndex: -1,
        processedFingerprints: {},
        revision: 0,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        lastRunAt: 0,
        lastRunStats: null,
        lastError: '',
    };
}

function normalizeRecordMap(value) {
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

export function normalizeProgressionState(value) {
    const base = createProgressionState();
    const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    const state = { ...base, ...source };
    state.version = PROGRESSION_VERSION;
    state.clock = normalizeClock(source.clock);
    state.goals = normalizeRecordMap(source.goals);
    state.processes = normalizeRecordMap(source.processes);
    state.events = normalizeRecordMap(source.events);
    const triggerEvents = normalizeTriggerEventCollections(source.eventDefinitions, source.eventRuntime);
    state.eventDefinitions = triggerEvents.definitions;
    state.eventRuntime = triggerEvents.runtime;
    state.eventProposals = normalizeEventProposalMap(source.eventProposals);
    state.eventDirector = normalizeEventDirectorMetadata(source.eventDirector);
    const deliveryPrompt = source.lastTriggerDeliveryPrompt;
    state.lastTriggerDeliveryPrompt = deliveryPrompt && typeof deliveryPrompt === 'object' && !Array.isArray(deliveryPrompt)
        ? {
            generationId: cleanString(deliveryPrompt.generationId, 240),
            messageIndex: Number.isInteger(deliveryPrompt.messageIndex) ? deliveryPrompt.messageIndex : -1,
            prompt: cleanString(deliveryPrompt.prompt, 30_000),
            records: (Array.isArray(deliveryPrompt.records) ? deliveryPrompt.records : []).slice(0, 40).map(record => ({
                definitionId: cleanString(record?.definitionId, 180),
                key: cleanString(record?.key, 180),
                title: cleanString(record?.title, 240),
                kind: cleanString(record?.kind, 80),
            })),
            createdAt: Math.max(0, numberOr(deliveryPrompt.createdAt)),
        }
        : null;
    const evaluatorRequest = source.lastTriggerEvaluatorRequest;
    state.lastTriggerEvaluatorRequest = evaluatorRequest && typeof evaluatorRequest === 'object' && !Array.isArray(evaluatorRequest)
        ? {
            startIndex: Number.isInteger(evaluatorRequest.startIndex) ? evaluatorRequest.startIndex : -1,
            endIndex: Number.isInteger(evaluatorRequest.endIndex) ? evaluatorRequest.endIndex : -1,
            eventKeys: uniqueStrings(evaluatorRequest.eventKeys || [], 100),
            eventPayloads: (Array.isArray(evaluatorRequest.eventPayloads) ? evaluatorRequest.eventPayloads : [])
                .slice(0, 100)
                .map(record => ({
                    definitionId: cleanString(record?.definitionId, 180),
                    key: cleanString(record?.key, 180),
                    payload: cleanString(record?.payload, 20_000),
                }))
                .filter(record => record.definitionId && record.key && record.payload),
            promptCharacters: Math.max(0, numberOr(evaluatorRequest.promptCharacters)),
            requestedAt: Math.max(0, numberOr(evaluatorRequest.requestedAt)),
        }
        : null;
    state.log = Array.isArray(source.log) ? source.log.slice(-MAX_LOG_ENTRIES) : [];
    state.processedFingerprints = normalizeRecordMap(source.processedFingerprints);
    state.lastProcessedIndex = Number.isInteger(source.lastProcessedIndex) ? source.lastProcessedIndex : -1;
    state.revision = Math.max(0, numberOr(source.revision));
    state.lastError = cleanString(source.lastError, 1_000);
    return state;
}

function recordId(prefix, operation, fallback) {
    const key = normalizeKey(readField(operation, 'key', 'id'), fallback);
    return `${prefix}:${key || normalizeKey(fallback, 'unnamed')}`;
}

function recordAliases(record) {
    return uniqueStrings([record?.key, record?.title, record?.name]);
}

function findRecord(collection, prefix, operation, fallback) {
    const directId = recordId(prefix, operation, fallback);
    if (collection[directId]) return [directId, collection[directId]];
    const wanted = new Set(uniqueStrings([
        readField(operation, 'key', 'id'),
        operation?.title,
        operation?.name,
    ]).map(canonicalNameKey));
    for (const [id, record] of Object.entries(collection)) {
        if (recordAliases(record).some(alias => wanted.has(canonicalNameKey(alias)))) return [id, record];
    }
    return [directId, null];
}

function dueAtFromOperation(operation, clock, existing = null) {
    const absolute = readField(operation, 'due_at_elapsed_seconds', 'dueAtElapsedSeconds');
    if (absolute !== undefined) return normalizeAbsoluteRange(absolute, existing);
    const relative = readField(operation, 'due_in_seconds', 'dueInSeconds');
    const range = normalizeDurationRange(relative, null);
    if (!range) return existing;
    return {
        minimumSeconds: clock.minimumSeconds + range.minimumSeconds,
        estimatedSeconds: clock.estimatedSeconds + range.estimatedSeconds,
        maximumSeconds: clock.maximumSeconds + range.maximumSeconds,
    };
}

function dueState(clock, dueAt) {
    if (!dueAt) return 'unscheduled';
    if (clock.minimumSeconds >= dueAt.maximumSeconds) return 'due';
    if (clock.maximumSeconds >= dueAt.minimumSeconds) return 'possibly_due';
    return 'scheduled';
}

function evidenceFrom(operation) {
    return uniqueStrings(operation?.evidence || operation?.observed_evidence || [], 12);
}

function appendLog(state, kind, record, messageIndex, note = '') {
    state.log.push({
        atElapsedSeconds: state.clock.estimatedSeconds,
        messageIndex,
        kind,
        recordId: record?.id || '',
        note: cleanString(note, 600),
        timestamp: Date.now(),
    });
    state.log = state.log.slice(-MAX_LOG_ENTRIES);
}

function applyTimePatch(state, patch, messageIndex, options = {}) {
    const time = patch && typeof patch === 'object' ? patch : {};
    const durationSource = readField(time, 'elapsed', 'elapsed_time', 'duration', 'elapsed_seconds');
    const reportedDuration = normalizeDurationRange(durationSource, normalizeDurationRange(time, null));
    const timeline = normalizeTimeline(readField(time, 'timeline', 'segments', 'scene_timeline'));
    let duration = durationFromTimeline(timeline) || reportedDuration;
    const deterministic = options.deterministicElapsed
        ?? extractDeterministicElapsedAnchors(options.passageText);
    if (deterministic.totalSeconds > 0 && (!duration || duration.minimumSeconds < deterministic.totalSeconds)) {
        const current = duration || { minimumSeconds: 0, estimatedSeconds: 0, maximumSeconds: 0 };
        duration = {
            minimumSeconds: Math.max(current.minimumSeconds, deterministic.totalSeconds),
            estimatedSeconds: Math.max(current.estimatedSeconds, deterministic.totalSeconds),
            maximumSeconds: Math.max(current.maximumSeconds, deterministic.totalSeconds),
        };
    }
    if (!duration) return { advanced: false, duration: null };

    state.clock.minimumSeconds += duration.minimumSeconds;
    state.clock.estimatedSeconds += duration.estimatedSeconds;
    state.clock.maximumSeconds += duration.maximumSeconds;
    state.clock.confidence = clamp(time.confidence ?? state.clock.confidence, 0, 1);
    state.clock.lastDuration = duration;
    state.clock.lastReportedDuration = reportedDuration;
    state.clock.lastTimeline = timeline;
    state.clock.lastBasis = uniqueStrings(time.basis || time.reasoning || [], 12);
    state.clock.lastCompletedActions = uniqueStrings(readField(time, 'completed_actions', 'completedActions') || [], 12);
    state.clock.updatedAtMessage = messageIndex;
    const label = cleanString(readField(time, 'current_time_label', 'currentTimeLabel'), 240);
    const anchor = cleanString(readField(time, 'explicit_anchor', 'last_exact_anchor', 'explicitAnchor'), 240);
    if (label) state.clock.currentTimeLabel = label;
    if (anchor) state.clock.lastExactAnchor = anchor;
    if (!anchor && deterministic.anchors.length) {
        state.clock.lastExactAnchor = deterministic.anchors.map(item => item.evidence[0]).join('; ').slice(0, 240);
    }
    return { advanced: duration.maximumSeconds > 0, duration, reportedDuration, timeline, deterministic };
}

function commonRecord(existing, operation, id, messageIndex) {
    const now = Date.now();
    const sourceEventValue = cleanString(readField(operation, 'source_event_key', 'sourceEventKey'), 180);
    return {
        ...(existing || {}),
        id,
        key: normalizeKey(readField(operation, 'key', 'id'), existing?.key || id.split(':').slice(1).join(':')),
        visibility: VISIBILITIES.has(operation?.visibility) ? operation.visibility : (existing?.visibility || 'narrator'),
        evidence: evidenceFrom(operation).length ? evidenceFrom(operation) : (existing?.evidence || []),
        notes: cleanString(operation?.notes, 1_000) || existing?.notes || '',
        sourceEventKey: sourceEventValue ? normalizeKey(sourceEventValue) : (existing?.sourceEventKey || ''),
        firstSeenMessage: Number.isInteger(existing?.firstSeenMessage) ? existing.firstSeenMessage : messageIndex,
        lastUpdatedMessage: messageIndex,
        createdAt: existing?.createdAt || now,
        updatedAt: now,
        revision: Math.max(0, numberOr(existing?.revision)) + 1,
    };
}

function progressionRecordSignature(record) {
    if (!record || typeof record !== 'object') return '';
    const {
        revision: _revision,
        createdAt: _createdAt,
        updatedAt: _updatedAt,
        firstSeenMessage: _firstSeenMessage,
        lastUpdatedMessage: _lastUpdatedMessage,
        ...semantic
    } = record;
    return JSON.stringify(semantic);
}

function mergeGoals(state, operations, messageIndex, limits) {
    const result = { created: 0, updated: 0, skipped: 0 };
    for (const operation of (Array.isArray(operations) ? operations : []).slice(0, limits.maximumGoals)) {
        if (!operation || typeof operation !== 'object') { result.skipped++; continue; }
        const fallback = `${operation.owner || 'world'} ${operation.title || operation.description || ''}`;
        if (!canonicalNameKey(fallback)) { result.skipped++; continue; }
        const [id, existing] = findRecord(state.goals, 'goal', operation, fallback);
        const record = commonRecord(existing, operation, id, messageIndex);
        record.owner = cleanString(operation.owner, 180) || existing?.owner || 'World';
        record.title = cleanString(operation.title, 240) || existing?.title || cleanString(operation.description, 240);
        record.description = cleanString(operation.description, 2_000) || existing?.description || '';
        record.nextStep = cleanString(readField(operation, 'next_step', 'nextStep'), 1_000) || existing?.nextStep || '';
        record.blockers = uniqueStrings(operation.blockers || existing?.blockers || [], 20);
        record.requirements = uniqueStrings(operation.requirements || existing?.requirements || [], 20);
        record.progress = clamp(operation.progress ?? existing?.progress ?? 0, 0, 100);
        const requestedStatus = GOAL_STATUSES.has(operation.status) ? operation.status : (existing?.status || 'active');
        record.status = FINAL_STATUSES.has(requestedStatus)
            && requestedStatus !== existing?.status
            && !evidenceFrom(operation).length
            ? (existing?.status || 'active')
            : requestedStatus;
        record.dueAt = dueAtFromOperation(operation, state.clock, existing?.dueAt || null);
        record.deadlineState = dueState(state.clock, record.dueAt);
        if (existing && progressionRecordSignature(existing) === progressionRecordSignature(record)) {
            result.skipped++;
            continue;
        }
        state.goals[id] = record;
        result[existing ? 'updated' : 'created']++;
        appendLog(state, existing ? 'goal_updated' : 'goal_created', record, messageIndex, record.title);
    }
    return result;
}

function mergeProcesses(state, operations, messageIndex, limits) {
    const result = { created: 0, updated: 0, skipped: 0 };
    for (const operation of (Array.isArray(operations) ? operations : []).slice(0, limits.maximumProcesses)) {
        if (!operation || typeof operation !== 'object') { result.skipped++; continue; }
        const subjectName = cleanString(readField(operation, 'subject_name', 'subjectName'), 180);
        const fallback = `${subjectName} ${operation.kind || operation.title || operation.description || ''}`;
        if (!canonicalNameKey(fallback)) { result.skipped++; continue; }
        const [id, existing] = findRecord(state.processes, 'process', operation, fallback);
        const record = commonRecord(existing, operation, id, messageIndex);
        record.subjectType = normalizeKey(readField(operation, 'subject_type', 'subjectType'), existing?.subjectType || 'world');
        record.subjectName = subjectName || existing?.subjectName || 'World';
        record.kind = cleanString(operation.kind, 120) || existing?.kind || 'progression';
        record.title = cleanString(operation.title, 240) || existing?.title || `${record.subjectName}: ${record.kind}`;
        record.description = cleanString(operation.description, 2_000) || existing?.description || '';
        record.stage = cleanString(operation.stage, 240) || existing?.stage || '';
        record.outcome = cleanString(operation.outcome, 1_500) || existing?.outcome || '';
        record.conditions = uniqueStrings(operation.conditions || existing?.conditions || [], 20);
        record.progress = clamp(operation.progress ?? existing?.progress ?? 0, 0, 100);
        const requestedStatus = PROCESS_STATUSES.has(operation.status) ? operation.status : (existing?.status || 'active');
        record.status = FINAL_STATUSES.has(requestedStatus)
            && requestedStatus !== existing?.status
            && !evidenceFrom(operation).length
            ? (existing?.status || 'active')
            : requestedStatus;
        record.dueAt = dueAtFromOperation(operation, state.clock, existing?.dueAt || null);
        record.dueState = dueState(state.clock, record.dueAt);
        if (existing && progressionRecordSignature(existing) === progressionRecordSignature(record)) {
            result.skipped++;
            continue;
        }
        state.processes[id] = record;
        result[existing ? 'updated' : 'created']++;
        appendLog(state, existing ? 'process_updated' : 'process_created', record, messageIndex, record.title);
    }
    return result;
}

function safeEventStatus(requested, operation, existing, autonomy) {
    let status = EVENT_STATUSES.has(requested) ? requested : (existing?.status || 'latent');
    const requiresPlayer = Boolean(readField(operation, 'requires_player_action', 'requiresPlayerAction') ?? existing?.requiresPlayerAction);
    const evidence = evidenceFrom(operation);
    if (requiresPlayer && ['occurred_offscreen', 'revealed'].includes(status)) status = existing?.status || 'due';
    if (status === 'revealed' && !evidence.length) status = existing?.status || 'due';
    if (status === 'occurred_offscreen' && !evidence.length) status = existing?.status || 'latent';
    if (status === 'occurred_offscreen' && autonomy === 'advisory') status = existing?.status || 'latent';
    return status;
}

function mergeEvents(state, operations, messageIndex, limits, autonomy) {
    const result = { created: 0, updated: 0, skipped: 0, protectedPlayerActions: 0 };
    const editorKeys = new Set(Object.values(state.eventDefinitions || {}).map(record => record.key));
    for (const operation of (Array.isArray(operations) ? operations : []).slice(0, limits.maximumEvents)) {
        if (!operation || typeof operation !== 'object') { result.skipped++; continue; }
        if (editorKeys.has(normalizeKey(readField(operation, 'key', 'id')))) {
            // Editor definitions own their runtime. The model may create goals
            // and processes from their consequences, but never a duplicate
            // automatic beat under the same stable key.
            result.skipped++;
            continue;
        }
        const fallback = `${operation.title || operation.description || operation.trigger || ''}`;
        if (!canonicalNameKey(fallback)) { result.skipped++; continue; }
        const [id, existing] = findRecord(state.events, 'event', operation, fallback);
        const record = commonRecord(existing, operation, id, messageIndex);
        record.title = cleanString(operation.title, 240) || existing?.title || cleanString(operation.description, 240);
        record.kind = cleanString(operation.kind, 120) || existing?.kind || 'story_beat';
        record.description = cleanString(operation.description, 2_000) || existing?.description || '';
        record.trigger = cleanString(operation.trigger, 1_000) || existing?.trigger || '';
        record.canonImpact = cleanString(readField(operation, 'canon_impact', 'canonImpact'), 1_000) || existing?.canonImpact || '';
        record.subjects = uniqueStrings(operation.subjects || existing?.subjects || [], 20);
        record.priority = clamp(operation.priority ?? existing?.priority ?? 50, 0, 100);
        record.requiresPlayerAction = Boolean(readField(operation, 'requires_player_action', 'requiresPlayerAction') ?? existing?.requiresPlayerAction);
        const requested = operation.status;
        record.status = safeEventStatus(requested, operation, existing, autonomy);
        if (record.requiresPlayerAction && ['occurred_offscreen', 'revealed'].includes(requested)) result.protectedPlayerActions++;
        record.dueAt = dueAtFromOperation(operation, state.clock, existing?.dueAt || null);
        const scheduledState = dueState(state.clock, record.dueAt);
        if (['latent', 'scheduled', 'possibly_due', 'due'].includes(record.status) && record.dueAt) {
            record.status = scheduledState;
        }
        if (existing && progressionRecordSignature(existing) === progressionRecordSignature(record)) {
            result.skipped++;
            continue;
        }
        state.events[id] = record;
        result[existing ? 'updated' : 'created']++;
        appendLog(state, existing ? 'event_updated' : 'event_created', record, messageIndex, record.title);
    }
    return result;
}

export function runProgressionScheduler(stateValue, options = {}) {
    const state = normalizeProgressionState(stateValue);
    const changes = { goals: 0, processes: 0, events: 0 };
    for (const record of Object.values(state.goals)) {
        const next = dueState(state.clock, record.dueAt);
        if (record.deadlineState !== next) { record.deadlineState = next; changes.goals++; }
    }
    for (const record of Object.values(state.processes)) {
        const next = dueState(state.clock, record.dueAt);
        if (record.dueState !== next) { record.dueState = next; changes.processes++; }
    }
    for (const record of Object.values(state.events)) {
        if (!record.dueAt || !['latent', 'scheduled', 'possibly_due', 'due'].includes(record.status)) continue;
        const next = dueState(state.clock, record.dueAt);
        if (record.status !== next) { record.status = next; changes.events++; }
    }
    const triggerEvents = evaluateTriggerEvents(state, options.eventEvaluations, {
        messageIndex: Number.isInteger(options.messageIndex) ? options.messageIndex : state.lastProcessedIndex,
        passageStartIndex: options.passageStartIndex,
        playerName: options.playerName,
        evaluationCoverageRequired: options.evaluationCoverageRequired === true,
        deliveryMaximumAttempts: options.deliveryMaximumAttempts,
        passageText: options.passageText,
    });
    changes.triggerEvents = triggerEvents.result.transitions.length;
    return { state: triggerEvents.state, changes, triggerEventResult: triggerEvents.result };
}

export function applyProgressionPatch(stateValue, payload, options = {}) {
    const state = normalizeProgressionState(stateValue);
    const patch = payload && typeof payload === 'object' ? payload : {};
    const messageIndex = Number.isInteger(options.messageIndex) ? options.messageIndex : state.lastProcessedIndex;
    const limits = {
        maximumGoals: clamp(options.maximumGoals ?? 40, 1, 200),
        maximumProcesses: clamp(options.maximumProcesses ?? 40, 1, 200),
        maximumEvents: clamp(options.maximumEvents ?? 50, 1, 200),
    };
    const timeResult = applyTimePatch(state, patch.time || patch.clock || patch.elapsed_time, messageIndex, {
        passageText: options.passageText,
        deterministicElapsed: options.deterministicElapsed,
    });
    const goalResult = mergeGoals(state, patch.goals || patch.goal_operations, messageIndex, limits);
    const processResult = mergeProcesses(state, patch.processes || patch.process_operations, messageIndex, limits);
    const eventResult = mergeEvents(
        state,
        patch.events || patch.beats || patch.event_operations,
        messageIndex,
        limits,
        options.autonomy || 'conservative',
    );
    const scheduled = runProgressionScheduler(state, {
        eventEvaluations: patch.event_evaluations || patch.trigger_event_evaluations,
        messageIndex,
        passageStartIndex: options.passageStartIndex,
        playerName: options.playerName,
        evaluationCoverageRequired: options.evaluationCoverageRequired === true,
        deliveryMaximumAttempts: options.deliveryMaximumAttempts,
        passageText: options.passageText,
    });
    state.clock = scheduled.state.clock;
    state.goals = scheduled.state.goals;
    state.processes = scheduled.state.processes;
    state.events = scheduled.state.events;
    state.eventDefinitions = scheduled.state.eventDefinitions;
    state.eventRuntime = scheduled.state.eventRuntime;
    for (const transition of scheduled.triggerEventResult.transitions) {
        appendLog(
            state,
            `trigger_event_${transition.status}`,
            { id: transition.definitionId },
            transition.messageIndex,
            `${transition.title}: ${transition.reason}`,
        );
    }
    for (const delivery of scheduled.triggerEventResult.deliveryConfirmed) {
        appendLog(state, 'trigger_event_delivery_confirmed', { id: delivery.definitionId }, delivery.messageIndex,
            `${delivery.title}: story delivery confirmed.`);
    }
    for (const delivery of scheduled.triggerEventResult.deliveryRetries) {
        appendLog(state, 'trigger_event_delivery_retry', { id: delivery.definitionId }, delivery.messageIndex,
            `${delivery.title}: delivery attempt ${delivery.attempts} was not established; retry queued.`);
    }
    for (const delivery of scheduled.triggerEventResult.deliveryFailures) {
        appendLog(state, 'trigger_event_delivery_failed', { id: delivery.definitionId }, delivery.messageIndex,
            `${delivery.title}: delivery stopped after ${delivery.attempts} attempts.`);
    }
    state.revision++;
    state.updatedAt = Date.now();
    state.lastRunAt = Date.now();
    state.lastError = '';
    state.lastRunStats = {
        timeResult,
        goalResult,
        processResult,
        eventResult,
        triggerEventResult: scheduled.triggerEventResult,
        scheduler: scheduled.changes,
    };
    return {
        state,
        timeResult,
        goalResult,
        processResult,
        eventResult,
        triggerEventResult: scheduled.triggerEventResult,
        scheduler: scheduled.changes,
    };
}

export function formatStoryDuration(seconds) {
    let remaining = Math.max(0, Math.round(numberOr(seconds)));
    if (remaining < 60) return `${remaining}s`;
    const units = [
        ['y', YEAR_SECONDS],
        ['d', 86_400],
        ['h', 3_600],
        ['m', 60],
    ];
    const parts = [];
    for (const [label, size] of units) {
        const count = Math.floor(remaining / size);
        if (count) {
            parts.push(`${count}${label}`);
            remaining -= count * size;
        }
        if (parts.length >= 2) break;
    }
    return parts.join(' ') || '0m';
}

export function formatClockRange(clockValue) {
    const clock = normalizeClock(clockValue);
    const estimate = formatStoryDuration(clock.estimatedSeconds);
    if (clock.minimumSeconds === clock.maximumSeconds) return estimate;
    return `${estimate} (range ${formatStoryDuration(clock.minimumSeconds)}–${formatStoryDuration(clock.maximumSeconds)})`;
}

function recordTopicMentioned(record, recentKey) {
    if (!recentKey) return false;
    const identityTokens = new Set(uniqueStrings([
        record.owner,
        record.subjectName,
        ...(record.subjects || []),
    ]).flatMap(value => canonicalNameKey(value).split(/\s+/u)).filter(Boolean));
    return uniqueStrings([
        record.title,
        record.nextStep,
        record.stage,
        record.trigger,
        record.actionCondition,
        record.consequences,
    ]).some(value => {
        const tokens = canonicalNameKey(value).split(/\s+/u)
            .filter(token => token.length > 3 && !identityTokens.has(token));
        return tokens.length > 0
            && tokens.filter(token => recentKey.includes(token)).length >= Math.min(2, tokens.length);
    });
}

function recordSceneRelevant(record, scene) {
    if (!scene) return false;
    const recordText = canonicalNameKey([
        record.title,
        record.owner,
        record.subjectName,
        ...(record.subjects || []),
    ].filter(Boolean).join(' '));
    if (!recordText) return false;
    const sceneReferences = [
        scene.location?.name,
        ...(scene.participants || []).map(item => item.name),
        ...(scene.objects || []).map(item => item.name),
    ].map(canonicalNameKey).filter(value => value.length > 2);
    return sceneReferences.some(reference => recordText.includes(reference) || reference.includes(recordText));
}

function progressionPriority(record, recentKey, latestKey = '', scene = null) {
    let score = numberOr(record.priority, 50);
    const state = record.status || record.deadlineState || record.dueState;
    if (state === 'due') score += 100;
    if (state === 'possibly_due') score += 70;
    if (state === 'occurred_offscreen') score += 60;
    if (state === 'observable') score += 140;
    if (state === 'revealed') score += 65;
    if (state === 'blocked') score += 35;
    if (recordTopicMentioned(record, recentKey)) score += 30;
    if (recordTopicMentioned(record, latestKey)) score += 110;
    if (recordSceneRelevant(record, scene)) score += 90;
    score += Math.min(25, numberOr(record.progress) / 4);
    return score;
}

function progressionSubjectKey(record) {
    return canonicalNameKey([
        record.owner,
        record.subjectName,
        ...(record.subjects || []),
    ].filter(Boolean).join(' '));
}

function duplicateProgressionCandidate(left, right) {
    if (left.kind === right.kind) return false;
    const leftTitle = cleanString(left.record.title || left.record.description, 1_000);
    const rightTitle = cleanString(right.record.title || right.record.description, 1_000);
    if (!leftTitle || !rightTitle || contextSimilarity(leftTitle, rightTitle) < 0.8) return false;
    const leftSubject = progressionSubjectKey(left.record);
    const rightSubject = progressionSubjectKey(right.record);
    return !leftSubject || !rightSubject || leftSubject === rightSubject
        || leftSubject.includes(rightSubject) || rightSubject.includes(leftSubject);
}

function deduplicateProgressionCandidates(candidates) {
    const result = [];
    for (const candidate of candidates) {
        if (result.some(existing => duplicateProgressionCandidate(existing, candidate))) continue;
        result.push(candidate);
    }
    return result;
}

function describeDue(record, clock) {
    if (!record.dueAt) return '';
    const remaining = record.dueAt.estimatedSeconds - clock.estimatedSeconds;
    if (remaining <= 0) return `; ${record.deadlineState || record.dueState || record.status || 'due'} now`;
    return `; expected in about ${formatStoryDuration(remaining)}`;
}

function renderGoal(record, clock) {
    return `- GOAL [${record.status}/${record.deadlineState}]: ${record.owner} — ${record.title}`
        + `${record.progress ? ` (${Math.round(record.progress)}%)` : ''}${describeDue(record, clock)}`
        + `${record.nextStep ? `; next: ${record.nextStep}` : ''}`;
}

function renderProcess(record, clock) {
    return `- PROCESS [${record.status}/${record.dueState}]: ${record.subjectName} — ${record.title}`
        + `${record.stage ? `; stage: ${record.stage}` : ''}`
        + `${record.progress ? ` (${Math.round(record.progress)}%)` : ''}${describeDue(record, clock)}`;
}

function renderEvent(record, clock) {
    const proposal = record.status === 'occurred_offscreen' ? '; UNREVEALED SIMULATION' : '';
    const agency = record.requiresPlayerAction ? '; requires player action—never auto-resolve' : '';
    return `- BEAT [${record.status}]: ${record.title}${describeDue(record, clock)}${proposal}${agency}`
        + `${record.trigger ? `; trigger: ${record.trigger}` : ''}`;
}

function renderTriggerEvent(record) {
    const label = record.origin === 'automatic_director' ? 'DIRECTOR EVENT' : 'EDITOR EVENT';
    const directive = record.status === 'observable'
        ? '; MANDATORY DELIVERY NOW—begin or concretely establish this event in the next reply through plausible present evidence; do not postpone it or invent retroactive player knowledge'
        : '; publicly revealed in completed story—maintain its causal consequences';
    return `- ${label} [${record.status}]: ${record.title}${record.description ? ` — ${record.description}` : ''}`
        + `${record.consequences ? `; consequences: ${record.consequences}` : ''}${directive}`;
}

function linkedEditorEventAllowsStoryContext(record, state) {
    const sourceKey = cleanString(record?.sourceEventKey, 180);
    if (!sourceKey) return true;
    const wanted = normalizeKey(sourceKey);
    const definition = Object.values(state.eventDefinitions || {})
        .find(item => item.key === wanted || item.id === sourceKey);
    if (!definition) return true;
    const runtime = state.eventRuntime?.[definition.id];
    if (!runtime) return false;
    if (['observable', 'revealed'].includes(runtime.status)) return true;
    if (runtime.status === 'resolved') {
        return runtime.observableAtElapsedSeconds !== null || runtime.revealedAtElapsedSeconds !== null;
    }
    return false;
}

export function compileProgressionInjection(stateValue, recentText = '', options = {}) {
    if (options.worldProgressionEnabled === false) return { text: '', selected: [], concepts: [] };
    const state = normalizeProgressionState(stateValue);
    const recentKey = canonicalTextKey(recentText);
    const latestKey = canonicalTextKey(options.latestText || options.scene?.latestText || '');
    const scene = options.scene && typeof options.scene === 'object' ? options.scene : null;
    const maximumEntries = clamp(options.progressionMaximumInjectedEntries ?? 8, 1, 30);
    const budget = clamp(options.progressionInjectionBudget ?? 5_000, 500, 30_000);
    const candidates = [];
    for (const record of listTriggerEventRecords(state)) {
        if (!record.enabled || !['observable', 'revealed'].includes(record.status)) continue;
        if (record.status === 'observable' && record.runtime.deliveryStatus === 'failed') continue;
        const latestMentioned = recordTopicMentioned(record, latestKey);
        const recentMentioned = recordTopicMentioned(record, recentKey);
        const sceneRelevant = recordSceneRelevant(record, scene);
        if (record.status === 'revealed'
            && !latestMentioned
            && !recentMentioned
            && !sceneRelevant
            && numberOr(record.priority) < 85) continue;
        candidates.push({
            kind: 'trigger_event',
            record,
            latestMentioned,
            sceneRelevant,
            score: progressionPriority(record, recentKey, latestKey, scene) + 35,
            text: renderTriggerEvent(record),
        });
    }
    for (const record of Object.values(state.events)) {
        if (!linkedEditorEventAllowsStoryContext(record, state)) continue;
        if (['revealed', 'cancelled'].includes(record.status)) continue;
        const urgent = ['due', 'possibly_due', 'occurred_offscreen'].includes(record.status);
        const latestMentioned = recordTopicMentioned(record, latestKey);
        const recentMentioned = recordTopicMentioned(record, recentKey);
        const sceneRelevant = recordSceneRelevant(record, scene);
        if (!['due', 'possibly_due', 'occurred_offscreen'].includes(record.status)
            && !recentMentioned
            && numberOr(record.priority) < 75) continue;
        if (scene && !urgent && !latestMentioned && numberOr(record.priority) < 90) continue;
        candidates.push({
            kind: 'event',
            record,
            latestMentioned,
            sceneRelevant,
            score: progressionPriority(record, recentKey, latestKey, scene) + 20,
            text: renderEvent(record, state.clock),
        });
    }
    for (const record of Object.values(state.goals)) {
        if (!linkedEditorEventAllowsStoryContext(record, state)) continue;
        if (FINAL_STATUSES.has(record.status)) continue;
        const urgent = ['due', 'possibly_due'].includes(record.deadlineState);
        const latestMentioned = recordTopicMentioned(record, latestKey);
        const recentMentioned = recordTopicMentioned(record, recentKey);
        const sceneRelevant = recordSceneRelevant(record, scene);
        if (!['due', 'possibly_due'].includes(record.deadlineState)
            && !recentMentioned
            && !sceneRelevant
            && numberOr(record.progress) < 1) continue;
        if (scene && !urgent && !latestMentioned && !sceneRelevant && numberOr(record.priority) < 90) continue;
        candidates.push({
            kind: 'goal',
            record,
            latestMentioned,
            sceneRelevant,
            score: progressionPriority(record, recentKey, latestKey, scene),
            text: renderGoal(record, state.clock),
        });
    }
    for (const record of Object.values(state.processes)) {
        if (!linkedEditorEventAllowsStoryContext(record, state)) continue;
        if (FINAL_STATUSES.has(record.status)) continue;
        const urgent = ['due', 'possibly_due'].includes(record.dueState);
        const latestMentioned = recordTopicMentioned(record, latestKey);
        const recentMentioned = recordTopicMentioned(record, recentKey);
        const sceneRelevant = recordSceneRelevant(record, scene);
        if (!['due', 'possibly_due'].includes(record.dueState)
            && !recentMentioned
            && numberOr(record.progress) < 1) continue;
        if (scene && !urgent && !latestMentioned && !sceneRelevant && numberOr(record.priority) < 90) continue;
        candidates.push({
            kind: 'process',
            record,
            latestMentioned,
            sceneRelevant,
            score: progressionPriority(record, recentKey, latestKey, scene),
            text: renderProcess(record, state.clock),
        });
    }
    candidates.sort((a, b) => b.score - a.score);
    const uniqueCandidates = deduplicateProgressionCandidates(candidates);
    const selected = [];
    const goalsPerOwner = new Map();
    const addSelected = candidate => {
        if (!candidate || selected.includes(candidate)) return false;
        if (candidate.kind === 'goal') {
            const owner = canonicalNameKey(candidate.record.owner || candidate.record.title);
            const count = goalsPerOwner.get(owner) || 0;
            // One current character can have many durable objectives, but
            // injecting all of them turns progression into a repetitive
            // checklist. Keep the two most relevant; the rest remain stored.
            if (count >= 2) return false;
            goalsPerOwner.set(owner, count + 1);
        }
        selected.push(candidate);
        return true;
    };
    if (maximumEntries >= 3) {
        for (const kind of ['event', 'goal', 'process']) {
            const candidate = uniqueCandidates.find(item => (
                (kind === 'event' ? ['trigger_event', 'event'].includes(item.kind) : item.kind === kind)
                && !selected.includes(item)
            ));
            addSelected(candidate);
        }
    }
    for (const candidate of uniqueCandidates) {
        if (selected.length >= maximumEntries) break;
        addSelected(candidate);
    }
    selected.sort((a, b) => b.score - a.score);
    const lines = selected.map(item => item.text);
    const clockLabel = state.clock.currentTimeLabel ? `; current label: ${state.clock.currentTimeLabel}` : '';
    const opening = [
        '<inner_lore_world_progression narrator_only="true">',
        'This is private continuity/director state, not dialogue and not automatically known to characters.',
        'Simulated or scheduled entries are possibilities until naturally revealed in narration. Never state them as prior public canon merely because they appear here.',
        'TRIGGER EVENT entries are trusted directives. EDITOR EVENT entries come from the user; DIRECTOR EVENT entries are validated, source-grounded proposals. Every observable trigger event is mandatory: begin or concretely establish it in the next reply through plausible present evidence, even when it interrupts routine activity. Hidden active events are intentionally omitted.',
        'Never choose, complete, or retroactively invent a player action. Ordinary automatic due beats are optional when they do not fit the current scene; that optionality never applies to an observable trigger event. Preserve character knowledge boundaries.',
        `Elapsed story time: ${formatClockRange(state.clock)}${clockLabel}.`,
    ];
    const closing = '</inner_lore_world_progression>';
    let included = [];
    for (const line of lines) {
        const candidate = [...opening, ...included, line, closing].join('\n');
        if (candidate.length > budget) break;
        included.push(line);
    }
    let body = [...opening, ...included, closing].join('\n');
    if (body.length > budget) {
        body = [
            '<inner_lore_world_progression narrator_only="true">',
            'Private continuity state; not automatic public canon. Never force player actions.',
            `Elapsed story time: ${formatClockRange(state.clock)}.`,
            closing,
        ].join('\n');
    }
    const includedSet = new Set(included);
    const selectedRecords = selected.filter(item => includedSet.has(item.text));
    return {
        text: body,
        selected: selectedRecords.map(item => ({
            kind: item.kind,
            key: item.record.key,
            title: item.record.title,
            owner: item.record.owner || item.record.subjectName || '',
            score: Math.round(item.score),
            reasons: [
                item.latestMentioned ? 'latest turn' : '',
                item.sceneRelevant ? 'current scene' : '',
                ['due', 'possibly_due', 'occurred_offscreen'].includes(
                    item.record.status || item.record.deadlineState || item.record.dueState,
                ) || item.record.status === 'observable' ? 'due/active consequence' : '',
            ].filter(Boolean),
        })),
        concepts: selectedRecords.map(item => cleanString([
            item.record.owner,
            item.record.subjectName,
            item.record.title,
            item.record.nextStep,
            item.record.stage,
            item.record.trigger,
            item.record.actionCondition,
            item.record.consequences,
        ].filter(Boolean).join(' '), 2_000)).filter(Boolean),
        characters: body.length,
    };
}

export function buildProgressionInjection(stateValue, recentText = '', options = {}) {
    return compileProgressionInjection(stateValue, recentText, options).text;
}

export function progressionAgentSnapshot(stateValue, options = {}) {
    const state = normalizeProgressionState(stateValue);
    const maximum = clamp(options.maximumRecords ?? 160, 20, 400);
    const recordScore = record => {
        const status = record.status || record.deadlineState || record.dueState;
        const urgency = status === 'due' ? 1_000_000
            : status === 'possibly_due' ? 800_000
                : status === 'occurred_offscreen' ? 600_000
                    : ['active', 'blocked', 'scheduled'].includes(status) ? 300_000 : 0;
        return urgency + (Number(record.priority) || 0) * 1_000 + (Number(record.updatedAt) || 0) / 1_000_000_000;
    };
    const compact = records => Object.values(records)
        .sort((a, b) => recordScore(b) - recordScore(a))
        .slice(0, maximum)
        .map(record => ({
            key: record.key,
            title: record.title,
            owner: record.owner,
            subject_type: record.subjectType,
            subject_name: record.subjectName,
            status: record.status,
            deadline_state: record.deadlineState,
            due_state: record.dueState,
            progress: record.progress,
            stage: record.stage,
            description: cleanString(record.description, 1_000),
            next_step: cleanString(record.nextStep, 600),
            blockers: record.blockers || [],
            requirements: record.requirements || [],
            conditions: record.conditions || [],
            trigger: cleanString(record.trigger, 600),
            subjects: record.subjects || [],
            due_at_elapsed_seconds: record.dueAt,
            requires_player_action: record.requiresPlayerAction,
            priority: record.priority,
            visibility: record.visibility,
            source_event_key: record.sourceEventKey,
        }));
    return {
        clock: state.clock,
        goals: compact(state.goals),
        processes: compact(state.processes),
        events: compact(state.events),
        trigger_events: triggerEventAgentSnapshot(state, { currentIndex: options.currentIndex }),
    };
}

export function getProgressionStats(stateValue) {
    const state = normalizeProgressionState(stateValue);
    const goals = Object.values(state.goals);
    const processes = Object.values(state.processes);
    const events = Object.values(state.events);
    const triggerEvents = getTriggerEventStats(state);
    const eventDirector = getEventDirectorStats(state);
    return {
        clock: formatClockRange(state.clock),
        goals: goals.length,
        activeGoals: goals.filter(record => ['active', 'blocked'].includes(record.status)).length,
        processes: processes.length,
        activeProcesses: processes.filter(record => ['active', 'paused'].includes(record.status)).length,
        events: events.length,
        triggerEvents,
        eventDirector,
        activeTriggerEvents: triggerEvents.active + triggerEvents.observable + triggerEvents.revealed,
        observableTriggerEvents: triggerEvents.observable,
        due: [
            ...goals.map(record => record.deadlineState),
            ...processes.map(record => record.dueState),
            ...events.map(record => record.status),
        ].filter(value => ['due', 'possibly_due'].includes(value)).length,
    };
}
