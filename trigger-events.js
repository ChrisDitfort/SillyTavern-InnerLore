/**
 * User-authored, chat-scoped triggerable events for World Progression.
 *
 * Definitions are durable editor configuration. Runtime state is derived from
 * completed story history, so a rebuild can safely rewind swipes and deletes.
 */

import { canonicalNameKey, clamp, cleanString, contextTokens, uniqueStrings } from './core.js';

export const TRIGGER_EVENT_VERSION = 3;

const MAX_SECONDS = 1_000_000 * 365 * 24 * 60 * 60;
const FINAL_STATUSES = new Set(['resolved', 'cancelled']);
const STATUSES = new Set(['armed', 'active', 'observable', 'revealed', 'resolved', 'cancelled']);
const TRIGGER_MODES = new Set(['all', 'any']);
const TIME_BASES = new Set(['after_creation', 'story_elapsed']);
const TIME_CERTAINTIES = new Set(['estimated', 'definite']);
const ACTOR_SCOPES = new Set(['any', 'player', 'npc', 'named']);
const ACTIVATION_VISIBILITIES = new Set(['hidden', 'observable']);
const ACTION_TIMINGS = new Set(['after_outcome', 'same_reply_attempt']);
const DELIVERY_STATUSES = new Set(['none', 'pending', 'injected', 'delivered', 'failed', 'cancelled']);
const DELIVERY_RECEIPT_STATUSES = new Set(['injected', 'verified', 'delivered']);
const MAX_DELIVERY_RECEIPTS = 40;
const EVALUATION_MATCH_FIELDS = ['trigger_action', 'cancellation', 'revelation', 'public_reveal', 'resolution'];

function numberOr(value, fallback = 0) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
}

function optionalSeconds(value) {
    if (value === undefined || value === null || value === '') return null;
    const number = Number(value);
    return Number.isFinite(number) ? clamp(number, 0, MAX_SECONDS) : null;
}

function normalizeKey(value, fallback = 'event') {
    return canonicalNameKey(value || fallback)
        .replace(/[^\p{L}\p{N}]+/gu, '_')
        .replace(/^_+|_+$/gu, '')
        .slice(0, 120) || 'event';
}

function definitionId(value, fallback) {
    const id = cleanString(value, 180);
    return id || `trigger:${normalizeKey(fallback)}`;
}

function optionalText(source, key, maximumLength, fallback = '') {
    return Object.hasOwn(source, key) ? cleanString(source[key], maximumLength) : fallback;
}

function normalizeProvenance(value) {
    const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    return {
        branchId: cleanString(source.branchId, 256),
        headFingerprint: cleanString(source.headFingerprint, 256),
        sourceStoreRevision: Math.max(0, numberOr(source.sourceStoreRevision)),
        sourceHash: cleanString(source.sourceHash, 128),
        sourceRefs: (Array.isArray(source.sourceRefs) ? source.sourceRefs : []).slice(0, 12).map(reference => ({
            kind: cleanString(reference?.kind, 40),
            id: cleanString(reference?.id, 512),
            name: cleanString(reference?.name, 240),
            revision: Math.max(0, numberOr(reference?.revision)),
            messageIndex: Number.isInteger(reference?.messageIndex) ? reference.messageIndex : -1,
            graphNodeId: cleanString(reference?.graphNodeId, 512),
        })).filter(reference => reference.kind && reference.id),
        generationProfileId: cleanString(source.generationProfileId, 180),
        confidence: clamp(source.confidence, 0, 1),
        lineageDepth: Math.max(0, Math.min(1, numberOr(source.lineageDepth))),
    };
}

function triggerSignature(definition) {
    return JSON.stringify({
        key: definition.key,
        enabled: definition.enabled,
        triggerMode: definition.triggerMode,
        timeBasis: definition.timeBasis,
        triggerAfterSeconds: definition.triggerAfterSeconds,
        triggerTimeCertainty: definition.triggerTimeCertainty,
        actionCondition: definition.actionCondition,
        actionTiming: definition.actionTiming,
        actorScope: definition.actorScope,
        actorName: definition.actorName,
        cancellationCondition: definition.cancellationCondition,
        activationVisibility: definition.activationVisibility,
        revealAfterSeconds: definition.revealAfterSeconds,
        revealCondition: definition.revealCondition,
        resolutionCondition: definition.resolutionCondition,
    });
}

function removeLinkedProgressionRecords(state, eventKeyValue) {
    const eventKeyText = cleanString(eventKeyValue, 180);
    if (!eventKeyText) return 0;
    const eventKey = normalizeKey(eventKeyText);
    let removed = 0;
    for (const collectionName of ['goals', 'processes', 'events']) {
        const collection = state[collectionName];
        if (!collection || typeof collection !== 'object' || Array.isArray(collection)) continue;
        for (const [id, record] of Object.entries(collection)) {
            const sourceKey = cleanString(record?.sourceEventKey, 180);
            if (!sourceKey || normalizeKey(sourceKey) !== eventKey) continue;
            delete collection[id];
            removed++;
        }
    }
    return removed;
}

function normalizeDefinition(value, options = {}) {
    const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    const existing = options.existing && typeof options.existing === 'object' ? options.existing : null;
    const title = cleanString(source.title, 240) || existing?.title || 'Untitled event';
    const id = definitionId(source.id || existing?.id || options.id, source.key || title);
    const createdClock = numberOr(options.clock?.estimatedSeconds, 0);
    const createdMessage = Number.isInteger(options.messageIndex) ? options.messageIndex : -1;
    return {
        id,
        version: TRIGGER_EVENT_VERSION,
        key: normalizeKey(source.key, existing?.key || title),
        title,
        description: optionalText(source, 'description', 3_000, existing?.description || ''),
        enabled: source.enabled === undefined ? (existing?.enabled ?? true) : Boolean(source.enabled),
        triggerMode: TRIGGER_MODES.has(source.triggerMode) ? source.triggerMode : (existing?.triggerMode || 'any'),
        timeBasis: TIME_BASES.has(source.timeBasis) ? source.timeBasis : (existing?.timeBasis || 'after_creation'),
        triggerAfterSeconds: optionalSeconds(
            source.triggerAfterSeconds === undefined ? existing?.triggerAfterSeconds : source.triggerAfterSeconds,
        ),
        triggerTimeCertainty: TIME_CERTAINTIES.has(source.triggerTimeCertainty)
            ? source.triggerTimeCertainty
            : (existing?.triggerTimeCertainty || 'estimated'),
        actionCondition: optionalText(source, 'actionCondition', 1_500, existing?.actionCondition || ''),
        actionTiming: ACTION_TIMINGS.has(source.actionTiming)
            ? source.actionTiming
            : (ACTION_TIMINGS.has(existing?.actionTiming) ? existing.actionTiming : 'after_outcome'),
        actorScope: ACTOR_SCOPES.has(source.actorScope) ? source.actorScope : (existing?.actorScope || 'any'),
        actorName: optionalText(source, 'actorName', 180, existing?.actorName || ''),
        cancellationCondition: optionalText(
            source,
            'cancellationCondition',
            1_500,
            existing?.cancellationCondition || '',
        ),
        activationVisibility: ACTIVATION_VISIBILITIES.has(source.activationVisibility)
            ? source.activationVisibility
            : (existing?.activationVisibility || 'hidden'),
        revealAfterSeconds: optionalSeconds(
            source.revealAfterSeconds === undefined ? existing?.revealAfterSeconds : source.revealAfterSeconds,
        ),
        revealCondition: optionalText(source, 'revealCondition', 1_500, existing?.revealCondition || ''),
        resolutionCondition: optionalText(source, 'resolutionCondition', 1_500, existing?.resolutionCondition || ''),
        consequences: optionalText(source, 'consequences', 4_000, existing?.consequences || ''),
        subjects: uniqueStrings(source.subjects === undefined ? (existing?.subjects || []) : source.subjects, 30),
        priority: clamp(source.priority ?? existing?.priority ?? 70, 0, 100),
        origin: (source.origin ?? existing?.origin) === 'automatic_director'
            ? 'automatic_director'
            : 'user_authored',
        proposalId: cleanString(source.proposalId ?? existing?.proposalId, 180),
        expiresAtMessage: Number.isInteger(source.expiresAtMessage)
            ? source.expiresAtMessage
            : (Number.isInteger(existing?.expiresAtMessage) ? existing.expiresAtMessage : -1),
        provenance: normalizeProvenance(source.provenance ?? existing?.provenance),
        createdAtElapsedSeconds: Math.max(0, numberOr(
            source.createdAtElapsedSeconds,
            existing?.createdAtElapsedSeconds ?? createdClock,
        )),
        createdAtMessage: Number.isInteger(source.createdAtMessage)
            ? source.createdAtMessage
            : (Number.isInteger(existing?.createdAtMessage) ? existing.createdAtMessage : createdMessage),
        createdAt: Math.max(0, numberOr(source.createdAt, existing?.createdAt || Date.now())),
        updatedAt: Math.max(0, numberOr(source.updatedAt, Date.now())),
        revision: Math.max(1, numberOr(source.revision, existing?.revision || 1)),
    };
}

