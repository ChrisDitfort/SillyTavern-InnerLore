import assert from 'node:assert/strict';
import test from 'node:test';

import { createEmptyStore, mergeEntityOperations } from '../core.js?v=48';
import { applyGameOperations, createGameState, gameContext, normalizeGameRecords } from '../game.js?v=2';
import {
    buildPortraitMessages,
    composePortraitPrompt,
    createPortraitQueue,
    findPortrait,
    parsePortraitTags,
    portraitPayload,
    portraitSource,
} from '../portrait.js';

function storeWithPeople() {
    const store = createEmptyStore('portrait-test');
    mergeEntityOperations(store, [
        { type: 'location', name: 'Vigil Cross', importance: 70, summary: 'A walled frontier town of salt and lantern-light.' },
        { type: 'character', name: 'Elka Draven', importance: 80, summary: 'Warden-Captain of the gate, who stamps passes.', description: 'Broad as a door, in a salt-stained storm-dark coat, with a white scar-seam across both knuckles.', facts: ['Grey threads her cropped hair; her eyes are pale as river ice.'] },
        { type: 'character', name: 'Quiet Stranger', importance: 30 },
    ], { messageIndex: 0, maximumOperations: 10 });
    let state = createGameState();
    const context = gameContext(state, { playerName: 'Jet', entities: store.entities, scenePlace: { name: 'Vigil Cross' } });
    const { ops } = normalizeGameRecords({
        stages: [{ place: 'Vigil Cross' }],
        people: [{ name: 'Mags Tarrow', location: 'Vigil Cross', role: 'fish-seller', appearance: 'stout woman in her fifties, grey hair in a knot, oilskin apron' }],
    }, context, { source: 'planner' });
    state = applyGameOperations(state, ops, { messageIndex: 1, source: 'planner' }).state;
    store.game = state;
    return store;
}

test('a portrait is drawn from the curator\'s description or the planner\'s appearance, never from a name alone', () => {
    const store = storeWithPeople();
    const elka = portraitSource(store, 'Elka Draven', { placeName: 'Vigil Cross' });
    assert.match(elka.description, /scar-seam across both knuckles/u);
    assert.equal(elka.placeSummary, 'A walled frontier town of salt and lantern-light.');
    const mags = portraitSource(store, 'Mags Tarrow');
    assert.equal(mags.role, 'fish-seller');
    assert.match(mags.appearance, /oilskin apron/u);
    assert.equal(portraitSource(store, 'Quiet Stranger'), null);
    assert.equal(portraitSource(store, 'Nobody'), null);
    const [system, user] = buildPortraitMessages(elka);
    assert.match(system.content, /Start with exactly one of 1girl, 1boy or 1other/u);
    assert.match(user.content, /Description: Broad as a door/u);
    assert.match(user.content, /Facts: Grey threads her cropped hair; her eyes are pale as river ice\./u);
    assert.match(user.content, /Where they are: Vigil Cross: A walled frontier town/u);
});

test('the tag line is cleaned: subject first, no quality, gaze, name or duplicate tags', () => {
    const tags = parsePortraitTags('```\nTags: mature female, 1girl, Masterpiece, (grey eyes:1.2), grey_eyes, looking down, elka smiling, storm coat, best quality\n```', 'Elka Draven');
    assert.deepEqual(tags, ['1girl', 'mature female', 'grey eyes', 'storm coat']);
    assert.deepEqual(parsePortraitTags('I cannot help with that.'), []);
});

