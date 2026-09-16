import assert from 'node:assert/strict';
import test from 'node:test';

import { createEmptyStore } from '../core.js';
import { installMockInnerLoreStorage } from './mock-storage-server.mjs';

installMockInnerLoreStorage();

const waitFor = async (predicate, timeout = 2_000) => {
    const started = Date.now();
    while (!predicate()) {
        if (Date.now() - started > timeout) throw new Error('Timed out waiting for empty-output recovery.');
        await new Promise(resolve => setTimeout(resolve, 20));
    }
};

test('empty replies regenerate, and a failed recovery is never counted as a completed turn', async () => {
    const listeners = new Map();
    const prompts = new Map();
    const generationTypes = [];
    let regeneratedText = 'Osric Vale, the Lord Chancellor, seals the ruling. “The next matter may proceed.”';
    const chat = [
        { is_user: false, is_system: false, name: 'Narrator', mes: 'The hearing begins.' },
        { is_user: true, is_system: false, name: 'Player', mes: 'Move to the next matter.' },
        { is_user: false, is_system: false, name: 'Narrator', mes: '', extra: {} },
    ];
    const store = createEmptyStore('empty-output-chat');
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
        chatId: 'empty-output-chat',
        name1: 'Player',
        name2: 'Narrator',
        getCurrentChatId: () => 'empty-output-chat',
        getCharacterCardFields: () => ({}),
        saveSettingsDebounced: () => {},
        saveMetadata: async () => {},
        saveMetadataDebounced: () => {},
        saveChat: async () => {},
        deleteLastMessage: async () => {
            chat.pop();
            listeners.get(events.MESSAGE_DELETED)?.(chat.length);
        },
        setExtensionPrompt: (key, value) => prompts.set(key, value),
        renderExtensionTemplateAsync: async () => '',
        eventSource: { on: (event, callback) => listeners.set(event, callback) },
        eventTypes: events,
        SlashCommandParser: null,
        SlashCommand: null,
        ConnectionManagerRequestService: null,
        generate: async type => {
            generationTypes.push(type);
            assert.equal(type, 'regenerate');
            chat.pop();
            listeners.get(events.MESSAGE_DELETED)?.(chat.length);
            chat.push({
                is_user: false,
                is_system: false,
                name: 'Narrator',
                mes: regeneratedText,
                extra: {},
            });
            listeners.get(events.MESSAGE_RECEIVED)(2, 'regenerate');
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

    await import(`../index.js?empty-output-recovery=${Date.now()}`);
    await waitFor(() => listeners.has(events.MESSAGE_RECEIVED));
    listeners.get(events.MESSAGE_RECEIVED)(2, 'normal');
    await waitFor(() => chat[2].extra.inner_lore_output_recovery?.completed === true);

    assert.deepEqual(generationTypes, ['regenerate']);
    assert.match(chat[2].mes, /^Osric Vale, the Lord Chancellor/u);
    assert.equal(chat[2].extra.inner_lore_output_recovery.attempts, 1);
    assert.equal(chatMetadata.inner_lore.assistantTurnsSincePass, 1);
    assert.equal(chatMetadata.inner_lore.needsRebuild, false);
    assert.equal(prompts.get('inner_lore_cutoff_recovery'), '');

    const firstRecoveryAt = chatMetadata.inner_lore.lastOutputRecovery.at;
    generationTypes.length = 0;
    regeneratedText = '';
    chatMetadata.inner_lore.assistantTurnsSincePass = 0;
    chat[2] = { is_user: false, is_system: false, name: 'Narrator', mes: '', extra: {} };
    listeners.get(events.MESSAGE_RECEIVED)(2, 'normal');
    await waitFor(() => chatMetadata.inner_lore.lastOutputRecovery?.at > firstRecoveryAt);

    assert.deepEqual(generationTypes, ['regenerate', 'regenerate']);
    assert.equal(chatMetadata.inner_lore.lastOutputRecovery.completed, false);
    assert.equal(chatMetadata.inner_lore.lastOutputRecovery.finalReason, 'empty output');
    assert.equal(chatMetadata.inner_lore.lastOutputRecovery.quarantined, true);
    assert.equal(chat.length, 2, 'the failed assistant bubble is removed from visible chat history');
    assert.equal(chat.at(-1).is_user, true);
    assert.equal(chatMetadata.inner_lore.assistantTurnsSincePass, 0);
    assert.equal(chatMetadata.inner_lore.needsRebuild, false);

    const failedRecoveryAt = chatMetadata.inner_lore.lastOutputRecovery.at;
    generationTypes.length = 0;
    regeneratedText = 'Osric Vale seals the ruling. “The next matter may proceed.”';
    chat[2] = {
        is_user: false,
        is_system: false,
        name: 'Narrator',
        mes: 'Aim for 120–190 words.\nOsric Vale seals the ruling.',
        extra: {},
    };
    listeners.get(events.MESSAGE_RECEIVED)(2, 'normal');
    await waitFor(() => chatMetadata.inner_lore.lastOutputRecovery?.at > failedRecoveryAt);

    assert.deepEqual(generationTypes, ['regenerate']);
    assert.equal(chatMetadata.inner_lore.lastOutputRecovery.initialReason, 'prompt instruction echo');
    assert.equal(chatMetadata.inner_lore.lastOutputRecovery.completed, true);
    assert.doesNotMatch(chat[2].mes, /Aim for/u);
    assert.equal(chatMetadata.inner_lore.assistantTurnsSincePass, 1);
});
