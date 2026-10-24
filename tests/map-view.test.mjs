import assert from 'node:assert/strict';
import test from 'node:test';

import { createEmptyStore, mergeEntityOperations } from '../core.js?v=49';
import {
    anchorView,
    buildMapModel,
    buildSceneModel,
    describeSurroundings,
    exploredPlaces,
    fitView,
    personBadge,
    screenToWorld,
    viewBoxFor,
    zoomAround,
} from '../map-view.js?v=5';

function world() {
    const store = createEmptyStore('map-view');
    mergeEntityOperations(store, [
        { type: 'location', name: 'Highmarket', importance: 80, summary: 'A hill town on the trade road.', map: { x: 300, y: 300 } },
        { type: 'location', name: 'Saltmere', importance: 70, summary: 'A fishing port.', map: { x: 800, y: 500 } },
        { type: 'location', name: 'Highmarket Gate', importance: 50, parent_location: 'Highmarket', map: { x: 340, y: 330 } },
        { type: 'location', name: 'Lantern Row', importance: 50, parent_location: 'Highmarket', map: { x: 260, y: 270 } },
        { type: 'location', name: 'Saltmere Docks', importance: 50, parent_location: 'Saltmere', map: { x: 820, y: 530 } },
        { type: 'character', name: 'Wren Halloway', importance: 70, current_location: 'Highmarket Gate' },
        { type: 'character', name: 'Tobin', importance: 60, current_location: 'Saltmere Docks' },
        { type: 'character', name: 'Mara', importance: 60 },
    ], { messageIndex: 0, maximumOperations: 20 });
    store.lastProcessedIndex = 3;
    return store;
}

const chat = [
    { is_user: false, name: 'Narrator', mes: 'The road climbs to Highmarket Gate, where a guard waves you through.' },
    { is_user: true, name: 'Jet', mes: 'I ask the guard about the fishing ports.' },
    { is_user: false, name: 'Narrator', mes: 'The guard shrugs at the gate. "Ports are a week south," she says.' },
];

test('a place a reply puts the player in is explored, with every place containing it', () => {
    const explored = exploredPlaces(chat, world(), 'Jet');
    assert.ok(explored.has('highmarket gate'));
    assert.ok(explored.has('highmarket'), 'being inside a place explores the place around it');
    assert.ok(!explored.has('saltmere'), 'somewhere only talked about stays unexplored');
    assert.ok(!explored.has('saltmere docks'));
});

test('the current scene and the curated player location count as explored', () => {
    const store = world();
    mergeEntityOperations(store, [{ type: 'character', name: 'Jet', importance: 60, current_location: 'Saltmere Docks' }], { messageIndex: 3 });
    const explored = exploredPlaces([], store, 'Jet', { location: { id: '', name: 'Lantern Row' } });
    assert.ok(explored.has('lantern row') && explored.has('highmarket'));
    assert.ok(explored.has('saltmere docks') && explored.has('saltmere'));
});

test('the unexplored world stays under fog, and so do the people there', () => {
    const store = world();
    const scene = { location: { id: 'location:highmarket gate', name: 'Highmarket Gate' }, participants: [], latestMessageIndex: 2, chatLength: 3 };
    const explored = exploredPlaces(chat, store, 'Jet', scene);
    const model = buildMapModel(store, scene, 'Jet', { explored });
    const shown = Object.fromEntries(model.nodes.map(node => [node.name, node.visited ? 'visited' : 'seen']));
    assert.deepEqual(shown, { Highmarket: 'visited', 'Highmarket Gate': 'visited', 'Lantern Row': 'seen' });
    assert.ok(model.reveals.some(point => point.x === 340 && point.y === 330), 'the fog lifts around the gate');
    assert.deepEqual(model.elsewhere.map(person => [person.name, person.reason]).sort(), [['Mara', 'unknown'], ['Tobin', 'unexplored']]);
    assert.deepEqual(model.nodes.find(node => node.name === 'Highmarket Gate').npcs.map(chip => chip.name), ['Wren Halloway']);

    const everything = buildMapModel(store, scene, 'Jet');
    assert.equal(everything.nodes.length, 5, 'without exploration data nothing is hidden');
    assert.equal(everything.reveals, null);
});

test('the scene view counts unexplored places inside instead of naming them', () => {
    const store = world();
    const scene = { location: { id: 'location:highmarket', name: 'Highmarket' }, participants: [], latestMessageIndex: 2 };
    const model = buildSceneModel(store, scene, 'Jet', 3, { explored: new Set(['highmarket', 'highmarket gate']) });
    assert.deepEqual(model.nodes.map(node => node.name), ['Highmarket', 'Highmarket Gate']);
    assert.equal(model.hiddenNearby, 1);

    const around = describeSurroundings(store, scene, 'Jet', new Set(['highmarket', 'highmarket gate']));
    assert.deepEqual(around.nearby, [{ name: 'Highmarket Gate', people: 1 }]);
    assert.equal(around.hiddenNearby, 1);
});

for (const [label, size] of [['portrait phone', { width: 412, height: 780 }], ['landscape desktop', { width: 1366, height: 760 }]]) {
    test(`zooming keeps the point under the fingers in place (${label})`, () => {
        const start = { cx: 500, cy: 350, scale: 1 };
        const fingers = { x: size.width * 0.8, y: size.height * 0.3 };
        const before = screenToWorld(start, size, fingers);
        const zoomed = zoomAround(start, size, fingers, 3);
        const after = screenToWorld(zoomed, size, fingers);
        assert.ok(Math.abs(after.x - before.x) < 1e-6 && Math.abs(after.y - before.y) < 1e-6, 'the anchored point does not drift');
        assert.equal(zoomed.scale, 3);
        assert.notDeepEqual([zoomed.cx, zoomed.cy], [0, 0], 'not pulled to the top-left corner');

        const box = viewBoxFor(zoomed, size);
        assert.ok(Math.abs(box.width / box.height - size.width / size.height) < 1e-9, 'the view keeps the screen\'s shape');

        // A pinch that also moves: the world point stays under the moving midpoint.
        const moved = { x: fingers.x - 60, y: fingers.y + 40 };
        const pinched = anchorView({ ...zoomed, scale: 4 }, size, before, moved);
        const under = screenToWorld(pinched, size, moved);
        assert.ok(Math.abs(under.x - before.x) < 1e-6 && Math.abs(under.y - before.y) < 1e-6);
    });
}

test('the opening view fits the explored region', () => {
    const size = { width: 412, height: 780 };
    const bounds = { x: 200, y: 200, width: 240, height: 240 };
    const view = fitView(bounds, size);
    const box = viewBoxFor(view, size);
    assert.ok(box.x <= bounds.x && box.y <= bounds.y);
    assert.ok(box.x + box.width >= bounds.x + bounds.width - 1e-6 && box.y + box.height >= bounds.y + bounds.height - 1e-6);
    assert.ok(view.scale > 1, 'a small explored region opens zoomed in');
});

test('portraits use initials and a stable colour', () => {
    assert.equal(personBadge('Wren Halloway').initials, 'WH');
    assert.equal(personBadge('Tobin').initials, 'T');
    assert.equal(personBadge('Tobin').hue, personBadge('tobin').hue);
});
