import assert from 'node:assert/strict';
import test from 'node:test';

import { createEmptyStore, mergeEntityOperations } from '../core.js?v=48';
import { installMockInnerLoreStorage } from './mock-storage-server.mjs';

const storage = installMockInnerLoreStorage();

// Stores a world as if an earlier session had committed it, and returns the
// chat-metadata pointer to it.
function plantWorld(store) {
    const worldId = `innerlore-test-${store.chatId}`;
    const now = new Date().toISOString();
    storage.worlds.set(worldId, {
        world_id: worldId,
        name: worldId,
        metadata: {},
        contextProfiles: new Map(),
        innerLore: {
            worldId,
            chatId: store.chatId,
            storeVersion: store.version || 0,
            expressionFoundationVersion: store.expressionFoundationVersion || 0,
            revision: 1,
            snapshotHash: 'mock-1',
            createdAt: now,
            updatedAt: now,
            store: structuredClone(store),
            branch: { id: 'main' },
            scene: {},
        },
    });
    return { backend: 'airpg-storage', pointerVersion: 1, worldId, chatId: store.chatId, revision: 1, snapshotHash: 'mock-1' };
}

const waitFor = async (predicate, timeout = 8_000, label = 'mocked game state') => {
    const started = Date.now();
    while (!predicate()) {
        if (Date.now() - started > timeout) throw new Error(`Timed out waiting for ${label}.`);
        await new Promise(resolve => setTimeout(resolve, 20));
    }
};

const LEDGER_FIRST = `INNERLORE GAME 1
OBJECT tallow_candle
op = add
name = tallow candle
kind = tool
holder = player
value = 2
evidence = Mara hands Jet a tallow candle.
END
MONEY
from = player
to = Mara
amount = 2
reason = a tallow candle
evidence = Mara takes the two coins.
END
DONE`;

const PLANNER_FIRST = `INNERLORE PLANNER 1
CURRENCY
name = coin
ITEM units
name = coin
plural = coins
value = 1
END
END
PURSE
set = 10
END
STAGE Salt Lantern
summary = A wet evening; the common room is half full.
hooks += A stranger asks after the lighthouse keeper.
END
PERSON Old Fen
location = Salt Lantern
role = net-mender
manner = gruff
wants = a dry seat by the fire
standing = 4
END
OBJECT clasp_knife
name = clasp knife
kind = tool
holder = player
value = 6
END
DONE`;

const LEDGER_SECOND = `INNERLORE GAME 1
STANDING Old Fen
delta = 3
reason = Jet gave up the seat by the fire for him.
evidence = Old Fen grunts his thanks.
END
DONE`;

