import assert from 'node:assert/strict';
import test from 'node:test';

import {
    createEmptyStore,
    mergeEntityOperations,
    mergeMindOperations,
    messageFingerprint,
} from '../core.js';
import { applyProgressionPatch, createProgressionState } from '../progression.js';
import { upsertTriggerEventDefinition } from '../trigger-events.js';
import { installMockInnerLoreStorage } from './mock-storage-server.mjs';

installMockInnerLoreStorage();

const waitFor = async (predicate, timeout = 7_000) => {
    const started = Date.now();
    while (!predicate()) {
        if (Date.now() - started > timeout) throw new Error('Timed out waiting for mocked history rollback.');
        await new Promise(resolve => setTimeout(resolve, 20));
    }
};

function trackedFingerprints(chat) {
    return Object.fromEntries(chat.map((message, index) => [index, messageFingerprint(message)]));
}

function addEntity(store, type, name, messageIndex, options = {}) {
    mergeEntityOperations(store, [{
        type,
        name,
        importance: options.importance ?? 90,
        facts: options.facts || [`${name} is established in this branch.`],
    }], { messageIndex, minimumImportance: 0 });
    const record = store.entities[`${type}:${name.toLocaleLowerCase()}`];
    if (record) record.pinned = Boolean(options.pinned);
    return record;
}

function addBrain(store, name, messageIndex, options = {}) {
    mergeMindOperations(store, [{
        character: name,
        set: [{
            key: options.key || 'branch_memory',
            category: 'memory',
            thought: options.thought || `I remember ${name}'s branch.`,
            confidence: 'confirmed',
            retention: 'durable',
        }],
    }], {
        messageIndex,
        maximumOperations: 20,
        maximumThoughts: 30,
        maximumThoughtChanges: 30,
        maximumSceneThoughts: 10,
    });
    const brain = store.brains[name.toLocaleLowerCase()];
    if (brain) brain.pinned = Boolean(options.pinned);
    return brain;
}

function progressionPayload(prefix, elapsedSeconds) {
    return {
        time: {
            elapsed: {
                minimum_seconds: elapsedSeconds,
                estimated_seconds: elapsedSeconds,
                maximum_seconds: elapsedSeconds,
            },
            confidence: 1,
            basis: [`${prefix} completed exchange`],
            completed_actions: [`completed ${prefix}`],
        },
        goals: [{
            key: `${prefix}_goal`,
            owner: `${prefix} NPC`,
            title: `${prefix} goal`,
            status: 'active',
            evidence: [`${prefix} goal is established.`],
        }],
        processes: [{
            key: `${prefix}_process`,
            subject_type: 'location',
            subject_name: `${prefix} Place`,
            title: `${prefix} process`,
            status: 'active',
            evidence: [`${prefix} process is underway.`],
        }],
        events: [{
            key: `${prefix}_event`,
            title: `${prefix} event`,
            status: 'scheduled',
            due_in_seconds: {
                minimum_seconds: 60,
                estimated_seconds: 60,
                maximum_seconds: 60,
            },
            evidence: [`${prefix} event is scheduled.`],
        }],
    };
}

function managedEntry(uid, recordId, content = recordId) {
    return {
        uid,
        key: [recordId],
        comment: recordId,
        content,
        automationId: 'inner-lore-v1',
        extensions: {
            innerLore: {
                version: 1,
                managed: true,
                chatId: 'rollback-chat',
                recordId,
            },
        },
    };
}

function baseSettings(worldProgressionEnabled) {
    return {
        disabledExtensions: [],
        connectionManager: {
            selectedProfile: 'rollback-profile',
            profiles: [{ id: 'rollback-profile', name: 'Rollback Profile', model: 'mock/model' }],
        },
        inner_lore: {
            enabled: true,
            autoUpdate: true,
            autoRecoverIncomplete: false,
            innerSelfEnabled: true,
            autoLoreEnabled: true,
            worldProgressionEnabled,
            processEveryAssistantTurns: 1,
            maintenanceSchedulingVersion: 1,
            lookbackMessages: 10,
            connectionSource: 'profile',
            connectionProfileId: 'rollback-profile',
            progressionConnectionProfileId: 'rollback-profile',
            requestTimeoutSeconds: 15,
            progressionRequestTimeoutSeconds: 15,
            autoRebuildOnHistoryChange: true,
            autoRebuildMessageLimit: 120,
        },
    };
}

