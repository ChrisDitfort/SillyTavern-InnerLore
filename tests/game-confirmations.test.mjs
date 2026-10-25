import assert from 'node:assert/strict';
import test from 'node:test';

import { createEmptyStore } from '../core.js';
import { applyGameOperations, createGameState, gameOverview, gameStateBefore, normalizeGameState } from '../game.js?v=6';
import { ACTION_SOURCE } from '../game-actions.js?v=3';
import { commitGamePasses, opTouchesPlayer, pendingConfirmations, pendingOps, sameExchangeOp, splitConfirmableOps } from '../pass-pipeline.js?v=5';

const chat = [
    { mes: 'Bryn Tolley waits at the Gullhouse door.', is_user: false, is_system: false, name: 'Narrator' },
    { mes: 'I pay for a bed.', is_user: true, is_system: false, name: 'Chris' },
    { mes: 'You hand Bryn two coppers and she steps aside. "Beds are two coppers," she says to the man behind you, who pays her too.', is_user: false, is_system: false, name: 'Narrator' },
];

function storeWithPurse() {
    const store = createEmptyStore('chat-1');
    store.entities['character:bryn tolley'] = { id: 'character:bryn tolley', type: 'character', name: 'Bryn Tolley', enabled: true, importance: 60 };
    let game = createGameState();
    game = applyGameOperations(game, [
        { type: 'currency.set', currency: { name: 'coin', units: [{ name: 'copper', plural: 'coppers', value: 1 }] } },
        { type: 'purse.set', amount: 10 },
    ], { messageIndex: 0, source: 'planner' }).state;
    store.game = game;
    return store;
}

const ledgerResponse = extra => ({
    payload: {
        objects: [], standings: [], reputation: [], deaths: [], abilities: [], contacts: [],
        prices: [{ key: 'gullhouse_bed', name: 'a bed at the Gullhouse', kind: 'lodging', price: 2, unit: 'copper', per: 'night', seller: 'Bryn Tolley' }],
        money: [
            { from: 'player', to: 'Bryn Tolley', amount: 2, unit: 'copper', reason: 'a bed', evidence: 'You hand Bryn two coppers' },
            { from: 'the man behind you', to: 'Bryn Tolley', amount: 2, unit: 'copper', reason: 'a bed', evidence: 'who pays her too' },
        ],
        ...extra,
    },
    repaired: false,
    parseDiagnostics: [],
});

const commit = (store, response, range = [1, 2]) => commitGamePasses(store, {
    chat, playerName: 'Chris', settings: { gameEnabled: true, gameLedgerEnabled: true }, gameEnabled: true, gameStart: range[0], gameEnd: range[1],
    gameTranscript: 'PLAYER: I pay for a bed.\nSTORY: You hand Bryn two coppers...', gameScene: null,
    gameResponse: response, gameError: null, ledgerAssisted: false, plannerPlan: null, plannerResponse: null, plannerError: null, log: () => {},
});

test('a prose payment by the player waits for confirmation while a price and another person\'s payment apply at once', () => {
    const store = storeWithPurse();
    const result = commit(store, ledgerResponse());
    const game = normalizeGameState(store.game);
    assert.equal(game.purse.amount, 10, 'the purse did not move on the model\'s word');
    assert.equal(game.pending.length, 1, 'the player\'s payment awaits confirmation');
    assert.match(game.pending[0].text, /paid 2 coppers to Bryn Tolley for a bed/u);
    assert.equal(game.pending[0].at, 2);
    assert.equal(game.pending[0].ops.length, 1);
    assert.ok(Object.values(game.prices || {}).some(price => price.key === 'gullhouse_bed'), 'the price applied at once');
    assert.equal(result.gameResult.awaitingConfirmation, 1);
    assert.equal(game.lastProcessedIndex, 2, 'the ledger watermark still advanced');

    // Confirmed: applied under the action source, so a later read never counts it twice.
    const applied = applyGameOperations(game, game.pending[0].ops, { messageIndex: 2, source: ACTION_SOURCE });
    assert.equal(applied.state.purse.amount, 8);
    assert.equal(applied.state.journal.at(-1).source, ACTION_SOURCE);
});

test('the same exchange is not asked about twice, and one the player declined is not asked again', () => {
    const store = storeWithPurse();
    commit(store, ledgerResponse());
    assert.equal(normalizeGameState(store.game).pending.length, 1);
    // The same passage read again (a retried pass) adds no second question.
    store.game.lastProcessedIndex = 0;
    commit(store, ledgerResponse());
    assert.equal(normalizeGameState(store.game).pending.length, 1, 'still one question');
    // Declined: it moves to the declined list and a re-read does not raise it.
    const game = normalizeGameState(store.game);
    game.declined = [{ id: game.pending[0].id, at: 2, ops: game.pending[0].ops }];
    game.pending = [];
    game.lastProcessedIndex = 0;
    store.game = game;
    commit(store, ledgerResponse());
    assert.equal(normalizeGameState(store.game).pending.length, 0, 'a declined exchange is not asked again');
});

