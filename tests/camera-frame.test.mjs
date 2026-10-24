import assert from 'node:assert/strict';
import test from 'node:test';

import { createEmptyStore, mergeEntityOperations } from '../core.js';
import { deriveCameraFrame, renderCameraPacket } from '../scene.js?v=8';

function harbourWorld() {
    const store = createEmptyStore('camera-chat');
    mergeEntityOperations(store, [
        { type: 'location', name: 'Port Vell', importance: 70, summary: 'A walled harbour town.' },
        { type: 'location', name: 'The Gull Inn', parent_location: 'Port Vell', importance: 60, summary: 'A dockside inn.' },
        { type: 'location', name: 'The Cellar', parent_location: 'The Gull Inn', importance: 40, summary: 'Barrels under the inn.' },
        { type: 'location', name: 'Fish Market', parent_location: 'Port Vell', importance: 50, summary: 'Stalls by the quay.' },
        { type: 'location', name: 'Lighthouse', importance: 50, summary: 'A lighthouse on the point.' },
        { type: 'character', name: 'Mara', importance: 60, summary: 'The innkeeper.', current_state: 'Wiping down the bar.', current_location: 'The Gull Inn' },
        { type: 'character', name: 'Tobin', importance: 50, summary: 'A dock warden.', current_state: 'Walking the walls.', current_location: 'Port Vell' },
        { type: 'character', name: 'Ilse', importance: 50, summary: 'A lamp keeper.', current_state: 'Trimming the lamp.', current_location: 'Lighthouse' },
        { type: 'character', name: 'Bram', importance: 40, summary: 'A sailor.' },
        { type: 'character', name: 'Wren', importance: 40, summary: 'A ferry hand.', current_state: 'Coiling rope.', current_location: 'Port Vell' },
    ], { messageIndex: 1, minimumImportance: 0, maximumOperations: 20 });
    const inn = store.entities['location:the gull inn'];
    inn.spatial = { invariants: { back_door: {
        key: 'back_door', kind: 'entrance', subject: 'The Gull Inn', relation: 'door_at', object: 'the alley',
        statement: 'A back door opens onto the fish-gut alley.',
    } } };
    return store;
}

const scene = {
    location: { id: 'location:the gull inn', name: 'The Gull Inn', source: 'named in latest turn' },
    participants: [
        { id: 'character:jet', name: 'Jet', reason: 'player character' },
        { id: 'character:mara', name: 'Mara', reason: 'named in latest turn' },
        { id: 'character:tobin', name: 'Tobin', reason: 'named in latest exchange' },
        { id: 'character:ilse', name: 'Ilse', reason: 'named in latest turn' },
        { id: 'character:bram', name: 'Bram', reason: 'active in recent scene' },
        { id: 'character:wren', name: 'Wren', reason: 'named in latest turn' },
    ],
    addressed: [{ id: 'character:mara', name: 'Mara' }],
    objects: [{ id: 'item:brass key', name: 'brass key' }],
    latestUserName: 'Jet',
};

test('the camera frame sorts people by where they are and lists the ways on', () => {
    const frame = deriveCameraFrame(scene, harbourWorld(), { playerName: 'Jet', clockLabel: 'Late evening' });
    assert.equal(frame.where, 'The Gull Inn');
    assert.equal(frame.within, 'Port Vell');
    assert.equal(frame.time, 'Late evening');
    assert.deepEqual(frame.withYou.map(person => person.name), ['Mara', 'Wren'], 'someone recorded in the enclosing town and named just now is present');
    assert.equal(frame.withYou[0].state, 'Wiping down the bar.');
    assert.deepEqual(frame.elsewhere, [{ name: 'Ilse', at: 'Lighthouse' }]);
    assert.deepEqual(frame.unconfirmed, [{ name: 'Tobin' }, { name: 'Bram' }], 'an earlier mention of someone recorded in the town is not presence');
    assert.deepEqual(frame.waysOn, [
        { name: 'Port Vell', relation: 'the wider place' },
        { name: 'The Cellar', relation: 'inside' },
        { name: 'Fish Market', relation: 'also in Port Vell' },
        { name: '', relation: 'A back door opens onto the fish-gut alley.' },
    ]);
});

test('the camera packet renders the frame and keeps its header under a tight budget', () => {
    const frame = deriveCameraFrame(scene, harbourWorld(), { playerName: 'Jet' });
    const packet = renderCameraPacket(frame, 4_000);
    assert.match(packet, /^<inner_lore_camera pov="Jet" compiled="true">/u);
    assert.match(packet, /Where: The Gull Inn, within Port Vell\./u);
    assert.match(packet, /With Jet: Mara \(Wiping down the bar\.\); Wren \(Coiling rope\.\)\./u);
    assert.match(packet, /Ways on from here: Port Vell \(the wider place\); The Cellar \(inside\); Fish Market \(also in Port Vell\); A back door opens/u);
    assert.match(packet, /last recorded elsewhere[^\n]*Ilse \(at Lighthouse\)/u);
    assert.match(packet, /presence not confirmed now: Tobin; Bram/u);

    const tight = renderCameraPacket(frame, 700);
    assert.ok(tight.length <= 700, `packet stays within budget (${tight.length})`);
    assert.match(tight, /Behind the camera:/u);
    assert.match(tight, /<\/inner_lore_camera>$/u);
});

test('at an unresolved place, presence follows how recently people were named', () => {
    const frame = deriveCameraFrame({ ...scene, location: { name: 'a muddy road' } }, harbourWorld(), { playerName: 'Jet' });
    assert.equal(frame.where, 'a muddy road');
    assert.deepEqual(frame.waysOn, []);
    assert.deepEqual(frame.elsewhere, [], 'an unresolved place cannot rule anyone out');
    assert.deepEqual(frame.withYou.map(person => person.name), ['Mara', 'Ilse', 'Wren']);
    assert.deepEqual(frame.unconfirmed, [{ name: 'Tobin' }, { name: 'Bram' }]);
});
