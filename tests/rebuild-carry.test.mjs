import assert from 'node:assert/strict';
import test from 'node:test';

import { createEmptyStore, messageFingerprint, snapshotMessageRange } from '../core.js';
import { CHECKPOINT_INTERVAL_MESSAGES, REBUILD_BATCH_MESSAGES, carryIdentity, carryUntouchedRecords, maybeRecordCheckpoint, rebuildStore } from '../pass-pipeline.js?v=5';

const message = (index, user = false) => ({ is_user: user, is_system: false, name: user ? 'Chris' : 'Narrator', mes: `${user ? 'Player' : 'Story'} line ${index}.` });

function chatOf(length) {
    return Array.from({ length }, (_, index) => message(index, index % 2 === 1));
}

function oldWorld(chat) {
    const store = createEmptyStore('chat-1');
    const fingerprints = snapshotMessageRange(chat, 0, chat.length - 1);
    store.processedFingerprints = fingerprints;
    store.lastProcessedIndex = chat.length - 1;
    store.entities['character:oriel vance'] = { id: 'character:oriel vance', type: 'character', name: 'Oriel Vance', aliases: [], enabled: true, importance: 70, firstSeenMessage: 2, lastSeenMessage: 6 };
    store.entities['character:bryn tolley'] = { id: 'character:bryn tolley', type: 'character', name: 'Bryn Tolley', aliases: [], enabled: true, importance: 55, firstSeenMessage: 10, lastSeenMessage: 10 };
    store.entities['character:wren hollis'] = { id: 'character:wren hollis', type: 'character', name: 'Wren Hollis', aliases: ['the dock crier'], keys: ['the dock crier', 'Wren Hollis'], enabled: true, importance: 50, firstSeenMessage: 2, lastSeenMessage: 12 };
    store.entities['character:late'] = { id: 'character:late', type: 'character', name: 'Late Arrival', aliases: [], enabled: true, importance: 50, firstSeenMessage: 13, lastSeenMessage: 13 };
    store.brains['bryn tolley'] = { id: 'bryn tolley', name: 'Bryn Tolley', aliases: [], firstSeenMessage: 10, lastSeenMessage: 10, persistentSelf: { facets: {}, voice: {}, relationships: {} } };
    store.portraits = { 'the dock crier': { name: 'the dock crier', path: '/user/images/InnerLore/crier.webp', seed: 1, at: 1 } };
    return store;
}

/** A curator stand-in that re-reads only Wren, without her old alias (what the real rebuild did). */
function forgetfulAnalyze(batches) {
    return async (target, start, end) => {
        batches.push([start, end]);
        target.entities['character:wren hollis'] = { id: 'character:wren hollis', type: 'character', name: 'Wren Hollis', aliases: [], keys: ['Wren Hollis'], enabled: true, importance: 50, firstSeenMessage: 8, lastSeenMessage: end };
        target.lastProcessedIndex = end;
        Object.assign(target.processedFingerprints, {});
        return { entityResult: { created: 1, updated: 0, changedIds: [] } };
    };
}

const settings = { lookbackMessages: 30, innerSelfEnabled: true, autoLoreEnabled: true, worldProgressionEnabled: false, enabledEntityTypes: ['character', 'location'] };

test('an automatic rebuild with nothing diverged replays nothing', async () => {
    const chat = chatOf(14);
    const result = await rebuildStore({ chat, oldStore: oldWorld(chat), settings, automatic: true, analyze: async () => { throw new Error('must not replay'); } });
    assert.equal(result.nothingToRebuild, true);
    assert.equal(result.store, null);
});

test('a rebuild after a late change keeps people seen only before it, and every name a record was known by', async () => {
    const chat = chatOf(14);
    const old = oldWorld(chat);
    chat[13] = { ...chat[13], mes: 'A different reply.' };
    const batches = [];
    const result = await rebuildStore({ chat, oldStore: old, settings, automatic: true, analyze: forgetfulAnalyze(batches) });
    const store = result.store;
    assert.ok(store.entities['character:oriel vance'], 'Elka (last seen at 6) is kept');
    assert.ok(store.entities['character:bryn tolley'], 'Bryn (last seen at 10) is kept');
    assert.ok(store.brains['bryn tolley'], 'and her mind');
    assert.equal(store.entities['character:late'], undefined, 'a record seen after the change is not kept');
    assert.deepEqual(store.entities['character:wren hollis'].aliases, ['the dock crier'], 'Wren keeps the name her portrait is filed under');
    assert.ok(store.entities['character:wren hollis'].keys.includes('the dock crier'));
    assert.equal(store.portraits['the dock crier'].path, '/user/images/InnerLore/crier.webp');
    assert.ok(batches.every(([start, end]) => end - start + 1 <= REBUILD_BATCH_MESSAGES), `batches stay small: ${JSON.stringify(batches)}`);
});

test('a manual rebuild starts fresh but still keeps names', async () => {
    const chat = chatOf(14);
    const result = await rebuildStore({ chat, oldStore: oldWorld(chat), settings, automatic: false, analyze: forgetfulAnalyze([]) });
    assert.equal(result.store.entities['character:oriel vance'], undefined, 'a manual rebuild re-reads everything');
    assert.deepEqual(result.store.entities['character:wren hollis'].aliases, ['the dock crier']);
});

test('carry helpers skip records of unknown provenance and records the re-read merged under another name', () => {
    const old = createEmptyStore('c');
    old.entities['character:ghost'] = { id: 'character:ghost', type: 'character', name: 'Ghost', firstSeenMessage: -1, lastSeenMessage: -1 };
    old.entities['character:the crier'] = { id: 'character:the crier', type: 'character', name: 'the crier', firstSeenMessage: 1, lastSeenMessage: 2 };
    const fresh = createEmptyStore('c');
    fresh.entities['character:wren'] = { id: 'character:wren', type: 'character', name: 'Wren', aliases: ['the crier'] };
    assert.equal(carryUntouchedRecords(old, fresh, 5), 0);
    carryIdentity(old, fresh);
    assert.deepEqual(fresh.entities['character:wren'].aliases, ['the crier']);
});

test('checkpoints are recorded every few messages, not once a lookback window', () => {
    const store = createEmptyStore('c');
    store.lastProcessedIndex = CHECKPOINT_INTERVAL_MESSAGES - 1;
    maybeRecordCheckpoint(store, { lookbackMessages: 30 });
    assert.equal(store.checkpoints.length, 1);
    store.lastProcessedIndex += CHECKPOINT_INTERVAL_MESSAGES;
    maybeRecordCheckpoint(store, { lookbackMessages: 30 });
    assert.equal(store.checkpoints.length, 2);
    assert.equal(messageFingerprint({ mes: 'x' }).length > 0, true);
});