test('the prompt keeps subject, framing and style, and drops the person\'s last tags to fit what the model reads', () => {
    assert.equal(
        composePortraitPrompt(['1boy', 'young man', 'dark curly hair'], 'masterpiece, best quality'),
        '1boy, solo, portrait, upper body, looking at viewer, young man, dark curly hair, masterpiece, best quality',
    );
    const many = ['1girl', 'mature female', 'broad shoulders', 'muscular', 'tall', 'short black hair', 'grey eyes', 'tan skin', 'scar on hand',
        'white scar across knuckles', 'long dark storm coat', 'salt-stained coat', 'high collar', 'gloves', 'stern expression', 'stone archway', 'lantern', 'harbor'];
    const prompt = composePortraitPrompt(many);
    // Measured with Local Dream's tokenizer: this prompt is 73 of the 75 tokens it reads.
    assert.equal(prompt, '1girl, solo, portrait, upper body, looking at viewer, mature female, broad shoulders, muscular, tall, short black hair, grey eyes, tan skin, scar on hand, white scar across knuckles, long dark storm coat, salt-stained coat, high collar, gloves, stern expression, masterpiece, best quality, amazing quality, very aesthetic');
    const payload = portraitPayload(prompt, { steps: 24, cfg: 5.5, seed: 7 });
    assert.equal(payload.steps, 24);
    assert.equal(payload.cfg_scale, 5.5);
    assert.equal(payload.seed, 7);
    assert.equal(payload.sampler_name, 'Euler a');
    assert.match(payload.negative_prompt, /bad hands/u);
});

test('a portrait is found under the person\'s name or any alias', () => {
    const records = { 'elka draven': { name: 'Elka Draven', path: 'user/images/InnerLore/elka.webp' } };
    assert.equal(findPortrait(records, 'Warden-Captain Elka Draven', ['Elka Draven']).path, 'user/images/InnerLore/elka.webp');
    assert.equal(findPortrait(records, 'Mags Tarrow'), null);
});

test('portraits are drawn one at a time; a failure waits, a dead server pauses the queue, a forced redraw goes first', async () => {
    let clock = 0;
    const order = [];
    const pending = [];
    const queue = createPortraitQueue({
        now: () => clock,
        retryMs: 1_000,
        run: job => new Promise((resolve, reject) => {
            order.push(job.key);
            pending.push({ resolve, reject });
        }),
    });
    const settle = async (outcome = 'ok') => {
        const next = pending.shift();
        if (outcome === 'ok') next.resolve();
        else next.reject(Object.assign(new Error(outcome), { serverDown: outcome === 'down' }));
        await new Promise(resolve => setTimeout(resolve, 0));
    };
    queue.want([{ key: 'a', name: 'A', chatId: 'c' }, { key: 'b', name: 'B', chatId: 'c' }, { key: 'a', name: 'A', chatId: 'c' }]);
    assert.deepEqual(order, ['a']);
    assert.ok(queue.isDrawing('b'));
    await settle('bad tags');
    assert.deepEqual(order, ['a', 'b']);
    queue.want([{ key: 'a', name: 'A', chatId: 'c' }]);
    await settle();
    assert.deepEqual(order, ['a', 'b'], 'a failed person waits before another try');
    clock = 2_000;
    queue.want([{ key: 'a', name: 'A', chatId: 'c' }, { key: 'c', name: 'C', chatId: 'c' }]);
    await settle('down');
    assert.equal(queue.active, null, 'a dead server drops the rest of the queue');
    queue.want([{ key: 'd', name: 'D', chatId: 'c' }]);
    assert.equal(queue.active, null, 'and pauses it');
    queue.want([{ key: 'd', name: 'D', chatId: 'c', force: true }]);
    assert.equal(queue.active.key, 'd', 'a redraw the player asked for still runs');
    await settle();
    clock = 10_000;
    queue.want([{ key: 'x', name: 'X', chatId: 'old' }, { key: 'e', name: 'E', chatId: 'old' }, { key: 'f', name: 'F', chatId: 'old' }]);
    assert.equal(queue.active.key, 'x');
    queue.keepChat('new');
    queue.want([{ key: 'g', name: 'G', chatId: 'new' }]);
    await settle();
    assert.equal(queue.active.key, 'g', 'switching chats forgets the old chat\'s waiting people');
    await settle();
});

