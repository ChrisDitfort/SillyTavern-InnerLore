import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
    applyProgressionPatch,
    buildProgressionInjection,
    createProgressionState,
    progressionAgentSnapshot,
} from '../progression.js';
import { buildProgressionMessages } from '../progression-prompts.js';
import {
    getTriggerEventStats,
    hasTriggerEventDeliveryAwaitingVerification,
    markTriggerEventDeliveriesInjected,
    normalizeTriggerEventCollections,
    rearmTriggerEvent,
    removeTriggerEventDefinition,
    resetTriggerEventRuntime,
    retryTriggerEventDelivery,
    triggerEventAgentSnapshot,
    upsertTriggerEventDefinition,
    verifyTriggerEventDeliveriesFromStory,
} from '../trigger-events.js';

function patch(seconds, eventEvaluations = []) {
    return {
        time: {
            elapsed: {
                minimum_seconds: seconds,
                estimated_seconds: seconds,
                maximum_seconds: seconds,
            },
            confidence: 1,
            basis: ['Deterministic trigger-event test time.'],
            completed_actions: [],
        },
        goals: [],
        processes: [],
        events: [],
        event_evaluations: eventEvaluations,
    };
}

function match(key, actor, evidence, messageIndex) {
    return {
        key,
        trigger_action: {
            matched: true,
            actor,
            evidence: [evidence],
            message_indexes: [messageIndex],
        },
    };
}

test('a hidden time event activates off-screen and becomes injectable only after its reveal delay', () => {
    let state = createProgressionState();
    state = upsertTriggerEventDefinition(state, {
        id: 'trigger:northern_war',
        key: 'northern_war',
        title: 'The Northern War',
        description: 'War begins beyond the northern border.',
        enabled: true,
        triggerAfterSeconds: 600,
        timeBasis: 'after_creation',
        activationVisibility: 'hidden',
        revealAfterSeconds: 120,
        consequences: 'Mobilization and fighting progress privately; news must travel plausibly.',
        subjects: ['Northern Kingdom'],
        priority: 95,
    }, { clock: state.clock, messageIndex: -1 }).state;

    state = applyProgressionPatch(state, patch(599), { messageIndex: 2, passageStartIndex: 1 }).state;
    assert.equal(state.eventRuntime['trigger:northern_war'].status, 'armed');

    const activationPatch = patch(1);
    activationPatch.events.push({
        key: 'northern_war',
        title: 'Duplicate model-created Northern War',
        status: 'occurred_offscreen',
        evidence: ['The model must not clone an editor definition.'],
    });
    activationPatch.processes.push({
        key: 'northern_mobilization',
        subject_type: 'faction',
        subject_name: 'Northern Kingdom',
        kind: 'politics',
        title: 'Northern Mobilization',
        description: 'Armies mobilize beyond the border.',
        status: 'active',
        stage: 'mustering',
        progress: 20,
        visibility: 'narrator',
        source_event_key: 'northern_war',
        evidence: ['The private event consequences begin.'],
    });
    state = applyProgressionPatch(state, activationPatch, { messageIndex: 4, passageStartIndex: 3 }).state;
    assert.equal(state.eventRuntime['trigger:northern_war'].status, 'active');
    assert.equal(state.events['event:northern_war'], undefined, 'automatic beats cannot duplicate an editor definition key');
    assert.equal(state.eventRuntime['trigger:northern_war'].triggeredAtElapsedSeconds, 600);
    assert.doesNotMatch(
        buildProgressionInjection(state, 'Jet remains inside the distant manor.'),
        /Northern War/u,
        'a hidden active event must not leak into story context',
    );
    assert.doesNotMatch(
        buildProgressionInjection(state, 'Jet remains inside the distant manor.'),
        /Northern Mobilization/u,
        'progression records linked to a hidden event must remain private too',
    );
    assert.equal(
        progressionAgentSnapshot(state).trigger_events[0].runtime.status,
        'active',
        'the private progression agent must still receive the hidden event',
    );

    state = applyProgressionPatch(state, patch(119), { messageIndex: 6, passageStartIndex: 5 }).state;
    assert.equal(state.eventRuntime['trigger:northern_war'].status, 'active');
    state = applyProgressionPatch(state, patch(1), { messageIndex: 8, passageStartIndex: 7 }).state;
    assert.equal(state.eventRuntime['trigger:northern_war'].status, 'observable');
    const injection = buildProgressionInjection(state, 'Refugees approach the manor road.');
    assert.match(injection, /EDITOR EVENT \[observable\]: The Northern War/u);
    assert.match(injection, /Northern Mobilization/u, 'linked progression can enter context once the event is observable');
    assert.match(injection, /plausible present evidence/u);
});

