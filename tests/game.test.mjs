import assert from 'node:assert/strict';
import test from 'node:test';

import { createEmptyStore, mergeEntityOperations } from '../core.js?v=49';
import {
    applyGameOperations,
    carriedItems,
    createGameState,
    formatMoney,
    gameContext,
    gameOverview,
    gameStateBefore,
    introductionOperations,
    itemsAtPlace,
    needsStartingKit,
    normalizeCurrency,
    normalizeGameRecords,
    normalizeGameState,
    parseMoney,
    plannerTargets,
    recentGameChanges,
    reconcileGameIdentities,
    supersededPlannerPrices,
    renderGamePacket,
    reputationTier,
    stageFor,
    standingTier,
    tradeOverview,
} from '../game.js?v=6';

const CURRENCY = normalizeCurrency({
    name: 'Port Vell coin',
    units: [{ name: 'gold crown', value: 100 }, { name: 'silver', plural: 'silver', value: 10 }, { name: 'copper', plural: 'copper', value: 1 }],
});

function world() {
    const store = createEmptyStore('game-test');
    mergeEntityOperations(store, [
        { type: 'location', name: 'Salt Lantern', importance: 80, summary: 'A harbour inn.' },
        { type: 'location', name: 'Room Two', importance: 50, summary: 'A guest room.', parent_location: 'Salt Lantern' },
        { type: 'location', name: 'Salt Lantern Cellar', importance: 50, summary: 'The cellar.', parent_location: 'Salt Lantern' },
        { type: 'character', name: 'Mara Quell', importance: 70, summary: 'Innkeeper.', current_location: 'Salt Lantern' },
        { type: 'character', name: 'Pip', importance: 50, summary: 'Stable boy.', current_location: 'Salt Lantern' },
    ], { messageIndex: 0, maximumOperations: 20 });
    return store;
}

// Normalize a payload against the current state and apply it, as a pass does.
function run(state, store, payload, { messageIndex = 2, source = 'ledger', ...options } = {}) {
    const context = gameContext(state, { playerName: 'Jet', entities: store.entities, scenePlace: { name: 'Salt Lantern', id: 'location:salt lantern' } });
    const { ops, rejected } = normalizeGameRecords(payload, context, { source, ...options });
    return applyGameOperations(state, ops, { messageIndex, source, rejected });
}

test('money: units are normalized, parsed from phrases, and formatted greedily', () => {
    assert.deepEqual(CURRENCY.units.map(unit => [unit.name, unit.value]), [['gold crown', 100], ['silver', 10], ['copper', 1]]);
    assert.equal(parseMoney(3, 'silver', CURRENCY), 30);
    assert.equal(parseMoney('2 silver 3 copper', undefined, CURRENCY), 23);
    assert.equal(parseMoney('1 gold crown and 5 silver', undefined, CURRENCY), 150);
    assert.equal(parseMoney('2 crowns', undefined, CURRENCY), 200, 'a unit can be named by one of its words');
    assert.equal(parseMoney('7', undefined, CURRENCY), 7, 'a bare number is in the smallest unit');
    assert.equal(parseMoney('a few', undefined, CURRENCY), null);
    assert.equal(formatMoney(134, CURRENCY), '1 gold crown, 3 silver, 4 copper');
    assert.equal(formatMoney(0, CURRENCY), 'nothing');
    assert.equal(formatMoney(5, null), '5 coins', 'no currency yet: plain coins');
    // Fractional definitions are scaled to whole numbers.
    assert.deepEqual(normalizeCurrency({ units: [{ name: 'mark', value: 1 }, { name: 'pfennig', value: 0.01 }] }).units.map(unit => unit.value), [100, 1]);
});

test('buying: the purse pays, the stock moves to the player, and the price comes off it', () => {
    const store = world();
    let { state } = run(createGameState(), store, {
        currency: { name: 'coin', units: [{ name: 'silver', plural: 'silver', value: 10 }, { name: 'copper', plural: 'copper', value: 1 }] },
        purse: { set: 5, unit: 'silver' },
        objects: [{ op: 'add', key: 'oilskin_cloak', name: 'oilskin cloak', kind: 'clothing', holder: 'Salt Lantern', place: 'on a peg by the door', price: 3, unit: 'silver', seller: 'Mara Quell' }],
    }, { messageIndex: 1 });
    assert.equal(state.purse.amount, 50);
    assert.equal(itemsAtPlace(state, { name: 'Salt Lantern', id: 'location:salt lantern' })[0].price, 30);

    ({ state } = run(state, store, {
        objects: [{ key: 'oilskin_cloak', op: 'buy', to: 'Jet' }],
        money: [{ from: 'Jet', to: 'Mara', amount: 3, unit: 'silver', reason: 'the oilskin cloak' }],
    }, { messageIndex: 3 }));
    assert.equal(state.purse.amount, 20);
    const carried = carriedItems(state);
    assert.deepEqual(carried.map(item => item.name), ['oilskin cloak']);
    assert.equal(carried[0].price, null, 'bought stock is no longer for sale');
    assert.equal(state.journal.find(entry => entry.op.type === 'money').op.to.name, 'Mara Quell', 'a short name resolves to the known person');
});

test('a meal bought and eaten in one passage is paid for and gone', () => {
    const store = world();
    let { state } = run(createGameState(), store, { currency: { name: 'coin', units: [{ name: 'copper', plural: 'copper', value: 1 }] }, purse: { set: 20 } }, { messageIndex: 1 });
    ({ state } = run(state, store, {
        objects: [
            { key: 'fish_stew', op: 'buy', name: 'bowl of fish stew', kind: 'food', to: 'player' },
            { key: 'fish_stew', op: 'consumed' },
            { key: 'ale_for_tobbe', op: 'give', name: 'pint of ale', kind: 'drink', to: 'Pip' },
            { key: 'ale_for_tobbe', op: 'consumed' },
        ],
        money: [{ from: 'player', to: 'Mara Quell', amount: 4, reason: 'the stew and a pint for Pip' }],
    }, { messageIndex: 3 }));
    assert.equal(state.purse.amount, 16);
    assert.deepEqual(carriedItems(state), [], 'the stew was eaten');
    assert.equal(Object.values(state.items).filter(item => item.status === 'active').length, 0, 'and the pint drunk');
});

