import assert from 'node:assert/strict';
import test from 'node:test';

import { createEmptyStore, mergeEntityOperations } from '../core.js?v=48';
import {
    ABILITY_KEYS,
    abilityLevel,
    abilityList,
    abilityTier,
    abilitiesKnown,
    applyGameOperations,
    canMindSpeak,
    canRejectMind,
    contactOf,
    createGameState,
    deviceOf,
    gameContext,
    gameOverview,
    gameStateBefore,
    normalizeGameRecords,
    normalizeGameState,
    recentGameChanges,
    renderGamePacket,
} from '../game.js?v=4';
import { buildAbilityJudgeMessages, buildLedgerMessages, ledgerStateView } from '../game-prompts.js?v=4';
import { gameRequestSettings, validateGamePayload } from '../game-client.js?v=2';
import { dslOutputContract, parseInnerLoreDsl, parseInnerLoreOutput, prepareOutputMessages, stringifyInnerLoreDsl } from '../output-codec.js?v=4';

function world() {
    const store = createEmptyStore('abilities');
    mergeEntityOperations(store, [
        { type: 'location', name: 'Salt Lantern', importance: 80, summary: 'A harbour inn on Rope Street.' },
        { type: 'character', name: 'Mara Venn', importance: 60, summary: 'The innkeeper.', current_location: 'Salt Lantern' },
        { type: 'character', name: 'Mother Ysolde', importance: 55, summary: 'A hedge-witch who keeps her thoughts behind a closed door.', current_location: 'Salt Lantern' },
    ], { messageIndex: 0, maximumOperations: 20 });
    return store;
}

const context = (store, state) => gameContext(state, { playerName: 'Jet', entities: store.entities });

test('tiers: a gift is usable from 20 and master from 90', () => {
    assert.equal(abilityTier(0), 'none');
    assert.equal(abilityTier(12), 'latent');
    assert.equal(abilityTier(20), 'novice');
    assert.equal(abilityTier(55), 'adept');
    assert.equal(abilityTier(75), 'expert');
    assert.equal(abilityTier(95), 'master');
});

test('the judge\'s verdict is journaled: gifts, a ward, a device and a contact, all rewound by a swipe', () => {
    const store = world();
    const payload = {
        abilities: [
            { holder: 'player', key: 'telepathy', name: 'mind-speech', level: 45, evidence: 'The card calls Jet a sending.' },
            { holder: 'Mother Ysolde', key: 'mind_ward', name: 'warded mind', level: 65, evidence: 'thoughts behind a closed door' },
            { holder: 'Mara Venn', key: 'mind_ward', level: 0, evidence: 'an ordinary innkeeper' },
        ],
        device: { present: true, name: 'Phone', channel: 'Text', evidence: 'Jet checks his phone.' },
        contacts: [{ character: 'Mara', number: '0771 442 118', evidence: 'scrawled on a beer mat' }],
    };
    const fresh = createGameState();
    const normalized = normalizeGameRecords(payload, context(store, fresh), { source: 'judge' });
    assert.deepEqual(normalized.rejected, []);
    assert.deepEqual(normalized.ops.map(op => op.type), ['ability.set', 'ability.set', 'ability.set', 'contact.add', 'device.set']);
    assert.equal(normalized.ops[3].name, 'Mara Venn', 'a short name resolves to the known person');
    const applied = applyGameOperations(fresh, normalized.ops, { messageIndex: 4, source: 'judge' });
    assert.equal(applied.rejected.length, 0);
    const state = applied.state;
    assert.equal(abilityLevel(state, 'player', ABILITY_KEYS.telepathy), 45);
    assert.ok(canMindSpeak(state));
    assert.ok(canRejectMind(state, 'Mother Ysolde'));
    assert.equal(canRejectMind(state, 'Mara Venn'), false, 'a judged level 0 is known and absent');
    assert.ok(abilitiesKnown(state, { name: 'Mara Venn' }));
    assert.equal(abilitiesKnown(state, { name: 'Old Fen' }), false);
    assert.deepEqual(deviceOf(state), { known: true, present: true, name: 'phone', channel: 'text', note: 'Jet checks his phone.', at: 4 });
    assert.equal(contactOf(state, 'mara venn').number, '0771 442 118');
    assert.deepEqual(abilityList(state, 'player').map(gift => [gift.key, gift.tier]), [['telepathy', 'adept']]);
    assert.deepEqual(abilityList(state, { name: 'Mara Venn' }), [], 'a gift judged absent is not listed');
    // The judge's reading is not an event: nothing shows under recent changes.
    assert.deepEqual(recentGameChanges(state, 'Jet'), []);
    // A swipe of message 4 undoes the verdict.
    const rewound = gameStateBefore(state, 4);
    assert.equal(abilitiesKnown(rewound, 'player'), false);
    assert.equal(deviceOf(rewound).known, false);
    assert.equal(contactOf(rewound, 'Mara Venn'), null);
});

