import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';

import { createBudget, providerCost, providerOf } from '../server/innerlore-storage/provider-budget.js';
import { RESULT_KEEP_MS, createJobRunner, laneOf } from '../server/innerlore-storage/jobs.js';
import { createLlm } from '../server/innerlore-storage/llm.js';
import { createHub } from '../server/innerlore-storage/hub.js';
import { createPortraitJob } from '../server/innerlore-storage/passes/portrait.js';
import { createPictureJob } from '../server/innerlore-storage/passes/picture.js';

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const waitFor = async (predicate, timeout = 4_000) => {
    const started = Date.now();
    while (!predicate()) {
        if (Date.now() - started > timeout) throw new Error('timed out');
        await sleep(10);
    }
};

function recordingHub() {
    const sent = [];
    return { sent, broadcast: (worldId, message) => sent.push({ worldId, ...message }), enabled: true };
}

test('the provider budget hands out units, keeps the story\'s reserve while its claim is fresh, and expires claims', async () => {
    let clock = 0;
    const budget = createBudget({ now: () => clock, ttlMs: 1_000 });
    assert.equal(providerOf({ url: 'https://nano-gpt.com/api/subscription/v1' }), 'nano-gpt.com');
    assert.equal(providerCost('featherless.ai', 'gemma-4-31B'), 2);
    assert.equal(providerCost('', 'anything'), 0);
    // NovelAI: one slot. A story claim reserves it; background work waits.
    budget.claimStory('w1', { provider: 'novelai.net', cost: 1 });
    assert.equal(budget.hasRoom('novelai.net', 1), false);
    assert.equal(budget.hasRoom('novelai.net', 1, { ignoreReserve: true }), true);
    let taken = false;
    const turn = budget.take('novelai.net', 1).then(release => { taken = true; return release; });
    await sleep(20);
    assert.equal(taken, false, 'a background request waits behind the story\'s reserve');
    budget.releaseStory('w1');
    const release = await turn;
    assert.equal(taken, true);
    assert.equal(budget.hasRoom('novelai.net', 1), false, 'the unit is in use');
    release();
    assert.equal(budget.hasRoom('novelai.net', 1), true);
    // Claims expire on their own.
    budget.claimStory('w1', { provider: 'nano-gpt.com', cost: 1 });
    assert.equal(budget.storyFresh('w1'), true);
    clock = 2_000;
    assert.equal(budget.storyFresh('w1'), false);
    // Ten at once on NanoGPT.
    const releases = await Promise.all(Array.from({ length: 10 }, () => budget.take('nano-gpt.com', 1)));
    assert.equal(budget.hasRoom('nano-gpt.com', 1), false);
    releases.forEach(fn => fn());
    assert.equal(budget.snapshot('nano-gpt.com').used, 0);
});

