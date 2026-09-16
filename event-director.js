import { canonicalNameKey, clamp, cleanString, contextSimilarity, hashString, uniqueStrings } from './core.js';

export const EVENT_DIRECTOR_VERSION = 1;
export const AUTOMATIC_EVENT_ORIGIN = 'automatic_director';

const PROPOSAL_STATUSES = new Set(['proposed', 'armed', 'rejected', 'expired', 'superseded']);
const ACTIVE_EVENT_STATUSES = new Set(['armed', 'active', 'observable']);

export const EVENT_DIRECTOR_ACTIVITY = Object.freeze({
    quiet: Object.freeze({ target: 1, minimumTurnGap: 10 }),
    balanced: Object.freeze({ target: 2, minimumTurnGap: 6 }),
    lively: Object.freeze({ target: 3, minimumTurnGap: 4 }),
});

const objectValue = value => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
const numberOr = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const integer = (value, fallback = 0, minimum = 0, maximum = Number.MAX_SAFE_INTEGER) => {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? Math.round(clamp(parsed, minimum, maximum)) : fallback;
};

function normalizeSourceRef(value) {
    const source = objectValue(value);
    const id = cleanString(source.id ?? source.source_id, 512);
    const kind = canonicalNameKey(source.kind ?? source.source_kind).replace(/\s+/gu, '_');
    if (!id || !['lore', 'goal', 'process', 'event', 'npc_motive'].includes(kind)) return null;
    return {
        id,
        kind,
        name: cleanString(source.name, 240),
        revision: integer(source.revision, 0, 0),
        messageIndex: integer(source.messageIndex ?? source.message_index, -1, -1),
        graphNodeId: cleanString(source.graphNodeId ?? source.graph_node_id, 512),
    };
}

function normalizeDefinitionInput(value) {
    const source = objectValue(value);
    const triggerSeconds = source.triggerAfterSeconds ?? source.trigger_after_seconds;
    const revealSeconds = source.revealAfterSeconds ?? source.reveal_after_seconds;
    return {
        key: canonicalNameKey(source.key).replace(/\s+/gu, '_').slice(0, 100),
        title: cleanString(source.title, 240),
        description: cleanString(source.description, 3_000),
        triggerMode: ['all', 'any'].includes(source.triggerMode ?? source.trigger_mode)
            ? (source.triggerMode ?? source.trigger_mode)
            : 'any',
        triggerAfterSeconds: triggerSeconds === undefined || triggerSeconds === null || triggerSeconds === ''
            ? null
            : Math.max(0, numberOr(triggerSeconds, 0)),
        triggerTimeCertainty: (source.triggerTimeCertainty ?? source.trigger_time_certainty) === 'definite'
            ? 'definite'
            : 'estimated',
        actionCondition: cleanString(source.actionCondition ?? source.action_condition, 1_500),
        actorScope: ['any', 'player', 'npc', 'named'].includes(source.actorScope ?? source.actor_scope)
            ? (source.actorScope ?? source.actor_scope)
            : 'any',
        actorName: cleanString(source.actorName ?? source.actor_name, 180),
        cancellationCondition: cleanString(source.cancellationCondition ?? source.cancellation_condition, 1_500),
        activationVisibility: (source.activationVisibility ?? source.activation_visibility) === 'observable'
            ? 'observable'
            : 'hidden',
        revealAfterSeconds: revealSeconds === undefined || revealSeconds === null || revealSeconds === ''
            ? null
            : Math.max(0, numberOr(revealSeconds, 0)),
        revealCondition: cleanString(source.revealCondition ?? source.reveal_condition, 1_500),
        resolutionCondition: cleanString(source.resolutionCondition ?? source.resolution_condition, 1_500),
        consequences: cleanString(source.consequences, 4_000),
        subjects: uniqueStrings(source.subjects || [], 30),
        priority: integer(source.priority, 55, 0, 65),
    };
}

