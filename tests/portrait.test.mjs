import assert from 'node:assert/strict';
import test from 'node:test';

import { createEmptyStore, mergeEntityOperations } from '../core.js?v=49';
import { applyGameOperations, createGameState, gameContext, normalizeGameRecords } from '../game.js?v=6';
import {
    buildPictureMessages,
    buildPortraitMessages,
    clothingFromDescription,
    composePicturePrompt,
    composePortraitPrompt,
    drawableMark,
    createPortraitQueue,
    findLook,
    findPortrait,
    lookTags,
    outfitOf,
    parsePictureReply,
    parsePortraitTags,
    pictureFileStem,
    pictureNegativeFor,
    portraitNegativeFor,
    withoutImagePrompts,
    portraitPayload,
    portraitSource,
    seedFromInfo,
    withChestTag,
} from '../portrait.js?v=9';

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
    assert.deepEqual(parsePortraitTags('1boy, old man, white beard, fen hat', 'Old Fen'), ['1boy', 'old man', 'white beard'], 'a common word in a name is no name');
});

test('the prompt keeps subject, framing and style, and drops the person\'s last tags to fit what the model reads', () => {
    assert.equal(
        composePortraitPrompt(['1boy', 'young man', 'dark curly hair'], 'masterpiece, best quality'),
        '1boy, solo, portrait, upper body, looking at viewer, young man, dark curly hair, gradient background, masterpiece, best quality',
    );
    const many = ['1girl', 'mature female', 'broad shoulders', 'muscular', 'tall', 'short black hair', 'grey eyes', 'tan skin', 'scar on hand',
        'white scar across knuckles', 'long dark storm coat', 'salt-stained coat', 'high collar', 'gloves', 'stern expression', 'stone archway', 'lantern', 'harbor'];
    const prompt = composePortraitPrompt(many);
    // Measured with Local Dream's tokenizer: this prompt is 71 of the 77 tokens it reads. The
    // chest tag follows the build and the plain backdrop stays; the person's last tags gave way.
    assert.equal(prompt, '1girl, solo, portrait, upper body, looking at viewer, mature female, broad shoulders, muscular, tall, medium breasts, short black hair, grey eyes, tan skin, scar on hand, white scar across knuckles, long dark storm coat, salt-stained coat, gradient background, masterpiece, best quality, amazing quality, very aesthetic');
    assert.equal(composePortraitPrompt(['1boy', 'old man'], 'masterpiece', { background: '' }), '1boy, solo, portrait, upper body, looking at viewer, old man, masterpiece', 'an empty backdrop setting adds none');
    const payload = portraitPayload(prompt, { steps: 24, cfg: 5.5, seed: 7 });
    assert.equal(payload.steps, 24);
    assert.equal(payload.cfg_scale, 5.5);
    assert.equal(payload.seed, 7);
    assert.equal(payload.sampler_name, 'Euler a');
    assert.match(payload.negative_prompt, /bad hands/u);
    assert.doesNotMatch(payload.negative_prompt, /nsfw/u);
});

test('a woman\'s chest is stated in line with her build, never left to the model; a man gets none', () => {
    const [system] = buildPortraitMessages({ name: 'Mara Venn', summary: 'An innkeeper.' });
    assert.match(system.content, /exactly one chest tag in line with that build/u);
    assert.match(system.content, /No background, place, weather or lighting tags/u);
    assert.match(system.content, /marks with where they are/u);
    assert.doesNotMatch(system.content, /background tag that fits/u);

    // Synonyms become the tag the model knows; a second chest tag is dropped; places and light go.
    assert.deepEqual(parsePortraitTags('1girl, mature female, slim, busty, small breasts, grey hair, tavern, simple background, candlelight, apron'),
        ['1girl', 'mature female', 'slim', 'large breasts', 'grey hair', 'apron']);
    // Left out by the model: taken from the build, placed right after it.
    assert.deepEqual(withChestTag(['1girl', 'young woman', 'slender', 'long black hair', 'cloak']), ['1girl', 'young woman', 'slender', 'small breasts', 'long black hair', 'cloak']);
    assert.deepEqual(withChestTag(['1girl', 'mature female', 'plump', 'red hair']), ['1girl', 'mature female', 'plump', 'large breasts', 'red hair']);
    assert.deepEqual(withChestTag(['1girl', 'old woman', 'grey hair']), ['1girl', 'old woman', 'medium breasts', 'grey hair']);
    assert.deepEqual(withChestTag(['1girl', 'grey hair', 'apron', 'tall', 'scar', 'small breasts']), ['1girl', 'small breasts', 'grey hair', 'apron', 'tall', 'scar'], 'moved up where the window never cuts it');
    assert.deepEqual(withChestTag(['1boy', 'old man', 'flat chest', 'beard']), ['1boy', 'old man', 'beard']);
    // The negative keeps a larger chest away, and carries no nsfw tag.
    assert.match(portraitNegativeFor(['1girl', 'medium breasts']), /large breasts, huge breasts, cleavage$/u);
    assert.match(portraitNegativeFor(['1girl', 'large breasts']), /huge breasts, gigantic breasts$/u);
    assert.doesNotMatch(portraitNegativeFor(['1boy', 'beard']), /breasts/u);
    assert.doesNotMatch(portraitNegativeFor(['1girl', 'small breasts']), /nsfw/u);
});