test('the job runner runs one job per world in order, coalesces duplicates, cancels, holds, and marks restarts', async () => {
    const db = new DatabaseSync(':memory:');
    db.exec(`CREATE TABLE IF NOT EXISTS jobs (id TEXT PRIMARY KEY, world_id TEXT NOT NULL, chat_id TEXT NOT NULL DEFAULT '', kind TEXT NOT NULL, job_key TEXT NOT NULL DEFAULT '', status TEXT NOT NULL, detail TEXT NOT NULL DEFAULT '', input TEXT NOT NULL DEFAULT '{}', result TEXT NOT NULL DEFAULT 'null', error TEXT NOT NULL DEFAULT '', base_revision INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, started_at INTEGER, finished_at INTEGER)`);
    db.prepare(`INSERT INTO jobs (id, world_id, kind, status, created_at) VALUES ('old-running', 'w1', 'pass', 'running', 1)`).run();
    const hub = recordingHub();
    let hold = false;
    const runner = createJobRunner({ db, hub, shouldHold: job => hold && job.kind === 'pass', holdPollMs: 20 });
    assert.equal(runner.get('old-running').status, 'failed', 'a job running at restart is marked failed');
    assert.match(runner.get('old-running').error, /restarted/u);

    const started = [];
    const gates = new Map();
    runner.register('slow', async (job, tools) => {
        started.push(job.key);
        await new Promise((resolve, reject) => {
            gates.set(job.key, resolve);
            tools.signal.addEventListener('abort', () => reject(tools.signal.reason), { once: true });
        });
        return { did: job.key };
    });
    runner.register('pass', async () => ({ ok: true }));

    const a = runner.submit({ worldId: 'w1', kind: 'slow', key: 'a' });
    const aAgain = runner.submit({ worldId: 'w1', kind: 'slow', key: 'a' });
    const b = runner.submit({ worldId: 'w1', kind: 'slow', key: 'b' });
    const other = runner.submit({ worldId: 'w2', kind: 'slow', key: 'c' });
    assert.equal(aAgain.jobId, a.jobId);
    assert.equal(aAgain.coalesced, true);
    await waitFor(() => started.length === 2);
    assert.deepEqual(started.sort(), ['a', 'c'], 'one job per world runs at a time; another world runs beside it');
    assert.equal(runner.list('w1').length, 2);

    // Cancelling the queued one removes it; finishing a runs b.
    const cancelled = runner.cancel(b.jobId, 'not needed');
    assert.equal(cancelled.status, 'cancelled');
    gates.get('a')({});
    await waitFor(() => runner.get(a.jobId)?.status === 'done');
    assert.deepEqual(runner.get(a.jobId).result, { did: 'a' });
    assert.equal(runner.list('w1').length, 0);

    // Cancelling a running job aborts its signal.
    const cancelledRun = runner.cancel(other.jobId, 'story_preempt');
    assert.equal(cancelledRun.status, 'running');
    await waitFor(() => runner.get(other.jobId)?.status === 'cancelled');
    assert.equal(runner.get(other.jobId).error, 'story_preempt');

    // A held kind waits until the hold lifts.
    hold = true;
    const held = runner.submit({ worldId: 'w1', kind: 'pass' });
    await sleep(60);
    assert.equal(runner.get(held.jobId).status, 'queued', 'held while the story claim is fresh');
    hold = false;
    await waitFor(() => runner.get(held.jobId)?.status === 'done');
    const events = hub.sent.filter(message => message.type === 'job').map(message => `${message.job.kind}:${message.job.status}`);
    assert.ok(events.includes('slow:queued') && events.includes('slow:running') && events.includes('slow:done') && events.includes('pass:done'));
    runner.close();
});

test('the server transport sends an OpenAI-compatible request with the key, retries a passing failure, and falls back', async () => {
    const calls = [];
    const answers = [
        { status: 503, body: 'busy' },
        { status: 200, body: JSON.stringify({ choices: [{ message: { content: 'first connection answered' } }] }) },
    ];
    const fetchImpl = async (url, options) => {
        calls.push({ url, body: JSON.parse(options.body), auth: options.headers.Authorization });
        const next = answers.shift() || { status: 500, body: 'no more answers' };
        return { ok: next.status < 400, status: next.status, text: async () => next.body };
    };
    const llm = createLlm({
        helpers: async () => ({ readSecret: (directories, key, id) => `key-for-${id}`, postProcessPrompt: null, mergeObjectWithYaml: (body, yaml) => { if (/reasoning_effort/u.test(yaml)) body.reasoning_effort = 'low'; } }),
        budget: createBudget(),
        fetchImpl,
    });
    const text = await llm.request({
        connection: { id: 'nano', name: 'Nano', url: 'https://nano-gpt.com/api/subscription/v1', model: 'z-ai/glm-5.3-flash-uncensored', secretId: 's1', includeBody: 'reasoning_effort: low' },
        fallback: { id: 'bridge', name: 'Bridge', url: 'http://127.0.0.1:8790/v1', model: 'opus', secretId: 's2' },
        messages: [{ role: 'system', content: 'Say hi.' }],
        maxTokens: 100,
        directories: { root: '/tmp' },
    });
    assert.equal(text, 'first connection answered');
    assert.equal(calls.length, 2, 'a 503 is retried once before the answer');
    assert.equal(calls[0].url, 'https://nano-gpt.com/api/subscription/v1/chat/completions');
    assert.equal(calls[0].auth, 'Bearer key-for-s1');
    assert.equal(calls[0].body.reasoning_effort, 'low');
    assert.equal(calls[0].body.stream, false);

    // Every attempt on the first connection fails for good: the fallback answers.
    answers.push({ status: 400, body: 'bad request' }, { status: 200, body: JSON.stringify({ choices: [{ message: { content: 'fallback answered' } }] }) });
    calls.length = 0;
    const second = await llm.request({
        connection: { id: 'nano', name: 'Nano', url: 'https://nano-gpt.com/api/subscription/v1', model: 'm', secretId: 's1' },
        fallback: { id: 'bridge', name: 'Bridge', url: 'http://127.0.0.1:8790/v1', model: 'opus', secretId: 's2' },
        messages: [{ role: 'user', content: 'hi' }],
        directories: { root: '/tmp' },
    });
    assert.equal(second, 'fallback answered');
    assert.equal(calls[1].url, 'http://127.0.0.1:8790/v1/chat/completions');
    assert.equal(calls[1].auth, 'Bearer key-for-s2');
});