function createRuntime(definition, options = {}) {
    return {
        definitionId: definition.id,
        definitionRevision: definition.revision,
        status: 'armed',
        armedAtElapsedSeconds: Math.max(0, numberOr(
            options.clock?.estimatedSeconds,
            definition.createdAtElapsedSeconds,
        )),
        armedAtMessage: Number.isInteger(options.messageIndex)
            ? options.messageIndex
            : definition.createdAtMessage,
        creationAnchorPending: Boolean(
            options.replayCreationAnchor
            && definition.timeBasis === 'after_creation'
            && definition.triggerAfterSeconds !== null
            && definition.createdAtMessage >= 0
        ),
        actionMatched: false,
        actionMatchedAtMessage: -1,
        actionActor: '',
        timeMatchedAtMessage: -1,
        conditionSatisfiedAtMessage: -1,
        stateTransitionRecordedAtMessage: -1,
        triggeredAtElapsedSeconds: null,
        triggeredAtMessage: -1,
        observableAtElapsedSeconds: null,
        observableAtMessage: -1,
        revealedAtElapsedSeconds: null,
        revealedAtMessage: -1,
        resolvedAtElapsedSeconds: null,
        resolvedAtMessage: -1,
        cancelledAtElapsedSeconds: null,
        cancelledAtMessage: -1,
        triggerEvidence: [],
        revealEvidence: [],
        resolutionEvidence: [],
        cancellationEvidence: [],
        lastEvaluatedMessage: -1,
        lastEvaluation: null,
        activationCount: 0,
        deliveryStatus: 'none',
        deliveryId: '',
        deliveryAttempts: 0,
        deliveryQueuedAtMessage: -1,
        deliveryFirstInjectedAtMessage: -1,
        deliveryLastInjectedAtMessage: -1,
        deliveryLastInjectedAt: 0,
        deliveryLastGenerationId: '',
        deliveryLastVerifiedAtMessage: -1,
        deliveryLastVerifiedGenerationId: '',
        deliveryDeliveredAtMessage: -1,
        deliveryEvidence: [],
        deliveryInjectionReceipts: [],
        deliveryFailureReason: '',
        attemptPreviewCount: 0,
        attemptPreviewLastMessage: -1,
        attemptPreviewLastGenerationId: '',
        updatedAt: Date.now(),
    };
}

function normalizeDeliveryReceipt(value) {
    const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    const generationId = cleanString(source.generationId, 240);
    const messageIndex = Number.isInteger(source.messageIndex) ? source.messageIndex : -1;
    if (!generationId || messageIndex < -1) return null;
    return {
        generationId,
        messageIndex,
        injectedAt: Math.max(0, numberOr(source.injectedAt)),
        verifiedAtMessage: Number.isInteger(source.verifiedAtMessage) ? source.verifiedAtMessage : -1,
        status: DELIVERY_RECEIPT_STATUSES.has(source.status) ? source.status : 'injected',
    };
}

