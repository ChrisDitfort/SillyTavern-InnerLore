import assert from 'node:assert/strict';
import test from 'node:test';

import {
    createEmptyStore,
    entityId,
    mergeEntityOperations,
    parseCardSeedEntities,
} from '../core.js';

const CARD = {
    data: {
        extensions: {
            inner_lore_seed: {
                entities: [
                    {
                        type: 'location',
                        name: 'Vigil Cross',
                        aliases: ['the ley crossing', 'Vigil Cross'],
                        importance: 80,
                        summary: 'A free city at the crossing of two great ley lines.',
                        description: 'Warden walls hold a fragile peace between emissaries of every court.',
                    },
                    {
                        type: 'place',
                        name: 'The Maw of the First',
                        keys: ['the maw'],
                        importance: 60,
                        summary: 'The crater where the first failed Crucible crossing detonated.',
                    },
                    { type: 'location', name: 'Empty', importance: 40 },
                    { type: 'location', name: 'X', summary: 'too short to keep' },
                    'not-an-object',
                ],
            },
        },
    },
};

test('parseCardSeedEntities accepts the entities wrapper and validates entries', () => {
    const seeds = parseCardSeedEntities(CARD);
    assert.equal(seeds.length, 2);

    const vigil = seeds.find(seed => seed.name === 'Vigil Cross');
    assert.equal(vigil.type, 'location');
    assert.equal(vigil.importance, 80);
    assert.deepEqual(vigil.aliases, ['the ley crossing']);
    assert.ok(vigil.summary.startsWith('A free city'));

    const maw = seeds.find(seed => seed.name === 'The Maw of the First');
    assert.equal(maw.type, 'location');
    assert.deepEqual(maw.keys, ['the maw']);
});

test('parseCardSeedEntities accepts a bare array and v1-style extensions', () => {
    const card = {
        extensions: {
            inner_lore_seed: [
                { type: 'location', name: 'Greyford', summary: 'River-market where every lineage trades.' },
            ],
        },
    };
    const seeds = parseCardSeedEntities(card);
    assert.equal(seeds.length, 1);
    assert.equal(seeds[0].name, 'Greyford');
});

test('parseCardSeedEntities ignores cards without a declaration', () => {
    assert.deepEqual(parseCardSeedEntities({ data: { extensions: {} } }), []);
    assert.deepEqual(parseCardSeedEntities(null), []);
});

test('seed operations merge into a fresh store as tracked locations', () => {
    const store = createEmptyStore('seed-test-chat');
    const seeds = parseCardSeedEntities(CARD);
    const result = mergeEntityOperations(store, seeds, {
        minimumImportance: 0,
        maximumOperations: Math.max(1, seeds.length),
        messageIndex: -1,
    });
    assert.equal(result.created, 2);

    const vigil = store.entities[entityId('location', 'Vigil Cross')];
    assert.ok(vigil, 'seeded store tracks Vigil Cross');
    assert.equal(vigil.type, 'location');
    assert.equal(vigil.importance, 80);
    assert.ok(vigil.aliases.includes('the ley crossing'));
    assert.ok(vigil.summary.startsWith('A free city'));
    assert.ok(store.entities[entityId('location', 'The Maw of the First')]);
});

test('location seeds carry their world-map coordinates into the store', () => {
    const card = {
        data: { extensions: { inner_lore_seed: { entities: [
            { type: 'location', name: 'Vigil Cross', importance: 80, summary: 'Ley-line city.', map: { x: 430, y: 340 } },
            { type: 'location', name: 'The Heartlands', importance: 45, summary: 'Region.', map: { x: 450, y: 310, region: true } },
            { type: 'location', name: 'No Coords', summary: 'Somewhere.' },
        ] } } },
    };
    const seeds = parseCardSeedEntities(card);
    const store = createEmptyStore('seed-map');
    mergeEntityOperations(store, seeds, { minimumImportance: 0, maximumOperations: 10, messageIndex: -1 });
    const vigil = store.entities[entityId('location', 'Vigil Cross')];
    assert.deepEqual(vigil.map, { x: 430, y: 340 });
    const region = store.entities[entityId('location', 'The Heartlands')];
    assert.equal(region.map.region, true);
    const bare = store.entities[entityId('location', 'No Coords')];
    assert.equal(bare.map, undefined);
});
