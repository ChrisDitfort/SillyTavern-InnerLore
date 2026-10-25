import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import { createEmptyStore } from '../core.js';
import { installMockInnerLoreStorage } from './mock-storage-server.mjs';
import { createEventListeners } from './mock-event-source.mjs';

const storage = installMockInnerLoreStorage();

const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
const waitFor = async (predicate, timeout = 8_000) => {
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

async function loadInnerLore(chatId, slots) {
    const listeners = createEventListeners();
    const chat = [{ is_user: false, is_system: false, name: 'Narrator', mes: 'The gate stands shut.' }];
    const store = createEmptyStore(chatId);
    store.lastProcessedIndex = 0;
    const chatMetadata = { inner_lore: store };
    const extensionSettings = {
        disabledExtensions: [],
        connectionManager: { selectedProfile: 'test-profile', profiles: [{ id: 'test-profile', name: 'Test Profile', model: 'mock/model' }] },
        inner_lore: {
            gameEnabled: false, enabled: true, autoUpdate: false, innerSelfEnabled: true, autoLoreEnabled: false, worldProgressionEnabled: false,
            processEveryAssistantTurns: 1, maintenanceSchedulingVersion: 1, lookbackMessages: 10, connectionSource: 'profile',
            connectionProfileId: 'test-profile', requestTimeoutSeconds: 15, autoRebuildOnHistoryChange: true, autoRebuildMessageLimit: 120,
            providerConcurrency: slots, storageBackend: 'sqlite', serverJobs: true,
        },
    };
    const context = {
        extensionSettings, chatMetadata, chat, chatId, name1: 'Jet', name2: 'Narrator',
        getCurrentChatId: () => chatId, getCharacterCardFields: () => ({}), saveSettingsDebounced: () => {},
        saveMetadata: async () => {}, saveMetadataDebounced: () => {}, setExtensionPrompt: () => {}, renderExtensionTemplateAsync: async () => '',
        eventSource: { on: listeners.on }, eventTypes: events, SlashCommandParser: null, SlashCommand: null,
        ConnectionManagerRequestService: { getSupportedProfiles: () => extensionSettings.connectionManager.profiles, sendRequest: () => new Promise(() => {}) },
    };
    globalThis.document = { activeElement: null, getElementById: () => null, querySelectorAll: () => [] };
    globalThis.$ = () => ({ append: () => {} });
    globalThis.toastr = { error: () => {}, warning: () => {}, success: () => {}, info: () => {} };
    globalThis.confirm = () => true;
    globalThis.SillyTavern = { getContext: () => context };
    await import(`../index.js?story-gate-server=${chatId}-${Date.now()}`);
    await waitFor(() => listeners.has(events.CHAT_COMPLETION_PROMPT_READY));
    await waitFor(() => storage.worlds.get(worldIdOf(chatId))?.innerLore?.store);
    return { listeners, chat, chatMetadata, context };
}

async function startStory(world, playerTurn) {
    world.chat.push({ is_user: true, is_system: false, name: 'Jet', mes: playerTurn });
    world.listeners.get(events.GENERATION_STARTED)('normal', {}, false);
    const departed = world.listeners.get(events.CHAT_COMPLETION_PROMPT_READY)({ chat: [{ role: 'system', content: 'Narrate.' }, { role: 'user', content: playerTurn }] });
    const leftAtOnce = await Promise.race([departed.then(() => true), sleep(1_500).then(() => false)]);
    return { departed, leftAtOnce };
}

test('with one slot the story waits for a pass running on the server, then leaves and claims its slot there', async () => {
    const chatId = 'server-gate-chat';
    const world = await loadInnerLore(chatId, 1);
    const worldId = worldIdOf(chatId);
    // The server reports a pass in flight for this world.
    storage.jobs.set('job-pass', { id: 'job-pass', worldId, chatId, kind: 'pass', key: '', status: 'running', detail: '', error: '', input: {}, createdAt: Date.now(), startedAt: Date.now(), finishedAt: null });

    const story = await startStory(world, 'I step through.');
    assert.equal(story.leftAtOnce, false, 'the story waits behind the server pass');
    storage.jobs.get('job-pass').status = 'done';
    await story.departed;
    assert.ok(storage.claims.get(worldId), 'the story claimed its slot on the server once it left');
    assert.equal(storage.claims.get(worldId).provider, '', 'no limited provider in this mock');
    world.listeners.get(events.GENERATION_ENDED)();
    await waitFor(() => !storage.claims.get(worldId));
});

test('with two slots the story leaves at once beside a server pass', async () => {
    const chatId = 'server-gate-two-slots';
    const world = await loadInnerLore(chatId, 2);
    const worldId = worldIdOf(chatId);
    storage.jobs.set('job-pass-2', { id: 'job-pass-2', worldId, chatId, kind: 'pass', key: '', status: 'running', detail: '', error: '', input: {}, createdAt: Date.now(), startedAt: Date.now(), finishedAt: null });
    const story = await startStory(world, 'I knock.');
    assert.equal(story.leftAtOnce, true);
    await story.departed;
    world.listeners.get(events.GENERATION_ENDED)();
    storage.jobs.get('job-pass-2').status = 'done';
});
