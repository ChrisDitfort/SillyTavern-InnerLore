import assert from 'node:assert/strict';
import test from 'node:test';

import { createEmptyStore, mergeMindOperations } from '../core.js';

test('article variants of one NPC update the same mind instead of forking it', () => {
    const store = createEmptyStore('mind-dedup-chat');
    mergeMindOperations(store, [{
        character: 'the father',
        current_mind: { perception: 'A strange child stands in my house.' },
    }], { messageIndex: 10 });

    // The next pass calls the same person "father" — no article.
    const second = mergeMindOperations(store, [{
        character: 'Father',
        current_mind: { perception: 'The child promised no harm.' },
    }], { messageIndex: 12 });

    assert.equal(Object.keys(store.brains).length, 1, 'article variant must not create a second mind');
    assert.equal(second.created, 0);
    assert.equal(second.updated, 1);
    const [brain] = Object.values(store.brains);
    assert.equal(brain.currentMind.perception, 'The child promised no harm.');
});

test('a proper-name reveal with aliases promotes the existing mind, not a new one', () => {
    const store = createEmptyStore('mind-dedup-chat');
    mergeMindOperations(store, [{
        character: 'the mother',
        current_mind: { perception: 'My daughter wants to keep a water spirit.' },
    }], { messageIndex: 10 });
    mergeMindOperations(store, [{
        character: 'Lysandra',
        aliases: ['the mother', 'Mother'],
        identity_kind: 'public_name',
        promote_name: true,
        current_mind: { perception: 'The child commands impossible magic.' },
    }], { messageIndex: 14 });

    const brains = Object.values(store.brains);
    assert.equal(brains.length, 1, 'alias-linked promotion must reuse the descriptor mind');
    assert.equal(brains[0].name, 'Lysandra');
    assert.equal(brains[0].identityKind, 'public_name');
    assert.ok(brains[0].aliases.some(alias => /mother/iu.test(alias)));
});

test('sentient-companion rule companion: distinct people stay distinct', () => {
    const store = createEmptyStore('mind-dedup-chat');
    mergeMindOperations(store, [
        { character: 'the father', current_mind: { perception: 'a' } },
        { character: 'Theron', aliases: ['the father'], promote_name: true, identity_kind: 'public_name', current_mind: { perception: 'b' } },
        { character: 'Elara', current_mind: { perception: 'c' } },
    ], { messageIndex: 20 });
    const names = Object.values(store.brains).map(brain => brain.name).sort();
    // Theron aliases "the father" in the same batch: the alias links the two
    // operations, so they must collapse; Elara stays separate.
    assert.deepEqual(names, ['Elara', 'Theron']);
});

test('pre-existing forks heal deterministically on the next merge pass', () => {
    const store = createEmptyStore('mind-dedup-chat');
    // Simulate the live failure: three minds for one father, two for one
    // mother, created by article variants and an unlinked proper name.
    mergeMindOperations(store, [
        { character: 'the father', current_mind: { perception: 'first' } },
    ], { messageIndex: 10 });
    store.brains.father = structuredClone(store.brains['the father']);
    store.brains.father.name = 'Father';
    store.brains.father.id = 'father';
    store.brains.father.aliases = ['Theron'];
    store.brains.father.identityKind = 'public_name';
    store.brains.theron = structuredClone(store.brains['the father']);
    store.brains.theron.name = 'Theron';
    store.brains.theron.id = 'theron';

    // An unrelated pass triggers consolidation inside mergeMindOperations.
    const result = mergeMindOperations(store, [
        { character: 'Elara', current_mind: { perception: 'unrelated' } },
    ], { messageIndex: 12 });

    const fatherBrains = Object.values(store.brains).filter(brain => /father|theron/iu.test(brain.name + JSON.stringify(brain.aliases)));
    assert.equal(fatherBrains.length, 1, `expected one father mind, got ${fatherBrains.map(b => b.name).join(', ')}`);
    assert.equal(fatherBrains[0].name, 'Father');
    assert.ok(fatherBrains[0].aliases.some(alias => /theron/iu.test(alias)));
    assert.ok(result.consolidatedEntries >= 2);
    assert.ok(result.changedIds.includes('father'));
});

