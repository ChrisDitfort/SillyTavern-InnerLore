import assert from 'node:assert/strict';
import test from 'node:test';

import {
    buildPromptInjection,
    createEmptyStore,
    entityId,
    messageFingerprint,
    mergeEntityOperations,
    mergeMindOperations,
    refreshMentionRecency,
    selectRelevantBrains,
    selectRelevantEntities,
    summaryceptionRecallText,
} from '../core.js';
import { syncLorebook } from '../lorebook.js';
import { buildAnalysisMessages, formatTranscript } from '../prompts.js';

const cast = [
    'Mara Venn',
    'Ivo Renn',
    'Serin Holt',
    'Nia Quill',
    'Torren Vale',
    'Lysa Marr',
    'Captain Orr',
    'Pell Dane',
    'Edda Frost',
    'Finch Arlow',
    'Yara Sol',
    'Bram Kest',
];

test('SummarySception ghosting preserves assistant identity and rebuild transcript content', () => {
    const assistant = { is_user: false, is_system: false, name: 'Narrator', mes: 'Mara left the Azure Key at Cinder Quay.' };
    const before = messageFingerprint(assistant);
    assistant.is_system = true;
    assistant.extra = { sc_ghosted: true };

    assert.equal(messageFingerprint(assistant), before, 'native /hide must not make an unchanged story message look edited');
    const transcript = formatTranscript([
        { is_user: true, name: 'Jet', mes: 'Wait by the quay.' },
        assistant,
        { is_user: false, is_system: true, mes: 'Actually hidden system text.' },
    ]);
    assert.match(transcript, /COMPRESSED STORY MEMORY/);
    assert.match(transcript, /Azure Key/);
    assert.doesNotMatch(transcript, /Actually hidden/);

    const manuallyHiddenUser = { is_user: true, is_system: false, mes: 'A visible player action.' };
    const visibleFingerprint = messageFingerprint(manuallyHiddenUser);
    manuallyHiddenUser.is_system = true;
    assert.notEqual(messageFingerprint(manuallyHiddenUser), visibleFingerprint, 'ordinary user hiding still counts as a history change');
});

test('locations and items retain stable records while custody, condition, and open threads evolve', () => {
    const store = createEmptyStore('long-world');
    mergeEntityOperations(store, [
        {
            type: 'location',
            name: 'Cinder Quay',
            aliases: ['the Quay'],
            importance: 92,
            facts: ['The tide bell is cracked.'],
            current_state: 'The quay is open; its eastern crane is intact.',
            unresolved: ['Who sabotaged the tide bell?'],
        },
        {
            type: 'item',
            name: 'Azure Key',
            aliases: ['blue key'],
            importance: 95,
            facts: ['Mara Venn carries the Azure Key.', 'The key opens Northwatch Vault.'],
            current_state: 'In Mara Venn’s left coat pocket.',
            unresolved: ['Why does the key become warm near salt water?'],
        },
    ], { messageIndex: 2, minimumImportance: 0, maximumOperations: 20 });

    mergeEntityOperations(store, [
        {
            type: 'item',
            name: 'blue key',
            aliases: ['Azure Key'],
            importance: 95,
            remove_facts: ['Mara Venn carries the Azure Key.'],
            facts: ['Ivo Renn received the Azure Key from Mara Venn.'],
            current_state: 'Sealed in Ivo Renn’s brass dispatch case.',
        },
        {
            type: 'location',
            name: 'the Quay',
            aliases: ['Cinder Quay'],
            importance: 92,
            current_state: 'Closed after the eastern crane collapsed; the tide bell remains cracked.',
            history: ['The eastern crane collapsed during the storm.'],
        },
    ], { messageIndex: 80, minimumImportance: 0, maximumOperations: 20 });

    mergeEntityOperations(store, [
        {
            type: 'item',
            name: 'Azure Key',
            importance: 95,
            remove_facts: ['Ivo Renn received the Azure Key from Mara Venn.'],
            facts: ['Captain Orr logged the Azure Key as evidence receipt R-44.'],
            current_state: 'Locked in evidence drawer seven at Northwatch Vault.',
            resolve_threads: ['Why does the key become warm near salt water?'],
        },
        {
            type: 'location',
            name: 'Cinder Quay',
            importance: 92,
            current_state: 'Reopened; the eastern crane has been replaced, while the tide bell remains cracked.',
        },
    ], { messageIndex: 420, minimumImportance: 0, maximumOperations: 20 });

    const quay = store.entities[entityId('location', 'Cinder Quay')];
    const key = store.entities[entityId('item', 'Azure Key')];
    assert.equal(Object.keys(store.entities).length, 2, 'alias updates must not fragment either record');
    assert.ok(quay.aliases.includes('the Quay'));
    assert.ok(key.aliases.includes('blue key'));
    assert.match(quay.currentState, /Reopened/);
    assert.match(quay.currentState, /replaced/);
    assert.deepEqual(quay.unresolved, ['Who sabotaged the tide bell?']);
    assert.match(key.currentState, /evidence drawer seven/);
    assert.ok(key.facts.includes('The key opens Northwatch Vault.'));
    assert.ok(key.facts.includes('Captain Orr logged the Azure Key as evidence receipt R-44.'));
    assert.ok(!key.facts.some(fact => /Mara Venn carries|Ivo Renn received/.test(fact)));
    assert.deepEqual(key.unresolved, []);

    const mention = refreshMentionRecency(store, 'At message 997, Jet returns to the Quay but does not touch the blue key.', 997);
    assert.deepEqual(mention, { entities: 2, brains: 0 });
    assert.equal(quay.lastSeenMessage, 997);
    assert.equal(key.lastSeenMessage, 997);
});

