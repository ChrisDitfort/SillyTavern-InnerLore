import assert from 'node:assert/strict';
import test from 'node:test';

import { createEmptyStore } from '../core.js?v=49';
import { applyGameOperations, createGameState } from '../game.js?v=6';
import { buildAbilityJudgeMessages, buildLedgerMessages, buildPlannerMessages } from '../game-prompts.js?v=7';
import { buildPrivateReplyMessages, buildPrivateReplyTextPrompt, channelAvailability, createThread, mindContactRules, parsePersonReply } from '../private-chat.js?v=4';

const gifted = (playerLevel, ward = 0, extra = []) => applyGameOperations(createGameState(), [
    { type: 'device.set', present: true, name: 'phone', channel: 'text' },
    { type: 'contact.add', name: 'Mara Venn', number: '0771' },
    { type: 'ability.set', holder: { kind: 'player' }, key: 'telepathy', level: playerLevel },
    { type: 'ability.set', holder: { kind: 'character', name: 'Mara Venn' }, key: 'mind_ward', level: ward },
    ...extra,
], { messageIndex: 0, source: 'world' }).state;

test('a world without messages or mind-speech offers no such channel at all', () => {
    const state = gifted(30);
    const both = channelAvailability(state, 'Mara Venn', { world: {} });
    assert.equal(both.text.ok, true);
    assert.equal(both.mind.ok, true);
    const none = channelAvailability(state, 'Mara Venn', { world: { text: false, mind: false } });
    assert.deepEqual([none.text.ok, none.text.off, none.mind.ok, none.mind.off], [false, true, false, true]);
    assert.match(none.mind.reason, /no mind-speech in this world/u);
});

