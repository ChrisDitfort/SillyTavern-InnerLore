import assert from 'node:assert/strict';
import test from 'node:test';

import { createEmptyStore, messageFingerprint } from '../core.js';
import { applyGameOperations, createGameState } from '../game.js?v=6';
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
    MESSAGE_SENT: 'message_sent',
    GENERATION_STARTED: 'generation_started',
    GENERATION_ENDED: 'generation_ended',
    CHAT_COMPLETION_PROMPT_READY: 'chat_completion_prompt_ready',
    CHAT_CHANGED: 'chat_changed',
    MESSAGE_EDITED: 'message_edited',
    MESSAGE_SWIPED: 'message_swiped',
    MESSAGE_DELETED: 'message_deleted',
    TOOL_CALLS_RENDERED: 'tool_calls_rendered',
};

/**
 * A playthrough's turn: Wren's reply has been read; the player
 * asks a question; the narrator answers with a game tool call first, which
 * makes SillyTavern delete its empty reply placeholder.
 */
async function loadWorld(chatId) {
    const listeners = createEventListeners();
    const chat = [
        { is_user: false, is_system: false, name: 'Narrator', mes: 'She halts at the Gullhouse\'s door, where Bryn Tolley waits. "Beds two coppers, paid at my hand."' },
    ];
    const store = createEmptyStore(chatId);
    store.lastProcessedIndex = 0;
    store.processedFingerprints = { 0: messageFingerprint(chat[0]) };
    store.entities['character:bryn tolley'] = { id: 'character:bryn tolley', type: 'character', name: 'Bryn Tolley', enabled: true, importance: 60, firstSeenMessage: 0, lastSeenMessage: 0 };
    let game = createGameState();
    game = applyGameOperations(game, [
        { type: 'currency.set', currency: { name: 'coin', units: [{ name: 'copper', plural: 'coppers', value: 1 }] } },
        { type: 'purse.set', amount: 120 },
    ], { messageIndex: 0, source: 'planner' }).state;
    game.lastProcessedIndex = 0;
    store.game = game;
    const chatMetadata = { inner_lore: store };
    const extensionSettings = {
        disabledExtensions: [],
        connectionManager: { selectedProfile: 'test-profile', profiles: [{ id: 'test-profile', name: 'Test Profile', model: 'mock/model' }] },
        inner_lore: {
            enabled: true, autoUpdate: false, innerSelfEnabled: true, autoLoreEnabled: true, worldProgressionEnabled: false,
            gameEnabled: true, gameToolsEnabled: true, gameToolsSetupVersion: 1, processEveryAssistantTurns: 1, maintenanceSchedulingVersion: 1,
            lookbackMessages: 10, connectionSource: 'profile', connectionProfileId: 'test-profile', requestTimeoutSeconds: 15,
            autoRebuildOnHistoryChange: true, autoRebuildMessageLimit: 120, providerConcurrency: 2, storageBackend: 'sqlite',
        },
    };
    const tools = new Map();
    let requests = 0;
    const context = {
        extensionSettings, chatMetadata, chat, chatId, name1: 'Jet', name2: 'Harness Harbour',
        mainApi: 'openai',
        chatCompletionSettings: { chat_completion_source: 'custom', function_calling: true, custom_url: 'https://nano-gpt.com/api/subscription/v1', custom_model: 'glm' },
        getCurrentChatId: () => chatId,
        getCharacterCardFields: () => ({}),
        saveSettingsDebounced: () => {},
        saveMetadata: async () => {},
        saveMetadataDebounced: () => {},
        setExtensionPrompt: () => {},
        renderExtensionTemplateAsync: async () => '',
        registerFunctionTool: tool => tools.set(tool.name, tool),
        eventSource: { on: listeners.on },
        eventTypes: events,
        SlashCommandParser: null, SlashCommand: null,
        ConnectionManagerRequestService: {
            getSupportedProfiles: () => extensionSettings.connectionManager.profiles,
            sendRequest: async () => { requests++; return { content: '{"entities":[],"minds":[]}' }; },
        },
    };
    globalThis.document = { activeElement: null, getElementById: () => null, querySelectorAll: () => [] };
    globalThis.$ = () => ({ append: () => {} });
    globalThis.toastr = { error: () => {}, warning: () => {}, success: () => {}, info: () => {} };
    globalThis.confirm = () => true;
    globalThis.SillyTavern = { getContext: () => context };
    await import(`../index.js?tool-call-history=${chatId}-${Date.now()}`);
    await waitFor(() => listeners.has(events.CHAT_COMPLETION_PROMPT_READY) && tools.size > 0);
    await waitFor(() => chatMetadata.inner_lore.backend === 'airpg-storage');
    return { listeners, chat, chatMetadata, tools, requests: () => requests };
}

