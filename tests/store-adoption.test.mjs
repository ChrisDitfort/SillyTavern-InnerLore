import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import { createEmptyStore } from '../core.js';
import { installMockInnerLoreStorage } from './mock-storage-server.mjs';
import { createEventListeners } from './mock-event-source.mjs';

const storage = installMockInnerLoreStorage();

const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
const waitFor = async (predicate, timeout = 6_000) => {
    const started = Date.now();
    while (!predicate()) {
        if (Date.now() - started > timeout) throw new Error('Timed out waiting for mocked InnerLore state.');
        await sleep(20);
    }
};
const worldIdOf = chatId => `innerlore-${createHash('sha256').update(chatId).digest('hex').slice(0, 40)}`;

const events = {
    MESSAGE_RECEIVED: 'message_received',
    GENERATION_STARTED: 'generation_started',
    GENERATION_ENDED: 'generation_ended',
    CHAT_COMPLETION_PROMPT_READY: 'chat_completion_prompt_ready',
    CHAT_CHANGED: 'chat_changed',
    MESSAGE_EDITED: 'message_edited',
    MESSAGE_SWIPED: 'message_swiped',
    MESSAGE_DELETED: 'message_deleted',
};

// The extension against a mocked SillyTavern whose background requests stay
// open until the test answers them (the provider-concurrency loader, trimmed).
async function loadInnerLore(chatId) {
    const listeners = createEventListeners();
    const chat = [{ is_user: false, is_system: false, name: 'Narrator', mes: 'The gate stands shut.' }];
    const store = createEmptyStore(chatId);
    store.lastProcessedIndex = 0;
    const chatMetadata = { inner_lore: store };
    const extensionSettings = {
        disabledExtensions: [],
        connectionManager: {
            selectedProfile: 'test-profile',
            profiles: [{ id: 'test-profile', name: 'Test Profile', model: 'mock/model' }],
        },
        inner_lore: {
            gameEnabled: false, enabled: true, autoUpdate: true, innerSelfEnabled: true, autoLoreEnabled: false,
            worldProgressionEnabled: false, processEveryAssistantTurns: 1, maintenanceSchedulingVersion: 1,
            lookbackMessages: 10, connectionSource: 'profile', connectionProfileId: 'test-profile',
            requestTimeoutSeconds: 15, autoRebuildOnHistoryChange: true, autoRebuildMessageLimit: 120,
            providerConcurrency: 1, storageBackend: 'sqlite',
        },
    };
    const requests = [];
    const context = {
        extensionSettings, chatMetadata, chat, chatId, name1: 'Jet', name2: 'Narrator',
        getCurrentChatId: () => chatId,
        getCharacterCardFields: () => ({}),
        saveSettingsDebounced: () => {},
        saveMetadata: async () => {},
        saveMetadataDebounced: () => {},
        setExtensionPrompt: () => {},
        renderExtensionTemplateAsync: async () => '',
        eventSource: { on: listeners.on },
        eventTypes: events,
        SlashCommandParser: null, SlashCommand: null,
        ConnectionManagerRequestService: {
            getSupportedProfiles: () => extensionSettings.connectionManager.profiles,
            sendRequest: (_profileId, messages) => new Promise(resolve => {
                requests.push({ text: messages.map(message => message.content).join('\n'), answer: () => resolve({ content: '{"entities":[],"minds":[]}' }) });
            }),
        },
    };
    globalThis.document = { activeElement: null, getElementById: () => null, querySelectorAll: () => [] };
    globalThis.$ = () => ({ append: () => {} });
    globalThis.toastr = { error: () => {}, warning: () => {}, success: () => {}, info: () => {} };
    globalThis.confirm = () => true;
    globalThis.SillyTavern = { getContext: () => context };
    await import(`../index.js?store-adoption=${chatId}-${Date.now()}`);
    await waitFor(() => listeners.has(events.CHAT_COMPLETION_PROMPT_READY));
    return { listeners, chat, chatMetadata, requests, context };
}

