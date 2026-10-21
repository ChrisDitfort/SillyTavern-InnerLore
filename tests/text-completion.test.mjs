import assert from 'node:assert/strict';
import test from 'node:test';

import { createEmptyStore, normalizeBrainRecord, snapshotMessageRange } from '../core.js';
import { isTextCompletionApi, renderTextPacket, textPacketBudget } from '../text-packet.js';
import { installMockInnerLoreStorage } from './mock-storage-server.mjs';
import { createEventListeners } from './mock-event-source.mjs';

const waitFor = async (predicate, timeout = 4_000) => {
    const started = Date.now();
    while (!predicate()) {
        if (Date.now() - started > timeout) throw new Error('Timed out waiting for the text-completion packet.');
        await new Promise(resolve => setTimeout(resolve, 20));
    }
};

function harbourStore() {
    const store = createEmptyStore('text-chat');
    store.entities['character:marit'] = {
        id: 'character:marit', type: 'character', name: 'Marit', aliases: [], keys: ['Marit'], importance: 80,
        summary: 'Marit, the kerchiefed woman who keeps the bar at the Salt Lantern.', description: 'Broad-shouldered, a burn scar along one forearm.',
        currentState: 'Behind the bar with the ledger open.', facts: [], relationships: [], history: [], unresolved: [],
        enabled: true, status: 'active', firstSeenMessage: 0, lastSeenMessage: 1, revision: 1,
    };
    store.entities['location:salt lantern'] = {
        id: 'location:salt lantern', type: 'location', name: 'Salt Lantern', aliases: [], keys: ['Salt Lantern'], importance: 70,
        summary: 'A tall, narrow inn on Rope Street.', facts: [], relationships: [], history: [], unresolved: [],
        spatial: { invariants: { bar: { statement: 'The bar stands at the far end of the common room.' } } },
        enabled: true, status: 'active', firstSeenMessage: 0, lastSeenMessage: 1, revision: 1,
    };
    store.brains.marit = normalizeBrainRecord({
        id: 'marit', name: 'Marit', active: true, enabled: true,
        currentMind: { emotions: [{ name: 'wariness', intensity: 'high' }], immediateGoal: 'Bar the door on the hour.', innerThoughts: ['One more on a slate I called full.'], sourceMessage: 1 },
    });
    return store;
}

const GAME = `<inner_lore_game_state pov="Jet" compiled="true">
This is the game ledger: money, possessions, where tracked objects are, prices, and how people regard Jet. Keep the story consistent with it.
Purse: 2 shillings, 2 pence.
For sale here: a bowl of fish stew with bread 3 pence (Marit).
Prepared for Salt Lantern (narrator-only; bring these in when the scene calls for them, never all at once, and only as Jet would notice them): Hob Garrow (old sailor; wary).
</inner_lore_game_state>`;

test('a text-completion story gets lore entries and bracketed notes, not the chat packet', () => {
    assert.ok(isTextCompletionApi('novel'));
    assert.ok(isTextCompletionApi('textgenerationwebui'));
    assert.equal(isTextCompletionApi('openai'), false);
    assert.equal(textPacketBudget(8_000), 8_640);
    const store = harbourStore();
    const compilation = {
        camera: { where: 'Salt Lantern', within: 'Rope Street', time: 'Night, in the rain', withYou: [{ name: 'Marit' }], waysOn: [{ name: 'Rope Street' }, { relation: 'A hatch behind the bar opens into the kitchen.' }] },
        selectedBrains: [{ id: 'marit', name: 'Marit' }],
        selectedEntities: [{ id: 'location:salt lantern' }],
    };
    const { memory, note } = renderTextPacket({ compilation, store, playerName: 'Jet', gameText: GAME, budgetCharacters: 4_000 });
    assert.match(memory, /^----\nMarit: The kerchiefed woman who keeps the bar at the Salt Lantern\. Now: Behind the bar with the ledger open\. Feels: wariness \(high\)\. Wants: Bar the door on the hour\. Thinks: "One more on a slate I called full\."/u);
    assert.doesNotMatch(memory, /burn scar/u, 'the description only stands in for a missing summary');
    assert.match(memory, /----\nSalt Lantern: A tall, narrow inn on Rope Street\. The bar stands at the far end of the common room\./u);
    assert.deepEqual(note.split('\n'), [
        '[ Night, in the rain. Jet is at Salt Lantern, in Rope Street. With Jet: Marit. Ways on: Rope Street; A hatch behind the bar opens into the kitchen. ]',
        '[ Purse: 2 shillings, 2 pence. ]',
        '[ For sale here: a bowl of fish stew with bread 3 pence (Marit). ]',
        '[ Ready to bring in at Salt Lantern: Hob Garrow (old sailor; wary). ]',
        "[ Write what the world does next in answer to Jet. Jet's own words, thoughts and choices belong to the player. ]",
    ]);
    assert.doesNotMatch(`${memory}\n${note}`, /<inner_lore|game ledger/u);
    const tight = renderTextPacket({ compilation, store, playerName: 'Jet', gameText: GAME, budgetCharacters: 900 });
    assert.ok(tight.memory.length + tight.note.length <= 900);
    assert.match(tight.note, /Write what the world does next/u, 'the turn line always stays');
});

