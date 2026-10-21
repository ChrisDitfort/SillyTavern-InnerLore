import assert from 'node:assert/strict';
import test from 'node:test';

import {
    createEmptyStore,
    mergeEntityOperations,
    parseCardSeedEntities,
    snapshotMessageRange,
} from '../core.js';
import { installMockInnerLoreStorage } from './mock-storage-server.mjs';
import { createEventListeners } from './mock-event-source.mjs';

const storage = installMockInnerLoreStorage();

const waitFor = async (predicate, timeout = 6_000) => {
    const started = Date.now();
    while (!predicate()) {
        if (Date.now() - started > timeout) throw new Error('Timed out waiting for mocked InnerLore state.');
        await new Promise(resolve => setTimeout(resolve, 20));
    }
};

// What the mock SQLite backend last committed for a chat. The chat's pointer
// reads the in-memory store instead, which a rejected save leaves replaced.
const committedStore = chatId => [...storage.worlds.values()]
    .find(world => world.innerLore?.chatId === chatId)?.innerLore.store;

// Stores a world as if an earlier session had committed it, and returns the
// chat-metadata pointer to it.
function plantWorld(store) {
    const worldId = `innerlore-test-${store.chatId}`;
    const now = new Date().toISOString();
    storage.worlds.set(worldId, {
        world_id: worldId,
        name: worldId,
        metadata: {},
        contextProfiles: new Map(),
        innerLore: {
            worldId,
            chatId: store.chatId,
            storeVersion: store.version || 0,
            expressionFoundationVersion: store.expressionFoundationVersion || 0,
            revision: 1,
            snapshotHash: 'mock-1',
            createdAt: now,
            updatedAt: now,
            store: structuredClone(store),
            branch: { id: 'main' },
            scene: {},
        },
    });
    return { backend: 'airpg-storage', pointerVersion: 1, worldId, chatId: store.chatId, revision: 1, snapshotHash: 'mock-1' };
}

const events = {
    MESSAGE_RECEIVED: 'message_received',
    GENERATION_STARTED: 'generation_started',
    CHAT_COMPLETION_PROMPT_READY: 'chat_completion_prompt_ready',
    CHAT_CHANGED: 'chat_changed',
    MESSAGE_EDITED: 'message_edited',
    MESSAGE_SWIPED: 'message_swiped',
    MESSAGE_DELETED: 'message_deleted',
};

// Opens a chat over a world an earlier session committed. When the chat no
// longer matches the history the world was derived from, loading it
// quarantines the world and rebuilds it.
async function openChat(chat, store, card = null) {
    const listeners = createEventListeners();
    const requests = { count: 0 };
    const extensionSettings = {
        disabledExtensions: [],
        connectionManager: {
            selectedProfile: 'test-profile',
            profiles: [{ id: 'test-profile', name: 'Test Profile', model: 'mock/model' }],
        },
        inner_lore: {
            // These tests cover other passes; the game ledger has its own.
            gameEnabled: false,
            enabled: true,
            autoUpdate: true,
            innerSelfEnabled: true,
            autoLoreEnabled: true,
            worldProgressionEnabled: false,
            processEveryAssistantTurns: 1,
            maintenanceSchedulingVersion: 1,
            lookbackMessages: 10,
            connectionSource: 'profile',
            connectionProfileId: 'test-profile',
            requestTimeoutSeconds: 15,
            autoRebuildOnHistoryChange: true,
            autoRebuildMessageLimit: 120,
        },
    };
    const worldInfo = new Map();
    const context = {
        extensionSettings,
        chatMetadata: { inner_lore: plantWorld(store) },
        chat,
        chatId: store.chatId,
        name1: 'Jet',
        name2: 'Narrator',
        characters: card ? [card] : [],
        characterId: card ? 0 : undefined,
        getCurrentChatId: () => store.chatId,
        getCharacterCardFields: () => ({}),
        saveSettingsDebounced: () => {},
        saveMetadata: async () => {},
        saveMetadataDebounced: () => {},
        setExtensionPrompt: () => {},
        renderExtensionTemplateAsync: async () => '',
        eventSource: { on: listeners.on },
        eventTypes: events,
        SlashCommandParser: null,
        SlashCommand: null,
        ConnectionManagerRequestService: {
            getSupportedProfiles: () => extensionSettings.connectionManager.profiles,
            sendRequest: async () => {
                requests.count++;
                return { content: '{"entities":[],"minds":[]}' };
            },
        },
        loadWorldInfo: async name => worldInfo.get(name) || null,
        saveWorldInfo: async (name, data) => worldInfo.set(name, structuredClone(data)),
        updateWorldInfoList: async () => {},
    };
    globalThis.document = { activeElement: null, getElementById: () => null, querySelectorAll: () => [] };
    globalThis.$ = () => ({ append: () => {} });
    globalThis.toastr = { error: () => {}, warning: () => {}, success: () => {}, info: () => {} };
    globalThis.confirm = () => true;
    globalThis.SillyTavern = { getContext: () => context };

    await import(`../index.js?rebuild-commit=${store.chatId}-${Date.now()}`);
    await waitFor(() => listeners.has(events.CHAT_CHANGED));
    await listeners.get(events.CHAT_CHANGED)();
    return { requests, context, listeners };
}