test('the portrait job asks for tags, draws, saves and commits the record into the store', async () => {
    const snapshot = {
        chatId: 'chat-1',
        entities: { 'character:mara venn': { id: 'character:mara venn', type: 'character', name: 'Mara Venn', aliases: ['the innkeeper'], enabled: true, summary: 'Tall innkeeper with cropped grey hair and a burn-scarred forearm; brisk.', importance: 70 } },
        game: {},
        portraits: {},
    };
    let revision = 3;
    const commits = [];
    const store = {
        read: () => ({ store: structuredClone(snapshot), revision }),
        commit: (worldId, chatId, transform) => {
            const next = transform(structuredClone(snapshot));
            Object.assign(snapshot, next);
            revision += 1;
            commits.push({ worldId, chatId, revision });
            return { revision, snapshotObject: next };
        },
    };
    const llm = { request: async ({ messages }) => { assert.match(messages[1].content, /Mara Venn/u); return '1girl, mature female, tall, grey hair, short hair, burn scar, apron, inn'; } };
    const saved = [];
    const images = {
        generate: async ({ payload }) => { assert.match(payload.prompt, /^1girl, solo, portrait, upper body, looking at viewer, mature female/u); return 'cGlj'; },
        shrink: async base64 => ({ buffer: Buffer.from(base64, 'base64'), format: 'webp' }),
        savePortrait: async ({ fileName, format }) => { saved.push(fileName); return `/user/images/InnerLore/${fileName}.${format}`; },
    };
    const hub = recordingHub();
    const run = createPortraitJob({ llm, images, store, hub });
    const details = [];
    const result = await run(
        { worldId: 'w1', chatId: 'chat-1', directories: { root: '/tmp' }, input: { name: 'the innkeeper', placeName: 'Salt Lantern', connection: { url: 'http://x/v1', model: 'm' }, settings: { portraitSteps: 20 }, service: { url: 'http://127.0.0.1:7866' } } },
        { signal: new AbortController().signal, setDetail: text => details.push(text), log: () => {} },
    );
    assert.equal(result.name, 'Mara Venn', 'the alias resolves to the record\'s canonical name');
    assert.equal(result.key, 'mara venn', 'kept under the name the story uses, so a lost alias never loses it');
    assert.match(saved[0], /^[0-9a-f]+-chat-1-mara-venn-\d+$/u);
    assert.equal(snapshot.portraits['mara venn'].path, result.path);
    assert.ok(Number.isInteger(snapshot.portraits['mara venn'].seed), 'the seed is kept');
    assert.deepEqual(snapshot.portraits['mara venn'].tags, ['1girl', 'mature female', 'tall', 'medium breasts', 'grey hair', 'short hair', 'burn scar', 'apron'], 'and the look\'s tags, chest stated, the inn left out');
    assert.deepEqual(details, ['choosing the look', 'drawing']);
    assert.equal(commits.length, 1);
    assert.ok(hub.sent.some(message => message.type === 'portrait' && message.path === result.path));
    // A second run for someone who already has a portrait does nothing.
    const again = await run({ worldId: 'w1', chatId: 'chat-1', input: { name: 'Mara Venn', connection: { url: 'http://x/v1', model: 'm' } } }, { signal: new AbortController().signal, setDetail: () => {}, log: () => {} });
    assert.deepEqual(again, { skipped: 'exists' });
});