test('with NovelAI as the story API, InnerLore delivers its text packet and no chat contract', async t => {
    const mock = installMockInnerLoreStorage();
    t.after(() => mock.restore());
    const listeners = createEventListeners();
    const prompts = new Map();
    const macros = new Map();
    const chat = [
        { is_user: false, is_system: false, name: 'Harbour Tales', mes: 'Marit counts coins behind the bar of the Salt Lantern.' },
        { is_user: true, is_system: false, name: 'Jet', mes: 'I ask Marit what a bed costs.' },
    ];
    const store = harbourStore();
    store.lastProcessedIndex = 1;
    store.processedFingerprints = snapshotMessageRange(chat, 0, 1);
    const extensionSettings = {
        disabledExtensions: [],
        connectionManager: { selectedProfile: '', profiles: [] },
        inner_lore: {
            gameEnabled: false, enabled: true, autoUpdate: false, innerSelfEnabled: true, autoLoreEnabled: true,
            worldProgressionEnabled: false, contextDeliveryMode: 'macro', contextProfileId: 'balanced',
            serverContextTimeoutMs: 1_200, autoRebuildOnHistoryChange: false, portraitsEnabled: false,
        },
    };
    const events = {
        MESSAGE_RECEIVED: 'message_received', MESSAGE_SENT: 'message_sent', GENERATION_STARTED: 'generation_started',
        CHAT_CHANGED: 'chat_changed', MESSAGE_EDITED: 'message_edited', MESSAGE_SWIPED: 'message_swiped',
        MESSAGE_DELETED: 'message_deleted', GENERATE_AFTER_COMBINE_PROMPTS: 'generate_after_combine_prompts',
    };
    const context = {
        extensionSettings, chatMetadata: { inner_lore: store }, chat, chatId: 'text-chat', name1: 'Jet', name2: 'Harbour Tales',
        mainApi: 'novel', maxContext: 8_000,
        powerUserSettings: { context: { story_string: '{{#if anchorAfter}}{{anchorAfter}}\n{{/if}}{{#if description}}{{description}}\n{{/if}}' } },
        getCurrentChatId: () => 'text-chat', getCharacterCardFields: () => ({}), getWorldInfoNames: () => [],
        saveSettingsDebounced: () => {}, saveMetadata: async () => {}, saveMetadataDebounced: () => {},
        setExtensionPrompt: (key, prompt, position) => prompts.set(key, { prompt, position }),
        registerMacro: (name, handler) => macros.set(name, handler),
        renderExtensionTemplateAsync: async () => '',
        eventSource: { on: listeners.on }, eventTypes: events,
        SlashCommandParser: null, SlashCommand: null, ConnectionManagerRequestService: null,
    };
    globalThis.document = { activeElement: null, getElementById: () => null, querySelectorAll: () => [] };
    globalThis.$ = () => ({ append: () => {} });
    globalThis.toastr = { error: () => {}, warning: () => {}, success: () => {}, info: () => {} };
    globalThis.confirm = () => true;
    globalThis.SillyTavern = { getContext: () => context };

    await import(`../index.js?text-completion=${Date.now()}`);
    await waitFor(() => (prompts.get('inner_lore_text_memory')?.prompt || '').includes('----'));

    const memory = prompts.get('inner_lore_text_memory');
    assert.equal(memory.position, 0, 'memory sits in the prompt, after the story string');
    assert.match(memory.prompt, /----\nMarit: .*Wants: Bar the door on the hour\./u);
    const note = macros.get('innerlore_state_context')();
    assert.match(note, /^\[ /u);
    assert.match(note, /Write what the world does next in answer to Jet\./u);
    assert.doesNotMatch(note, /<inner_lore|inner_lore_history/u);
    assert.equal(prompts.get('inner_lore_latest_turn_contract')?.prompt || '', '');

    // A customised story string without {{anchorAfter}} drops in-prompt
    // extension prompts, so the memory then travels with the note.
    context.powerUserSettings.context.story_string = '[ S: 2 ]\n***\n{{#if system}}{{system}}{{/if}}';
    await listeners.get('generation_started')('normal', {}, false);
    const combined = macros.get('innerlore_state_context')();
    assert.match(combined, /^----\nMarit: /u);
    assert.match(combined, /\n\[ .*\]$/su);
    assert.equal(prompts.get('inner_lore_text_memory')?.prompt || '', '');

    // The text-completion prompt hook lets the story depart like a chat story.
    await listeners.get('generation_started')('normal', {}, false);
    const data = { prompt: `Story\n${combined}\nHarbour Tales:`, dryRun: false };
    await listeners.get('generate_after_combine_prompts')(data);
    assert.match(data.prompt, /Write what the world does next/u);
});