test('a payment larger than a counted purse empties it and reports the shortfall', () => {
    const store = world();
    let { state } = run(createGameState(), store, { purse: { set: 4 } }, { messageIndex: 1 });
    const result = run(state, store, { money: [{ from: 'player', to: 'Mara Quell', amount: 9 }] }, { messageIndex: 3 });
    assert.equal(result.state.purse.amount, 0);
    assert.equal(result.applied[0].shortfall, 5);
});

test('an uncounted purse stays unknown after spending, and receipts give a lower bound', () => {
    const store = world();
    let { state } = run(createGameState(), store, { money: [{ from: 'Jet', to: 'Pip', amount: 2 }] });
    assert.equal(state.purse.amount, null);
    assert.equal(state.purse.spent, 2);
    ({ state } = run(state, store, { money: [{ from: 'Mara Quell', to: 'Jet', amount: 6, reason: 'wages' }] }, { messageIndex: 4 }));
    assert.equal(state.purse.amount, 6);
    assert.equal(state.purse.minimum, true);
    assert.match(renderGamePacket(state, { playerName: 'Jet', store }), /Purse: at least 6 coins/u);
});

test('giving part of a stack splits it, and both stacks keep their history', () => {
    const store = world();
    let { state } = run(createGameState(), store, {
        objects: [{ op: 'add', key: 'tallow_candle', name: 'tallow candle', kind: 'tool', quantity: 3, value: 1, holder: 'Jet' }],
    }, { messageIndex: 1 });
    ({ state } = run(state, store, { objects: [{ key: 'tallow_candle', op: 'give', to: 'Pip', quantity: 1 }] }, { messageIndex: 3 }));
    const mine = state.items.tallow_candle;
    const pips = Object.values(state.items).find(item => item.holder.kind === 'character' && item.holder.name === 'Pip');
    assert.equal(mine.quantity, 2);
    assert.equal(pips.quantity, 1);
    assert.equal(pips.baseKey, 'tallow_candle');
    // Giving him another joins his stack instead of making a third.
    ({ state } = run(state, store, { objects: [{ key: 'tallow_candle', op: 'give', to: 'Pip', quantity: 1 }] }, { messageIndex: 5 }));
    assert.equal(state.items.tallow_candle.quantity, 1);
    assert.equal(Object.values(state.items).filter(item => item.holder.name === 'Pip')[0].quantity, 2);
    assert.match(gameOverview(state, { playerName: 'Jet' }).ledger.map(change => change.text).join('\n'), /tallow candle → Pip/u);
});

test('an object moved between rooms is where it was last put, with its path recorded', () => {
    const store = world();
    let { state } = run(createGameState(), store, {
        objects: [{ op: 'add', key: 'iron_chest', name: 'black iron chest', kind: 'container', holder: 'Room Two', place: 'at the foot of the bed' }],
    }, { messageIndex: 1 });
    ({ state } = run(state, store, {
        objects: [{ key: 'iron_chest', op: 'move', to: 'Salt Lantern Cellar', place: 'against the back wall', how: 'carry', reason: 'Mara had it carried down out of the storm' }],
    }, { messageIndex: 9 }));
    assert.deepEqual(itemsAtPlace(state, { name: 'Room Two', id: 'location:room two' }), []);
    const cellar = itemsAtPlace(state, { name: 'Salt Lantern Cellar', id: 'location:salt lantern cellar' });
    assert.equal(cellar[0].place, 'against the back wall');
    assert.equal(cellar[0].history.at(-1).note, 'Mara had it carried down out of the storm');
    // Items inside it count as there too, and as carried once the chest is.
    ({ state } = run(state, store, {
        objects: [{ op: 'add', key: 'sea_chart', name: 'sea-chart', kind: 'document', holder: 'iron_chest' }],
    }, { messageIndex: 11 }));
    assert.equal(itemsAtPlace(state, { name: 'Salt Lantern Cellar', id: 'location:salt lantern cellar' }).length, 2);
    ({ state } = run(state, store, { objects: [{ key: 'iron_chest', op: 'take', to: 'player' }] }, { messageIndex: 13 }));
    assert.deepEqual(carriedItems(state).map(item => item.key).sort(), ['iron_chest', 'sea_chart']);
});

test('an object can go into a container added earlier in the same answer', () => {
    const store = world();
    const { state } = run(createGameState(), store, {
        objects: [
            { op: 'add', key: 'satchel', name: 'leather satchel', kind: 'container', holder: 'Jet' },
            { op: 'add', key: 'sea_chart', name: 'sea-chart', kind: 'document', holder: 'satchel' },
        ],
    });
    assert.deepEqual(state.items.sea_chart.holder, { kind: 'item', key: 'satchel', name: 'leather satchel' });
    assert.deepEqual(carriedItems(state).map(item => item.key).sort(), ['satchel', 'sea_chart']);
});

test('standing and reputation move by bounded steps and read as tiers', () => {
    const store = world();
    let { state, rejected } = run(createGameState(), store, {
        standings: [
            { character: 'Mara', delta: 6, reason: 'Jet helped bar the shutters' },
            { character: 'Pip', delta: 80, reason: 'saved his life' },
            { character: 'Jet', delta: 5 },
        ],
        reputation: [{ group: 'Port Vell harbourfolk', kind: 'people', delta: -9, reason: 'seen arguing with the harbour master' }],
    });
    assert.equal(state.standings['mara quell'].score, 6, 'a short name resolves to the known person');
    assert.equal(state.standings.pip.score, 25, 'one change is capped');
    assert.equal(rejected.length, 1, 'no standing toward oneself');
    assert.equal(standingTier(6), 'neutral');
    assert.equal(standingTier(30), 'friendly');
    assert.equal(standingTier(-70), 'hostile');
    assert.equal(reputationTier(state.reputation['port vell harbourfolk'].score), 'disliked');
    ({ state } = run(state, store, { standings: [{ character: 'Mara Quell', set: -100 }] }, { messageIndex: 4 }));
    assert.equal(state.standings['mara quell'].score, -100);
    assert.equal(state.standings['mara quell'].notes.length, 2);
});

