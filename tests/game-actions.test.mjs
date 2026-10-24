import assert from 'node:assert/strict';
import test from 'node:test';

import { createEmptyStore, mergeEntityOperations } from '../core.js?v=49';
import { applyGameOperations, createGameState, gameContext, normalizeGameRecords, renderGamePacket } from '../game.js?v=4';
import {
    ACTION_SOURCE,
    GAME_TOOLS,
    actionAlreadyApplied,
    actionEntriesInRange,
    actionFromToolCall,
    dropDuplicateLedgerOps,
    parseGemmaArguments,
    parseTextToolCalls,
    renderResolvedActions,
    renderToolGuidance,
    resolveGameAction,
    resolveGameActions,
} from '../game-actions.js';

const PLACE = { name: 'Salt Lantern', id: 'location:salt lantern' };

function world() {
    const store = createEmptyStore('actions-test');
    mergeEntityOperations(store, [
        { type: 'location', name: 'Salt Lantern', importance: 80, summary: 'A harbour inn.' },
        { type: 'character', name: 'Mara Quell', importance: 70, summary: 'Innkeeper.', current_location: 'Salt Lantern' },
        { type: 'character', name: 'Pip', importance: 50, summary: 'Stable boy.', current_location: 'Salt Lantern' },
    ], { messageIndex: 0, maximumOperations: 20 });
    return store;
}

function contextFor(state, store) {
    return gameContext(state, { playerName: 'Jet', entities: store.entities, scenePlace: PLACE });
}

function ledger(state, store, payload, messageIndex = 1) {
    const { ops } = normalizeGameRecords(payload, contextFor(state, store), { source: 'ledger' });
    return applyGameOperations(state, ops, { messageIndex, source: 'ledger' }).state;
}

function shop() {
    const store = world();
    const state = ledger(createGameState(), store, {
        currency: { name: 'coin', units: [{ name: 'shilling', plural: 'shillings', value: 12 }, { name: 'penny', plural: 'pence', value: 1 }] },
        purse: { set: 5, unit: 'shilling' },
        objects: [
            { op: 'add', key: 'brass_lantern', name: 'brass lantern', kind: 'tool', holder: 'Salt Lantern', place: 'on a shelf', price: 3, unit: 'shilling', seller: 'Mara Quell' },
            { op: 'add', key: 'sea_chart', name: 'sea chart', kind: 'document', holder: 'Mara Quell', price: 12, unit: 'shilling', seller: 'Mara Quell' },
            { op: 'add', key: 'tin_whistle', name: 'tin whistle', kind: 'curio', holder: 'player', value: 2, unit: 'shilling' },
            { op: 'add', key: 'hard_bread', name: 'hard bread', kind: 'food', holder: 'player', quantity: 3 },
        ],
        prices: [{ key: 'bed_night', name: 'a night\'s bed', kind: 'lodging', price: 2, unit: 'shilling', per: 'a night', seller: 'Mara Quell', location: 'Salt Lantern' }],
        standings: [{ character: 'Mara Quell', delta: 12, reason: 'carried her crates' }],
    });
    return { store, state };
}

test('text tool calls: Gemma call syntax, JSON, and function style, leaving prose alone', () => {
    const gemma = parseTextToolCalls('call:game_trade{action:buy,item:brass lantern,person:Mara,price:3 shillings}');
    assert.equal(gemma.calls.length, 1);
    assert.deepEqual(gemma.calls[0], { name: 'game_trade', arguments: { action: 'buy', item: 'brass lantern', person: 'Mara', price: '3 shillings' } });
    assert.equal(gemma.rest, '');

    const two = parseTextToolCalls('<|tool_call>call:game_trade{action:buy,item:sea chart,person:Mara,quantity:1}<tool_call|>\ncall:game_coin{action:pay,amount:"2 pence",person:Pip,reason:a tip}');
    assert.deepEqual(two.calls.map(call => call.name), ['game_trade', 'game_coin']);
    assert.equal(two.calls[0].arguments.quantity, 1);
    assert.equal(two.calls[1].arguments.amount, '2 pence');

    const json = parseTextToolCalls('```json\n{"name": "game_transfer", "arguments": {"action": "take", "item": "rope"}}\n```');
    assert.deepEqual(json.calls, [{ name: 'game_transfer', arguments: { action: 'take', item: 'rope' } }]);

    const fn = parseTextToolCalls('game_consume({"item": "hard bread", "quantity": 2})');
    assert.deepEqual(fn.calls, [{ name: 'game_consume', arguments: { item: 'hard bread', quantity: 2 } }]);

    const prose = parseTextToolCalls('Mara laughed. "Three shillings, and not a penny less."');
    assert.equal(prose.calls.length, 0);
    assert.match(prose.rest, /Three shillings/u);

    const mixed = parseTextToolCalls('She nodded.\ncall:game_trade{action:buy,item:brass lantern,person:Mara}');
    assert.equal(mixed.calls.length, 1);
    assert.equal(mixed.rest, 'She nodded.');

    const unknown = parseTextToolCalls('call:weather{place:here}');
    assert.equal(unknown.calls.length, 0, 'calls to tools InnerLore did not offer are ignored');
    assert.deepEqual(parseGemmaArguments('item:bread, a loaf,person:Mara'), { item: 'bread, a loaf', person: 'Mara' });
});

