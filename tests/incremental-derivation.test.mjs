import assert from 'node:assert/strict';
import test from 'node:test';

import {
    applyStoreCheckpoint,
    createEmptyStore,
    createStoreCheckpoint,
    firstDivergenceIndex,
    mergeEntityOperations,
    pruneCheckpointLadder,
    recordCheckpoint,
    selectResumeCheckpoint,
    snapshotMessageRange,
} from '../core.js';

const msg = (text, { user = false } = {}) => ({ is_user: user, is_system: false, name: user ? 'Jet' : 'Narrator', mes: text });

function seededStore(index) {
    const store = createEmptyStore('cp-chat');
    store.lastProcessedIndex = index;
    mergeEntityOperations(store, [{ type: 'location', name: `Place ${index}`, importance: 50, facts: [`fact ${index}`] }], { messageIndex: index, minimumImportance: 0 });
    return store;
}

test('createStoreCheckpoint / applyStoreCheckpoint round-trips derived state independently', () => {
    const store = seededStore(4);
    store.processedFingerprints = { 0: 'a', 4: 'b' };
    const checkpoint = createStoreCheckpoint(store);
    assert.equal(checkpoint.index, 4);
    assert.ok(checkpoint.entities['location:place 4'], 'entities captured');

    // Mutating the live store must not affect the checkpoint (deep copy).
    store.entities['location:place 4'].facts.push('mutated after checkpoint');
    assert.equal(checkpoint.entities['location:place 4'].facts.length, 1, 'checkpoint is an independent deep copy');

    const restored = createEmptyStore('cp-chat');
    applyStoreCheckpoint(restored, checkpoint);
    assert.equal(restored.lastProcessedIndex, 4);
    assert.deepEqual(restored.processedFingerprints, { 0: 'a', 4: 'b' });
    assert.ok(restored.entities['location:place 4'], 'restored entities present');
    restored.entities['location:place 4'].facts.push('x');
    assert.equal(checkpoint.entities['location:place 4'].facts.length, 1, 'restore is also an independent deep copy');
});

test('firstDivergenceIndex finds the earliest edited, deleted, or intact index', () => {
    const chat = [msg('a'), msg('b', { user: true }), msg('c'), msg('d', { user: true }), msg('e')];
    const fingerprints = snapshotMessageRange(chat, 0, 4);

    assert.equal(firstDivergenceIndex(chat, fingerprints), Number.POSITIVE_INFINITY, 'unchanged chat has no divergence');

    const edited = [...chat];
    edited[3] = msg('d edited', { user: true });
    assert.equal(firstDivergenceIndex(edited, fingerprints), 3, 'edit is detected at its index');

    const earlierEdit = [...edited];
    earlierEdit[1] = msg('b edited', { user: true });
    assert.equal(firstDivergenceIndex(earlierEdit, fingerprints), 1, 'earliest divergence wins');

    const truncated = chat.slice(0, 3); // messages 3,4 deleted
    assert.equal(firstDivergenceIndex(truncated, fingerprints), 3, 'deleted tail diverges at first missing index');
});

test('selectResumeCheckpoint picks the newest valid checkpoint before divergence', () => {
    const chat = [msg('a'), msg('b', { user: true }), msg('c'), msg('d', { user: true }), msg('e'), msg('f', { user: true })];
    const cp2 = createStoreCheckpoint(Object.assign(seededStore(2), { processedFingerprints: snapshotMessageRange(chat, 0, 2) }));
    const cp4 = createStoreCheckpoint(Object.assign(seededStore(4), { processedFingerprints: snapshotMessageRange(chat, 0, 4) }));
    const checkpoints = [cp2, cp4];

    // Divergence at index 5 -> newest checkpoint before it (index 4) is chosen.
    assert.equal(selectResumeCheckpoint(checkpoints, chat, 5)?.index, 4);
    // Divergence at index 3 -> only checkpoint 2 qualifies.
    assert.equal(selectResumeCheckpoint(checkpoints, chat, 3)?.index, 2);
    // Divergence at index 1 -> no checkpoint before it.
    assert.equal(selectResumeCheckpoint(checkpoints, chat, 1), null);
});

test('selectResumeCheckpoint rejects a checkpoint from a discarded branch', () => {
    const chat = [msg('a'), msg('b', { user: true }), msg('c'), msg('d', { user: true }), msg('e')];
    // Checkpoint recorded on a different branch: its fingerprints do not match.
    const stale = createStoreCheckpoint(Object.assign(seededStore(3), { processedFingerprints: { 0: 'x', 1: 'y', 2: 'z', 3: 'w' } }));
    assert.equal(selectResumeCheckpoint([stale], chat, 4), null, 'a checkpoint whose history no longer matches is unusable');
});

test('pruneCheckpointLadder keeps oldest and newest and thins the densest interior', () => {
    const cps = [0, 1, 2, 3, 10, 20].map(index => ({ index }));
    const pruned = pruneCheckpointLadder(cps, 4);
    const indices = pruned.map(c => c.index);
    assert.equal(pruned.length, 4);
    assert.ok(indices.includes(0), 'keeps oldest');
    assert.ok(indices.includes(20), 'keeps newest');
    // The tightly packed 0,1,2,3 cluster should be thinned before the spread tail.
    assert.ok(indices.includes(10) && indices.includes(20), 'coarse tail retained');
});

test('recordCheckpoint replaces same-index entries and bounds the ladder', () => {
    let ladder = [];
    for (const index of [0, 5, 10, 15, 20, 25, 30]) {
        ladder = recordCheckpoint(ladder, { index, tag: `v-${index}` }, 4);
    }
    assert.ok(ladder.length <= 4, 'ladder is bounded');

    // Re-recording an existing index replaces it rather than duplicating.
    const withDup = recordCheckpoint(ladder, { index: ladder.at(-1).index, tag: 'replaced' }, 4);
    assert.equal(withDup.filter(c => c.index === ladder.at(-1).index).length, 1);
    assert.equal(withDup.find(c => c.index === ladder.at(-1).index).tag, 'replaced');
});
