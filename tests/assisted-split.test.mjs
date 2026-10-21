import assert from 'node:assert/strict';
import test from 'node:test';

import { createEmptyStore, mergeEntityOperations } from '../core.js?v=48';
import { amountMentions, groundedRecords, normalizeCurrency, objectsNamedIn, createGameState, applyGameOperations } from '../game.js?v=2';
import { buildLedgerMessages } from '../game-prompts.js?v=2';
import { parseInnerLoreOutput } from '../output-codec.js?v=3';
import { modelSizeBillions } from '../llm-client.js?v=16';
import { installMockInnerLoreStorage } from './mock-storage-server.mjs';

const storage = installMockInnerLoreStorage();
const waitFor = async (predicate, timeout = 8_000, label = 'the passes') => {
    const started = Date.now();
    while (!predicate()) {
        if (Date.now() - started > timeout) throw new Error(`Timed out waiting for ${label}.`);
        await new Promise(resolve => setTimeout(resolve, 20));
    }
};

test('InnerLore finds the amounts, tracked objects and evidence a smaller ledger model needs', () => {
    const currency = normalizeCurrency({ name: 'coin', units: [{ name: 'shilling', plural: 'shillings', value: 12 }, { name: 'penny', plural: 'pence', value: 1 }] });
    assert.deepEqual(amountMentions('The back room is a shilling and six; a bed, eight pence; a pint, tuppence.', currency).map(item => `${item.text}=${item.amount}`),
        ['a shilling and six=18', 'eight pence=8', 'tuppence=2']);
    let state = createGameState();
    state = applyGameOperations(state, [{ type: 'item.add', key: 'room_key', name: 'room key', kind: 'key', quantity: 1, holder: { kind: 'character', name: 'Marit' } }], { messageIndex: 1, source: 'ledger' }).state;
    assert.deepEqual(objectsNamedIn(state, 'Marit drops the key in your palm.').map(item => `${item.name}/${item.holder}`), ['room key/Marit']);
    const { payload, dropped } = groundedRecords({
        objects: [{ key: 'room_key', op: 'give', to: 'player', evidence: 'Marit drops the key in your palm' }],
        standings: [{ character: 'Marit', delta: 2, evidence: 'Marit smiles warmly at you' }],
        prices: [{ key: 'bed', price: 8 }],
    }, 'Marit drops the key in your palm.');
    assert.equal(payload.objects.length, 1);
    assert.equal(payload.standings.length, 0, 'evidence not in the passage is dropped');
    assert.equal(payload.prices.length, 1, 'prices carry no evidence and stay');
    assert.equal(dropped[0].list, 'standings');
    assert.equal(modelSizeBillions('coder3101/gemma-4-31B-it-heretic'), 31);
    assert.equal(modelSizeBillions('glm-4-6'), Infinity);
});

test('the assisted ledger prompt carries the hints and asks for the events first; an answer that lists them still parses', () => {
    const store = createEmptyStore('hints');
    const transcript = '[message 1; PLAYER — Jet]\nI buy a candle.\n\n[message 2; STORY]\nMara takes the two coins and hands you a tallow candle.';
    const plain = buildLedgerMessages({ game: createGameState(), store, playerName: 'Jet', transcript, scene: { participants: [{ name: 'Mara Quell' }] } });
    const assisted = buildLedgerMessages({ game: createGameState(), store, playerName: 'Jet', transcript, scene: { participants: [{ name: 'Mara Quell' }] }, assisted: true });
    assert.doesNotMatch(plain[1].content, /<HINTS>|EVENTS/u);
    assert.match(assisted[1].content, /Custody phrases: …[^|]*hands you a tallow candle/u);
    assert.match(assisted[1].content, /<HINTS>[\s\S]*"two coins" = 2 coins[\s\S]*People present: Mara Quell\.[\s\S]*<\/HINTS>/u);
    assert.match(assisted[1].content, /First a list headed EVENTS/u);
    assert.match(plain[1].content, /"a shilling and six" is 1 shilling 6 pence/u, 'the old-money rule is for every model');
    const parsed = parseInnerLoreOutput(`EVENTS:\n- Jet pays Mara two coins for a candle.\n\nINNERLORE GAME 1\nMONEY\nfrom = player\nto = Mara Quell\namount = 2\nevidence = Mara takes the two coins\nEND\nDONE`, { format: 'dsl', task: 'game', salvageTruncated: true });
    assert.equal(parsed.money[0].amount, 2);
});