test('a job\'s messages are never written to the table, and what the model answered is kept only while a page may catch up', async () => {
    const db = new DatabaseSync(':memory:');
    let clock = 1_000_000;
    // Rows from before: an input and a result each, as older versions kept them.
    createJobRunner({ db, hub: recordingHub(), now: () => clock });
    db.prepare(`INSERT INTO jobs (id, world_id, kind, status, input, result, created_at, finished_at) VALUES ('old-done', 'w1', 'private-reply', 'done', '{"messages":"SECRET"}', '{"text":"SECRET"}', 1, 2)`).run();
    const runner = createJobRunner({ db, hub: recordingHub(), now: () => clock });
    assert.deepEqual({ ...db.prepare(`SELECT input, result FROM jobs WHERE id = 'old-done'`).get() }, { input: '{}', result: 'null' }, 'a start wipes what older versions kept');

    runner.register('private-reply', async job => ({ text: `answer to ${job.input.messages}` }));
    const first = runner.submit({ worldId: 'w1', kind: 'private-reply', key: 'r1', input: { messages: 'SECRET-MESSAGES' } });
    await waitFor(() => runner.get(first.jobId)?.status === 'done');
    const row = db.prepare('SELECT input, result FROM jobs WHERE id = ?').get(first.jobId);
    assert.equal(row.input, '{}', 'the input stayed in memory');
    assert.match(row.result, /answer to SECRET-MESSAGES/u, 'the answer waits for a page that slept through it');
    assert.equal(runner.recent('w1')[0].result.text, 'answer to SECRET-MESSAGES');

    // Past the catch-up window, the next finished job takes the old answer with it.
    clock += RESULT_KEEP_MS + 1;
    const second = runner.submit({ worldId: 'w1', kind: 'private-reply', key: 'r2', input: { messages: 'more' } });
    await waitFor(() => runner.get(second.jobId)?.status === 'done');
    assert.equal(db.prepare('SELECT result FROM jobs WHERE id = ?').get(first.jobId).result, 'null');
    assert.equal(db.prepare(`SELECT count(*) AS n FROM jobs WHERE input LIKE '%SECRET%' OR result LIKE '%SECRET%'`).get().n, 0);
});

test('a reply in a conversation does not wait for a picture being drawn: pictures, replies and the world\'s work run in their own lanes', async () => {
    const db = new DatabaseSync(':memory:');
    const runner = createJobRunner({ db, hub: recordingHub() });
    assert.deepEqual(['portrait', 'picture', 'private-reply', 'pass', 'rebuild'].map(laneOf), ['images', 'images', 'chat', 'main', 'main']);
    const gates = new Map();
    const started = [];
    const slow = async job => {
        started.push(job.kind);
        await new Promise(resolve => gates.set(job.key, resolve));
        return { did: job.key };
    };
    for (const kind of ['picture', 'portrait', 'pass']) runner.register(kind, slow);
    runner.register('private-reply', async () => ({ text: 'Aye.' }));
    runner.submit({ worldId: 'w1', kind: 'picture', key: 'pic-1' });
    runner.submit({ worldId: 'w1', kind: 'portrait', key: 'mara' });
    runner.submit({ worldId: 'w1', kind: 'pass', key: 'pass' });
    const reply = runner.submit({ worldId: 'w1', kind: 'private-reply', key: 'r1' });
    await waitFor(() => runner.get(reply.jobId)?.status === 'done');
    assert.deepEqual(started.sort(), ['pass', 'picture'], 'the picture and the pass run side by side; the portrait waits behind the picture');
    assert.equal(runner.activeJob('w1')?.kind, 'pass', 'the story gate sees model work, not a picture');
    assert.equal(runner.list('w1').length, 3);
    gates.get('pic-1')();
    await waitFor(() => started.includes('portrait'));
    gates.get('mara')();
    gates.get('pass')();
    await waitFor(() => runner.list('w1').length === 0);
    assert.equal(runner.cancelWorld('w1'), 0);
});

function memoryWorld(snapshot) {
    let revision = 3;
    const commits = [];
    return {
        snapshot,
        commits,
        read: () => ({ store: structuredClone(snapshot), revision }),
        commit: (worldId, chatId, transform, options = {}) => {
            const next = transform(structuredClone(snapshot));
            if (!next) return { unchanged: true, revision };
            for (const key of Object.keys(snapshot)) delete snapshot[key];
            Object.assign(snapshot, next);
            revision += 1;
            commits.push({ reason: options.reason, revision });
            return { revision, snapshotObject: next };
        },
    };
}