test('a look is the tags and seed of a person\'s portrait, kept even before a portrait exists', () => {
    const records = {
        'the dock crier': { name: 'Wren Hollis', path: '/user/images/InnerLore/m.webp', prompt: '1girl, solo, portrait, upper body, looking at viewer, young woman, red hair, freckles, harbor, masterpiece, best quality', seed: 42 },
        'bryn tolley': { name: 'Bryn Tolley', tags: ['1girl', 'mature female', 'stocky', 'medium breasts'], seed: 7 },
        'no seed': { name: 'No Seed', tags: ['1boy'], path: '/x.webp' },
    };
    const wren = findLook(records, 'Wren Hollis', ['the dock crier']);
    assert.equal(wren.key, 'the dock crier', 'found under an old alias');
    assert.deepEqual(lookTags(wren.record), ['1girl', 'young woman', 'red hair', 'freckles'], 'an old record\'s prompt, less framing, place and style');
    assert.equal(findLook(records, 'Bryn Tolley').record.seed, 7, 'a look with no picture yet');
    assert.equal(findPortrait(records, 'Bryn Tolley'), null, 'which is not yet a portrait');
    assert.equal(findLook(records, 'No Seed'), null, 'no seed, no look');
    assert.equal(seedFromInfo('{"seed": 123456789, "width": 1024}', 5), 123456789, 'the seed the server reports');
    assert.equal(seedFromInfo('not json', 5), 5);
    assert.equal(seedFromInfo({ seed: -1 }, 5), 5);
});

