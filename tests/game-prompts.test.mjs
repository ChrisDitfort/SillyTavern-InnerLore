import assert from 'node:assert/strict';
import test from 'node:test';

import { createEmptyStore, mergeEntityOperations } from '../core.js?v=48';
import {
    applyGameOperations,
    carriedItems,
    createGameState,
    gameContext,
    itemsAtPlace,
    normalizeGameRecords,
} from '../game.js?v=2';
import { buildLedgerMessages, buildPlannerMessages } from '../game-prompts.js?v=2';
import { validateGamePayload } from '../game-client.js?v=1';
import { parseInnerLoreDsl, parseInnerLoreOutput, prepareOutputMessages } from '../output-codec.js?v=3';

function world() {
    const store = createEmptyStore('game-prompts');
    mergeEntityOperations(store, [
        { type: 'location', name: 'Salt Lantern', importance: 80, summary: 'A harbour inn on Rope Street.' },
        { type: 'location', name: 'Old Quay', importance: 60, summary: 'The fish quay.' },
        { type: 'character', name: 'Bess', importance: 50, summary: 'Mara\'s niece.', current_location: 'Salt Lantern' },
    ], { messageIndex: 0, maximumOperations: 20 });
    return store;
}

const scene = { location: { name: 'Salt Lantern', id: 'location:salt lantern' }, participants: [{ name: 'Bess' }] };