test('the planner prepares people, objects and prices that stay narrator-only until the story shows them', () => {
    const store = world();
    mergeEntityOperations(store, [{ type: 'location', name: 'Old Quay', importance: 60, summary: 'The fish quay.' }], { messageIndex: 1 });
    const planned = run(createGameState(), store, {
        stages: [{ place: 'Old Quay', summary: 'Grey morning; the herring boats are in.', hooks: ['A crate of stolen lamp oil sits unclaimed.'] }],
        people: [
            { name: 'Old Fen', location: 'Old Quay', role: 'net-mender', manner: 'gruff', wants: 'his debt from Mara repaid', standing: 5, sells: ['mended nets'] },
            { name: 'Mara Quell', location: 'Old Quay', role: 'innkeeper' },
        ],
        objects: [
            { key: 'mended_net', name: 'mended net', kind: 'tool', location: 'Old Quay', place: 'heaped by the steps', price: 3, unit: 'silver', seller: 'Old Fen' },
            { key: 'oil_crate', name: 'crate of lamp oil', kind: 'trade_good', location: 'Old Quay', hidden: true, value: 40 },
            { key: 'dagger', name: 'dagger', holder: 'Jet' },
        ],
        prices: [{ name: 'a bowl of fish soup', kind: 'food', price: 4, location: 'Old Quay', seller: 'the soup stall' }],
    }, { source: 'planner', messageIndex: 2, clockSeconds: 3_600 });
    const reasons = planned.rejected.map(item => item.reason).join(' | ');
    assert.match(reasons, /already a known person/u);
    assert.match(reasons, /cannot give the player belongings/u, 'no free kit once play began');
    const quay = { name: 'Old Quay', id: 'location:old quay' };
    let state = planned.state;
    assert.equal(state.stages.old_quay.people.length, 1);
    assert.deepEqual(itemsAtPlace(state, quay), [], 'prepared objects are not yet in the world');
    const packet = renderGamePacket(state, { playerName: 'Jet', store, scene: { location: quay, participants: [] } });
    assert.match(packet, /Prepared for Old Quay/u);
    assert.match(packet, /Old Fen \(net-mender; gruff; wants his debt from Mara repaid; sells mended nets; regards Jet: neutral \(\+5\)\)/u, 'an old-style standing is his lean');
    assert.match(packet, /crate of lamp oil.*\[hidden until found\]/u);
    assert.match(packet, /For sale here: a bowl of fish soup 4 coins/u);

    // The narrator brings in Old Fen and his nets.
    const ops = introductionOperations(state, 'Old Fen looks up from the mended net across his knees and spits.', quay);
    assert.deepEqual(ops.map(op => op.kind).sort(), ['item', 'person']);
    state = applyGameOperations(state, ops, { messageIndex: 3, source: 'scene' }).state;
    assert.equal(state.stages.old_quay.people[0].introduced, true);
    assert.equal(state.standings['old fen'].score, 5, 'the planned first impression becomes his standing');
    assert.equal(itemsAtPlace(state, quay).length, 1, 'the net is now in the world');
    assert.equal(plannerTargets(state, { store, scene: { location: quay } }).length, 0, 'a fresh stage is not prepared again');
    assert.equal(plannerTargets(state, { store, scene: { location: quay }, clockSeconds: 3_600 + 9 * 3_600 }).length, 1, 'a stale stage is');
});

test('a prepared person meets the player with their group\'s reputation, shifted by their own lean', () => {
    const store = world();
    mergeEntityOperations(store, [{ type: 'location', name: 'Old Quay', importance: 60, summary: 'The fish quay.' }], { messageIndex: 1 });
    let { state } = run(createGameState(), store, {
        reputation: [
            { group: 'the Old Quay fishermen', kind: 'people', set: 30, reason: 'Jet saved a boat in the squall' },
            { group: 'Old Quay', kind: 'place', set: -10, reason: 'Jet brawled on the steps' },
        ],
    }, { messageIndex: 2 });
    ({ state } = run(state, store, {
        stages: [{ place: 'Old Quay', summary: 'The boats are in.' }],
        people: [
            { name: 'Old Fen', location: 'Old Quay', role: 'net-mender', manner: 'bitter about outsiders', group: 'Old Quay fishermen', lean: -12 },
            { name: 'Wenna Tull', location: 'Old Quay', role: 'gutting girl', manner: 'chatty', group: 'the Old Quay fishermen', lean: 8 },
            { name: 'Corran Dace', location: 'Old Quay', role: 'tinker passing through', lean: 3 },
            { name: 'Hob Lisle', location: 'Old Quay', role: 'customs runner', group: 'the harbour office', lean: -5 },
            { name: 'Ysolde Marr', location: 'Old Quay', role: 'fishwife', group: 'the Old Quay fishermen' },
        ],
    }, { source: 'planner', messageIndex: 3 }));
    const quay = { name: 'Old Quay', id: 'location:old quay' };
    const packet = renderGamePacket(state, { playerName: 'Jet', store, scene: { location: quay, participants: [] }, maximumCharacters: 6_000 });
    assert.match(packet, /Wenna Tull \([^)]*regards Jet: friendly \(\+38\) as one of the Old Quay fishermen\)/u, 'the narrator knows her attitude before she speaks');
    assert.match(packet, /Old Fen \([^)]*regards Jet: warm \(\+18\) as one of the Old Quay fishermen\)/u, 'a sour member starts below the group');

    // A public insult between planning and meeting lowers the whole quay's view first.
    ({ state } = run(state, store, { reputation: [{ group: 'the Old Quay fishermen', delta: -20, reason: 'Jet mocked the catch in public' }] }, { messageIndex: 4 }));
    const met = introductionOperations(state, 'Old Fen, Wenna, Corran, Hob and Ysolde all look up from the nets.', quay);
    state = applyGameOperations(state, met, { messageIndex: 5, source: 'scene' }).state;
    assert.equal(state.standings['old fen'].score, -2, 'the group\'s view now (+10) plus his lean');
    assert.equal(state.standings['wenna tull'].score, 18);
    assert.equal(state.standings['ysolde marr'].score, 10, 'no lean: she shares the group\'s view');
    assert.equal(state.standings['corran dace'].score, 3, 'no group: the lean is the first impression');
    assert.equal(state.standings['hob lisle'].score, -5, 'a group nobody has an opinion of yet counts as neutral');
    assert.equal(state.standings['old fen'].group, 'the Old Quay fishermen');
    assert.match(state.standings['old fen'].notes[0].reason, /shares the Old Quay fishermen's view \(liked, \+10\), cooler by nature \(-12\)/u);
    assert.equal(gameStateBefore(state, 5).standings['old fen'], undefined, 'a swipe of the meeting undoes the first impression');
});

