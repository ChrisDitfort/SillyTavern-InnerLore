import assert from 'node:assert/strict';
import test from 'node:test';

import { createEmptyStore, mergeEntityOperations, normalizeBrainRecord } from '../core.js?v=48';
import { applyGameOperations, createGameState } from '../game.js?v=4';
import { deriveSceneState } from '../scene.js?v=8';
import { formatTranscript } from '../prompts.js?v=10';
import {
    CHANNELS,
    PRIVATE_EXTRA_KEY,
    appendBubble,
    buildPrivateReplyMessages,
    buildPrivateReplyTextPrompt,
    canWriteTo,
    channelAvailability,
    createThread,
    hasPendingStory,
    markFlushed,
    normalizeThreads,
    parsePersonReply,
    parseTranscript,
    pendingBubbles,
    personBrief,
    renderPrivateCard,
    renderTranscript,
    sharedNumber,
    sortedThreads,
    threadKey,
    threadPreview,
} from '../private-chat.js?v=1';
import { renderPhoneHome, renderThreadLog } from '../phone-view.js?v=1';

function world() {
    const store = createEmptyStore('private');
    mergeEntityOperations(store, [
        { type: 'location', name: 'Salt Lantern', importance: 80, summary: 'A harbour inn on Rope Street.' },
        { type: 'location', name: 'Old Quay', importance: 60, summary: 'The fish quay.' },
        { type: 'character', name: 'Jet', importance: 60, current_location: 'Salt Lantern' },
        { type: 'character', name: 'Mara Venn', importance: 60, summary: 'The innkeeper, brisk and dry.', current_location: 'Salt Lantern', current_state: 'Behind the bar with the slate.' },
        { type: 'character', name: 'Old Fen', importance: 50, summary: 'A net-mender.', current_location: 'Old Quay' },
    ], { messageIndex: 0, maximumOperations: 20 });
    store.brains['mara venn'] = normalizeBrainRecord({
        id: 'mara venn', name: 'Mara Venn', active: true, enabled: true,
        currentMind: { emotions: [{ name: 'irritation', intensity: 'moderate' }], immediateGoal: 'Clear the slate before the tide.', innerThoughts: ['One more favour and I start charging for them.'], sourceMessage: 1 },
    });
    return store;
}

function judged({ telepathy = 45, ward = 0, device = true, contact = true } = {}) {
    return applyGameOperations(createGameState(), [
        { type: 'ability.set', holder: { kind: 'player' }, key: 'telepathy', name: 'mind-speech', level: telepathy },
        { type: 'ability.set', holder: { kind: 'character', name: 'Mara Venn' }, key: 'mind_ward', name: 'warded mind', level: ward },
        { type: 'device.set', present: device, name: 'phone', channel: 'text' },
        ...(contact ? [{ type: 'contact.add', name: 'Mara Venn', number: '0771 442 118' }] : []),
        { type: 'standing.change', key: 'mara venn', name: 'Mara Venn', delta: 6, reason: 'Jet paid his slate in full' },
    ], { messageIndex: 2, source: 'judge' }).state;
}

test('threads live in metadata, keep what the story has not been told, and survive normalisation', () => {
    const thread = createThread('Mara Venn', 'text');
    assert.equal(thread.key, threadKey('mara venn', 'text'));
    appendBubble(thread, 'player', 'you still at the Lantern?');
    appendBubble(thread, 'person', 'Aye. Why?');
    assert.equal(pendingBubbles(thread).length, 2);
    assert.ok(hasPendingStory(thread));
    const saved = normalizeThreads({ [thread.key]: JSON.parse(JSON.stringify(thread)), junk: { channel: 'carrier pigeon' }, 'wrong:key': { person: 'X', channel: 'text' } });
    assert.deepEqual(Object.keys(saved), [thread.key]);
    assert.equal(saved[thread.key].bubbles[1].text, 'Aye. Why?');
    markFlushed(saved[thread.key]);
    assert.equal(pendingBubbles(saved[thread.key]).length, 0);
    assert.equal(hasPendingStory(saved[thread.key]), false);
    saved[thread.key].outcome = 'ended';
    assert.ok(hasPendingStory(saved[thread.key]), 'an outcome the story has not heard counts');
    const preview = threadPreview(saved[thread.key]);
    assert.equal(preview.lastFrom, 'person');
    assert.equal(preview.lastText, 'Aye. Why?');
    const other = createThread('Old Fen', 'mind');
    other.updated = thread.updated + 10;
    assert.deepEqual(sortedThreads({ [thread.key]: thread, [other.key]: other }).map(item => item.person), ['Old Fen', 'Mara Venn']);
    assert.deepEqual(canWriteTo({ status: 'rejected', closedAtLength: 12, person: 'Mara Venn' }, 12).ok, false);
    assert.deepEqual(canWriteTo({ status: 'rejected', closedAtLength: 12, person: 'Mara Venn' }, 13).ok, true);
});