const fakeImages = (drawn, seedFromServer = null) => ({
    generate: async ({ payload }) => {
        drawn.push(payload);
        return { image: 'cGlj', seed: seedFromServer ?? payload.seed };
    },
    shrink: async (base64, options = {}) => ({ buffer: Buffer.from(base64, 'base64'), format: 'webp', side: options.side }),
    savePortrait: async ({ fileName, format }) => `/user/images/InnerLore/${fileName}.${format}`,
});

const tools = () => ({ signal: new AbortController().signal, setDetail: () => {}, log: () => {} });

test('a portrait reuses the person\'s look and keeps the seed the server used; a new portrait the player asks for starts a new look', async () => {
    const world = memoryWorld({
        chatId: 'chat-1',
        entities: { 'character:mara venn': { id: 'character:mara venn', type: 'character', name: 'Mara Venn', enabled: true, summary: 'Tall innkeeper.', importance: 70 } },
        portraits: { 'mara venn': { name: 'Mara Venn', tags: ['1girl', 'mature female', 'slim', 'grey hair'], seed: 1234, at: 1 } },
    });
    const asked = [];
    const llm = { request: async ({ messages }) => { asked.push(messages); return '1girl, young woman, plump, red hair, green dress'; } };
    const drawn = [];
    const run = createPortraitJob({ llm, images: fakeImages(drawn, 99), store: world });
    const kept = await run({ worldId: 'w1', chatId: 'chat-1', input: { name: 'Mara Venn', connection: { url: 'http://x/v1', model: 'm' }, settings: {} } }, tools());
    assert.equal(asked.length, 0, 'an existing look needs no model call');
    assert.equal(drawn[0].seed, 1234, 'drawn from the look\'s seed');
    assert.match(drawn[0].prompt, /^1girl, solo, portrait, upper body, looking at viewer, mature female, slim, small breasts, grey hair, gradient background/u);
    assert.match(drawn[0].negative_prompt, /large breasts, huge breasts, cleavage$/u);
    assert.equal(kept.seed, 99, 'the seed the server reports is the one kept');
    assert.equal(world.snapshot.portraits['mara venn'].seed, 99);
    // "Draw a new portrait": a new look from the story, and a new seed.
    const fresh = await run({ worldId: 'w1', chatId: 'chat-1', input: { name: 'Mara Venn', force: true, newLook: true, connection: { url: 'http://x/v1', model: 'm' }, settings: { portraitBackground: 'simple background, white background' } } }, tools());
    assert.equal(asked.length, 1);
    assert.match(drawn[1].prompt, /young woman, plump, large breasts, red hair, green dress, simple background, white background/u);
    assert.deepEqual(world.snapshot.portraits['mara venn'].tags, ['1girl', 'young woman', 'plump', 'large breasts', 'red hair', 'green dress']);
    assert.equal(fresh.key, 'mara venn');
});