test('a narrator tool call on a turn with no exchange: nothing offered, nothing moved, no rebuild from the deleted placeholder', async () => {
    const world = await loadWorld('tool-call-chat');
    const store = () => world.chatMetadata.inner_lore;

    // The player asks a question; the turn moves no coin.
    world.chat.push({ is_user: true, is_system: false, name: 'Chris', mes: '"So that\'s salt-born, no magic, no strength. Are you also salt-born Wren."' });
    world.listeners.get(events.MESSAGE_SENT)?.(world.chat.length - 1);
    world.listeners.get(events.GENERATION_STARTED)('normal', {}, false);
    assert.equal(world.tools.get('game_coin').shouldRegister(), false, 'the game tools are not offered on a turn without an exchange');

    // A model calls one anyway: SillyTavern deletes the empty placeholder first.
    world.chat.push({ is_user: false, is_system: false, name: 'Harness Harbour', mes: '' });
    world.chat.pop();
    await world.listeners.get(events.MESSAGE_DELETED)(world.chat.length);
    await sleep(50);
    assert.equal(store().needsRebuild, false, 'deleting the unread placeholder quarantines nothing');

    const reply = await world.tools.get('game_coin').action({ action: 'collect', amount: '0 coppers', person: 'Bryn Tolley', reason: 'no transaction yet' });
    assert.match(reply, /^NOT DONE: collect 0 coppers \(Bryn Tolley\): the player has not chosen to do this/u);
    const reply2 = await world.tools.get('game_coin').action({ action: 'pay', amount: '2 coppers', person: 'Bryn Tolley', reason: 'a bed' });
    assert.match(reply2, /the player has not chosen to do this/u, 'a real-looking payment the player did not make is refused too');
    assert.equal(store().game.purse.amount, 120, 'the purse never moved');
    assert.equal(world.requests(), 0, 'no rebuild ran');
});

test('on a turn where the player pays, the tools are offered and the payment goes through the consent check', async () => {
    const world = await loadWorld('tool-call-pay-chat');
    world.chat.push({ is_user: true, is_system: false, name: 'Chris', mes: 'I pay Bryn two coppers for a bed.' });
    world.listeners.get(events.MESSAGE_SENT)?.(world.chat.length - 1);
    world.listeners.get(events.GENERATION_STARTED)('normal', {}, false);
    assert.equal(world.tools.get('game_coin').shouldRegister(), true, 'the tools are offered when the player\'s words move coin');
    const reply = await world.tools.get('game_coin').action({ action: 'pay', amount: '2 coppers', person: 'Bryn Tolley', reason: 'a bed' });
    assert.doesNotMatch(reply, /has not chosen/u, 'the player\'s own payment passes the consent check');
    const collect = await world.tools.get('game_coin').action({ action: 'collect', amount: '5 coppers', person: 'Bryn Tolley' });
    assert.match(collect, /has not chosen/u, 'the narrator cannot add a collection the player did not make');
});

test('deleting a reply InnerLore has read still quarantines and rebuilds', async () => {
    const world = await loadWorld('tool-call-delete-chat');
    world.chat.pop();
    await world.listeners.get(events.MESSAGE_DELETED)(world.chat.length);
    await waitFor(() => world.chatMetadata.inner_lore.needsRebuild === true || world.requests() > 0);
});