test('legacy event records migrate to conservative action timing and delivery state', () => {
    const collections = normalizeTriggerEventCollections({
        'trigger:legacy': {
            id: 'trigger:legacy',
            key: 'legacy',
            title: 'Legacy Event',
            enabled: true,
            triggerAfterSeconds: 10,
            activationVisibility: 'observable',
        },
    }, {
        'trigger:legacy': {
            definitionId: 'trigger:legacy',
            status: 'observable',
        },
    });

    assert.equal(collections.definitions['trigger:legacy'].actionTiming, 'after_outcome');
    assert.equal(collections.runtime['trigger:legacy'].deliveryStatus, 'pending');
});

test('same-reply timing rejects configurations that cannot affect the newest player reply', () => {
    const base = createProgressionState();
    assert.throws(() => upsertTriggerEventDefinition(base, {
        id: 'trigger:npc_same_reply',
        key: 'npc_same_reply',
        title: 'NPC Same Reply',
        enabled: true,
        actionCondition: 'The guard rings the bell.',
        actionTiming: 'same_reply_attempt',
        actorScope: 'npc',
        activationVisibility: 'observable',
    }, { messageIndex: 0, playerName: 'Jet' }), /newest player turn/u);
    assert.throws(() => upsertTriggerEventDefinition(createProgressionState(), {
        id: 'trigger:hidden_same_reply',
        key: 'hidden_same_reply',
        title: 'Hidden Same Reply',
        enabled: true,
        actionCondition: 'The player rings the bell.',
        actionTiming: 'same_reply_attempt',
        actorScope: 'player',
        activationVisibility: 'hidden',
    }, { messageIndex: 0, playerName: 'Jet' }), /Allow the narrator to show it immediately/u);
});

test('observable delivery is verified, retried, confirmed, and traced', () => {
    let state = createProgressionState();
    state = upsertTriggerEventDefinition(state, {
        id: 'trigger:arrival',
        key: 'arrival',
        title: 'The Courier Arrives',
        enabled: true,
        triggerAfterSeconds: 0,
        activationVisibility: 'observable',
    }, { clock: state.clock, messageIndex: -1 }).state;
    state = applyProgressionPatch(state, patch(0), {
        messageIndex: 0,
        passageStartIndex: 0,
    }).state;
    assert.equal(state.eventRuntime['trigger:arrival'].deliveryStatus, 'pending');

    state = markTriggerEventDeliveriesInjected(state, [
        { definitionId: 'trigger:arrival', kind: 'observable' },
    ], {
        messageIndex: 1,
        generationId: 'story:first',
        prompt: '<inner_lore_trigger_delivery>The Courier Arrives</inner_lore_trigger_delivery>',
    }).state;
    assert.equal(state.eventRuntime['trigger:arrival'].deliveryAttempts, 0,
        'an injection is not counted until a completed reply is verified');
    assert.equal(hasTriggerEventDeliveryAwaitingVerification(state, 2), true);

    let applied = applyProgressionPatch(state, patch(1, [{
        key: 'arrival',
        evaluated: true,
        reason: 'The reply remained inside and did not depict the courier.',
    }]), {
        messageIndex: 2,
        passageStartIndex: 1,
        evaluationCoverageRequired: true,
        deliveryMaximumAttempts: 3,
    });
    state = applied.state;
    assert.equal(state.eventRuntime['trigger:arrival'].deliveryStatus, 'pending');
    assert.equal(state.eventRuntime['trigger:arrival'].deliveryAttempts, 1);
    assert.equal(applied.triggerEventResult.deliveryRetries.length, 1);
    assert.equal(hasTriggerEventDeliveryAwaitingVerification(state, 2), false);

    state = markTriggerEventDeliveriesInjected(state, [
        { definitionId: 'trigger:arrival', kind: 'observable' },
    ], {
        messageIndex: 3,
        generationId: 'story:second',
        prompt: '<inner_lore_trigger_delivery>The Courier Arrives</inner_lore_trigger_delivery>',
    }).state;
    applied = applyProgressionPatch(state, patch(1, [{
        key: 'arrival',
        evaluated: true,
        reason: 'The courier is now visibly present.',
        public_reveal: {
            matched: true,
            evidence: ['The courier runs through the open gate.'],
            message_indexes: [4],
        },
    }]), {
        messageIndex: 4,
        passageStartIndex: 3,
        evaluationCoverageRequired: true,
        deliveryMaximumAttempts: 3,
    });
    state = applied.state;
    const runtime = state.eventRuntime['trigger:arrival'];
    assert.equal(runtime.status, 'revealed');
    assert.equal(runtime.deliveryStatus, 'delivered');
    assert.equal(runtime.deliveryAttempts, 2);
    assert.deepEqual(runtime.deliveryEvidence, ['The courier runs through the open gate.']);
    assert.deepEqual(runtime.lastEvaluation.matched, ['public_reveal']);
    assert.deepEqual(runtime.lastEvaluation.accepted, ['public_reveal']);
    assert.deepEqual(runtime.lastEvaluation.conditions.public_reveal.messageIndexes, [4]);
    assert.equal(applied.triggerEventResult.deliveryConfirmed.length, 1);
});