async function installHarness({
    chatId,
    chat,
    store,
    worldProgressionEnabled = false,
    lookbackMessages = 10,
    sendRequest,
}) {
    const listeners = new Map();
    const prompts = [];
    const worlds = new Map();
    const extensionSettings = baseSettings(worldProgressionEnabled);
    extensionSettings.inner_lore.lookbackMessages = lookbackMessages;
    const chatMetadata = { inner_lore: store };
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
        chatId,
        name1: 'Jet',
        name2: 'Narrator',
        getCurrentChatId: () => chatId,
        getCharacterCardFields: () => ({ description: 'A scenario-independent rollback test.' }),
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
            sendRequest,
        },
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

    await import(`../index.js?history-rollback=${chatId}-${Date.now()}-${Math.random()}`);
    await waitFor(() => listeners.size === 6);
    return { chatMetadata, context, events, extensionSettings, listeners, prompts, worlds };
}

test('swiping reconstructs every automatic subsystem and removes pinned discarded-branch records', async () => {
    const chatId = 'swipe-rollback-chat';
    const chat = [
        { is_user: true, is_system: false, name: 'Jet', mes: 'I choose a route.' },
        { is_user: false, is_system: false, name: 'Narrator', mes: 'The rejected route enters the Ash Vault.' },
    ];
    const store = createEmptyStore(chatId);
    const rejected = addEntity(store, 'location', 'Ash Vault', 1, { pinned: true });
    addBrain(store, 'Varek', 1, { pinned: true });
    const manual = addEntity(store, 'item', 'Manual Almanac', 1);
    manual.manualOverride = true;
    manual.manualContent = 'The Manual Almanac is user-authored canon.';
    store.lastProcessedIndex = 1;
    store.processedFingerprints = trackedFingerprints(chat);
    let rejectedProgression = createProgressionState();
    rejectedProgression = upsertTriggerEventDefinition(rejectedProgression, {
        id: 'trigger:branch_greeting',
        key: 'branch_greeting',
        title: 'A Branch Greeter Acts',
        enabled: true,
        actionCondition: 'A non-player character greets Jet.',
        actorScope: 'npc',
        activationVisibility: 'hidden',
        consequences: 'The greeter begins a private branch-specific plan.',
    }, { clock: rejectedProgression.clock, messageIndex: -1 }).state;
    const rejectedPayload = progressionPayload('rejected', 600);
    rejectedPayload.event_evaluations = [{
        key: 'branch_greeting',
        evaluated: true,
        reason: 'Varek completed the configured greeting.',
        trigger_action: {
            matched: true,
            actor: 'Varek',
            evidence: ['Varek greets Jet on the rejected route.'],
            message_indexes: [1],
        },
    }];
    store.progression = applyProgressionPatch(rejectedProgression, rejectedPayload, {
        messageIndex: 1,
        passageStartIndex: 0,
        playerName: 'Jet',
        autonomy: 'conservative',
    }).state;
    store.progression = upsertTriggerEventDefinition(store.progression, {
        id: 'trigger:branch_timer',
        key: 'branch_timer',
        title: 'A Relative Branch Timer',
        enabled: true,
        triggerAfterSeconds: 60,
        timeBasis: 'after_creation',
        activationVisibility: 'hidden',
    }, { clock: store.progression.clock, messageIndex: 1 }).state;
    store.progression.lastProcessedIndex = 1;
    store.progression.processedFingerprints = trackedFingerprints(chat);
    store.lorebookName = 'InnerLore - Rollback - swipe';
    rejected.entryUid = 0;
    manual.entryUid = 1;

    let curatorRequests = 0;
    let progressionRequests = 0;
    const harness = await installHarness({
        chatId,
        chat,
        store,
        worldProgressionEnabled: true,
        sendRequest: async (_profileId, messages) => {
            const joined = messages.map(message => message.content).join('\n');
            if (/World Progression Engine/u.test(joined)) {
                progressionRequests++;
                const selectedPayload = progressionPayload('selected', 30);
                selectedPayload.event_evaluations = [{
                    key: 'branch_greeting',
                    evaluated: true,
                    reason: 'Leora completed the configured greeting.',
                    trigger_action: {
                        matched: true,
                        actor: 'Leora',
                        evidence: ['Leora greets Jet in the Sun Court.'],
                        message_indexes: [1],
                    },
                }];
                return { content: JSON.stringify(selectedPayload) };
            }
            curatorRequests++;
            return {
                content: JSON.stringify({
                    entities: [{
                        type: 'location',
                        name: 'Sun Court',
                        importance: 95,
                        facts: ['The selected route enters the Sun Court.'],
                    }],
                    minds: [{
                        character: 'Leora',
                        set: [{
                            key: 'selected_memory',
                            category: 'memory',
                            thought: 'I remember the selected route.',
                            confidence: 'confirmed',
                        }],
                    }],
                }),
            };
        },
    });
    harness.worlds.set(store.lorebookName, {
        entries: {
            0: managedEntry(0, 'location:ash vault'),
            1: managedEntry(1, 'item:manual almanac', manual.manualContent),
            2: { uid: 2, content: 'User-owned World Info.', automationId: 'other-extension', extensions: {} },
        },
    });

    chat[1].mes = 'The selected route enters the Sun Court, where Leora greets Jet.';
    harness.listeners.get(harness.events.MESSAGE_SWIPED)(1);
    assert.equal(harness.chatMetadata.inner_lore.needsRebuild, true);
    const replacementContext = [...harness.prompts].reverse()
        .find(prompt => prompt.key === 'inner_lore_context')?.value || '';
    assert.doesNotMatch(replacementContext, /Ash Vault|Varek/u,
        'discarded automatic state must be absent from the reswipe prompt immediately');
    assert.ok(replacementContext.length > 0,
        'the replacement receives a conservative scene prefix instead of an empty extension prompt');

    await waitFor(() => (
        harness.chatMetadata.inner_lore.needsRebuild === false
        && harness.chatMetadata.inner_lore.progression?.clock?.estimatedSeconds === 30
    ));

    const rebuilt = harness.chatMetadata.inner_lore;
    assert.equal(rebuilt.entities['location:ash vault'], undefined, 'pinning must not preserve discarded automatic lore');
    assert.equal(rebuilt.brains.varek, undefined, 'pinning must not preserve a discarded automatic mind');
    assert.ok(rebuilt.entities['location:sun court']);
    assert.ok(rebuilt.brains.leora);
    assert.equal(rebuilt.entities['item:manual almanac'].manualOverride, true, 'explicit manual lore remains protected');
    assert.deepEqual(Object.keys(rebuilt.progression.goals), ['goal:selected_goal']);
    assert.deepEqual(Object.keys(rebuilt.progression.processes), ['process:selected_process']);
    assert.deepEqual(Object.keys(rebuilt.progression.events), ['event:selected_event']);
    assert.ok(rebuilt.progression.eventDefinitions['trigger:branch_greeting'], 'editor definitions must survive branch reconstruction');
    assert.equal(rebuilt.progression.eventRuntime['trigger:branch_greeting'].status, 'active');
    assert.deepEqual(rebuilt.progression.eventRuntime['trigger:branch_greeting'].triggerEvidence, [
        'Leora greets Jet in the Sun Court.',
    ], 'discarded-branch trigger evidence must be replaced by selected history');
    assert.equal(rebuilt.progression.eventDefinitions['trigger:branch_timer'].createdAtElapsedSeconds, 30,
        'a relative timer must re-anchor to the selected branch clock at its creation boundary');
    assert.equal(rebuilt.progression.eventRuntime['trigger:branch_timer'].status, 'armed');
    assert.equal(rebuilt.lastProcessedIndex, 1);
    assert.equal(rebuilt.progression.lastProcessedIndex, 1);
    assert.equal(rebuilt.processedFingerprints[1], messageFingerprint(chat[1]));
    assert.equal(curatorRequests, 1);
    assert.equal(progressionRequests, 1);

    const savedBook = harness.worlds.get(store.lorebookName);
    const managedIds = Object.values(savedBook.entries)
        .filter(entry => entry.automationId === 'inner-lore-v1')
        .map(entry => entry.extensions?.innerLore?.recordId)
        .sort();
    assert.deepEqual(managedIds, ['item:manual almanac', 'location:sun court']);
    assert.ok(Object.values(savedBook.entries).some(entry => entry.automationId === 'other-extension'));
});

