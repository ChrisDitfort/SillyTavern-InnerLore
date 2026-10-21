import assert from 'node:assert/strict';
import test from 'node:test';

import { createEmptyStore } from '../core.js';
import { installMockInnerLoreStorage } from './mock-storage-server.mjs';
import { createEventListeners } from './mock-event-source.mjs';

installMockInnerLoreStorage();

const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

const waitFor = async (predicate, timeout = 6_000) => {
    const started = Date.now();
    while (!predicate()) {
        if (Date.now() - started > timeout) throw new Error('Timed out waiting for mocked InnerLore state.');
        await sleep(20);
    }
};

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

// Loads the extension against a mocked SillyTavern whose background requests
// stay open until the test answers them.
async function loadInnerLore(chatId, slots, { novelai = false } = {}) {
    const listeners = createEventListeners();
    const chat = [{ is_user: false, is_system: false, name: 'Narrator', mes: 'The gate stands shut.' }];
    const store = createEmptyStore(chatId);
    store.lastProcessedIndex = 0;
    const chatMetadata = { inner_lore: store };
    const extensionSettings = {
        disabledExtensions: [],
        connectionManager: {
            selectedProfile: 'test-profile',
            profiles: [{ id: 'test-profile', name: 'Test Profile', model: 'mock/model', ...(novelai ? { api: 'custom', 'api-url': 'https://text.novelai.net/oa/v1' } : {}) }],
        },
        inner_lore: {
            // These tests cover other passes; the game ledger has its own.
            gameEnabled: false,
            enabled: true,
            autoUpdate: true,
            innerSelfEnabled: true,
            autoLoreEnabled: false,
            worldProgressionEnabled: false,
            processEveryAssistantTurns: 1,
            maintenanceSchedulingVersion: 1,
            lookbackMessages: 10,
            connectionSource: 'profile',
            connectionProfileId: 'test-profile',
            requestTimeoutSeconds: 15,
            autoRebuildOnHistoryChange: true,
            autoRebuildMessageLimit: 120,
            providerConcurrency: slots,
        },
    };
    const requests = [];
    const context = {
        extensionSettings,
        chatMetadata,
        chat,
        chatId,
        name1: 'Jet',
        name2: 'Narrator',
        ...(novelai ? { mainApi: 'openai', chatCompletionSettings: { chat_completion_source: 'custom', custom_url: 'https://text.novelai.net/oa/v1', custom_model: 'xialong-v1' } } : {}),
        getCurrentChatId: () => chatId,
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
            sendRequest: (_profileId, messages) => new Promise(resolve => {
                requests.push({
                    text: messages.map(message => message.content).join('\n'),
                    answer: () => resolve({ content: '{"entities":[],"minds":[]}' }),
                });
            }),
        },
    };
    globalThis.document = { activeElement: null, getElementById: () => null, querySelectorAll: () => [] };
    globalThis.$ = () => ({ append: () => {} });
    globalThis.toastr = { error: () => {}, warning: () => {}, success: () => {} };
    globalThis.confirm = () => true;
    globalThis.SillyTavern = { getContext: () => context };

    await import(`../index.js?provider-concurrency=${chatId}-${Date.now()}`);
    await waitFor(() => listeners.has(events.CHAT_COMPLETION_PROMPT_READY));
    return { listeners, chat, chatMetadata, requests };
}

// Lands a completed reply and returns once its curator pass is on the provider.
async function landReplyAndStartPass(world, playerTurn, reply) {
    world.chat.push(
        { is_user: true, is_system: false, name: 'Jet', mes: playerTurn },
        { is_user: false, is_system: false, name: 'Narrator', mes: reply },
    );
    const before = world.requests.length;
    world.listeners.get(events.MESSAGE_RECEIVED)(world.chat.length - 1);
    await waitFor(() => world.requests.length === before + 1);
}

// Starts a story generation and reports whether its request left within the window.
async function startStory(world, playerTurn) {
    world.chat.push({ is_user: true, is_system: false, name: 'Jet', mes: playerTurn });
    await world.listeners.get(events.GENERATION_STARTED)('normal', {}, false);
    const departed = world.listeners.get(events.CHAT_COMPLETION_PROMPT_READY)({
        chat: [{ role: 'system', content: 'Narrate.' }, { role: 'user', content: playerTurn }],
    });
    const leftAtOnce = await Promise.race([departed.then(() => true), sleep(1_500).then(() => false)]);
    return { departed, leftAtOnce };
}

test('with one slot the story waits for the in-flight pass', async () => {
    const world = await loadInnerLore('one-slot-chat', 1);
    await landReplyAndStartPass(world, 'I knock.', 'The first door swings inward.');

    const story = await startStory(world, 'I step through.');
    assert.equal(story.leftAtOnce, false, 'background work finishes before the story');
    world.requests[0].answer();
    await story.departed;
    world.listeners.get(events.GENERATION_ENDED)();
});

test('with two slots the story never waits, and a new pass waits for the finished reply', async () => {
    const world = await loadInnerLore('two-slot-chat', 2);
    await landReplyAndStartPass(world, 'I knock.', 'The first door swings inward.');
    // A second trigger while the pass runs queues a follow-up pass.
    world.listeners.get(events.MESSAGE_RECEIVED)(world.chat.length - 1);

    const story = await startStory(world, 'I step through.');
    assert.equal(story.leftAtOnce, true, 'the story leaves while the pass is still on the provider');

    // The reply streams in while the first pass finishes beside it.
    world.chat.push({ is_user: false, is_system: false, name: 'Narrator', mes: 'The hall beyond is' });
    world.requests[0].answer();
    await sleep(1_200);
    assert.equal(world.requests.length, 1, 'no new pass starts on a half-written reply');

    world.chat.at(-1).mes = 'The hall beyond is lit by a hundred candles.';
    world.listeners.get(events.GENERATION_ENDED)();
    world.listeners.get(events.MESSAGE_RECEIVED)(world.chat.length - 1);
    await waitFor(() => world.requests.length === 2);
    assert.match(world.requests[1].text, /a hundred candles/u, 'the next pass reads the finished reply');
    world.requests[1].answer();
    await waitFor(() => world.chatMetadata.inner_lore.lastProcessedIndex === world.chat.length - 1);
});

test('on a one-request provider the story stops the running pass, which re-runs after the reply; the same watermark waits the second time', async () => {
    const world = await loadInnerLore('preempt-chat', 2, { novelai: true });
    await landReplyAndStartPass(world, 'I knock.', 'The first door swings inward.');

    const story = await startStory(world, 'I step through.');
    assert.equal(story.leftAtOnce, true, 'the story preempts the pass instead of waiting for NovelAI');
    assert.equal(world.requests.length, 1, 'no new background request while the story is written');
    world.chat.push({ is_user: false, is_system: false, name: 'Narrator', mes: 'The hall beyond is dark.' });
    world.listeners.get(events.GENERATION_ENDED)();
    world.listeners.get(events.MESSAGE_RECEIVED)(world.chat.length - 1);
    await waitFor(() => world.requests.length === 2, 8_000);
    assert.match(world.requests[1].text, /first door swings inward[\s\S]*hall beyond is dark/u, 'the re-run covers the stopped turn and the new reply');

    const again = await startStory(world, 'I light a lamp.');
    assert.equal(again.leftAtOnce, false, 'a second departure on the same watermark waits for the pass');
    world.requests[1].answer();
    await again.departed;
    world.listeners.get(events.GENERATION_ENDED)();
});