test('a group named a little differently finds the closest recorded group', () => {
    const store = world();
    mergeEntityOperations(store, [{ type: 'location', name: 'Old Quay', importance: 60, summary: 'The fish quay.' }], { messageIndex: 1 });
    let { state } = run(createGameState(), store, {
        reputation: [
            { group: 'Port Vell', kind: 'place', set: -40, reason: 'Jet is wanted in town' },
            { group: 'the Port Vell Harbour fishermen', kind: 'people', set: 20, reason: 'Jet hauled a net' },
        ],
    }, { messageIndex: 2 });
    ({ state } = run(state, store, {
        stages: [{ place: 'Old Quay' }],
        people: [
            { name: 'Dunnock', location: 'Old Quay', role: 'fisherman', group: 'Port Vell fishermen', standing: 2 },
            { name: 'Sella Brine', location: 'Old Quay', role: 'clerk', group: 'the harbour', lean: 0 },
        ],
    }, { source: 'planner', messageIndex: 3 }));
    state = applyGameOperations(state, introductionOperations(state, 'Dunnock and Sella Brine nod.', { name: 'Old Quay', id: 'location:old quay' }), { messageIndex: 4, source: 'scene' }).state;
    assert.equal(state.standings.dunnock.score, 22, 'the fishermen, not the town, and the old standing field is his lean');
    assert.equal(state.standings['sella brine'].score, 0, 'one shared word is not the same group');
});

test('someone the narrator invents starts from their group\'s view when the ledger first meets them', () => {
    const store = world();
    let { state } = run(createGameState(), store, {
        reputation: [{ group: 'the Old Quay fishermen', kind: 'people', set: 30, reason: 'Jet saved a crew' }],
        standings: [{ character: 'Mara Quell', delta: 4, reason: 'Jet paid in advance' }],
    }, { messageIndex: 2 });
    let result = run(state, store, {
        standings: [
            { character: 'the young fisherman', group: 'the Old Quay fishermen', lean: 6, delta: 0, reason: 'he grins at Jet\'s joke' },
            { character: 'Gull Ansel', group: 'Old Quay fishermen', lean: -10, delta: 3, reason: 'Jet helped him coil a rope' },
            { character: 'Mara Quell', group: 'the Old Quay fishermen', lean: 20, delta: 2, reason: 'Jet praised her stew' },
            { character: 'Pip', reason: 'nothing happened' },
        ],
    }, { messageIndex: 4 });
    state = result.state;
    assert.equal(state.standings['young fisherman'].score, 36, 'the group (+30) plus his lean');
    assert.equal(state.standings['young fisherman'].notes.length, 1, 'a quiet meeting is only the first impression');
    assert.equal(state.standings['gull ansel'].score, 23, 'the group, his sour lean, then the favour');
    assert.deepEqual(state.standings['gull ansel'].notes.map(note => note.delta), [20, 3]);
    assert.equal(state.standings['mara quell'].score, 6, 'someone already known is not reset by a group');
    assert.match(result.rejected.map(item => item.reason).join(' | '), /standing change is zero/u);
    const recent = recentGameChanges(state, 'Jet').map(change => change.text).join(' | ');
    assert.match(recent, /Gull Ansel \+3/u);
    assert.doesNotMatch(recent, /young fisherman/u, 'a quiet meeting is not a change');

    result = run(state, store, { standings: [{ character: 'the young fisherman', group: 'the Old Quay fishermen', lean: -15, delta: 0 }] }, { messageIndex: 6 });
    assert.equal(result.state.standings['young fisherman'].score, 36, 'a second meeting does not redo the first impression');
    assert.match(result.rejected.map(item => item.reason).join(' | '), /already has a standing/u);
    assert.equal(gameStateBefore(state, 4).standings['gull ansel'], undefined, 'a swipe undoes the meeting');
});

test('people carry their own coin, and money between two of them is tracked', () => {
    const store = world();
    const lantern = { name: 'Salt Lantern', id: 'location:salt lantern' };
    let { state } = run(createGameState(), store, {
        currency: { name: 'coin', units: [{ name: 'silver', plural: 'silver', value: 10 }, { name: 'copper', plural: 'copper', value: 1 }] },
        stages: [{ place: 'Salt Lantern' }],
        people: [{ name: 'Hobb Varle', location: 'Salt Lantern', role: 'pedlar', coin: '2 silver 5 copper' }],
        objects: [
            { key: 'tin_whistle', name: 'tin whistle', kind: 'curio', holder: 'Hobb Varle', price: 4, unit: 'copper', seller: 'Hobb Varle' },
            { key: 'hobb_knife', name: 'knife', kind: 'tool', holder: 'Hobb Varle' },
        ],
        prices: [{ name: 'a mended pot', kind: 'service', price: 2, unit: 'copper', seller: 'Hobb Varle', location: 'Salt Lantern' }],
    }, { source: 'planner', messageIndex: 1 });
    state = applyGameOperations(state, introductionOperations(state, 'Hobb Varle rattles his pack.', lantern), { messageIndex: 2, source: 'scene' }).state;
    assert.equal(state.purses['hobb varle'].amount, 25, 'his prepared coin is known once he is in the story');

    const result = run(state, store, {
        money: [
            { from: 'Hobb Varle', to: 'Mara Quell', amount: 5, unit: 'copper', reason: 'a bowl of stew' },
            { from: 'player', to: 'Hobb Varle', amount: 3, unit: 'copper', reason: 'a pot mended' },
            { from: 'world', to: 'Salt Lantern', amount: 2, unit: 'copper' },
        ],
    }, { messageIndex: 4 });
    state = result.state;
    assert.match(result.rejected.map(item => item.reason).join(' | '), /money must reach or leave a person/u);
    assert.equal(state.purses['hobb varle'].amount, 23);
    assert.deepEqual([state.purses['mara quell'].amount, state.purses['mara quell'].minimum], [5, true], 'her purse was never counted');
    assert.doesNotMatch(recentGameChanges(state, 'Jet').map(change => change.text).join(' | '), /Hobb Varle paid/u, 'a payment between others is not the player\'s change');

    const packet = renderGamePacket(state, { playerName: 'Jet', store, scene: { location: lantern, participants: [{ name: 'Hobb Varle' }, { name: 'Mara Quell' }] } });
    assert.match(packet, /Coin carried by people here: Hobb Varle 2 silver, 3 copper; Mara Quell at least 5 copper\./u);

    const trade = tradeOverview(state, { place: lantern, present: ['Hobb Varle', 'Mara Quell'], playerName: 'Jet' });
    const hobb = trade.partners.find(partner => partner.name === 'Hobb Varle');
    assert.deepEqual(hobb.wares.map(item => [item.name, item.price]), [['tin whistle', '4 copper'], ['knife', '']], 'priced stock, and what he carries openly to ask about');
    assert.deepEqual(hobb.services.map(item => item.name), ['a mended pot']);
    assert.equal(hobb.coin, '2 silver, 3 copper');
    assert.equal(trade.partners.find(partner => partner.name === 'Mara Quell').coin, 'at least 5 copper');
});

