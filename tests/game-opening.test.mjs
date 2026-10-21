import assert from 'node:assert/strict';
import test from 'node:test';

import { createEmptyStore, mergeEntityOperations } from '../core.js?v=48';
import { installMockInnerLoreStorage } from './mock-storage-server.mjs';

const storage = installMockInnerLoreStorage();

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

const waitFor = async (predicate, timeout = 8_000, label = 'mocked game state') => {
    const started = Date.now();
    while (!predicate()) {
        if (Date.now() - started > timeout) throw new Error(`Timed out waiting for ${label}.`);
        await new Promise(resolve => setTimeout(resolve, 20));
    }
};


test('on a fresh world the opening planner waits for the curator and prepares its place', async () => {
    const listeners = new Map();
    const chat = [{ is_user: false, is_system: false, name: 'Narrator', mes: 'The coach leaves you on the doorstep of the Salt Lantern. Below, Rope Street runs downhill toward the harbour.' }];
    const store = createEmptyStore('game-opening');
    const chatMetadata = { inner_lore: plantWorld(store) };
    const extensionSettings = {
        disabledExtensions: [],
        connectionManager: { selectedProfile: 'mock-profile', profiles: [{ id: 'mock-profile', name: 'Mock Profile', model: 'mock/model' }] },
        inner_lore: {
            enabled: true, autoUpdate: true, innerSelfEnabled: true, autoLoreEnabled: true, worldProgressionEnabled: false,
            processEveryAssistantTurns: 1, maintenanceSchedulingVersion: 1, lookbackMessages: 10,
            connectionSource: 'profile', connectionProfileId: 'mock-profile', requestTimeoutSeconds: 15,
            autoRebuildOnHistoryChange: true, autoRebuildMessageLimit: 120, parallelBackgroundPasses: true, scenePlannerPrefetch: false,
        },
    };
    const pending = [];
    const kinds = [];
    const kindOf = text => (/Game Ledger/u.test(text) ? 'ledger' : /Scene Planner/u.test(text) ? 'planner' : 'curator');
    const events = { MESSAGE_RECEIVED: 'message_received', GENERATION_STARTED: 'generation_started', CHAT_CHANGED: 'chat_changed', MESSAGE_EDITED: 'message_edited', MESSAGE_SWIPED: 'message_swiped', MESSAGE_DELETED: 'message_deleted' };
    const worlds = new Map();
    const context = {
        extensionSettings, chatMetadata, chat, chatId: 'game-opening', name1: 'Jet', name2: 'Narrator', maxContext: 32_000,
        getCurrentChatId: () => 'game-opening', getCharacterCardFields: () => ({ description: 'A harbour town in the rain.' }),
        saveSettingsDebounced: () => {}, saveMetadata: async () => {}, saveMetadataDebounced: () => {},
        setExtensionPrompt: () => {}, renderExtensionTemplateAsync: async () => '',
        eventSource: { on: (event, callback) => listeners.set(event, [...(listeners.get(event) || []), callback]) },
        eventTypes: events, SlashCommandParser: null, SlashCommand: null,
        ConnectionManagerRequestService: {
            getSupportedProfiles: () => extensionSettings.connectionManager.profiles,
            sendRequest: (_profileId, messages) => new Promise(resolve => {
                const text = messages.map(message => message.content).join('\n');
                kinds.push(kindOf(text));
                pending.push({ kind: kindOf(text), prompt: text, answer: content => resolve({ content }) });
            }),
        },
        loadWorldInfo: async name => worlds.get(name) || null,
        saveWorldInfo: async (name, data) => worlds.set(name, structuredClone(data)),
        updateWorldInfoList: async () => {},
    };
    globalThis.document = { activeElement: null, getElementById: () => null, querySelectorAll: () => [] };
    globalThis.$ = () => ({ append: () => {} });
    globalThis.toastr = { error: () => {}, warning: () => {}, success: () => {} };
    globalThis.confirm = () => true;
    globalThis.SillyTavern = { getContext: () => context };
    await import(`../index.js?game-opening=${Date.now()}`);

    await waitFor(() => pending.length === 2, 8_000, 'the opening curator and ledger').catch(error => {
        throw new Error(`${error.message} Seen: ${kinds.join(', ')}`);
    });
    assert.deepEqual(pending.map(request => request.kind).sort(), ['curator', 'ledger'], 'no planner before the world has places');
    for (const request of pending.splice(0)) {
        request.answer(request.kind === 'ledger' ? 'INNERLORE GAME 1\nDONE' : JSON.stringify({
            entities: [
                { type: 'location', name: 'Salt Lantern', importance: 80, summary: 'A harbour inn on Rope Street.' },
                { type: 'character', name: 'Jet', importance: 70, summary: 'A courier.', current_location: 'Salt Lantern' },
            ],
            minds: [],
        }));
    }
    await waitFor(() => pending.length === 1, 8_000, 'the opening planner').catch(error => {
        throw new Error(`${error.message} Seen: ${kinds.join(', ')}`);
    });
    assert.equal(pending[0].kind, 'planner');
    assert.match(pending[0].prompt, /"name":"Salt Lantern","why":"the player is here"/u, 'it prepares where the curator put the player');
    assert.match(pending[0].prompt, /STARTING_KIT_NEEDED is true/u);
    pending.splice(0)[0].answer('INNERLORE PLANNER 1\nSTAGE Salt Lantern\nsummary = A wet night.\nEND\nDONE');
    await waitFor(() => chatMetadata.inner_lore.game?.stages?.salt_lantern, 8_000, 'the opening stage');
});