test('a sent picture draws its subject from their look and seed, keeps its own scene, and lands in the store by id', async () => {
    const world = memoryWorld({
        chatId: 'chat-1',
        entities: {
            'character:mara venn': { id: 'character:mara venn', type: 'character', name: 'Mara Venn', enabled: true, summary: 'Tall innkeeper with cropped grey hair.', importance: 70 },
            'character:old fen': { id: 'character:old fen', type: 'character', name: 'Old Fen', enabled: true, summary: 'A net-mender, stooped, white-bearded.', importance: 50 },
        },
        portraits: { 'mara venn': { name: 'Mara Venn', path: '/user/images/InnerLore/mara.webp', tags: ['1girl', 'mature female', 'tall', 'medium breasts', 'short grey hair', 'brown apron', 'stern expression'], seed: 4242, at: 1 } },
    });
    const replies = [];
    const llm = {
        request: async ({ messages, kind }) => {
            replies.push(kind);
            const picture = messages[1].content.split('\n')[0];
            if (kind === 'picture') return /docks/u.test(picture)
                ? 'SUBJECT: nobody\nTAGS: scenery, docks, night, lantern'
                : /Fen/u.test(picture) ? 'SUBJECT: Old Fen\nTAGS: upper body, mending net, pier'
                    : /stairs/u.test(picture) ? 'SUBJECT: sender\nTAGS: full body, standing, smiling, stairs, inn interior'
                        : 'SUBJECT: sender\nTAGS: selfie, upper body, smile, indoors, tavern, bar counter';
            return '1boy, old man, stooped, white beard, fisherman sweater';
        },
    };
    const drawn = [];
    const hub = recordingHub();
    const run = createPictureJob({ llm, images: fakeImages(drawn), store: world, hub });
    const input = { person: 'Mara Venn', channel: 'text', connection: { url: 'http://x/v1', model: 'm' }, settings: {} };

    const selfie = await run({ worldId: 'w1', chatId: 'chat-1', input: { ...input, id: 'pic-selfie1', description: 'me behind the bar' } }, tools());
    assert.equal(drawn[0].seed, 4242, 'the portrait\'s seed');
    assert.equal(drawn[0].prompt, '1girl, solo, selfie, upper body, mature female, tall, medium breasts, short grey hair, smile, brown apron, bar counter, indoors, tavern, masterpiece, best quality, amazing quality, very aesthetic');
    assert.equal(world.snapshot.pictures['pic-selfie1'].path, selfie.path);
    assert.equal(world.snapshot.pictures['pic-selfie1'].subject, 'Mara Venn');
    assert.ok(hub.sent.some(message => message.type === 'picture' && message.id === 'pic-selfie1'));

    // Someone with no look yet gets one now, kept for their portrait and later pictures.
    await run({ worldId: 'w1', chatId: 'chat-1', input: { ...input, id: 'pic-fen0001', description: 'Fen at the pier' } }, tools());
    assert.deepEqual(replies, ['picture', 'picture', 'portrait']);
    const fen = world.snapshot.portraits['old fen'];
    assert.deepEqual(fen.tags, ['1boy', 'old man', 'stooped', 'white beard', 'fisherman sweater']);
    assert.equal(fen.path, undefined, 'a look before any portrait');
    assert.equal(drawn[1].seed, fen.seed);

    // Nobody in it: the scene alone, as clear in a mind as in a photo.
    await run({ worldId: 'w1', chatId: 'chat-1', input: { ...input, channel: 'mind', id: 'pic-docks01', description: 'the docks at night' } }, tools());
    assert.equal(drawn[2].prompt, 'no humans, scenery, docks, night, lantern, masterpiece, best quality, amazing quality, very aesthetic', 'clear, not dreamlike');
    assert.match(drawn[2].negative_prompt, /1girl, 1boy, people$/u);

    // Dressed up: what the description says she wears replaces the usual, though the model left it out.
    await run({ worldId: 'w1', chatId: 'chat-1', input: { ...input, id: 'pic-gown0001', description: 'me on the stairs in my dark green wool dress' } }, tools());
    assert.equal(drawn[3].seed, 4242, 'the same face for a new outfit');
    assert.equal(drawn[3].prompt, '1girl, solo, full body, mature female, tall, medium breasts, short grey hair, smiling, dark green wool dress, standing, stairs, inn interior, masterpiece, best quality, amazing quality, very aesthetic');

    // Drawn already: nothing to do. A failure is kept, so the conversation can say so.
    assert.deepEqual(await run({ worldId: 'w1', chatId: 'chat-1', input: { ...input, id: 'pic-selfie1', description: 'me behind the bar' } }, tools()), { skipped: 'exists', id: 'pic-selfie1' });
    const broken = createPictureJob({ llm, images: { ...fakeImages([]), generate: async () => { throw new Error('the image server is not reachable'); } }, store: world, hub });
    await assert.rejects(broken({ worldId: 'w1', chatId: 'chat-1', input: { ...input, id: 'pic-broken1', description: 'me behind the bar' } }, tools()), /not reachable/u);
    assert.equal(world.snapshot.pictures['pic-broken1'].failed, true);
    await assert.rejects(run({ worldId: 'w1', chatId: 'chat-1', input: { ...input, id: 'Bad Id', description: 'x' } }, tools()), /needs an id/u);
});