test('a body keeps what the dead carried until someone loots it, and the narrator sees it', () => {
    const store = world();
    mergeEntityOperations(store, [{ type: 'location', name: 'Old Quay', importance: 60, summary: 'The fish quay.' }], { messageIndex: 1 });
    const quay = { name: 'Old Quay', id: 'location:old quay' };
    const at = (current, payload, messageIndex, source = 'ledger') => {
        const context = gameContext(current, { playerName: 'Jet', entities: store.entities, scenePlace: quay });
        const { ops, rejected } = normalizeGameRecords(payload, context, { source });
        return applyGameOperations(current, ops, { messageIndex, source, rejected });
    };
    let { state } = at(createGameState(), {
        currency: { name: 'coin', units: [{ name: 'silver', plural: 'silver', value: 10 }, { name: 'copper', plural: 'copper', value: 1 }] },
        stages: [{ place: 'Old Quay' }],
        people: [{ name: 'Corran Dace', location: 'Old Quay', role: 'cutpurse', coin: '6 silver' }],
        objects: [
            { key: 'short_sword', name: 'short sword', kind: 'weapon', holder: 'Corran Dace', value: 3, unit: 'silver' },
            { key: 'sealed_letter', name: 'sealed letter', kind: 'document', holder: 'Corran Dace', hidden: true, description: 'sewn into his coat lining' },
            { key: 'bone_die', name: 'bone die', kind: 'curio', holder: 'Corran Dace' },
        ],
    }, 1, 'planner');
    const prepared = renderGamePacket(state, { playerName: 'Jet', store, scene: { location: quay, participants: [] } });
    assert.match(prepared, /Corran Dace \(cutpurse; carries 6 silver, short sword, sealed letter \(hidden\), bone die\)/u, 'the narrator knows what he carries before he appears');
    state = applyGameOperations(state, introductionOperations(state, 'Corran Dace draws a short sword.', quay), { messageIndex: 2, source: 'scene' }).state;
    assert.equal(state.items.short_sword.planned, false, 'he brings his things into the story');
    assert.match(renderGamePacket(state, { playerName: 'Jet', store, scene: { location: quay, participants: [{ name: 'Corran Dace' }] } }),
        /Held by people here: Corran Dace: short sword; Corran Dace: sealed letter \[hidden\]; Corran Dace: bone die\./u);

    state = at(state, { deaths: [{ character: 'Corran Dace', cause: 'stabbed in the brawl', evidence: 'He folds over the blade.' }] }, 4).state;
    const body = state.dead['corran dace'].body;
    assert.equal(state.items[body].name, "Corran Dace's body");
    assert.equal(state.items.short_sword.holder.key, body, 'what he carried stays on the body');
    assert.deepEqual([state.items.bone_die.planned, state.items.bone_die.hidden], [false, false], 'what he carried came into the story with him');
    assert.equal(state.items.sealed_letter.hidden, true, 'what he hid stays hidden');

    const packet = renderGamePacket(state, { playerName: 'Jet', store, scene: { location: quay, participants: [] } });
    assert.match(packet, /Bodies here [^:]*: Corran Dace's body \(stabbed in the brawl\): short sword \(worth 3 silver\), sealed letter \[hidden until searched\], bone die, 6 silver in coin\./u);
    assert.doesNotMatch(packet, /Here at Old Quay:[^\n]*short sword/u, 'body contents are listed once, with the body');
    assert.match(packet, /Recent changes: [^\n]*Corran Dace died \(stabbed in the brawl\)/u);

    const trade = tradeOverview(state, { place: quay, present: ['Corran Dace'], playerName: 'Jet' });
    assert.deepEqual(trade.partners.map(partner => `${partner.kind}:${partner.name}`), ["body:Corran Dace's body"], 'the dead do not trade');
    assert.deepEqual(trade.partners[0].wares.map(item => item.name), ['short sword', 'bone die'], 'only what can be seen is listed');

    const looted = at(state, {
        objects: [{ key: 'short_sword', op: 'loot', to: 'player' }],
        money: [{ from: "Corran Dace's body", to: 'player', amount: 6, unit: 'silver' }],
        deaths: [{ character: 'Corran Dace', cause: 'stabbed again' }],
    }, 6);
    assert.match(looted.rejected.map(item => item.reason).join(' | '), /already dead/u);
    state = looted.state;
    assert.ok(carriedItems(state).some(item => item.key === 'short_sword'));
    assert.equal(state.purses['corran dace'].amount, 0, 'the coin left the body');
    assert.deepEqual([state.purse.amount, state.purse.minimum], [60, true]);

    const before = gameStateBefore(state, 4);
    assert.equal(before.dead['corran dace'], undefined, 'a swipe of the killing undoes it');
    assert.equal(before.items.short_sword.holder.name, 'Corran Dace');
});

test('a game saved before purses and deaths existed still renders and takes new records', () => {
    const store = world();
    let { state } = run(createGameState(), store, { purse: { set: 20 }, money: [{ from: 'player', to: 'Mara Quell', amount: 2 }] }, { messageIndex: 2 });
    const old = JSON.parse(JSON.stringify(state));
    delete old.purses;
    delete old.dead;
    const scene = { location: { name: 'Salt Lantern', id: 'location:salt lantern' }, participants: [{ name: 'Mara Quell' }] };
    assert.match(renderGamePacket(old, { playerName: 'Jet', store, scene }), /Purse: 18 coins\./u);
    assert.ok(tradeOverview(old, { place: scene.location, present: ['Mara Quell'] }).partners.length);
    assert.ok(gameOverview(old, { place: scene.location }).here);
    ({ state } = run(normalizeGameState(old), store, { money: [{ from: 'Mara Quell', to: 'Pip', amount: 1 }] }, { messageIndex: 4 }));
    assert.equal(state.purses.pip.amount, 1);
});

test('a stage prepared under a provisional name serves the place lore records later', () => {
    const store = world();
    let { state } = run(createGameState(), store, {
        stages: [{ place: 'the harbour', summary: 'Night on the quay.' }],
        people: [{ name: 'Corran Dace', location: 'the harbour', role: 'night-watchman' }],
        objects: [{ key: 'skiff', name: 'small rowing skiff', location: 'the harbour', place: 'tied at the steps' }],
        prices: [{ name: 'a ferry across', price: 2, location: 'the harbour' }],
    }, { source: 'planner' });
    mergeEntityOperations(store, [{ type: 'location', name: 'Port Vell Harbour', importance: 60, summary: 'The harbour.' }], { messageIndex: 5 });
    const harbour = { name: 'Port Vell Harbour', id: 'location:port vell harbour' };
    assert.equal(stageFor(state, harbour)?.place, 'the harbour');
    assert.equal(plannerTargets(state, { store, scene: { location: harbour } }).length, 0, 'not prepared a second time');
    const packet = renderGamePacket(state, { playerName: 'Jet', store, scene: { location: harbour } });
    assert.match(packet, /Corran Dace \(night-watchman\)/u);
    assert.match(packet, /small rowing skiff/u);
    assert.match(packet, /For sale here: a ferry across 2 coins/u);
    assert.equal(stageFor(state, { name: 'Salt Lantern', id: 'location:salt lantern' }), null, 'an unrelated place does not take it');
});

test('the planner does not prepare someone lore knows under a shorter name', () => {
    const store = world();
    mergeEntityOperations(store, [{ type: 'character', name: 'Harbour Master Pell', importance: 60, summary: 'The harbour master.' }], { messageIndex: 3 });
    const { state, rejected } = run(createGameState(), store, {
        stages: [{ place: 'Salt Lantern', summary: 'Late.' }],
        people: [
            { name: 'Harbour Master Oswin Pell', location: 'Salt Lantern', role: 'harbour master' },
            { name: 'Wenna Saltash', location: 'Salt Lantern', role: 'fish-seller' },
        ],
    }, { source: 'planner' });
    assert.deepEqual(state.stages.salt_lantern.people.map(person => person.name), ['Wenna Saltash']);
    assert.match(rejected.map(item => item.reason).join(' '), /already a known person/u);
});

test('a starting kit is accepted only while the purse has never been counted', () => {
    const store = world();
    const fresh = createGameState();
    assert.equal(needsStartingKit(fresh), true);
    const { state } = run(fresh, store, {
        currency: { name: 'coin', units: [{ name: 'silver', value: 10 }, { name: 'copper', value: 1 }] },
        purse: { set: 12, unit: 'silver' },
        objects: [{ key: 'knife', name: 'knife', kind: 'tool', holder: 'Jet', value: 2, unit: 'silver' }],
    }, { source: 'planner', allowStartingKit: true });
    assert.equal(state.purse.amount, 120);
    assert.deepEqual(carriedItems(state).map(item => [item.name, item.planned]), [['knife', false]]);
    assert.equal(needsStartingKit(state), false);
});

test('a tight packet keeps recent changes and drops prepared material whole', () => {
    const store = world();
    let { state } = run(createGameState(), store, {
        stages: [{ place: 'Salt Lantern', summary: 'Late; the taproom is half-empty.', hooks: [
            'A sailor keeps glancing at the bundle under a stranger\'s arm and asks too casually what a courier charges these days.',
            'The only room left shares a thin wall with the back stair, and its lock is a hook and eye; the strongbox under the bar is offered for a fee.',
            'The harbour master has stopped all northbound sailings until the gale blows out, but a brig is rumoured to slip out at dawn.',
        ] }],
        people: [{ name: 'Old Dunnock', location: 'Salt Lantern', role: 'retired bosun', manner: 'slow, kindly, half-deaf', wants: 'someone to listen' }],
    }, { source: 'planner', messageIndex: 0 });
    ({ state } = run(state, store, {
        currency: { name: 'coin', units: [{ name: 'copper', plural: 'copper', value: 1 }] },
        purse: { set: 30 },
        money: [{ from: 'player', to: 'Mara Quell', amount: 8, reason: 'a night in the shared room' }],
    }, { messageIndex: 2 }));
    const scene = { location: { name: 'Salt Lantern', id: 'location:salt lantern' }, participants: [] };
    const full = renderGamePacket(state, { playerName: 'Jet', store, scene });
    assert.match(full, /Recent changes: .*paid 8 copper to Mara Quell for a night in the shared room/u);
    assert.match(full, /Hook: The harbour master/u);
    const tight = renderGamePacket(state, { playerName: 'Jet', store, scene, maximumCharacters: 1_000 });
    assert.ok(tight.length <= 1_000);
    assert.match(tight, /Recent changes: .*a night in the shared room/u, 'what happened outranks optional colour');
    const prepared = tight.split('\n').find(line => line.startsWith('Prepared for'));
    assert.ok(prepared, 'some prepared material still fits');
    assert.ok(!/Hook: The harbour master/u.test(prepared), 'the parts that do not fit are dropped');
    for (const part of prepared.replace(/^[^:]*\): /u, '').replace(/\.$/u, '').split(' | ')) {
        assert.ok(full.includes(part), `"${part.slice(0, 40)}…" is whole`);
    }
});

