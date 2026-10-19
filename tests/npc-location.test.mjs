import assert from 'node:assert/strict';
import test from 'node:test';

import {
    createEmptyStore,
    mergeEntityOperations,
    renderLoreContent,
    resolveLocationReference,
} from '../core.js?v=47';
import { deriveSceneState } from '../scene.js?v=5';
import { buildMapModel, buildSceneModel, placeCharacters } from '../map-view.js?v=4';

function worldStore() {
    const store = createEmptyStore('npc-location');
    mergeEntityOperations(store, [
        { type: 'location', name: 'Highmarket', importance: 80, summary: 'A hill town on the trade road.', map: { x: 430, y: 340 } },
        { type: 'location', name: 'Saltmere', importance: 70, summary: 'A fishing port.', map: { x: 348, y: 432 } },
        { type: 'location', name: 'Anvil', importance: 60, summary: 'A forge town in the hills.', map: { x: 212, y: 330 } },
        { type: 'location', name: 'Saltmere Dock House', importance: 60, summary: 'A warehouse on the quay.', parent_location: 'Saltmere' },
    ], { messageIndex: 0, maximumOperations: 20 });
    return store;
}

function character(store, name) {
    return Object.values(store.entities).find(record => record.type === 'character' && record.name === name);
}

test('current_location places a character and later moves them', () => {
    const store = worldStore();
    mergeEntityOperations(store, [{
        type: 'character', name: 'Wren Halloway', importance: 70,
        summary: 'Captain of the Highmarket watch.', current_location: 'highmarket',
    }], { messageIndex: 2 });
    let wren = character(store, 'Wren Halloway');
    assert.equal(wren.currentLocationName, 'Highmarket', 'resolves to the canonical location name');
    assert.equal(wren.currentLocationId, 'location:highmarket');
    assert.equal(wren.locationSince, 2);

    mergeEntityOperations(store, [{ type: 'character', name: 'Wren Halloway', current_location: 'Saltmere' }], { messageIndex: 6 });
    wren = character(store, 'Wren Halloway');
    assert.equal(wren.currentLocationName, 'Saltmere');
    assert.equal(wren.locationSince, 6);

    mergeEntityOperations(store, [{ type: 'character', name: 'Wren Halloway', facts: ['Carries a watch badge.'] }], { messageIndex: 8 });
    assert.equal(character(store, 'Wren Halloway').currentLocationName, 'Saltmere', 'omission never clears a location');

    mergeEntityOperations(store, [{ type: 'character', name: 'Wren Halloway', current_location: 'unknown' }], { messageIndex: 9 });
    assert.equal(character(store, 'Wren Halloway').currentLocationName, '', 'unknown clears it');
});

test('a replaced current_state moves a character to the most specific place it names', () => {
    const store = worldStore();
    mergeEntityOperations(store, [{
        type: 'character', name: 'Tobin', importance: 60,
        current_state: 'Counting crates inside the Saltmere Dock House, writing totals in a tally book.',
    }], { messageIndex: 3 });
    const tobin = character(store, 'Tobin');
    assert.equal(tobin.currentLocationName, 'Saltmere Dock House');
    assert.match(renderLoreContent(tobin), /Current location: Saltmere Dock House/u);
});

test('a capitalized place name only matches capitalized prose', () => {
    const store = worldStore();
    assert.equal(resolveLocationReference(store.entities, 'She sets the blade on her anvil.'), null);
    assert.equal(resolveLocationReference(store.entities, 'She rides for Anvil at dawn.')?.name, 'Anvil');
});

test('parent_location on a person is read as where they are now', () => {
    const store = worldStore();
    mergeEntityOperations(store, [{ type: 'character', name: 'Mara', importance: 60, parent_location: 'Anvil' }], { messageIndex: 1 });
    const mara = character(store, 'Mara');
    assert.equal(mara.currentLocationName, 'Anvil');
    assert.equal(mara.parentLocationName, '', 'a person is never contained by a place');
});

test('the map places NPCs where they are, not where their background says', () => {
    const store = worldStore();
    mergeEntityOperations(store, [
        { type: 'character', name: 'Wren Halloway', importance: 70, summary: 'Captain of the Highmarket watch.', current_location: 'Saltmere' },
        { type: 'character', name: 'Tobin', importance: 60, summary: 'A clerk from Highmarket.' },
        { type: 'character', name: 'Jet', importance: 60, current_location: 'Saltmere' },
    ], { messageIndex: 4 });
    store.lastProcessedIndex = 4;
    const scene = { location: { id: 'location:saltmere', name: 'Saltmere' }, participants: [], latestMessageIndex: 4, chatLength: 5 };
    const model = buildMapModel(store, scene, 'Jet');
    const chipsAt = name => model.nodes.find(node => node.name === name)?.npcs.map(chip => chip.name) || [];
    assert.deepEqual(chipsAt('Saltmere'), ['Wren Halloway']);
    assert.deepEqual(chipsAt('Highmarket'), [], 'a summary mention never places anyone');
    assert.deepEqual(chipsAt('Whereabouts unknown'), ['Tobin']);
    assert.equal(model.player?.node.name, 'Saltmere');
    assert.ok(!model.nodes.some(node => node.npcs.some(chip => chip.name === 'Jet')), 'the player is not an NPC chip');
});

