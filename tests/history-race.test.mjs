import assert from 'node:assert/strict';
import test from 'node:test';

import { createEmptyStore, EXPRESSION_FOUNDATION_VERSION, mergeEntityOperations, mergeMindOperations, messageFingerprint } from '../core.js';
import { installMockInnerLoreStorage } from './mock-storage-server.mjs';

installMockInnerLoreStorage();

const waitFor = async (predicate, timeout = 4_000) => {
    const started = Date.now();
    while (!predicate()) {
        if (Date.now() - started > timeout) throw new Error('Timed out waiting for mocked InnerLore state.');
        await new Promise(resolve => setTimeout(resolve, 20));
    }
};

test('a swipe during analysis discards the stale result and runs one deferred rebuild', async () => {
    const listeners = new Map();
    const prompts = [];
    const worlds = new Map();
    const chat = [{
        is_user: false,
        is_system: false,
        name: 'Narrator',
        mes: 'Eleanor waits in the Old Hall.',
    }];
    const initialStore = createEmptyStore('race-test-chat');
    initialStore.lastProcessedIndex = 0;
    mergeEntityOperations(initialStore, [{
        type: 'location',
        name: 'Old Hall',
        importance: 80,
        facts: ['Eleanor is waiting here.'],
    }], { messageIndex: 0, minimumImportance: 0 });
    mergeMindOperations(initialStore, [{
        character: 'Eleanor',
        persistent_self: {
            set: [{ key: 'guarded', kind: 'behavioral_tendency', statement: 'I distrust easy answers.' }],
        },
        voice: {
            set: [{ key: 'measured', kind: 'cadence', statement: 'I speak in measured, exact clauses.' }],
        },
        current_mind: {
            interpretation: 'The player is asking me to distinguish two accounts.',
            inner_thoughts: ['Do not guess. Make them prove it.'],
        },
    }], { messageIndex: 0, maximumThoughtChanges: 10 });

    const chatMetadata = { inner_lore: initialStore };
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
            autoLoreEnabled: true,
            worldProgressionEnabled: false,
            processEveryAssistantTurns: 1,
            maintenanceSchedulingVersion: 1,
            lookbackMessages: 10,
            connectionSource: 'profile',
            connectionProfileId: 'test-profile',
            requestTimeoutSeconds: 15,
            autoRebuildOnHistoryChange: true,
            autoRebuildMessageLimit: 120,
        },
    };

    let requestCount = 0;
    let releaseFirstRequest;
    const stalePayload = {
        entities: [{ type: 'event', name: 'Rejected Branch', importance: 90, facts: ['This must never be committed.'] }],
        minds: [],
    };
    const rebuiltPayload = {
        entities: [{ type: 'event', name: 'Selected Branch', importance: 90, facts: ['This is the selected continuity.'] }],
        minds: [
            { character: 'Player', set: [{ key: 'forced_opinion', category: 'opinion', thought: 'The extension must not decide this.', confidence: 'inferred' }] },
            { character: 'Eleanor', set: [{ key: 'selected_memory', category: 'memory', thought: 'I remember the selected branch.', confidence: 'confirmed' }] },
        ],
    };
    const requestService = {
        getSupportedProfiles: () => extensionSettings.connectionManager.profiles,
        sendRequest: async () => {
            requestCount++;
            if (requestCount === 1) {
                return await new Promise(resolve => {
                    releaseFirstRequest = () => resolve({ content: JSON.stringify(stalePayload) });
                });
            }
            return { content: JSON.stringify(rebuiltPayload) };
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
        chatId: 'race-test-chat',
        name1: 'Player',
        name2: 'Narrator',
        getCurrentChatId: () => 'race-test-chat',
        getCharacterCardFields: () => ({ description: 'Eleanor is a recurring character.' }),
        saveSettingsDebounced: () => {},
        saveMetadata: async () => {},
        saveMetadataDebounced: () => {},
        setExtensionPrompt: (key, value) => prompts.push({ key, value }),
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

    await import(`../index.js?history-race=${Date.now()}`);
    await waitFor(() => listeners.size === 6);
    assert.ok(prompts.at(-1)?.value.includes('Old Hall'), 'valid pre-swipe state should initially be injected');

    chat.push({ is_user: true, is_system: false, name: 'Player', mes: 'Which account is true?' });
    chat.push({ is_user: false, is_system: false, name: 'Narrator', mes: 'Rejected first swipe.' });
    listeners.get(events.MESSAGE_RECEIVED)(2);
    await waitFor(() => typeof releaseFirstRequest === 'function');

    chat[2].mes = 'Selected Branch is current canon.';
    listeners.get(events.MESSAGE_SWIPED)(2);
    assert.equal(chatMetadata.inner_lore.needsRebuild, true);
    const replacementContext = [...prompts].reverse()
        .find(prompt => prompt.key === 'inner_lore_context')?.value || '';
    assert.ok(replacementContext.includes('Eleanor:'),
        'the safe pre-response NPC mind should remain available for a replacement generation');
    assert.doesNotMatch(replacementContext, /Rejected Branch/u,
        'the replacement prompt must not contain a discarded in-flight result');
    listeners.get(events.GENERATION_STARTED)('swipe');

    // Let the original 2.5-second debounce expire while the first request is
    // still active. The story request owns the branch-safe prefix and the clean
    // rebuild must wait for MESSAGE_RECEIVED rather than racing generation.
    await new Promise(resolve => setTimeout(resolve, 2_700));
    assert.equal(requestCount, 1, 'the rebuild must defer while analysis owns the request slot');

    releaseFirstRequest();
    listeners.get(events.MESSAGE_RECEIVED)(2, 'swipe');
    await waitFor(() => (
        requestCount >= 2
        && chatMetadata.inner_lore.needsRebuild === false
        && chatMetadata.inner_lore.lastProcessedIndex === 2
    ));

    const rebuiltStore = chatMetadata.inner_lore;
    assert.equal(rebuiltStore.entities['event:rejected branch'], undefined, 'discarded-swipe output must not be committed');
    assert.ok(rebuiltStore.entities['event:selected branch'], 'the deferred rebuild should use selected continuity');
    assert.equal(rebuiltStore.brains.player, undefined, 'the player must not receive an inferred private mind');
    assert.ok(rebuiltStore.brains.eleanor, 'NPC private minds should still be created');
    assert.equal(requestCount, 2, 'one stale request and one clean rebuild should be sufficient');
    const rebuiltContext = [...prompts].reverse()
        .find(prompt => prompt.key === 'inner_lore_context')?.value || '';
    assert.ok(rebuiltContext.includes('Selected Branch'), 'rebuilt state should return to prompt injection');
});