test('a picture or portrait finished after its world was deleted leaves no file behind', async () => {
    const snapshot = {
        chatId: 'chat-1',
        entities: { 'character:mara venn': { id: 'character:mara venn', type: 'character', name: 'Mara Venn', enabled: true, summary: 'Tall innkeeper.', importance: 70 } },
        portraits: { 'mara venn': { name: 'Mara Venn', tags: ['1girl', 'mature female', 'slim', 'grey hair'], seed: 1234, at: 1 } },
    };
    // The store refuses the commit the way the plugin does once the world row is gone.
    const gone = { read: () => ({ store: structuredClone(snapshot), revision: 3 }), commit: () => ({ unchanged: true, missing: true, revision: 0, snapshotObject: null }) };
    const removed = [];
    const images = { ...fakeImages([]), removePortrait: async ({ path }) => { removed.push(path); return true; } };
    const hub = recordingHub();
    const llm = { request: async ({ kind }) => (kind === 'picture' ? 'SUBJECT: sender\nTAGS: upper body, smile, tavern' : '1girl, mature female') };
    const portrait = await createPortraitJob({ llm, images, store: gone, hub })({ worldId: 'w1', chatId: 'chat-1', input: { name: 'Mara Venn', force: true, connection: { url: 'http://x/v1', model: 'm' }, settings: {} } }, tools());
    assert.equal(portrait.skipped, 'deleted');
    const picture = await createPictureJob({ llm, images, store: gone, hub })({ worldId: 'w1', chatId: 'chat-1', input: { id: 'pic-late0001', person: 'Mara Venn', channel: 'text', description: 'me at the bar', connection: { url: 'http://x/v1', model: 'm' }, settings: {} } }, tools());
    assert.equal(picture.skipped, 'deleted');
    assert.equal(removed.length, 2, 'both files written for the deleted world were removed');
    assert.ok(removed.every(path => path.startsWith('/user/images/InnerLore/')));
    assert.equal(hub.sent.length, 0, 'nothing announced for a world that is gone');
});

test('the hub admits loopback sockets for its path, routes subscriptions and broadcasts per world', () => {
    const upgrades = [];
    const sockets = [];
    class FakeServer {
        constructor() { this.listeners = {}; }
        on(event, handler) { this.listeners[event] = handler; }
        off() {}
        listenerCount() { return 1; }
    }
    class FakeWss {
        constructor() { this.handlers = {}; }
        on(event, handler) { this.handlers[event] = handler; }
        emit(event, ...args) { this.handlers[event]?.(...args); }
        handleUpgrade(request, socket, head, done) { upgrades.push(request.url); done(socket); }
    }
    const makeSocket = () => {
        const socket = { readyState: 1, sent: [], handlers: {}, send(data) { this.sent.push(JSON.parse(data)); }, on(event, handler) { this.handlers[event] = handler; }, ping() {}, close() {}, terminate() {}, write() {}, destroy() { this.destroyed = true; } };
        sockets.push(socket);
        return socket;
    };
    const states = [];
    const stories = [];
    const hub = createHub({
        ws: { WebSocketServer: FakeWss },
        onSubscribe: ({ worldId, revision }) => { states.push([worldId, revision]); return { revision: 9, jobs: [] }; },
        onMessage: message => stories.push(message),
    });
    const server = new FakeServer();
    hub.ensureAttached({ socket: { server } });
    assert.equal(hub.attached, true);
    // A loopback upgrade on the hub's path connects; another path or a foreign origin does not.
    const good = makeSocket();
    server.listeners.upgrade({ url: '/api/plugins/innerlore-storage/v1/ws', headers: { host: '127.0.0.1:8000', origin: 'http://127.0.0.1:8000' }, socket: { remoteAddress: '127.0.0.1' } }, good, Buffer.alloc(0));
    const foreign = makeSocket();
    server.listeners.upgrade({ url: '/api/plugins/innerlore-storage/v1/ws', headers: { host: '127.0.0.1:8000', origin: 'http://evil.example' }, socket: { remoteAddress: '127.0.0.1' } }, foreign, Buffer.alloc(0));
    const remote = makeSocket();
    server.listeners.upgrade({ url: '/api/plugins/innerlore-storage/v1/ws', headers: { host: '127.0.0.1:8000' }, socket: { remoteAddress: '10.0.0.5' } }, remote, Buffer.alloc(0));
    assert.deepEqual(upgrades, ['/api/plugins/innerlore-storage/v1/ws']);
    assert.equal(foreign.destroyed, true);
    assert.equal(remote.destroyed, true);
    assert.equal(hub.connections, 1);
    assert.equal(good.sent[0].type, 'hello');
    good.handlers.message(JSON.stringify({ type: 'subscribe', worldId: 'w1', chatId: 'c1', revision: 4, clientId: 'tab-a' }));
    assert.deepEqual(states, [['w1', 4]]);
    assert.equal(good.sent[1].type, 'state');
    assert.equal(good.sent[1].revision, 9);
    good.handlers.message(JSON.stringify({ type: 'story', worldId: 'w1', phase: 'start', provider: 'nano-gpt.com', cost: 1 }));
    assert.equal(stories[0].phase, 'start');
    hub.broadcast('w1', { type: 'job', job: { id: 'j' } });
    hub.broadcast('w2', { type: 'job', job: { id: 'other' } });
    hub.broadcast('w1', { type: 'store', revision: 10 }, { exceptWriter: 'tab-a' });
    assert.deepEqual(good.sent.slice(2).map(message => `${message.type}:${message.worldId}`), ['job:w1'], 'only the subscribed world, and not the writer\'s own patch');
    hub.close();
});