test('delivery receipts keep the original generation boundary until verification', () => {
    let state = createProgressionState();
    state = upsertTriggerEventDefinition(state, {
        id: 'trigger:pigeon',
        key: 'pigeon',
        title: 'The slate pigeon lands',
        description: 'A slate-grey pigeon lands on the kitchen sill carrying a red-thread message.',
        enabled: true,
        triggerAfterSeconds: 0,
        activationVisibility: 'observable',
    }, { clock: state.clock, messageIndex: -1 }).state;
    state = applyProgressionPatch(state, patch(0), { messageIndex: 20, passageStartIndex: 20 }).state;

    state = markTriggerEventDeliveriesInjected(state, [
        { definitionId: 'trigger:pigeon', kind: 'observable' },
    ], { messageIndex: 20, generationId: 'story:turn-21', prompt: 'pigeon' }).state;
    state = markTriggerEventDeliveriesInjected(state, [
        { definitionId: 'trigger:pigeon', kind: 'observable' },
    ], { messageIndex: 22, generationId: 'story:turn-23', prompt: 'pigeon' }).state;

    const runtime = state.eventRuntime['trigger:pigeon'];
    assert.equal(runtime.deliveryFirstInjectedAtMessage, 20);
    assert.equal(runtime.deliveryLastInjectedAtMessage, 20);
    assert.equal(runtime.deliveryLastGenerationId, 'story:turn-21');
    assert.deepEqual(runtime.deliveryInjectionReceipts.map(receipt => ({
        generationId: receipt.generationId,
        messageIndex: receipt.messageIndex,
        status: receipt.status,
    })), [{ generationId: 'story:turn-21', messageIndex: 20, status: 'injected' }]);
    assert.equal(hasTriggerEventDeliveryAwaitingVerification(state, 21), true);
});

test('completed foreground prose immediately confirms an immutable delivery receipt', () => {
    let state = createProgressionState();
    state = upsertTriggerEventDefinition(state, {
        id: 'trigger:pigeon_local',
        key: 'pigeon_local',
        title: 'The slate pigeon lands',
        description: 'A slate-grey pigeon lands on the kitchen sill carrying a red-thread message.',
        enabled: true,
        triggerAfterSeconds: 0,
        activationVisibility: 'observable',
    }, { clock: state.clock, messageIndex: -1 }).state;
    state = applyProgressionPatch(state, patch(0), { messageIndex: 20, passageStartIndex: 20 }).state;
    state = markTriggerEventDeliveriesInjected(state, [
        { definitionId: 'trigger:pigeon_local', kind: 'observable' },
    ], { messageIndex: 20, generationId: 'story:pigeon', prompt: 'pigeon' }).state;

    const verified = verifyTriggerEventDeliveriesFromStory(
        state,
        'A slate-grey pigeon lands on the kitchen sill, its red-thread message tight around one leg.',
        { messageIndex: 21 },
    );
    const runtime = verified.state.eventRuntime['trigger:pigeon_local'];
    assert.equal(verified.changed, true);
    assert.equal(runtime.status, 'revealed');
    assert.equal(runtime.deliveryStatus, 'delivered');
    assert.equal(runtime.deliveryAttempts, 0, 'positive local verification needs no semantic retry cycle');
    assert.equal(runtime.deliveryInjectionReceipts[0].status, 'delivered');
    assert.equal(runtime.deliveryInjectionReceipts[0].verifiedAtMessage, 21);
    assert.match(runtime.revealEvidence[0], /locally matched/u);
    assert.equal(hasTriggerEventDeliveryAwaitingVerification(verified.state, 21), false);
});

test('completed story text can locally confirm a same-reply delivery when the evaluator omits public_reveal', () => {
    let state = createProgressionState();
    state = upsertTriggerEventDefinition(state, {
        id: 'trigger:gate_alarm',
        key: 'gate_alarm',
        title: 'The east-gate alarm responds',
        description: 'The bronze alarm bell rings and the east portcullis begins lowering.',
        enabled: true,
        actionCondition: 'Jet pulls the emergency lever.',
        actionTiming: 'same_reply_attempt',
        actorScope: 'player',
        activationVisibility: 'observable',
    }, { clock: state.clock, messageIndex: 0, playerName: 'Jet' }).state;
    state = markTriggerEventDeliveriesInjected(state, [
        { definitionId: 'trigger:gate_alarm', kind: 'attempt_preview' },
    ], { messageIndex: 1, generationId: 'story:gate-alarm', prompt: 'conditional event' }).state;

    const applied = applyProgressionPatch(state, patch(1, [match(
        'gate_alarm',
        'Jet',
        'Jet pulls the emergency lever.',
        1,
    )]), {
        messageIndex: 2,
        passageStartIndex: 1,
        playerName: 'Jet',
        passageText: '[message 1; PLAYER — Jet]\nI pull the emergency lever.\n\n[message 2; STORY — Narrator]\nThe bronze alarm bell rings as the east portcullis begins lowering.',
    });

    assert.equal(applied.state.eventRuntime['trigger:gate_alarm'].status, 'revealed');
    assert.equal(applied.state.eventRuntime['trigger:gate_alarm'].deliveryStatus, 'delivered');
    assert.match(applied.state.eventRuntime['trigger:gate_alarm'].revealEvidence[0], /locally matched/u);
    assert.equal(applied.triggerEventResult.deliveryConfirmed.length, 1);
    assert.match(applied.triggerEventResult.deliveryConfirmed[0].evidence[0], /locally matched/u);
});

