import assert from 'node:assert/strict';
import test from 'node:test';

import {
    MIND_LEVELS,
    communicationRules,
    defaultCommunicationRules,
    mindAccess,
    normalizeCommunication,
    startingCommunicationOps,
} from '../communication.js?v=1';

test('a world\'s settings are completed with the defaults and checked', () => {
    assert.deepEqual(normalizeCommunication(null), { text: true, startPhone: 'story', deviceName: 'phone', mind: true, startMind: 'story', mindKnowledge: 'rare', rules: '' });
    assert.deepEqual(normalizeCommunication({ text: false, startPhone: 'maybe', deviceName: '  Sending Stone ', mind: true, startMind: 'adept', mindKnowledge: 'secret', rules: '  Mages whisper.  ' }),
        { text: false, startPhone: 'story', deviceName: 'sending stone', mind: true, startMind: 'adept', mindKnowledge: 'secret', rules: 'Mages whisper.' });
    assert.equal(normalizeCommunication({ startMind: 'godlike' }).startMind, 'story');
});

test('the default rules follow the world\'s choices, and the player\'s own rules replace them', () => {
    const both = defaultCommunicationRules({});
    assert.match(both, /People reach each other by phone/u);
    assert.match(both, /known to exist but rare/u);
    assert.match(both, /as strong as the reacher's gift can shut the contact out/u);
    assert.match(both, /A master's contact cannot be blocked or ignored/u);
    const secret = defaultCommunicationRules({ text: false, mindKnowledge: 'secret' });
    assert.match(secret, /^MESSAGES FROM AFAR: none\./u);
    assert.match(secret, /a voice in their head is frightening and strange/u);
    assert.match(defaultCommunicationRules({ mind: false, deviceName: 'sending stone', mindKnowledge: 'common' }), /reach each other by sending stone[\s\S]*MIND-SPEECH: none\./u);
    assert.match(defaultCommunicationRules({ mindKnowledge: 'common' }), /common knowledge/u);
    assert.equal(communicationRules({ rules: 'Only the bonded can speak mind to mind.' }), 'Only the bonded can speak mind to mind.');
    assert.equal(communicationRules({}), both);
});

test('a world that fixes the player\'s device or gift starts each save with it; one that leaves it to the story does not', () => {
    assert.deepEqual(startingCommunicationOps({}), [], 'the story decides');
    const fixed = startingCommunicationOps({ startPhone: 'yes', deviceName: 'comm', startMind: 'novice' });
    assert.deepEqual(fixed.map(op => [op.type, op.present ?? op.level]), [['device.set', true], ['ability.set', MIND_LEVELS.novice]]);
    assert.equal(fixed[0].name, 'comm');
    assert.equal(fixed[1].holder.kind, 'player');
    assert.deepEqual(startingCommunicationOps({ text: false, mind: false }).map(op => [op.type, op.present ?? op.level]), [['device.set', false], ['ability.set', 0]], 'a system the world lacks is settled as absent');
    assert.deepEqual(startingCommunicationOps({ startPhone: 'no', startMind: 'none' }).map(op => [op.type, op.present ?? op.level]), [['device.set', false], ['ability.set', 0]]);
    assert.deepEqual(startingCommunicationOps({ startPhone: 'yes', startMind: 'master' }, { deviceKnown: true, mindKnown: true }), [], 'what the game already settled stands');
});

test('reaching a mind: consent opens it, a guard as strong as the reach can shut it, a master cannot be shut out', () => {
    // A low-level mage reaching an ordinary person: they cannot block it, though they may not answer.
    assert.deepEqual(
        (({ consented, overwhelming, canBlock }) => ({ consented, overwhelming, canBlock }))(mindAccess({ playerLevel: 30, ward: 0, gift: 0 })),
        { consented: false, overwhelming: false, canBlock: false },
    );
    // The same mage reaching someone warded more strongly: they can shut it out.
    assert.equal(mindAccess({ playerLevel: 30, ward: 45 }).canBlock, true);
    assert.equal(mindAccess({ playerLevel: 30, gift: 30 }).canBlock, true, 'their own gift guards them as well as a ward');
    // With consent, nothing is contested.
    const welcome = mindAccess({ playerLevel: 30, ward: 60, consent: 'granted' });
    assert.equal(welcome.consented, true);
    assert.equal(welcome.canBlock, false);
    // A master, or a reach far past the guard, cannot be shut out.
    assert.equal(mindAccess({ playerLevel: 95, ward: 90 }).overwhelming, true);
    assert.equal(mindAccess({ playerLevel: 95, ward: 90 }).canBlock, false);
    assert.equal(mindAccess({ playerLevel: 70, ward: 25 }).overwhelming, true);
    assert.equal(mindAccess({ playerLevel: 50, ward: 25 }).overwhelming, false);
    // Expected: by consent, or in a world where it is common and they have the gift.
    assert.equal(mindAccess({ playerLevel: 30, gift: 40, knowledge: 'common' }).expected, true);
    assert.equal(mindAccess({ playerLevel: 30, gift: 40, knowledge: 'secret' }).expected, false);
    assert.equal(mindAccess({ playerLevel: 30, consent: 'refused' }).refused, true);
});
