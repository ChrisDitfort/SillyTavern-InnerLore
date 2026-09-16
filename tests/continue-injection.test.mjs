import assert from 'node:assert/strict';
import test from 'node:test';

import { createEmptyStore, snapshotMessageRange } from '../core.js';
import { installMockInnerLoreStorage } from './mock-storage-server.mjs';

installMockInnerLoreStorage();

const waitFor = async (predicate, timeout = 4_000) => {
    const started = Date.now();
    while (!predicate()) {
        if (Date.now() - started > timeout) throw new Error('Timed out waiting for mocked InnerLore state.');
        await new Promise(resolve => setTimeout(resolve, 20));
    }
};

test('a continue generation suppresses the latest-turn contract, a normal turn keeps it', async () => {
    const listeners = new Map();
    const prompts = new Map();
    const chat = [
        { is_user: false, is_system: false, name: 'Narrator', mes: 'The hall is quiet as Freesia waits.' },
        { is_user: true, is_system: false, name: 'Jet', mes: '"Do it, Freesia."' },
        { is_user: false, is_system: false, name: 'Narrator', mes: 'Freesia lifts the blade and drives it home. It is done.' },
    ];
    const store = createEmptyStore('continue-chat');
    store.lastProcessedIndex = 2;
    store.processedFingerprints = snapshotMessageRange(chat, 0, 2);

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
            autoLoreEnabled: false,
            worldProgressionEnabled: false,
            processEveryAssistantTurns: 1,
            maintenanceSchedulingVersion: 1,
            lookbackMessages: 10,
            connectionSource: 'profile',
            connectionProfileId: 'test-profile',
            requestTimeoutSeconds: 15,
            autoRebuildOnHistoryChange: false,
            autoRebuildMessageLimit: 120,
        },
    };
    const events = {
        MESSAGE_RECEIVED: 'message_received',
        MESSAGE_SENT: 'message_sent',
        GENERATION_STARTED: 'generation_started',
        GENERATION_AFTER_COMMANDS: 'generation_after_commands',
        GENERATION_STOPPED: 'generation_stopped',
        CHAT_CHANGED: 'chat_changed',
        MESSAGE_EDITED: 'message_edited',
        MESSAGE_SWIPED: 'message_swiped',
        MESSAGE_DELETED: 'message_deleted',
    };
    const context = {
        extensionSettings,
        chatMetadata: { inner_lore: store },
        chat,
        chatId: 'continue-chat',
        name1: 'Jet',
        name2: 'Narrator',
        getCurrentChatId: () => 'continue-chat',
        getCharacterCardFields: () => ({ description: 'Freesia is a squire.' }),
        saveSettingsDebounced: () => {},
        saveMetadata: async () => {},
        saveMetadataDebounced: () => {},
        setExtensionPrompt: (key, value) => prompts.set(key, value),
        renderExtensionTemplateAsync: async () => '',
        eventSource: { on: (event, callback) => listeners.set(event, callback) },
        eventTypes: events,
        SlashCommandParser: null,
        SlashCommand: null,
        ConnectionManagerRequestService: {
            getSupportedProfiles: () => extensionSettings.connectionManager.profiles,
            sendRequest: async () => ({ content: '{"entities":[],"minds":[]}' }),
        },
    };
    globalThis.document = { activeElement: null, getElementById: () => null, querySelectorAll: () => [] };
    globalThis.$ = () => ({ append: () => {} });
    globalThis.toastr = { error: () => {}, warning: () => {}, success: () => {}, info: () => {} };
    globalThis.confirm = () => true;
    globalThis.SillyTavern = { getContext: () => context };

    await import(`../index.js?continue-inject=${Date.now()}`);
    await waitFor(() => listeners.has(events.GENERATION_STARTED));
    const CONTRACT_KEY = 'inner_lore_latest_turn_contract';

    // A normal story turn injects the latest-turn contract for the user action.
    listeners.get(events.GENERATION_STARTED)('normal', {}, false);
    const normalContract = prompts.get(CONTRACT_KEY);
    assert.ok(normalContract && normalContract.includes('latest_turn_contract'), 'a normal turn injects the latest-turn contract');
    assert.ok(normalContract.includes('Do it, Freesia'), 'the contract carries the newest user action');

    // A continue must clear that contract so the model extends the existing
    // reply instead of treating the already-complete turn as satisfied.
    listeners.get(events.GENERATION_STARTED)('continue', {}, false);
    assert.equal(prompts.get(CONTRACT_KEY), '', 'a continue suppresses the latest-turn contract');
});