test('unrelated people are never consolidated', () => {
    const store = createEmptyStore('mind-dedup-chat');
    mergeMindOperations(store, [
        { character: 'Elara', current_mind: { perception: 'a' } },
        { character: 'Snowdrop', current_mind: { perception: 'b' } },
        { character: 'The City Clerk', current_mind: { perception: 'c' } },
    ], { messageIndex: 10 });
    assert.equal(Object.keys(store.brains).length, 3);
});

test('relational descriptors merge into the plain-form mind, never each other', () => {
    const store = createEmptyStore('mind-dedup-chat');
    mergeMindOperations(store, [
        { character: 'Father', current_mind: { perception: 'plain form' } },
    ], { messageIndex: 10 });
    // The model later says "Elara's Father" for the same person.
    mergeMindOperations(store, [
        { character: "Elara's Father", current_mind: { perception: 'possessive form' } },
    ], { messageIndex: 12 });
    const fatherBrains = Object.values(store.brains).filter(brain => /father/iu.test(brain.name));
    assert.equal(fatherBrains.length, 1, `"Elara's Father" must update the existing Father mind`);
    assert.ok(fatherBrains[0].aliases.some(alias => /elara.s father/iu.test(alias)));

    // Two DIFFERENT possessive forms are not merged with each other.
    const other = createEmptyStore('mind-dedup-chat');
    mergeMindOperations(other, [
        { character: "John's father", current_mind: { perception: 'a' } },
        { character: "Mary's father", current_mind: { perception: 'b' } },
    ], { messageIndex: 10 });
    assert.equal(Object.keys(other.brains).length, 2, 'distinct possessive minds must stay distinct');
});

test('minds anchor through the entity layer even without shared aliases', () => {
    const store = createEmptyStore('mind-dedup-chat');
    // The entity layer resolved this person canonically as Theron (alias
    // Father); the provider emitted minds under both names with no shared
    // alias between the brains themselves.
    store.entities = {
        'character:theron': { id: 'character:theron', type: 'character', name: 'Theron', aliases: ['Father'] },
    };
    mergeMindOperations(store, [
        { character: 'Theron', current_mind: { perception: 'named form' } },
    ], { messageIndex: 10 });
    // Bypass findBrain to simulate an already-forked state.
    store.brains.father = {
        ...structuredClone(store.brains.theron),
        id: 'father', name: 'Father', aliases: [],
        currentMind: { perception: 'descriptor form' },
    };
    const result = mergeMindOperations(store, [
        { character: 'Elara', current_mind: { perception: 'unrelated' } },
    ], { messageIndex: 12 });
    const fatherBrains = Object.values(store.brains).filter(brain => /theron|father/iu.test(brain.name));
    assert.equal(fatherBrains.length, 1, 'entity anchor must collapse Father into Theron');
    assert.equal(fatherBrains[0].name, 'Theron');
    assert.ok(result.consolidatedEntries >= 1);
});

test('an operation naming an entity alias lands on the canonical mind', () => {
    const store = createEmptyStore('mind-dedup-chat');
    store.entities = {
        'character:theron': { id: 'character:theron', type: 'character', name: 'Theron', aliases: ['Father'] },
    };
    mergeMindOperations(store, [
        { character: 'Theron', current_mind: { perception: 'first' } },
    ], { messageIndex: 10 });
    // A later pass says only "Father" — the entity anchor resolves it.
    mergeMindOperations(store, [
        { character: 'Father', current_mind: { perception: 'second' } },
    ], { messageIndex: 12 });
    assert.equal(Object.keys(store.brains).length, 1);
    assert.equal(Object.values(store.brains)[0].currentMind.perception, 'second');
});