test('tool calls become actions; unknown tools and actions are refused', () => {
    assert.deepEqual(actionFromToolCall('game_trade', { action: 'buy', item: 'lantern', person: 'Mara', price: '3 shillings' }).kind, 'buy');
    assert.equal(actionFromToolCall('game_consume', { item: 'bread' }).kind, 'consume');
    assert.equal(actionFromToolCall('game_transfer', { action: 'steal', item: 'x' }), null);
    assert.equal(actionFromToolCall('nope', {}), null);
    assert.equal(GAME_TOOLS.every(tool => tool.name && tool.description && tool.parameters?.type === 'object'), true);
});

test('buying at the listed price moves coin and stock; the reply tells the narrator the purse', () => {
    const { store, state } = shop();
    const action = actionFromToolCall('game_trade', { action: 'buy', item: 'the brass lantern', person: 'Mara' });
    const { ops, outcome } = resolveGameAction(state, action, contextFor(state, store));
    assert.equal(outcome.ok, true, outcome.reason);
    assert.match(outcome.text, /Bought brass lantern from Mara Quell for 3 shillings\. Purse now: 2 shillings/u);
    assert.deepEqual(ops.map(op => op.type), ['money', 'item.move']);
    const next = applyGameOperations(state, ops, { messageIndex: 3, source: ACTION_SOURCE }).state;
    assert.equal(next.purse.amount, 24);
    assert.equal(next.items.brass_lantern.holder.kind, 'player');
    assert.equal(next.purses['mara quell'].amount, 36, 'Mara is credited');
});

test('a purchase the purse cannot cover is refused and nothing moves', () => {
    const { store, state } = shop();
    const { ops, outcome } = resolveGameAction(state, { kind: 'buy', item: 'sea chart', person: 'Mara Quell' }, contextFor(state, store));
    assert.equal(outcome.ok, false);
    assert.equal(ops.length, 0);
    assert.match(outcome.reason, /short of coin: has 5 shillings, the price is 12 shillings/u);
});

test('haggling: a fair offer from a friend is taken, a lowball or a stranger is refused', () => {
    const { store, state } = shop();
    const context = contextFor(state, store);
    const fair = resolveGameAction(state, { kind: 'buy', item: 'brass lantern', person: 'Mara', price: '2 shillings 6 pence' }, context);
    assert.equal(fair.outcome.ok, true, fair.outcome.reason);
    assert.match(fair.outcome.text, /for 2 shillings, 6 pence/u);
    const low = resolveGameAction(state, { kind: 'buy', item: 'brass lantern', person: 'Mara', price: '1 shilling' }, context);
    assert.equal(low.outcome.ok, false);
    assert.match(low.outcome.reason, /wants 3 shillings for brass lantern, not 1 shilling/u);
    const stranger = resolveGameAction(state, { kind: 'buy', item: 'brass lantern', person: 'Pip', price: '2 shillings 6 pence' }, context);
    assert.equal(stranger.outcome.ok, false, 'Pip does not sell the lantern');
    assert.match(stranger.outcome.reason, /brass lantern is sold by Mara Quell, not Pip/u);
    const nobody = resolveGameAction(state, { kind: 'buy', item: 'brass lantern', person: 'Old Tam', price: '3 shillings' }, context);
    assert.match(nobody.outcome.reason, /nobody here is called Old Tam/u);
    const present = resolveGameAction(state, { kind: 'buy', item: 'a jar of pickled eggs', person: 'Old Tam', price: '3 pence' }, { ...context, present: ['Old Tam'] });
    assert.equal(present.outcome.ok, true, 'someone the scene shows here can trade before the lore records them');
    assert.equal(present.ops[0].to.name, 'Old Tam');
});

