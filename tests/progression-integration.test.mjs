import assert from 'node:assert/strict';
import test from 'node:test';

import { createEmptyStore } from '../core.js';
import { createProgressionState } from '../progression.js';
import { installMockInnerLoreStorage } from './mock-storage-server.mjs';

installMockInnerLoreStorage();

const waitFor = async (predicate, timeout = 8_000) => {
    const started = Date.now();
    while (!predicate()) {
        if (Date.now() - started > timeout) throw new Error('Timed out waiting for mocked progression integration state.');
        await new Promise(resolve => setTimeout(resolve, 20));
    }
};

test('live integration counts completed ranges once and catches up after a progression-only failure', async () => {
    const listeners = new Map();
    const worlds = new Map();
    const chat = [
        { is_user: true, is_system: false, name: 'Jet', mes: 'I cross the room.' },
        { is_user: false, is_system: false, name: 'Narrator', mes: 'Jet crosses the room in a few seconds.' },
    ];
    const initialStore = createEmptyStore('progression-integration');
    initialStore.progression = createProgressionState();
    const chatMetadata = { inner_lore: initialStore };
    const extensionSettings = {
        disabledExtensions: [],
        connectionManager: {
            selectedProfile: 'mock-profile',
            profiles: [{ id: 'mock-profile', name: 'Mock Profile', model: 'mock/model' }],
        },
        inner_lore: {
            enabled: true,
            autoUpdate: true,
            innerSelfEnabled: true,
            autoLoreEnabled: true,
            worldProgressionEnabled: true,
            processEveryAssistantTurns: 1,
            maintenanceSchedulingVersion: 1,
            progressionEveryAssistantTurns: 1,
            lookbackMessages: 10,
            connectionSource: 'profile',
            connectionProfileId: 'mock-profile',
            progressionConnectionProfileId: 'mock-profile',
            requestTimeoutSeconds: 15,
            progressionRequestTimeoutSeconds: 15,
            autoRebuildOnHistoryChange: true,
            autoRebuildMessageLimit: 120,
        },
    };

    let curatorRequests = 0;
    let progressionRequests = 0;
    const progressionPrompts = [];
    const durations = [10, 20, 'fail', 100];
    const requestService = {
        getSupportedProfiles: () => extensionSettings.connectionManager.profiles,
        sendRequest: async (profileId, messages) => {
            const isProgression = messages.some(message => /World Progression Engine/u.test(message.content));
            if (!isProgression) {
                curatorRequests++;
                return { content: '{"entities":[],"minds":[]}' };
            }
            progressionPrompts.push(messages.map(message => message.content).join('\n'));
            const duration = durations[progressionRequests++];
            if (duration === 'fail') throw new Error('deliberate non-transient progression test failure');
            return {
                content: JSON.stringify({
                    time: {
                        elapsed: { minimum_seconds: duration, estimated_seconds: duration, maximum_seconds: duration },
                        confidence: 1,
                        basis: ['mock completed range'],
                        completed_actions: ['mock action'],
                    },
                    goals: [],
                    processes: [],
                    events: [],
                }),
            };
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
        chatMetadata,
        chat,
        chatId: 'progression-integration',
        name1: 'Jet',
        name2: 'Narrator',
        getCurrentChatId: () => 'progression-integration',
        getCharacterCardFields: () => ({ description: 'A generic test narrator.' }),
        saveSettingsDebounced: () => {},
        saveMetadata: async () => {},
        saveMetadataDebounced: () => {},
        setExtensionPrompt: () => {},
        renderExtensionTemplateAsync: async () => '',
        eventSource: { on: (event, callback) => listeners.set(event, callback) },
        eventTypes: events,
        SlashCommandParser: null,
        SlashCommand: null,
        ConnectionManagerRequestService: requestService,
        loadWorldInfo: async name => worlds.get(name) || null,
        saveWorldInfo: async (name, data) => worlds.set(name, structuredClone(data)),
        updateWorldInfoList: async () => {},
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

    await import(`../index.js?progression-integration=${Date.now()}`);
    await waitFor(() => listeners.size === 6);

    listeners.get(events.MESSAGE_RECEIVED)(1);
    await waitFor(() => chatMetadata.inner_lore.progression.lastProcessedIndex === 1);
    assert.equal(chatMetadata.inner_lore.progression.clock.estimatedSeconds, 10);
    assert.equal(chatMetadata.inner_lore.lastProcessedIndex, 1);

    // Re-emitting the same assistant event must not count the exchange again.
    listeners.get(events.MESSAGE_RECEIVED)(1);
    await new Promise(resolve => setTimeout(resolve, 700));
    assert.equal(progressionRequests, 1);
    assert.equal(chatMetadata.inner_lore.progression.clock.estimatedSeconds, 10);

    chat.push(
        { is_user: true, is_system: false, name: 'Jet', mes: 'I ask Aldric one short question.' },
        { is_user: false, is_system: false, name: 'Narrator', mes: 'Aldric answers after a brief pause.' },
    );
    listeners.get(events.MESSAGE_RECEIVED)(3);
    await waitFor(() => chatMetadata.inner_lore.progression.lastProcessedIndex === 3);
    assert.equal(chatMetadata.inner_lore.progression.clock.estimatedSeconds, 30);

    chat.push(
        { is_user: true, is_system: false, name: 'Jet', mes: 'I begin the failed-range action.' },
        { is_user: false, is_system: false, name: 'Narrator', mes: 'The failed-range action completes.' },
    );
    listeners.get(events.MESSAGE_RECEIVED)(5);
    await waitFor(() => progressionRequests === 3 && chatMetadata.inner_lore.lastProcessedIndex === 5);
    assert.equal(chatMetadata.inner_lore.progression.lastProcessedIndex, 3, 'failed progression must retain its prior watermark');
    assert.equal(chatMetadata.inner_lore.progression.clock.estimatedSeconds, 30, 'failed progression must not partially advance time');

    chat.push(
        { is_user: true, is_system: false, name: 'Jet', mes: 'I complete the recovery-range action.' },
        { is_user: false, is_system: false, name: 'Narrator', mes: 'The recovery-range action completes too.' },
    );
    listeners.get(events.MESSAGE_RECEIVED)(7);
    await waitFor(() => chatMetadata.inner_lore.progression.lastProcessedIndex === 7);
    assert.equal(chatMetadata.inner_lore.progression.clock.estimatedSeconds, 130);
    assert.match(progressionPrompts[3], /failed-range action completes/u);
    assert.match(progressionPrompts[3], /recovery-range action completes too/u);
    assert.equal(curatorRequests, 4, 'curator processes each successful new range without re-reading the failed progression range');
});