test('the state before a message is rebuilt exactly from the journal', () => {
    const store = world();
    let { state } = run(createGameState(), store, { purse: { set: 50 } }, { messageIndex: 1 });
    ({ state } = run(state, store, {
        objects: [{ op: 'add', key: 'brass_key', name: 'brass key', kind: 'key', holder: 'Jet' }],
        money: [{ from: 'Jet', to: 'Mara Quell', amount: 20, reason: 'Room Two' }],
        standings: [{ character: 'Mara Quell', delta: 4 }],
    }, { messageIndex: 3 }));
    ({ state } = run(state, store, {
        objects: [{ key: 'brass_key', op: 'give', to: 'Mara Quell' }],
        money: [{ from: 'Jet', to: 'Pip', amount: 5 }],
    }, { messageIndex: 5 }));
    const before = gameStateBefore(state, 5);
    assert.equal(before.purse.amount, 30);
    assert.equal(before.items.brass_key.holder.kind, 'player');
    assert.equal(before.journal.every(entry => entry.at < 5), true);
    assert.equal(state.purse.amount, 25, 'the live state is untouched');
    const start = gameStateBefore(state, 0);
    assert.equal(start.purse.amount, null);
    assert.deepEqual(start.items, {});
});

test('a saved state whose derived copy is stale is replayed from its journal', () => {
    const store = world();
    const { state } = run(createGameState(), store, { purse: { set: 9 } }, { messageIndex: 1 });
    const saved = JSON.parse(JSON.stringify(state));
    saved.purse.amount = 9_999;
    saved.derivedSequence = 0;
    assert.equal(normalizeGameState(saved).purse.amount, 9);
});

