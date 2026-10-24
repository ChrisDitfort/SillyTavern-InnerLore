/**
 * NPC portraits. A short model call turns what the story knows about a person
 * into Danbooru-style tags (what Illustrious and other anime SDXL models read
 * best), an A1111-compatible image server draws them (Local Dream through
 * LDBridge, by default the server SillyTavern's own image generation uses),
 * and the picture is kept per chat in the chat's metadata, keyed by name.
 */
import { canonicalNameKey, cleanString, hashString } from './core.js?v=48';
import { normalizeGameState } from './game.js?v=3';
import { gameRequestSettings } from './game-client.js?v=1';
import { sendInnerLoreRequest } from './llm-client.js?v=16';

export const PORTRAIT_METADATA_KEY = 'innerlore_portraits';
export const PORTRAIT_DEFAULTS = Object.freeze({
    serverUrl: 'http://127.0.0.1:7866',
    style: 'masterpiece, best quality, amazing quality, very aesthetic',
    negative: 'lowres, worst quality, low quality, bad anatomy, bad hands, missing fingers, extra digits, text, signature, watermark, username, blurry, jpeg artifacts, multiple views, 2girls, 2boys, nsfw',
    steps: 20,
    cfg: 6,
    sampler: 'Euler a',
    size: 512,
});
// Kept between the subject tag and the person's own tags, so the framing is
// never cut by the 77-token prompt window.
const FRAMING_TAGS = ['solo', 'portrait', 'upper body', 'looking at viewer'];
const SUBJECT_TAGS = new Set(['1girl', '1boy', '1other']);
const QUALITY_TAG = /^(?:masterpiece|best quality|amazing quality|high quality|very aesthetic|absurdres|highres|newest|score_\d+(?:_up)?|\d+k|ultra detailed|detailed)$/u;
const MAXIMUM_TAGS = 22;
// CLIP reads 75 tokens; the image server drops the rest.
const PROMPT_TOKEN_BUDGET = 74;
// The framing already faces the viewer.
const GAZE_TAG = /^(?:looking (?:away|down|up|back|to the side|at (?!viewer)\S.*)|eyes closed|from behind|back view)$/u;
// A server that never answered is retried after this long; so is a person
// whose portrait failed.
export const PORTRAIT_RETRY_MS = 10 * 60_000;

function characterEntity(store, name) {
    const key = canonicalNameKey(name);
    return Object.values(store?.entities || {}).find(entity => entity?.type === 'character'
        && entity.enabled !== false
        && (canonicalNameKey(entity.name) === key || (entity.aliases || []).some(alias => canonicalNameKey(alias) === key))) || null;
}

function plannedPerson(store, name) {
    const key = canonicalNameKey(name);
    for (const stage of Object.values(normalizeGameState(store?.game).stages || {})) {
        const person = (stage.people || []).find(candidate => canonicalNameKey(candidate.name) === key);
        if (person) return person;
    }
    return null;
}

/**
 * What the story knows about someone's looks and station: the curator's entity
 * record and, for a person the planner prepared, the planner's appearance.
 * Null when nothing beyond the name is known yet.
 */
export function portraitSource(store, name, { placeName = '' } = {}) {
    const entity = characterEntity(store, name);
    const person = plannedPerson(store, entity?.name || name);
    const place = placeName
        ? Object.values(store?.entities || {}).find(candidate => candidate?.type === 'location'
            && canonicalNameKey(candidate.name) === canonicalNameKey(placeName))
        : null;
    const source = {
        name: cleanString(entity?.name || person?.name || name, 120),
        role: cleanString(person?.role, 160),
        appearance: cleanString(person?.appearance, 300),
        manner: cleanString(person?.manner, 200),
        summary: cleanString(entity?.summary, 600),
        description: cleanString(entity?.description, 1_200),
        // Looks often land in facts ("eyes pale as river ice").
        facts: cleanString((entity?.facts || []).slice(0, 8)
            .map(fact => cleanString(typeof fact === 'string' ? fact : fact?.statement, 200)).filter(Boolean).join('; '), 900),
        state: cleanString(entity?.currentState, 300),
        place: cleanString(placeName, 120),
        placeSummary: cleanString(place?.summary, 300),
    };
    return source.appearance || source.summary || source.description || source.role ? source : null;
}