test('load-time fingerprint audit rebuilds a changed active swipe and removes stale minds', async () => {
    const listeners = new Map();
    const prompts = [];
    const chat = [
        { is_user: true, is_system: false, name: 'Jet Storm', mes: '"Thank you, Harrow."' },
        { is_user: false, is_system: false, name: 'Narrator', mes: 'Harrow inclines his head to Jet. “You’re welcome, sir.”' },
    ];
    const store = createEmptyStore('load-audit-chat');
    store.lastProcessedIndex = 1;
    store.processedFingerprints = {
        0: messageFingerprint(chat[0]),
        1: messageFingerprint({ ...chat[1], mes: 'Harrow tells Freesia, “You’re welcome, miss.”' }),
    };
    store.brains.harrow = {
        id: 'harrow',
        name: 'Harrow',
        aliases: [],
        thoughts: {
            mistaken_thanks: {
                key: 'mistaken_thanks',
                category: 'belief',
                thought: 'Freesia thanked me.',
                confidence: 'confirmed',
                retention: 'durable',
            },
        },
    };

    const chatMetadata = { inner_lore: store };
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
            autoRebuildOnHistoryChange: true,
            autoRebuildMessageLimit: 120,
        },
    };
    let requestCount = 0;
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
        chatId: 'load-audit-chat',
        name1: 'Jet Storm',
        name2: 'Narrator',
        getCurrentChatId: () => 'load-audit-chat',
        getCharacterCardFields: () => ({}),
        saveSettingsDebounced: () => {},
        saveMetadata: async () => {},
        saveMetadataDebounced: () => {},
        setExtensionPrompt: (key, value) => prompts.push({ key, value }),
        renderExtensionTemplateAsync: async () => '',
        eventSource: { on: (event, callback) => listeners.set(event, callback) },
        eventTypes: events,
        SlashCommandParser: null,
        SlashCommand: null,
        ConnectionManagerRequestService: {
            getSupportedProfiles: () => extensionSettings.connectionManager.profiles,
            sendRequest: async () => {
                requestCount++;
                return { content: '{"entities":[],"minds":[]}' };
            },
        },
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

    await import(`../index.js?load-audit=${Date.now()}`);
    await waitFor(() => listeners.size === 6);
    assert.equal(chatMetadata.inner_lore.needsRebuild, true, 'changed on-disk history must be quarantined during initialization');
    assert.ok(
        prompts.filter(prompt => prompt.key === 'inner_lore_context').every(prompt => prompt.value === ''),
        'no stale InnerLore context may be injected before the clean rebuild',
    );
    await waitFor(() => requestCount === 1 && chatMetadata.inner_lore.needsRebuild === false);

    assert.equal(chatMetadata.inner_lore.lastProcessedIndex, 1);
    assert.equal(chatMetadata.inner_lore.brains.harrow, undefined, 'a clean rebuild must discard the stale cross-character mind');
    assert.equal(chatMetadata.inner_lore.processedFingerprints[1], messageFingerprint(chat[1]));
});