test('the packet lists what matters first and stays inside its budget', () => {
    const store = world();
    let { state } = run(createGameState(), store, {
        currency: { name: 'coin', units: [{ name: 'silver', plural: 'silver', value: 10 }, { name: 'copper', plural: 'copper', value: 1 }] },
        purse: { set: 34 },
        objects: [
            { op: 'add', key: 'knife', name: 'knife', holder: 'Jet', value: 15 },
            { op: 'add', key: 'tankards', name: 'pewter tankard', quantity: 6, holder: 'Salt Lantern', place: 'on the shelf behind the bar' },
            { op: 'add', key: 'ledger_book', name: 'house ledger', holder: 'Mara Quell' },
        ],
        prices: [{ name: 'a room', kind: 'lodging', price: 2, unit: 'silver', per: 'a night', seller: 'Mara Quell' }],
        standings: [{ character: 'Mara Quell', delta: 12, reason: 'Jet paid in advance' }],
    }, { messageIndex: 1 });
    const scene = { location: { name: 'Salt Lantern', id: 'location:salt lantern' }, participants: [{ name: 'Mara Quell' }] };
    const packet = renderGamePacket(state, { playerName: 'Jet', store, scene });
    assert.match(packet, /Purse: 3 silver, 4 copper\./u);
    assert.match(packet, /Carrying: knife \(worth 1 silver, 5 copper\)/u);
    assert.match(packet, /Here at Salt Lantern: pewter tankard ×6 \(on the shelf behind the bar\)/u);
    assert.match(packet, /Held by people here: Mara Quell: house ledger/u);
    assert.match(packet, /For sale here: a room 2 silver a night \(Mara Quell\)/u);
    assert.match(packet, /Mara Quell: warm \(\+12\) - Jet paid in advance/u);
    const small = renderGamePacket(state, { playerName: 'Jet', store, scene, maximumCharacters: 760 });
    assert.ok(small.length <= 760);
    assert.match(small, /Purse:/u, 'the purse survives a tight budget');
    assert.match(small, /<\/inner_lore_game_state>$/u);
});

test("'the lean sailor', 'Lean Sailor' and an alias of Tobbe Rusk are one standing after replay", () => {
    const store = createEmptyStore('standing-keys');
    mergeEntityOperations(store, [{ type: 'character', name: 'Tobbe Rusk', aliases: ['Lean Sailor'], importance: 60, summary: 'A sailor.' }], { minimumImportance: 0, messageIndex: 1 });
    let state = createGameState();
    state = applyGameOperations(state, [
        { type: 'standing.change', key: 'the lean sailor', name: 'the lean sailor', delta: 10, reason: 'first impression' },
        { type: 'standing.change', key: 'lean sailor', name: 'Lean Sailor', delta: 5, reason: 'a joke shared' },
    ], { messageIndex: 2, source: 'ledger' }).state;
    assert.deepEqual(Object.keys(state.standings), ['lean sailor']);
    assert.equal(state.standings['lean sailor'].score, 15);
    const folds = reconcileGameIdentities(state, store.entities);
    assert.deepEqual(folds, [{ type: 'person.alias', from: 'lean sailor', to: 'tobbe rusk', name: 'Tobbe Rusk' }]);
    state = applyGameOperations(state, folds, { messageIndex: 3, source: 'lore' }).state;
    assert.deepEqual(Object.keys(state.standings), ['tobbe rusk']);
    assert.equal(state.standings['tobbe rusk'].score, 15);
    assert.equal(state.standings['tobbe rusk'].notes.length, 2);
    // Replaying the journal from scratch gives the same answer.
    assert.deepEqual(Object.keys(normalizeGameState({ ...state, derivedSequence: 0 }).standings), ['tobbe rusk']);
});

test('a starting purse of 8 copper beside a 1-silver room is raised and reported', () => {
    const store = world();
    const fresh = createGameState();
    const { ops, adjusted } = normalizeGameRecords({
        currency: { name: 'coin', units: [{ name: 'silver', value: 100 }, { name: 'copper', value: 1 }] },
        purse: { set: 8, unit: 'copper' },
        stages: [{ place: 'Salt Lantern', summary: 'A dim taproom.' }],
        prices: [
            { key: 'room', name: 'a room for the night', kind: 'lodging', price: 106, unit: 'copper', location: 'Salt Lantern' },
            { key: 'stew', name: 'stew and bread', kind: 'food', price: 3, unit: 'copper', location: 'Salt Lantern' },
        ],
    }, gameContext(fresh, { playerName: 'Jet', entities: store.entities }), { source: 'planner', allowStartingKit: true, clockSeconds: 0 });
    assert.equal(ops.find(op => op.type === 'purse.set').amount, 330, '3 nights + 4 meals');
    assert.equal(adjusted.length, 1);
    assert.equal(adjusted[0].from, 8);
    const kept = normalizeGameRecords({
        currency: { name: 'coin', units: [{ name: 'silver', value: 100 }, { name: 'copper', value: 1 }] },
        purse: { set: 500, unit: 'copper' },
        stages: [{ place: 'Salt Lantern', summary: 'A dim taproom.' }],
        prices: [{ key: 'room', name: 'a room for the night', kind: 'lodging', price: 106, unit: 'copper', location: 'Salt Lantern' }],
    }, gameContext(fresh, { playerName: 'Jet', entities: store.entities }), { source: 'planner', allowStartingKit: true, clockSeconds: 0 });
    assert.equal(kept.ops.find(op => op.type === 'purse.set').amount, 500, 'a sufficient purse is left alone');
    assert.equal(kept.adjusted.length, 0);
});