test('completed after-outcome NPC action and consequences do not wait for a redundant delivery pass', () => {
    let state = createProgressionState();
    state = upsertTriggerEventDefinition(state, {
        id: 'trigger:beacon',
        key: 'beacon',
        title: 'Mara lights the blue beacon',
        description: 'Mara Vale lights the blue beacon and the distant bridge begins rotating toward the quay.',
        enabled: true,
        actionCondition: 'Mara Vale lights the blue beacon.',
        actionTiming: 'after_outcome',
        actorScope: 'named',
        actorName: 'Mara Vale',
        activationVisibility: 'observable',
    }, { clock: state.clock, messageIndex: 0 }).state;

    const applied = applyProgressionPatch(state, patch(1, [match(
        'beacon',
        'Mara Vale',
        'Mara Vale lights the blue beacon.',
        2,
    )]), {
        messageIndex: 2,
        passageStartIndex: 1,
        passageText: '[message 1; PLAYER — Jet]\nI wait.\n\n[message 2; STORY — Narrator]\nMara Vale lights the blue beacon. The distant bridge begins rotating toward the quay.',
        playerName: 'Jet',
    });

    assert.equal(applied.state.eventRuntime['trigger:beacon'].status, 'revealed');
    assert.equal(applied.state.eventRuntime['trigger:beacon'].deliveryStatus, 'delivered');
    assert.match(applied.state.eventRuntime['trigger:beacon'].revealEvidence[0], /locally matched/u);
    assert.equal(applied.triggerEventResult.deliveryConfirmed.length, 1);
});

test('delivery stops after verified failures and can be manually retried', () => {
    let state = createProgressionState();
    state = upsertTriggerEventDefinition(state, {
        id: 'trigger:alarm',
        key: 'alarm',
        title: 'The Alarm Sounds',
        enabled: true,
        triggerAfterSeconds: 0,
        activationVisibility: 'observable',
    }, { clock: state.clock, messageIndex: -1 }).state;
    state = applyProgressionPatch(state, patch(0), { messageIndex: 0, passageStartIndex: 0 }).state;

    for (let attempt = 1; attempt <= 2; attempt++) {
        state = markTriggerEventDeliveriesInjected(state, [
            { definitionId: 'trigger:alarm', kind: 'observable' },
        ], {
            messageIndex: attempt * 2 - 1,
            generationId: `story:${attempt}`,
            prompt: 'The Alarm Sounds',
        }).state;
        state = applyProgressionPatch(state, patch(1, [{
            key: 'alarm',
            evaluated: true,
            reason: 'The completed reply did not establish the alarm.',
        }]), {
            messageIndex: attempt * 2,
            passageStartIndex: attempt * 2 - 1,
            evaluationCoverageRequired: true,
            deliveryMaximumAttempts: 2,
        }).state;
    }

    assert.equal(state.eventRuntime['trigger:alarm'].deliveryStatus, 'failed');
    assert.equal(state.eventRuntime['trigger:alarm'].deliveryAttempts, 2);
    assert.doesNotMatch(buildProgressionInjection(state, 'The hall remains quiet.'), /The Alarm Sounds/u);

    state = retryTriggerEventDelivery(state, 'trigger:alarm').state;
    assert.equal(state.eventRuntime['trigger:alarm'].deliveryStatus, 'pending');
    assert.equal(state.eventRuntime['trigger:alarm'].deliveryAttempts, 0);
    assert.match(buildProgressionInjection(state, 'The hall remains quiet.'), /The Alarm Sounds/u);
});