test('the ledger records growth, a lost contact and a device the story gives, and the planner may not', () => {
    const store = world();
    let state = applyGameOperations(createGameState(), [
        { type: 'ability.set', holder: { kind: 'player' }, key: 'telepathy', name: 'mind-speech', level: 15 },
        { type: 'device.set', present: true, name: 'phone', channel: 'text' },
        { type: 'contact.add', name: 'Mara Venn', number: '0771' },
    ], { messageIndex: 1, source: 'judge' }).state;
    const payload = {
        abilities: [{ holder: 'Jet', key: 'telepathy', delta: 10, evidence: 'Jet holds the link for a full minute.' }, { holder: 'player', key: 'lockpicking', delta: 0 }],
        contacts: [{ character: 'Mara Venn', op: 'remove', evidence: 'Mara blocks his number.' }],
        device: { present: false, name: 'phone', evidence: 'The phone sinks into the harbour.' },
    };
    const normalized = normalizeGameRecords(payload, context(store, state), { source: 'ledger' });
    assert.deepEqual(normalized.rejected.map(item => item.reason), ['ability change is zero']);
    state = applyGameOperations(state, normalized.ops, { messageIndex: 3, source: 'ledger' }).state;
    assert.equal(abilityLevel(state, 'player', 'telepathy'), 25, 'the holder named as the player is the player');
    assert.ok(canMindSpeak(state));
    assert.equal(contactOf(state, 'Mara Venn'), null);
    assert.equal(deviceOf(state).present, false);
    assert.deepEqual(recentGameChanges(state, 'Jet').map(change => change.text), ['mind-speech +10: Jet holds the link for a full minute.', 'Mara Venn removed from contacts']);
    const planner = normalizeGameRecords({ abilities: [{ holder: 'player', key: 'telepathy', level: 90 }], contacts: [{ character: 'Mara Venn' }], device: { present: true } }, context(store, state), { source: 'planner' });
    assert.equal(planner.ops.length, 0);
    assert.equal(planner.rejected.length, 3);
    // A level recorded twice stays idempotent; a repeated contact changes nothing.
    const again = applyGameOperations(state, [{ type: 'contact.add', name: 'Old Fen', number: '12' }, { type: 'contact.add', name: 'Old Fen', number: '12' }], { messageIndex: 4, source: 'ledger' });
    assert.equal(again.applied.length, 2);
    assert.equal(Object.keys(again.state.contacts).length, 1);
});

test('an alias folds gifts and contacts under the canonical name', () => {
    const state = applyGameOperations(createGameState(), [
        { type: 'ability.set', holder: { kind: 'character', name: 'Lean Sailor' }, key: 'mind_ward', level: 30 },
        { type: 'contact.add', name: 'Lean Sailor', number: '555' },
        { type: 'person.alias', from: 'Lean Sailor', to: 'Tobbe Rusk', name: 'Tobbe Rusk' },
    ], { messageIndex: 2, source: 'lore' }).state;
    assert.equal(abilityLevel(state, { name: 'Tobbe Rusk' }, 'mind_ward'), 30);
    assert.equal(abilitiesKnown(state, { name: 'Lean Sailor' }), false);
    assert.equal(contactOf(state, 'Tobbe Rusk').number, '555');
});