test('a minds profile splits the curator into two requests side by side; the assisted ledger drops ungrounded records', async () => {
    const listeners = new Map();
    const chat = [{ is_user: false, is_system: false, name: 'Narrator', mes: 'Rain drums on the Salt Lantern\'s shutters. Mara Quell wipes the bar.' }];
    const store = createEmptyStore('split-curator');
    mergeEntityOperations(store, [
        { type: 'location', name: 'Salt Lantern', importance: 80, summary: 'A harbour inn.' },
        { type: 'character', name: 'Mara Quell', importance: 70, summary: 'The innkeeper.', current_location: 'Salt Lantern' },
    ], { messageIndex: 0, maximumOperations: 20 });
    const worldId = 'innerlore-test-split-curator';
    storage.worlds.set(worldId, { world_id: worldId, name: worldId, metadata: {}, contextProfiles: new Map(), innerLore: { worldId, chatId: store.chatId, storeVersion: store.version || 0, revision: 1, snapshotHash: 'mock-1', createdAt: '', updatedAt: '', store: structuredClone(store), branch: { id: 'main' }, scene: {} } });
    const chatMetadata = { inner_lore: { backend: 'airpg-storage', pointerVersion: 1, worldId, chatId: store.chatId, revision: 1, snapshotHash: 'mock-1' } };
    const profiles = [
        { id: 'glm', name: 'GLM 4.6 Novel AI', api: 'custom', 'api-url': 'http://127.0.0.1:9/glm', model: 'glm-4-6' },
        { id: 'gemma', name: 'Featherless Gemma', api: 'custom', 'api-url': 'http://127.0.0.1:9/gemma', model: 'coder3101/gemma-4-31B-it-heretic' },
    ];
    const extensionSettings = {
        disabledExtensions: [],
        connectionManager: { selectedProfile: 'glm', profiles },
        inner_lore: {
            enabled: true, autoUpdate: true, innerSelfEnabled: true, autoLoreEnabled: true, worldProgressionEnabled: false,
            processEveryAssistantTurns: 1, maintenanceSchedulingVersion: 1, lookbackMessages: 10,
            connectionSource: 'profile', connectionProfileId: 'glm', mindsConnectionProfileId: 'gemma', gameConnectionProfileId: 'gemma',
            requestTimeoutSeconds: 15, autoRebuildOnHistoryChange: true, autoRebuildMessageLimit: 120, parallelBackgroundPasses: true,
            scenePlannerEnabled: false, portraitsEnabled: false, assistedBackground: 'auto',
        },
    };
    const pending = [];
    const kindOf = messages => {
        const text = messages.map(message => message.content).join('\n');
        if (/Game Ledger/u.test(text)) return 'ledger';
        if (/Inner-self updates enabled: false/u.test(text)) return 'entities';
        if (/Automatic lore updates enabled: false/u.test(text)) return 'minds';
        return 'curator';
    };
    const context = {
        extensionSettings, chatMetadata, chat, chatId: 'split-curator', name1: 'Jet', name2: 'Narrator', maxContext: 32_000,
        getCurrentChatId: () => 'split-curator', getCharacterCardFields: () => ({ description: 'A harbour town in the rain.' }),
        saveSettingsDebounced: () => {}, saveMetadata: async () => {}, saveMetadataDebounced: () => {},
        setExtensionPrompt: () => {}, renderExtensionTemplateAsync: async () => '',
        eventSource: { on: (event, callback) => listeners.set(event, [...(listeners.get(event) || []), callback]) },
        eventTypes: { MESSAGE_RECEIVED: 'message_received', MESSAGE_SENT: 'message_sent', GENERATION_STARTED: 'generation_started', GENERATION_ENDED: 'generation_ended', CHAT_COMPLETION_PROMPT_READY: 'chat_completion_prompt_ready', CHAT_CHANGED: 'chat_changed', MESSAGE_EDITED: 'message_edited', MESSAGE_SWIPED: 'message_swiped', MESSAGE_DELETED: 'message_deleted' },
        SlashCommandParser: null, SlashCommand: null,
        ConnectionManagerRequestService: {
            getSupportedProfiles: () => profiles,
            sendRequest: (profileId, messages) => new Promise(resolve => pending.push({ profileId, kind: kindOf(messages), prompt: messages.map(m => m.content).join('\n'), answer: content => resolve({ content }) })),
        },
        loadWorldInfo: async () => null, saveWorldInfo: async () => {}, updateWorldInfoList: async () => {},
    };
    globalThis.document = { activeElement: null, getElementById: () => null, querySelectorAll: () => [] };
    globalThis.$ = () => ({ append: () => {} });
    globalThis.toastr = { error: () => {}, warning: () => {}, success: () => {} };
    globalThis.confirm = () => true;
    globalThis.SillyTavern = { getContext: () => context };
    await import(`../index.js?assisted-split=${Date.now()}`);
    await waitFor(() => listeners.has('chat_completion_prompt_ready'), 8_000, 'event registration');
    const emit = (event, ...args) => Promise.all((listeners.get(event) || []).map(callback => callback(...args)));

    // The opening: entities on the curator profile, minds on the minds profile, the ledger, all at once.
    await waitFor(() => pending.length === 3, 8_000, 'the opening passes').catch(error => { throw new Error(`${error.message} Seen: ${pending.map(p => p.kind).join(', ')}`); });
    assert.deepEqual(pending.map(request => `${request.kind}@${request.profileId}`).sort(), ['entities@glm', 'ledger@gemma', 'minds@gemma']);
    for (const request of pending.splice(0)) request.answer(request.kind === 'ledger' ? 'INNERLORE GAME 1\nDONE' : '{"entities":[],"minds":[]}');
    await waitFor(() => chatMetadata.inner_lore.lastProcessedIndex === 0 || chatMetadata.inner_lore.store?.lastProcessedIndex === 0 || storage.worlds.get(worldId)?.innerLore?.store?.lastProcessedIndex === 0, 8_000, 'the opening commit');

    chat.push(
        { is_user: true, is_system: false, name: 'Jet', mes: 'I buy a candle from Mara.' },
        { is_user: false, is_system: false, name: 'Narrator', mes: 'Mara takes the two coins and hands Jet a tallow candle.' },
    );
    emit('message_received', 2);
    await waitFor(() => pending.length === 3, 8_000, 'the reply passes');
    const ledger = pending.find(request => request.kind === 'ledger');
    assert.match(ledger.prompt, /<HINTS>[\s\S]*"two coins"/u, 'Gemma (31B) gets the assisted ledger');
    for (const request of pending.splice(0)) {
        request.answer({
            entities: '{"entities":[{"type":"item","name":"tallow candle","importance":40,"summary":"A cheap candle Jet bought at the Salt Lantern."}],"minds":[]}',
            minds: '{"entities":[],"minds":[{"character":"Mara Quell","current_mind":{"perception":"A stranger paying in honest coin.","immediate_goal":"Close up before the storm worsens."}}]}',
            ledger: 'EVENTS:\n- Jet pays Mara two coins for a candle.\n\nINNERLORE GAME 1\nOBJECT tallow_candle\nop = add\nname = tallow candle\nkind = tool\nholder = player\nevidence = hands Jet a tallow candle\nEND\nMONEY\nfrom = player\nto = Mara Quell\namount = 2\nreason = a candle\nevidence = Mara takes the two coins\nEND\nSTANDING Mara Quell\ndelta = 5\nreason = Jet was polite\nevidence = Mara beams and thanks Jet warmly for the custom\nEND\nDONE',
        }[request.kind]);
    }
    const committed = () => storage.worlds.get(worldId)?.innerLore?.store;
    await waitFor(() => committed()?.game?.lastProcessedIndex === 2 && committed()?.lastProcessedIndex === 2, 8_000, 'the reply commit');
    const saved = committed();
    assert.ok(Object.values(saved.entities).some(entity => entity.name === 'tallow candle'), 'the entities half merged');
    assert.match(Object.values(saved.brains).find(brain => brain.name === 'Mara Quell')?.currentMind?.immediateGoal || '', /Close up/u, 'the minds half merged');
    assert.ok(Object.values(saved.game.items).some(item => item.name === 'tallow candle' && item.holder.kind === 'player'));
    assert.equal(saved.game.standings?.['mara quell'], undefined, 'the regard change with invented evidence was dropped');
    assert.equal(saved.lastRunStats.gameResult.ungrounded, 1);
});