test('the private-reply job sends the page\'s messages on the named connection and keeps the answer', async () => {
    const { createPrivateReplyJob } = await import('../server/innerlore-storage/passes/private-reply.js');
    const calls = [];
    const llm = { request: async options => { calls.push(options); return 'Two coppers, and mind the step.'; } };
    const run = createPrivateReplyJob({ llm });
    const details = [];
    const result = await run(
        { worldId: 'w1', chatId: 'c1', directories: { root: '/tmp' }, input: { messages: [{ role: 'system', content: 'You are Mara.' }, { role: 'user', content: 'How much for a bed?' }], connection: { id: 'nano', url: 'https://nano-gpt.com/api/subscription/v1', model: 'm' }, maxTokens: 200, temperature: 0.7, person: 'Mara Venn' } },
        { signal: new AbortController().signal, setDetail: text => details.push(text), log: () => {} },
    );
    assert.deepEqual(result, { text: 'Two coppers, and mind the step.' });
    assert.equal(calls[0].maxTokens, 200);
    assert.equal(calls[0].kind, 'private');
    assert.equal(calls[0].fallback, null, 'a private reply never falls back to another voice');
    assert.deepEqual(details, ['Mara Venn is answering']);
    await assert.rejects(run({ worldId: 'w1', input: { messages: [] } }, { signal: new AbortController().signal, setDetail: () => {}, log: () => {} }), /no messages/u);
});

test('in a quiet word, the picture is always of the person, in their usual clothes unless the moment changes them', async () => {
    const world = memoryWorld({
        chatId: 'chat-1',
        entities: { 'character:mara venn': { id: 'character:mara venn', type: 'character', name: 'Mara Venn', enabled: true, summary: 'The innkeeper.', importance: 70 } },
        portraits: { 'mara venn': { name: 'Mara Venn', path: '/p.webp', tags: ['1girl', 'mature female', 'wiry', 'small breasts', 'grey hair', 'white linen shirt', 'brown leather apron'], seed: 777, at: 1 } },
    });
    const seen = [];
    const llm = { request: async ({ messages }) => { seen.push(messages.map(message => message.content).join('\n')); return 'SUBJECT: nobody\nTAGS: upper body, leaning on counter, whispering, tavern, lantern light'; } };
    const drawn = [];
    const run = createPictureJob({ llm, images: fakeImages(drawn), store: world });
    await run({ worldId: 'w1', chatId: 'chat-1', input: { id: 'pic-moment1', person: 'Mara Venn', channel: 'aside', description: 'Mara leans across the bar.', senderLocation: 'Salt Lantern', others: ['Old Fen'], names: { playerName: 'Jet' }, connection: { url: 'http://x/v1', model: 'm' }, settings: {} } }, tools());
    assert.match(seen[0], /shows Mara Venn as Jet sees them right now, face to face at Salt Lantern/u);
    assert.match(seen[0], /Mara Venn usually wears: white linen shirt, brown leather apron/u);
    assert.match(seen[0], /Others nearby: Old Fen/u);
    assert.equal(drawn[0].seed, 777, 'their look\'s seed, though the model answered nobody');
    assert.equal(drawn[0].prompt, '1girl, solo, upper body, mature female, wiry, small breasts, grey hair, white linen shirt, brown leather apron, leaning on counter, whispering, tavern, lantern light, masterpiece, best quality, amazing quality, very aesthetic');
    assert.equal(world.snapshot.pictures['pic-moment1'].channel, 'aside');
});
