import assert from 'node:assert/strict';
import test from 'node:test';

import { applyPatch, decodePath, diffStore, encodePath, isEmptyPatch, normalizePatch, patchPaths } from '../store-diff.js?v=4';

const clone = value => JSON.parse(JSON.stringify(value));

function sample() {
    return {
        version: 7,
        lastProcessedIndex: 3,
        entities: {
            'character:a': { id: 'character:a', name: 'A', history: [1] },
            'character:b': { id: 'character:b', name: 'B' },
        },
        brains: { a: { name: 'A', thoughts: ['x'] } },
        progression: {
            lastProcessedIndex: 2,
            clock: { estimatedSeconds: 10, label: 'dusk' },
            goals: { g1: { key: 'g1', status: 'active' } },
            log: [{ at: 1 }],
        },
        game: {
            journal: [{ id: 'j1' }, { id: 'j2' }],
            ledger: { purse: 4 },
            stages: {},
        },
        narrativeLog: [{ t: 1 }],
        checkpoints: [{ index: 1 }],
    };
}

test('a diff names only what changed, at record depth, and round-trips through applyPatch', () => {
    const base = sample();
    const next = clone(base);
    next.lastProcessedIndex = 4;
    next.entities['character:a'].name = 'A prime';
    delete next.entities['character:b'];
    next.entities['character:c'] = { id: 'character:c', name: 'C' };
    next.progression.clock.estimatedSeconds = 25;
    next.progression.goals.g1.status = 'done';
    next.progression.log.push({ at: 2 });
    next.game.journal.push({ id: 'j3' });
    next.game.ledger.purse = 3;
    next.narrativeLog.push({ t: 2 });

    const patch = diffStore(base, next);
    assert.deepEqual(Object.keys(patch.set).sort(), [
        'entities/character:a', 'entities/character:c', 'game/ledger/purse', 'lastProcessedIndex',
        'progression/clock/estimatedSeconds', 'progression/goals/g1',
    ]);
    assert.deepEqual(patch.del, ['entities/character:b']);
    assert.deepEqual(patch.append, {
        'progression/log': [{ at: 2 }],
        'game/journal': [{ id: 'j3' }],
        narrativeLog: [{ t: 2 }],
    });
    assert.deepEqual(applyPatch(clone(base), patch), next);
    assert.ok(isEmptyPatch(diffStore(next, next)));
    assert.equal(patchPaths(patch).length, 6 + 1 + 3);
});

test('an array that was not merely extended is replaced; a reordered one too', () => {
    const base = sample();
    const next = clone(base);
    next.game.journal = [{ id: 'j2' }, { id: 'j1' }];
    next.checkpoints = [{ index: 2 }];
    const patch = diffStore(base, next);
    assert.deepEqual(patch.append, {});
    assert.deepEqual(Object.keys(patch.set).sort(), ['checkpoints', 'game/journal']);
    assert.deepEqual(applyPatch(clone(base), patch), next);
});

test('appends from two writers compose, and the same append arriving twice is not doubled', () => {
    const server = sample();
    const tabA = clone(server);
    const tabB = clone(server);
    tabA.game.journal.push({ id: 'a1' });
    tabB.game.journal.push({ id: 'b1' });
    tabB.narrativeLog.push({ t: 'b' });
    const patchA = diffStore(server, tabA);
    const patchB = diffStore(server, tabB);
    applyPatch(server, patchA);
    applyPatch(server, patchB);
    assert.deepEqual(server.game.journal.map(entry => entry.id), ['j1', 'j2', 'a1', 'b1']);
    assert.deepEqual(server.narrativeLog, [{ t: 1 }, { t: 'b' }]);
    applyPatch(server, patchB);
    assert.deepEqual(server.game.journal.map(entry => entry.id), ['j1', 'j2', 'a1', 'b1'], 'a retried save adds nothing');
});

test('writers on different records never clobber each other; the same record is last writer wins', () => {
    const server = sample();
    const tabA = clone(server);
    const tabB = clone(server);
    tabA.entities['character:a'].name = 'A by tab A';
    tabB.entities['character:b'].name = 'B by tab B';
    tabB.progression.goals.g2 = { key: 'g2', status: 'active' };
    applyPatch(server, diffStore(sample(), tabA));
    applyPatch(server, diffStore(sample(), tabB));
    assert.equal(server.entities['character:a'].name, 'A by tab A');
    assert.equal(server.entities['character:b'].name, 'B by tab B');
    assert.equal(server.progression.goals.g2.status, 'active');
    assert.equal(server.progression.goals.g1.status, 'active');
});

test('paths escape slashes and tildes, and a set creates missing parents', () => {
    const segments = ['entities', 'location:the quay/east ~ pier'];
    const path = encodePath(segments);
    assert.equal(path, 'entities/location:the quay~1east ~0 pier');
    assert.deepEqual(decodePath(path), segments);
    const target = applyPatch({}, { set: { 'game/stages/quay': { place: 'Quay' } }, append: { 'game/journal': [{ id: 'x' }] } });
    assert.deepEqual(target, { game: { stages: { quay: { place: 'Quay' } }, journal: [{ id: 'x' }] } });
});

test('a malformed patch from the wire is reduced to its valid operations', () => {
    const target = applyPatch({ a: 1 }, { set: { b: 2, '': 'ignored' }, del: ['a', 7], append: { c: 'not a list', d: [1] }, extra: true });
    assert.deepEqual(target, { b: 2, d: [1] });
});

test('a branch that did not exist (a new world\'s first pass) is written key by key: what the page added meanwhile survives', () => {
    const base = { chatId: 'c', game: null };
    const working = { chatId: 'c', game: { version: 3, items: {}, purse: { amount: 10 }, abilities: {}, journal: [{ seq: 1, op: 'planner' }], pending: [] } };
    const latest = { chatId: 'c', game: { version: 3, items: { knife: { name: 'knife' } }, abilities: { player: { level: 60 } }, journal: [{ seq: 1, op: 'page' }], pending: [{ id: 'q1' }] } };
    const patch = diffStore(base, working);
    assert.deepEqual(patch.set, { 'game/version': 3, 'game/purse/amount': 10 });
    assert.deepEqual(patch.append, { 'game/journal': [{ seq: 1, op: 'planner' }] });
    assert.deepEqual(patch.init, { 'game/items': {}, 'game/abilities': {}, 'game/pending': [] });
    const merged = applyPatch(structuredClone(latest), patch).game;
    assert.deepEqual(merged.items, { knife: { name: 'knife' } });
    assert.deepEqual(merged.abilities, { player: { level: 60 } });
    assert.deepEqual(merged.journal.map(entry => entry.op), ['page', 'planner']);
    assert.deepEqual(merged.pending, [{ id: 'q1' }]);
    assert.deepEqual(applyPatch({ chatId: 'c', game: null }, patch).game, { items: {}, abilities: {}, pending: [], version: 3, purse: { amount: 10 }, journal: [{ seq: 1, op: 'planner' }] }, 'and on an empty store it is the whole branch');
    assert.deepEqual(normalizePatch(JSON.parse(JSON.stringify(patch))).init, patch.init, 'init survives the wire');
});