test('InnerLore preparation never cancels or blocks the story generation', async () => {
    const listeners = new Map();
    const prompts = new Map();
    const errors = [];
    const chat = [
        { is_user: false, is_system: false, name: 'Narrator', mes: 'Freesia checks the lucky charm in her pocket outside the knight\'s door.' },
        { is_user: true, is_system: false, name: 'Jet', mes: 'I ask whether she is ready to begin.' },
        { is_user: false, is_system: false, name: 'Narrator', mes: '' },
    ];
    const oldStore = createEmptyStore('foundation-failure-chat');
    oldStore.version = 3;
    delete oldStore.expressionFoundationVersion;
    oldStore.lastProcessedIndex = 0;
    oldStore.needsRebuild = true;
    mergeMindOperations(oldStore, [{
        character: 'Freesia',
        persistent_self: {
            set: [{ key: 'self_doubt', kind: 'self_concept', statement: 'I expect to fail whatever I try.' }],
        },
    }], { messageIndex: 0, maximumThoughtChanges: 10 });

    const chatMetadata = { inner_lore: oldStore };
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
    let requestCount = 0;
    let stopCount = 0;
    const events = {
        MESSAGE_RECEIVED: 'message_received',
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
        chatMetadata,
        chat,
        chatId: 'foundation-failure-chat',
        name1: 'Jet',
        name2: 'Narrator',
        getCurrentChatId: () => 'foundation-failure-chat',
        getCharacterCardFields: () => ({
            description: 'Freesia is timid, self-doubting, quietly determined, stammers before authority, and keeps a lucky charm.',
        }),
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
            sendRequest: async () => {
                requestCount++;
                throw new Error('mock permanent foundation failure');
            },
        },
        stopGeneration: () => {
            stopCount++;
            return true;
        },
    };

    globalThis.document = {
        activeElement: null,
        getElementById: () => null,
        querySelectorAll: () => [],
    };
    globalThis.$ = () => ({ append: () => {} });
    globalThis.toastr = {
        error: message => errors.push(String(message)),
        warning: () => {},
        success: () => {},
    };
    globalThis.confirm = () => true;
    globalThis.SillyTavern = { getContext: () => context };

    await import(`../index.js?foundation-failure=${Date.now()}`);
    await waitFor(() => listeners.has(events.GENERATION_AFTER_COMMANDS));
    await listeners.get(events.GENERATION_STARTED)('swipe', {}, false);
    // Phase 1 non-blocking architecture: InnerLore preparation must never block
    // or cancel the story. The GENERATION_STARTED handler returns without making
    // a synchronous preflight request and without cancelling the narrator, even
    // though the background foundation request configured here would fail.
    assert.equal(requestCount, 0, 'GENERATION_STARTED must not make a blocking preflight request');
    assert.equal(stopCount, 0, 'the story generation must not be cancelled by InnerLore');
    assert.ok(!errors.some(message => /cancelled; no fallback was used/iu.test(message)), 'no story-cancelled error is surfaced');

    listeners.get(events.GENERATION_AFTER_COMMANDS)('swipe', {}, false);
    assert.equal(stopCount, 0, 'the after-commands boundary must never stop the narrator for InnerLore preparation');
});