test('rebuilding a rewritten greeting keeps the card-declared places', async () => {
    const card = {
        name: 'Narrator',
        data: { extensions: { inner_lore_seed: { entities: Array.from({ length: 10 }, (_, index) => ({
            type: 'location',
            name: `Seeded Place ${index + 1}`,
            importance: 50,
            summary: `A card-declared place, number ${index + 1}.`,
        })) } } },
    };
    const chat = [{ is_user: false, is_system: false, name: 'Narrator', mes: 'The original greeting at the gate.' }];
    const store = createEmptyStore('reseed-chat');
    mergeEntityOperations(store, parseCardSeedEntities(card), { minimumImportance: 0, maximumOperations: 10, messageIndex: -1 });
    store.lastProcessedIndex = 0;
    store.processedFingerprints = snapshotMessageRange(chat, 0, 0);
    // The greeting is rewritten after the world was derived from it.
    chat[0] = { ...chat[0], mes: 'A rewritten greeting at the same gate.' };

    const { requests } = await openChat(chat, store, card);
    await waitFor(() => requests.count > 0 && committedStore('reseed-chat')?.needsRebuild === false);

    const rebuilt = committedStore('reseed-chat');
    for (let index = 1; index <= 10; index++) {
        assert.ok(rebuilt.entities[`location:seeded place ${index}`], `Seeded Place ${index} survived the rebuild`);
    }
});

test('a rebuild that drops a discarded branch commits the smaller world', async () => {
    const chat = [
        { is_user: false, is_system: false, name: 'Narrator', mes: 'The hall is quiet.' },
        { is_user: true, is_system: false, name: 'Jet', mes: 'Jet looks around.' },
        { is_user: false, is_system: false, name: 'Narrator', mes: 'Six strangers arrive.' },
    ];
    const store = createEmptyStore('shrink-chat');
    mergeEntityOperations(store, Array.from({ length: 6 }, (_, index) => ({
        type: 'character',
        name: `Stranger ${index + 1}`,
        importance: 60,
        summary: 'A stranger who arrived at the hall.',
    })), { messageIndex: 2, minimumImportance: 0, maximumOperations: 6 });
    store.lastProcessedIndex = 2;
    store.processedFingerprints = snapshotMessageRange(chat, 0, 2);
    // A swipe replaced the reply that introduced them.
    chat[2] = { ...chat[2], mes: 'The hall stays empty.' };

    const { requests } = await openChat(chat, store);
    await waitFor(() => requests.count > 0 && committedStore('shrink-chat')?.needsRebuild === false);

    assert.deepEqual(Object.values(committedStore('shrink-chat').entities).filter(record => !record.player).map(record => record.id), [], 'the discarded branch\'s strangers are gone');
});

test('a save the shrink guard blocks restores the committed world', async () => {
    const chat = [
        { is_user: false, is_system: false, name: 'Narrator', mes: 'The hall is quiet.' },
        { is_user: true, is_system: false, name: 'Jet', mes: 'Jet looks around.' },
        { is_user: false, is_system: false, name: 'Narrator', mes: 'Six strangers arrive.' },
    ];
    const store = createEmptyStore('guard-chat');
    mergeEntityOperations(store, Array.from({ length: 6 }, (_, index) => ({
        type: 'character',
        name: `Stranger ${index + 1}`,
        importance: 60,
        summary: 'A stranger who arrived at the hall.',
    })), { messageIndex: 2, minimumImportance: 0, maximumOperations: 6 });
    store.lastProcessedIndex = 2;
    store.processedFingerprints = snapshotMessageRange(chat, 0, 2);

    const { requests, context, listeners } = await openChat(chat, store);
    await waitFor(() => Object.values(context.chatMetadata.inner_lore.entities || {}).filter(record => !record.player).length === 6);
    // A stale in-memory world loses most of its canon before the next pass saves.
    context.chatMetadata.inner_lore.entities = {};
    const landReply = async (playerTurn, reply) => {
        const before = requests.count;
        chat.push(
            { is_user: true, is_system: false, name: 'Jet', mes: playerTurn },
            { is_user: false, is_system: false, name: 'Narrator', mes: reply },
        );
        listeners.get(events.MESSAGE_RECEIVED)(chat.length - 1);
        await waitFor(() => requests.count > before);
        await new Promise(resolve => setTimeout(resolve, 300));
    };
    await landReply('Jet waits.', 'The strangers talk among themselves.');
    await waitFor(() => Object.values(context.chatMetadata.inner_lore.entities || {}).filter(record => !record.player).length === 6);
    // The next pass saves whatever is in memory now.
    await landReply('Jet listens.', 'The strangers fall silent.');

    assert.equal(Object.values(committedStore('guard-chat').entities).filter(record => !record.player).length, 6, 'the committed world kept its canon');
});
