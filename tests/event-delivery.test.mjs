import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
    compileTriggerEventDeliveryPreview,
    explicitUserTimeAdvanceSeconds,
    pendingExplicitUserTimeAdvanceSeconds,
} from '../event-delivery.js';
import { buildProgressionInjection, createProgressionState } from '../progression.js';
import { upsertTriggerEventDefinition } from '../trigger-events.js';

function messagesThrough(index) {
    return Array.from({ length: index + 1 }, () => ({ is_user: false, is_system: false, mes: 'Story.' }));
}

function timedEvent(overrides = {}) {
    let state = createProgressionState();
    state.clock = {
        minimumSeconds: 1_208,
        estimatedSeconds: 1_208,
        maximumSeconds: 1_208,
        confidence: 1,
        currentTimeLabel: '',
    };
    state.lastProcessedIndex = 22;
    const result = upsertTriggerEventDefinition(state, {
        id: 'trigger:break_in',
        key: 'break_in',
        title: 'A burglar attempts to break in',
        description: 'The burglar starts forcing the kitchen window.',
        enabled: true,
        triggerAfterSeconds: 300,
        timeBasis: 'after_creation',
        triggerTimeCertainty: 'estimated',
        activationVisibility: 'observable',
        priority: 90,
        ...overrides,
    }, { clock: state.clock, messageIndex: 22 });
    return result.state;
}

test('explicit time parser accepts completed advances but not future plans', () => {
    assert.equal(explicitUserTimeAdvanceSeconds('5 minutes pass in the kitchen with Dani.'), 300);
    assert.equal(explicitUserTimeAdvanceSeconds('Five minutes later, I check the door.'), 300);
    assert.equal(explicitUserTimeAdvanceSeconds('Three full days pass before I return.'), 259_200);
    assert.equal(explicitUserTimeAdvanceSeconds('After a whole hour, we return.'), 3_600);
    assert.equal(explicitUserTimeAdvanceSeconds('We rested for two complete weeks.'), 1_209_600);
    assert.equal(explicitUserTimeAdvanceSeconds('After 2 hours, we return.'), 7_200);
    assert.equal(explicitUserTimeAdvanceSeconds('I wait for 30 seconds.'), 30);
    assert.equal(explicitUserTimeAdvanceSeconds('In five minutes we should leave.'), 0);
    assert.equal(explicitUserTimeAdvanceSeconds('Three full days should be enough time.'), 0);
});

test('pending time advances count player turns only and at most once per turn', () => {
    const messages = messagesThrough(4);
    messages[1] = { is_user: true, is_system: false, mes: 'Five minutes pass; after five minutes, I stand.' };
    messages[2] = { is_user: false, is_system: false, mes: 'Five minutes later, the narrator replies.' };
    messages[3] = { is_user: true, is_system: true, mes: 'After five minutes.' };
    messages[4] = { is_user: true, is_system: false, mes: 'I wait for 30 seconds.' };
    assert.equal(pendingExplicitUserTimeAdvanceSeconds(messages, 0, 4), 330);
});

test('the Dani-style five-minute turn crosses the threshold before narration', () => {
    const state = timedEvent();
    const messages = messagesThrough(23);
    messages[23] = { is_user: true, is_system: false, mes: '5 minutes pass in the kitchen with Dani' };
    const result = compileTriggerEventDeliveryPreview(state, messages, { currentIndex: 23 });

    assert.equal(result.previewSeconds, 300);
    assert.deepEqual(result.records.map(record => record.key), ['break_in']);
    assert.match(result.text, /mandatory="true"/u);
    assert.match(result.text, /threshold="CROSSED_THIS_TURN"/u);
    assert.match(result.text, /DELIVERY_MODE: MUST_HAPPEN_NOW/u);
    assert.match(result.text, /reference to the event title or actor alone is insufficient/iu);
    assert.match(result.text, /IDENTITY_POLICY: SUPPLIED_ONLY/u);
    assert.match(result.text, /NEVER QUOTE, PARAPHRASE/u);
});

test('relative timers ignore unprocessed time skips from before event creation', () => {
    const state = timedEvent();
    state.lastProcessedIndex = 18;
    const messages = messagesThrough(23);
    messages[20] = { is_user: true, is_system: false, mes: 'Ten minutes pass.' };
    messages[23] = { is_user: true, is_system: false, mes: 'Four minutes pass.' };
    const result = compileTriggerEventDeliveryPreview(state, messages, { currentIndex: 23 });

    assert.equal(result.previewSeconds, 240);
    assert.equal(result.records.length, 0);
    assert.equal(result.text, '');
});