test('once the story has stated prices at a place, the planner adds no more there', () => {
    const store = world();
    let state = createGameState();
    state = applyGameOperations(state, [{ type: 'price.set', key: 'bed', name: 'a bed for the night', kind: 'lodging', amount: 8, per: 'night', seller: 'Marit', place: { name: 'Salt Lantern' } }], { messageIndex: 2, source: 'ledger' }).state;
    const { ops, rejected } = normalizeGameRecords({
        currency: { name: 'coin', units: [{ name: 'silver', value: 100 }, { name: 'copper', value: 1 }] },
        stages: [{ place: 'Salt Lantern', summary: 'Late.' }, { place: 'Old Quay', summary: 'Wet stone.' }],
        prices: [
            { key: 'attic_bed', name: 'a narrow bed in the attic', kind: 'lodging', price: 6, unit: 'copper', location: 'Salt Lantern' },
            { key: 'berth', name: 'small boat berth', kind: 'fee', price: 20, unit: 'copper', location: 'Old Quay' },
        ],
    }, gameContext(state, { playerName: 'Jet', entities: store.entities }), { source: 'planner', clockSeconds: 0 });
    assert.deepEqual(ops.filter(op => op.type === 'price.set').map(op => op.name), ['small boat berth']);
    assert.match(rejected.map(item => item.reason).join(' | '), /story has already stated prices here/u);
});

test('the planner never prepares a second holder of a singular role the story or another stage already has', () => {
    const store = createEmptyStore('roles');
    mergeEntityOperations(store, [
        { type: 'location', name: 'Salt Lantern', importance: 70, summary: 'An inn on Rope Street.' },
        { type: 'location', name: 'Common Room', parent_location: 'Salt Lantern', importance: 50, summary: 'The inn\'s common room.' },
        { type: 'location', name: 'Old Quay', importance: 60, summary: 'A stone quay.' },
        { type: 'location', name: 'Harbour Office', parent_location: 'Old Quay', importance: 50, summary: 'A stone hut at the end of the quay.' },
        { type: 'character', name: 'Marit', importance: 70, summary: 'The broad-shouldered woman who runs the Salt Lantern.', current_location: 'Salt Lantern' },
        { type: 'character', name: 'Hob Garrow', importance: 60, summary: 'An elderly sailor and patron of the Salt Lantern.', current_location: 'Salt Lantern' },
    ], { minimumImportance: 0, messageIndex: 1, maximumOperations: 20 });
    const { ops, rejected } = normalizeGameRecords({
        stages: [{ place: 'Common Room', summary: 'Smoky.' }, { place: 'Old Quay', summary: 'Wet.' }],
        people: [
            { name: 'Silas Thorne', location: 'Common Room', role: 'innkeeper', appearance: 'bald', manner: 'gruff', wants: 'quiet' },
            { name: 'Old Silas', location: 'Common Room', role: 'regular', appearance: 'bent', manner: 'quiet', wants: 'a pipe' },
            { name: 'Pip', location: 'Common Room', role: 'potboy', appearance: 'small', manner: 'quick', wants: 'tips' },
            { name: 'Dunstan Rook', location: 'Old Quay', role: 'harbour master', appearance: 'tall', manner: 'curt', wants: 'order' },
            { name: 'Wenna', location: 'Old Quay', role: "harbour master's clerk", appearance: 'neat', manner: 'brisk', wants: 'an early night' },
        ],
    }, gameContext(createGameState(), { playerName: 'Jet', entities: store.entities }), { source: 'planner', clockSeconds: 0 });
    const stage = place => ops.find(op => op.type === 'stage.set' && op.place === place);
    assert.deepEqual(stage('Common Room').people.map(person => person.name), ['Pip']);
    assert.deepEqual(stage('Old Quay').people.map(person => person.name), ['Dunstan Rook', 'Wenna']);
    const reasons = rejected.map(item => `${item.record}: ${item.reason}`).join(' | ');
    assert.match(reasons, /Silas Thorne: the story already has the innkeeper here: Marit/u);
    assert.match(reasons, /Old Silas: the story already has the elder here: Hob Garrow/u);
    // A later stage for a place within the quay may not double the quay's harbour master either.
    const again = normalizeGameRecords({
        stages: [{ place: 'Harbour Office', summary: 'Ledgers and lamp smoke.' }],
        people: [{ name: 'Carrow', location: 'Harbour Office', role: 'harbourmaster', appearance: 'x', manner: 'y', wants: 'z' }],
    }, gameContext(applyGameOperations(createGameState(), ops, { messageIndex: 1, source: 'planner' }).state, { playerName: 'Jet', entities: store.entities }), { source: 'planner', clockSeconds: 0 });
    assert.match(again.rejected.map(item => item.reason).join(' | '), /already prepared as the harbour master at Old Quay: Dunstan Rook/u);
});

test("a stated price retires the planner's guess of the same kind at that place", () => {
    const store = world();
    let state = createGameState();
    state = applyGameOperations(state, [
        { type: 'price.set', key: 'bowl_of_stew', name: 'a bowl of stew', kind: 'food', amount: 4, per: '', seller: '', place: { name: 'Salt Lantern' } },
        { type: 'price.set', key: 'rum', name: 'rum', kind: 'drink', amount: 2, per: '', seller: '', place: { name: 'Salt Lantern' } },
        { type: 'price.set', key: 'berth', name: 'a berth', kind: 'fee', amount: 20, per: 'night', seller: '', place: { name: 'Old Quay' } },
    ], { messageIndex: 0, source: 'planner' }).state;
    const stated = [{ type: 'price.set', key: 'stew_and_bread', name: 'stew and bread', kind: 'food', amount: 3, per: '', seller: 'Marit', place: { name: 'Salt Lantern' } }];
    state = applyGameOperations(state, stated, { messageIndex: 2, source: 'ledger' }).state;
    const retired = supersededPlannerPrices(state, stated);
    assert.deepEqual(retired.map(op => op.key), ['bowl_of_stew']);
    state = applyGameOperations(state, retired, { messageIndex: 2, source: 'lore' }).state;
    assert.deepEqual(Object.keys(state.prices).sort(), ['berth', 'rum', 'stew_and_bread']);
    assert.deepEqual(supersededPlannerPrices(state, stated), [], 'nothing left to retire');
});
