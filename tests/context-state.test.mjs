import assert from 'node:assert/strict';
import test from 'node:test';

import {
    createLocalContextPacket,
    INNERLORE_CONTEXT_MACROS,
    macroContextValue,
    normalizePreparedContext,
    selectedContextPacket,
} from '../context-state.js';

test('prepared SQLite context wins only for the exact branch/revision key', () => {
    const local = createLocalContextPacket({
        text: '<local>fallback</local>',
        blocks: { scene: 'local scene', minds: 'local minds', lore: 'local lore', progression: 'local progression' },
        scene: { location: { name: 'Fallback room' } },
    }, 'world:4:main:head-a:balanced');
    const prepared = normalizePreparedContext({
        rendered: '<server>canonical</server>', json: '{"canonical":true}',
        sections: { scene: 'server scene', minds: 'server minds', lore: 'server lore', progression: 'server progression' },
        revision: 4,
    }, 'world:4:main:head-a:balanced');

    assert.equal(selectedContextPacket({ prepared, local, key: prepared.key }).source, 'server');
    assert.equal(selectedContextPacket({ prepared, local, key: 'world:4:main:head-b:balanced' }), null);
    assert.equal(macroContextValue('innerlore_state_context', {
        enabled: true, deliveryMode: 'macro', prepared, local, key: prepared.key,
    }), '<server>canonical</server>');
    assert.equal(macroContextValue('innerlore_npc_context', {
        enabled: true, deliveryMode: 'macro', prepared, local, key: prepared.key,
    }), 'server minds');
});

test('macros are synchronous, empty in automatic mode, and locally fail safe', () => {
    const key = 'world:1:main:head:balanced';
    const local = createLocalContextPacket({ text: 'fallback', blocks: { lore: 'fallback lore' } }, key);
    for (const name of Object.keys(INNERLORE_CONTEXT_MACROS)) {
        const value = macroContextValue(name, { enabled: true, deliveryMode: 'macro', local, key });
        assert.equal(typeof value, 'string');
        assert.equal(value instanceof Promise, false);
        assert.equal(macroContextValue(name, { enabled: true, deliveryMode: 'automatic', local, key }), '');
        assert.equal(macroContextValue(name, { enabled: false, deliveryMode: 'macro', local, key }), '');
    }
    assert.equal(macroContextValue('innerlore_lore_context', {
        enabled: true, deliveryMode: 'macro', local, key,
    }), 'fallback lore');
});
