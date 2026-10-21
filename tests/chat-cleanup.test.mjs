import assert from 'node:assert/strict';
import test from 'node:test';

import { hashString } from '../core.js';
import { deleteInnerLorebooksForChat } from '../lorebook.js';

test('deleted-chat cleanup removes legacy, owned, and renamed InnerLore books only', async () => {
    const chatId = 'Dani - cleanup test';
    const otherChatId = 'Dani - another chat';
    const legacyName = `InnerLore - Dani - ${hashString(chatId)}`;
    const unrelatedName = `InnerLore - Dani - ${hashString(otherChatId)}`;
    const renamedName = 'Dani continuity archive';
    const ordinaryName = 'Shared campaign lore';
    const books = new Map([
        [legacyName, { entries: {} }],
        [unrelatedName, {
            entries: {},
            extensions: { innerLore: { version: 1, managed: true, chatId: otherChatId } },
        }],
        [renamedName, {
            entries: {},
            extensions: { innerLore: { version: 1, managed: true, chatId } },
        }],
        [ordinaryName, { entries: {} }],
    ]);
    const deleted = [];

    globalThis.SillyTavern = {
        getContext: () => ({
            getWorldInfoNames: () => [...books.keys()],
            loadWorldInfo: async name => books.get(name) || null,
        }),
    };

    const result = await deleteInnerLorebooksForChat(chatId, {
        registeredNames: [renamedName],
        deleteWorldInfo: async name => {
            if (!books.has(name)) return false;
            deleted.push(name);
            books.delete(name);
            return true;
        },
    });

    assert.deepEqual(new Set(result.deleted), new Set([legacyName, renamedName]));
    assert.deepEqual(result.failed, []);
    assert.deepEqual(new Set(deleted), new Set([legacyName, renamedName]));
    assert.equal(books.has(unrelatedName), true, 'another chat\'s InnerLore book must survive');
    assert.equal(books.has(ordinaryName), true, 'ordinary World Info must survive');
});

test('failed generated-book deletion is reported for persistent retry', async () => {
    const chatId = 'Seraphina - retry test';
    const generatedName = `InnerLore - Seraphina - ${hashString(chatId)}`;
    globalThis.SillyTavern = {
        getContext: () => ({
            getWorldInfoNames: () => [generatedName],
            loadWorldInfo: async () => ({ entries: {} }),
        }),
    };

    const result = await deleteInnerLorebooksForChat(chatId, {
        deleteWorldInfo: async () => false,
    });

    assert.deepEqual(result.candidates, [generatedName]);
    assert.deepEqual(result.deleted, []);
    assert.deepEqual(result.failed, [generatedName]);
});

test('a remembered book that SillyTavern no longer lists counts as cleaned instead of pending for ever', async () => {
    const chatId = 'The Fracture - 2026-10-07@19h00m00s000ms';
    const books = new Map([['Shared campaign lore', { entries: {} }]]);
    globalThis.SillyTavern = { getContext: () => ({ getWorldInfoNames: () => [...books.keys()], loadWorldInfo: async name => { if (!books.has(name)) throw new Error('404'); return books.get(name); } }) };
    const result = await deleteInnerLorebooksForChat(chatId, {
        registeredNames: ['InnerLore - The Fracture - 07c75de09b'],
        deleteWorldInfo: async () => { throw new Error('should not be called for a missing book'); },
    });
    assert.deepEqual(result.failed, []);
    assert.deepEqual(result.deleted, ['InnerLore - The Fracture - 07c75de09b']);
});