test('the opening scene is canon: what the greeting hands the player applies without a question', () => {
    const store = storeWithPurse();
    commitGamePasses(store, {
        chat, playerName: 'Chris', settings: { gameEnabled: true, gameLedgerEnabled: true }, gameEnabled: true, gameStart: 0, gameEnd: 0,
        gameTranscript: 'STORY: Bryn Tolley waits...', gameScene: null,
        gameResponse: { payload: { objects: [{ key: 'entry_pass', op: 'add', name: 'entry pass', holder: 'player', evidence: 'your pass' }], money: [], prices: [], standings: [], reputation: [], deaths: [], abilities: [], contacts: [] }, repaired: false, parseDiagnostics: [] },
        gameError: null, ledgerAssisted: false, plannerPlan: null, plannerResponse: null, plannerError: null, log: () => {},
    });
    const game = normalizeGameState(store.game);
    assert.equal(game.pending.length, 0);
    assert.ok(Object.values(game.items).some(item => item.name === 'entry pass' && item.holder.kind === 'player'));
});

test('exchanges with one person are one question; a purse count stands alone; matching ignores wording', () => {
    const game = normalizeGameState(storeWithPurse().game);
    const ops = [
        { type: 'money', from: { kind: 'player' }, to: { kind: 'character', name: 'Mara Quell' }, amount: 2, reason: 'a candle', note: 'Mara takes the two coins' },
        { type: 'item.add', key: 'tallow_candle', name: 'tallow candle', holder: { kind: 'player' }, note: 'hands Jet a tallow candle' },
        { type: 'purse.set', amount: 9 },
    ];
    const entries = pendingConfirmations(ops, game, { at: 4, playerName: 'Jet', now: 1000 });
    assert.equal(entries.length, 2);
    assert.deepEqual(entries[0].ops.map(op => op.type), ['money', 'item.add']);
    assert.match(entries[0].text, /paid 2 coppers to Mara Quell for a candle; got tallow candle/u);
    assert.equal(entries[0].evidence, 'Mara takes the two coins');
    assert.deepEqual(entries[1].ops.map(op => op.type), ['purse.set']);
    assert.deepEqual(pendingOps(entries).length, 3);
    assert.deepEqual(pendingOps([{ op: { type: 'purse.set', amount: 1 } }]).length, 1, 'an old single-op entry still reads');

    // Two people: each their own question.
    const two = pendingConfirmations([
        { type: 'money', from: { kind: 'player' }, to: { kind: 'character', name: 'Mara Quell' }, amount: 2 },
        { type: 'money', from: { kind: 'player' }, to: { kind: 'character', name: 'Old Fen' }, amount: 1 },
    ], game, { at: 4, now: 1000 });
    assert.equal(two.length, 2);

    assert.ok(sameExchangeOp(
        { type: 'money', from: { kind: 'player' }, to: { kind: 'character', name: 'Bryn Tolley' }, amount: 2, reason: 'bed' },
        { type: 'money', from: { kind: 'player' }, to: { kind: 'character', name: 'bryn tolley' }, amount: 2, reason: 'a night' },
        game,
    ), 'the same payment to the same person, worded differently');
    assert.ok(!sameExchangeOp(
        { type: 'money', from: { kind: 'player' }, to: { kind: 'character', name: 'Bryn Tolley' }, amount: 2 },
        { type: 'money', from: { kind: 'player' }, to: { kind: 'character', name: 'Bryn Tolley' }, amount: 3 },
        game,
    ));
});

test('which operations touch the player, the pending list in the overview, and a rewind dropping later ones', () => {
    const game = normalizeGameState(storeWithPurse().game);
    game.items['item:knife'] = { key: 'item:knife', name: 'knife', status: 'active', quantity: 1, holder: { kind: 'player' }, history: [] };
    game.items['item:lamp'] = { key: 'item:lamp', name: 'lamp', status: 'active', quantity: 1, holder: { kind: 'place', name: 'the inn' }, history: [] };
    assert.equal(opTouchesPlayer({ type: 'money', from: { kind: 'player' }, to: { kind: 'character', name: 'Bryn' } }, game), true);
    assert.equal(opTouchesPlayer({ type: 'money', from: { kind: 'character', name: 'A' }, to: { kind: 'character', name: 'B' } }, game), false);
    assert.equal(opTouchesPlayer({ type: 'item.move', key: 'item:lamp', to: { kind: 'player' } }, game), true, 'something arriving in the bag');
    assert.equal(opTouchesPlayer({ type: 'item.move', key: 'item:knife', to: { kind: 'character', name: 'Bryn' } }, game), true, 'something leaving the bag');
    assert.equal(opTouchesPlayer({ type: 'item.move', key: 'item:lamp', to: { kind: 'character', name: 'Bryn' } }, game), false, 'a thing moving between others');
    assert.equal(opTouchesPlayer({ type: 'price.set', key: 'x' }, game), false);
    const split = splitConfirmableOps([{ type: 'price.set', key: 'x' }, { type: 'purse.set', amount: 3 }], game);
    assert.equal(split.direct.length, 1);
    assert.equal(split.confirmable.length, 1);

    game.pending = pendingConfirmations([{ type: 'money', from: { kind: 'player' }, to: { kind: 'character', name: 'Bryn Tolley' }, amount: 2, reason: 'a bed', note: 'You hand Bryn two coppers' }], game, { at: 7, playerName: 'Chris', now: 1000 });
    game.declined = [{ id: 'old', at: 9, ops: [] }];
    const overview = gameOverview(game, { playerName: 'Chris' });
    assert.deepEqual(overview.pending.map(entry => [entry.id, entry.at]), [['confirm-rs-7-0', 7]]);
    const rewound = gameStateBefore(game, 7);
    assert.equal(rewound.pending.length, 0, 'a rewind to before the reply drops its pending exchange');
    assert.equal(rewound.declined.length, 0);
    assert.equal(gameStateBefore(game, 8).pending.length, 1);
});