test('the narrator packet and the overview carry gifts, the phone and its contacts', () => {
    const store = world();
    const state = applyGameOperations(createGameState(), [
        { type: 'ability.set', holder: { kind: 'player' }, key: 'telepathy', name: 'mind-speech', level: 45 },
        { type: 'ability.set', holder: { kind: 'character', name: 'Mother Ysolde' }, key: 'mind_ward', name: 'warded mind', level: 65 },
        { type: 'device.set', present: true, name: 'phone', channel: 'text' },
        { type: 'contact.add', name: 'Mara Venn', number: '0771 442 118' },
    ], { messageIndex: 2, source: 'judge' }).state;
    const scene = { location: { name: 'Salt Lantern' }, participants: [{ name: 'Jet' }, { name: 'Mother Ysolde' }] };
    const packet = renderGamePacket(state, { playerName: 'Jet', store, scene });
    assert.match(packet, /Jet's gifts: mind-speech \(adept\)\. A latent gift cannot yet be used on purpose\./u);
    assert.match(packet, /Gifts of people here: Mother Ysolde: warded mind \(adept\)\./u);
    assert.match(packet, /Jet's phone: can reach Mara Venn\./u);
    const overview = gameOverview(state, { playerName: 'Jet' });
    assert.deepEqual(overview.abilities.map(gift => [gift.name, gift.tier, gift.level]), [['mind-speech', 'adept', 45]]);
    assert.equal(overview.abilitiesJudged, true);
    assert.equal(overview.device.present, true);
    assert.deepEqual(overview.contacts, [{ name: 'Mara Venn', number: '0771 442 118', note: '' }]);
    const view = ledgerStateView(state, { scene, store, transcript: '' });
    assert.equal(view.device, 'phone (text)');
    assert.deepEqual(view.contacts, [{ name: 'Mara Venn', number: '0771 442 118' }]);
    assert.deepEqual(view.abilities, [{ holder: 'player', abilities: [{ key: 'telepathy', level: 45 }] }, { holder: 'mother ysolde', abilities: [{ key: 'mind_ward', level: 65 }] }]);
    // Nothing judged: no gift lines, no phone line.
    const quiet = renderGamePacket(createGameState(), { playerName: 'Jet', store, scene });
    assert.doesNotMatch(quiet, /gifts|phone/u);
    assert.equal(normalizeGameState({ journal: [], version: 1 }).device.known, false, 'an older save gains the new fields');
});

test('the ledger prompt asks for gifts, contacts and devices, and the judge prompt asks its questions', () => {
    const store = world();
    const state = createGameState();
    const ledger = buildLedgerMessages({ game: state, store, scene: { location: { name: 'Salt Lantern' }, participants: [] }, playerName: 'Jet', transcript: 'Mara scrawls her number on a beer mat.', characterCard: 'A harbour town.' });
    assert.match(ledger[0].content, /GIFTS, MESSAGE DEVICES AND CONTACTS/u);
    assert.match(ledger[0].content, /"contacts": \[\{ "character"/u);
    assert.match(ledger[1].content, /"device":"not established"/u);
    const dsl = prepareOutputMessages(ledger, { format: 'dsl', task: 'game' });
    assert.match(dsl[0].content, /ABILITY holder \(player, or a person's canonical name\)/u);
    assert.match(dsl[0].content, /CONTACT canonical character name fields/u);

    const judge = buildAbilityJudgeMessages({ game: state, store, playerName: 'Jet', personName: 'Mother Ysolde', characterCard: 'Jet is a sending: he can speak into minds.', persona: 'A harbour rat.', transcript: '[message 1; STORY]\nYsolde eyes him.' });
    assert.equal(judge[0].role, 'system');
    assert.match(judge[0].content, /Ability Judge/u);
    assert.match(judge[1].content, /ABILITY player with key telepathy/u);
    assert.match(judge[1].content, /ABILITY Mother Ysolde with key mind_ward/u);
    assert.match(judge[1].content, /DEVICE: does Jet carry/u);
    assert.match(judge[1].content, /keeps her thoughts behind a closed door/u, 'the person\'s record is in the brief');
    assert.match(judge[1].content, /"device":"not established"/u);
    const judgeDsl = prepareOutputMessages(judge, { format: 'dsl', task: 'abilities' });
    assert.match(judgeDsl[0].content, /First line exactly: INNERLORE ABILITIES 1/u);
    assert.match(judgeDsl[1].content, /Return the INNERLORE ABILITIES 1 DSL document now\./u);
    assert.equal(gameRequestSettings({ connectionProfileId: 'a', gameConnectionProfileId: 'ledger' }, 'abilities').connectionProfileId, 'ledger');
    assert.equal(gameRequestSettings({ connectionProfileId: 'a' }, 'abilities').telemetryKind, 'judge');
});

test('the ABILITIES DSL parses, round-trips and validates; the ledger DSL takes the new records', () => {
    const verdict = `INNERLORE ABILITIES 1
ABILITY player
key = telepathy
name = mind-speech
level = 45
evidence = The card calls Jet a sending.
END
ABILITY Mother Ysolde
key = mind_ward
name = warded mind
level = 65
evidence = thoughts behind a closed door
END
DEVICE
present = TRUE
name = phone
channel = text
evidence = Jet checks his phone.
END
CONTACT Mara Venn
number = 0771 442 118
evidence = scrawled on a beer mat
END
DONE`;
    const parsed = parseInnerLoreDsl(verdict, 'abilities');
    assert.equal(parsed.abilities.length, 2);
    assert.equal(parsed.abilities[0].holder, 'player');
    assert.equal(parsed.abilities[1].holder, 'Mother Ysolde');
    assert.equal(parsed.abilities[1].level, 65);
    assert.deepEqual(parsed.device, { present: true, name: 'phone', channel: 'text', evidence: 'Jet checks his phone.' });
    assert.equal(parsed.contacts[0].character, 'Mara Venn');
    const validated = validateGamePayload(parsed, 'abilities');
    assert.equal(validated.contacts.length, 1);
    const again = parseInnerLoreDsl(stringifyInnerLoreDsl(validated, 'abilities'), 'abilities');
    assert.deepEqual(again.abilities, parsed.abilities);
    assert.deepEqual(again.device, parsed.device);
    assert.throws(() => parseInnerLoreDsl(`INNERLORE ABILITIES 1\nDEVICE\npresent = TRUE\nEND\nDEVICE\npresent = FALSE\nEND\nDONE`, 'abilities'), /DEVICE may appear only once/u);
    // The contract's own example parses.
    const example = /Syntax example only; never copy its fictional facts:\n([\s\S]*?)\n<\/INNERLORE_DSL_OUTPUT>/u.exec(dslOutputContract('abilities'))[1];
    const exampleParsed = parseInnerLoreDsl(example, 'abilities');
    assert.equal(exampleParsed.abilities.length, 2);
    assert.equal(exampleParsed.contacts.length, 1);

    const ledger = parseInnerLoreOutput(`INNERLORE GAME 1
ABILITY player
key = telepathy
delta = 10
evidence = Jet holds the link.
END
CONTACT Mara Venn
number = 0771
op = add
evidence = She gives him her number.
END
DEVICE
present = TRUE
name = phone
END
DONE`, { format: 'dsl', task: 'game' });
    assert.equal(ledger.abilities[0].delta, 10);
    assert.equal(ledger.contacts[0].number, '0771');
    assert.equal(ledger.device.present, true);
    // The planner knows nothing of devices.
    assert.throws(() => parseInnerLoreDsl('INNERLORE PLANNER 1\nDEVICE\npresent = TRUE\nEND\nDONE', 'planner'), /unknown record declaration/u);
});
