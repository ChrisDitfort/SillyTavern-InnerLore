import assert from 'node:assert/strict';
import test from 'node:test';

import { collectRecentStoryExpressions } from '../expression-cooldown.js';

test('recent expression cooldown is branch-local, bounded, and excludes player/system memory', () => {
    const messages = [
        { is_user: false, name: 'Narrator', mes: 'Old reply that must age out.' },
        { is_user: true, name: 'Jet', mes: 'Player action must never become negative NPC expression.' },
        { is_system: true, extra: { sc_ghosted: true }, mes: 'Compressed summary must not become a style sample.' },
        { is_user: false, name: 'Narrator', mes: 'Freesia touches the river-stone and looks down. '.repeat(20) },
        { is_user: true, name: 'Jet', mes: 'Another player turn.' },
        { is_user: false, name: 'Narrator', mes: 'Freesia stammers, then studies the floorboards.' },
        { is_user: false, name: 'Narrator', mes: 'Freesia catches her hand before it reaches her pocket.' },
    ];

    const cooldown = collectRecentStoryExpressions(messages, {
        endIndex: messages.length - 1,
        maximumReplies: 3,
        maximumCharacters: 900,
    });

    assert.match(cooldown, /story message 3/u);
    assert.match(cooldown, /story message 5/u);
    assert.match(cooldown, /story message 6/u);
    assert.doesNotMatch(cooldown, /Old reply that must age out/u);
    assert.doesNotMatch(cooldown, /Player action must never/u);
    assert.doesNotMatch(cooldown, /Compressed summary/u);
    assert.ok(cooldown.length <= 900, `cooldown exceeded its budget: ${cooldown.length}`);
});
