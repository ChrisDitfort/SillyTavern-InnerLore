import assert from 'node:assert/strict';
import test from 'node:test';

import {
    createEmptyStore,
    createStoreCheckpoint,
    mergeEntityOperations,
    messageFingerprint,
    snapshotMessageRange,
} from '../core.js';
import { installMockInnerLoreStorage } from './mock-storage-server.mjs';

installMockInnerLoreStorage();

const waitFor = async (predicate, timeout = 4_000) => {
    const started = Date.now();
    while (!predicate()) {
        if (Date.now() - started > timeout) throw new Error('Timed out waiting for mocked InnerLore state.');
        await new Promise(resolve => setTimeout(resolve, 20));
    }
};

// Build a 24-message chat: index 0 assistant greeting, then alternating
// user (odd) / assistant (even). Last completed assistant index is 22.
function buildChat() {
    const chat = [{ is_user: false, is_system: false, name: 'Narrator', mes: 'Turn 0 — the hall is quiet.' }];
    for (let i = 1; i <= 23; i++) {
        const user = i % 2 === 1;
        chat.push({ is_user: user, is_system: false, name: user ? 'Jet' : 'Narrator', mes: `Turn ${i} — ${user ? 'Jet speaks' : 'the story continues'} distinctly.` });
    }
    return chat;
}

