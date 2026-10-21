import assert from 'node:assert/strict';
import test from 'node:test';

import { createEmptyStore, mergeEntityOperations, passageProperNames } from '../core.js?v=48';
import { buildCuratorHints, identityHints } from '../curator-hints.js?v=1';

function harbourStore() {
    const store = createEmptyStore('hints');
    mergeEntityOperations(store, [
        { type: 'character', name: 'Marit', importance: 80, summary: 'The landlady of the Salt Lantern.' },
        { type: 'character', name: 'Lean Sailor', importance: 60, summary: 'A lean sailor drinking at the bar.' },
        { type: 'location', name: 'Salt Lantern', importance: 80, summary: 'An inn on Rope Street.', aliases: ['the Salt Lantern'] },
        { type: 'location', name: 'Port Vell', importance: 70, summary: 'A harbour town.' },
    ], { minimumImportance: 0, messageIndex: 1 });
    return store;
}

const passage = `[message 4; STORY — Harbour Tales]
Rain hammers the shutters of the Salt Lantern. "Tobbe Rusk," the lean sailor says, and offers Jet a hand. "Off the Grey Tern." Marit snorts. By the fire the old man says nothing; later Marit calls him Hob Garrow. Shared! Ha, shared it is.`;

test('proper names in a passage skip known names, the player, and sentence-initial single words', () => {
    const names = passageProperNames(passage, { known: ['Marit', 'Salt Lantern', 'the Salt Lantern', 'Port Vell', 'Lean Sailor'], player: 'Jet' });
    assert.deepEqual(names.map(item => item.name), ['Grey Tern', 'Hob Garrow', 'Tobbe Rusk']);
});

test('identity hints name the unnamed descriptor people and the unmatched proper names', () => {
    const store = harbourStore();
    const hints = identityHints({ store, transcript: passage, playerName: 'Jet' });
    assert.match(hints, /People tracked only by a descriptor, not yet named: Lean Sailor\./u);
    assert.match(hints, /Proper names in PASSAGE that match no record: Grey Tern; Hob Garrow; Tobbe Rusk\./u);
    assert.doesNotMatch(hints, /Marit;|Salt Lantern;|Jet/u);
    assert.match(hints, /promote_name = TRUE/u);
});

test('the hint block is empty when nothing needs saying', () => {
    const store = harbourStore();
    delete store.entities['character:lean sailor'];
    assert.equal(buildCuratorHints({ store, transcript: 'Marit wipes the bar. Jet waits.', playerName: 'Jet' }), '');
});

test('the coverage checklist lists the amounts, times and arrangements the passage states', () => {
    const store = harbourStore();
    const transcript = '[message 6; STORY — Harbour Tales]\n"The back room is a shilling and six," Marit says. "Door\'s barred at the quarter hour. Hob wants a word with you by first light; he will pay for passage north." She promises to keep the chart in the strongbox.';
    const hints = buildCuratorHints({ store, transcript, playerName: 'Jet' });
    assert.match(hints, /<COVERAGE_CHECKLIST>/u);
    assert.match(hints, /Amounts and prices named: "a shilling and six"/u);
    assert.match(hints, /Times and deadlines: .*first light/u);
    assert.match(hints, /Offers, promises and arrangements: .*(?:wants a word|will pay|promises)/u);
    assert.match(hints, /SKIPPED:/u);
});

test('an assisted progression prompt carries the sweep block with the passage commitments; plain prompts do not', async () => {
    const { buildProgressionMessages } = await import('../progression-prompts.js');
    const { createProgressionState } = await import('../progression.js');
    const base = { transcript: '[message 6; STORY]\nHob will pay for passage north; be back by first light.', store: harbourStore(), progression: createProgressionState(), currentIndex: 6, playerName: 'Jet', settings: {} };
    const assisted = buildProgressionMessages({ ...base, assisted: true }).map(m => m.content).join('\n');
    const plain = buildProgressionMessages(base).map(m => m.content).join('\n');
    assert.match(assisted, /<REQUIRED_SWEEP>[\s\S]*first light[\s\S]*<\/REQUIRED_SWEEP>/u);
    assert.match(assisted, /SWEEP: lines/u);
    assert.match(assisted, /never means leaving out/u);
    assert.doesNotMatch(plain, /REQUIRED_SWEEP|SWEEP: lines/u);
});