test('semantic action triggers enforce source message age and player/NPC ownership', () => {
    let state = createProgressionState();
    state = upsertTriggerEventDefinition(state, {
        id: 'trigger:open_vault',
        key: 'open_vault',
        title: 'The Vault Responds',
        enabled: true,
        actionCondition: 'The player opens the sealed vault.',
        actorScope: 'player',
        activationVisibility: 'hidden',
    }, { clock: state.clock, messageIndex: 10 }).state;

    state = applyProgressionPatch(state, patch(5, [
        match('open_vault', 'Jet', 'Jet opens the vault in the message where the watcher was created.', 10),
    ]), { messageIndex: 10, passageStartIndex: 10, playerName: 'Jet' }).state;
    assert.equal(state.eventRuntime['trigger:open_vault'].status, 'armed', 'the creation-boundary message is not retroactive evidence');

    state = applyProgressionPatch(state, patch(5, [
        match('open_vault', 'Freesia', 'Freesia opens the sealed vault.', 11),
    ]), { messageIndex: 11, passageStartIndex: 11, playerName: 'Jet' }).state;
    assert.equal(state.eventRuntime['trigger:open_vault'].status, 'armed', 'an NPC action cannot satisfy a player trigger');

    state = applyProgressionPatch(state, patch(5, [
        match('open_vault', 'Jet', 'Jet opened the sealed vault in an old message.', 9),
    ]), { messageIndex: 12, passageStartIndex: 9, playerName: 'Jet' }).state;
    assert.equal(state.eventRuntime['trigger:open_vault'].status, 'armed', 'pre-definition evidence must be rejected');

    state = applyProgressionPatch(state, patch(5, [
        match('open_vault', 'Jet', 'Jet turns the key and opens the sealed vault.', 13),
    ]), { messageIndex: 13, passageStartIndex: 13, playerName: 'Jet' }).state;
    assert.equal(state.eventRuntime['trigger:open_vault'].status, 'active');
    assert.equal(state.eventRuntime['trigger:open_vault'].actionActor, 'Jet');
    assert.equal(state.eventRuntime['trigger:open_vault'].actionMatchedAtMessage, 13);
    assert.equal(state.eventRuntime['trigger:open_vault'].conditionSatisfiedAtMessage, 13);
    assert.equal(state.eventRuntime['trigger:open_vault'].stateTransitionRecordedAtMessage, 13);
    assert.deepEqual(state.eventRuntime['trigger:open_vault'].triggerEvidence, [
        'Jet turns the key and opens the sealed vault.',
    ]);

    state = upsertTriggerEventDefinition(state, {
        id: 'trigger:named_al',
        key: 'named_al',
        title: 'Al Acts',
        enabled: true,
        actionCondition: 'Al rings the bell.',
        actorScope: 'named',
        actorName: 'Al',
    }, { clock: state.clock, messageIndex: 13 }).state;
    state = applyProgressionPatch(state, patch(1, [
        match('named_al', 'Aldric', 'Aldric rings the bell.', 15),
    ]), { messageIndex: 15, passageStartIndex: 14, playerName: 'Jet' }).state;
    assert.equal(state.eventRuntime['trigger:named_al'].status, 'armed', 'partial character names must never cross-trigger');
});

test('hidden resolution evidence records observable and revealed transitions before resolved', () => {
    let state = createProgressionState();
    state = upsertTriggerEventDefinition(state, {
        id: 'trigger:missing_tack',
        key: 'missing_tack',
        title: 'The missing tack is found',
        enabled: true,
        triggerAfterSeconds: 0,
        activationVisibility: 'hidden',
        resolutionCondition: 'The missing saddle and bridle are recovered.',
    }, { clock: state.clock, messageIndex: -1 }).state;
    state = applyProgressionPatch(state, patch(0), { messageIndex: 0, passageStartIndex: 0 }).state;
    assert.equal(state.eventRuntime['trigger:missing_tack'].status, 'active');

    const applied = applyProgressionPatch(state, patch(1, [{
        key: 'missing_tack',
        resolution: {
            matched: true,
            evidence: ['The stablehand returns the missing saddle and bridle in the courtyard.'],
            message_indexes: [2],
        },
    }]), { messageIndex: 2, passageStartIndex: 1 });

    assert.equal(applied.state.eventRuntime['trigger:missing_tack'].status, 'resolved');
    assert.equal(applied.state.eventRuntime['trigger:missing_tack'].deliveryStatus, 'delivered');
    assert.deepEqual(
        applied.triggerEventResult.transitions.map(transition => `${transition.previous}->${transition.status}`),
        ['active->observable', 'observable->revealed', 'revealed->resolved'],
    );
});

