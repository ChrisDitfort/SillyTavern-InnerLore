import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

// Exercises the real SQLite plugin's Event Director context route. The route
// was previously a stub returning null, which crashed every automatic Event
// Director attempt in SQLite-backed chats with "Cannot read properties of
// null (reading 'sources')".

const databaseFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'innerlore-director-')), 'storage.db');
process.env.INNERLORE_STORAGE_DB = databaseFile;

const plugin = await import(`../server/innerlore-storage/index.js?test=${Date.now()}`);

function stubRouter() {
    const handlers = new Map();
    const register = method => (route, handler) => handlers.set(`${method} ${route}`, handler);
    return {
        handlers,
        get: register('GET'),
        post: register('POST'),
        put: register('PUT'),
        delete: register('DELETE'),
    };
}

function call(handler, { params = {}, body = {} } = {}) {
    let payload = null;
    let status = 200;
    const response = {
        status(code) { status = code; return this; },
        json(value) { payload = value; return this; },
    };
    handler({ params, body }, response);
    return { status, payload };
}

test('the plugin builds a grounded Event Director source catalog from the store', () => {
    const router = stubRouter();
    plugin.init(router, []);
    const world = call(router.handlers.get('POST /v1/worlds/'), {
        body: { id: 'innerlore-director-test-world', name: 'Director world' },
    });
    const worldId = world.payload.data.id;
    const saved = call(router.handlers.get('PUT /v1/worlds/:worldId/innerlore/store'), {
        params: { worldId },
        body: {
            chatId: 'director-chat',
            store: {
                entities: [{
                    id: 'location:ben tavern',
                    name: 'Ben Tavern',
                    summary: 'A tavern with a jammed bell.',
                    unresolved: ['Who oiled the hinge?'],
                    revision: 3,
                    lastSeenMessage: 7,
                }],
                brains: [{
                    id: 'freesia',
                    name: 'Freesia',
                    currentMind: {
                        perception: 'The inspection looms.',
                        interpretation: 'I am being tested.',
                        intention: 'Keep the ledger clean.',
                    },
                }],
                progression: {
                    clock: { estimatedSeconds: 400 },
                    goals: { clear_name: { key: 'clear_name', title: 'Clear her name', status: 'active', owner: 'Freesia' } },
                    processes: {},
                    events: { bell_jam: { key: 'bell_jam', title: 'The bell jams', status: 'active', origin: 'automatic_director' } },
                    eventDefinitions: {},
                    eventProposals: {},
                },
                lastProcessedIndex: 7,
            },
            expectedRevision: 0,
        },
    });
    assert.equal(saved.payload.ok, true);

    const handler = router.handlers.get('POST /v1/worlds/:worldId/innerlore/event-director/context');

    const privateContext = call(handler, {
        params: { worldId },
        body: { expectedRevision: 1, branchId: 'main', headFingerprint: 'abc', includePrivateMinds: true },
    });
    assert.equal(privateContext.payload.ok, true);
    const data = privateContext.payload.data;
    assert.equal(data.schema, 'innerlore.event-director-context.v1');
    assert.equal(data.snapshot.storeRevision, 1);
    assert.equal(data.branch.id, 'main');
    const ids = data.sources.map(source => source.id);
    assert.ok(ids.includes('lore:location:ben tavern'), 'lore source missing');
    assert.ok(ids.includes('goal:clear_name'), 'goal source missing');
    assert.ok(ids.includes('event:bell_jam'), 'event source missing');
    assert.ok(ids.includes('npc_motive:freesia'), 'private motive source missing');
    const eventSource = data.sources.find(source => source.id === 'event:bell_jam');
    assert.equal(eventSource.generated, true, 'director-origin events must be marked generated');
    const motive = data.sources.find(source => source.id === 'npc_motive:freesia');
    assert.equal(motive.private, true);
    assert.deepEqual(data.availableSourceIds, ids);

    // Without the private-minds flag, motives stay compartmentalized.
    const publicContext = call(handler, {
        params: { worldId },
        body: { expectedRevision: 1 },
    });
    assert.ok(publicContext.payload.data.sources.every(source => source.kind !== 'npc_motive'));

    // A stale revision is rejected instead of silently grounding on old state.
    const stale = call(handler, {
        params: { worldId },
        body: { expectedRevision: 0 },
    });
    assert.equal(stale.status, 409);

    const missing = call(router.handlers.get('POST /v1/worlds/:worldId/innerlore/event-director/context'), {
        params: { worldId: 'innerlore-nonexistent' },
        body: {},
    });
    assert.equal(missing.status, 404);
});
