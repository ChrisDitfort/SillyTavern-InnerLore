import assert from 'node:assert/strict';
import test from 'node:test';

import {
    createEmptyStore,
    mergeEntityOperations,
    mergeMindOperations,
    reconcileAnchoredBrains,
} from '../core.js';

test('a short-named foundation brain anchors to its full character entity', () => {
    const store = createEmptyStore('anchored-brains');
    // Foundation pass (greeting only, no entities yet): story calls her Elka Draven.
    mergeMindOperations(store, [{
        character: 'Elka Draven',
        set: [{ key: 'gate_duty', kind: 'belief', statement: 'The gate is mine to hold.', confidence: 'confirmed' }],
    }], { messageIndex: 0, maximumOperations: 5, maximumThoughts: 10 });
    // Curator pass: entity named from the badge introduction.
    mergeEntityOperations(store, [{
        type: 'character', name: 'Warden-Captain Elka Draven', importance: 60,
        summary: 'Warden-captain of the Vigil Cross gate.',
    }], { messageIndex: 0, minimumImportance: 0, maximumOperations: 5 });
    mergeMindOperations(store, [{
        character: 'Warden-Captain Elka Draven',
        set: [{ key: 'boring_is_career', kind: 'self_concept', statement: 'Boring survives; boring is a career.', confidence: 'confirmed' }],
    }], { messageIndex: 2, maximumOperations: 5, maximumThoughts: 10 });

    const before = Object.keys(store.brains);
    assert.ok(before.includes('elka draven'));

    const result = reconcileAnchoredBrains(store);
    assert.equal(result.anchored, 1);
    const keys = Object.keys(store.brains);
    assert.ok(!keys.includes('elka draven'), 'orphan brain removed');
    assert.ok(keys.includes('warden captain elka draven'), 'canonical brain present');
    const canonical = store.brains['warden captain elka draven'];
    assert.equal(canonical.persistentSelf.facets.gate_duty.statement, 'The gate is mine to hold.');
    assert.equal(canonical.persistentSelf.facets.boring_is_career.statement, 'Boring survives; boring is a career.');
});

test('single-word brains and unrelated names never anchor', () => {
    const store = createEmptyStore('anchored-brains-negative');
    mergeMindOperations(store, [{
        character: 'Draven',
        set: [{ key: 'x', kind: 'belief', statement: 'x', confidence: 'confirmed' }],
    }], { messageIndex: 0, maximumOperations: 5, maximumThoughts: 10 });
    mergeEntityOperations(store, [{
        type: 'character', name: 'Warden-Captain Elka Draven', importance: 60, summary: 'gate captain',
    }, {
        type: 'character', name: 'Marcus Vane', importance: 50, summary: 'someone else',
    }], { messageIndex: 0, minimumImportance: 0, maximumOperations: 5 });
    const result = reconcileAnchoredBrains(store);
    assert.equal(result.anchored, 0);
    assert.ok(store.brains['draven'], 'single-word brain untouched');
});