test('relative-time creation anchors are reconstructed from the selected branch clock', () => {
    let oldBranch = createProgressionState();
    oldBranch.clock.minimumSeconds = 900;
    oldBranch.clock.estimatedSeconds = 1_000;
    oldBranch.clock.maximumSeconds = 1_100;
    oldBranch = upsertTriggerEventDefinition(oldBranch, {
        id: 'trigger:relative_timer',
        key: 'relative_timer',
        title: 'Relative Timer',
        enabled: true,
        triggerAfterSeconds: 60,
        timeBasis: 'after_creation',
    }, { clock: oldBranch.clock, messageIndex: 10 }).state;

    let rebuilt = createProgressionState();
    rebuilt.eventDefinitions = structuredClone(oldBranch.eventDefinitions);
    rebuilt = resetTriggerEventRuntime(rebuilt, { replayCreationAnchors: true });
    rebuilt = applyProgressionPatch(rebuilt, patch(40), {
        messageIndex: 10,
        passageStartIndex: 0,
    }).state;
    assert.equal(rebuilt.eventDefinitions['trigger:relative_timer'].createdAtElapsedSeconds, 40);
    assert.equal(rebuilt.eventRuntime['trigger:relative_timer'].status, 'armed');

    rebuilt = applyProgressionPatch(rebuilt, patch(59), {
        messageIndex: 12,
        passageStartIndex: 11,
    }).state;
    assert.equal(rebuilt.eventRuntime['trigger:relative_timer'].status, 'armed');
    rebuilt = applyProgressionPatch(rebuilt, patch(1), {
        messageIndex: 14,
        passageStartIndex: 13,
    }).state;
    assert.equal(rebuilt.eventRuntime['trigger:relative_timer'].status, 'active');

    let lagging = createProgressionState();
    lagging.clock.minimumSeconds = 10;
    lagging.clock.estimatedSeconds = 10;
    lagging.clock.maximumSeconds = 10;
    lagging.lastProcessedIndex = 1;
    lagging = upsertTriggerEventDefinition(lagging, {
        id: 'trigger:pending_clock',
        key: 'pending_clock',
        title: 'Pending Clock Anchor',
        enabled: true,
        triggerAfterSeconds: 30,
        timeBasis: 'after_creation',
    }, { clock: lagging.clock, messageIndex: 5 }).state;
    assert.equal(lagging.eventRuntime['trigger:pending_clock'].creationAnchorPending, true,
        'saving while progression lags must defer the relative clock anchor');
    lagging = applyProgressionPatch(lagging, patch(20), {
        messageIndex: 5,
        passageStartIndex: 2,
    }).state;
    assert.equal(lagging.eventDefinitions['trigger:pending_clock'].createdAtElapsedSeconds, 30);
    assert.equal(lagging.eventRuntime['trigger:pending_clock'].status, 'armed');
});

test('an all-mode event latches a completed action until its time threshold is reached', () => {
    let state = createProgressionState();
    state = upsertTriggerEventDefinition(state, {
        id: 'trigger:guard_gap',
        key: 'guard_gap',
        title: 'Treasury Robbery',
        enabled: true,
        triggerMode: 'all',
        triggerAfterSeconds: 60,
        actionCondition: 'A guard leaves the treasury post.',
        actorScope: 'npc',
        activationVisibility: 'hidden',
    }, { clock: state.clock, messageIndex: -1 }).state;

    state = applyProgressionPatch(state, patch(20, [
        match('guard_gap', 'Captain Vey', 'Captain Vey leaves the treasury post.', 2),
    ]), { messageIndex: 2, passageStartIndex: 1, playerName: 'Jet' }).state;
    assert.equal(state.eventRuntime['trigger:guard_gap'].status, 'armed');
    assert.equal(state.eventRuntime['trigger:guard_gap'].actionMatched, true);

    state = applyProgressionPatch(state, patch(40), {
        messageIndex: 4,
        passageStartIndex: 3,
        playerName: 'Jet',
    }).state;
    assert.equal(state.eventRuntime['trigger:guard_gap'].status, 'active');
    assert.equal(state.eventRuntime['trigger:guard_gap'].activationCount, 1);
});