function harness(chat, store, requestCounter) {
    const prompts = [];
    const worlds = new Map();
    const extensionSettings = {
        disabledExtensions: [],
        connectionManager: {
            selectedProfile: 'test-profile',
            profiles: [{ id: 'test-profile', name: 'Test Profile', model: 'mock/model' }],
        },
        inner_lore: {
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
    const events = {
        MESSAGE_RECEIVED: 'message_received',
        GENERATION_STARTED: 'generation_started',
        CHAT_CHANGED: 'chat_changed',
        MESSAGE_EDITED: 'message_edited',
        MESSAGE_SWIPED: 'message_swiped',
        MESSAGE_DELETED: 'message_deleted',
    };
    const context = {
        extensionSettings,
        chatMetadata: { inner_lore: store },
        chat,
        chatId: store.chatId,
        name1: 'Jet',
        name2: 'Narrator',
        getCurrentChatId: () => store.chatId,
        getCharacterCardFields: () => ({}),
        saveSettingsDebounced: () => {},
        saveMetadata: async () => {},
        saveMetadataDebounced: () => {},
        setExtensionPrompt: (key, value) => prompts.push({ key, value }),
        renderExtensionTemplateAsync: async () => '',
        eventSource: { on: (event, callback) => {} },
        eventTypes: events,
        SlashCommandParser: null,
        SlashCommand: null,
        ConnectionManagerRequestService: {
            getSupportedProfiles: () => extensionSettings.connectionManager.profiles,
            sendRequest: async () => {
                requestCounter.count++;
                return { content: '{"entities":[],"minds":[]}' };
            },
        },
        loadWorldInfo: async name => worlds.get(name) || null,
        saveWorldInfo: async (name, data) => worlds.set(name, structuredClone(data)),
        updateWorldInfoList: async () => {},
    };
    globalThis.document = { activeElement: null, getElementById: () => null, querySelectorAll: () => [] };
    globalThis.$ = () => ({ append: () => {} });
    globalThis.toastr = { error: () => {}, warning: () => {}, success: () => {}, info: () => {} };
    globalThis.confirm = () => true;
    globalThis.SillyTavern = { getContext: () => context };
    return { context };
}

test('a late edit resumes the rebuild from a checkpoint instead of replaying the whole chat', async () => {
    const chat = buildChat();

    // A checkpoint captured at message 19 that carries a distinctive entity the
    // mock curator will never re-emit. If the rebuild resumes from it, the
    // entity survives; a full rebuild from an empty store would drop it.
    const cpStore = createEmptyStore('resume-chat');
    cpStore.lastProcessedIndex = 19;
    cpStore.processedFingerprints = snapshotMessageRange(chat, 0, 19);
    mergeEntityOperations(cpStore, [{ type: 'location', name: 'Old Landmark', importance: 80, facts: ['Established early in the story.'] }], { messageIndex: 5, minimumImportance: 0 });
    const checkpoint = createStoreCheckpoint(cpStore);
    assert.ok(checkpoint.entities['location:old landmark'], 'checkpoint carries the landmark');

    const store = createEmptyStore('resume-chat');
    store.lastProcessedIndex = 22;
    store.processedFingerprints = snapshotMessageRange(chat, 0, 22);
    store.checkpoints = [checkpoint];
    // Pre-rebuild (stale) entities also hold the landmark.
    store.entities = structuredClone(checkpoint.entities);

    // Edit a LATE message so divergence (22) is after the checkpoint (19).
    chat[22] = { is_user: false, is_system: false, name: 'Narrator', mes: 'Turn 22 — a completely rewritten late beat.' };
    assert.notEqual(messageFingerprint(chat[22]), store.processedFingerprints[22], 'the late edit changes the fingerprint');

    const counter = { count: 0 };
    harness(chat, store, counter);

    // The load-time fingerprint audit detects the changed message and schedules
    // an automatic rebuild, exactly as an in-session edit would.
    await import(`../index.js?resume-late=${Date.now()}`);
    await waitFor(() => counter.count > 0 && SillyTavern.getContext().chatMetadata.inner_lore.needsRebuild === false, 8_000);

    const rebuilt = SillyTavern.getContext().chatMetadata.inner_lore;
    assert.ok(rebuilt.entities['location:old landmark'], 'the checkpoint state was resumed (landmark preserved)');
    assert.equal(rebuilt.lastProcessedIndex, 22, 'rebuild reached the completed head');
    // Only the tail after index 19 is re-derived: a single ~3-message batch, not
    // the three batches a full 0..22 replay would need.
    assert.ok(counter.count <= 1, `resume should issue at most one curator batch, issued ${counter.count}`);
});

test('an early edit with no covering checkpoint falls back to a full rebuild', async () => {
    const chat = buildChat();

    const cpStore = createEmptyStore('fallback-chat');
    cpStore.lastProcessedIndex = 19;
    cpStore.processedFingerprints = snapshotMessageRange(chat, 0, 19);
    mergeEntityOperations(cpStore, [{ type: 'location', name: 'Old Landmark', importance: 80, facts: ['Established early.'] }], { messageIndex: 5, minimumImportance: 0 });
    const checkpoint = createStoreCheckpoint(cpStore);

    const store = createEmptyStore('fallback-chat');
    store.lastProcessedIndex = 22;
    store.processedFingerprints = snapshotMessageRange(chat, 0, 22);
    store.checkpoints = [checkpoint];
    store.entities = structuredClone(checkpoint.entities);

    // Edit an EARLY message (index 3), before the only checkpoint (19).
    chat[3] = { is_user: true, is_system: false, name: 'Jet', mes: 'Turn 3 — an early rewrite invalidates the checkpoint.' };

    const counter = { count: 0 };
    harness(chat, store, counter);
    await import(`../index.js?resume-early=${Date.now()}`);
    await waitFor(() => counter.count > 0 && SillyTavern.getContext().chatMetadata.inner_lore.needsRebuild === false, 8_000);

    const rebuilt = SillyTavern.getContext().chatMetadata.inner_lore;
    // Full replay from an empty store: the mock curator never re-emits the
    // landmark, so it must be gone.
    assert.equal(rebuilt.entities['location:old landmark'], undefined, 'no checkpoint covered the early edit, so a full rebuild dropped stale state');
    assert.ok(counter.count >= 2, `a full 0..22 rebuild should issue multiple curator batches, issued ${counter.count}`);
});