test('who can be reached: here in person, by phone with a number, mind to mind with the gift', () => {
    const unsettled = channelAvailability(createGameState(), 'Mara Venn', { present: true });
    assert.equal(unsettled.aside.ok, true);
    assert.equal(unsettled.text.judge, true);
    assert.equal(unsettled.mind.judge, true);
    const away = channelAvailability(judged(), 'Mara Venn', { present: false });
    assert.equal(away.aside.ok, false);
    assert.match(away.aside.reason, /not here with you/u);
    assert.equal(away.text.ok, true);
    assert.equal(away.mind.ok, true);
    assert.equal(away.mind.tier, 'adept');
    assert.equal(away.mind.canReject, false);
    const warded = channelAvailability(judged({ ward: 60 }), 'Mara Venn', { present: false });
    assert.equal(warded.mind.canReject, true);
    const noGift = channelAvailability(judged({ telepathy: 0 }), 'Mara Venn', { present: false });
    assert.match(noGift.mind.reason, /no gift of mind-speech/u);
    const latent = channelAvailability(judged({ telepathy: 12 }), 'Mara Venn', { present: false });
    assert.match(latent.mind.reason, /latent/u);
    const noNumber = channelAvailability(judged({ contact: false }), 'Mara Venn', { present: false });
    assert.match(noNumber.text.reason, /don't have Mara Venn's number/u);
    const noPhone = channelAvailability(judged({ device: false }), 'Mara Venn', { present: false });
    assert.match(noPhone.text.reason, /no phone or other way/u);
    // Someone never judged still needs the judge for mind, but not when the general question is asked.
    const stranger = channelAvailability(judged(), 'Old Fen', { present: false });
    assert.equal(stranger.mind.judge, true);
    assert.equal(channelAvailability(judged(), '', { present: false, personKnown: false }).mind.ok, true);
});