test('the ledger prompt carries the scene, the game state and the passage, and converts to the DSL contract', () => {
    const store = world();
    const game = applyGameOperations(createGameState(), [
        { type: 'item.add', key: 'knife', name: 'knife', kind: 'tool', quantity: 1, value: 15, holder: { kind: 'player', name: 'Jet' } },
        { type: 'item.add', key: 'candles', name: 'tallow candle', kind: 'tool', quantity: 6, holder: { kind: 'location', name: 'Salt Lantern', id: 'location:salt lantern' }, price: 1, seller: 'Bess' },
    ], { messageIndex: 1 }).state;
    const messages = buildLedgerMessages({
        game, store, scene, playerName: 'Jet', transcript: '[message 2; PLAYER — Jet]\nI buy two candles.\n\n[message 3; STORY — Narrator]\nBess wraps two candles in paper.',
    });
    const system = messages[0].content;
    const user = messages[1].content;
    assert.match(system, /exact bookkeeper/u);
    assert.match(user, /"player_items":\[\{"key":"knife"/u);
    assert.match(user, /"items_here":\[\{"key":"candles","name":"tallow candle","quantity":6,"holder":"Salt Lantern","price":"1 coin","seller":"Bess"\}\]/u);
    assert.match(user, /"people_present":\["Bess"\]/u);
    const dsl = prepareOutputMessages(messages, { format: 'dsl', task: 'game' });
    assert.match(dsl[0].content, /First line exactly: INNERLORE GAME 1/u);
    assert.match(dsl[0].content, /DSL FIELD REFERENCE\nCURRENCY/u);
    assert.doesNotMatch(dsl[0].content, /"objects": \[\{/u, 'the JSON schema is replaced by the DSL reference');
    assert.match(dsl[1].content, /Return the INNERLORE GAME 1 DSL document now\./u);
});

test('the planner prompt briefs each place and asks for a starting kit only when one is needed', () => {
    const store = world();
    const targets = [{ name: 'Old Quay', id: 'location:old quay', reason: 'reachable from here' }];
    const withKit = buildPlannerMessages({ game: createGameState(), store, targets, playerName: 'Jet', startingKit: true })[0].content;
    assert.match(withKit, /STARTING_KIT_NEEDED is true: give Jet a plausible starting purse/u);
    const without = buildPlannerMessages({ game: createGameState(), store, targets, playerName: 'Jet', startingKit: false });
    assert.match(without[0].content, /Never give the player money or belongings\./u);
    assert.match(without[1].content, /"name":"Old Quay","why":"reachable from here","summary":"The fish quay\."/u);
    assert.match(without[1].content, /\{"name":"Bess","at":"Salt Lantern"\}/u);
    const dsl = prepareOutputMessages(without, { format: 'dsl', task: 'planner' });
    assert.match(dsl[0].content, /First line exactly: INNERLORE PLANNER 1/u);
    assert.match(dsl[0].content, /Emit one STAGE for every place in PLACES_TO_PREPARE/u);
});

test('a ledger answer in DSL becomes a purchase: stock to the player, money to the seller', () => {
    const store = world();
    let game = applyGameOperations(createGameState(), [
        { type: 'purse.set', amount: 20 },
        { type: 'item.add', key: 'candles', name: 'tallow candle', kind: 'tool', quantity: 6, holder: { kind: 'location', name: 'Salt Lantern', id: 'location:salt lantern' }, price: 1, seller: 'Bess' },
    ], { messageIndex: 1 }).state;
    const answer = `INNERLORE GAME 1
OBJECT candles
op = buy
to = player
quantity = 2
evidence = Bess wraps two candles in paper.
END
MONEY
from = player
to = Bess
amount = 2
reason = two candles
evidence = He counts out two coins.
END
STANDING Bess
delta = 2
reason = Jet paid without haggling and thanked her.
evidence = Bess smiles.
END
DONE`;
    const payload = validateGamePayload(parseInnerLoreOutput(answer, { format: 'dsl', task: 'game' }), 'game');
    const context = gameContext(game, { playerName: 'Jet', entities: store.entities, scenePlace: scene.location });
    const { ops, rejected } = normalizeGameRecords(payload, context);
    assert.deepEqual(rejected, []);
    game = applyGameOperations(game, ops, { messageIndex: 3 }).state;
    assert.equal(game.purse.amount, 18);
    assert.deepEqual(carriedItems(game).map(item => [item.name, item.quantity]), [['tallow candle', 2]]);
    assert.equal(itemsAtPlace(game, scene.location)[0].quantity, 4, 'the rest stays on sale');
    assert.equal(game.standings.bess.score, 2);
});

test('a planner answer in DSL prepares a stage and the starting kit', () => {
    const store = world();
    const answer = `INNERLORE PLANNER 1
CURRENCY
name = Port Vell coin
ITEM units
name = silver
plural = silver
value = 10
END
ITEM units
name = copper
plural = copper
value = 1
END
END
PURSE
set = 3
unit = silver
END
STAGE Old Quay
summary = The herring boats are in.
hooks += A crate of lamp oil sits unclaimed.
END
PERSON Old Fen
location = Old Quay
role = net-mender
standing = 2
sells += mended nets
END
OBJECT mended_net
location = Old Quay
name = mended herring net
kind = tool
price = 3
unit = silver
seller = Old Fen
END
OBJECT clasp_knife
name = clasp knife
kind = tool
holder = player
value = 8
unit = copper
END
DONE`;
    const payload = validateGamePayload(parseInnerLoreDsl(answer, 'planner'), 'planner');
    const game = createGameState();
    const context = gameContext(game, { playerName: 'Jet', entities: store.entities });
    const { ops, rejected } = normalizeGameRecords(payload, context, { source: 'planner', allowStartingKit: true, clockSeconds: 0 });
    assert.deepEqual(rejected, []);
    const state = applyGameOperations(game, ops, { messageIndex: 0, source: 'planner' }).state;
    assert.equal(state.purse.amount, 30);
    assert.equal(state.currency.units.length, 2);
    assert.deepEqual(carriedItems(state).map(item => item.name), ['clasp knife']);
    assert.equal(state.stages.old_quay.people[0].name, 'Old Fen');
    assert.equal(state.items.mended_net.planned, true);
    assert.equal(state.items.mended_net.price, 30);
});

test('validation fills empty lists and refuses people with nowhere to be', () => {
    assert.deepEqual(validateGamePayload({}, 'game'), { objects: [], money: [], prices: [], standings: [], reputation: [], deaths: [] });
    assert.throws(() => validateGamePayload({ objects: 'none' }, 'game'), /must be a list/u);
    assert.throws(() => validateGamePayload({ people: [{ name: 'Old Fen' }] }, 'planner'), /without a STAGE/u);
});

test('a ledger DEATH record and a planner coin field parse from the DSL', () => {
    const ledger = parseInnerLoreOutput(`INNERLORE GAME 1
DEATH the bandit
place = Old Quay
cause = throat cut
evidence = The bandit slumps against the bollard.
END
OBJECT short_sword
op = loot
to = player
evidence = Jet pulls the sword from the bandit's belt.
END
DONE`, { format: 'dsl', task: 'game' });
    assert.deepEqual(ledger.deaths, [{ character: 'the bandit', place: 'Old Quay', cause: 'throat cut', evidence: 'The bandit slumps against the bollard.' }]);
    assert.equal(ledger.objects[0].op, 'loot');
    const planner = parseInnerLoreOutput(`INNERLORE PLANNER 1
STAGE Old Quay
summary = Nets drying.
END
PERSON Old Fen
location = Old Quay
role = net-mender
coin = 3 copper
END
DONE`, { format: 'dsl', task: 'planner' });
    assert.equal(planner.people[0].coin, '3 copper');
});


test('an assisted planner is asked for a smaller cast with one carried thing each', async () => {
    const { buildPlannerMessages } = await import('../game-prompts.js?v=2');
    const { createEmptyStore } = await import('../core.js?v=48');
    const { createGameState } = await import('../game.js?v=2');
    const base = { game: createGameState(), store: createEmptyStore('cast'), targets: [{ name: 'Salt Lantern', reason: 'the player is here' }], startingKit: true, playerName: 'Jet', settings: {} };
    const plain = buildPlannerMessages(base).map(m => m.content).join('\n');
    const assisted = buildPlannerMessages({ ...base, assisted: true }).map(m => m.content).join('\n');
    assert.match(plain, /0 to 4 new people/u);
    assert.match(plain, /1 to 3 things they carry/u);
    assert.match(assisted, /0 to 2 new people/u);
    assert.match(assisted, /one thing they carry/u);
    assert.match(assisted, /three nights of the lodging/u);
});