test('generation lifecycle events cannot leave curator passes blocked', async () => {
    const listeners = new Map();
    const chat = [{ is_user: false, is_system: false, name: 'Narrator', mes: 'The room is quiet.' }];
    const store = createEmptyStore('generation-lifecycle-chat');
    store.lastProcessedIndex = 0;
    const chatMetadata = { inner_lore: store };
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
            autoRebuildOnHistoryChange: true,
            autoRebuildMessageLimit: 120,
        },
    };
    let requestCount = 0;
    const requestService = {
        getSupportedProfiles: () => extensionSettings.connectionManager.profiles,
        sendRequest: async () => {
            requestCount++;
            return { content: '{"entities":[],"minds":[]}' };
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
        chatId: 'generation-lifecycle-chat',
        name1: 'Jet',
        name2: 'Narrator',
        getCurrentChatId: () => 'generation-lifecycle-chat',
        getCharacterCardFields: () => ({}),
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

    await import(`../index.js?generation-lifecycle=${Date.now()}`);
    await waitFor(() => listeners.size === 6);
    listeners.get(events.GENERATION_STARTED)('normal', {}, false);
    chat.push(
        { is_user: true, is_system: false, name: 'Jet', mes: 'I look toward the desk.' },
        { is_user: false, is_system: false, name: 'Narrator', mes: 'A sealed ledger rests there.' },
    );
    listeners.get(events.MESSAGE_RECEIVED)(2);
    await waitFor(() => chatMetadata.inner_lore.lastProcessedIndex === 2);

    listeners.get(events.GENERATION_STARTED)('quiet', { quiet_prompt: 'background classifier' }, false);
    chat.push(
        { is_user: true, is_system: false, name: 'Jet', mes: 'I open it.' },
        { is_user: false, is_system: false, name: 'Narrator', mes: 'The wax seal breaks.' },
    );
    listeners.get(events.MESSAGE_RECEIVED)(4);
    await waitFor(() => chatMetadata.inner_lore.lastProcessedIndex === 4);
    assert.equal(requestCount, 2, 'foreground and quiet generation events must not suppress either curator pass');
});

test('a newer completed turn survives an older in-flight curator pass', async () => {
    const listeners = new Map();
    const chat = [{ is_user: false, is_system: false, name: 'Narrator', mes: 'The room is quiet.' }];
    const store = createEmptyStore('queued-turn-race-chat');
    store.lastProcessedIndex = 0;
    const chatMetadata = { inner_lore: store };
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
            autoRebuildOnHistoryChange: true,
            autoRebuildMessageLimit: 120,
        },
    };
    let requestCount = 0;
    let releaseFirstRequest;
    const requestService = {
        getSupportedProfiles: () => extensionSettings.connectionManager.profiles,
        sendRequest: async () => {
            requestCount++;
            if (requestCount === 1) {
                return await new Promise(resolve => {
                    releaseFirstRequest = () => resolve({ content: '{"entities":[],"minds":[]}' });
                });
            }
            return { content: '{"entities":[],"minds":[]}' };
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
        chatId: 'queued-turn-race-chat',
        name1: 'Jet',
        name2: 'Narrator',
        getCurrentChatId: () => 'queued-turn-race-chat',
        getCharacterCardFields: () => ({}),
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
    };

    globalThis.document = { activeElement: null, getElementById: () => null, querySelectorAll: () => [] };
    globalThis.$ = () => ({ append: () => {} });
    globalThis.toastr = { error: () => {}, warning: () => {}, success: () => {} };
    globalThis.confirm = () => true;
    globalThis.SillyTavern = { getContext: () => context };

    await import(`../index.js?queued-turn-race=${Date.now()}`);
    await waitFor(() => listeners.size === 6);

    chat.push(
        { is_user: true, is_system: false, name: 'Jet', mes: 'I open the first door.' },
        { is_user: false, is_system: false, name: 'Narrator', mes: 'The first door swings inward.' },
    );
    listeners.get(events.MESSAGE_RECEIVED)(2);
    await waitFor(() => requestCount === 1);

    chat.push(
        { is_user: true, is_system: false, name: 'Jet', mes: 'I cross the threshold.' },
        { is_user: false, is_system: false, name: 'Narrator', mes: 'The second room waits beyond it.' },
    );
    listeners.get(events.MESSAGE_RECEIVED)(4);
    releaseFirstRequest();

    await waitFor(() => chatMetadata.inner_lore.lastProcessedIndex === 4);
    assert.equal(requestCount, 2, 'the queued follow-up must analyze the newer turn');
    assert.equal(chatMetadata.inner_lore.assistantTurnsSincePass, 0);
});

