import assert from 'node:assert/strict';
import test from 'node:test';

import { createEmptyStore, mergeEntityOperations } from '../core.js?v=49';
import {
    abilitiesKnown,
    abilityLevel,
    applyGameOperations,
    createGameState,
    gameContext,
    linkOf,
    normalizeGameRecords,
    normalizeGameState,
    recentGameChanges,
} from '../game.js?v=6';

function world() {
    const store = createEmptyStore('comm');
    mergeEntityOperations(store, [
        { type: 'location', name: 'Salt Lantern', importance: 70, summary: 'An inn.' },
        { type: 'character', name: 'Mara Venn', importance: 70, summary: 'The innkeeper.' },
    ], { messageIndex: 0, maximumOperations: 10 });
    return store;
}

test('consent to be reached mind to mind is a journal fact: granted, refused, folded with a name, and told to the player', () => {
    let state = createGameState();
    state = applyGameOperations(state, [{ type: 'mind.link', name: 'Mara Venn', consent: 'granted', note: 'agreed' }], { messageIndex: 3, source: 'private' }).state;
    assert.equal(linkOf(state, 'mara venn').consent, 'granted');
    assert.match(recentGameChanges(state, 'Jet').at(-1).text || JSON.stringify(recentGameChanges(state, 'Jet').at(-1)), /Mara Venn lets you reach their mind/u);
    state = applyGameOperations(state, [{ type: 'mind.link', name: 'Mara Venn', consent: 'refused' }], { messageIndex: 5, source: 'private' }).state;
    assert.equal(linkOf(state, 'Mara Venn').consent, 'refused');
    // Replayed from the journal, it is the same.
    assert.equal(linkOf(normalizeGameState(JSON.parse(JSON.stringify({ ...state, derivedSequence: -1 }))), 'Mara Venn').consent, 'refused');
    // A descriptor the story later named carries the link with it.
    let named = applyGameOperations(createGameState(), [{ type: 'mind.link', name: 'the innkeeper', consent: 'granted' }], { messageIndex: 1, source: 'ledger' }).state;
    named = applyGameOperations(named, [{ type: 'person.alias', from: 'innkeeper', to: 'mara venn', name: 'Mara Venn' }], { messageIndex: 2, source: 'ledger' }).state;
    assert.equal(linkOf(named, 'Mara Venn')?.consent, 'granted');
});

test('the planner gives the people it prepares their gifts, and settles the player\'s own only when the world leaves it to the story', () => {
    const store = world();
    const state = normalizeGameState(createGameState());
    const context = gameContext(state, { playerName: 'Jet', entities: store.entities });
    const payload = {
        stages: [{ place: 'Salt Lantern', summary: 'Busy.' }],
        people: [
            { name: 'Ysolde Marr', location: 'Salt Lantern', role: 'baker', mind: 0, ward: 0 },
            { name: 'Brother Aldous', location: 'Salt Lantern', role: 'priest', mind: 35, ward: 60 },
        ],
        abilities: [{ holder: 'player', key: 'telepathy', name: 'the Whisper', level: 30 }],
        device: { present: true, name: 'phone', channel: 'text' },
        purse: { set: 10, unit: 'copper' },
        currency: { name: 'coin', units: [{ name: 'copper', plural: 'coppers', value: 1 }] },
    };
    const kit = normalizeGameRecords(payload, context, { source: 'planner', allowStartingKit: true, communication: {} });
    const gifts = kit.ops.filter(op => op.type === 'ability.set');
    assert.deepEqual(gifts.map(op => [op.holder.kind === 'player' ? 'player' : op.holder.name, op.key, op.level]), [
        ['player', 'telepathy', 30],
        ['Ysolde Marr', 'mind_ward', 0],
        ['Brother Aldous', 'mind_ward', 60],
        ['Brother Aldous', 'telepathy', 35],
    ]);
    assert.ok(kit.ops.some(op => op.type === 'device.set' && op.present === true), 'the starting device');

    // The world fixes them: the planner's say is refused.
    const fixed = normalizeGameRecords(payload, context, { source: 'planner', allowStartingKit: true, communication: { startPhone: 'yes', startMind: 'adept' } });
    assert.ok(!fixed.ops.some(op => op.type === 'device.set' || (op.type === 'ability.set' && op.holder.kind === 'player')));
    assert.ok(fixed.rejected.some(item => /abilities come from the story/u.test(item.reason)));
    // No starting kit: nothing for the player either.
    assert.ok(!normalizeGameRecords(payload, context, { source: 'planner', communication: {} }).ops.some(op => op.type === 'device.set'));
    // A world without mind-speech: no gifts at all.
    const mindless = normalizeGameRecords(payload, context, { source: 'planner', allowStartingKit: true, communication: { mind: false } });
    assert.ok(!mindless.ops.some(op => op.type === 'ability.set'));
});