test('a picture shows its subject from their look, the shot around them, and no plain backdrop', () => {
    const [system, user] = buildPictureMessages({ description: 'me behind the bar, ledger in hand', sender: 'Mara Venn', senderLocation: 'Salt Lantern', people: [{ name: 'Mara Venn' }, { name: 'Old Fen' }] });
    assert.match(system.content, /a photo Mara Venn took and sent from their phone/u);
    assert.match(system.content, /Never describe the person's face, hair or body/u);
    assert.match(system.content, /when Picture says what they wear, or the moment dresses them differently from usual[\s\S]*you must give two to four clothing tags/u);
    assert.match(system.content, /Always give one or two tags for the place/u);
    assert.match(system.content, /the pose \(standing, sitting, leaning on counter/u);
    assert.match(user.content, /^Picture: me behind the bar, ledger in hand\nSender: Mara Venn, at Salt Lantern\nPEOPLE: Mara Venn, Old Fen\n\nSUBJECT and TAGS:$/u);
    const [mind] = buildPictureMessages({ description: 'x', sender: 'Mara', channel: 'mind' });
    assert.match(mind.content, /an image Mara shows someone in their mind: a memory, or what they see right now, as clear as sight/u);
    assert.match(mind.content, /Mara shows it through their own eyes, so they are not in it unless Picture says they are[\s\S]*"My" \(my room, my rag\) does not put them in it/u);
    assert.match(system.content, /"My" \(my room, my cat\) does not put them in it/u);
    assert.match(buildPictureMessages({ description: 'x', sender: 'Mara', usualOutfit: 'white linen shirt, brown apron' })[1].content, /Mara usually wears: white linen shirt, brown apron/u);
    // In a quiet word, the picture is the player's own view of the person, there and then.
    const [inPerson, inPersonUser] = buildPictureMessages({ description: 'Mara leans in', channel: 'aside', sender: 'Mara Venn', viewer: 'Jet', senderLocation: 'Salt Lantern', others: [] });
    assert.match(inPerson.content, /shows Mara Venn as Jet sees them right now, face to face at Salt Lantern[\s\S]*Draw only Mara Venn: Jet is the one looking/u);
    assert.match(inPersonUser.content, /Mara Venn and Jet are alone\./u);
    assert.match(buildPictureMessages({ description: 'x', channel: 'aside', sender: 'Mara', viewer: 'Jet', others: ['Old Fen'] })[1].content, /Others nearby: Old Fen/u);
    assert.deepEqual(parsePictureReply('SUBJECT: nobody\nTAGS: upper body, leaning forward', { sender: 'Mara Venn', channel: 'aside' }).subject, { kind: 'sender', name: 'Mara Venn' }, 'in person it is always them');

    const people = [{ name: 'Mara Venn', aliases: ['the innkeeper'] }, { name: 'Old Fen' }];
    const selfie = parsePictureReply('SUBJECT: sender\nTAGS: selfie, upper body, smile, holding mug, grey hair, white shirt, Mara at the bar, indoors, tavern, warm lighting', { sender: 'Mara Venn', people });
    assert.deepEqual(selfie.subject, { kind: 'sender', name: 'Mara Venn' });
    assert.deepEqual(selfie.tags, ['selfie', 'upper body', 'smile', 'holding mug', 'white shirt', 'indoors', 'tavern', 'warm lighting'], 'face, hair and names are not the shot\'s; what they wear in it is');
    assert.deepEqual(parsePictureReply('SUBJECT: old fen\nTAGS: upper body, mending net', { sender: 'Mara Venn', people }).subject, { kind: 'person', name: 'Old Fen' });
    assert.deepEqual(parsePictureReply('SUBJECT: the innkeeper\nTAGS: cowboy shot', { sender: 'Mara Venn', people }).subject, { kind: 'sender', name: 'Mara Venn' });
    const view = parsePictureReply('**SUBJECT:** nobody\n**TAGS:** scenery, harbor, 1girl, night, no humans, lanterns', { sender: 'Mara Venn', people });
    assert.equal(view.subject, null);
    assert.deepEqual(view.tags, ['no humans', 'scenery', 'harbor', 'night', 'lanterns']);

    const look = ['1girl', 'mature female', 'slim', 'short grey hair', 'grey eyes', 'brown apron', 'stern expression'];
    assert.equal(outfitOf(look), 'brown apron');
    const prompt = composePicturePrompt({ identity: look, scene: selfie.tags, style: 'masterpiece' });
    assert.equal(prompt, '1girl, solo, selfie, upper body, mature female, slim, small breasts, short grey hair, grey eyes, smile, white shirt, holding mug, indoors, tavern, warm lighting, masterpiece', 'dressed differently: the shot\'s clothes replace the usual, and its expression sits with the face');
    assert.equal(composePicturePrompt({ identity: look, scene: ['cowboy shot', 'leaning on counter', 'tavern'], style: 'masterpiece' }),
        '1girl, solo, cowboy shot, mature female, slim, small breasts, short grey hair, grey eyes, stern expression, brown apron, leaning on counter, tavern, masterpiece', 'otherwise the usual clothes, in a new pose');
    assert.doesNotMatch(prompt, /background/u, 'a sent picture keeps its scene');
    assert.equal(composePicturePrompt({ identity: look, scene: ['indoors'], style: 'masterpiece' }).split(', ').slice(0, 4).join(', '), '1girl, solo, upper body, mature female', 'framed from the waist up when the shot says nothing');
    assert.equal(composePicturePrompt({ scene: view.tags, channel: 'mind', style: 'masterpiece' }), 'no humans, scenery, harbor, night, lanterns, masterpiece', 'a mind\'s image is as clear as a photo');
    assert.match(pictureNegativeFor([]), /1girl, 1boy, people$/u);
    assert.match(pictureNegativeFor(look), /large breasts, huge breasts, cleavage$/u);
    assert.match(pictureFileStem('Chat - 1', 'pic-abc123'), /^[0-9a-f]+-chat-1-picture-pic-abc123$/u);
});

test('a picture changes clothes only for a new garment, takes what the description names, and keeps the place', () => {
    // What the description says they wear is kept even when the model leaves it out.
    assert.deepEqual(clothingFromDescription('me on the stairs in my dark green wool dress, smiling'), ['dark green wool dress']);
    assert.deepEqual(clothingFromDescription('Mara in a red silk gown and a black lace shawl'), ['red silk gown']);
    assert.deepEqual(clothingFromDescription('holding your coat, by the fire'), [], 'a coat in hand is not worn');
    assert.deepEqual(clothingFromDescription('just me at the bar'), []);

    const style = 'masterpiece, best quality, amazing quality, very aesthetic';
    const look = ['1girl', 'mature female', 'tall', 'short grey hair', 'grey eyes', 'crow\'s feet', 'burn scar on arm', 'wrinkles', 'white linen shirt', 'rolled sleeves', 'brown leather apron'];
    // An accessory alone is worn with the usual clothes.
    const towel = composePicturePrompt({ identity: look, scene: ['cowboy shot', 'towel over shoulder', 'leaning on counter', 'standing behind bar', 'indoors', 'tavern', 'warm lighting'], style });
    assert.match(towel, /white linen shirt, rolled sleeves, brown leather apron, towel over shoulder, leaning on counter/u);
    assert.match(towel, /indoors, tavern, masterpiece/u, 'the place outlasts the finer points of the pose');
    // A new garment is a change of clothes; face, hair and body stay.
    const gown = composePicturePrompt({ identity: look, scene: ['full body', 'dark green wool dress', 'standing', 'smiling', 'stairs', 'inn interior'], style });
    assert.equal(gown, '1girl, solo, full body, mature female, tall, medium breasts, short grey hair, grey eyes, crow\'s feet, scar on arm, wrinkles, smiling, dark green wool dress, standing, stairs, inn interior, masterpiece, best quality, amazing quality, very aesthetic');
    // Their own clothes named loosely are still theirs, in the look's own words.
    const loose = composePicturePrompt({ identity: look, scene: ['upper body', 'white shirt', 'leather apron', 'leaning on counter', 'tavern'], style });
    assert.match(loose, /white linen shirt, rolled sleeves, brown leather apron, leaning on counter, tavern/u);
    assert.doesNotMatch(loose, /white shirt|, leather apron/u);
    // A burn away from the face is drawn as a scar there ("burn scar" alone lands on the face)...
    assert.equal(drawableMark('burn scar on left forearm'), 'scar on left forearm');
    assert.equal(drawableMark('burns across back'), 'scar across back');
    assert.equal(drawableMark('burn scar on cheek'), 'burn scar on cheek', 'a burn on the face stays one');
    assert.equal(drawableMark('burn scar'), 'burn scar');
    assert.match(composePortraitPrompt(look), /grey eyes, crow's feet, scar on arm, wrinkles/u);
    // ...and a scar placed away from the face keeps the face clear; one on the face is left alone.
    assert.match(pictureNegativeFor(look), /scar on face, scar on cheek, scar across eye$/u);
    assert.doesNotMatch(portraitNegativeFor(['1girl', 'scar on cheek', 'burn scar on arm']), /scar on face/u);
    assert.doesNotMatch(portraitNegativeFor(['1girl', 'burn scar']), /scar on face/u, 'a scar with no place says nothing');
    // A long look and a busy shot: the person's extras and the shot's give way, the place stays.
    const long = [...look, 'freckles', 'thin lips', 'hooked nose', 'silver earrings', 'tattoo on neck', 'eyepatch'];
    const busy = composePicturePrompt({ identity: long, scene: ['cowboy shot', 'wiping glass', 'leaning on counter', 'looking at viewer', 'smirk', 'indoors', 'tavern', 'candlelight'], style });
    assert.match(busy, /^1girl, solo, cowboy shot, mature female, tall, medium breasts, short grey hair, grey eyes/u);
    assert.match(busy, /smirk, white linen shirt, rolled sleeves, brown leather apron, wiping glass/u, 'the expression outlasts the pose\'s details');
    assert.match(busy, /indoors, tavern, masterpiece/u);
    assert.doesNotMatch(busy, /eyepatch|looking at viewer/u);
});

test('image records keep the file, look and seed, never the prompt that was sent', () => {
    const pruned = withoutImagePrompts({
        portraits: {
            'mara venn': { name: 'Mara Venn', path: '/user/images/InnerLore/a.webp', prompt: '1girl, solo, portrait, upper body, looking at viewer, mature female, short grey hair, gradient background, masterpiece', tags: ['1girl', 'mature female', 'short grey hair'], seed: 7 },
            'old fen': { name: 'Old Fen', path: '/user/images/InnerLore/b.webp', prompt: '1boy, solo, portrait, upper body, looking at viewer, old man, white beard, simple background, masterpiece', seed: 9 },
        },
        pictures: { 'pic-abc12345': { id: 'pic-abc12345', path: '/user/images/InnerLore/c.webp', prompt: 'no humans, tavern, masterpiece', seed: 3 } },
    });
    assert.equal(pruned.changed, true);
    assert.deepEqual(pruned.portraits['mara venn'], { name: 'Mara Venn', path: '/user/images/InnerLore/a.webp', tags: ['1girl', 'mature female', 'short grey hair'], seed: 7 });
    assert.deepEqual(pruned.portraits['old fen'].tags, ['1boy', 'old man', 'white beard'], 'a look from before keeps its tags');
    assert.equal('prompt' in pruned.portraits['old fen'], false);
    assert.deepEqual(pruned.pictures['pic-abc12345'], { id: 'pic-abc12345', path: '/user/images/InnerLore/c.webp', seed: 3 });
    assert.equal(withoutImagePrompts({ portraits: pruned.portraits, pictures: pruned.pictures }).changed, false, 'nothing more to do');
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
    const { hashString } = await import('../core.js?v=49');
    const { chatPortraitFiles, isLegacyPortraitFileOf, ownsPortraitFile, portraitFileStem } = await import('../portrait.js?v=9');
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
    const { orphanPortraitFiles, portraitFileStem } = await import('../portrait.js?v=9');
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
    const { foreignPortraitRecords, portraitFileStem } = await import('../portrait.js?v=9');
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
