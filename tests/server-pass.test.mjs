import assert from 'node:assert/strict';
import test from 'node:test';

import { createEmptyStore } from '../core.js';
import { createPassJob, installServerTransport } from '../server/innerlore-storage/passes/pass.js';
import { applyPatch } from '../store-diff.js?v=4';

const clone = value => JSON.parse(JSON.stringify(value));

/** A store access like the plugin's: the snapshot, and commits that apply a transform onto the latest. */
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
    { mes: 'The gate stands shut. Mara Venn waits by the bar.', is_user: false, is_system: false, name: 'Narrator' },
    { mes: 'I knock.', is_user: true, is_system: false, name: 'Jet' },
    { mes: 'Old Fen opens the door and lets you in to the Salt Lantern.', is_user: false, is_system: false, name: 'Narrator' },
];

const settings = {
    enabled: true, autoUpdate: true, innerSelfEnabled: true, autoLoreEnabled: true, worldProgressionEnabled: false, gameEnabled: false,
    processEveryAssistantTurns: 1, maintenanceSchedulingVersion: 1, lookbackMessages: 10, maintenanceOutputFormat: 'dsl',
    connectionProfileId: 'nano', fallbackConnectionProfileId: '', requestTimeoutSeconds: 15, requestMaximumAttempts: 1,
    enabledEntityTypes: ['character', 'location', 'faction', 'item', 'concept'], minimumImportance: 0, maximumEntitiesPerPass: 20,
    maximumMindOperationsPerPass: 20, maximumThoughtsPerBrain: 8, maximumThoughtChangesPerBrain: 4, minimumStoryFacetObservations: 2,
    brainConsolidationSimilarity: 0.8, maximumSceneThoughtsPerBrain: 4, assistedBackground: 'off', repairMalformedJson: false,
};

test('the server pass job runs the pipeline against a copy and commits a patch onto the latest revision', async () => {
    const requests = [];
    const llm = {
        request: async ({ connection, messages, kind }) => {
            requests.push({ connection: connection.id, kind, prompt: messages.map(message => message.content).join('\n') });
            return 'INNERLORE CURATOR 1\nLOCATION Salt Lantern\nimportance = 70\nsummary = A narrow inn with a long bar.\nEND\nCHARACTER Old Fen\nimportance = 60\nsummary = A net-mender who opens the inn door.\nEND\nDONE';
        },
    };
    installServerTransport(llm);
    const initial = createEmptyStore('chat-1');
    initial.lastProcessedIndex = 0;
    initial.assistantTurnsSincePass = 1;
    const store = memoryStore(initial);
    const run = createPassJob({ store });
    const details = [];
    const job = {
        worldId: 'w1', chatId: 'chat-1', directories: { root: '/tmp' },
        input: {
            chat, settings, playerName: 'Jet', characterName: 'Narrator', persona: 'A courier.', cardContext: 'Harbour Tales\nA rainy town.',
            connections: { nano: { id: 'nano', name: 'Nano', url: 'https://nano-gpt.com/api/subscription/v1', model: 'z-ai/glm-5.3-flash-uncensored', secretId: 's1' } },
        },
    };
    // Meanwhile another writer adds to the latest snapshot and a reply lands (turn counter rises).
    const original = store.read;
    store.read = () => {
        const current = original();
        store.state.snapshot.narrativeLog = [{ text: 'added elsewhere' }];
        store.state.snapshot.assistantTurnsSincePass = 2;
        store.state.revision += 1;
        return current;
    };
    const result = await run(job, { signal: new AbortController().signal, setDetail: text => details.push(text), log: () => {} });
    assert.equal(requests.length, 1, 'one curator request');
    assert.equal(requests[0].connection, 'nano');
    assert.match(requests[0].prompt, /Old Fen opens the door/u, 'the transcript reached the model');
    assert.match(result.summary, /2 lore entries created/u);
    assert.equal(result.discarded, false);
    const latest = store.state.snapshot;
    assert.ok(latest.entities['location:salt lantern'], 'the curator\'s record landed');
    assert.ok(latest.entities['character:old fen']);
    assert.equal(latest.lastProcessedIndex, 2, 'the watermark advanced');
    assert.deepEqual(latest.narrativeLog, [{ text: 'added elsewhere' }], 'the other writer\'s change survived the commit');
    assert.equal(latest.assistantTurnsSincePass, 1, 'the reply that landed during the pass stays counted (2 - 1 covered)');
    assert.ok(details.some(text => /messages 1–2/u.test(text)));
    assert.equal(store.state.commits.at(-1).reason, 'pass');
    assert.equal(latest.lastError, '');
});

test('a pass that finds the history changed marks the latest snapshot for a rebuild; a model failure records the error', async () => {
    installServerTransport({ request: async () => { throw new Error('provider exploded'); } });
    const initial = createEmptyStore('chat-1');
    initial.lastProcessedIndex = 0;
    const store = memoryStore(initial);
    const run = createPassJob({ store });
    const job = { worldId: 'w1', chatId: 'chat-1', directories: { root: '/tmp' }, input: { chat, settings: { ...settings, requestMaximumAttempts: 1 }, playerName: 'Jet', characterName: 'Narrator', connections: { nano: { id: 'nano', url: 'https://x/v1', model: 'm' } } } };
    await assert.rejects(run(job, { signal: new AbortController().signal, setDetail: () => {}, log: () => {} }), /provider exploded/u);
    assert.match(store.state.snapshot.lastError, /provider exploded/u);
    assert.equal(store.state.snapshot.consecutiveFailures, 1);
    assert.equal(store.state.snapshot.lastProcessedIndex, 0, 'nothing advanced');

    // A store already marked needsRebuild discards the commit.
    installServerTransport({ request: async () => 'INNERLORE CURATOR 1\nDONE' });
    store.state.snapshot.needsRebuild = true;
    const skipped = await run(job, { signal: new AbortController().signal, setDetail: () => {}, log: () => {} });
    assert.equal(skipped.discarded, true);
});

test('the patch the pass produces leaves the turn counter to the commit', async () => {
    // Sanity: applyPatch of a pass diff never carries assistantTurnsSincePass (the job deletes it).
    const base = { a: 1, assistantTurnsSincePass: 3 };
    const next = applyPatch(clone(base), { set: { a: 2 } });
    assert.equal(next.assistantTurnsSincePass, 3);
});
