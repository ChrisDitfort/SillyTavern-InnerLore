import assert from 'node:assert/strict';
import test from 'node:test';

import { createEmptyStore } from '../core.js';
import { installMockInnerLoreStorage } from './mock-storage-server.mjs';

installMockInnerLoreStorage();

const waitFor = async (predicate, timeout = 2_000) => {
    const started = Date.now();
    while (!predicate()) {
        if (Date.now() - started > timeout) throw new Error('Timed out waiting for output recovery.');
        await new Promise(resolve => setTimeout(resolve, 20));
    }
};

test('a hard cutoff is continued in place once before InnerLore queues analysis', async () => {
    const listeners = new Map();
    const prompts = new Map();
    let saveChatCalls = 0;
    const chat = [
        { is_user: false, is_system: false, name: 'Narrator', mes: 'The hearing begins.' },
        { is_user: true, is_system: false, name: 'Player', mes: 'Call the vote.' },
        {
            is_user: false,
            is_system: false,
            name: 'Narrator',
            mes: 'A councilor answers, “The septry. It is',
            extra: {},
        },
    ];
    const store = createEmptyStore('output-recovery-chat');
    store.lastProcessedIndex = 0;
    const chatMetadata = { inner_lore: store };
    const extensionSettings = {
        disabledExtensions: [],
        connectionManager: { profiles: [], selectedProfile: '' },
        inner_lore: {
            enabled: true,
            autoUpdate: false,
            autoRecoverIncomplete: true,
            incompleteRecoveryAttempts: 2,
            innerSelfEnabled: true,
            autoLoreEnabled: true,
            worldProgressionEnabled: false,
        },
    };
    const events = {
        MESSAGE_RECEIVED: 'message_received',
        GENERATION_STARTED: 'generation_started',
        GENERATION_STOPPED: 'generation_stopped',
        CHAT_CHANGED: 'chat_changed',
        MESSAGE_EDITED: 'message_edited',
        MESSAGE_SWIPED: 'message_swiped',
        MESSAGE_DELETED: 'message_deleted',
    };
    const context = {
        extensionSettings,
        chatMetadata,
        chat,
        chatId: 'output-recovery-chat',
        name1: 'Player',
        name2: 'Narrator',
        getCurrentChatId: () => 'output-recovery-chat',
        getCharacterCardFields: () => ({}),
        saveSettingsDebounced: () => {},
        saveMetadata: async () => {},
        saveMetadataDebounced: () => {},
        saveChat: async () => { saveChatCalls++; },
        setExtensionPrompt: (key, value) => prompts.set(key, value),
        renderExtensionTemplateAsync: async () => '',
        eventSource: { on: (event, callback) => listeners.set(event, callback) },
        eventTypes: events,
        SlashCommandParser: null,
        SlashCommand: null,
        ConnectionManagerRequestService: null,
        generate: async type => {
            assert.equal(type, 'continue');
            chat[2].mes += ' not one of the permitted choices.” The vote resumes.';
            listeners.get(events.MESSAGE_RECEIVED)(2, 'continue');
        },
    };

    globalThis.document = {
        activeElement: null,
        getElementById: id => id === 'send_textarea' ? { value: '' } : null,
        querySelectorAll: () => [],
    };
    globalThis.$ = () => ({ append: () => {} });
    globalThis.toastr = { error: () => {}, warning: () => {}, success: () => {} };
    globalThis.confirm = () => true;
    globalThis.SillyTavern = { getContext: () => context };

    await import(`../index.js?output-recovery=${Date.now()}`);
    await waitFor(() => listeners.has(events.MESSAGE_RECEIVED));
    listeners.get(events.MESSAGE_RECEIVED)(2, 'normal');
    await waitFor(() => chat[2].extra.inner_lore_output_recovery?.completed === true);

    assert.match(chat[2].mes, /^A councilor answers, “The septry\. It is not/u);
    assert.equal(chat[2].extra.inner_lore_output_recovery.attempts, 1);
    assert.equal(chatMetadata.inner_lore.assistantTurnsSincePass, 1);
    assert.equal(saveChatCalls, 1);
    assert.equal(prompts.get('inner_lore_cutoff_recovery'), '');
});