function normalizeRuntime(value, definition) {
    const base = createRuntime(definition);
    const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    const runtime = { ...base, ...source };
    runtime.definitionId = definition.id;
    runtime.definitionRevision = Math.max(1, numberOr(source.definitionRevision, definition.revision));
    runtime.status = STATUSES.has(source.status) ? source.status : 'armed';
    runtime.creationAnchorPending = Boolean(source.creationAnchorPending);
    runtime.actionMatched = Boolean(source.actionMatched);
    runtime.actionMatchedAtMessage = Number.isInteger(source.actionMatchedAtMessage)
        ? source.actionMatchedAtMessage
        : -1;
    runtime.actionActor = cleanString(source.actionActor, 180);
    runtime.timeMatchedAtMessage = Number.isInteger(source.timeMatchedAtMessage)
        ? source.timeMatchedAtMessage
        : -1;
    runtime.conditionSatisfiedAtMessage = Number.isInteger(source.conditionSatisfiedAtMessage)
        ? source.conditionSatisfiedAtMessage
        : -1;
    runtime.stateTransitionRecordedAtMessage = Number.isInteger(source.stateTransitionRecordedAtMessage)
        ? source.stateTransitionRecordedAtMessage
        : -1;
    runtime.triggerEvidence = uniqueStrings(source.triggerEvidence || [], 20);
    runtime.revealEvidence = uniqueStrings(source.revealEvidence || [], 20);
    runtime.resolutionEvidence = uniqueStrings(source.resolutionEvidence || [], 20);
    runtime.cancellationEvidence = uniqueStrings(source.cancellationEvidence || [], 20);
    runtime.activationCount = Math.max(0, numberOr(source.activationCount));
    runtime.deliveryStatus = DELIVERY_STATUSES.has(source.deliveryStatus) ? source.deliveryStatus : 'none';
    if (runtime.status === 'observable' && runtime.deliveryStatus === 'none') runtime.deliveryStatus = 'pending';
    if (runtime.status === 'revealed' && runtime.deliveryStatus === 'none') runtime.deliveryStatus = 'delivered';
    if (runtime.status === 'cancelled') runtime.deliveryStatus = 'cancelled';
    runtime.deliveryId = cleanString(source.deliveryId, 240);
    runtime.deliveryAttempts = Math.max(0, numberOr(source.deliveryAttempts));
    runtime.deliveryQueuedAtMessage = Number.isInteger(source.deliveryQueuedAtMessage)
        ? source.deliveryQueuedAtMessage
        : -1;
    runtime.deliveryInjectionReceipts = (Array.isArray(source.deliveryInjectionReceipts)
        ? source.deliveryInjectionReceipts
        : [])
        .map(normalizeDeliveryReceipt)
        .filter(Boolean)
        .filter((receipt, index, receipts) => receipts.findIndex(item => item.generationId === receipt.generationId) === index)
        .slice(-MAX_DELIVERY_RECEIPTS);
    runtime.deliveryLastInjectedAtMessage = Number.isInteger(source.deliveryLastInjectedAtMessage)
        ? source.deliveryLastInjectedAtMessage
        : -1;
    runtime.deliveryLastInjectedAt = Math.max(0, numberOr(source.deliveryLastInjectedAt));
    runtime.deliveryLastGenerationId = cleanString(source.deliveryLastGenerationId, 240);
    // Migrate an in-flight pre-receipt delivery without losing its immutable
    // verification boundary.
    if (!runtime.deliveryInjectionReceipts.length
        && runtime.deliveryLastGenerationId
        && runtime.deliveryLastInjectedAtMessage >= 0) {
        runtime.deliveryInjectionReceipts.push({
            generationId: runtime.deliveryLastGenerationId,
            messageIndex: runtime.deliveryLastInjectedAtMessage,
            injectedAt: runtime.deliveryLastInjectedAt,
            verifiedAtMessage: Number.isInteger(source.deliveryLastVerifiedAtMessage)
                && source.deliveryLastVerifiedGenerationId === runtime.deliveryLastGenerationId
                ? source.deliveryLastVerifiedAtMessage
                : -1,
            status: source.deliveryLastVerifiedGenerationId === runtime.deliveryLastGenerationId
                ? (runtime.deliveryStatus === 'delivered' ? 'delivered' : 'verified')
                : 'injected',
        });
    }
    runtime.deliveryFirstInjectedAtMessage = Number.isInteger(source.deliveryFirstInjectedAtMessage)
        ? source.deliveryFirstInjectedAtMessage
        : (runtime.deliveryInjectionReceipts.length
            ? Math.min(...runtime.deliveryInjectionReceipts.map(receipt => receipt.messageIndex))
            : -1);
    runtime.deliveryLastVerifiedAtMessage = Number.isInteger(source.deliveryLastVerifiedAtMessage)
        ? source.deliveryLastVerifiedAtMessage
        : -1;
    runtime.deliveryLastVerifiedGenerationId = cleanString(source.deliveryLastVerifiedGenerationId, 240);
    runtime.deliveryDeliveredAtMessage = Number.isInteger(source.deliveryDeliveredAtMessage)
        ? source.deliveryDeliveredAtMessage
        : -1;
    runtime.deliveryEvidence = uniqueStrings(source.deliveryEvidence || [], 20);
    runtime.deliveryFailureReason = cleanString(source.deliveryFailureReason, 1_000);
    runtime.attemptPreviewCount = Math.max(0, numberOr(source.attemptPreviewCount));
    runtime.attemptPreviewLastMessage = Number.isInteger(source.attemptPreviewLastMessage)
        ? source.attemptPreviewLastMessage
        : -1;
    runtime.attemptPreviewLastGenerationId = cleanString(source.attemptPreviewLastGenerationId, 240);
    runtime.lastEvaluation = source.lastEvaluation && typeof source.lastEvaluation === 'object'
        ? {
            messageIndex: Number.isInteger(source.lastEvaluation.messageIndex)
                ? source.lastEvaluation.messageIndex
                : -1,
            passageStartIndex: Number.isInteger(source.lastEvaluation.passageStartIndex)
                ? source.lastEvaluation.passageStartIndex
                : -1,
            acknowledged: source.lastEvaluation.acknowledged === true,
            matched: uniqueStrings(source.lastEvaluation.matched || [], 8),
            accepted: uniqueStrings(source.lastEvaluation.accepted || [], 8)
                .filter(field => EVALUATION_MATCH_FIELDS.includes(field)),
            reason: cleanString(source.lastEvaluation.reason, 1_000),
            evidence: uniqueStrings(source.lastEvaluation.evidence || [], 20),
            actor: cleanString(source.lastEvaluation.actor, 180),
            conditions: Object.fromEntries(EVALUATION_MATCH_FIELDS.flatMap(field => {
                const condition = source.lastEvaluation.conditions?.[field];
                if (!condition || typeof condition !== 'object' || condition.matched !== true) return [];
                return [[field, {
                    matched: true,
                    actor: cleanString(condition.actor, 180),
                    evidence: uniqueStrings(condition.evidence || [], 20),
                    messageIndexes: (Array.isArray(condition.messageIndexes)
                        ? condition.messageIndexes
                        : (Array.isArray(condition.message_indexes) ? condition.message_indexes : []))
                        .map(Number)
                        .filter(Number.isInteger)
                        .slice(0, 40),
                }]];
            })),
            evaluatedAt: Math.max(0, numberOr(source.lastEvaluation.evaluatedAt)),
        }
        : null;
    return runtime;
}

export function normalizeTriggerEventCollections(definitionsValue, runtimeValue) {
    const definitionsSource = definitionsValue && typeof definitionsValue === 'object' && !Array.isArray(definitionsValue)
        ? definitionsValue
        : {};
    const runtimeSource = runtimeValue && typeof runtimeValue === 'object' && !Array.isArray(runtimeValue)
        ? runtimeValue
        : {};
    const definitions = {};
    const runtime = {};
    for (const [id, raw] of Object.entries(definitionsSource)) {
        const definition = normalizeDefinition(raw, { id });
        definitions[definition.id] = definition;
        runtime[definition.id] = normalizeRuntime(runtimeSource[definition.id], definition);
    }
    return { definitions, runtime };
}

export function upsertTriggerEventDefinition(stateValue, input, options = {}) {
    const state = stateValue && typeof stateValue === 'object' ? stateValue : {};
    const collections = normalizeTriggerEventCollections(state.eventDefinitions, state.eventRuntime);
    state.eventDefinitions = collections.definitions;
    state.eventRuntime = collections.runtime;
    const requestedId = cleanString(input?.id, 180);
    const requestedKey = normalizeKey(input?.key, input?.title);
    const existing = (requestedId && state.eventDefinitions[requestedId])
        || Object.values(state.eventDefinitions).find(item => item.key === requestedKey)
        || null;
    const definition = normalizeDefinition(input, {
        id: requestedId || existing?.id,
        existing,
        clock: options.clock || state.clock,
        messageIndex: options.messageIndex,
    });
    if (definition.enabled && definition.triggerAfterSeconds === null && !definition.actionCondition) {
        throw new Error('Before arming this event, enter a Time trigger amount, an Action trigger, or both. Its name is not interpreted as a trigger.');
    }
    if (definition.actorScope === 'named' && definition.actionCondition && !definition.actorName) {
        throw new Error('Enter the named actor for this action trigger.');
    }
    if (definition.enabled && definition.actionTiming === 'same_reply_attempt') {
        if (!definition.actionCondition) {
            throw new Error('Same-reply action timing requires an Action trigger.');
        }
        if (definition.activationVisibility !== 'observable') {
            throw new Error('Same-reply action timing requires “Allow the narrator to show it immediately”.');
        }
        if (definition.actorScope === 'npc') {
            throw new Error('Same-reply action timing can react only to the newest player turn; use after-outcome timing for NPC actions.');
        }
        if (definition.actorScope === 'named'
            && options.playerName
            && canonicalNameKey(definition.actorName) !== canonicalNameKey(options.playerName)) {
            throw new Error('For same-reply timing, the named actor must be the current player character.');
        }
    }
    const duplicate = Object.values(state.eventDefinitions)
        .find(item => item.id !== definition.id && item.key === definition.key);
    if (duplicate) throw new Error(`Another triggerable event already uses the key “${definition.key}”.`);

    const shouldRearm = options.rearm === true
        || !existing
        || triggerSignature(existing) !== triggerSignature(definition);
    const derivedRemoved = shouldRearm && existing
        ? removeLinkedProgressionRecords(state, existing.key)
        : 0;
    if (shouldRearm && existing) {
        definition.createdAtElapsedSeconds = Math.max(0, numberOr(
            options.clock?.estimatedSeconds,
            definition.createdAtElapsedSeconds,
        ));
        if (Number.isInteger(options.messageIndex)) definition.createdAtMessage = options.messageIndex;
    }
    definition.revision = Math.max(1, numberOr(existing?.revision, 0) + 1);
    definition.updatedAt = Date.now();
    state.eventDefinitions[definition.id] = definition;
    const progressionWatermark = Number.isInteger(state.lastProcessedIndex) ? state.lastProcessedIndex : -1;
    const creationClockPending = definition.timeBasis === 'after_creation'
        && definition.triggerAfterSeconds !== null
        && definition.createdAtMessage > progressionWatermark;
    state.eventRuntime[definition.id] = shouldRearm
        ? createRuntime(definition, {
            clock: options.clock || state.clock,
            messageIndex: options.messageIndex,
            replayCreationAnchor: creationClockPending,
        })
        : normalizeRuntime(state.eventRuntime[definition.id], definition);
    state.eventRuntime[definition.id].definitionRevision = definition.revision;
    state.updatedAt = Date.now();
    return { state, definition, runtime: state.eventRuntime[definition.id], rearmed: shouldRearm, derivedRemoved };
}