test('hidden events never leak through the provisional delivery path', () => {
    const state = timedEvent({ activationVisibility: 'hidden' });
    const messages = messagesThrough(23);
    messages[23] = { is_user: true, is_system: false, mes: 'Five minutes pass.' };
    const result = compileTriggerEventDeliveryPreview(state, messages, { currentIndex: 23 });

    assert.equal(result.records.length, 0);
    assert.equal(result.text, '');
});

test('all-mode events wait for the semantic action half of the trigger', () => {
    const state = timedEvent({
        triggerMode: 'all',
        actionCondition: 'Dani locks the kitchen door.',
        actorScope: 'npc',
    });
    const messages = messagesThrough(23);
    messages[23] = { is_user: true, is_system: false, mes: 'Five minutes pass.' };
    assert.equal(
        compileTriggerEventDeliveryPreview(state, messages, { currentIndex: 23 }).records.length,
        0,
    );

    state.eventRuntime['trigger:break_in'].actionMatched = true;
    assert.deepEqual(
        compileTriggerEventDeliveryPreview(state, messages, { currentIndex: 23 }).records.map(record => record.key),
        ['break_in'],
    );
});

test('an observable event stays mandatory across a progression provider failure', () => {
    const state = timedEvent();
    state.eventRuntime['trigger:break_in'].status = 'observable';
    state.lastError = 'socket hang up';
    const result = compileTriggerEventDeliveryPreview(state, messagesThrough(24), { currentIndex: 24 });

    assert.deepEqual(result.records.map(record => record.key), ['break_in']);
    assert.match(result.text, /threshold="ALREADY_OBSERVABLE"/u);
    assert.match(result.text, /observable and has not yet appeared/iu);
    const normalInjection = buildProgressionInjection(state, 'Dani remains in the kitchen.');
    assert.match(normalInjection, /MANDATORY DELIVERY NOW/u);
    assert.doesNotMatch(normalInjection, /observable event may now affect/u);
});

test('an injected delivery is reserved for its receipt generation until verification', () => {
    const state = timedEvent();
    state.eventRuntime['trigger:break_in'].status = 'observable';
    state.eventRuntime['trigger:break_in'].deliveryStatus = 'injected';
    state.eventRuntime['trigger:break_in'].deliveryLastGenerationId = 'story:original';
    state.eventRuntime['trigger:break_in'].deliveryLastInjectedAtMessage = 23;
    state.eventRuntime['trigger:break_in'].deliveryInjectionReceipts = [{
        generationId: 'story:original',
        messageIndex: 23,
        injectedAt: 1,
        verifiedAtMessage: -1,
        status: 'injected',
    }];

    assert.deepEqual(compileTriggerEventDeliveryPreview(state, messagesThrough(24), {
        currentIndex: 24,
        generationId: 'story:original',
    }).records.map(record => record.key), ['break_in']);
    assert.equal(compileTriggerEventDeliveryPreview(state, messagesThrough(25), {
        currentIndex: 25,
        generationId: 'story:later',
    }).records.length, 0);
});

test('same-reply action mode conditionally reaches the story model without forcing success', () => {
    const state = timedEvent({
        triggerAfterSeconds: null,
        actionCondition: 'The player opens the sealed vault.',
        actionTiming: 'same_reply_attempt',
        actorScope: 'player',
    });
    const messages = messagesThrough(23);
    messages[23] = { is_user: true, is_system: false, mes: 'I try to open the sealed vault.' };
    const result = compileTriggerEventDeliveryPreview(state, messages, {
        currentIndex: 23,
        playerName: 'Jet',
    });

    assert.deepEqual(result.records.map(record => record.key), ['break_in']);
    assert.deepEqual(result.deliveries, [{ definitionId: 'trigger:break_in', kind: 'attempt_preview' }]);
    assert.match(result.text, /mandatory="false"/u);
    assert.match(result.text, /DELIVERY_MODE: CONDITIONAL_SAME_REPLY/u);
    assert.match(result.text, /an intention, hypothetical, refusal, or failed attempt is not success/u);
    assert.match(result.text, /delivery_boundary":"onset_only_do_not_complete/u);
    assert.match(result.text, /authorizes onset, never completion/u);
});