test('portrait files are named for their chat and told apart exactly', async () => {
    const { hashString } = await import('../core.js?v=48');
    const { chatPortraitFiles, isLegacyPortraitFileOf, ownsPortraitFile, portraitFileStem } = await import('../portrait.js');
    // Renamed chats carry whatever name the player gave them: one may begin like another.
    const chat = 'Tavern';
    const nested = 'Tavern night';
    const stem = portraitFileStem(chat, 'hob garrow');
    assert.equal(stem, `${hashString(chat)}-tavern-hob-garrow`);
    assert.ok(ownsPortraitFile(chat, `/user/images/InnerLore/${stem}-123.webp`));
    assert.equal(ownsPortraitFile(nested, `${stem}-123.webp`), false);
    assert.equal(ownsPortraitFile('', `${stem}-123.webp`), false);
    const long = `${'A'.repeat(120)} - 2026-10-21@19h12m45s191ms`;
    assert.ok(portraitFileStem(long, 'x').length <= 90, 'the file name stays short');
    assert.ok(ownsPortraitFile(long, `${portraitFileStem(long, 'x')}-1.webp`), 'the hash is never cut off');
    const files = [
        `${stem}-123.webp`,
        `${portraitFileStem(nested, 'hob garrow')}-9.webp`,
        'tavern-hob-garrow-5.webp',
        'tavern-night-hob-garrow-6.webp',
    ];
    assert.deepEqual(chatPortraitFiles(chat, files), [files[0]], 'a deleted chat takes only the files named for it');
    assert.ok(isLegacyPortraitFileOf(chat, files[2]));
    assert.ok(isLegacyPortraitFileOf(chat, files[3]), 'a pre-hash file of a chat named like the start of this one cannot be told apart');
    assert.equal(isLegacyPortraitFileOf(nested, files[2]), false);
    assert.equal(isLegacyPortraitFileOf(chat, files[0]), false, 'an own hashed file is not legacy');
});

test('the sweep keeps every portrait file an existing chat could own, under either naming', async () => {
    const { orphanPortraitFiles, portraitFileStem } = await import('../portrait.js');
    const fracture = 'The Fracture - 2026-10-19@04h33m36s237ms';
    const squire = 'Your useless squire - 2026-10-21@19h12m45s191ms';
    const files = [
        'the-fracture-2026-10-19-04h33m36s237ms-warden-captain-elka-draven-3368285486.webp',
        `${portraitFileStem(squire, 'hob garrow')}-1.webp`,
        `${portraitFileStem('Gone - 2026-01-01@00h00m00s000ms', 'nobody')}-2.webp`,
        'gone-chat-2026-01-01-00h00m00s000ms-nobody-3.webp',
    ];
    assert.deepEqual(orphanPortraitFiles(files, [fracture, squire, '']), [files[2], files[3]]);
    assert.deepEqual(orphanPortraitFiles(files.map(file => `/user/images/InnerLore/${file}`), [fracture, squire]), [files[2], files[3]], 'paths are read by their file name');
});

test('inherited and pre-hash portrait records are foreign to the chat that shows them', async () => {
    const { foreignPortraitRecords, portraitFileStem } = await import('../portrait.js');
    const chat = 'Branch - 2026-10-21@20h00m00s000ms';
    const records = {
        elka: { name: 'Elka', path: `/user/images/InnerLore/${portraitFileStem(chat, 'elka')}-1.webp` },
        hob: { name: 'Hob', path: '/user/images/InnerLore/parent-2026-10-21-19h12m45s191ms-hob-7.webp' },
        mags: { name: 'Mags', path: `/user/images/InnerLore/${portraitFileStem('Parent - 2026-10-21@19h12m45s191ms', 'mags')}-8.webp` },
        broken: { name: 'Broken' },
    };
    assert.deepEqual(foreignPortraitRecords(records, chat).map(([key]) => key), ['hob', 'mags']);
    assert.deepEqual(foreignPortraitRecords(null, chat), []);
});
