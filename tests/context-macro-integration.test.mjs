import assert from 'node:assert/strict';
import test from 'node:test';

import { createEmptyStore, normalizeBrainRecord, snapshotMessageRange } from '../core.js';
import { installMockInnerLoreStorage } from './mock-storage-server.mjs';

const waitFor = async (predicate, timeout = 4_000) => {
    const started = Date.now();
    while (!predicate()) {
        if (Date.now() - started > timeout) throw new Error('Timed out waiting for prepared InnerLore context.');
        await new Promise(resolve => setTimeout(resolve, 20));
    }
};

test('SillyTavern macros receive the prepared branch state without duplicate automatic injection', async t => {
    const mock = installMockInnerLoreStorage();
    t.after(() => mock.restore());
    const listeners = new Map();
    const prompts = new Map();
    const macros = new Map();
    const chat = [
        { is_user: false, is_system: false, name: 'Narrator', mes: 'Ada waits in the engine room.' },
        { is_user: true, is_system: false, name: 'Player', mes: 'Ada, inspect the engine.' },
    ];
    const store = createEmptyStore('macro-chat');
    store.entities['character:ada'] = {
        id: 'character:ada', type: 'character', name: 'Ada', aliases: [], keys: ['Ada'],
        importance: 90, summary: 'A meticulous engineer.', currentState: 'In the engine room.',
        facts: [], relationships: [], history: [], unresolved: [], enabled: true, status: 'active',
        firstSeenMessage: 0, lastSeenMessage: 1, revision: 1,
    };
    store.brains.ada = normalizeBrainRecord({
        id: 'ada', name: 'Ada', active: true, enabled: true,
        currentMind: { perception: 'The flywheel is vibrating.', intention: 'Shut down the engine safely.', sourceMessage: 1 },
    });
    store.lastProcessedIndex = 1;
    store.processedFingerprints = snapshotMessageRange(chat, 0, 1);

    const extensionSettings = {
        disabledExtensions: [],
        connectionManager: { selectedProfile: '', profiles: [] },
        inner_lore: {
            enabled: true, autoUpdate: false, innerSelfEnabled: true, autoLoreEnabled: true,
            worldProgressionEnabled: false, contextDeliveryMode: 'macro', contextProfileId: 'balanced',
            serverContextTimeoutMs: 1_200, autoRebuildOnHistoryChange: false,
        },
    };
    const events = {
        MESSAGE_RECEIVED: 'message_received', MESSAGE_SENT: 'message_sent', GENERATION_STARTED: 'generation_started',
        CHAT_CHANGED: 'chat_changed', MESSAGE_EDITED: 'message_edited', MESSAGE_SWIPED: 'message_swiped',
        MESSAGE_DELETED: 'message_deleted',
    };
    const context = {
        extensionSettings, chatMetadata: { inner_lore: store }, chat, chatId: 'macro-chat', name1: 'Player', name2: 'Narrator',
        getCurrentChatId: () => 'macro-chat', getCharacterCardFields: () => ({}), getWorldInfoNames: () => [],
        saveSettingsDebounced: () => {}, saveMetadata: async () => {}, saveMetadataDebounced: () => {},
        setExtensionPrompt: (key, prompt) => prompts.set(key, prompt),
        registerMacro: (name, handler) => macros.set(name, handler),
        renderExtensionTemplateAsync: async () => '',
        eventSource: { on: (event, callback) => listeners.set(event, callback) }, eventTypes: events,
        SlashCommandParser: null, SlashCommand: null, ConnectionManagerRequestService: null,
    };
    globalThis.document = { activeElement: null, getElementById: () => null, querySelectorAll: () => [] };
    globalThis.$ = () => ({ append: () => {} });
    globalThis.toastr = { error: () => {}, warning: () => {}, success: () => {}, info: () => {} };
    globalThis.confirm = () => true;
    globalThis.SillyTavern = { getContext: () => context };

    await import(`../index.js?macro-integration=${Date.now()}`);
    await waitFor(() => macros.get('innerlore_state_context')?.().includes('innerlore_state_context'));

    assert.equal(prompts.get('inner_lore_context') || '', '');
    assert.match(macros.get('innerlore_state_context')(), /store_revision="1"/u);
    assert.match(macros.get('innerlore_npc_context')(), /flywheel is vibrating/u);
    assert.match(macros.get('innerlore_lore_context')(), /meticulous engineer/u);
    const firstJson = JSON.parse(macros.get('innerlore_state_json')());
    assert.equal(firstJson.snapshot.branchId, 'main');

    chat.push({ is_user: true, is_system: false, name: 'Player', mes: 'Now check the governor.' });
    await listeners.get(events.MESSAGE_SENT)();
    const nextJson = JSON.parse(macros.get('innerlore_state_json')());
    assert.notEqual(nextJson.snapshot.requestedHeadFingerprint, firstJson.snapshot.requestedHeadFingerprint);

    extensionSettings.inner_lore.contextDeliveryMode = 'automatic';
    await listeners.get(events.GENERATION_STARTED)('normal', {}, false);
    assert.equal(macros.get('innerlore_state_context')(), '');
    assert.match(prompts.get('inner_lore_context'), /innerlore_state_context|inner_lore_/u);
});
