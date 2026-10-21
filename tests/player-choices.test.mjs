import assert from 'node:assert/strict';
import test from 'node:test';

import { buildLatestTurnContract } from '../core.js';
import { CHOICES_EXTRA_KEY, extractReplyChoices, fallbackChoices, storedChoices } from '../player-choices.js';

const REPLY = 'The innkeeper wipes the counter and waits.';

test('a closed choices block leaves the story text and becomes choices', () => {
    const { text, choices } = extractReplyChoices(`${REPLY}\n\n\`\`\`choices\ngo: Head down to the harbour\ntalk: Ask the innkeeper about a room.\ndo: Pick up the dropped letter\nlook: Study the carved door\n\`\`\``);
    assert.equal(text, REPLY);
    assert.deepEqual(choices, [
        { kind: 'go', text: 'Head down to the harbour' },
        { kind: 'talk', text: 'Ask the innkeeper about a room' },
        { kind: 'do', text: 'Pick up the dropped letter' },
        { kind: 'look', text: 'Study the carved door' },
    ]);
});

test('a block cut off at the end of the reply still parses', () => {
    const { text, choices } = extractReplyChoices(`${REPLY}\n\`\`\`choices\n- go: Leave by the back door\n- Talk: Call to the stable boy`);
    assert.equal(text, REPLY);
    assert.deepEqual(choices.map(choice => choice.kind), ['go', 'talk']);
});

test('tagged choices, stray lines and extra moves are handled', () => {
    const lines = ['go: One', 'sing: Not a kind', 'talk: Two', 'do: Three', 'look: Four', 'go: Five', 'go: Six'];
    const { text, choices } = extractReplyChoices(`${REPLY}\n<choices>\n${lines.join('\n')}\n</choices>`);
    assert.equal(text, REPLY);
    assert.deepEqual(choices.map(choice => choice.text), ['One', 'Two', 'Three', 'Four', 'Five']);
});

test('a reply without a block is returned unchanged', () => {
    const story = `${REPLY}\n\n\`\`\`js\nconst x = 1;\n\`\`\``;
    assert.deepEqual(extractReplyChoices(story), { text: story, choices: [] });
});

test('fallback moves come from the camera frame', () => {
    const choices = fallbackChoices({
        waysOn: [{ name: 'The Harbour', relation: 'also in Port Vell' }, { name: '', relation: 'A door leads out back.' }, { name: 'The Lighthouse', relation: 'inside' }, { name: 'Old Quay', relation: 'inside' }],
        withYou: [{ name: 'Mara' }, { name: 'Tobin' }, { name: 'Ilse' }],
        objects: ['brass key'],
    });
    assert.deepEqual(choices.map(choice => choice.text), [
        'Go to The Harbour', 'Go to The Lighthouse', 'Talk to Mara', 'Talk to Tobin', 'Look at brass key',
    ]);
    assert.deepEqual(fallbackChoices(null), []);
});

test('stored choices are validated', () => {
    const message = { extra: { [CHOICES_EXTRA_KEY]: [{ kind: 'go', text: 'Head out' }, { kind: 'fly', text: 'Nope' }, { kind: 'do', text: '' }] } };
    assert.deepEqual(storedChoices(message), [{ kind: 'go', text: 'Head out' }]);
    assert.deepEqual(storedChoices({}), []);
});

test('guided play adds the command and choices rule to the latest-turn contract', () => {
    const chat = [{ is_user: true, name: 'Jet', mes: 'ask the innkeeper about a room' }];
    assert.match(buildLatestTurnContract(chat, { guidedPlay: true }), /GUIDED PLAY:[\s\S]*```choices[\s\S]*<\/latest_turn_contract>$/u);
    assert.doesNotMatch(buildLatestTurnContract(chat, {}), /GUIDED PLAY/u);
});
