import assert from 'node:assert/strict';
import test from 'node:test';

import { createEmptyStore } from '../core.js';
import { createRebuildJob } from '../server/innerlore-storage/passes/rebuild.js';
import { installServerTransport } from '../server/innerlore-storage/passes/pass.js';

const clone = value => JSON.parse(JSON.stringify(value));

function memoryStore(initial) {
    const state = { snapshot: clone(initial), revision: 1, commits: [] };
    return {
        state,
        read: () => ({ store: clone(state.snapshot), revision: state.revision, chatId: 'chat-1' }),
        commit: (worldId, chatId, transform, options = {}) => {
            const next = transform(clone(state.snapshot));
            if (!next) return { unchanged: true, revision: state.revision };
            state.snapshot = next;
            state.revision += 1;
            state.commits.push({ reason: options.reason, revision: state.revision });
            return { revision: state.revision, snapshotObject: next };
        },
    };
}

const chat = [
    { mes: 'Mara Venn wipes the bar of the Salt Lantern.', is_user: false, is_system: false, name: 'Narrator' },
    { mes: 'I knock.', is_user: true, is_system: false, name: 'Jet' },
    { mes: 'Old Fen opens the door.', is_user: false, is_system: false, name: 'Narrator' },
];

const settings = {
    enabled: true, autoUpdate: true, innerSelfEnabled: false, autoLoreEnabled: true, worldProgressionEnabled: false, gameEnabled: false,
    processEveryAssistantTurns: 1, maintenanceSchedulingVersion: 1, lookbackMessages: 10, maintenanceOutputFormat: 'dsl',
    connectionProfileId: 'nano', requestTimeoutSeconds: 15, requestMaximumAttempts: 1, enabledEntityTypes: ['character', 'location', 'faction', 'item', 'concept'],
    minimumImportance: 0, maximumEntitiesPerPass: 20, assistedBackground: 'off', repairMalformedJson: false,
};

test('the server rebuild job re-derives the world from the chat, keeps portraits and manual edits, and replaces the latest revision', async () => {
    const prompts = [];
    installServerTransport({
        request: async ({ messages }) => {
            prompts.push(messages.map(message => message.content).join('\n'));
            return 'INNERLORE CURATOR 1\nLOCATION Salt Lantern\nimportance = 70\nsummary = A narrow inn.\nEND\nCHARACTER Old Fen\nimportance = 60\nsummary = A net-mender.\nEND\nDONE';
        },
    });
    const old = createEmptyStore('chat-1');
    old.needsRebuild = true;
    old.lastProcessedIndex = 2;
    old.entities['character:ghost'] = { id: 'character:ghost', type: 'character', name: 'Ghost', enabled: true, importance: 40, manualOverride: true, manualContent: 'Kept by hand.' };
    old.portraits = { 'mara venn': { name: 'Mara Venn', path: '/user/images/InnerLore/mara.webp', seed: 1, at: 1 } };
    const store = memoryStore(old);
    const run = createRebuildJob({ store });
    const details = [];
    const result = await run(
        { worldId: 'w1', chatId: 'chat-1', directories: { root: '/tmp' }, input: { chat, settings, playerName: 'Jet', characterName: 'Narrator', cardSeeds: [{ type: 'location', name: 'Rope Street', importance: 50, summary: 'The harbour road.' }], connections: { nano: { id: 'nano', url: 'https://x/v1', model: 'm' } }, automatic: false } },
        { signal: new AbortController().signal, setDetail: text => details.push(text), log: () => {} },
    );
    assert.equal(prompts.length, 1, 'one curator batch for three messages');
    assert.match(result.summary, /Rebuilt 5 lore entries/u, "the seed, the two curated records, the manual record and the player");
    const latest = store.state.snapshot;
    assert.equal(latest.needsRebuild, false);
    assert.equal(latest.lastProcessedIndex, 2);
    assert.ok(latest.entities['location:rope street'], 'the card seed is there');
    assert.ok(latest.entities['location:salt lantern'] && latest.entities['character:old fen'], 'the curator\'s records are there');
    assert.equal(latest.entities['character:ghost']?.manualContent, 'Kept by hand.', 'a manually kept record survives');
    assert.equal(latest.portraits['mara venn'].path, '/user/images/InnerLore/mara.webp', 'portraits travel with the world');
    assert.ok(latest.checkpoints.length >= 1, 'a checkpoint was recorded at the head');
    assert.ok(details.some(text => /rebuilding messages 0–2 of 2/u.test(text)));
    assert.equal(store.state.commits.at(-1).reason, 'rebuild');
});

test('a rebuild whose model fails leaves the old world quarantined with the error recorded', async () => {
    installServerTransport({ request: async () => { throw new Error('provider down'); } });
    const old = createEmptyStore('chat-1');
    old.needsRebuild = true;
    const store = memoryStore(old);
    const run = createRebuildJob({ store });
    await assert.rejects(run(
        { worldId: 'w1', chatId: 'chat-1', directories: { root: '/tmp' }, input: { chat, settings, playerName: 'Jet', characterName: 'Narrator', connections: { nano: { id: 'nano', url: 'https://x/v1', model: 'm' } } } },
        { signal: new AbortController().signal, setDetail: () => {}, log: () => {} },
    ), /provider down/u);
    assert.equal(store.state.snapshot.needsRebuild, true);
    assert.match(store.state.snapshot.lastError, /provider down/u);
    assert.equal(store.state.commits.at(-1).reason, 'rebuild-failed');
});