export function removeTriggerEventDefinition(stateValue, definitionIdValue) {
    const state = stateValue && typeof stateValue === 'object' ? stateValue : {};
    const collections = normalizeTriggerEventCollections(state.eventDefinitions, state.eventRuntime);
    state.eventDefinitions = collections.definitions;
    state.eventRuntime = collections.runtime;
    const definitionId = cleanString(definitionIdValue, 180);
    const removed = state.eventDefinitions[definitionId] || null;
    const derivedRemoved = removed ? removeLinkedProgressionRecords(state, removed.key) : 0;
    delete state.eventDefinitions[definitionId];
    delete state.eventRuntime[definitionId];
    state.updatedAt = Date.now();
    return { state, removed, derivedRemoved };
}

export function rearmTriggerEvent(stateValue, definitionIdValue, options = {}) {
    const state = stateValue && typeof stateValue === 'object' ? stateValue : {};
    const collections = normalizeTriggerEventCollections(state.eventDefinitions, state.eventRuntime);
    state.eventDefinitions = collections.definitions;
    state.eventRuntime = collections.runtime;
    const definition = state.eventDefinitions[cleanString(definitionIdValue, 180)];
    if (!definition) throw new Error('Select a triggerable event first.');
    const derivedRemoved = removeLinkedProgressionRecords(state, definition.key);
    if (options.resetCreationAnchor === true) {
        definition.createdAtElapsedSeconds = Math.max(0, numberOr(options.clock?.estimatedSeconds, state.clock?.estimatedSeconds));
        definition.createdAtMessage = Number.isInteger(options.messageIndex) ? options.messageIndex : definition.createdAtMessage;
        definition.revision++;
        definition.updatedAt = Date.now();
    }
    const progressionWatermark = Number.isInteger(state.lastProcessedIndex) ? state.lastProcessedIndex : -1;
    state.eventRuntime[definition.id] = createRuntime(definition, {
        clock: options.clock || state.clock,
        messageIndex: options.messageIndex,
        replayCreationAnchor: definition.timeBasis === 'after_creation'
            && definition.triggerAfterSeconds !== null
            && definition.createdAtMessage > progressionWatermark,
    });
    state.updatedAt = Date.now();
    return { state, definition, runtime: state.eventRuntime[definition.id], derivedRemoved };
}

export function resetTriggerEventRuntime(stateValue, options = {}) {
    const state = stateValue && typeof stateValue === 'object' ? stateValue : {};
    const collections = normalizeTriggerEventCollections(state.eventDefinitions, {});
    state.eventDefinitions = collections.definitions;
    state.eventRuntime = Object.fromEntries(Object.values(state.eventDefinitions).map(definition => [
        definition.id,
        createRuntime(definition, {
            replayCreationAnchor: options.replayCreationAnchors === true,
        }),
    ]));
    state.updatedAt = Date.now();
    return state;
}

function elapsedThreshold(definition) {
    if (definition.triggerAfterSeconds === null) return null;
    return definition.timeBasis === 'story_elapsed'
        ? definition.triggerAfterSeconds
        : definition.createdAtElapsedSeconds + definition.triggerAfterSeconds;
}

function clockReached(clock, threshold, certainty) {
    if (threshold === null) return false;
    const elapsed = certainty === 'definite'
        ? numberOr(clock?.minimumSeconds)
        : numberOr(clock?.estimatedSeconds);
    return elapsed >= threshold;
}

function actorMatches(definition, actorValue, playerName) {
    const actor = canonicalNameKey(actorValue);
    const player = canonicalNameKey(playerName);
    if (!actor) return false;
    if (definition.actorScope === 'any') return true;
    if (definition.actorScope === 'player') return Boolean(player && actor === player);
    if (definition.actorScope === 'npc') return !player || actor !== player;
    const named = canonicalNameKey(definition.actorName);
    // The model sees actor_name verbatim and must return that actual actor.
    // Exact canonical matching prevents short names such as "Al" from
    // accidentally matching a different character such as "Aldric".
    return Boolean(named && actor === named);
}

function readMatch(evaluation, key, definition, options = {}) {
    const value = evaluation?.[key];
    if (!value || typeof value !== 'object' || value.matched !== true) return null;
    const evidence = uniqueStrings(value.evidence || [], 12);
    const indexes = (Array.isArray(value.message_indexes) ? value.message_indexes : [])
        .map(Number)
        .filter(Number.isInteger);
    const start = Math.max(
        definition.createdAtMessage + 1,
        Number.isInteger(options.passageStartIndex) ? options.passageStartIndex : definition.createdAtMessage + 1,
    );
    const end = Number.isInteger(options.messageIndex) ? options.messageIndex : Number.MAX_SAFE_INTEGER;
    const validIndexes = indexes.filter(index => index >= start && index <= end);
    if (!evidence.length || !validIndexes.length) return null;
    const actor = cleanString(value.actor, 180);
    if (key === 'trigger_action' && !actorMatches(definition, actor, options.playerName)) return null;
    return { evidence, indexes: validIndexes, actor };
}

function nextDeliveryId(runtime) {
    return `delivery:${normalizeKey(runtime.definitionId)}:${Math.max(1, runtime.definitionRevision)}:${Math.max(1, runtime.activationCount)}`;
}

function queueDelivery(runtime, messageIndex) {
    if (runtime.deliveryStatus === 'injected' && runtime.deliveryId) return;
    if (!runtime.deliveryId || ['delivered', 'failed', 'cancelled'].includes(runtime.deliveryStatus)) {
        runtime.deliveryId = nextDeliveryId(runtime);
        runtime.deliveryAttempts = 0;
        runtime.deliveryFirstInjectedAtMessage = -1;
        runtime.deliveryLastInjectedAtMessage = -1;
        runtime.deliveryLastInjectedAt = 0;
        runtime.deliveryLastGenerationId = '';
        runtime.deliveryLastVerifiedAtMessage = -1;
        runtime.deliveryLastVerifiedGenerationId = '';
        runtime.deliveryDeliveredAtMessage = -1;
        runtime.deliveryEvidence = [];
        runtime.deliveryInjectionReceipts = [];
    }
    runtime.deliveryStatus = 'pending';
    if (runtime.deliveryQueuedAtMessage < 0) runtime.deliveryQueuedAtMessage = messageIndex;
    runtime.deliveryFailureReason = '';
}

function unverifiedDeliveryReceipts(runtime, maximumMessageIndex = Number.MAX_SAFE_INTEGER) {
    return (Array.isArray(runtime.deliveryInjectionReceipts) ? runtime.deliveryInjectionReceipts : [])
        .filter(receipt => receipt.status === 'injected'
            && receipt.verifiedAtMessage < 0
            && receipt.messageIndex <= maximumMessageIndex)
        .sort((a, b) => a.messageIndex - b.messageIndex || a.injectedAt - b.injectedAt);
}