test('the reply prompt briefs the person, states the channel rules, and alternates the conversation', () => {
    const store = world();
    const state = judged({ ward: 60 });
    const brief = personBrief(store, 'Mara Venn', state, { playerName: 'Jet' });
    assert.equal(brief.location, 'Salt Lantern');
    assert.match(brief.text, /Mara Venn/u);
    assert.match(brief.text, /Clear the slate before the tide/u);
    assert.match(brief.text, /regards Jet: neutral \(\+6\)/u);
    assert.match(brief.text, /Mara Venn's mind:\nFeels: irritation \(moderate\)\./u);
    assert.match(brief.text, /gifts: warded mind \(adept\)/u);
    const thread = createThread('Mara Venn', 'mind');
    appendBubble(thread, 'player', 'Mara. Can you hear me?');
    appendBubble(thread, 'person', 'Get out of my head.');
    appendBubble(thread, 'player', 'One question, then I go.');
    const messages = buildPrivateReplyMessages({
        thread, playerName: 'Jet', personBrief: brief.text, personLocation: brief.location, placeName: 'Old Quay',
        worldCard: 'A harbour town in the rain.', persona: 'A harbour rat with a sending\'s gift.',
        recentStory: [{ name: 'Narrator', text: 'The tide turns.' }], device: { present: true, name: 'phone', channel: 'text' }, canReject: true, clockLabel: 'Dusk',
    });
    assert.equal(messages[0].role, 'system');
    assert.match(messages[0].content, /CHANNEL: mind to mind/u);
    assert.match(messages[0].content, /reply with the single line \[rejects\]/u);
    assert.match(messages[0].content, /<PERSON>[\s\S]*Clear the slate/u);
    assert.match(messages[0].content, /<RECENT_STORY>\nNarrator: The tide turns\./u);
    assert.match(messages[0].content, /Mara Venn is at Salt Lantern\. Jet is at Old Quay\. Story time: Dusk\./u);
    assert.deepEqual(messages.slice(1).map(message => [message.role, message.content]), [
        ['user', 'Mara. Can you hear me?'],
        ['assistant', 'Get out of my head.'],
        ['user', 'One question, then I go.'],
    ]);
    const open = buildPrivateReplyMessages({ thread: createThread('Mara Venn', 'text'), playerName: 'Jet', personBrief: brief.text, device: { present: true, name: 'phone', channel: 'text' } });
    assert.match(open[0].content, /CHANNEL: a phone message/u);
    assert.doesNotMatch(open[0].content, /\[rejects\]/u);
    assert.deepEqual(open.slice(1), [{ role: 'user', content: '(waits)' }], 'a chat model always gets a user turn');
    const aside = buildPrivateReplyMessages({ thread: createThread('Mara Venn', 'aside'), playerName: 'Jet', personBrief: brief.text, placeName: 'Salt Lantern' });
    assert.match(aside[0].content, /CHANNEL: a quiet word in person\. Mara Venn and Jet are talking privately, apart from anyone else at Salt Lantern/u);

    const text = buildPrivateReplyTextPrompt({ thread, playerName: 'Jet', personBrief: brief.text, personLocation: brief.location, canReject: true });
    assert.match(text.prompt, /^\[ A private mind-speech between Jet and Mara Venn/u);
    assert.match(text.prompt, /\nJet: Mara\. Can you hear me\?\nMara Venn: Get out of my head\.\nJet: One question, then I go\.$/u);
    assert.equal(text.prefill, 'Mara Venn:');
    assert.deepEqual(text.stop, ['\nJet:']);
});

test('replies become bubbles: labels and the player\'s lines are stripped, marks become outcomes', () => {
    const options = { personName: 'Mara Venn', playerName: 'Jet', channel: 'text' };
    assert.deepEqual(parsePersonReply('Mara Venn: Aye. Why?\nMara: Don\'t tell me you lost the key.\nJet: I didn\'t.\nMara: Good.', options), {
        bubbles: ['Aye. Why?', 'Don\'t tell me you lost the key.'], rejected: false, ended: false,
    });
    assert.deepEqual(parsePersonReply('**Mara Venn:** "Still here."\n*puts the phone down*\n[ends]', options), { bubbles: ['Still here.'], rejected: false, ended: true });
    assert.deepEqual(parsePersonReply('```\n[rejects]\n```', { ...options, channel: 'mind' }), { bubbles: [], rejected: true, ended: false });
    assert.deepEqual(parsePersonReply('[rejects] Not you. Not now.', { ...options, channel: 'mind' }), { bubbles: ['Not you. Not now.'], rejected: true, ended: false });
    assert.deepEqual(parsePersonReply('<think>She is annoyed.</think>\n- Fine.\n- Come round the back.', options), { bubbles: ['Fine.', 'Come round the back.'], rejected: false, ended: false });
    const aside = parsePersonReply('*wipes the bar* Keep your voice down. *glances at the door*', { ...options, channel: 'aside' });
    assert.deepEqual(aside.bubbles, ['*wipes the bar* Keep your voice down. *glances at the door*'], 'a quiet word keeps its beats');
    const many = parsePersonReply('one\ntwo\nthree\nfour\nfive\nsix', options);
    assert.equal(many.bubbles.length, 4);
    assert.equal(sharedNumber('Fine. 0771 442 118. Don\'t ring after ten.'), '0771 442 118');
    assert.equal(sharedNumber('It\'s +44 7700 900123, lose it and I\'ll know.'), '+44 7700 900123');
    assert.equal(sharedNumber('Room 12, at 4 o\'clock.'), null);
    assert.equal(sharedNumber('In 1842 the quay burned.'), null);
});

test('the story gets a plain transcript, which the scene ignores and the card renders as bubbles', () => {
    const thread = createThread('Mara Venn', 'text');
    appendBubble(thread, 'player', 'you still at the Lantern?');
    appendBubble(thread, 'person', 'Aye. Why?');
    appendBubble(thread, 'person', 'Door\'s barred at ten.');
    const text = renderTranscript(thread, { playerName: 'Jet', bubbles: pendingBubbles(thread), outcome: 'ended' });
    assert.equal(text, '[Text messages between Jet and Mara Venn]\nJet: you still at the Lantern?\nMara Venn: Aye. Why?\nMara Venn: Door\'s barred at ten.\n[Mara Venn stops answering.]');
    const mind = renderTranscript(createThread('Mara Venn', 'mind'), { playerName: 'Jet', bubbles: [{ from: 'player', text: 'Mara?' }], outcome: 'rejected' });
    assert.match(mind, /^\[Mind-speech between Jet and Mara Venn: thoughts passed in silence\]\nJet: Mara\?\n\[Mara Venn shuts Jet out of their mind\.\]$/u);
    const parsed = parseTranscript(text);
    assert.equal(parsed.header, 'Text messages between Jet and Mara Venn');
    assert.deepEqual(parsed.lines.map(line => line.name), ['Jet', 'Mara Venn', 'Mara Venn']);
    assert.deepEqual(parsed.notes, ['Mara Venn stops answering.']);
    const card = renderPrivateCard(text, { playerName: 'Jet', channel: 'text' });
    assert.match(card, /class="il-private-card is-text"/u);
    assert.match(card, /is-player">you still at the Lantern\?/u);
    assert.match(card, /is-person" data-name="Mara Venn">Aye\. Why\?/u);
    assert.match(card, /is-note">Mara Venn stops answering\./u);

    // In the chat, the transcript is a message from the person; the scene does not read it as narration.
    const store = world();
    const chat = [
        { is_user: true, name: 'Jet', mes: 'I walk down to the Old Quay and look at the boats.' },
        { is_user: false, name: 'Narrator', mes: 'Jet reaches the Old Quay. Old Fen is mending a net on the steps.' },
        { is_user: false, name: 'Mara Venn', mes: '[Text messages between Jet and Mara Venn]\nJet: still at the Lantern?\nMara Venn: Aye, come back to the Salt Lantern before ten.', extra: { [PRIVATE_EXTRA_KEY]: { person: 'Mara Venn', channel: 'text' } } },
    ];
    const scene = deriveSceneState(chat, store, { currentIndex: 2, playerName: 'Jet', lookbackMessages: 4 });
    assert.equal(scene.location.name, 'Old Quay');
    assert.deepEqual(scene.participants.map(person => person.name).sort(), ['Jet', 'Old Fen']);
    const transcript = formatTranscript(chat, { startIndex: 0, endIndex: 2, userName: 'Jet', characterName: 'Narrator' });
    assert.match(transcript, /\[message 2; PRIVATE EXCHANGE — Mara Venn \(by message device; the lines are what each said\)\]\n\[Text messages between Jet and Mara Venn\]/u);
});

test('the phone screen lists conversations, the people who can be reached and the contacts', () => {
    const thread = createThread('Mara Venn', 'text');
    appendBubble(thread, 'player', 'you still at the Lantern?');
    appendBubble(thread, 'person', 'Aye. Why?');
    const home = renderPhoneHome({
        playerName: 'Jet', deviceKnown: true, devicePresent: true, deviceName: 'Phone', mind: { ok: true },
        threads: [threadPreview(thread)],
        contacts: [{ name: 'Mara Venn', number: '0771 442 118', note: '' }],
        reachable: [{ name: 'Mara Venn', channels: [{ channel: 'text' }, { channel: 'mind' }], present: false, location: 'Salt Lantern' }, { name: 'Old Fen', channels: [{ channel: 'mind', unknown: true }], present: true }],
    });
    assert.match(home, /data-thread="mara venn:text"/u);
    assert.match(home, /Aye\. Why\?/u);
    assert.match(home, /data-start="text"/u);
    assert.match(home, /data-start="mind" title="Mind \(to be settled\)">Mind…/u);
    assert.match(home, /Here with you/u);
    assert.match(home, /0771 442 118/u);
    const unsettled = renderPhoneHome({ playerName: 'Jet', deviceKnown: false, devicePresent: false, deviceName: 'Phone', threads: [], contacts: [], reachable: [] });
    assert.match(unsettled, /not settled yet/u);
    const log = renderThreadLog({ ...thread, status: 'rejected' }, { typing: true });
    assert.match(log, /is-player is-pending">you still at the Lantern\?/u);
    assert.match(log, /shut you out\./u);
    assert.match(log, /il-sms-typing/u);
    assert.equal(CHANNELS.mind.composer, 'Think');
});