export function normalizeEventProposal(value, options = {}) {
    const source = objectValue(value);
    const definition = normalizeDefinitionInput(source.definition ?? source.proposedDefinition ?? source);
    const key = definition.key || canonicalNameKey(source.key ?? source.title ?? 'event').replace(/\s+/gu, '_').slice(0, 100) || 'event';
    const sourceRefs = (Array.isArray(source.sourceRefs) ? source.sourceRefs : source.source_refs || [])
        .map(normalizeSourceRef).filter(Boolean).slice(0, 12);
    const branchId = cleanString(source.branchId ?? source.branch_id ?? options.branchId ?? 'main', 256) || 'main';
    const sourceHash = cleanString(source.sourceHash ?? source.source_hash, 128)
        || hashString(JSON.stringify(sourceRefs.map(item => [item.kind, item.id, item.revision])));
    const id = cleanString(source.id, 180) || `event-proposal:${hashString(`${branchId}\0${key}\0${sourceHash}`)}`;
    const createdAtMessage = integer(source.createdAtMessage ?? source.created_at_message, options.currentMessageIndex ?? -1, -1);
    return {
        id,
        version: EVENT_DIRECTOR_VERSION,
        key,
        title: definition.title || cleanString(source.title, 240) || 'Untitled event proposal',
        description: definition.description || cleanString(source.description, 3_000),
        status: PROPOSAL_STATUSES.has(source.status) ? source.status : 'proposed',
        confidence: clamp(numberOr(source.confidence, 0), 0, 1),
        rationale: cleanString(source.rationale ?? source.reason, 2_000),
        sourceRefs,
        sourceHash,
        sourceStoreRevision: integer(source.sourceStoreRevision ?? source.source_store_revision, options.sourceStoreRevision ?? 0, 0),
        branchId,
        headFingerprint: cleanString(source.headFingerprint ?? source.head_fingerprint ?? options.headFingerprint, 256),
        createdAtMessage,
        expiresAtMessage: integer(source.expiresAtMessage ?? source.expires_at_message,
            createdAtMessage + integer(options.expirationTurns, 40, 4, 200), -1),
        definition,
        definitionId: cleanString(source.definitionId ?? source.definition_id, 180),
        generationProfileId: cleanString(source.generationProfileId ?? source.generation_profile_id ?? options.profileId, 180),
        lineageDepth: integer(source.lineageDepth ?? source.lineage_depth, 0, 0, 1),
        rejectionReason: cleanString(source.rejectionReason ?? source.rejection_reason, 1_000),
        createdAt: Math.max(0, numberOr(source.createdAt, Date.now())),
        updatedAt: Math.max(0, numberOr(source.updatedAt, Date.now())),
    };
}

export function normalizeEventProposalMap(value) {
    const source = objectValue(value);
    const result = {};
    for (const [id, raw] of Object.entries(source).slice(0, 200)) {
        const proposal = normalizeEventProposal(raw);
        proposal.id = cleanString(raw?.id ?? id, 180) || proposal.id;
        result[proposal.id] = proposal;
    }
    return result;
}

export function normalizeEventDirectorMetadata(value) {
    const source = objectValue(value);
    return {
        version: EVENT_DIRECTOR_VERSION,
        lastAttemptMessage: integer(source.lastAttemptMessage, -1, -1),
        lastGeneratedMessage: integer(source.lastGeneratedMessage, -1, -1),
        lastRunAt: Math.max(0, numberOr(source.lastRunAt, 0)),
        lastOutcome: cleanString(source.lastOutcome, 120) || 'never',
        lastReason: cleanString(source.lastReason, 1_000),
        lastError: cleanString(source.lastError, 1_000),
        requestCount: integer(source.requestCount, 0, 0),
        acceptedCount: integer(source.acceptedCount, 0, 0),
        rejectedCount: integer(source.rejectedCount, 0, 0),
        repairedCount: integer(source.repairedCount, 0, 0),
    };
}