test('cancellation, revelation, public disclosure, resolution, re-arming, and deletion are explicit', () => {
    let state = createProgressionState();
    state = upsertTriggerEventDefinition(state, {
        id: 'trigger:war',
        key: 'war',
        title: 'Border War',
        enabled: true,
        triggerAfterSeconds: 10,
        cancellationCondition: 'A peace treaty is signed before war begins.',
        revealCondition: 'A messenger reaches the current scene.',
        resolutionCondition: 'A signed armistice ends the fighting.',
        activationVisibility: 'hidden',
    }, { clock: state.clock, messageIndex: -1 }).state;
    state = applyProgressionPatch(state, patch(10), { messageIndex: 2, passageStartIndex: 1 }).state;
    assert.equal(state.eventRuntime['trigger:war'].status, 'active');

    state = applyProgressionPatch(state, patch(1, [{
        key: 'war',
        revelation: { matched: true, evidence: ['A messenger arrives at the manor gate.'], message_indexes: [4] },
    }]), { messageIndex: 4, passageStartIndex: 3 }).state;
    assert.equal(state.eventRuntime['trigger:war'].status, 'observable');

    state = applyProgressionPatch(state, patch(1, [{
        key: 'war',
        public_reveal: { matched: true, evidence: ['The messenger announces that war has begun.'], message_indexes: [6] },
    }]), { messageIndex: 6, passageStartIndex: 5 }).state;
    assert.equal(state.eventRuntime['trigger:war'].status, 'revealed');

    state = applyProgressionPatch(state, patch(1, [{
        key: 'war',
        resolution: { matched: true, evidence: ['Both sides sign the armistice.'], message_indexes: [8] },
    }]), { messageIndex: 8, passageStartIndex: 7 }).state;
    assert.equal(state.eventRuntime['trigger:war'].status, 'resolved');
    assert.doesNotMatch(buildProgressionInjection(state, 'The border is quiet.'), /Border War/u);

    state.processes['process:war_aftershock'] = {
        id: 'process:war_aftershock',
        key: 'war_aftershock',
        title: 'War Aftershock',
        sourceEventKey: 'war',
    };

    state = rearmTriggerEvent(state, 'trigger:war', {
        clock: state.clock,
        messageIndex: 8,
        resetCreationAnchor: true,
    }).state;
    assert.equal(state.eventRuntime['trigger:war'].status, 'armed');
    assert.equal(state.processes['process:war_aftershock'], undefined,
        're-arming removes progression records derived from the prior activation');
    assert.equal(state.eventDefinitions['trigger:war'].createdAtElapsedSeconds, 13);

    state = upsertTriggerEventDefinition(state, {
        id: 'trigger:cancelled_raid',
        key: 'cancelled_raid',
        title: 'Cancelled Raid',
        enabled: true,
        triggerAfterSeconds: 60,
        cancellationCondition: 'The raiders accept payment and withdraw.',
    }, { clock: state.clock, messageIndex: 8 }).state;
    state = applyProgressionPatch(state, patch(1, [{
        key: 'cancelled_raid',
        cancellation: { matched: true, evidence: ['The raiders take payment and withdraw.'], message_indexes: [10] },
    }]), { messageIndex: 10, passageStartIndex: 9 }).state;
    assert.equal(state.eventRuntime['trigger:cancelled_raid'].status, 'cancelled');

    let removed = removeTriggerEventDefinition(state, 'trigger:war');
    assert.equal(removed.removed.title, 'Border War');
    removed = removeTriggerEventDefinition(removed.state, 'trigger:cancelled_raid');
    assert.deepEqual(removed.state.eventDefinitions, {});
    assert.deepEqual(removed.state.eventRuntime, {});
});

test('a hidden reveal route cannot also skip the foreground delivery boundary in the same pass', () => {
    let state = createProgressionState();
    state = upsertTriggerEventDefinition(state, {
        id: 'trigger:sluice',
        key: 'sluice',
        title: 'Reservoir sluice opened',
        description: 'A runner reports that the reservoir sluice is open.',
        enabled: true,
        triggerAfterSeconds: 0,
        activationVisibility: 'hidden',
        revealCondition: 'The flood-warning bell sounds.',
    }, { clock: state.clock, messageIndex: -1 }).state;
    state = applyProgressionPatch(state, patch(0), { messageIndex: 0, passageStartIndex: 0 }).state;
    assert.equal(state.eventRuntime['trigger:sluice'].status, 'active');

    state = applyProgressionPatch(state, patch(1, [{
        key: 'sluice',
        revelation: { matched: true, evidence: ['The flood-warning bell sounds.'], message_indexes: [2] },
        public_reveal: { matched: true, evidence: ['The flood-warning bell sounds.'], message_indexes: [2] },
    }]), { messageIndex: 2, passageStartIndex: 1 }).state;

    assert.equal(state.eventRuntime['trigger:sluice'].status, 'observable');
    assert.equal(state.eventRuntime['trigger:sluice'].deliveryStatus, 'pending');
    assert.deepEqual(state.eventRuntime['trigger:sluice'].lastEvaluation.accepted, ['revelation']);
    assert.equal(triggerEventAgentSnapshot(state, { currentIndex: 3 }).length, 1);

    state = markTriggerEventDeliveriesInjected(state, [{ definitionId: 'trigger:sluice', kind: 'observable' }], {
        messageIndex: 3,
        generationId: 'story:sluice',
        prompt: 'Reservoir sluice opened',
    }).state;
    state = applyProgressionPatch(state, patch(1, [{
        key: 'sluice',
        public_reveal: { matched: true, evidence: ['The runner reports that the sluice is open.'], message_indexes: [4] },
    }]), { messageIndex: 4, passageStartIndex: 3 }).state;

    assert.equal(state.eventRuntime['trigger:sluice'].status, 'revealed');
    assert.equal(state.eventRuntime['trigger:sluice'].deliveryStatus, 'delivered');
    assert.equal(triggerEventAgentSnapshot(state, { currentIndex: 5 }).length, 0,
        'a revealed event without a resolution condition no longer consumes evaluator tokens');
});