function markDeliveryReceiptsVerified(runtime, messageIndex, delivered = false) {
    const receipts = unverifiedDeliveryReceipts(runtime, messageIndex);
    for (const receipt of receipts) {
        receipt.verifiedAtMessage = messageIndex;
        receipt.status = delivered ? 'delivered' : 'verified';
    }
    if (receipts.length) {
        const latest = receipts.at(-1);
        runtime.deliveryLastVerifiedAtMessage = messageIndex;
        runtime.deliveryLastVerifiedGenerationId = latest.generationId;
    }
    return receipts;
}

function completeDelivery(runtime, messageIndex, evidence = []) {
    if (!runtime.deliveryId) runtime.deliveryId = nextDeliveryId(runtime);
    runtime.deliveryStatus = 'delivered';
    runtime.deliveryDeliveredAtMessage = messageIndex;
    markDeliveryReceiptsVerified(runtime, messageIndex, true);
    runtime.deliveryLastVerifiedAtMessage = Math.max(runtime.deliveryLastVerifiedAtMessage, messageIndex);
    if (!runtime.deliveryLastVerifiedGenerationId) {
        runtime.deliveryLastVerifiedGenerationId = runtime.deliveryLastGenerationId;
    }
    runtime.deliveryEvidence = uniqueStrings([...runtime.deliveryEvidence, ...evidence], 20);
    runtime.deliveryFailureReason = '';
}

function completedStoryText(passageTextValue, minimumMessageIndex = -1) {
    const passageText = cleanString(passageTextValue, 200_000);
    if (!passageText) return '';
    const blocks = [];
    const pattern = /\[message\s+(\d+);\s*([^\]]+)\]\n([\s\S]*?)(?=\n+\[message\s+\d+;|$)/gu;
    for (const match of passageText.matchAll(pattern)) {
        const messageIndex = Number(match[1]);
        if (messageIndex < minimumMessageIndex || !/^STORY\b/iu.test(cleanString(match[2], 160))) continue;
        blocks.push(cleanString(match[3], 30_000));
    }
    return blocks.join('\n');
}

function localDeliveryEvidence(definition, passageTextValue, minimumMessageIndex) {
    const storyText = completedStoryText(passageTextValue, minimumMessageIndex);
    if (!storyText) return [];
    const normalizeCompounds = value => String(value || '').replace(/[-_]/gu, ' ');
    const signatureTokens = contextTokens(normalizeCompounds(`${definition.title} ${definition.description}`), 80);
    if (signatureTokens.length < 4) return [];
    const storyTokens = new Set(contextTokens(normalizeCompounds(storyText), 500));
    const matched = signatureTokens.filter(token => storyTokens.has(token));
    const required = Math.min(signatureTokens.length, Math.max(3, Math.ceil(signatureTokens.length * 0.5)));
    if (matched.length < required) return [];
    return [`Completed story locally matched ${matched.length}/${signatureTokens.length} distinctive delivery terms (${matched.slice(0, 8).join(', ')}).`];
}

/**
 * Confirm an injected event directly from the completed foreground reply.
 * This intentionally confirms only positive local matches: a semantic
 * progression pass remains responsible for deciding that a delivery missed.
 */
export function verifyTriggerEventDeliveriesFromStory(stateValue, storyTextValue, options = {}) {
    const state = stateValue && typeof stateValue === 'object' ? stateValue : {};
    const collections = normalizeTriggerEventCollections(state.eventDefinitions, state.eventRuntime);
    state.eventDefinitions = collections.definitions;
    state.eventRuntime = collections.runtime;
    const messageIndex = Number.isInteger(options.messageIndex) ? options.messageIndex : -1;
    const storyText = cleanString(storyTextValue, 100_000);
    const passageText = storyText ? `[message ${messageIndex}; STORY — Narrator]\n${storyText}` : '';
    const confirmed = [];
    const transitions = [];

    for (const definition of Object.values(state.eventDefinitions)) {
        const runtime = state.eventRuntime[definition.id];
        const receipts = runtime.deliveryStatus === 'injected'
            ? unverifiedDeliveryReceipts(runtime, messageIndex)
            : [];
        if (runtime.status !== 'observable' || !receipts.length) continue;
        const evidence = localDeliveryEvidence(definition, passageText, receipts[0].messageIndex);
        if (!evidence.length) continue;
        const eventTransitions = [];
        setTransition(
            runtime,
            'revealed',
            state.clock,
            messageIndex,
            evidence,
            eventTransitions,
            'completed foreground reply locally matched the injected event',
        );
        confirmed.push({
            definitionId: definition.id,
            title: definition.title,
            messageIndex,
            generationIds: receipts.map(receipt => receipt.generationId),
            evidence,
        });
        transitions.push(...eventTransitions.map(item => ({
            ...item,
            definitionId: definition.id,
            title: definition.title,
        })));
    }

    const changed = confirmed.length > 0;
    if (changed) state.updatedAt = Date.now();
    return { state, changed, confirmed, transitions };
}

/** Record the exact event block that reached a foreground story generation. */
export function markTriggerEventDeliveriesInjected(stateValue, deliveriesValue, options = {}) {
    const state = stateValue && typeof stateValue === 'object' ? stateValue : {};
    const collections = normalizeTriggerEventCollections(state.eventDefinitions, state.eventRuntime);
    state.eventDefinitions = collections.definitions;
    state.eventRuntime = collections.runtime;
    const deliveries = Array.isArray(deliveriesValue) ? deliveriesValue : [];
    const messageIndex = Number.isInteger(options.messageIndex) ? options.messageIndex : -1;
    const generationId = cleanString(options.generationId, 240) || `generation:${messageIndex}:${Date.now()}`;
    const recorded = [];
    let changed = false;

    for (const item of deliveries) {
        const definitionId = cleanString(item?.definitionId || item?.id, 180);
        const kind = cleanString(item?.kind, 80) || 'observable';
        const definition = state.eventDefinitions[definitionId];
        const runtime = state.eventRuntime[definitionId];
        if (!definition || !runtime || !definition.enabled) continue;

        if (kind === 'attempt_preview') {
            if (runtime.attemptPreviewLastGenerationId !== generationId) {
                runtime.attemptPreviewCount++;
                runtime.attemptPreviewLastMessage = messageIndex;
                runtime.attemptPreviewLastGenerationId = generationId;
                runtime.updatedAt = Date.now();
                changed = true;
            }
        } else {
            if (runtime.status !== 'observable' && kind !== 'time_preview') continue;
            queueDelivery(runtime, messageIndex);
            const existingReceipt = runtime.deliveryInjectionReceipts
                .find(receipt => receipt.generationId === generationId);
            const otherInjectionAwaitingVerification = unverifiedDeliveryReceipts(runtime)
                .some(receipt => receipt.generationId !== generationId);
            // A later generation cannot move an earlier generation's
            // verification watermark. The event is retried only after that
            // completed reply has been explicitly verified as a miss.
            if (!existingReceipt && otherInjectionAwaitingVerification) continue;
            if (!existingReceipt) {
                const injectedAt = Date.now();
                runtime.deliveryInjectionReceipts.push({
                    generationId,
                    messageIndex,
                    injectedAt,
                    verifiedAtMessage: -1,
                    status: 'injected',
                });
                runtime.deliveryInjectionReceipts = runtime.deliveryInjectionReceipts.slice(-MAX_DELIVERY_RECEIPTS);
                runtime.deliveryStatus = 'injected';
                if (runtime.deliveryFirstInjectedAtMessage < 0) runtime.deliveryFirstInjectedAtMessage = messageIndex;
                runtime.deliveryLastInjectedAtMessage = messageIndex;
                runtime.deliveryLastInjectedAt = injectedAt;
                runtime.deliveryLastGenerationId = generationId;
                runtime.deliveryFailureReason = '';
                runtime.updatedAt = Date.now();
                changed = true;
            }
        }
        recorded.push({ definitionId, key: definition.key, title: definition.title, kind });
    }

    if (recorded.length) {
        state.lastTriggerDeliveryPrompt = {
            generationId,
            messageIndex,
            prompt: cleanString(options.prompt, 30_000),
            records: recorded,
            createdAt: Date.now(),
        };
        state.updatedAt = Date.now();
        changed = true;
    }
    return { state, changed, recorded };
}