export function buildPortraitMessages(source) {
    const known = [
        ['Role', source.role],
        ['Appearance', source.appearance],
        ['Manner', source.manner],
        ['Summary', source.summary],
        ['Description', source.description],
        ['Facts', source.facts],
        ['Right now', source.state],
        ['Where they are', [source.place, source.placeSummary].filter(Boolean).join(': ')],
    ].filter(([, value]) => value).map(([label, value]) => `${label}: ${value}`).join('\n');
    return [
        {
            role: 'system',
            content: [
                'You write the prompt for a character portrait drawn by an anime-style SDXL image model (Illustrious) that reads Danbooru tags.',
                'Answer with one line of comma-separated lowercase Danbooru tags and nothing else.',
                'Start with exactly one of 1girl, 1boy or 1other. Then, most important first: apparent age (for example young woman, mature female, old man), build, hair colour and style, eye colour, facial hair, skin, scars or other marks, clothing, one or two carried or worn items, expression, and last one background tag that fits where they are (for example harbor, tavern, forest, simple background).',
                'Use only what the material states or clearly implies about this person, plus what their role and setting make likely (a fisherman wears work clothes, not armour). Keep the clothing true to the setting\'s era.',
                'Never tag something that is absent (no "gloves removed" or "no hat"), and nothing with writing or markings on it (no papers, books, signs, ledgers, stamps or seals).',
                'At most 16 tags. No names, no quality or style tags, no artist names, no gaze or pose tags, no sentences, no weights or brackets, nothing sexual.',
            ].join(' '),
        },
        { role: 'user', content: `Person: ${source.name}\n${known}\n\nTags:` },
    ];
}

/** Ask the ledger's model for the tag line; fewer than three usable tags is a failure. */
export async function requestPortraitTags(settings, source, signal) {
    const text = await sendInnerLoreRequest({
        ...gameRequestSettings(settings, 'game'),
        maximumResponseTokens: 800,
        temperature: 0.4,
        telemetryKind: 'portrait',
    }, buildPortraitMessages(source), signal);
    const tags = parsePortraitTags(text, source.name);
    if (tags.length < 3) throw new Error(`The portrait tags were unusable: ${String(text).slice(0, 200)}`);
    return tags;
}

