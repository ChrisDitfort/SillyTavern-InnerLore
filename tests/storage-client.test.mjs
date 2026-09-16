import assert from 'node:assert/strict';
import test from 'node:test';

import {
    createInnerLoreStoragePointer,
    innerLoreWorldId,
    InnerLoreStorageClient,
    InnerLoreStorageError,
    isInnerLoreStoragePointer,
    isLegacyInnerLoreStore,
} from '../storage-client.js';
import { installMockInnerLoreStorage } from './mock-storage-server.mjs';

const storeFor = chatId => ({
    version: 4,
    expressionFoundationVersion: 2,
    chatId,
    lorebookName: 'Old book',
    entities: { 'character:ada': { id: 'character:ada', name: 'Ada', entryUid: 7, renderedHash: 'old' } },
    brains: {},
    progression: { processedFingerprints: { 1: 'abc' } },
    processedFingerprints: { 1: 'abc' },
});

test('storage pointers stay small and deterministic world IDs are valid and collision-resistant', async () => {
    const first = await innerLoreWorldId('Ada - chat');
    const again = await innerLoreWorldId('Ada - chat');
    const other = await innerLoreWorldId('Ada - another chat');
    assert.equal(first, again);
    assert.notEqual(first, other);
    assert.match(first, /^innerlore-[a-f0-9]{40}$/u);

    const pointer = createInnerLoreStoragePointer({
        worldId: first, chatId: 'Ada - chat', revision: 3, snapshotHash: 'hash', updatedAt: 'now',
    });
    assert.equal(isInnerLoreStoragePointer(pointer), true);
    assert.equal(isLegacyInnerLoreStore(pointer), false);
    assert.equal(isLegacyInnerLoreStore(storeFor('Ada - chat')), true);
    assert.ok(JSON.stringify(pointer).length < 240);
});

test('client migrates a legacy snapshot, revision-checks saves, and forks the latest server state', async t => {
    const mock = installMockInnerLoreStorage();
    t.after(() => mock.restore());
    const client = new InnerLoreStorageClient({ getHeaders: () => ({ 'X-CSRF-Token': 'test' }) });
    const chatId = 'Ada - source';
    const initial = storeFor(chatId);
    const migrated = await client.loadOrCreate({
        chatId, initialStore: initial, migrationSource: 'legacy_chat_metadata',
    });
    assert.equal(migrated.migrated, true);
    assert.equal(migrated.revision, 1);
    assert.deepEqual(migrated.store, initial);

    const changed = structuredClone(initial);
    changed.entities['character:ada'].name = 'Ada Lovelace';
    const saved = await client.save(migrated.worldId, chatId, changed, { expectedRevision: 1 });
    assert.equal(saved.revision, 2);
    await assert.rejects(
        client.save(migrated.worldId, chatId, initial, { expectedRevision: 1 }),
        error => error instanceof InnerLoreStorageError && error.status === 409,
    );

    const contextState = await client.buildContext(migrated.worldId, {
        expectedRevision: 2, branchId: 'main', headFingerprint: 'head-2',
        scene: { location: { name: 'Engine room' } }, audience: { role: 'narrator' },
    });
    assert.equal(contextState.revision, 2);
    assert.match(contextState.rendered, /innerlore_state_context/u);
    assert.match(contextState.sections.lore, /Ada Lovelace/u);
    const directorContext = await client.buildEventDirectorContext(migrated.worldId, {
        expectedRevision: 2, branchId: 'main', headFingerprint: 'head-2', includePrivateMinds: false,
    });
    assert.equal(directorContext.snapshot.storeRevision, 2);
    assert.ok(directorContext.sources.some(source => source.id === 'lore:character:ada'));
    const profiles = await client.contextProfiles(migrated.worldId);
    assert.ok(profiles.some(profile => profile.id === 'balanced'));
    const profile = await client.saveContextProfile(migrated.worldId, 'focused', {
        config: { maximumCharacters: 4_000 }, expectedRevision: 0,
    });
    assert.equal(profile.id, 'focused');

    // Deliberately keep the pointer revision stale. Branching still forks the
    // latest committed SQLite state instead of trusting chat metadata.
    const pointer = createInnerLoreStoragePointer(migrated);
    const branchChatId = 'Ada - branch';
    const branch = await client.loadOrCreate({
        chatId: branchChatId,
        pointer,
        initialStore: storeFor(branchChatId),
    });
    assert.equal(branch.forked, true);
    assert.equal(branch.store.entities['character:ada'].name, 'Ada Lovelace');
    assert.equal(branch.store.chatId, branchChatId);
    assert.equal(branch.store.lorebookName, '');
    assert.equal(branch.store.entities['character:ada'].entryUid, null);
    assert.deepEqual(branch.store.processedFingerprints, {});
});

test('client times out a stalled server request even when fetch ignores abort', async () => {
    const client = new InnerLoreStorageClient({
        fetchImpl: () => new Promise(() => {}),
        requestTimeoutMs: 20,
    });
    const startedAt = Date.now();
    await assert.rejects(
        client.health(),
        error => error instanceof InnerLoreStorageError && error.code === 'STORAGE_TIMEOUT',
    );
    assert.ok(Date.now() - startedAt < 500, 'a stalled local store should fail within its configured bound');
});

test('client preserves caller cancellation separately from a storage timeout', async () => {
    const controller = new AbortController();
    const client = new InnerLoreStorageClient({
        fetchImpl: () => new Promise(() => {}),
        requestTimeoutMs: 1_000,
    });
    const request = client.buildContext('world', {}, { signal: controller.signal });
    controller.abort();
    await assert.rejects(
        request,
        error => error instanceof InnerLoreStorageError && error.code === 'STORAGE_ABORTED',
    );
});

test('client invokes browser-style fetch with the global receiver', async () => {
    let receiver;
    const browserStyleFetch = function () {
        receiver = this;
        if (this !== globalThis) throw new TypeError('Illegal invocation');
        return Promise.resolve({
            status: 200,
            ok: true,
            json: async () => ({ ok: true, data: { status: 'ok' } }),
        });
    };
    const client = new InnerLoreStorageClient({ fetchImpl: browserStyleFetch });
    assert.deepEqual(await client.health(), { status: 'ok' });
    assert.equal(receiver, globalThis);
});