export function retryTriggerEventDelivery(stateValue, definitionIdValue) {
    const state = stateValue && typeof stateValue === 'object' ? stateValue : {};
    const collections = normalizeTriggerEventCollections(state.eventDefinitions, state.eventRuntime);
    state.eventDefinitions = collections.definitions;
    state.eventRuntime = collections.runtime;
    const definitionId = cleanString(definitionIdValue, 180);
    const definition = state.eventDefinitions[definitionId];
    const runtime = state.eventRuntime[definitionId];
    if (!definition || !runtime) throw new Error('Select a triggerable event first.');
    if (runtime.status !== 'observable') throw new Error('Only an observable event can be retried for story delivery.');
    runtime.deliveryStatus = 'pending';
    runtime.deliveryAttempts = 0;
    runtime.deliveryLastGenerationId = '';
    runtime.deliveryFailureReason = '';
    runtime.updatedAt = Date.now();
    state.updatedAt = Date.now();
    return { state, definition, runtime };
}

export function hasTriggerEventDeliveryAwaitingVerification(stateValue, messageIndexValue) {
    const messageIndex = Number.isInteger(messageIndexValue) ? messageIndexValue : Number.MAX_SAFE_INTEGER;
    return listTriggerEventRecords(stateValue).some(record => (
        record.runtime.deliveryStatus === 'injected'
        && unverifiedDeliveryReceipts(record.runtime, messageIndex).length > 0
    ));
}

function setTransition(runtime, status, clock, messageIndex, evidence, transitions, reason) {
    if (runtime.status === status) return;
    const previous = runtime.status;
    runtime.status = status;
    runtime.stateTransitionRecordedAtMessage = messageIndex;
    runtime.updatedAt = Date.now();
    if (status === 'active' || status === 'observable') {
        if (runtime.triggeredAtElapsedSeconds === null) {
            runtime.triggeredAtElapsedSeconds = numberOr(clock?.estimatedSeconds);
            runtime.triggeredAtMessage = messageIndex;
            runtime.activationCount++;
        }
        if (status === 'observable') {
            runtime.observableAtElapsedSeconds = numberOr(clock?.estimatedSeconds);
            runtime.observableAtMessage = messageIndex;
            queueDelivery(runtime, messageIndex);
        }
    } else if (status === 'revealed') {
        runtime.revealedAtElapsedSeconds = numberOr(clock?.estimatedSeconds);
        runtime.revealedAtMessage = messageIndex;
        runtime.revealEvidence = uniqueStrings([...runtime.revealEvidence, ...(evidence || [])], 20);
        completeDelivery(runtime, messageIndex, evidence);
    } else if (status === 'resolved') {
        runtime.resolvedAtElapsedSeconds = numberOr(clock?.estimatedSeconds);
        runtime.resolvedAtMessage = messageIndex;
    } else if (status === 'cancelled') {
        runtime.cancelledAtElapsedSeconds = numberOr(clock?.estimatedSeconds);
        runtime.cancelledAtMessage = messageIndex;
        runtime.deliveryStatus = 'cancelled';
        runtime.deliveryFailureReason = '';
    }
    transitions.push({
        previous,
        status,
        messageIndex,
        conditionSatisfiedAtMessage: runtime.conditionSatisfiedAtMessage,
        stateTransitionRecordedAtMessage: messageIndex,
        evidence: uniqueStrings(evidence || [], 12),
        reason,
    });
}

