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
