import assert from 'node:assert/strict';
import test from 'node:test';

import { decideInnerLoreMaintenance } from '../maintenance-scheduler.js';
import { createProgressionState } from '../progression.js';
import {
    markTriggerEventDeliveriesInjected,
    upsertTriggerEventDefinition,
} from '../trigger-events.js';

function exchange(user, assistant) {
    return [
        { is_user: true, is_system: false, mes: user },
        { is_user: false, is_system: false, mes: assistant },
    ];
}

function populatedStore(watermark = 1) {
    const progression = createProgressionState();
    progression.lastProcessedIndex = watermark;
    return {
        lastProcessedIndex: watermark,
        entities: { 'location:manor': { id: 'location:manor' } },
        brains: { 'brain:dani': { id: 'brain:dani' } },
        progression,
    };
}

const settings = {
    adaptiveMaintenanceEnabled: true,
    processEveryAssistantTurns: 3,
    progressionEveryAssistantTurns: 4,
    minimumAdaptiveBatchTurns: 2,
    autoLoreEnabled: true,
    innerSelfEnabled: true,
};

test('ordinary replies batch independently to curator and progression cadences', () => {
    const prefix = exchange('We settle in.', 'The room grows quiet.');
    const store = populatedStore(1);
    const two = [...prefix,
        ...exchange('I inspect the desk.', 'Dust coats its corners.'),
        ...exchange('I listen.', 'Rain ticks at the glass.'),
    ];
    const early = decideInnerLoreMaintenance({ messages: two, store, settings, targetIndex: 5 });
    assert.equal(early.curatorDue, false);
    assert.equal(early.progressionDue, false);

    const three = [...two, ...exchange('I sit beside Dani.', 'She watches the dark window.')];
    const curator = decideInnerLoreMaintenance({ messages: three, store, settings, targetIndex: 7 });
    assert.equal(curator.curatorDue, true);
    assert.deepEqual(curator.curatorReasons, ['cadence']);
    assert.equal(curator.progressionDue, false);

    const four = [...three, ...exchange('I wait in silence.', 'The fire settles lower.')];
    const both = decideInnerLoreMaintenance({ messages: four, store, settings, targetIndex: 9 });
    assert.equal(both.curatorDue, true);
    assert.equal(both.progressionDue, true);
    assert.deepEqual(both.progressionReasons, ['cadence']);
});

test('an explicit completed time advance flushes progression without calling the curator', () => {
    const messages = [
        ...exchange('We settle in.', 'The room grows quiet.'),
        ...exchange('Three full days pass before I return.', 'Dani opens the familiar door.'),
    ];
    const decision = decideInnerLoreMaintenance({
        messages,
        store: populatedStore(1),
        settings,
        targetIndex: 3,
    });
    assert.equal(decision.curatorDue, false);
    assert.equal(decision.progressionDue, true);
    assert.equal(decision.signals.explicitTimeSeconds, 259_200);
    assert.deepEqual(decision.progressionReasons, ['explicit_time']);
});

test('two pending turns with a location transition flush the curator batch', () => {
    const messages = [
        ...exchange('We settle in.', 'The room grows quiet.'),
        ...exchange('I return to the manor kitchen.', 'The scarred oak table is where we left it.'),
        ...exchange('I check the shelves.', 'The blue jar remains on the third shelf.'),
    ];
    const decision = decideInnerLoreMaintenance({
        messages,
        store: populatedStore(1),
        settings,
        targetIndex: 5,
    });
    assert.equal(decision.curatorDue, true);
    assert.deepEqual(decision.curatorReasons, ['location_transition']);
    assert.equal(decision.progressionDue, false);
});

test('an armed action watcher flushes progression on a relevant action', () => {
    const store = populatedStore(1);
    store.progression = upsertTriggerEventDefinition(store.progression, {
        id: 'trigger:locked_door',
        key: 'locked_door',
        title: 'Door secured',
        description: 'A bell rings in the watchhouse.',
        enabled: true,
        actionCondition: 'Dani locks the kitchen door',
        actorScope: 'npc',
    }, { messageIndex: 1, clock: store.progression.clock }).state;
    const messages = [
        ...exchange('We settle in.', 'The room grows quiet.'),
        ...exchange('Please secure us.', 'Dani locks the kitchen door.'),
    ];
    const decision = decideInnerLoreMaintenance({ messages, store, settings, targetIndex: 3 });
    assert.equal(decision.curatorDue, false);
    assert.equal(decision.progressionDue, true);
    assert.deepEqual(decision.progressionReasons, ['action_watcher']);
    assert.deepEqual(decision.signals.actionWatcherMatches.map(item => item.key), ['locked_door']);
});