test('deleting a reply rolls back its lore and leaves the player action pending for the replacement', async () => {
    const chatId = 'delete-replay-chat';
    const chat = [
        { is_user: true, is_system: false, name: 'Jet', mes: 'I enter the gallery.' },
        { is_user: false, is_system: false, name: 'Narrator', mes: 'Jet enters the quiet Marble Gallery.' },
        { is_user: true, is_system: false, name: 'Jet', mes: 'I turn the brass key in the eastern door.' },
        { is_user: false, is_system: false, name: 'Narrator', mes: 'The discarded reply reveals the Branch Crypt and Orin.' },
    ];
    const store = createEmptyStore(chatId);
    const branch = addEntity(store, 'location', 'Branch Crypt', 3, { pinned: true });
    addBrain(store, 'Orin', 3, { pinned: true });
    store.lastProcessedIndex = 3;
    store.processedFingerprints = trackedFingerprints(chat);
    store.progression = createProgressionState();
    store.progression.lastProcessedIndex = 3;
    store.lorebookName = 'InnerLore - Rollback - delete';
    branch.entryUid = 0;

    const curatorPrompts = [];
    const harness = await installHarness({
        chatId,
        chat,
        store,
        lookbackMessages: 1,
        sendRequest: async (_profileId, messages) => {
            const joined = messages.map(message => message.content).join('\n');
            curatorPrompts.push(joined);
            const replacement = joined.includes('The replacement reply opens the eastern door.');
            return {
                content: JSON.stringify(replacement ? {
                    entities: [{ type: 'item', name: 'Brass Key', importance: 85, facts: ['It opens the eastern door.'] }],
                    minds: [{
                        character: 'Mara',
                        set: [{ key: 'heard_door', category: 'memory', thought: 'I heard the eastern door open.', confidence: 'confirmed' }],
                    }],
                } : {
                    entities: [{ type: 'location', name: 'Marble Gallery', importance: 90, facts: ['It is quiet.'] }],
                    minds: [],
                }),
            };
        },
    });
    harness.worlds.set(store.lorebookName, {
        entries: {
            0: managedEntry(0, 'location:branch crypt'),
            1: { uid: 1, content: 'Unmanaged entry.', automationId: 'user', extensions: {} },
        },
    });

    chat.pop();
    harness.listeners.get(harness.events.MESSAGE_DELETED)(chat.length);
    await waitFor(() => (
        harness.chatMetadata.inner_lore.needsRebuild === false
        && harness.chatMetadata.inner_lore.lastProcessedIndex === 1
    ));

    const afterDelete = harness.chatMetadata.inner_lore;
    assert.equal(afterDelete.entities['location:branch crypt'], undefined);
    assert.equal(afterDelete.brains.orin, undefined);
    assert.ok(afterDelete.entities['location:marble gallery']);
    assert.equal(afterDelete.processedFingerprints[2], undefined, 'the unanswered player action must remain unprocessed');
    assert.equal(curatorPrompts.length, 1);
    assert.doesNotMatch(curatorPrompts[0], /brass key in the eastern door/u);
    assert.ok(!Object.values(harness.worlds.get(store.lorebookName).entries)
        .some(entry => entry.extensions?.innerLore?.recordId === 'location:branch crypt'));

    chat.push({
        is_user: false,
        is_system: false,
        name: 'Narrator',
        mes: 'The replacement reply opens the eastern door.',
    });
    harness.listeners.get(harness.events.MESSAGE_RECEIVED)(3);
    await waitFor(() => (
        harness.chatMetadata.inner_lore.lastProcessedIndex === 3
        && Boolean(harness.chatMetadata.inner_lore.entities['item:brass key'])
    ));

    assert.equal(curatorPrompts.length, 2);
    assert.match(curatorPrompts[1], /I turn the brass key in the eastern door/u);
    assert.match(curatorPrompts[1], /The replacement reply opens the eastern door/u);
    assert.ok(harness.chatMetadata.inner_lore.brains.mara);
    assert.equal(harness.chatMetadata.inner_lore.processedFingerprints[2], messageFingerprint(chat[2]));
    assert.equal(harness.chatMetadata.inner_lore.processedFingerprints[3], messageFingerprint(chat[3]));
});