export function automaticEventRecords(stateValue) {
    const state = objectValue(stateValue);
    const definitions = objectValue(state.eventDefinitions);
    const runtime = objectValue(state.eventRuntime);
    return Object.values(definitions)
        .filter(definition => definition?.origin === AUTOMATIC_EVENT_ORIGIN)
        .map(definition => ({ ...definition, runtime: runtime[definition.id], status: runtime[definition.id]?.status || 'armed' }));
}

export function decideAutomaticEventGeneration(stateValue, settings = {}, currentMessageIndex = -1, options = {}) {
    const state = objectValue(stateValue);
    const metadata = normalizeEventDirectorMetadata(state.eventDirector);
    const activity = EVENT_DIRECTOR_ACTIVITY[settings.automaticEventDirectorActivity]
        || EVENT_DIRECTOR_ACTIVITY.balanced;
    const records = automaticEventRecords(state);
    const active = records.filter(record => record.enabled !== false && ACTIVE_EVENT_STATUSES.has(record.status));
    const pendingProposals = Object.values(normalizeEventProposalMap(state.eventProposals))
        .filter(proposal => proposal.status === 'proposed');
    const poolSize = active.length + pendingProposals.length;
    const allDefinitions = Object.values(objectValue(state.eventDefinitions));
    const allRuntime = objectValue(state.eventRuntime);
    const deliveryPending = allDefinitions.some(definition => {
        const runtime = allRuntime[definition.id];
        return runtime?.status === 'observable'
            || ['pending', 'injected'].includes(runtime?.deliveryStatus);
    });
    const gap = currentMessageIndex - metadata.lastAttemptMessage;
    let reason = 'event_pool_below_target';
    let due = settings.automaticEventDirectorEnabled === true
        && settings.worldProgressionEnabled !== false
        && poolSize < activity.target;
    if (!settings.automaticEventDirectorEnabled) reason = 'disabled';
    else if (settings.worldProgressionEnabled === false) reason = 'world_progression_disabled';
    else if (deliveryPending && options.force !== true) { due = false; reason = 'event_delivery_pending'; }
    else if (poolSize >= activity.target && options.force !== true) { due = false; reason = 'event_pool_full'; }
    else if (metadata.lastAttemptMessage >= 0 && gap < activity.minimumTurnGap && options.force !== true) {
        due = false; reason = 'generation_cooldown';
    }
    if (options.force === true && settings.automaticEventDirectorEnabled === true
        && settings.worldProgressionEnabled !== false) {
        due = true;
        reason = 'manual_generation';
    }
    return {
        due,
        reason,
        target: activity.target,
        minimumTurnGap: activity.minimumTurnGap,
        activeGenerated: active.length,
        pendingProposals: pendingProposals.length,
        poolSize,
        deliveryPending,
        turnsSinceAttempt: metadata.lastAttemptMessage < 0 ? null : gap,
    };
}

function proposalText(value) {
    const source = objectValue(value);
    return [source.title, source.description, source.consequences, source.rationale].filter(Boolean).join(' ');
}

function duplicateProposal(candidate, state) {
    const candidateKey = canonicalNameKey(candidate.key);
    const candidateText = proposalText(candidate);
    const prior = [
        ...Object.values(objectValue(state.eventDefinitions)),
        ...Object.values(objectValue(state.eventProposals)),
        ...Object.values(objectValue(state.events)),
    ];
    return prior.find(record => {
        const key = canonicalNameKey(record?.key ?? record?.title);
        if (candidateKey && key === candidateKey) return true;
        return candidateText && contextSimilarity(candidateText, proposalText(record?.definition ?? record)) >= 0.86;
    }) || null;
}