test('same-reply previews exclude armed actions irrelevant to the latest player turn', () => {
    let state = timedEvent({
        triggerAfterSeconds: null,
        actionCondition: 'Jet cuts the taut red warning rope at the Old Quarry.',
        actionTiming: 'same_reply_attempt',
        actorScope: 'player',
    });
    state = upsertTriggerEventDefinition(state, {
        id: 'trigger:range_bell',
        key: 'range_bell',
        title: 'The range bell responds',
        description: 'The iron bell rings twice.',
        enabled: true,
        actionCondition: 'Jet pulls the frayed blue safety-bell cord at the archery range.',
        actionTiming: 'same_reply_attempt',
        actorScope: 'player',
        activationVisibility: 'observable',
    }, { clock: state.clock, messageIndex: 22 }).state;
    const messages = messagesThrough(23);
    messages[23] = {
        is_user: true,
        is_system: false,
        mes: 'Keeping everyone behind the chalk line, I pull the frayed blue cord once.',
    };

    const relevant = compileTriggerEventDeliveryPreview(state, messages, {
        currentIndex: 23,
        playerName: 'Jet',
    });
    assert.deepEqual(relevant.records.map(record => record.key), ['range_bell']);
    assert.doesNotMatch(relevant.text, /Old Quarry/u);

    messages[23].mes = 'I inspect the taut red warning rope at the Old Quarry without touching it.';
    const nounsOnly = compileTriggerEventDeliveryPreview(state, messages, {
        currentIndex: 23,
        playerName: 'Jet',
    });
    assert.equal(nounsOnly.records.length, 0);
    assert.equal(nounsOnly.text, '');
});

test('same-reply action preview remains opt-in, player-capable, and respects all-mode time', () => {
    const messages = messagesThrough(23);
    messages[23] = { is_user: true, is_system: false, mes: 'I try to open the sealed vault.' };

    const defaultTiming = timedEvent({
        triggerAfterSeconds: null,
        actionCondition: 'The player opens the sealed vault.',
        actorScope: 'player',
    });
    assert.equal(compileTriggerEventDeliveryPreview(defaultTiming, messages, {
        currentIndex: 23,
        playerName: 'Jet',
    }).records.length, 0);

    assert.throws(() => timedEvent({
        triggerAfterSeconds: null,
        actionCondition: 'Dani opens the sealed vault.',
        actionTiming: 'same_reply_attempt',
        actorScope: 'npc',
    }), /newest player turn/u);

    const allMode = timedEvent({
        triggerMode: 'all',
        actionCondition: 'The player opens the sealed vault.',
        actionTiming: 'same_reply_attempt',
        actorScope: 'player',
    });
    assert.equal(compileTriggerEventDeliveryPreview(allMode, messages, {
        currentIndex: 23,
        playerName: 'Jet',
    }).records.length, 0);
    messages[23].mes = 'Five minutes pass, then I try to open the sealed vault.';
    assert.deepEqual(compileTriggerEventDeliveryPreview(allMode, messages, {
        currentIndex: 23,
        playerName: 'Jet',
    }).records.map(record => record.key), ['break_in']);
});

test('same-reply action preview can reuse the preceding player turn for regeneration', () => {
    const state = timedEvent({
        triggerAfterSeconds: null,
        actionCondition: 'The player opens the sealed vault.',
        actionTiming: 'same_reply_attempt',
        actorScope: 'player',
    });
    const messages = messagesThrough(24);
    messages[23] = { is_user: true, is_system: false, mes: 'I try to open the sealed vault.' };
    messages[24] = { is_user: false, is_system: false, mes: 'The reply being regenerated.' };

    assert.equal(compileTriggerEventDeliveryPreview(state, messages, {
        currentIndex: 24,
        playerName: 'Jet',
    }).records.length, 0);
    assert.deepEqual(compileTriggerEventDeliveryPreview(state, messages, {
        currentIndex: 24,
        attemptMessageIndex: 23,
        playerName: 'Jet',
    }).records.map(record => record.key), ['break_in']);
});

test('SillyTavern refreshes delivery after MESSAGE_SENT and isolates its prompt key', async () => {
    const source = await readFile(new URL('../index.js', import.meta.url), 'utf8');
    assert.match(source, /TRIGGER_DELIVERY_PROMPT_KEY = 'inner_lore_trigger_delivery'/u);
    assert.match(source, /eventSource\.on\(events\.MESSAGE_SENT,[\s\S]*?updateTriggerDeliveryPrompt\(\{ recordInjection: true \}\);/u);
    assert.match(source, /eventSource\.on\(events\.GENERATION_STARTED,[\s\S]*?updateTriggerDeliveryPrompt/u);
});