test('unresolved threads deduplicate and resolve across entity-name paraphrases', () => {
    const store = createEmptyStore('thread-deduplication');
    mergeEntityOperations(store, [{
        type: 'item',
        name: 'Brass Compass',
        aliases: ['the Compass'],
        importance: 90,
        unresolved: ['Why does it point to Northwatch Vault?'],
    }], { messageIndex: 1, minimumImportance: 0 });
    mergeEntityOperations(store, [{
        type: 'item',
        name: 'Brass Compass',
        importance: 90,
        unresolved: ['Why does the Brass Compass point to Northwatch Vault?'],
    }], { messageIndex: 2, minimumImportance: 0 });
    const compass = store.entities[entityId('item', 'Brass Compass')];
    assert.deepEqual(compass.unresolved, ['Why does it point to Northwatch Vault?']);

    mergeEntityOperations(store, [{
        type: 'item',
        name: 'the Compass',
        aliases: ['Brass Compass'],
        importance: 90,
        resolve_threads: ['Why does the Compass point to Northwatch Vault?'],
    }], { messageIndex: 3, minimumImportance: 0 });
    assert.deepEqual(compass.unresolved, []);
});

test('a crowded scene creates and revises twelve isolated NPC minds without name fragmentation', () => {
    const store = createEmptyStore('crowded-cast');
    const firstPass = cast.map((character, index) => ({
        character,
        aliases: character === 'Pell Dane' ? ['Pell'] : [],
        persistent_self: { set: [
            {
                key: 'scene_goal',
                kind: 'goal',
                statement: `I must complete objective ${index + 1} without revealing it to the others.`,
                confidence: 'confirmed',
            },
            {
                key: 'private_marker',
                kind: 'secret',
                statement: `Only I know marker ${index + 101}.`,
                confidence: 'confirmed',
            },
        ] },
    }));
    const created = mergeMindOperations(store, firstPass, {
        messageIndex: 10,
        maximumOperations: 20,
        maximumThoughts: 30,
    });
    assert.equal(created.created, 12);

    const secondPass = cast.map((character, index) => ({
        character: character === 'Pell Dane' ? 'Pell' : character,
        persistent_self: { set: [{
            key: 'scene_goal',
            kind: 'goal',
            statement: `I have revised objective ${index + 1} after the council vote.`,
            confidence: 'confirmed',
        }] },
    }));
    const updated = mergeMindOperations(store, secondPass, {
        messageIndex: 70,
        maximumOperations: 20,
        maximumThoughts: 30,
    });
    assert.equal(updated.updated, 12);
    assert.equal(Object.keys(store.brains).length, 12);
    assert.ok(store.brains['pell dane']);
    assert.equal(store.brains.pell, undefined);
    assert.ok(store.brains['pell dane'].aliases.includes('Pell'));

    for (let index = 0; index < cast.length; index++) {
        const brain = store.brains[cast[index].toLowerCase()];
        assert.match(brain.persistentSelf.facets.scene_goal.statement, new RegExp(`objective ${index + 1}`));
        assert.match(brain.persistentSelf.facets.private_marker.statement, new RegExp(`marker ${index + 101}`));
        assert.equal(Object.values(brain.persistentSelf.facets).some(facet => (
            cast.some((_, otherIndex) => otherIndex !== index && facet.statement.includes(`marker ${otherIndex + 101}`))
        )), false, `${cast[index]} must not inherit another NPC's private marker`);
    }

    const injection = buildPromptInjection(store, cast.join(', '), {
        enabled: true,
        innerSelfEnabled: true,
        autoLoreEnabled: false,
        currentIndex: 71,
        brainRecencyMessages: 10,
        maximumActiveBrains: 12,
        brainInjectionBudget: 4_200,
    });
    for (const character of cast) assert.match(injection, new RegExp(character));
    assert.ok(injection.length < 4_900, 'the shared mind budget must stay bounded including its wrapper');
});