function playerAgencyViolation(value, playerName) {
    const text = canonicalNameKey(value);
    if (!text) return false;
    const player = canonicalNameKey(playerName);
    const subjects = ['the player', 'player character', 'the protagonist', player].filter(Boolean)
        .map(item => item.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'));
    if (!subjects.length) return false;
    const subject = `(?:${subjects.join('|')})`;
    return new RegExp(`\\b${subject}\\b.{0,40}\\b(?:must|will|decides?|agrees?|accepts?|feels?|thinks?|believes?|says?|chooses?|travels?|attacks?|kills?|loves?|forgives?)\\b`, 'iu').test(text)
        || new RegExp(`\\b(?:force|compel|make)s?\\b.{0,40}\\b${subject}\\b`, 'iu').test(text);
}

export function validateEventDirectorPayload(payloadValue, options = {}) {
    const payload = objectValue(payloadValue);
    if (!Object.hasOwn(payload, 'proposal')) throw new Error('Automatic Event Director response must contain "proposal".');
    if (payload.proposal === null) {
        const reason = cleanString(payload.reason, 1_000);
        if (!reason) throw new Error('Automatic Event Director returned no proposal without a reason.');
        return { proposal: null, reason };
    }
    const raw = objectValue(payload.proposal);
    if (!Object.keys(raw).length) throw new Error('Automatic Event Director proposal must be an object or null.');
    const definition = normalizeDefinitionInput(raw);
    if (!definition.key || !definition.title || !definition.description || !definition.consequences) {
        throw new Error('Automatic Event Director proposal requires key, title, description, and consequences.');
    }
    if (definition.triggerAfterSeconds === null && !definition.actionCondition) {
        throw new Error('Automatic Event Director proposal requires a future time or completed-action trigger.');
    }
    if (definition.triggerAfterSeconds !== null && definition.triggerAfterSeconds < 1) {
        throw new Error('Automatic Event Director time triggers must be at least one story second in the future.');
    }
    if (definition.actorScope === 'named' && definition.actionCondition && !definition.actorName) {
        throw new Error('Automatic Event Director named action trigger is missing actor_name.');
    }
    if (definition.activationVisibility === 'hidden'
        && definition.revealAfterSeconds === null
        && !definition.revealCondition) {
        throw new Error('A hidden automatic event requires a reveal delay or reveal condition.');
    }
    if (playerAgencyViolation(`${definition.description}\n${definition.consequences}`, options.playerName)) {
        throw new Error('Automatic Event Director proposal would prescribe a player action, thought, or feeling.');
    }
    const confidence = clamp(numberOr(raw.confidence, 0), 0, 1);
    const minimumConfidence = clamp(numberOr(options.minimumConfidence, 0.82), 0, 1);
    if (confidence < minimumConfidence) {
        throw new Error(`Automatic Event Director confidence ${confidence.toFixed(2)} is below ${minimumConfidence.toFixed(2)}.`);
    }
    const sourceCatalog = new Map((Array.isArray(options.sources) ? options.sources : [])
        .filter(source => source?.id).map(source => [source.id, source]));
    const requestedRefs = (Array.isArray(raw.source_refs) ? raw.source_refs : raw.sourceRefs || [])
        .map(normalizeSourceRef).filter(Boolean);
    if (!requestedRefs.length) throw new Error('Automatic Event Director proposal must cite at least one exact source ID.');
    const unknown = requestedRefs.filter(reference => !sourceCatalog.has(reference.id));
    if (unknown.length) throw new Error(`Automatic Event Director cited unknown source ID(s): ${unknown.map(item => item.id).join(', ')}.`);
    const sourceRefs = requestedRefs.map(reference => {
        const authoritative = sourceCatalog.get(reference.id);
        return normalizeSourceRef({ ...reference, ...authoritative });
    });
    if (sourceRefs.some(reference => reference.kind === 'npc_motive')
        && options.includePrivateMinds !== true) {
        throw new Error('Automatic Event Director cited private NPC state while that source is disabled.');
    }
    const lineageDepth = sourceRefs.some(reference => reference.kind === 'event'
        && sourceCatalog.get(reference.id)?.generated === true) ? 1 : 0;
    if (lineageDepth > 0 && options.allowGeneratedLineage !== true) {
        throw new Error('Automatic events cannot be derived solely from another generated event.');
    }
    const candidate = {
        ...raw,
        ...definition,
        confidence,
        sourceRefs,
        lineageDepth,
        rationale: cleanString(raw.rationale, 2_000),
    };
    const duplicate = duplicateProposal(candidate, options.state || {});
    if (duplicate) throw new Error(`Automatic Event Director proposal duplicates “${duplicate.title || duplicate.key}”.`);
    return { proposal: candidate, reason: cleanString(payload.reason, 1_000) };
}

export function recordEventDirectorAttempt(stateValue, options = {}) {
    const state = objectValue(stateValue);
    state.eventDirector = normalizeEventDirectorMetadata(state.eventDirector);
    state.eventDirector.lastAttemptMessage = integer(options.currentMessageIndex, state.eventDirector.lastAttemptMessage, -1);
    state.eventDirector.lastRunAt = Date.now();
    state.eventDirector.requestCount++;
    state.eventDirector.lastError = cleanString(options.error, 1_000);
    state.eventDirector.lastOutcome = cleanString(options.outcome, 120) || (options.error ? 'error' : 'no_proposal');
    state.eventDirector.lastReason = cleanString(options.reason, 1_000);
    if (options.repaired) state.eventDirector.repairedCount++;
    return state;
}

export function addEventProposal(stateValue, candidateValue, options = {}) {
    const state = objectValue(stateValue);
    state.eventProposals = normalizeEventProposalMap(state.eventProposals);
    state.eventDirector = normalizeEventDirectorMetadata(state.eventDirector);
    const candidate = objectValue(candidateValue);
    const proposal = normalizeEventProposal({
        ...candidate,
        definition: candidate,
        status: 'proposed',
        sourceStoreRevision: options.sourceStoreRevision,
        branchId: options.branchId,
        headFingerprint: options.headFingerprint,
        createdAtMessage: options.currentMessageIndex,
        expiresAtMessage: integer(options.currentMessageIndex, -1, -1)
            + integer(options.expirationTurns, 40, 4, 200),
        generationProfileId: options.profileId,
    }, options);
    state.eventProposals[proposal.id] = proposal;
    state.eventDirector.lastGeneratedMessage = proposal.createdAtMessage;
    state.eventDirector.lastOutcome = 'proposed';
    state.eventDirector.lastReason = proposal.rationale;
    state.eventDirector.lastError = '';
    state.eventDirector.acceptedCount++;
    state.eventDirector.lastRunAt = Date.now();
    const proposals = Object.values(state.eventProposals)
        .sort((left, right) => right.updatedAt - left.updatedAt);
    for (const stale of proposals.slice(80)) delete state.eventProposals[stale.id];
    return { state, proposal };
}

export function eventDefinitionFromProposal(proposalValue) {
    const proposal = normalizeEventProposal(proposalValue);
    return {
        id: proposal.definitionId || `trigger:auto:${hashString(proposal.id)}`,
        ...proposal.definition,
        enabled: true,
        timeBasis: 'after_creation',
        actionTiming: 'after_outcome',
        origin: AUTOMATIC_EVENT_ORIGIN,
        proposalId: proposal.id,
        expiresAtMessage: proposal.expiresAtMessage,
        provenance: {
            branchId: proposal.branchId,
            headFingerprint: proposal.headFingerprint,
            sourceStoreRevision: proposal.sourceStoreRevision,
            sourceHash: proposal.sourceHash,
            sourceRefs: proposal.sourceRefs,
            generationProfileId: proposal.generationProfileId,
            confidence: proposal.confidence,
            lineageDepth: proposal.lineageDepth,
        },
    };
}

export function markEventProposalArmed(stateValue, proposalIdValue, definitionIdValue) {
    const state = objectValue(stateValue);
    state.eventProposals = normalizeEventProposalMap(state.eventProposals);
    const proposal = state.eventProposals[cleanString(proposalIdValue, 180)];
    if (!proposal) throw new Error('Select an automatic event proposal first.');
    proposal.status = 'armed';
    proposal.definitionId = cleanString(definitionIdValue, 180);
    proposal.updatedAt = Date.now();
    return { state, proposal };
}

export function rejectEventProposal(stateValue, proposalIdValue, reason = 'Rejected by user') {
    const state = objectValue(stateValue);
    state.eventProposals = normalizeEventProposalMap(state.eventProposals);
    state.eventDirector = normalizeEventDirectorMetadata(state.eventDirector);
    const proposal = state.eventProposals[cleanString(proposalIdValue, 180)];
    if (!proposal) throw new Error('Select an automatic event proposal first.');
    proposal.status = 'rejected';
    proposal.rejectionReason = cleanString(reason, 1_000) || 'Rejected by user';
    proposal.updatedAt = Date.now();
    state.eventDirector.rejectedCount++;
    return { state, proposal };
}

export function removeEventProposal(stateValue, proposalIdValue) {
    const state = objectValue(stateValue);
    state.eventProposals = normalizeEventProposalMap(state.eventProposals);
    const id = cleanString(proposalIdValue, 180);
    const proposal = state.eventProposals[id] || null;
    delete state.eventProposals[id];
    return { state, proposal };
}

export function expireEventProposals(stateValue, options = {}) {
    const state = objectValue(stateValue);
    state.eventProposals = normalizeEventProposalMap(state.eventProposals);
    const currentMessageIndex = integer(options.currentMessageIndex, -1, -1);
    const branchId = cleanString(options.branchId, 256);
    const availableSourceIds = options.availableSourceIds instanceof Set ? options.availableSourceIds : null;
    const expired = [];
    for (const proposal of Object.values(state.eventProposals)) {
        if (!['proposed', 'armed'].includes(proposal.status)) continue;
        let reason = '';
        if (branchId && proposal.branchId !== branchId) reason = 'branch_changed';
        else if (proposal.expiresAtMessage >= 0 && currentMessageIndex > proposal.expiresAtMessage) reason = 'proposal_expired';
        else if (availableSourceIds && proposal.sourceRefs.some(reference => !availableSourceIds.has(reference.id))) reason = 'source_removed';
        if (!reason) continue;
        proposal.status = reason === 'proposal_expired' ? 'expired' : 'superseded';
        proposal.rejectionReason = reason;
        proposal.updatedAt = Date.now();
        expired.push({ proposalId: proposal.id, definitionId: proposal.definitionId, reason });
    }
    return { state, expired };
}

export function stripAutomaticEventStateForRebuild(stateValue) {
    const state = objectValue(stateValue);
    state.eventDefinitions = objectValue(state.eventDefinitions);
    state.eventRuntime = objectValue(state.eventRuntime);
    let definitionsRemoved = 0;
    for (const [id, definition] of Object.entries(state.eventDefinitions)) {
        if (definition?.origin !== AUTOMATIC_EVENT_ORIGIN) continue;
        delete state.eventDefinitions[id];
        delete state.eventRuntime[id];
        definitionsRemoved++;
    }
    state.eventProposals = {};
    state.eventDirector = normalizeEventDirectorMetadata({});
    return { state, definitionsRemoved };
}

export function getEventDirectorStats(stateValue) {
    const state = objectValue(stateValue);
    const proposals = Object.values(normalizeEventProposalMap(state.eventProposals));
    const automatic = automaticEventRecords(state);
    return {
        proposals: proposals.length,
        pendingReview: proposals.filter(item => item.status === 'proposed').length,
        armedProposals: proposals.filter(item => item.status === 'armed').length,
        rejected: proposals.filter(item => item.status === 'rejected').length,
        expired: proposals.filter(item => ['expired', 'superseded'].includes(item.status)).length,
        definitions: automatic.length,
        active: automatic.filter(item => item.enabled !== false && ACTIVE_EVENT_STATUSES.has(item.status)).length,
        metadata: normalizeEventDirectorMetadata(state.eventDirector),
    };
}