test('a pass commit saves as a patch, and a revision another writer added meanwhile is adopted into the live store', async () => {
    const chatId = 'adoption-chat';
    const world = await loadInnerLore(chatId);
    const worldId = worldIdOf(chatId);
    await waitFor(() => storage.worlds.get(worldId)?.innerLore?.store);
    const record = storage.worlds.get(worldId).innerLore;
    const revisionBefore = record.revision;

    // A reply lands and the curator pass goes out.
    world.chat.push(
        { is_user: true, is_system: false, name: 'Jet', mes: 'I knock.' },
        { is_user: false, is_system: false, name: 'Narrator', mes: 'The first door swings inward.' },
    );
    world.listeners.get(events.MESSAGE_RECEIVED)(world.chat.length - 1);
    await waitFor(() => world.requests.length === 1);

    // Another writer (a second tab, a server job) commits while the pass waits on the model.
    record.store.entities['character:ghost'] = { id: 'character:ghost', type: 'character', name: 'Ghost', enabled: true, importance: 40 };
    record.store.narrativeLog = [...(record.store.narrativeLog || []), { text: 'added elsewhere' }];
    record.revision += 1;
    const movedRevision = record.revision;

    world.requests[0].answer();
    await waitFor(() => storage.worlds.get(worldId).innerLore.revision > movedRevision);
    const after = storage.worlds.get(worldId).innerLore;
    assert.ok(after.revision > revisionBefore + 1, 'the pass commit became a new revision on top of the foreign one');
    assert.equal(after.store.lastProcessedIndex, world.chat.length - 1, 'the pass watermark landed on the server');
    assert.equal(after.store.entities['character:ghost']?.name, 'Ghost', 'the foreign record survived the pass commit (a patch, not a whole snapshot)');

    // The browser adopted the moved snapshot: its live store now holds the foreign record and keeps its own watermark.
    await waitFor(() => world.chatMetadata.inner_lore.entities?.['character:ghost']);
    assert.equal(world.chatMetadata.inner_lore.lastProcessedIndex, world.chat.length - 1);
    assert.equal(world.chatMetadata.inner_lore.revision, after.revision, 'the pointer follows the adopted revision');
});

test('a save to a store deleted meanwhile is dropped: nothing is recreated, and later saves still go out as patches', async () => {
    const chatId = 'deleted-meanwhile-chat';
    const world = await loadInnerLore(chatId);
    const worldId = worldIdOf(chatId);
    await waitFor(() => storage.worlds.get(worldId)?.innerLore?.store);
    // The storage client keeps its own fetch; the mock server's request log says what was sent.
    let mark = storage.requests.length;
    const sent = () => storage.requests.slice(mark).filter(request => request.worldId === worldId && request.suffix === '/innerlore/store').map(request => request.method);

    // A pass goes out; the world is deleted on the server while it waits on the model.
    world.chat.push(
        { is_user: true, is_system: false, name: 'Jet', mes: 'I knock.' },
        { is_user: false, is_system: false, name: 'Narrator', mes: 'Nobody answers.' },
    );
    world.listeners.get(events.MESSAGE_RECEIVED)(world.chat.length - 1);
    await waitFor(() => world.requests.length === 1);
    const kept = structuredClone(storage.worlds.get(worldId).innerLore);
    storage.worlds.get(worldId).innerLore = null;
    mark = storage.requests.length;
    world.requests[0].answer();
    await waitFor(() => sent().includes('PATCH'));
    await sleep(300);
    assert.equal(storage.worlds.get(worldId).innerLore, null, 'the deleted store was not recreated');
    assert.ok(!sent().includes('PUT'), `no whole snapshot was sent (${sent().join(', ')})`);

    // The store is there again (another world in the same page): its saves are still patches.
    storage.worlds.get(worldId).innerLore = kept;
    mark = storage.requests.length;
    assert.ok(globalThis.InnerLore.test.recordOps([{ type: 'contact.add', name: 'Old Fen', number: '0771 000 000', note: 'test' }]));
    await waitFor(() => sent().includes('PATCH'));
    await sleep(200);
    assert.ok(!sent().includes('PUT'), `still patches (${sent().join(', ')})`);
});
