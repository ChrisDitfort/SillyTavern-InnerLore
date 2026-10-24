import assert from 'node:assert/strict';
import test from 'node:test';

import { createEmptyStore, mergeEntityOperations } from '../core.js';
import { compileContext } from '../context-compiler.js';
import { deriveSceneState } from '../scene.js?v=8';

function harbourTown(playerAt) {
    const store = createEmptyStore('scene-location');
    mergeEntityOperations(store, [
        { type: 'location', name: 'Port Vell', importance: 70, summary: 'A rain-soaked harbour town.' },
        { type: 'location', name: 'Rope Street', parent_location: 'Port Vell', importance: 50, summary: 'A steep street down to the harbour.' },
        {
            type: 'location', name: 'Salt Lantern', parent_location: 'Rope Street', importance: 70, summary: 'An inn on Rope Street.',
            spatial: { set: [
                { key: 'hearth', kind: 'fixture', subject: 'stone hearth', relation: 'fixed_to', object: "the common room's north wall", statement: "A wide stone hearth fills the common room's north wall." },
                { key: 'room_two', kind: 'placement', subject: 'Room Two', relation: 'located_at', object: 'the end of the corridor', statement: 'Room Two is at the end of the upstairs corridor.' },
            ] },
        },
        { type: 'location', name: 'Room Two', parent_location: 'Salt Lantern', importance: 50, summary: 'A guest room with a harbour view.' },
        { type: 'location', name: 'Salt Lantern Stable Yard', parent_location: 'Salt Lantern', importance: 50, summary: 'A walled yard with a stone well.' },
        { type: 'location', name: 'Old Quay', parent_location: 'Port Vell', importance: 50, summary: 'A stone quay.' },
        { type: 'location', name: "Harbour Master's Hut", parent_location: 'Old Quay', importance: 50, summary: 'A stone hut at the end of the quay.' },
        { type: 'location', name: 'Gull Point light', parent_location: 'Port Vell', importance: 50, summary: 'A white lighthouse tower on the headland.' },
        { type: 'character', name: 'Jet', importance: 60, current_location: playerAt },
        { type: 'character', name: 'Dunstan Rook', importance: 50, current_location: "Harbour Master's Hut" },
    ], { messageIndex: 1, minimumImportance: 0, maximumOperations: 30 });
    return store;
}

const reply = mes => ({ is_user: false, name: 'Narrator', mes });
const player = mes => ({ is_user: true, name: 'Jet', mes });
const sceneAt = (messages, store) => deriveSceneState(messages, store, { playerName: 'Jet', currentIndex: messages.length - 1 });

test('once the curator has read the newest reply, its record of the player wins', () => {
    const store = harbourTown('Room Two');
    const messages = [player('I look out of the window.'), reply('Down on the Old Quay you can pick out a fishwife haggling.')];
    store.lastProcessedIndex = 1;
    const scene = sceneAt(messages, store);
    assert.equal(scene.location.name, 'Room Two');
    assert.equal(scene.location.source, 'curated player location');
});

test('while the curator lags, places only seen, pointed at or quoted do not move the player', () => {
    const store = harbourTown("Harbour Master's Hut");
    store.lastProcessedIndex = 0;
    const pointed = sceneAt([
        player('I ask Dunstan about ships north.'),
        reply('Dunstan points out of the window at the white tower on the headland. "That\'s Gull Point light. Ilse keeps it."'),
    ], store);
    assert.equal(pointed.location.name, "Harbour Master's Hut");
    assert.equal(pointed.location.source, 'last recorded player location');

    const looked = sceneAt([player('I look out of the window.'), reply('Rope Street tumbles down its steps to the Old Quay.')], store);
    assert.equal(looked.location.name, "Harbour Master's Hut", 'a look-only turn does not walk the player anywhere');
});

test('while the curator lags, a move into part of a place finds the recorded place', () => {
    const store = harbourTown('Room Two');
    store.lastProcessedIndex = 0;
    const yard = sceneAt([player('I head outside.'), reply('You go back down and out into the yard, where the well stands in the rain.')], store);
    assert.equal(yard.location.name, 'Salt Lantern Stable Yard');
    assert.equal(yard.location.source, 'explicit movement in latest turn');

    const commonRoom = sceneAt([player('I go down to the common room.')], store);
    assert.equal(commonRoom.location.name, 'Salt Lantern');
    assert.equal(commonRoom.location.part, 'the common room');

    const corridor = sceneAt([player('I walk to the end of the corridor.')], harbourTown('Salt Lantern'));
    assert.equal(corridor.location.name, 'Room Two', 'a layout statement about a part names the place it belongs to');
});

test('a time skip that returns somewhere is a move, not a plan', () => {
    const store = harbourTown('Gull Point light');
    store.lastProcessedIndex = 0;
    const scene = sceneAt([player('Three days later, I return to the Salt Lantern.'), reply('The inn looks much as it did.')], store);
    assert.equal(scene.location.name, 'Salt Lantern');
});

test('the scene carries the place around it and named parts, and their layout reaches the lore', () => {
    const store = harbourTown('Room Two');
    store.lastProcessedIndex = 0;
    const messages = [player('I go back down to the common room, then step out into the yard.')];
    const scene = sceneAt(messages, store);
    assert.equal(scene.location.name, 'Salt Lantern Stable Yard');
    assert.deepEqual(scene.places.map(place => [place.name, place.reason]), [['Salt Lantern', 'contains the scene']]);

    const compiled = compileContext({
        store, messages, recentText: messages[0].mes, playerName: 'Jet', currentIndex: 0,
        settings: { enabled: true, autoLoreEnabled: true, innerSelfEnabled: true, maximumInjectedEntities: 4, loreInjectionBudget: 6_000 },
    });
    assert.match(compiled.blocks.lore, /Salt Lantern \(location\)/u);
    assert.match(compiled.blocks.lore, /north wall/u, "the containing inn's layout is in context");
});

test("a street that runs toward the harbour is not the player's move", () => {
    const store = harbourTown('');
    const greeting = 'Rain hammers the coach roof all the way down the hill. The driver points with his whip at a tall, narrow building on Rope Street. "Salt Lantern. Only inn this side of the harbour that\'ll take a stranger after dark." Below you, Rope Street runs steeply downhill toward the harbour, where masts rock behind a curtain of rain. You are left on the doorstep with your satchel.';
    const scene = sceneAt([reply(greeting)], store);
    assert.notEqual((scene.location?.name || '').toLowerCase().replace(/^the\s+/u, ''), 'harbour', scene.location?.name);
    const walking = sceneAt([reply('You walk down to the Old Quay.')], store);
    assert.equal(walking.location?.name, 'Old Quay', 'ordinary movement still moves the player');
});
