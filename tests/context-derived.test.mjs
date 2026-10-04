import assert from 'node:assert/strict';
import test from 'node:test';

import { compileContext } from '../context-compiler.js';
import {
    createEmptyStore,
    mergeEntityOperations,
    mergeMindOperations,
} from '../core.js';
import { createProgressionState } from '../progression.js';
import {
    contextProfileOverrides,
    DERIVED_SHARE_DEFAULTS,
    deriveContextBudgets,
} from '../context-config.js';

test('deriveContextBudgets splits the remainder after fixed costs across all six shares', () => {
    const result = deriveContextBudgets(
        { contextLimitTokens: 8_192, staticPromptCharacters: 4_096 },
        { derivedSafetyMarginPercent: 10 },
    );
    assert.ok(result);
    // Statics are 1,024 tokens; the 10% margin shaves the rest.
    assert.equal(result.staticTokens, 1_024);
    const expectedGross = Math.floor((8_192 - 1_024) * 0.9);
    assert.equal(result.grossTokens, expectedGross);
    const shareTotal = Object.values(DERIVED_SHARE_DEFAULTS).reduce((sum, value) => sum + value, 0);
    assert.equal(shareTotal, 100);
    assert.equal(result.responseTokens, Math.floor(expectedGross * DERIVED_SHARE_DEFAULTS.response / 100));
    assert.equal(result.historyCharacters, Math.floor(expectedGross * DERIVED_SHARE_DEFAULTS.history / 100) * 4);
    const sectionChars = Object.values(result.sections).reduce((sum, value) => sum + value, 0);
    assert.ok(Math.abs(sectionChars - result.maximumCharacters) < 8);
});

test('deriveContextBudgets normalizes non-100 shares and rejects impossible inputs', () => {
    const skewed = deriveContextBudgets(
        { contextLimitTokens: 8_192, staticPromptCharacters: 0 },
        { derivedSectionShares: { response: 0, history: 10, scene: 0, minds: 10, lore: 10, progression: 20 } },
    );
    assert.ok(skewed);
    assert.equal(skewed.responseTokens, 0);
    assert.ok(skewed.sections.scene === 0);

    assert.equal(deriveContextBudgets({ contextLimitTokens: 1_000, staticPromptCharacters: 0 }, {}), null);
    assert.equal(deriveContextBudgets({ contextLimitTokens: 8_192, staticPromptCharacters: 34_000 }, {}), null);
    assert.equal(deriveContextBudgets({}, {}), null);
});

test('derived context owns the overrides regardless of saved mode', () => {
    const derived = deriveContextBudgets({ contextLimitTokens: 8_192, staticPromptCharacters: 1_000 }, {});
    assert.ok(derived);
    const legacy = contextProfileOverrides({ enabled: true, contextBudgetMode: 'custom' });
    const derivedOverrides = contextProfileOverrides({
        enabled: true,
        contextBudgetMode: 'custom',
        derivedContext: derived,
        maximumInjectedEntities: 7,
    });
    assert.ok(!legacy.derived);
    assert.ok(derivedOverrides.derived);
    assert.equal(derivedOverrides.maximumCharacters, Math.max(2_000, derived.maximumCharacters));
    assert.equal(derivedOverrides.sections.minds.maximumCharacters, derived.sections.minds);
    assert.equal(derivedOverrides.sections.lore.maximumItems, 7);
});

function overflowingStore() {
    const store = createEmptyStore('derived-enforcement');
    const ops = [];
    for (let i = 0; i < 14; i++) {
        ops.push({
            type: 'character', name: `Speaker ${i + 1}`, importance: 90,
            summary: `A loud participant ${i}.`,
            description: 'detail '.repeat(200) + i,
            currentState: `Arguing in the hall ${i}.`,
        });
    }
    for (let i = 0; i < 20; i++) {
        ops.push({
            type: 'location', name: `Chamber ${i + 1}`, importance: 75,
            summary: `A contested chamber ${i}.`,
            description: 'stone '.repeat(200) + i,
            currentState: `Loud and crowded ${i}.`,
        });
    }
    mergeEntityOperations(store, ops, { minimumImportance: 0, maximumOperations: 40, messageIndex: 3 });
    for (let i = 0; i < 8; i++) {
        mergeMindOperations(store, [{
            character: `Speaker ${i + 1}`,
            set: Array.from({ length: 6 }, (_, t) => ({
                key: `thought_${t}`,
                category: 'goal',
                thought: `pressing thought ${t} ${'worry '.repeat(25)}`,
                confidence: 'confirmed',
                retention: 'durable',
            })),
        }], { messageIndex: 3, maximumOperations: 20, maximumThoughts: 40 });
    }
    const progression = createProgressionState();
    for (let i = 0; i < 40; i++) {
        progression.goals[`goal:g${i}`] = {
            key: `g${i}`, owner: `Speaker ${(i % 14) + 1}`, title: `Escalating goal ${i} ${'long '.repeat(10)}`,
            nextStep: 'Act at once.', status: 'active', deadlineState: 'unscheduled', progress: 10, priority: 80,
        };
    }
    store.progression = progression;
    return store;
}

test('compiled packet never exceeds the derived allowance under overflow pressure', () => {
    const derived = deriveContextBudgets({ contextLimitTokens: 6_144, staticPromptCharacters: 1_000 }, {});
    assert.ok(derived);
    const store = overflowingStore();
    const mention = [...Array.from({ length: 14 }, (_, i) => `Speaker ${i + 1}`), ...Array.from({ length: 20 }, (_, i) => `Chamber ${i + 1}`)].join('. Then ');
    const messages = [
        { is_user: true, name: 'Player', mes: `We enter and argue with everyone: ${mention}.` },
        { is_user: false, name: 'Narrator', mes: `Every place answers at once: ${mention}.` },
    ];
    const compiled = compileContext({
        store,
        messages,
        recentText: messages.map(m => m.mes).join('\n'),
        playerName: 'Player',
        currentIndex: messages.length - 1,
        settings: {
            enabled: true,
            innerSelfEnabled: true,
            autoLoreEnabled: true,
            worldProgressionEnabled: true,
            sceneContextEnabled: true,
            currentIndex: messages.length - 1,
            derivedContext: derived,
        },
    });
    assert.ok(
        compiled.characters <= derived.maximumCharacters,
        `packet ${compiled.characters} exceeded derived allowance ${derived.maximumCharacters}`,
    );
    assert.ok(compiled.selectedBrains.length > 0, 'overflow pressure must still render minds');
    assert.ok(compiled.selectedEntities.length > 0, 'overflow pressure must still render lore');
});
