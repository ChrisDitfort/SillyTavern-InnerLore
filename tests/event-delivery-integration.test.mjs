import assert from 'node:assert/strict';
import test from 'node:test';

import { createEmptyStore } from '../core.js';
import { createProgressionState } from '../progression.js';
import { upsertTriggerEventDefinition } from '../trigger-events.js';
import { installMockInnerLoreStorage } from './mock-storage-server.mjs';

installMockInnerLoreStorage();

const waitFor = async (predicate, timeout = 2_000) => {
    const started = Date.now();
    while (!predicate()) {
        if (Date.now() - started > timeout) throw new Error('Timed out waiting for mocked InnerLore initialization.');
        await new Promise(resolve => setTimeout(resolve, 10));
    }
};

test('MESSAGE_SENT injects a newly typed explicit time skip into the same generation', async () => {
    const listeners = new Map();
    const prompts = new Map();
    const chat = Array.from({ length: 23 }, (_, index) => ({
        is_user: index % 2 === 1,
        is_system: false,
        name: index % 2 === 1 ? 'Jet' : 'Narrator',
        mes: index === 22 ? 'Dani and Jet remain in the kitchen.' : `Earlier story ${index}.`,
    }));
    const store = createEmptyStore('delivery-chat');
    store.lastProcessedIndex = 22;
    let progression = createProgressionState();
    progression.clock = {
        minimumSeconds: 1_208,
        estimatedSeconds: 1_208,
        maximumSeconds: 1_208,
        confidence: 1,
        currentTimeLabel: '',
    };
    progression.lastProcessedIndex = 22;
    progression = upsertTriggerEventDefinition(progression, {
        id: 'trigger:break_in',
        key: 'break_in',
        title: 'A burglar attempts to break in',
        description: 'The kitchen window is forced from outside.',
        enabled: true,
        triggerAfterSeconds: 300,
        timeBasis: 'after_creation',
        triggerTimeCertainty: 'estimated',
        activationVisibility: 'observable',
        priority: 90,
    }, { clock: progression.clock, messageIndex: 22 }).state;
    store.progression = progression;

    const extensionSettings = {
        disabledExtensions: [],
        connectionManager: { selectedProfile: '', profiles: [] },
        inner_lore: {
            enabled: true,
            autoUpdate: false,
            innerSelfEnabled: true,
            autoLoreEnabled: true,
            worldProgressionEnabled: true,
        },
    };
    const events = {
        MESSAGE_SENT: 'message_sent',
        MESSAGE_RECEIVED: 'message_received',
        GENERATION_STARTED: 'generation_started',
        GENERATION_STOPPED: 'generation_stopped',
        CHAT_CHANGED: 'chat_changed',
        CHAT_DELETED: 'chat_deleted',
        GROUP_CHAT_DELETED: 'group_chat_deleted',
        CHAT_RENAMED: 'chat_renamed',
        MESSAGE_EDITED: 'message_edited',
        MESSAGE_SWIPED: 'message_swiped',
        MESSAGE_DELETED: 'message_deleted',
    };
    const context = {
        extensionSettings,
        chatMetadata: { inner_lore: store },
        chat,
        chatId: 'delivery-chat',
        name1: 'Jet',
        name2: 'Narrator',
        getCurrentChatId: () => 'delivery-chat',
        getCharacterCardFields: () => ({}),
        saveSettingsDebounced: () => {},
        saveMetadata: async () => {},
        saveMetadataDebounced: () => {},
        setExtensionPrompt: (key, value) => prompts.set(key, value),
        renderExtensionTemplateAsync: async () => '',
        eventSource: { on: (event, callback) => listeners.set(event, callback) },
        eventTypes: events,
        SlashCommandParser: null,
        SlashCommand: null,
        ConnectionManagerRequestService: null,
    };

    globalThis.document = {
        activeElement: null,
        getElementById: () => null,
        querySelectorAll: () => [],
    };
    globalThis.$ = () => ({ append: () => {} });
    globalThis.toastr = { error: () => {}, warning: () => {}, success: () => {} };
    globalThis.confirm = () => true;
    globalThis.SillyTavern = { getContext: () => context };

    await import(`../index.js?event-delivery=${Date.now()}`);
    await waitFor(() => listeners.has(events.MESSAGE_SENT));

    listeners.get(events.GENERATION_STARTED)('normal');
    assert.equal(prompts.get('inner_lore_trigger_delivery') || '', '');

    chat.push({
        is_user: true,
        is_system: false,
        name: 'Jet',
        mes: '5 minutes pass in the kitchen with Dani',
    });
    listeners.get(events.MESSAGE_SENT)(23);

    assert.match(prompts.get('inner_lore_trigger_delivery'), /threshold="CROSSED_THIS_TURN"/u);
    assert.match(prompts.get('inner_lore_trigger_delivery'), /A burglar attempts to break in/u);
    assert.match(prompts.get('inner_lore_latest_turn_contract'), /5 minutes pass in the kitchen with Dani/u);
    const receipt = context.chatMetadata.inner_lore.progression.eventRuntime['trigger:break_in'];
    assert.equal(receipt.deliveryStatus, 'injected');
    assert.equal(receipt.deliveryAttempts, 0, 'the attempt is counted only after completed narration is checked');
    assert.match(receipt.deliveryLastGenerationId, /^story:/u);
    assert.equal(context.chatMetadata.inner_lore.progression.lastTriggerDeliveryPrompt.messageIndex, 23);
});