test('a priced service is paid for without creating an object; an unknown ware with a price is taken on trust', () => {
    const { store, state } = shop();
    const context = contextFor(state, store);
    const bed = resolveGameAction(state, { kind: 'buy', item: 'a night\'s bed', person: 'Mara' }, context);
    assert.equal(bed.outcome.ok, true, bed.outcome.reason);
    assert.deepEqual(bed.ops.map(op => op.type), ['money']);
    assert.equal(bed.ops[0].amount, 24);
    const trust = resolveGameAction(state, { kind: 'buy', item: 'a wedge of cheese', person: 'Mara', price: '4 pence' }, context);
    assert.equal(trust.outcome.ok, true);
    assert.equal(trust.outcome.assumed, true);
    assert.equal(trust.ops[1].type, 'item.add');
    assert.equal(trust.ops[1].name, 'a wedge of cheese');
    const unpriced = resolveGameAction(state, { kind: 'buy', item: 'a wedge of cheese', person: 'Mara' }, context);
    assert.equal(unpriced.outcome.ok, false);
    assert.match(unpriced.outcome.reason, /no price was named/u);
});

test('selling needs a carried thing and a buyer who can pay', () => {
    const { store, state } = shop();
    const context = contextFor(state, store);
    const sale = resolveGameAction(state, { kind: 'sell', item: 'tin whistle', person: 'Mara' }, context);
    assert.equal(sale.outcome.ok, true, sale.outcome.reason);
    assert.match(sale.outcome.text, /Sold tin whistle to Mara Quell for 2 shillings/u);
    const nothing = resolveGameAction(state, { kind: 'sell', item: 'golden fleece', person: 'Mara' }, context);
    assert.match(nothing.outcome.reason, /carries nothing called golden fleece/u);
    const atLeast = ledger(state, store, { money: [{ from: 'world', to: 'Pip', amount: 1, unit: 'penny' }] }, 2);
    const unknownTotal = resolveGameAction(atLeast, { kind: 'sell', item: 'tin whistle', person: 'Pip', price: '2 shillings' }, contextFor(atLeast, store));
    assert.equal(unknownTotal.outcome.ok, true, 'a purse only known as "at least" does not refuse a sale');
    const fresh = shop();
    const counted = applyGameOperations(fresh.state, [
        { type: 'stage.set', key: 'salt_lantern', place: 'Salt Lantern', people: [{ name: 'Pip', role: 'stable boy', coin: 1 }] },
        { type: 'introduce', stage: 'salt_lantern', name: 'Pip' },
    ], { messageIndex: 2, source: 'planner' }).state;
    const broke = resolveGameAction(counted, { kind: 'sell', item: 'tin whistle', person: 'Pip', price: '2 shillings' }, contextFor(counted, fresh.store));
    assert.equal(broke.outcome.ok, false);
    assert.match(broke.outcome.reason, /Pip has only 1 penny/u);
});