test('crowded retrieval reserves room for relevant locations and items', () => {
    const store = createEmptyStore('retrieval');
    mergeEntityOperations(store, [
        ...cast.map(character => ({
            type: 'character',
            name: character,
            importance: 90,
            summary: `${character} is present at the council.`,
        })),
        {
            type: 'location',
            name: 'Northwatch Vault',
            importance: 80,
            current_state: 'The council is gathered inside its map chamber.',
        },
        {
            type: 'item',
            name: 'Azure Key',
            importance: 80,
            current_state: 'On the map table.',
        },
    ], { messageIndex: 100, minimumImportance: 0, maximumOperations: 30 });

    const recent = `${cast.join(', ')} gather in Northwatch Vault around the Azure Key.`;
    const selected = selectRelevantEntities(store.entities, recent, {
        currentIndex: 101,
        maximumEntries: 4,
        recencyMessages: 10,
    });
    assert.ok(selected.some(record => record.type === 'location'));
    assert.ok(selected.some(record => record.type === 'item'));

    const injection = buildPromptInjection(store, recent, {
        enabled: true,
        innerSelfEnabled: false,
        autoLoreEnabled: true,
        currentIndex: 101,
        loreRecencyMessages: 10,
        maximumInjectedEntities: 4,
        loreInjectionBudget: 2_400,
        perEntityInjectionLimit: 1_800,
    });
    assert.match(injection, /Northwatch Vault/);
    assert.match(injection, /Azure Key/);
});

test('over-cap curator output commits location and item state before lower-value character cards', () => {
    const store = createEmptyStore('operation-priority');
    const operations = [
        ...cast.slice(0, 8).map(character => ({
            type: 'character',
            name: character,
            importance: 90,
            summary: `${character} is present.`,
        })),
        {
            type: 'location',
            name: 'Cinder Quay',
            importance: 80,
            current_state: 'Reopened after repairs.',
        },
        {
            type: 'item',
            name: 'Azure Key',
            importance: 80,
            current_state: 'Locked in evidence drawer seven.',
        },
    ];
    const result = mergeEntityOperations(store, operations, {
        messageIndex: 50,
        minimumImportance: 0,
        maximumOperations: 4,
    });
    assert.ok(store.entities[entityId('location', 'Cinder Quay')]);
    assert.ok(store.entities[entityId('item', 'Azure Key')]);
    assert.equal(result.truncated, 6);
    assert.equal(result.skipped, 6);
});