test('deleting every message clears automatic state and managed lore without a model request', async () => {
    const chatId = 'empty-history-chat';
    const chat = [
        { is_user: true, is_system: false, name: 'Jet', mes: 'I enter the vanished room.' },
        { is_user: false, is_system: false, name: 'Narrator', mes: 'The Vanished Room and Neris appear.' },
    ];
    const store = createEmptyStore(chatId);
    const automatic = addEntity(store, 'location', 'Vanished Room', 1, { pinned: true });
    addBrain(store, 'Neris', 1, { pinned: true });
    const manual = addEntity(store, 'item', 'Manual Ledger', 1);
    manual.manualOverride = true;
    manual.manualContent = 'The Manual Ledger is explicitly maintained by the user.';
    store.lastProcessedIndex = 1;
    store.processedFingerprints = trackedFingerprints(chat);
    store.progression = applyProgressionPatch(createProgressionState(), progressionPayload('vanished', 900), {
        messageIndex: 1,
        autonomy: 'conservative',
    }).state;
    store.progression.lastProcessedIndex = 1;
    store.progression.processedFingerprints = trackedFingerprints(chat);
    store.lorebookName = 'InnerLore - Rollback - empty';
    automatic.entryUid = 0;
    manual.entryUid = 1;

    let requestCount = 0;
    const harness = await installHarness({
        chatId,
        chat,
        store,
        worldProgressionEnabled: true,
        sendRequest: async () => {
            requestCount++;
            return { content: '{}' };
        },
    });
    harness.worlds.set(store.lorebookName, {
        entries: {
            0: managedEntry(0, 'location:vanished room'),
            1: managedEntry(1, 'item:manual ledger', manual.manualContent),
            2: { uid: 2, content: 'User World Info.', automationId: 'user', extensions: {} },
        },
    });

    chat.splice(0, chat.length);
    harness.listeners.get(harness.events.MESSAGE_DELETED)(0);
    await waitFor(() => (
        harness.chatMetadata.inner_lore.needsRebuild === false
        && harness.chatMetadata.inner_lore.lastProcessedIndex === -1
    ));

    const rebuilt = harness.chatMetadata.inner_lore;
    assert.equal(requestCount, 0);
    assert.deepEqual(Object.keys(rebuilt.entities), ['item:manual ledger']);
    assert.deepEqual(Object.keys(rebuilt.brains), []);
    assert.equal(rebuilt.progression.clock.estimatedSeconds, 0);
    assert.deepEqual(Object.keys(rebuilt.progression.goals), []);
    assert.deepEqual(Object.keys(rebuilt.progression.processes), []);
    assert.deepEqual(Object.keys(rebuilt.progression.events), []);
    assert.deepEqual(rebuilt.processedFingerprints, {});
    assert.deepEqual(rebuilt.progression.processedFingerprints, {});

    const remainingEntries = Object.values(harness.worlds.get(store.lorebookName).entries);
    assert.ok(!remainingEntries.some(entry => entry.extensions?.innerLore?.recordId === 'location:vanished room'));
    assert.ok(remainingEntries.some(entry => entry.extensions?.innerLore?.recordId === 'item:manual ledger'));
    assert.ok(remainingEntries.some(entry => entry.automationId === 'user'));
});