test('the reach against the guard decides whether the person may shut the contact out, and the reply is told so', () => {
    const open = channelAvailability(gifted(30, 0), 'Mara Venn', { world: {} }).mind;
    assert.equal(open.access.canBlock, false);
    const guarded = channelAvailability(gifted(30, 45), 'Mara Venn', { world: {} }).mind;
    assert.equal(guarded.access.canBlock, true);
    assert.equal(guarded.canReject, true);
    const master = channelAvailability(gifted(95, 90), 'Mara Venn', { world: {} }).mind;
    assert.equal(master.access.overwhelming, true);
    const consented = channelAvailability(gifted(30, 45, [{ type: 'mind.link', name: 'Mara Venn', consent: 'granted' }]), 'Mara Venn', { world: {} }).mind;
    assert.equal(consented.access.consented, true);
    assert.equal(consented.access.canBlock, false);

    const rules = access => mindContactRules({ person: 'Mara', player: 'Jet', access }).join(' ');
    assert.match(rules(guarded.access), /they can shut the contact out[\s\S]*\[rejects\]/u);
    assert.match(rules(guarded.access), /how they regard Jet/u);
    assert.doesNotMatch(rules(open.access), /\[rejects\]/u);
    assert.match(rules(open.access), /cannot shut it out/u);
    assert.match(rules(master.access), /cannot be shut out or ignored[\s\S]*in their own voice and temper/u);
    assert.doesNotMatch(rules(master.access), /\[rejects\]/u);
    assert.match(rules(consented.access), /agreed before to be reached this way/u);
    assert.doesNotMatch(rules(consented.access), /\[consents\]/u, 'consent already given is not asked for again');
    assert.match(rules(open.access), /\[consents\]/u);
    // How well known it is.
    assert.match(rules({ ...open.access, knowledge: 'secret' }), /frightening and strange/u);
    assert.match(rules({ ...open.access, knowledge: 'common' }), /common knowledge here/u);

    // The reply prompt carries the contest and the world's rules; a quiet word does not.
    const thread = createThread('Mara Venn', 'mind');
    const messages = buildPrivateReplyMessages({ thread, playerName: 'Jet', personBrief: 'Mara Venn: innkeeper.', access: guarded.access, worldRules: 'MIND-SPEECH\n- Only the bonded may speak.' });
    assert.match(messages[0].content, /their mind is guarded as strongly as Jet's reach/u);
    assert.match(messages[0].content, /<WORLD_RULES>\nMIND-SPEECH\n- Only the bonded may speak\.\n<\/WORLD_RULES>/u);
    assert.doesNotMatch(buildPrivateReplyMessages({ thread: createThread('Mara Venn', 'aside'), playerName: 'Jet', personBrief: 'x', worldRules: 'RULES' })[0].content, /WORLD_RULES/u);
    assert.match(buildPrivateReplyTextPrompt({ thread, playerName: 'Jet', personBrief: 'x', access: guarded.access }).prompt, /\[rejects\]/u);
});

test('a person who agrees to be reached again says so with [consents]; a refusal is never consent', () => {
    const options = { personName: 'Mara Venn', playerName: 'Jet', channel: 'mind' };
    const yes = parsePersonReply('Fine. Reach me again if you must.\n[consents]', options);
    assert.deepEqual([yes.bubbles, yes.consented], [['Fine. Reach me again if you must.'], true]);
    assert.equal(parsePersonReply('Keep the line open. [consents]', options).consented, true);
    assert.equal(parsePersonReply('[consents]\n[rejects]', options).consented, false);
    assert.equal(parsePersonReply('Get out of my head.', options).consented, false);
});

test('the ledger, the planner and the judge read the world\'s rules, and leave out what the world lacks', () => {
    const store = createEmptyStore('rules');
    const game = createGameState();
    const ledger = settings => buildLedgerMessages({ game, store, playerName: 'Jet', transcript: 'STORY: A stranger nods.', settings }).map(message => message.content).join('\n');
    assert.match(ledger({ communication: {} }), /First meetings settle gifts/u);
    assert.match(ledger({ communication: {} }), /<WORLD_RULES>[\s\S]*MIND-SPEECH/u);
    assert.match(ledger({ communication: { rules: 'Sendings travel by raven.' } }), /<WORLD_RULES>\nSendings travel by raven\.\n<\/WORLD_RULES>/u);
    assert.match(ledger({ communication: { mind: false } }), /no mind-speech: no telepathy, mind_ward or links records/u);
    assert.match(ledger({ communication: { text: false } }), /no messages from afar: no device or contacts records/u);

    const planner = (settings, startingKit = true) => buildPlannerMessages({ game, store, playerName: 'Jet', targets: [{ name: 'Salt Lantern' }], startingKit, settings }).map(message => message.content).join('\n');
    assert.match(planner({ communication: {} }), /"mind": 0, "ward": 0/u);
    assert.match(planner({ communication: {} }), /settle Jet's own gift of mind-speech/u);
    assert.match(planner({ communication: {} }), /settle whether Jet carries a phone/u);
    assert.doesNotMatch(planner({ communication: { startPhone: 'yes', startMind: 'adept' } }), /settle Jet's own gift|settle whether Jet carries/u, 'the world fixed them');
    assert.doesNotMatch(planner({ communication: {} }, false), /settle Jet's own gift/u, 'only with a starting kit');
    assert.match(planner({ communication: { mind: false } }), /no mind-speech: leave mind and ward out/u);

    const judge = settings => buildAbilityJudgeMessages({ game, store, playerName: 'Jet', personName: 'Mara Venn', settings }).map(message => message.content).join('\n');
    assert.match(judge({ communication: {} }), /DEVICE:/u);
    assert.doesNotMatch(judge({ communication: { text: false } }), /DEVICE:/u);
    assert.doesNotMatch(judge({ communication: { mind: false } }), /ABILITY player with key telepathy/u);
    assert.match(judge({ communication: {} }), /<WORLD_RULES>/u);
});

test('the DSL carries consent (LINK) for the ledger, and gifts (PERSON mind/ward, ABILITY player) for the planner', async () => {
    const { parseInnerLoreDsl, parseInnerLoreOutput } = await import('../output-codec.js?v=7');
    const ledger = parseInnerLoreOutput('INNERLORE GAME 1\nLINK Mara Venn\nconsent = granted\nevidence = reach me if you need me\nEND\nDONE', { format: 'dsl', task: 'game' });
    assert.deepEqual(ledger.links, [{ character: 'Mara Venn', consent: 'granted', evidence: 'reach me if you need me' }]);
    const planner = parseInnerLoreDsl('INNERLORE PLANNER 1\nPERSON Brother Aldous\nlocation = Salt Lantern\nrole = priest\nmind = 35\nward = 60\nEND\nABILITY player\nkey = telepathy\nlevel = 30\nEND\nDONE', 'planner');
    assert.equal(planner.people[0].mind, 35);
    assert.equal(planner.people[0].ward, 60);
    assert.deepEqual(planner.abilities, [{ holder: 'player', key: 'telepathy', level: 30 }]);
});