test('character and location overlap without the configured action predicate does not flush a watcher', () => {
    const store = populatedStore(1);
    store.progression = upsertTriggerEventDefinition(store.progression, {
        id: 'trigger:locked_door',
        key: 'locked_door',
        title: 'Door secured',
        description: 'A bell rings in the watchhouse.',
        enabled: true,
        actionCondition: 'Dani locks the kitchen door',
        actorScope: 'npc',
    }, { messageIndex: 1, clock: store.progression.clock }).state;
    const messages = [
        ...exchange('We settle in.', 'The room grows quiet.'),
        ...exchange('I ask Dani about the kitchen door.', 'Dani looks at the kitchen door and answers softly.'),
    ];
    const decision = decideInnerLoreMaintenance({ messages, store, settings, targetIndex: 3 });
    assert.equal(decision.progressionDue, false);
    assert.deepEqual(decision.signals.actionWatcherMatches, []);
});

test('action-object nouns alone do not flush an armed watcher', () => {
    const store = populatedStore(1);
    store.progression = upsertTriggerEventDefinition(store.progression, {
        id: 'trigger:ring_shot',
        key: 'ring_shot',
        title: 'Whistle-arrow response',
        description: 'A pigeon circles into the yard.',
        enabled: true,
        actionCondition: 'Freesia looses the whistle-tipped practice arrow cleanly through the bronze practice ring.',
        actorScope: 'npc',
    }, { messageIndex: 1, clock: store.progression.clock }).state;
    const messages = [
        ...exchange('We settle in.', 'The room grows quiet.'),
        ...exchange(
            'I ask Freesia about the bronze practice ring and whistle-tipped practice arrow.',
            'Freesia studies the bronze practice ring and whistle-tipped practice arrow without shooting.',
        ),
    ];
    const decision = decideInnerLoreMaintenance({ messages, store, settings, targetIndex: 3 });
    assert.equal(decision.progressionDue, false);
    assert.deepEqual(decision.signals.actionWatcherMatches, []);
});

test('an injected event receipt flushes verification without forcing curator maintenance', () => {
    const store = populatedStore(1);
    store.progression = upsertTriggerEventDefinition(store.progression, {
        id: 'trigger:break_in',
        key: 'break_in',
        title: 'Kitchen break-in',
        description: 'A burglar forces the kitchen window.',
        enabled: true,
        triggerAfterSeconds: 60,
        activationVisibility: 'observable',
    }, { messageIndex: 1, clock: store.progression.clock }).state;
    store.progression.eventRuntime['trigger:break_in'].status = 'observable';
    store.progression = markTriggerEventDeliveriesInjected(store.progression, [{
        definitionId: 'trigger:break_in',
        kind: 'observable',
    }], { messageIndex: 2, generationId: 'generation:test' }).state;
    const messages = [
        ...exchange('We settle in.', 'The room grows quiet.'),
        ...exchange('I listen at the window.', 'A hard scrape sounds beyond the glass.'),
    ];
    const decision = decideInnerLoreMaintenance({ messages, store, settings, targetIndex: 3 });
    assert.equal(decision.curatorDue, false);
    assert.equal(decision.progressionDue, true);
    assert.deepEqual(decision.progressionReasons, ['delivery_verification']);
});

test('bootstrap happens once and disabling adaptation retains only hard cadences', () => {
    const firstMessages = exchange('I enter the manor.', 'Dani looks up from the hearth.');
    const emptyStore = populatedStore(-1);
    emptyStore.entities = {};
    emptyStore.brains = {};
    assert.deepEqual(
        decideInnerLoreMaintenance({ messages: firstMessages, store: emptyStore, settings, targetIndex: 1 }).curatorReasons,
        ['bootstrap'],
    );

    const messages = [
        ...exchange('We settle in.', 'The room grows quiet.'),
        ...exchange('Three days pass and I return to the kitchen.', 'Everything remains in place.'),
    ];
    const nonAdaptive = decideInnerLoreMaintenance({
        messages,
        store: populatedStore(1),
        settings: { ...settings, adaptiveMaintenanceEnabled: false },
        targetIndex: 3,
    });
    assert.equal(nonAdaptive.curatorDue, false);
    assert.equal(nonAdaptive.progressionDue, false);
});
