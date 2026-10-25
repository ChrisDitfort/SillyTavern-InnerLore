import assert from 'node:assert/strict';
import test from 'node:test';

import { actionConsented, mentionsMoney, playerExchangeIntent, renderToolGuidance } from '../game-actions.js?v=3';

const kinds = (text, options) => [...playerExchangeIntent(text, options).kinds].sort();

test('the player\'s own words decide whether a turn moves coin or belongings', () => {
    // Every message of the playthrough where the narrator called a tool unasked: none is an exchange.
    for (const text of [
        'You place your palm out to hush the crier.',
        'Fine. How much for lodging. And how long does it get me.',
        '"Do you have a name?" You say as you fall into step behind her.',
        '"Wren. Nice to meet you. I\'m apparently salt-born. What\'s that?"',
        '"So that\'s salt-born, no magic, no strength. Are you also salt-born Wren."',
        '"Asking for myself or someone about what?"',
        'I take a look around the inn.',
        'I leave the inn.',
        'I don\'t pay her.',
        'Do you sell bread?',
    ]) assert.deepEqual(kinds(text), [], text);

    assert.deepEqual(kinds('I pay Bryn two coppers for a bed.'), ['pay']);
    assert.deepEqual(kinds('I\'ll take the room.'), ['buy', 'take']);
    assert.deepEqual(kinds('Can you sell me a candle?'), ['buy']);
    assert.deepEqual(kinds('Could I get a room for the night?'), ['buy']);
    assert.deepEqual(kinds('I hand her the knife.'), ['give']);
    assert.deepEqual(kinds('I slide two coppers across the bar.'), ['give', 'pay']);
    assert.deepEqual(kinds('I buy a candle and eat the bread.'), ['buy', 'consume']);
    assert.deepEqual(kinds('I pick the lantern up.'), ['take']);
    assert.deepEqual(kinds('I drop the bag.'), ['drop']);
    assert.deepEqual(kinds('I sell the ring to Mara.'), ['sell']);
    assert.deepEqual(kinds('I ask for my wages.'), ['collect']);
    assert.deepEqual(kinds('I trade my knife for her lamp.'), ['buy', 'sell', 'trade']);
});

test('requests, refusals, second thoughts and other people\'s deals are not the player acting', () => {
    for (const text of [
        'She asks me to pay, but I refuse.',
        'He wants me to buy his map.',
        'She tells me to pay at the door.',
        'The guard demands I pay the toll.',
        'The guard demands payment.',
        'I decline to buy anything.',
        'I\'m not going to buy it.',
        'Should I buy it?',
        'Can I pay you tomorrow?',
        'I think about buying the map.',
        'I could pay her, but I leave instead.',
        'I wonder whether to sell the ring.',
        'The innkeeper sells bread to a sailor.',
        'I give her a nod.',
        'I give up the search.',
        'I pass the guard and climb the stairs.',
        'I press the button.',
        'I push him away.',
        'I count my coins.',
        'I take her hand.',
        'I accept her apology.',
        'I charge at the guard.',
    ]) assert.deepEqual(kinds(text), [], text);
    assert.deepEqual(kinds('She asks me to pay. I hand over two coppers.'), ['give', 'pay']);
    assert.deepEqual(kinds('I ask her to sell me the map.'), ['buy'], 'asking to be sold something is buying, not selling');
    assert.deepEqual(kinds('You hand Bryn two coppers.'), ['give', 'pay'], 'second-person play and a named recipient');
    assert.deepEqual(kinds('I toss him a coin.'), ['give', 'pay']);
    assert.deepEqual(kinds('I count out three coppers.'), ['give', 'pay']);
    assert.deepEqual(kinds('I think I\'ll buy it.'), ['buy'], 'a decision, not a doubt');
    assert.deepEqual(kinds('I\'d like to buy a candle.'), ['buy']);
    assert.deepEqual(kinds('I would like a room for the night.'), ['buy']);
    assert.deepEqual(kinds('I charge him two coppers for the stew.'), ['collect']);
    assert.deepEqual(kinds('Pay Bryn two coppers for a bunk'), ['pay'], 'a suggested move the player picked');
});

test('a short agreement counts only after a price was named', () => {
    const offer = 'She halts at the door. "Beds two coppers, paid at my hand before you cross the sill."';
    assert.deepEqual(kinds('Deal.', { previousText: offer }), ['accept']);
    assert.deepEqual(kinds('Fine.', { previousText: offer }), ['accept']);
    assert.deepEqual(kinds('Fine.', { previousText: 'She shrugs and walks on.' }), []);
    assert.deepEqual(kinds('Fine. How much for lodging. And how long does it get me.', { previousText: offer }), [], 'a longer reply that only asks is not agreement');
    assert.deepEqual(kinds('Here you go, keep the change.', { previousText: offer }), ['accept']);
});

test('a game action needs a matching exchange in the player\'s words', () => {
    const pay = playerExchangeIntent('I pay her two coppers.');
    assert.ok(actionConsented('pay', pay));
    assert.ok(actionConsented('buy', pay), 'paying for something is buying it');
    assert.ok(!actionConsented('collect', pay), 'the narrator cannot turn a payment into a collection');
    assert.ok(!actionConsented('give', playerExchangeIntent('I buy the lamp.')));
    const none = playerExchangeIntent('Are you also salt-born, Wren?');
    for (const kind of ['buy', 'sell', 'pay', 'collect', 'give', 'receive', 'take', 'drop', 'consume']) assert.ok(!actionConsented(kind, none), kind);
    const accept = playerExchangeIntent('Deal.', { previousText: 'Two coppers a night.' });
    assert.ok(actionConsented('buy', accept) && actionConsented('pay', accept) && actionConsented('receive', accept));
    assert.ok(!actionConsented('give', accept) && !actionConsented('consume', accept));
});

test('money mentions use the world\'s own units too', () => {
    assert.ok(mentionsMoney('two coppers'));
    assert.ok(mentionsMoney('a few coins'));
    assert.ok(!mentionsMoney('two lanterns'));
    assert.ok(mentionsMoney('three shards', ['shard', 'shards']));
});

test('the guidance tells the narrator to act only on what the player did', () => {
    const guidance = renderToolGuidance({ offered: true });
    assert.match(guidance, /the player's newest message moves coin or belongings/u);
    assert.match(guidance, /Never call a tool to report that nothing changed hands/u);
    assert.equal(renderToolGuidance({ offered: false }), '');
});
