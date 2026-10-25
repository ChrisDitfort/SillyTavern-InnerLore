import assert from 'node:assert/strict';
import test from 'node:test';

// An in-memory database for the plugin under test; set before init() reads it.
process.env.INNERLORE_STORAGE_DB = ':memory:';
const plugin = await import('../server/innerlore-storage/index.js');

/** A router that records handlers by method and path, like express would. */
function fakeRouter() {
    const routes = new Map();
    const register = method => (path, handler) => routes.set(`${method} ${path}`, handler);
    return {
        routes,
        get: register('GET'), post: register('POST'), put: register('PUT'), patch: register('PATCH'), delete: register('DELETE'),
        async call(method, path, { params = {}, body = {}, query = {} } = {}) {
            const handler = routes.get(`${method} ${path}`);
            if (!handler) throw new Error(`no route ${method} ${path}`);
            const response = {
                code: 200, payload: null,
                status(code) { this.code = code; return this; },
                json(payload) { this.payload = payload; return this; },
            };
            await handler({ params, body, query, user: { directories: { root: process.cwd() } } }, response);
            return response;
        },
    };
}

test('the store PATCH route applies path operations onto the current snapshot and reports when it had moved', async () => {
    const router = fakeRouter();
    await plugin.init(router);
    const store = '/v1/worlds/:worldId/innerlore/store';
    const params = { worldId: 'w1' };
    assert.equal((await router.call('POST', '/v1/worlds/', { body: { id: 'w1', name: 'W', metadata: {} } })).code, 200);
    const seeded = await router.call('PUT', store, { params, body: { chatId: 'c1', store: { version: 1, entities: { a: { id: 'a', name: 'A' } }, game: { journal: [{ id: 'j1' }] } }, expectedRevision: 0 } });
    assert.equal(seeded.payload.data.revision, 1);

    // Writer one (base 1): renames A.
    const first = await router.call('PATCH', store, { params, body: { chatId: 'c1', baseRevision: 1, patch: { set: { 'entities/a': { id: 'a', name: 'A prime' } } } } });
    assert.equal(first.payload.data.revision, 2);
    assert.equal(first.payload.data.moved, false);
    assert.equal(first.payload.data.snapshot, undefined);

    // Writer two still thinks the store is at revision 1: its append lands on revision 2's state, and it gets the merged snapshot back.
    const second = await router.call('PATCH', store, { params, body: { chatId: 'c1', baseRevision: 1, patch: { append: { 'game/journal': [{ id: 'j2' }] }, set: { 'entities/b': { id: 'b', name: 'B' } } } } });
    assert.equal(second.payload.data.revision, 3);
    assert.equal(second.payload.data.moved, true);
    assert.equal(second.payload.data.snapshot.entities.a.name, 'A prime', 'the other writer\'s change is in the returned snapshot');
    assert.deepEqual(second.payload.data.snapshot.game.journal.map(entry => entry.id), ['j1', 'j2']);

    const loaded = await router.call('GET', store, { params });
    assert.equal(loaded.payload.data.revision, 3);
    assert.deepEqual(Object.keys(loaded.payload.data.store.entities).sort(), ['a', 'b']);

    // An empty patch writes nothing.
    const empty = await router.call('PATCH', store, { params, body: { chatId: 'c1', baseRevision: 3, patch: {} } });
    assert.equal(empty.payload.data.revision, 3);
    assert.equal(empty.payload.data.unchanged, true);

    // Whole-snapshot PUT still refuses a moved store.
    const stale = await router.call('PUT', store, { params, body: { chatId: 'c1', store: { version: 1 }, expectedRevision: 1 } });
    assert.equal(stale.code, 409);
    assert.equal(stale.payload.error.code, 'REVISION_CONFLICT');
    plugin.exit?.();
});

test('deleting a world removes its store, history and jobs, and the deleted text does not linger in the database', async () => {
    const router = fakeRouter();
    await plugin.init(router);
    const params = { worldId: 'w-del' };
    await router.call('POST', '/v1/worlds/', { body: { id: 'w-del', name: 'Doomed', metadata: {} } });
    await router.call('PUT', '/v1/worlds/:worldId/innerlore/store', { params, body: { chatId: 'c-del', store: { version: 1, entities: { a: { id: 'a', name: 'ZEBRA-SECRET' } } }, expectedRevision: 0 } });
    // A job of the world, finished and remembered with what it was given and what it said.
    plugin.services.runner.register('test-echo', async job => ({ said: `echo ${job.input.text}` }));
    const submitted = await router.call('POST', '/v1/worlds/:worldId/jobs', { params, body: { kind: 'test-echo', chatId: 'c-del', input: { text: 'ZEBRA-SECRET' } } });
    assert.equal(submitted.code, 200);
    for (let wait = 0; wait < 50 && (await router.call('GET', '/v1/worlds/:worldId/jobs', { params })).payload.data.jobs.length; wait++) await new Promise(resolve => setTimeout(resolve, 10));
    const before = await router.call('GET', '/v1/worlds/:worldId/jobs', { params, query: { active: '0' } });
    assert.equal(before.payload.data.jobs.length, 1);
    assert.equal(before.payload.data.jobs[0].status, 'done');

    const deleted = await router.call('DELETE', '/v1/worlds/:worldId/innerlore/store', { params, query: { chatId: 'c-del' } });
    assert.equal(deleted.payload.data.deleted, true);
    assert.equal((await router.call('GET', '/v1/worlds/:worldId/innerlore/store', { params })).code, 404);
    const after = await router.call('GET', '/v1/worlds/:worldId/jobs', { params, query: { active: '0' } });
    assert.equal(after.payload.data.jobs.length, 0, 'the jobs went with the world');
    assert.equal((await router.call('GET', '/v1/jobs/:jobId', { params: { jobId: submitted.payload.data.jobId } })).code, 404);
});