/** The model's tag line as a clean list: subject tag first, no quality tags, no name. */
export function parsePortraitTags(text, name = '') {
    const lines = String(text || '').replace(/```[a-z]*\n?|```/giu, '').split('\n')
        .map(line => line.replace(/^\s*(?:tags|prompt)\s*:\s*/iu, '').trim())
        .filter(line => line.includes(','));
    const nameWords = new Set(String(name).toLocaleLowerCase().split(/\s+/u).filter(word => word.length > 2));
    const tags = [];
    for (const raw of (lines[0] || '').split(',')) {
        const tag = raw.toLocaleLowerCase().replace(/[()[\]{}"]/gu, '').replace(/:[\d.]+$/u, '').replace(/_/gu, ' ').replace(/\s+/gu, ' ').trim();
        if (!tag || tag.length > 40 || QUALITY_TAG.test(tag) || GAZE_TAG.test(tag) || FRAMING_TAGS.includes(tag) || tags.includes(tag)) continue;
        if (tag.split(' ').some(word => nameWords.has(word))) continue;
        tags.push(tag);
    }
    const subject = tags.findIndex(tag => SUBJECT_TAGS.has(tag));
    if (subject > 0) tags.unshift(...tags.splice(subject, 1));
    return tags.slice(0, MAXIMUM_TAGS);
}

// A rough CLIP token count: a word, or a long word's two pieces, per token,
// plus each comma.
function estimatedTokens(text) {
    return (String(text).toLocaleLowerCase().match(/[a-z0-9]+|[^a-z0-9\s]/gu) || [])
        .reduce((total, piece) => total + (piece.length > 8 ? 2 : 1), 0);
}

/**
 * Subject and framing first, then the person's tags (most important first),
 * then the style; the person's last tags give way when it would run past what
 * the model reads.
 */
export function composePortraitPrompt(tags, style = PORTRAIT_DEFAULTS.style) {
    const [first, ...rest] = tags;
    const head = SUBJECT_TAGS.has(first) ? [first, ...FRAMING_TAGS] : [...FRAMING_TAGS, first].filter(Boolean);
    const tail = cleanString(style, 400);
    const body = [...rest];
    const build = () => [...head, ...body, tail].filter(Boolean).join(', ');
    while (body.length && estimatedTokens(build()) > PROMPT_TOKEN_BUDGET) body.pop();
    return build();
}

/** The txt2img request body (the A1111 API that LDBridge speaks). */
export function portraitPayload(prompt, options = {}) {
    const size = Number(options.size) || PORTRAIT_DEFAULTS.size;
    return {
        prompt,
        negative_prompt: cleanString(options.negative ?? PORTRAIT_DEFAULTS.negative, 1_000),
        steps: Number(options.steps) || PORTRAIT_DEFAULTS.steps,
        cfg_scale: Number(options.cfg) || PORTRAIT_DEFAULTS.cfg,
        sampler_name: options.sampler || PORTRAIT_DEFAULTS.sampler,
        width: size,
        height: size,
        seed: Number.isInteger(options.seed) ? options.seed : Math.floor(Math.random() * 4_294_967_295),
        batch_size: 1,
        n_iter: 1,
    };
}

/*
 * Portrait files live in SillyTavern's user images, under InnerLore/, and are
 * named after the chat that drew them: the chat's id hash first, then the
 * chat and the person for a human reader, then the seed. The hash makes a
 * chat's files exact on disk: deleting the chat deletes its files and nothing
 * else's, and the startup sweep removes the files of chats that no longer
 * exist. Files from before the hash (the chat slug alone) are told apart only
 * by that slug, which a chat named like the start of another may share, so
 * they are never deleted on a chat's behalf: only once no existing chat could
 * own them, or once their own chat has copied them into named files.
 */
export const PORTRAIT_FOLDER = 'InnerLore';
export const PORTRAIT_FOLDER_PATH = `user/images/${PORTRAIT_FOLDER}`;
const PORTRAIT_STEM_LIMIT = 90;

function portraitSlug(text) {
    return String(text ?? '').toLocaleLowerCase().replace(/[^a-z0-9]+/gu, '-');
}

/** The file name (without seed and extension) of a person's portrait drawn for a chat. */
export function portraitFileStem(chatId, key) {
    return `${hashString(chatId)}-${portraitSlug(`${chatId}-${key}`).slice(0, PORTRAIT_STEM_LIMIT - 9)}`;
}

/** The start every file drawn for a chat shares. */
export function portraitFilePrefix(chatId) {
    return chatId ? `${hashString(chatId)}-` : '';
}

function legacyPortraitFilePrefix(chatId) {
    return chatId ? portraitSlug(`${chatId}-`).slice(0, PORTRAIT_STEM_LIMIT) : '';
}

export function portraitFileName(pathOrName) {
    return String(pathOrName ?? '').split('/').pop();
}

/** Whether a file was drawn for this chat under the current naming. */
export function ownsPortraitFile(chatId, pathOrName) {
    const prefix = portraitFilePrefix(chatId);
    return Boolean(prefix) && portraitFileName(pathOrName).startsWith(prefix);
}

/** Whether a file from before the hash naming carries this chat's slug (which another chat's may begin with). */
export function isLegacyPortraitFileOf(chatId, pathOrName) {
    const prefix = legacyPortraitFilePrefix(chatId);
    const file = portraitFileName(pathOrName);
    return Boolean(prefix) && !ownsPortraitFile(chatId, file) && file.startsWith(prefix);
}

/** The files a deleted chat drew, exactly: never a legacy file, which the sweep decides. */
export function chatPortraitFiles(chatId, files) {
    return (files || []).map(portraitFileName).filter(file => ownsPortraitFile(chatId, file));
}

/** The files no existing chat could own, under either naming. */
export function orphanPortraitFiles(files, existingChatIds) {
    const ids = [...new Set((existingChatIds || []).filter(Boolean))];
    return (files || []).map(portraitFileName)
        .filter(file => file && !ids.some(id => ownsPortraitFile(id, file) || isLegacyPortraitFileOf(id, file)));
}

/** The records a chat shows but whose files it does not own: inherited from the chat it was branched, renamed or started from, or drawn before the hash naming. */
export function foreignPortraitRecords(records, chatId) {
    return Object.entries(records && typeof records === 'object' ? records : {})
        .filter(([, record]) => typeof record?.path === 'string' && record.path && !ownsPortraitFile(chatId, record.path));
}

/** Someone's portrait record, found by name or by any alias the story gave them. */
export function findPortrait(records, name, aliases = []) {
    for (const candidate of [name, ...aliases]) {
        const record = records?.[canonicalNameKey(candidate)];
        if (record?.path) return record;
    }
    return null;
}

/**
 * One portrait at a time (the image server draws one), in the order asked.
 * A person whose portrait failed waits PORTRAIT_RETRY_MS before another try;
 * a server that could not be reached pauses the whole queue that long.
 */
export function createPortraitQueue({ run, onChange = () => {}, now = () => Date.now(), retryMs = PORTRAIT_RETRY_MS } = {}) {
    const waiting = [];
    const failedAt = new Map();
    let active = null;
    let pausedUntil = 0;
    const has = key => active?.key === key || waiting.some(job => job.key === key);
    async function pump() {
        if (active || !waiting.length) return;
        active = waiting.shift();
        onChange(active.key);
        try {
            await run(active);
            failedAt.delete(active.key);
        } catch (error) {
            failedAt.set(active.key, now());
            if (error?.serverDown) {
                pausedUntil = now() + retryMs;
                waiting.length = 0;
            }
            console.warn(`[InnerLore] No portrait for ${active.name}:`, error?.message || error);
        } finally {
            const done = active;
            active = null;
            onChange(done.key);
            pump();
        }
    }
    return {
        /** Queue people ({ key, name, chatId, force }); a forced one skips the waits and goes first. */
        want(jobs) {
            for (const job of jobs) {
                if (!job?.key || has(job.key)) continue;
                if (!job.force && (now() < pausedUntil || now() - (failedAt.get(job.key) ?? -Infinity) < retryMs)) continue;
                if (job.force) waiting.unshift(job);
                else waiting.push(job);
            }
            pump();
        },
        /** Forget queued people of another chat. */
        keepChat(chatId) {
            for (let index = waiting.length - 1; index >= 0; index -= 1) {
                if (waiting[index].chatId !== chatId) waiting.splice(index, 1);
            }
        },
        isDrawing: key => has(key),
        get active() { return active; },
    };
}