test('giving, receiving, dropping, consuming and taking from the place or a body', () => {
    const { store, state } = shop();
    const context = contextFor(state, store);
    const gift = resolveGameAction(state, { kind: 'give', item: 'hard bread', person: 'Pip', quantity: 2 }, context);
    assert.equal(gift.outcome.ok, true);
    assert.match(gift.outcome.text, /Gave hard bread ×2 to Pip/u);
    const received = resolveGameAction(state, { kind: 'receive', item: 'sea chart', person: 'Mara' }, context);
    assert.equal(received.outcome.ok, true);
    assert.equal(received.ops[0].how, 'give');
    const unknownGift = resolveGameAction(state, { kind: 'receive', item: 'iron key', person: 'Mara' }, context);
    assert.equal(unknownGift.outcome.assumed, true);
    const dropped = resolveGameAction(state, { kind: 'drop', item: 'tin whistle' }, context);
    assert.match(dropped.outcome.text, /Set down tin whistle at Salt Lantern/u);
    const eaten = resolveGameAction(state, { kind: 'consume', item: 'bread', quantity: 1 }, context);
    assert.match(eaten.outcome.text, /hard bread used up \(2 left\)/u);
    const theft = resolveGameAction(state, { kind: 'take', item: 'sea chart', person: 'Mara' }, context);
    assert.equal(theft.outcome.ok, false);
    assert.match(theft.outcome.reason, /Mara Quell is alive and holding sea chart/u);
    const shelf = resolveGameAction(state, { kind: 'take', item: 'lantern' }, context);
    assert.equal(shelf.outcome.ok, true, shelf.outcome.reason);
    assert.equal(shelf.ops[0].how, 'take');
    assert.match(shelf.outcome.text, /Took brass lantern from here at Salt Lantern/u);

    const dead = applyGameOperations(state, [{ type: 'person.dies', name: 'Pip', place: { kind: 'location', ...PLACE }, cause: 'fell from the loft' }], { messageIndex: 2, source: 'ledger' }).state;
    const withPurse = ledger(dead, store, { objects: [{ op: 'add', key: 'pips_knife', name: 'small knife', kind: 'weapon', holder: 'body_of_pip' }] }, 3);
    const loot = resolveGameAction(withPurse, { kind: 'take', item: 'knife', person: 'Pip' }, contextFor(withPurse, store));
    assert.equal(loot.outcome.ok, true, loot.outcome.reason);
    assert.equal(loot.ops[0].how, 'loot');
    assert.match(loot.outcome.text, /from Pip's body/u);
});

test('paying and collecting coin check the purses', () => {
    const { store, state } = shop();
    const context = contextFor(state, store);
    const tip = resolveGameAction(state, { kind: 'pay', amount: '6 pence', person: 'Pip', reason: 'a tip' }, context);
    assert.match(tip.outcome.text, /Paid 6 pence to Pip for a tip\. Purse now: 4 shillings, 6 pence/u);
    const tooMuch = resolveGameAction(state, { kind: 'pay', amount: '20 shillings', person: 'Pip' }, context);
    assert.equal(tooMuch.outcome.ok, false);
    const wages = resolveGameAction(state, { kind: 'collect', amount: '2 shillings', person: 'Mara', reason: 'wages' }, context);
    assert.equal(wages.outcome.ok, true);
    assert.equal(wages.ops[0].to.kind, 'player');
    const dead = resolveGameAction(state, { kind: 'pay', amount: '1 penny', person: 'Nobody Here' }, context);
    assert.match(dead.outcome.reason, /nobody here is called Nobody Here/u);
});

test('several actions in one turn see each other; the same action is not applied twice', () => {
    const { store, state } = shop();
    const actions = [
        { kind: 'buy', item: 'brass lantern', person: 'Mara' },
        { kind: 'give', item: 'brass lantern', person: 'Pip' },
    ];
    const { ops, outcomes, state: after } = resolveGameActions(state, actions, contextFor(state, store));
    assert.deepEqual(outcomes.map(outcome => outcome.ok), [true, true]);
    assert.equal(after.items.brass_lantern.holder.name, 'Pip');
    const journaled = applyGameOperations(state, ops, { messageIndex: 4, source: ACTION_SOURCE }).state;
    assert.equal(actionAlreadyApplied(journaled, ops.slice(0, 2), 4), true);
    assert.equal(actionAlreadyApplied(journaled, ops.slice(0, 2), 5), false, 'a later turn may repeat it');
    assert.equal(actionEntriesInRange(journaled, 4, 5).length, 3);
});

test('ledger records that repeat a journaled action are dropped', () => {
    const { store, state } = shop();
    const { ops } = resolveGameActions(state, [{ kind: 'buy', item: 'brass lantern', person: 'Mara' }], contextFor(state, store));
    const journaled = applyGameOperations(state, ops, { messageIndex: 4, source: ACTION_SOURCE }).state;
    const { ops: ledgerOps } = normalizeGameRecords({
        objects: [{ key: 'brass_lantern', op: 'buy', to: 'player' }, { key: 'sea_chart', op: 'update', condition: 'creased' }],
        money: [{ from: 'player', to: 'Mara Quell', amount: 3, unit: 'shilling', reason: 'the lantern' }, { from: 'player', to: 'Pip', amount: 1, unit: 'penny' }],
    }, contextFor(journaled, store), { source: 'ledger' });
    const { ops: kept, dropped } = dropDuplicateLedgerOps(ledgerOps, actionEntriesInRange(journaled, 4, 5));
    assert.deepEqual(dropped.map(op => op.type), ['item.move', 'money']);
    assert.deepEqual(kept.map(op => op.type), ['item.update', 'money']);
    assert.equal(kept[1].to.name, 'Pip');
});

test('the narrator is told what was resolved, and the packet carries it', () => {
    const { store, state } = shop();
    const { outcomes } = resolveGameActions(state, [
        { kind: 'buy', item: 'brass lantern', person: 'Mara' },
        { kind: 'buy', item: 'sea chart', person: 'Mara' },
    ], contextFor(state, store));
    const block = renderResolvedActions(outcomes, { toolsOffered: false });
    assert.match(block, /^RESOLVED THIS TURN/u);
    assert.match(block, /- DONE: Bought brass lantern/u);
    assert.match(block, /- NOT DONE: buy sea chart \(Mara\): Jet is short of coin/u);
    assert.match(block, /Do not call the game tools again/u);
    assert.equal(renderResolvedActions([]), '');
    assert.match(renderToolGuidance({ offered: true }), /BEFORE writing any prose/u);
    assert.match(renderToolGuidance({ offered: true, resolved: true }), /do not call the tools again/u);
    assert.equal(renderToolGuidance({ offered: false }), '');
    const packet = renderGamePacket(state, { playerName: 'Jet', store, resolved: block, toolGuidance: renderToolGuidance({ offered: true }) });
    assert.match(packet, /RESOLVED THIS TURN[\s\S]*Purse: 5 shillings/u);
    assert.match(packet, /GAME TOOLS:/u);
});
