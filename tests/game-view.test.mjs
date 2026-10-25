import assert from 'node:assert/strict';
import test from 'node:test';

import { renderTradePartner, tradeAction } from '../game-view.js?v=4';

test('trade buttons write the player\'s move for the story to narrate', () => {
    const hobb = { name: 'Hobb Varle' };
    assert.equal(tradeAction('buy', hobb, { name: 'tin whistle', price: '4 copper' }), 'Buy the tin whistle from Hobb Varle for 4 copper.');
    assert.equal(tradeAction('ask', hobb, { name: 'Varle family knife' }), 'Ask Hobb Varle what they want for Varle family knife.');
    assert.equal(tradeAction('service', hobb, { name: 'a mended pot', price: '2 copper' }), 'Buy a mended pot from Hobb Varle for 2 copper.');
    assert.equal(tradeAction('sell', { name: 'Mara Quell' }, { name: 'wool coat', value: '3 silver' }), 'Offer to sell my wool coat to Mara Quell for 3 silver.');
    assert.equal(tradeAction('swap', hobb, { name: 'tin whistle' }, { name: 'a bone die' }), 'Offer Hobb Varle my bone die in trade for the tin whistle.');
    const body = { name: "Corran Dace's body" };
    assert.equal(tradeAction('take', body, { name: 'short sword' }), "Take the short sword from Corran Dace's body.");
    assert.equal(tradeAction('search', body), "Search Corran Dace's body.");
});

test('a trade page offers buying and swapping, and a body offers taking and searching', () => {
    const overview = { purse: '3 silver', mine: [{ key: 'coat', name: 'wool coat', value: '3 silver', quantity: 1 }], partners: [] };
    const hobb = { kind: 'person', name: 'Hobb Varle', coin: '2 silver', wares: [{ key: 'whistle', name: 'tin whistle', price: '4 copper', quantity: 1 }], services: [] };
    const page = renderTradePartner(overview, hobb);
    assert.match(page, /Hobb Varle carries 2 silver\./u);
    assert.match(page, /data-act="buy" data-key="whistle"/u);
    assert.match(page, /data-act="sell" data-key="coat"/u);
    const swapping = renderTradePartner(overview, hobb, { swapFor: 'whistle' });
    assert.match(swapping, /Choose what to offer for the tin whistle\./u);
    assert.match(swapping, /data-act="offer" data-key="coat"/u);
    const body = renderTradePartner(overview, { kind: 'body', name: "Corran Dace's body", cause: 'stabbed', wares: [] });
    assert.match(body, /data-act="search"/u);
    assert.match(body, /Nothing can be seen without searching\./u);
});