test('load-time catch-up drains a persisted 24-turn curator queue', async () => {
    const listeners = new Map();
    const analyzedPrompts = [];
    const chat = [{
        is_user: false,
        is_system: false,
        name: 'Your squire',
        mes: 'Freesia reports for duty at the manor.',
    }];
    for (let turn = 1; turn < 24; turn++) {
        chat.push(
            { is_user: true, is_system: false, name: 'Jet', mes: `Jet gives instruction ${turn}.` },
            { is_user: false, is_system: false, name: 'Your squire', mes: `Freesia completes reply ${turn}.` },
        );
    }

    const store = createEmptyStore('persisted-queue-chat');
    store.lastProcessedIndex = -1;
    store.assistantTurnsSincePass = 24;
    const chatMetadata = { inner_lore: store };
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
            autoRebuildOnHistoryChange: true,
            autoRebuildMessageLimit: 120,
        },
    };
    let requestCount = 0;
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
        chatId: 'persisted-queue-chat',
        name1: 'Jet',
        name2: 'Your squire',
        getCurrentChatId: () => 'persisted-queue-chat',
        getCharacterCardFields: () => ({ description: 'Freesia is Jet’s anxious young squire.' }),
        saveSettingsDebounced: () => {},
        saveMetadata: async () => {},
        saveMetadataDebounced: () => {},
        setExtensionPrompt: () => {},
        renderExtensionTemplateAsync: async () => '',
        eventSource: { on: (event, callback) => listeners.set(event, callback) },
        eventTypes: events,
        SlashCommandParser: null,
        SlashCommand: null,
        ConnectionManagerRequestService: {
            getSupportedProfiles: () => extensionSettings.connectionManager.profiles,
            sendRequest: async (_profileId, messages) => {
                requestCount++;
                analyzedPrompts.push(messages.map(message => message.content).join('\n'));
                return {
                    content: JSON.stringify({
                        entities: [],
                        minds: [{
                            character: 'Freesia',
                            set: [{
                                key: 'serve_well',
                                category: 'desire',
                                thought: 'I want to serve Jet well.',
                                confidence: 'confirmed',
                                retention: 'durable',
                            }],
                        }],
                    }),
                };
            },
        },
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

    await import(`../index.js?persisted-queue=${Date.now()}`);
    await waitFor(() => chatMetadata.inner_lore.lastProcessedIndex === chat.length - 1);

    assert.equal(requestCount, 5, 'the complete 47-message queue should drain in bounded batches');
    assert.match(analyzedPrompts.join('\n'), /Freesia reports for duty/u);
    assert.match(analyzedPrompts.join('\n'), /Freesia completes reply 23/u);
    assert.equal(chatMetadata.inner_lore.assistantTurnsSincePass, 0);
    assert.ok(chatMetadata.inner_lore.brains.freesia, 'catch-up must create the missing NPC mind');
});

test('a fresh character greeting seeds its first NPC mind automatically', async () => {
    const listeners = new Map();
    const chat = [{
        is_user: false,
        is_system: false,
        name: 'Your squire',
        mes: 'Freesia arrives at the house, anxious to prove that she deserves the post.',
    }];
    const chatMetadata = {};
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
            autoRebuildOnHistoryChange: true,
            autoRebuildMessageLimit: 120,
        },
    };
    let analyzedPrompt = '';
    const events = {
        MESSAGE_RECEIVED: 'message_received',
        GENERATION_STARTED: 'generation_started',
        GENERATION_ENDED: 'generation_ended',
        CHAT_CHANGED: 'chat_changed',
        MESSAGE_EDITED: 'message_edited',
        MESSAGE_SWIPED: 'message_swiped',
        MESSAGE_DELETED: 'message_deleted',
    };
    const context = {
        extensionSettings,
        chatMetadata,
        chat,
        chatId: 'fresh-greeting-chat',
        name1: 'Jet',
        name2: 'Your squire',
        getCurrentChatId: () => 'fresh-greeting-chat',
        getCharacterCardFields: () => ({ description: 'Freesia is an anxious young squire.' }),
        saveSettingsDebounced: () => {},
        saveMetadata: async () => {},
        saveMetadataDebounced: () => {},
        setExtensionPrompt: () => {},
        renderExtensionTemplateAsync: async () => '',
        eventSource: { on: (event, callback) => listeners.set(event, callback) },
        eventTypes: events,
        SlashCommandParser: null,
        SlashCommand: null,
        ConnectionManagerRequestService: {
            getSupportedProfiles: () => extensionSettings.connectionManager.profiles,
            sendRequest: async (_profileId, messages) => {
                analyzedPrompt = messages.map(message => message.content).join('\n');
                return {
                    content: JSON.stringify({
                        entities: [],
                        minds: [{
                            character: 'Freesia',
                            set: [{
                                key: 'prove_herself',
                                category: 'desire',
                                thought: 'I need to prove I deserve this post.',
                                confidence: 'confirmed',
                                retention: 'durable',
                            }],
                        }],
                    }),
                };
            },
        },
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

    await import(`../index.js?fresh-greeting=${Date.now()}`);
    await waitFor(() => Boolean(chatMetadata.inner_lore?.brains?.freesia));
    assert.match(analyzedPrompt, /Freesia arrives at the house/u);
    assert.equal(chatMetadata.inner_lore.lastProcessedIndex, 0);
    assert.equal(
        chatMetadata.inner_lore.brains.freesia.durableCandidates.prove_herself.statement,
        'I need to prove I deserve this post.',
        'a single story greeting seeds the brain without prematurely hardening one observation into personality canon',
    );
});