test('the ledger, planner and curator run together and the game reaches the narrator', async () => {
    const listeners = new Map();
    const chat = [
        { is_user: false, is_system: false, name: 'Narrator', mes: 'Rain drums on the Salt Lantern\'s shutters. Mara Quell wipes the bar.' },
    ];
    const store = createEmptyStore('game-integration');
    mergeEntityOperations(store, [
        { type: 'location', name: 'Salt Lantern', importance: 80, summary: 'A harbour inn.' },
        { type: 'character', name: 'Mara Quell', importance: 70, summary: 'The innkeeper.', current_location: 'Salt Lantern' },
    ], { messageIndex: 0, maximumOperations: 20 });
    const chatMetadata = { inner_lore: plantWorld(store) };
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
            worldProgressionEnabled: false,
            processEveryAssistantTurns: 1,
            maintenanceSchedulingVersion: 1,
            lookbackMessages: 10,
            connectionSource: 'profile',
            connectionProfileId: 'mock-profile',
            requestTimeoutSeconds: 15,
            autoRebuildOnHistoryChange: true,
            autoRebuildMessageLimit: 120,
            parallelBackgroundPasses: true,
            scenePlannerPrefetch: false,
        },
    };

    // Requests are held until the test answers them, so it can see which
    // passes are on the provider at the same time.
    const pending = [];
    const kinds = [];
    const kindOf = messages => {
        const text = messages.map(message => message.content).join('\n');
        if (/Game Ledger/u.test(text)) return 'ledger';
        if (/Scene Planner/u.test(text)) return 'planner';
        return 'curator';
    };
    const requestService = {
        getSupportedProfiles: () => extensionSettings.connectionManager.profiles,
        sendRequest: (_profileId, messages) => new Promise(resolve => {
            const kind = kindOf(messages);
            kinds.push(kind);
            pending.push({ kind, prompt: messages.map(message => message.content).join('\n'), answer: content => resolve({ content }) });
        }),
    };
    const prompts = new Map();
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
    };
    const worlds = new Map();
    const context = {
        extensionSettings,
        chatMetadata,
        chat,
        chatId: 'game-integration',
        name1: 'Jet',
        name2: 'Narrator',
        maxContext: 32_000,
        getCurrentChatId: () => 'game-integration',
        getCharacterCardFields: () => ({ description: 'A harbour town in the rain.' }),
        saveSettingsDebounced: () => {},
        saveMetadata: async () => {},
        saveMetadataDebounced: () => {},
        setExtensionPrompt: (key, value) => prompts.set(key, value),
        renderExtensionTemplateAsync: async () => '',
        eventSource: { on: (event, callback) => listeners.set(event, [...(listeners.get(event) || []), callback]) },
        eventTypes: events,
        SlashCommandParser: null,
        SlashCommand: null,
        ConnectionManagerRequestService: requestService,
        loadWorldInfo: async name => worlds.get(name) || null,
        saveWorldInfo: async (name, data) => worlds.set(name, structuredClone(data)),
        updateWorldInfoList: async () => {},
    };
    globalThis.document = { activeElement: null, getElementById: () => null, querySelectorAll: () => [] };
    globalThis.$ = () => ({ append: () => {} });
    globalThis.toastr = { error: () => {}, warning: () => {}, success: () => {} };
    globalThis.confirm = () => true;
    globalThis.SillyTavern = { getContext: () => context };

    await import(`../index.js?game-integration=${Date.now()}`);
    await waitFor(() => listeners.has(events.CHAT_COMPLETION_PROMPT_READY), 8_000, 'event registration');
    const emit = (event, ...args) => Promise.all((listeners.get(event) || []).map(callback => callback(...args)));

    // Opening the chat: the curator and ledger read the greeting while the
    // planner prepares the opening scene and the starting kit, all at once
    // and before the first turn.
    await waitFor(() => pending.length === 3, 8_000, 'the opening passes').catch(error => {
        throw new Error(`${error.message} Seen: ${kinds.join(', ')}`);
    });
    assert.deepEqual(pending.map(request => request.kind).sort(), ['curator', 'ledger', 'planner'], 'the opening passes leave together');
    const planner = pending.find(request => request.kind === 'planner');
    assert.match(planner.prompt, /STARTING_KIT_NEEDED is true/u);
    assert.match(planner.prompt, /"name":"Salt Lantern","why":"the player is here"/u);
    for (const request of pending.splice(0)) {
        request.answer({ curator: '{"entities":[],"minds":[]}', ledger: 'INNERLORE GAME 1\nDONE', planner: PLANNER_FIRST }[request.kind]);
    }
    await waitFor(() => chatMetadata.inner_lore.game?.planner?.kitOffered === true, 8_000, 'the opening planner commit');
    let game = chatMetadata.inner_lore.game;
    assert.equal(game.purse.amount, 10, 'the starting purse');
    assert.equal(game.stages.salt_lantern.people[0].name, 'Old Fen');

    // The first reply: a purchase.
    chat.push(
        { is_user: true, is_system: false, name: 'Jet', mes: 'I buy a candle from Mara.' },
        { is_user: false, is_system: false, name: 'Narrator', mes: 'Mara takes the two coins and hands Jet a tallow candle.' },
    );
    emit(events.MESSAGE_RECEIVED, 2);
    await waitFor(() => pending.length === 2, 8_000, 'the curator and ledger together').catch(error => {
        throw new Error(`${error.message} Seen: ${kinds.join(', ')}`);
    });
    assert.deepEqual(pending.map(request => request.kind).sort(), ['curator', 'ledger'], 'a fresh stage is not prepared again');
    const ledger = pending.find(request => request.kind === 'ledger');
    assert.match(ledger.prompt, /First line exactly: INNERLORE GAME 1/u);
    assert.match(ledger.prompt, /Mara takes the two coins/u);
    assert.match(ledger.prompt, /"player_items":\[\{"key":"clasp_knife"/u, 'the ledger sees the kit');
    for (const request of pending.splice(0)) request.answer(request.kind === 'ledger' ? LEDGER_FIRST : '{"entities":[],"minds":[]}');
    await waitFor(() => chatMetadata.inner_lore.game?.lastProcessedIndex === 2, 8_000, 'the first ledger commit');
    game = chatMetadata.inner_lore.game;
    assert.equal(game.purse.amount, 8, 'the kit purse less the candle');
    assert.deepEqual(Object.values(game.items).filter(item => item.holder.kind === 'player').map(item => item.name).sort(), ['clasp knife', 'tallow candle']);
    assert.equal(game.journal.find(entry => entry.op.type === 'money').op.to.name, 'Mara Quell');
    await waitFor(() => /<inner_lore_game_state/u.test(prompts.get('inner_lore_context') || ''), 8_000, 'the game block in the packet');
    const packet = prompts.get('inner_lore_context');
    assert.match(packet, /Purse: 8 coins\./u);
    assert.match(packet, /Carrying: (tallow candle|clasp knife).*; (tallow candle|clasp knife)/u);
    assert.match(packet, /Prepared for Salt Lantern \(narrator-only/u);
    assert.match(packet, /Old Fen \(net-mender; gruff; wants a dry seat by the fire; regards Jet: neutral \(\+4\)\)/u);

    // The narrator brings in the planner's net-mender.
    chat.push(
        { is_user: true, is_system: false, name: 'Jet', mes: 'I offer the old man my seat by the fire.' },
        { is_user: false, is_system: false, name: 'Narrator', mes: 'Old Fen grunts his thanks and lowers himself onto the bench.' },
    );
    emit(events.MESSAGE_RECEIVED, 4);
    await waitFor(() => pending.length === 2, 8_000, 'the second curator and ledger passes').catch(error => {
        throw new Error(`${error.message} Seen: ${kinds.join(', ')}`);
    });
    assert.deepEqual(pending.map(request => request.kind).sort(), ['curator', 'ledger'], 'a fresh stage is not planned again');
    for (const request of pending.splice(0)) {
        request.answer(request.kind === 'ledger' ? LEDGER_SECOND : '{"entities":[],"minds":[]}');
    }
    await waitFor(() => chatMetadata.inner_lore.game?.lastProcessedIndex === 4, 8_000, 'the second ledger commit');
    game = chatMetadata.inner_lore.game;
    assert.equal(game.stages.salt_lantern.people[0].introduced, true);
    assert.equal(game.standings['old fen'].score, 7, 'his first impression plus the kindness');
    await waitFor(() => !/Old Fen \(net-mender/u.test(prompts.get('inner_lore_context') || ''), 8_000, 'Old Fen leaving the prepared list');
    assert.match(prompts.get('inner_lore_context'), /Recent changes:.*Old Fen \+3/u);

    // Heading somewhere new: the planner prepares it before the story arrives,
    // and the prompt that leaves after the wait carries the fresh stage.
    chat.push({ is_user: true, is_system: false, name: 'Jet', mes: 'I head down to the Old Quay.' });
    await emit(events.GENERATION_STARTED, 'normal', {}, false);
    emit(events.MESSAGE_SENT, chat.length - 1);
    await waitFor(() => pending.length === 1 && pending[0].kind === 'planner', 8_000, 'the destination planner').catch(error => {
        throw new Error(`${error.message} Seen: ${kinds.join(', ')}`);
    });
    assert.match(pending[0].prompt, /"why":"the player is heading here now"/u);
    assert.match(pending[0].prompt, /I head down to the Old Quay\./u);
    const stale = prompts.get('inner_lore_context');
    const story = { chat: [{ role: 'system', content: 'Narrate.' }, { role: 'system', content: stale }, { role: 'user', content: 'I head down to the Old Quay.' }] };
    const departed = emit(events.CHAT_COMPLETION_PROMPT_READY, story);
    await new Promise(resolve => setTimeout(resolve, 300));
    pending.splice(0)[0].answer(`INNERLORE PLANNER 1
STAGE Old Quay
summary = The herring boats are unloading in the drizzle.
END
PERSON Wenna Saltash
location = Old Quay
role = fish-seller
manner = loud and quick to laugh
standing = 2
END
DONE`);
    await departed;
    assert.match(story.chat[1].content, /Prepared for Old Quay/u, 'the story left with the destination prepared');
    assert.match(story.chat[1].content, /Wenna Saltash \(fish-seller/u);
    assert.equal(chatMetadata.inner_lore.game.planner.lastRunStats.atSend, true);
    await emit(events.GENERATION_ENDED);
});