test('a scene participant moves on the map before the curator catches up', () => {
    const store = worldStore();
    mergeEntityOperations(store, [
        { type: 'character', name: 'Wren Halloway', importance: 70, current_location: 'Highmarket' },
    ], { messageIndex: 2 });
    store.lastProcessedIndex = 2;
    const scene = {
        location: { id: 'location:saltmere', name: 'Saltmere' },
        participants: [{ id: 'character:wren halloway', name: 'Wren Halloway', reason: 'named in latest turn', confidence: 1 }],
        latestMessageIndex: 6,
    };
    assert.equal(placeCharacters(store, scene)[0].name, 'Saltmere', 'the landed reply moves her at once');

    store.lastProcessedIndex = 6;
    assert.equal(placeCharacters(store, scene)[0].name, 'Highmarket', 'once processed, the curator is the authority');
});

test('a place reached in play before it is curated gets a provisional node', () => {
    const store = worldStore();
    mergeEntityOperations(store, [
        { type: 'character', name: 'Mara', importance: 60, current_location: 'The Salt Stair' },
    ], { messageIndex: 1 });
    const model = buildMapModel(store, { location: { id: '', name: 'The Salt Stair' }, participants: [], latestMessageIndex: 1 }, 'Jet');
    const stair = model.nodes.find(node => node.name === 'The Salt Stair');
    assert.ok(stair?.provisional);
    assert.deepEqual(stair.npcs.map(chip => chip.name), ['Mara']);
    assert.equal(model.player?.node, stair);
});

test('the scene view shows who is here and nearby, and nobody from elsewhere', () => {
    const store = worldStore();
    mergeEntityOperations(store, [
        { type: 'character', name: 'Wren Halloway', importance: 70, current_location: 'Saltmere' },
        { type: 'character', name: 'Tobin', importance: 60, current_location: 'Saltmere Dock House' },
        { type: 'character', name: 'Mara', importance: 60, current_location: 'Anvil' },
    ], { messageIndex: 3 });
    store.lastProcessedIndex = 3;
    const model = buildSceneModel(store, { location: { id: 'location:saltmere', name: 'Saltmere' }, participants: [], latestMessageIndex: 3 }, 'Jet', 4);
    const chipsAt = name => model.nodes.find(node => node.name === name)?.npcs.map(chip => chip.name) || [];
    assert.deepEqual(chipsAt('Saltmere'), ['Wren Halloway']);
    assert.deepEqual(chipsAt('Saltmere Dock House'), ['Tobin']);
    assert.ok(!model.nodes.some(node => node.npcs.some(chip => chip.name === 'Mara')));
});

test('the scene compiler counts curated NPCs as present and falls back to where the cast is', () => {
    const store = worldStore();
    mergeEntityOperations(store, [
        { type: 'character', name: 'Wren Halloway', importance: 70, current_location: 'Saltmere' },
        { type: 'character', name: 'Tobin', importance: 60, current_location: 'Saltmere' },
    ], { messageIndex: 1 });
    const messages = [
        { is_user: true, name: 'Jet', mes: 'I ask Wren what she thinks of the cargo.' },
        { is_user: false, name: 'Narrator', mes: 'Wren frowns at the crates and says nothing for a long moment.' },
    ];
    const scene = deriveSceneState(messages, store, { playerName: 'Jet' });
    assert.equal(scene.location?.name, 'Saltmere');
    assert.equal(scene.location?.source, 'where the present cast is');
    const tobin = scene.participants.find(item => item.name === 'Tobin');
    assert.equal(tobin?.reason, 'curated at current location');
});

test('a recorded part of a place anchors a character to that place', () => {
    const store = worldStore();
    mergeEntityOperations(store, [{
        type: 'location', name: 'Mill House', importance: 65,
        spatial: { set: [
            { key: 'garden', kind: 'containment', subject: 'Walled garden', relation: 'contains', object: 'fountain', statement: 'The walled garden contains a fountain.' },
        ] },
    }, {
        type: 'character', name: 'Ilse', importance: 90, current_location: 'Walled garden fountain',
    }], { messageIndex: 14, maximumOperations: 20 });
    const ilse = character(store, 'Ilse');
    assert.equal(ilse.currentLocationName, 'Walled garden fountain', 'keeps the specific label');
    assert.equal(ilse.currentLocationId, 'location:mill house');
    const placement = placeCharacters(store, { participants: [], latestMessageIndex: 14 }).find(item => item.character.name === 'Ilse');
    assert.equal(placement.location?.name, 'Mill House');
});
