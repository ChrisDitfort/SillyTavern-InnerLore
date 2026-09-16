import assert from 'node:assert/strict';
import test from 'node:test';

import { createEmptyStore, mergeEntityOperations } from '../core.js';
import { installMockInnerLoreStorage } from './mock-storage-server.mjs';

const waitFor = async (predicate, timeout = 4_000) => {
    const started = Date.now();
    while (!predicate()) {
        if (Date.now() - started > timeout) throw new Error('Timed out waiting for server persistence integration.');
        await new Promise(resolve => setTimeout(resolve, 20));
    }
};

test('legacy chat JSON migrates once, then only a pointer remains while SQLite-style saves continue', async t => {
    const mock = installMockInnerLoreStorage();
    t.after(() => mock.restore());
    const listeners = new Map();
    const savedMetadata = [];
    const chatId = 'server-persistence-chat';
    const chat = [{ is_user: false, is_system: false, name: 'Narrator', mes: 'Ada waits beside the engine.' }];
    const store = createEmptyStore(chatId);
    mergeEntityOperations(store, [{ type: 'character', name: 'Ada', importance: 90, facts: ['Ada maintains the engine.'] }], {
        messageIndex: 0,
        minimumImportance: 0,
    });
    store.lastProcessedIndex = 0;
    const chatMetadata = { inner_lore: store };
    const extensionSettings = {
        disabledExtensions: [],
        connectionManager: { profiles: [], selectedProfile: '' },
        inner_lore: {
            enabled: true,
            autoUpdate: false,
            innerSelfEnabled: true,
            autoLoreEnabled: false,
            worldProgressionEnabled: false,
            autoRebuildOnHistoryChange: false,
        },
    };
    const events = {
        MESSAGE_RECEIVED: 'message_received', GENERATION_STARTED: 'generation_started',
        CHAT_CHANGED: 'chat_changed', CHAT_DELETED: 'chat_deleted', GROUP_CHAT_DELETED: 'group_chat_deleted',
        CHAT_RENAMED: 'chat_renamed', MESSAGE_EDITED: 'message_edited', MESSAGE_SWIPED: 'message_swiped',
        MESSAGE_DELETED: 'message_deleted',
    };
    const context = {
        extensionSettings, chatMetadata, chat, chatId, name1: 'Player', name2: 'Narrator',
        getCurrentChatId: () => chatId,
        getCharacterCardFields: () => ({}),
        getRequestHeaders: () => ({ 'Content-Type': 'application/json', 'X-CSRF-Token': 'test' }),
        saveSettingsDebounced: () => {},
        saveMetadata: async () => savedMetadata.push(JSON.stringify(chatMetadata)),
        saveMetadataDebounced: () => { throw new Error('chat JSON must not be the state write path'); },
        setExtensionPrompt: () => {},
        renderExtensionTemplateAsync: async () => '',
        eventSource: { on: (event, callback) => listeners.set(event, callback) },
        eventTypes: events,
        SlashCommandParser: null,
        SlashCommand: null,
        ConnectionManagerRequestService: null,
        getWorldInfoNames: () => [],
        loadWorldInfo: async () => null,
    };
    globalThis.document = { activeElement: null, getElementById: () => null, querySelectorAll: () => [] };
    globalThis.$ = () => ({ append: () => {} });
    globalThis.toastr = { error: () => {}, warning: () => {}, success: () => {} };
    globalThis.confirm = () => true;
    globalThis.SillyTavern = { getContext: () => context };

    await import(`../index.js?server-persistence=${Date.now()}`);
    await waitFor(() => chatMetadata.inner_lore?.backend === 'airpg-storage' && listeners.has(events.MESSAGE_EDITED));

    assert.ok(chatMetadata.inner_lore.entities['character:ada'], 'the runtime facade should preserve existing extension consumers');
    const persistedPointer = JSON.parse(JSON.stringify(chatMetadata.inner_lore));
    assert.equal(persistedPointer.backend, 'airpg-storage');
    assert.equal(Object.hasOwn(persistedPointer, 'entities'), false);
    assert.equal(Object.hasOwn(persistedPointer, 'brains'), false);
    assert.ok(savedMetadata.every(value => !value.includes('Ada maintains the engine')));
    const world = mock.worlds.get(persistedPointer.worldId);
    assert.equal(world.innerLore.store.entities['character:ada'].facts[0], 'Ada maintains the engine.');

    listeners.get(events.MESSAGE_EDITED)();
    await waitFor(() => world.innerLore.store.needsRebuild === true);
    assert.equal(chatMetadata.inner_lore.needsRebuild, true);

    await listeners.get(events.CHAT_DELETED)(chatId);
    assert.equal(mock.worlds.has(persistedPointer.worldId), false);
    assert.equal(mock.deletedWorldIds.has(persistedPointer.worldId), true);
});