export function evaluateTriggerEvents(stateValue, evaluationsValue, options = {}) {
    const state = stateValue && typeof stateValue === 'object' ? stateValue : {};
    const collections = normalizeTriggerEventCollections(state.eventDefinitions, state.eventRuntime);
    state.eventDefinitions = collections.definitions;
    state.eventRuntime = collections.runtime;
    const evaluations = Array.isArray(evaluationsValue) ? evaluationsValue : [];
    const byKey = new Map();
    for (const evaluation of evaluations) {
        if (!evaluation || typeof evaluation !== 'object') continue;
        const key = cleanString(evaluation.key || evaluation.id, 180);
        if (key) byKey.set(key, evaluation);
    }
    const messageIndex = Number.isInteger(options.messageIndex) ? options.messageIndex : -1;
    const result = {
        armed: 0,
        activated: 0,
        observable: 0,
        revealed: 0,
        resolved: 0,
        cancelled: 0,
        transitions: [],
        deliveryConfirmed: [],
        deliveryRetries: [],
        deliveryFailures: [],
    };

    for (const definition of Object.values(state.eventDefinitions)) {
        const runtime = state.eventRuntime[definition.id];
        const transitions = [];
        const evaluation = byKey.get(definition.id) || byKey.get(definition.key) || null;
        const awaitingReceipts = runtime.deliveryStatus === 'injected'
            ? unverifiedDeliveryReceipts(runtime, messageIndex)
            : [];
        const awaitingDelivery = awaitingReceipts.length > 0;
        const deliveryVerificationBoundary = awaitingDelivery
            ? awaitingReceipts[0].messageIndex
            : -1;
        if (evaluation) {
            runtime.lastEvaluatedMessage = messageIndex;
            const matched = EVALUATION_MATCH_FIELDS
                .filter(key => evaluation[key]?.matched === true);
            const evidence = matched.flatMap(key => Array.isArray(evaluation[key]?.evidence)
                ? evaluation[key].evidence
                : []);
            const conditions = Object.fromEntries(matched.map(field => [field, {
                matched: true,
                actor: cleanString(evaluation[field]?.actor, 180),
                evidence: uniqueStrings(evaluation[field]?.evidence || [], 20),
                messageIndexes: (Array.isArray(evaluation[field]?.message_indexes)
                    ? evaluation[field].message_indexes
                    : [])
                    .map(Number)
                    .filter(Number.isInteger)
                    .slice(0, 40),
            }]));
            runtime.lastEvaluation = {
                messageIndex,
                passageStartIndex: Number.isInteger(options.passageStartIndex) ? options.passageStartIndex : -1,
                acknowledged: true,
                matched,
                accepted: [],
                reason: cleanString(evaluation.reason, 1_000),
                evidence: uniqueStrings(evidence, 20),
                actor: cleanString(evaluation.trigger_action?.actor, 180),
                conditions,
                evaluatedAt: Date.now(),
            };
        } else if (options.evaluationCoverageRequired === true) {
            runtime.lastEvaluation = {
                messageIndex,
                passageStartIndex: Number.isInteger(options.passageStartIndex) ? options.passageStartIndex : -1,
                acknowledged: false,
                matched: [],
                accepted: [],
                reason: 'The progression response did not acknowledge this event.',
                evidence: [],
                actor: '',
                conditions: {},
                evaluatedAt: Date.now(),
            };
        }
        const acceptMatch = field => {
            if (!evaluation || !runtime.lastEvaluation) return;
            runtime.lastEvaluation.accepted = uniqueStrings([...runtime.lastEvaluation.accepted, field], 8);
        };
        if (runtime.creationAnchorPending && messageIndex >= definition.createdAtMessage) {
            // Rebuilds replay to the exact completed-message boundary where
            // the user created the event. Re-anchor relative time there so a
            // swipe that changes earlier elapsed time cannot shift its delay.
            definition.createdAtElapsedSeconds = Math.max(0, numberOr(state.clock?.estimatedSeconds));
            runtime.armedAtElapsedSeconds = definition.createdAtElapsedSeconds;
            runtime.armedAtMessage = definition.createdAtMessage;
            runtime.creationAnchorPending = false;
            runtime.updatedAt = Date.now();
        }
        if (!definition.enabled || messageIndex <= definition.createdAtMessage) {
            if (runtime.status === 'armed') result.armed++;
            continue;
        }

        const cancellation = definition.cancellationCondition
            ? readMatch(evaluation, 'cancellation', definition, options)
            : null;
        if (cancellation && !FINAL_STATUSES.has(runtime.status)) {
            acceptMatch('cancellation');
            runtime.cancellationEvidence = uniqueStrings([...runtime.cancellationEvidence, ...cancellation.evidence], 20);
            setTransition(runtime, 'cancelled', state.clock, messageIndex, cancellation.evidence, transitions, 'cancellation condition matched');
            removeLinkedProgressionRecords(state, definition.key);
        }
        if (runtime.status === 'cancelled') {
            result.cancelled++;
            result.transitions.push(...transitions.map(item => ({ ...item, definitionId: definition.id, title: definition.title })));
            continue;
        }

        if (runtime.status === 'armed' && definition.actionCondition) {
            const action = readMatch(evaluation, 'trigger_action', definition, options);
            if (action) {
                acceptMatch('trigger_action');
                runtime.actionMatched = true;
                runtime.actionMatchedAtMessage = Math.max(...action.indexes);
                runtime.actionActor = action.actor;
                runtime.triggerEvidence = uniqueStrings([...runtime.triggerEvidence, ...action.evidence], 20);
            }
        }

        if (runtime.status === 'armed') {
            const hasTime = definition.triggerAfterSeconds !== null;
            const hasAction = Boolean(definition.actionCondition);
            const timeMatched = hasTime && clockReached(
                state.clock,
                elapsedThreshold(definition),
                definition.triggerTimeCertainty,
            );
            if (timeMatched && runtime.timeMatchedAtMessage < 0) runtime.timeMatchedAtMessage = messageIndex;
            const conditions = [];
            if (hasTime) conditions.push(timeMatched);
            if (hasAction) conditions.push(runtime.actionMatched);
            const triggered = conditions.length > 0 && (
                definition.triggerMode === 'all' ? conditions.every(Boolean) : conditions.some(Boolean)
            );
            if (triggered) {
                const satisfiedIndexes = [];
                if (timeMatched && runtime.timeMatchedAtMessage >= 0) satisfiedIndexes.push(runtime.timeMatchedAtMessage);
                if (runtime.actionMatched && runtime.actionMatchedAtMessage >= 0) satisfiedIndexes.push(runtime.actionMatchedAtMessage);
                runtime.conditionSatisfiedAtMessage = satisfiedIndexes.length
                    ? (definition.triggerMode === 'all'
                        ? Math.max(...satisfiedIndexes)
                        : Math.min(...satisfiedIndexes))
                    : messageIndex;
                const evidence = [...runtime.triggerEvidence];
                if (timeMatched) evidence.push(`Story clock reached ${elapsedThreshold(definition)} elapsed seconds.`);
                runtime.triggerEvidence = uniqueStrings(evidence, 20);
                const next = definition.activationVisibility === 'observable' ? 'observable' : 'active';
                setTransition(runtime, next, state.clock, messageIndex, runtime.triggerEvidence, transitions, 'trigger conditions satisfied');
                result.activated++;
            }
        }

        let publicReveal = null;
        let becameObservableThisPass = false;
        if (['active', 'observable'].includes(runtime.status)) {
            const revealCondition = definition.revealCondition
                ? readMatch(evaluation, 'revelation', definition, options)
                : null;
            const revealDelayReached = runtime.triggeredAtElapsedSeconds !== null
                && definition.revealAfterSeconds !== null
                && clockReached(
                    state.clock,
                    runtime.triggeredAtElapsedSeconds + definition.revealAfterSeconds,
                    definition.triggerTimeCertainty,
                );
            if (runtime.status === 'active' && (revealCondition || revealDelayReached)) {
                if (revealCondition) acceptMatch('revelation');
                const evidence = revealCondition?.evidence || [
                    `Reveal delay reached ${definition.revealAfterSeconds} seconds after activation.`,
                ];
                runtime.revealEvidence = uniqueStrings([...runtime.revealEvidence, ...evidence], 20);
                setTransition(runtime, 'observable', state.clock, messageIndex, evidence, transitions, 'revelation became observable');
                becameObservableThisPass = true;
            }
            // A configured reveal route means the hidden event may now enter
            // the story; it is not proof that the event itself was already
            // depicted. Hold it at observable for one foreground delivery
            // cycle even if a provider conflates revelation with disclosure.
            publicReveal = becameObservableThisPass
                ? null
                : readMatch(evaluation, 'public_reveal', definition, options);
            if (publicReveal) {
                acceptMatch('public_reveal');
                runtime.revealEvidence = uniqueStrings([...runtime.revealEvidence, ...publicReveal.evidence], 20);
                setTransition(runtime, 'revealed', state.clock, messageIndex, publicReveal.evidence, transitions, 'passage publicly revealed event');
            }
        }

        let resolution = null;
        if (['active', 'observable', 'revealed'].includes(runtime.status) && definition.resolutionCondition) {
            resolution = readMatch(evaluation, 'resolution', definition, options);
            if (resolution) {
                acceptMatch('resolution');
                runtime.resolutionEvidence = uniqueStrings([...runtime.resolutionEvidence, ...resolution.evidence], 20);
                // Resolution evidence in completed story is itself a public
                // disclosure. Preserve the observable/revealed lifecycle so a
                // hidden event can never jump directly from active to final.
                if (runtime.status === 'active') {
                    setTransition(
                        runtime,
                        'observable',
                        state.clock,
                        messageIndex,
                        resolution.evidence,
                        transitions,
                        'resolution evidence made the hidden event observable',
                    );
                }
                if (runtime.status === 'observable') {
                    setTransition(
                        runtime,
                        'revealed',
                        state.clock,
                        messageIndex,
                        resolution.evidence,
                        transitions,
                        'resolution evidence publicly revealed event',
                    );
                }
                setTransition(runtime, 'resolved', state.clock, messageIndex, resolution.evidence, transitions, 'resolution condition matched');
            }
        }

        const attemptPreviewInPassage = definition.actionTiming === 'same_reply_attempt'
            && runtime.attemptPreviewLastMessage >= Math.max(
                definition.createdAtMessage + 1,
                Number.isInteger(options.passageStartIndex) ? options.passageStartIndex : definition.createdAtMessage + 1,
            )
            && runtime.attemptPreviewLastMessage <= messageIndex
            && runtime.actionMatched;
        const actionOutcomeInPassage = definition.actionTiming === 'after_outcome'
            && runtime.actionMatchedAtMessage >= Math.max(
                definition.createdAtMessage + 1,
                Number.isInteger(options.passageStartIndex) ? options.passageStartIndex : definition.createdAtMessage + 1,
            )
            && runtime.actionMatchedAtMessage <= messageIndex;
        const localEvidence = runtime.status === 'observable'
            && (awaitingDelivery || attemptPreviewInPassage || actionOutcomeInPassage)
            ? localDeliveryEvidence(
                definition,
                options.passageText,
                awaitingDelivery
                    ? deliveryVerificationBoundary
                    : attemptPreviewInPassage
                        ? runtime.attemptPreviewLastMessage
                        : runtime.actionMatchedAtMessage,
            )
            : [];
        if (localEvidence.length) {
            setTransition(
                runtime,
                'revealed',
                state.clock,
                messageIndex,
                localEvidence,
                transitions,
                'completed story matched the foreground delivery details',
            );
            if (!awaitingDelivery) {
                result.deliveryConfirmed.push({
                    definitionId: definition.id,
                    title: definition.title,
                    messageIndex,
                    evidence: localEvidence,
                });
            }
        }

        if (awaitingDelivery) {
            // Count only attempts that produced a completed story reply and
            // reached this verification pass. A stopped or transport-failed
            // generation may have received the prompt, but it is not a failed
            // narrative delivery attempt.
            runtime.deliveryAttempts++;
            markDeliveryReceiptsVerified(runtime, messageIndex, runtime.deliveryStatus === 'delivered');
            if (runtime.deliveryStatus === 'delivered' || publicReveal || resolution) {
                result.deliveryConfirmed.push({
                    definitionId: definition.id,
                    title: definition.title,
                    messageIndex,
                    evidence: uniqueStrings([
                        ...(publicReveal?.evidence || []),
                        ...(resolution?.evidence || []),
                        ...runtime.deliveryEvidence,
                    ], 20),
                });
            } else if (runtime.status === 'observable') {
                const maximumAttempts = clamp(options.deliveryMaximumAttempts ?? 3, 1, 20);
                const reason = cleanString(evaluation?.reason, 1_000)
                    || 'The completed story reply did not establish this observable event.';
                runtime.deliveryFailureReason = reason;
                if (runtime.deliveryAttempts >= maximumAttempts) {
                    runtime.deliveryStatus = 'failed';
                    result.deliveryFailures.push({
                        definitionId: definition.id,
                        title: definition.title,
                        messageIndex,
                        attempts: runtime.deliveryAttempts,
                        reason,
                    });
                } else {
                    runtime.deliveryStatus = 'pending';
                    result.deliveryRetries.push({
                        definitionId: definition.id,
                        title: definition.title,
                        messageIndex,
                        attempts: runtime.deliveryAttempts,
                        reason,
                    });
                }
            } else if (runtime.status === 'armed') {
                // A provisional time delivery can be assembled before the
                // background clock commits. If the authoritative pass does
                // not confirm that activation, do not count it as a failed
                // observable-event delivery.
                runtime.deliveryStatus = 'none';
                runtime.deliveryFailureReason = cleanString(evaluation?.reason, 1_000);
            }
            runtime.updatedAt = Date.now();
        }

        result[runtime.status] = (result[runtime.status] || 0) + 1;
        result.transitions.push(...transitions.map(item => ({ ...item, definitionId: definition.id, title: definition.title })));
    }
    state.updatedAt = Date.now();
    return { state, result };
}