test('fifty hidden watchers remain one-shot and bounded across a long context', () => {
    let state = createProgressionState();
    for (let index = 1; index <= 50; index++) {
        state = upsertTriggerEventDefinition(state, {
            id: `trigger:watcher_${index}`,
            key: `watcher_${index}`,
            title: `Hidden watcher ${index}`,
            enabled: true,
            triggerAfterSeconds: index * 10,
            activationVisibility: 'hidden',
            consequences: `Advance background process ${index}.`,
            priority: 50,
        }, { clock: state.clock, messageIndex: -1 }).state;
    }

    for (let turn = 1; turn <= 1_200; turn++) {
        state = applyProgressionPatch(state, patch(1), {
            messageIndex: turn * 2,
            passageStartIndex: turn * 2 - 1,
            playerName: 'Jet',
        }).state;
    }

    const stats = getTriggerEventStats(state);
    assert.equal(stats.definitions, 50);
    assert.equal(stats.active, 50);
    assert.ok(Object.values(state.eventRuntime).every(runtime => runtime.activationCount === 1));
    assert.ok(state.log.length <= 160, 'event transition audit history must stay bounded');
    const injection = buildProgressionInjection(state, 'An unrelated quiet room.');
    assert.doesNotMatch(injection, /Hidden watcher/u, 'hidden background events must not consume narrative context');
});

test('the progression agent receives editor definitions and evidence-bound evaluation rules', () => {
    let state = createProgressionState();
    state = upsertTriggerEventDefinition(state, {
        id: 'trigger:robbery',
        key: 'robbery',
        title: 'Treasury Robbery',
        enabled: true,
        triggerAfterSeconds: 600,
        actionCondition: 'The guard leaves the treasury post.',
        actorScope: 'npc',
        activationVisibility: 'hidden',
        revealCondition: 'Someone discovers the emptied treasury.',
        consequences: 'The thieves escape and begin moving the stolen items off-screen.',
    }, { clock: state.clock, messageIndex: 4 }).state;

    const messages = buildProgressionMessages({
        transcript: '[message 5; PLAYER — Jet]\nI ask the guard to stay.\n\n[message 6; STORY — Narrator]\nThe guard remains at the post.',
        progression: state,
        store: { entities: {}, brains: {} },
        characterCard: 'A scenario-neutral test world.',
        playerName: 'Jet',
        currentIndex: 6,
        settings: { progressionAutonomy: 'simulation', progressionTimeMode: 'balanced' },
    });
    const system = messages[0].content;
    const user = messages[1].content;

    assert.match(system, /exactly five top-level fields/u);
    assert.match(system, /Only definitions supplied in TRIGGERABLE_EVENT_DEFINITIONS/u);
    assert.match(system, /message_indexes/u);
    assert.match(system, /intention, hypothetical, refusal, failed attempt/u);
    assert.match(system, /active means objectively underway but hidden/u);
    assert.match(system, /source_event_key/u);
    assert.match(system, /withholds it from story generation/u);
    assert.match(user, /<TRIGGERABLE_EVENT_DEFINITIONS>/u);
    assert.match(user, /"key":"robbery"/u);
    assert.match(user, /"actor_scope":"npc"/u);
    assert.match(user, /The thieves escape/u);
});

test('the InnerLore editor exposes every trigger-event control with unique DOM ids', async () => {
    const html = await readFile(new URL('../settings.html', import.meta.url), 'utf8');
    const source = await readFile(new URL('../index.js', import.meta.url), 'utf8');
    for (const id of [
        'il_add_trigger_event',
        'il_trigger_event_select',
        'il_trigger_event_time_amount',
        'il_trigger_event_action',
        'il_trigger_event_action_timing',
        'il_trigger_event_visibility',
        'il_trigger_event_reveal_condition',
        'il_trigger_event_consequences',
        'il_save_trigger_event',
        'il_rearm_trigger_event',
        'il_retry_trigger_event_delivery',
        'il_delete_trigger_event',
    ]) {
        assert.match(html, new RegExp(`id="${id}"`, 'u'));
    }
    const ids = [...html.matchAll(/\sid="([^"]+)"/gu)].map(match => match[1]);
    assert.equal(new Set(ids).size, ids.length, 'settings controls must not have duplicate ids');
    assert.match(html, /Create Draft/u);
    assert.match(html, /Event names are labels only/u);
    assert.match(html, /Save &amp; Arm Event/u);
    assert.match(html, /Time trigger:<\/b> fire after this amount/u);
    assert.match(html, /Enable and arm when saved/u);
    assert.match(source, /getElementById\('il_trigger_event_actor_scope'\)\?\.addEventListener\('change'/u,
        'choosing a named actor must reveal its editor field immediately');
    assert.match(source, /getElementById\('il_trigger_event_enabled'\)\?\.addEventListener\('change'/u,
        'the save button must react immediately when the event is enabled');
    assert.match(source, /Save &amp; Arm Event/u);
    assert.match(source, /Save Draft \(Disabled\)/u);
});