test('someone the story brings in for the first time has their gifts settled by the ledger, an ordinary mind unless it says otherwise', () => {
    const store = world();
    let state = normalizeGameState(createGameState());
    state = applyGameOperations(state, [{ type: 'reputation.change', key: 'the watch', name: 'the watch', delta: -10, kind: 'organization', reason: 'x' }], { messageIndex: 0, source: 'ledger' }).state;
    const context = gameContext(state, { playerName: 'Jet', entities: store.entities });
    const payload = {
        standings: [
            { character: 'Sergeant Pell', group: 'the watch', lean: -5, delta: 0, reason: 'first meeting' },
            { character: 'Lady Corvane', group: 'the watch', lean: 5, delta: 0, reason: 'first meeting' },
        ],
        abilities: [{ holder: 'Lady Corvane', key: 'mind_ward', level: 70, evidence: 'her mind is a locked door' }],
        links: [{ character: 'Mara Venn', consent: 'granted', evidence: 'reach me if you need me' }],
    };
    const { ops } = normalizeGameRecords(payload, context, { source: 'ledger', communication: {} });
    const gifts = ops.filter(op => op.type === 'ability.set').map(op => [op.holder.name, op.key, op.level]);
    assert.deepEqual(gifts, [['Lady Corvane', 'mind_ward', 70], ['Sergeant Pell', 'mind_ward', 0]], 'the ledger\'s own record stands; the other newcomer is an ordinary mind');
    assert.deepEqual(ops.filter(op => op.type === 'mind.link').map(op => [op.name, op.consent]), [['Mara Venn', 'granted']]);
    const applied = applyGameOperations(state, ops, { messageIndex: 2, source: 'ledger' }).state;
    assert.ok(abilitiesKnown(applied, { name: 'Sergeant Pell' }), 'settled: no judging needed later');
    assert.equal(abilityLevel(applied, { name: 'Lady Corvane' }, 'mind_ward'), 70);
    // Already settled, or a world without mind-speech: nothing added.
    const known = gameContext(applied, { playerName: 'Jet', entities: store.entities });
    assert.ok(!normalizeGameRecords({ standings: [payload.standings[0]] }, known, { source: 'ledger', communication: {} }).ops.some(op => op.type === 'ability.set'));
    assert.ok(!normalizeGameRecords({ standings: payload.standings }, context, { source: 'ledger', communication: { mind: false } }).ops.some(op => op.type === 'ability.set'));
});

test('people a passage brings in have their gifts settled in the background, by the world\'s rules', async () => {
    const { settleNewcomerGifts } = await import('../pass-pipeline.js?v=5');
    const store = createEmptyStore('gifts');
    mergeEntityOperations(store, [
        { type: 'character', name: 'Mara Venn', importance: 70, summary: 'The innkeeper.' },
        { type: 'character', name: 'Magister Corvane', importance: 70, summary: 'A Tower mage whose mind is a locked door.' },
        { type: 'character', name: 'Absent Al', importance: 40, summary: 'Somewhere else.' },
    ], { messageIndex: 0, maximumOperations: 10 });
    store.game = createGameState();
    const chat = [{ mes: 'Mara Venn wipes the bar. Magister Corvane sits in the corner booth.', is_user: false, name: 'Narrator' }];
    const asked = [];
    const request = async messages => {
        asked.push(messages);
        return { payload: { abilities: [{ holder: 'Magister Corvane', key: 'mind_ward', name: 'the Tower\'s shield', level: 70, evidence: 'a locked door' }, { holder: 'Absent Al', key: 'telepathy', level: 90 }] } };
    };
    const result = await settleNewcomerGifts(store, { chat, playerName: 'Jet', settings: { communication: {} }, start: 0, end: 0, request });
    assert.deepEqual(result.settled, ['Mara Venn', 'Magister Corvane'], 'only the people the passage shows');
    assert.match(asked[0][1].content, /"name":"Mara Venn"[\s\S]*"name":"Magister Corvane"/u);
    assert.match(asked[0][1].content, /<WORLD_RULES>/u);
    const state = normalizeGameState(store.game);
    assert.equal(abilityLevel(state, { name: 'Magister Corvane' }, 'mind_ward'), 70);
    assert.ok(abilitiesKnown(state, { name: 'Mara Venn' }), 'left out of the answer: an ordinary mind, settled');
    assert.equal(abilityLevel(state, { name: 'Mara Venn' }, 'mind_ward'), 0);
    assert.ok(!abilitiesKnown(state, { name: 'Absent Al' }), 'nobody outside the passage is touched');
    // Settled people are not asked again; a world without mind-speech asks nothing.
    assert.equal(await settleNewcomerGifts(store, { chat, playerName: 'Jet', settings: { communication: {} }, start: 0, end: 0, request }), null);
    assert.equal(asked.length, 1);
    const fresh = createEmptyStore('none');
    fresh.entities = store.entities;
    fresh.game = createGameState();
    assert.equal(await settleNewcomerGifts(fresh, { chat, playerName: 'Jet', settings: { communication: { mind: false } }, start: 0, end: 0, request }), null);
});