export function triggerEventAgentSnapshot(stateValue, options = {}) {
    const state = stateValue && typeof stateValue === 'object' ? stateValue : {};
    const collections = normalizeTriggerEventCollections(state.eventDefinitions, state.eventRuntime);
    const currentIndex = Number.isInteger(options.currentIndex) ? options.currentIndex : Number.MAX_SAFE_INTEGER;
    return Object.values(collections.definitions)
        .filter(definition => (definition.enabled || options.includeDisabled === true)
            && definition.createdAtMessage < currentIndex
            && (options.includeFinal === true || !FINAL_STATUSES.has(collections.runtime[definition.id].status))
            && (options.includeFinal === true
                || collections.runtime[definition.id].status !== 'revealed'
                || Boolean(definition.resolutionCondition)))
        .sort((a, b) => b.priority - a.priority || a.title.localeCompare(b.title))
        .slice(0, Math.max(1, Number(options.maximumDefinitions) || 100))
        .map(definition => {
            const runtime = collections.runtime[definition.id];
            return {
                id: definition.id,
                key: definition.key,
                title: definition.title,
                description: definition.description,
                trigger_mode: definition.triggerMode,
                time_basis: definition.timeBasis,
                trigger_after_seconds: definition.triggerAfterSeconds,
                trigger_time_certainty: definition.triggerTimeCertainty,
                action_condition: definition.actionCondition,
                action_timing: definition.actionTiming,
                actor_scope: definition.actorScope,
                actor_name: definition.actorName,
                cancellation_condition: definition.cancellationCondition,
                activation_visibility: definition.activationVisibility,
                reveal_after_seconds: definition.revealAfterSeconds,
                reveal_condition: definition.revealCondition,
                resolution_condition: definition.resolutionCondition,
                consequences: definition.consequences,
                subjects: definition.subjects,
                priority: definition.priority,
                origin: definition.origin,
                proposal_id: definition.proposalId,
                expires_at_message: definition.expiresAtMessage,
                created_at_elapsed_seconds: definition.createdAtElapsedSeconds,
                created_at_message: definition.createdAtMessage,
                runtime: {
                    status: runtime.status,
                    action_matched: runtime.actionMatched,
                    action_actor: runtime.actionActor,
                    action_matched_at_message: runtime.actionMatchedAtMessage,
                    time_matched_at_message: runtime.timeMatchedAtMessage,
                    condition_satisfied_at_message: runtime.conditionSatisfiedAtMessage,
                    state_transition_recorded_at_message: runtime.stateTransitionRecordedAtMessage,
                    triggered_at_elapsed_seconds: runtime.triggeredAtElapsedSeconds,
                    triggered_at_message: runtime.triggeredAtMessage,
                    trigger_evidence: runtime.triggerEvidence,
                    reveal_evidence: runtime.revealEvidence,
                    delivery_status: runtime.deliveryStatus,
                    delivery_id: runtime.deliveryId,
                    delivery_attempts: runtime.deliveryAttempts,
                    delivery_first_injected_at_message: runtime.deliveryFirstInjectedAtMessage,
                    delivery_last_injected_at_message: runtime.deliveryLastInjectedAtMessage,
                    delivery_last_verified_at_message: runtime.deliveryLastVerifiedAtMessage,
                    delivery_injection_receipts: runtime.deliveryInjectionReceipts,
                },
            };
        });
}

export function triggerEventEvaluationKeys(stateValue, options = {}) {
    return triggerEventAgentSnapshot(stateValue, options).map(definition => definition.key);
}

export function listTriggerEventRecords(stateValue) {
    const state = stateValue && typeof stateValue === 'object' ? stateValue : {};
    const collections = normalizeTriggerEventCollections(state.eventDefinitions, state.eventRuntime);
    return Object.values(collections.definitions).map(definition => ({
        ...definition,
        runtime: collections.runtime[definition.id],
        status: collections.runtime[definition.id].status,
    }));
}

export function getTriggerEventStats(stateValue) {
    const records = listTriggerEventRecords(stateValue);
    const statuses = Object.fromEntries([...STATUSES].map(status => [status, 0]));
    for (const record of records) statuses[record.status]++;
    return {
        definitions: records.length,
        enabled: records.filter(record => record.enabled).length,
        ...statuses,
        pendingDelivery: records.filter(record => ['pending', 'injected'].includes(record.runtime.deliveryStatus)).length,
        failedDelivery: records.filter(record => record.runtime.deliveryStatus === 'failed').length,
    };
}

export function triggerEventTimeThreshold(definition) {
    return elapsedThreshold(normalizeDefinition(definition));
}
