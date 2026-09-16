import assert from 'node:assert/strict';
import test from 'node:test';

import {
    applyContextProfileToSettings,
    approximateContextTokens,
    BUILTIN_CONTEXT_PROFILES,
    contextConfigurationFingerprint,
    contextProfileOverrides,
    setCustomContextMaximum,
} from '../context-config.js';

test('built-in context profiles map to exact unified packet limits', () => {
    assert.equal(BUILTIN_CONTEXT_PROFILES.compact.maximumCharacters, 9_000);
    assert.equal(BUILTIN_CONTEXT_PROFILES.balanced.maximumCharacters, 18_000);
    assert.equal(BUILTIN_CONTEXT_PROFILES.expansive.maximumCharacters, 32_000);
    const settings = {};
    applyContextProfileToSettings(settings, { id: 'balanced', config: BUILTIN_CONTEXT_PROFILES.balanced });
    assert.equal(settings.contextBudgetMode, 'profile');
    assert.equal(settings.contextMaximumCharacters, 18_000);
    assert.equal(settings.brainInjectionBudget, 6_500);
    assert.equal(contextProfileOverrides(settings).maximumCharacters, undefined,
        'profile mode must let the server profile own its numeric limits');
    assert.equal(approximateContextTokens(18_000), 4_500);
});

test('the global context control creates a custom hard cap and invalidates the configuration fingerprint', () => {
    const settings = {};
    applyContextProfileToSettings(settings, { id: 'balanced', config: BUILTIN_CONTEXT_PROFILES.balanced });
    const before = contextConfigurationFingerprint(settings);
    setCustomContextMaximum(settings, 23_000);
    const overrides = contextProfileOverrides(settings);
    assert.equal(settings.contextBudgetMode, 'custom');
    assert.equal(settings.contextMaximumCharacters, 23_000);
    assert.equal(overrides.maximumCharacters, 23_000);
    assert.notEqual(contextConfigurationFingerprint(settings), before);
    settings.loreInjectionBudget += 250;
    assert.notEqual(contextConfigurationFingerprint(settings), contextConfigurationFingerprint({
        ...settings,
        loreInjectionBudget: settings.loreInjectionBudget - 250,
    }));
});