test('resolved lore and inactive minds leave context without being deleted, then reactivate on demand', () => {
    const store = createEmptyStore('activation-lifecycle');
    mergeEntityOperations(store, [
        {
            type: 'location',
            name: 'Old Glass Market',
            aliases: ['old market'],
            importance: 70,
            current_state: 'Abandoned but stable.',
        },
        {
            type: 'item',
            name: 'Spent Ferry Token',
            importance: 65,
            current_state: 'Used and kept as a souvenir.',
        },
        {
            type: 'item',
            name: 'Missing Moon Seal',
            importance: 80,
            current_state: 'Still missing.',
            unresolved: ['Who took the Missing Moon Seal?'],
        },
        {
            type: 'location',
            name: 'Disabled Test Cellar',
            importance: 99,
            current_state: 'Should never inject while disabled.',
        },
    ], { messageIndex: 5, minimumImportance: 0, maximumOperations: 20 });
    store.entities[entityId('location', 'Disabled Test Cellar')].enabled = false;
    mergeMindOperations(store, [{
        character: 'Retired Guide',
        set: [{ key: 'old_goal', category: 'goal', thought: 'I once wanted to map the old market.', confidence: 'confirmed' }],
    }], { messageIndex: 5, maximumOperations: 20 });

    const quietText = 'Jet rests in an unnamed room after a thousand uneventful messages.';
    const dormant = buildPromptInjection(store, quietText, {
        enabled: true,
        innerSelfEnabled: true,
        autoLoreEnabled: true,
        currentIndex: 1_005,
        brainRecencyMessages: 10,
        loreRecencyMessages: 16,
        maximumActiveBrains: 12,
        maximumInjectedEntities: 8,
        brainInjectionBudget: 3_000,
        loreInjectionBudget: 4_000,
    });
    assert.doesNotMatch(dormant, /Old Glass Market/);
    assert.doesNotMatch(dormant, /Spent Ferry Token/);
    assert.doesNotMatch(dormant, /Retired Guide/);
    assert.doesNotMatch(dormant, /Disabled Test Cellar/);
    assert.match(dormant, /Missing Moon Seal/, 'unresolved canon remains available without manual author-note maintenance');
    assert.ok(store.entities[entityId('location', 'Old Glass Market')], 'dormant lore remains saved');
    assert.ok(store.brains['retired guide'], 'dormant minds remain saved');

    const recalled = buildPromptInjection(store, 'Jet asks the Retired Guide about the old market.', {
        enabled: true,
        innerSelfEnabled: true,
        autoLoreEnabled: true,
        currentIndex: 1_006,
        brainRecencyMessages: 10,
        loreRecencyMessages: 16,
        maximumActiveBrains: 12,
        maximumInjectedEntities: 8,
        brainInjectionBudget: 3_000,
        loreInjectionBudget: 4_000,
    });
    assert.match(recalled, /Old Glass Market/);
    assert.match(recalled, /Retired Guide/);

    refreshMentionRecency(store, 'Jet asks the Retired Guide about the old market.', 1_006);
    assert.ok(selectRelevantEntities(store.entities, 'No proper names here.', {
        currentIndex: 1_015,
        recencyMessages: 16,
    }).some(record => record.name === 'Old Glass Market'));
    assert.ok(selectRelevantBrains(store.brains, 'No proper names here.', {
        currentIndex: 1_015,
        recencyMessages: 10,
        maximumBrains: 12,
    }).some(brain => brain.name === 'Retired Guide'));
    assert.ok(!selectRelevantEntities(store.entities, 'No proper names here.', {
        currentIndex: 1_100,
        recencyMessages: 16,
    }).some(record => record.name === 'Old Glass Market'));
    assert.ok(!selectRelevantBrains(store.brains, 'No proper names here.', {
        currentIndex: 1_100,
        recencyMessages: 10,
        maximumBrains: 12,
    }).some(brain => brain.name === 'Retired Guide'));
});

test('SummarySception layers recall old lore at lower priority and unresolved canon remains eligible', () => {
    const store = createEmptyStore('summary-recall');
    mergeEntityOperations(store, [
        { type: 'location', name: 'Hollow Lantern Inn', importance: 70, current_state: 'Closed for repairs.' },
        { type: 'item', name: 'Red Ledger', importance: 75, current_state: 'Missing.', unresolved: ['Who took the Red Ledger?'] },
    ], { messageIndex: 4, minimumImportance: 0 });

    const metadata = {
        summaryception: {
            layers: [
                [{ text: 'Jet left the Red Ledger at Hollow Lantern Inn before the fire.' }],
                [{ text: 'Earlier: the party first reached the coast.' }],
            ],
        },
    };
    const recalledText = summaryceptionRecallText(metadata);
    assert.match(recalledText, /Red Ledger/);
    const selected = selectRelevantEntities(store.entities, 'A thousand messages later, Jet pauses.', {
        currentIndex: 1_004,
        recencyMessages: 10,
        maximumEntries: 4,
        recalledText,
    });
    assert.deepEqual(new Set(selected.map(record => record.name)), new Set(['Hollow Lantern Inn', 'Red Ledger']));
});

test('SummarySception retrieval hints age out with the newest low-level snippets', () => {
    const layers = [
        [
            { text: 'Old Glass Market appeared in a resolved early scene.' },
            { text: 'Spent Ferry Token was used in that same early scene.' },
            ...Array.from({ length: 6 }, (_, index) => ({ text: `Recent compressed event ${index + 1}.` })),
        ],
        [{ text: 'Deep history still names Old Glass Market and should not permanently reactivate it.' }],
    ];
    const text = summaryceptionRecallText({ summaryception: { layers } });
    assert.doesNotMatch(text, /Old Glass Market/);
    assert.doesNotMatch(text, /Spent Ferry Token/);
    assert.match(text, /Recent compressed event 6/);
});

test('curator prompt provides stable NPC identity and forbids private state in public lore', () => {
    const store = createEmptyStore('prompt');
    mergeMindOperations(store, [{
        character: 'Pell Dane',
        aliases: ['Pell'],
        set: [{ key: 'repair_goal', category: 'goal', thought: 'I need to repair the alarm.', confidence: 'confirmed' }],
    }], { messageIndex: 5 });
    const messages = buildAnalysisMessages({
        transcript: '[message 20; STORY] Pell checks the broken alarm.',
        store,
        currentIndex: 20,
        playerName: 'Jet',
        settings: {
            enabledEntityTypes: ['character', 'location', 'item'],
            maximumEntitiesPerPass: 12,
            maximumMindOperationsPerPass: 20,
            maximumActiveBrains: 8,
            cardDetail: 'detailed',
        },
    });
    assert.match(messages[0].content, /Return at most 20 changed private minds/);
    assert.match(messages[0].content, /must never appear in an entity patch/i);
    assert.match(messages[0].content, /not a place for questions you can merely imagine/i);
    assert.match(messages[0].content, /singular unnamed person may be tracked only when already individually interactive/i);
    assert.match(messages[0].content, /never invent a proper name/i);
    assert.match(messages[0].content, /PASSAGE message labels are hard source metadata/i);
    assert.match(messages[0].content, /named or titled only in direct address is the recipient, not the speaker/i);
    assert.match(messages[0].content, /preserve that exact, most-specific name/i);
    assert.match(messages[0].content, /Never copy, duplicate, or reinterpret a player's dialogue/i);
    assert.match(messages[0].content, /Keep mental state and observed action distinct/i);
    assert.match(messages[1].content, /EXISTING_PRIVATE_MIND_KEYRING/);
    assert.match(messages[1].content, /EXPLICIT_NAMED_LOCATION_ANCHORS/);
    assert.match(messages[1].content, /Pell Dane/);
});

test('native lorebook sync creates, updates, and removes stable saved entries', async t => {
    const books = new Map();
    const previous = globalThis.SillyTavern;
    globalThis.SillyTavern = {
        getContext: () => ({
            loadWorldInfo: async name => books.get(name) || null,
            saveWorldInfo: async (name, data) => { books.set(name, structuredClone(data)); },
            updateWorldInfoList: async () => {},
        }),
    };
    t.after(() => { globalThis.SillyTavern = previous; });

    const store = createEmptyStore('persistence-chat');
    mergeEntityOperations(store, [
        { type: 'location', name: 'Cinder Quay', importance: 90, current_state: 'Open.' },
        { type: 'item', name: 'Azure Key', importance: 95, current_state: 'Carried by Mara Venn.' },
    ], { messageIndex: 1, minimumImportance: 0 });

    const initial = await syncLorebook(store, { chatId: store.chatId, characterName: 'Test Story' });
    assert.equal(initial.created, 2);
    const originalUids = Object.fromEntries(Object.values(store.entities).map(record => [record.id, record.entryUid]));

    mergeEntityOperations(store, [{
        type: 'item',
        name: 'Azure Key',
        importance: 95,
        current_state: 'Locked in evidence drawer seven.',
    }], { messageIndex: 40, minimumImportance: 0 });
    const second = await syncLorebook(store, { chatId: store.chatId, characterName: 'Test Story' });
    assert.equal(second.created, 0);
    assert.equal(second.updated, 2);
    assert.deepEqual(
        Object.fromEntries(Object.values(store.entities).map(record => [record.id, record.entryUid])),
        originalUids,
    );
    const saved = books.get(store.lorebookName);
    assert.deepEqual(saved.extensions?.innerLore, {
        version: 1,
        managed: true,
        chatId: 'persistence-chat',
    });
    const keyEntry = saved.entries[store.entities[entityId('item', 'Azure Key')].entryUid];
    assert.equal(keyEntry.extensions?.innerLore?.chatId, 'persistence-chat');
    assert.match(keyEntry.content, /evidence drawer seven/);

    delete store.entities[entityId('location', 'Cinder Quay')];
    const third = await syncLorebook(store, {
        chatId: store.chatId,
        characterName: 'Test Story',
        removeMissing: true,
    });
    assert.equal(third.removed, 1);
    assert.equal(Object.keys(books.get(store.lorebookName).entries).length, 1);
});
