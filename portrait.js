/**
 * NPC portraits. A short model call turns what the story knows about a person
 * into Danbooru-style tags (what Illustrious and other anime SDXL models read
 * best), an A1111-compatible image server draws them (Local Dream through
 * LDBridge, by default the server SillyTavern's own image generation uses),
 * and the picture is kept per chat in the chat's metadata, keyed by name.
 */
import { canonicalNameKey, cleanString, hashString } from './core.js?v=49';
import { normalizeGameState } from './game.js?v=6';
import { gameRequestSettings } from './game-client.js?v=4';
import { sendInnerLoreRequest } from './llm-client.js?v=21';

export const PORTRAIT_METADATA_KEY = 'innerlore_portraits';
export const PORTRAIT_DEFAULTS = Object.freeze({
    serverUrl: 'http://127.0.0.1:7866',
    style: 'masterpiece, best quality, amazing quality, very aesthetic',
    // Portraits sit on a plain backdrop; the person is the picture.
    background: 'gradient background',
    negative: 'lowres, worst quality, low quality, bad anatomy, bad hands, missing fingers, extra digits, text, signature, watermark, username, blurry, jpeg artifacts, multiple views, 2girls, 2boys',
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
// One chest tag in line with the build: the anime models draw a woman
// buxom unless told otherwise, so the size is always stated.
export const CHEST_TAGS = Object.freeze(['flat chest', 'small breasts', 'medium breasts', 'large breasts']);
const CHEST_SYNONYMS = new Map([
    ['flat-chested', 'flat chest'], ['flat chested', 'flat chest'],
    ['small chest', 'small breasts'], ['small bust', 'small breasts'], ['modest chest', 'small breasts'], ['modest bust', 'small breasts'], ['modest breasts', 'small breasts'], ['petite chest', 'small breasts'],
    ['medium chest', 'medium breasts'], ['medium bust', 'medium breasts'], ['average chest', 'medium breasts'], ['average breasts', 'medium breasts'], ['average bust', 'medium breasts'],
    ['large chest', 'large breasts'], ['large bust', 'large breasts'], ['big breasts', 'large breasts'], ['huge breasts', 'large breasts'], ['gigantic breasts', 'large breasts'], ['busty', 'large breasts'], ['buxom', 'large breasts'],
]);
const SLIGHT_BUILD = /^(?:slim|slender|thin|skinny|petite|wiry|lean|lanky|bony|gaunt|willowy|slight|slight build|small build|frail|underweight|delicate)$/u;
const FULL_BUILD = /^(?:curvy|plump|voluptuous|chubby|heavyset|heavy-set|stout|portly|fat|full-figured|thick|wide hips|thick thighs)$/u;
const AGE_OR_BUILD = /^(?:young|old|mature|elderly|middle-aged|aged|teen|adult|child)\b|\b(?:woman|man|female|male|girl|boy)$|^(?:tall|short|very tall|muscular|athletic|toned|broad shoulders|narrow shoulders|stocky|burly|brawny|hunched)$/u;
// The backdrop is plain, so places, weather and light are not the person's tags.
const BACKGROUND_TAG = /(?:^|\s)background$|^(?:indoors|outdoors|scenery|landscape|cityscape|horizon|sky|cloudy sky|night sky|starry sky|street|alley|road|harbor|harbour|dock|docks|pier|port|tavern|inn|bar|pub|forest|woods|tree|trees|field|meadow|grass|mountain|mountains|hill|beach|shore|ocean|sea|river|lake|water|castle|fortress|town|city|village|market|room|bedroom|kitchen|library|church|temple|ruins|cave|desert|snow|rain|fog|mist|night|day|evening|dusk|dawn|sunset|sunrise|window|wall|stone wall|brick wall|door|doorway|gate|archway|stone archway|bridge|lamppost|lantern light|candlelight|sunlight|moonlight|firelight|backlighting|depth of field|bokeh)$/u;
// CLIP reads 75 tokens; the image server drops the rest.
const PROMPT_TOKEN_BUDGET = 74;
// The framing already faces the viewer.
const SCAR_TAG = /\b(?:scars?|burns?)\b/u;
const BURN_MARK = /^(?:burn scars?|burn marks?|burns?|burned skin|burnt skin)\s+(on|across|along)\s+(.+)$/u;
const FACE_PLACE = /\b(?:face|facial|cheeks?|eyes?|nose|forehead|lips?|jaw|chin|brow|eyebrows?|temple)\b/u;
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
                'Start with exactly one of 1girl, 1boy or 1other. Then describe the person, most important first:',
                'apparent age (for example young woman, mature female, old man);',
                'build in one or two tags (slim, slender, petite, athletic, muscular, stocky, plump, heavyset, tall, short);',
                'for a woman, exactly one chest tag in line with that build: flat chest or small breasts for a slight, thin, wiry or bony frame, medium breasts for an ordinary or athletic one, large breasts only when the material calls her buxom, curvy or heavy-set;',
                'hair colour, length and style; eye colour; skin tone; facial hair; and marks with where they are (scar on cheek, scar on arm, burn scar on hand, tattoo on neck, freckles, wrinkles), since a mark tagged without a place is drawn on the face;',
                'clothing as two to four tags with colour and material (for example brown leather vest, white linen shirt, rolled sleeves), worn the way the role and the setting\'s era would wear it;',
                'one or two carried or worn items; and the expression.',
                'Use only what the material states or clearly implies about this person, plus what their role and setting make likely (a fisherman wears work clothes, not armour).',
                'No background, place, weather or lighting tags: the portrait has a plain backdrop.',
                'Never tag something that is absent (no "gloves removed" or "no hat"), and nothing with writing or markings on it (no papers, books, signs, ledgers, stamps or seals).',
                'At most 18 tags. No names, no quality or style tags, no artist names, no gaze or pose tags, no sentences, no weights or brackets, nothing sexual.',
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

// Words a name may share with a description ("Old Fen", "Red Maud", "Captain Rook"): never a name to keep out of the tags.
const COMMON_NAME_WORD = /^(?:old|young|big|little|tall|short|red|black|white|grey|gray|brown|green|blue|golden|silver|dark|fair|pale|the|captain|mother|father|sister|brother|lady|lord|sir|dame|master|mistress|aunt|uncle|granny|miss|mister|doctor|warden|elder)$/u;

/** The words of the names that must not appear in tags. */
function nameWordsOf(...names) {
    return new Set(names.join(' ').toLocaleLowerCase().split(/[\s-]+/u).filter(word => word.length > 2 && !COMMON_NAME_WORD.test(word)));
}

function cleanTag(raw) {
    return String(raw || '').toLocaleLowerCase().replace(/[()[\]{}"*]/gu, '').replace(/:[\d.]+$/u, '').replace(/_/gu, ' ').replace(/\s+/gu, ' ').trim();
}

function splitTags(text) {
    return String(text || '').split(',').map(cleanTag).filter(Boolean);
}

/** The person's chest tag, after the build: present for a woman (from her build when the model left it out), absent for a man. */
export function withChestTag(tags) {
    const list = [...(tags || [])];
    const subject = list[0];
    const at = list.findIndex(tag => CHEST_TAGS.includes(tag));
    if (subject === '1boy') return at >= 0 ? list.filter(tag => !CHEST_TAGS.includes(tag)) : list;
    if (subject !== '1girl') return list;
    let chest = at >= 0 ? list.splice(at, 1)[0] : '';
    if (!chest) {
        const build = list.slice(1, 6);
        chest = build.some(tag => FULL_BUILD.test(tag)) ? 'large breasts' : build.some(tag => SLIGHT_BUILD.test(tag)) ? 'small breasts' : 'medium breasts';
    }
    // Right after the age and build tags, where the prompt window never cuts it.
    let insert = 1;
    while (insert < list.length && insert <= 4 && (AGE_OR_BUILD.test(list[insert]) || SLIGHT_BUILD.test(list[insert]) || FULL_BUILD.test(list[insert]))) insert += 1;
    list.splice(insert, 0, chest);
    return list;
}

/** The model's tag line as a clean list: subject tag first, one chest tag, no quality, backdrop, gaze, name or duplicate tags. */
export function parsePortraitTags(text, name = '') {
    const lines = String(text || '').replace(/```[a-z]*\n?|```/giu, '').split('\n')
        .map(line => line.replace(/^\s*(?:tags|prompt)\s*:\s*/iu, '').trim())
        .filter(line => line.includes(','));
    const nameWords = nameWordsOf(String(name));
    const tags = [];
    for (const raw of (lines[0] || '').split(',')) {
        let tag = cleanTag(raw);
        tag = CHEST_SYNONYMS.get(tag) || tag;
        if (!tag || tag.length > 40 || QUALITY_TAG.test(tag) || GAZE_TAG.test(tag) || FRAMING_TAGS.includes(tag) || BACKGROUND_TAG.test(tag) || tags.includes(tag)) continue;
        if (CHEST_TAGS.includes(tag) && tags.some(other => CHEST_TAGS.includes(other))) continue;
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
 * Subject and framing first, then the person's tags (most important first,
 * the chest tag among the first), then the plain backdrop and the style; the
 * person's last tags give way when it would run past what the model reads.
 */
/**
 * The image model draws "burn scar" on the face whatever follows it (it learned
 * the words from face burns), so a burn placed elsewhere is drawn as a scar
 * there: "burn scar on arm" → "scar on arm". The look keeps its own words.
 */
export function drawableMark(tag) {
    const burn = BURN_MARK.exec(tag);
    return burn && !FACE_PLACE.test(burn[2]) ? `scar ${burn[1]} ${burn[2]}` : tag;
}

export function composePortraitPrompt(tags, style = PORTRAIT_DEFAULTS.style, { background = PORTRAIT_DEFAULTS.background } = {}) {
    const [first, ...rest] = withChestTag(tags).map(drawableMark);
    const head = SUBJECT_TAGS.has(first) ? [first, ...FRAMING_TAGS] : [...FRAMING_TAGS, first].filter(Boolean);
    const backdrop = cleanString(background ?? '', 160);
    const tail = cleanString(style, 400);
    const body = [...rest];
    const build = () => [...head, ...body, backdrop, tail].filter(Boolean).join(', ');
    while (body.length && estimatedTokens(build()) > PROMPT_TOKEN_BUDGET) body.pop();
    return build();
}

/** The negative prompt for one person: the base, plus a larger chest than theirs. */
export function portraitNegativeFor(tags, base = PORTRAIT_DEFAULTS.negative) {
    const parts = splitTags(base);
    const chest = (tags || []).find(tag => CHEST_TAGS.includes(tag));
    const extra = !chest ? [] : chest === 'large breasts' ? ['huge breasts', 'gigantic breasts'] : ['large breasts', 'huge breasts', 'cleavage'];
    // A scar placed elsewhere ("burn scar on arm") still drifts onto the face unless the face is kept clear.
    const scars = (tags || []).filter(tag => SCAR_TAG.test(tag));
    if (scars.length && scars.every(tag => /\b(?:on|across|along)\b/u.test(tag) && !FACE_PLACE.test(tag))) extra.push('scar on face', 'scar on cheek', 'scar across eye');
    for (const tag of extra) if (!parts.includes(tag)) parts.push(tag);
    return parts.join(', ');
}

export function newPortraitSeed(random = Math.random) {
    return Math.floor(random() * 4_294_967_295);
}

/** The seed the image server says it used (A1111's `info`), else the one asked for. */
export function seedFromInfo(info, asked) {
    let parsed = info;
    if (typeof info === 'string') {
        try { parsed = JSON.parse(info); } catch { parsed = null; }
    }
    const seed = Number(parsed?.seed);
    return Number.isInteger(seed) && seed >= 0 ? seed : asked;
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
        seed: Number.isInteger(options.seed) && options.seed >= 0 ? options.seed : newPortraitSeed(),
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

// --- a person's look: what every picture of them shares ------------------------------

/**
 * Someone's look: the identity tags and the seed on their portrait record. A
 * record may hold a look before it has a picture (someone first drawn in a
 * photo they sent). The portrait and every picture of the person start from
 * the same tags and seed, so they stay recognisably themselves.
 */
export function findLook(records, name, aliases = []) {
    for (const candidate of [name, ...aliases]) {
        const key = canonicalNameKey(candidate);
        const record = key ? records?.[key] : null;
        if (record && Number.isInteger(record.seed) && record.seed >= 0 && lookTags(record).length) return { key, record };
    }
    return null;
}

/** A look's identity tags: the record's own, or (records from before) its prompt less the framing, backdrop and style. */
export function lookTags(record) {
    if (Array.isArray(record?.tags) && record.tags.length) return record.tags.map(cleanTag).filter(Boolean).slice(0, MAXIMUM_TAGS);
    return parsePortraitTags(String(record?.prompt || ''));
}

/**
 * Image records keep what draws the person again (the look's tags and the
 * seed) and the file, never the prompt that was sent: a portrait from before
 * looks keeps its prompt's tags as its look; a picture needs nothing of it.
 * Returns `{ portraits, pictures, changed }`.
 */
export function withoutImagePrompts({ portraits = {}, pictures = {} } = {}) {
    let changed = false;
    const strip = (records, keepLook) => Object.fromEntries(Object.entries(records && typeof records === 'object' ? records : {}).map(([key, record]) => {
        if (!record || typeof record !== 'object' || !('prompt' in record)) return [key, record];
        changed = true;
        const { prompt, ...rest } = record;
        if (keepLook && !(Array.isArray(rest.tags) && rest.tags.length)) {
            const tags = parsePortraitTags(String(prompt || ''));
            if (tags.length) rest.tags = tags;
        }
        return [key, rest];
    }));
    return { portraits: strip(portraits, true), pictures: strip(pictures, false), changed };
}

// --- pictures sent in a conversation ---------------------------------------------------

export const PICTURE_DEFAULTS = Object.freeze({
    // Pictures are clear, whatever the channel; a setting may add a mood to mind images.
    mindStyle: '',
    size: 512,
});
const PICTURE_FRAMING = /^(?:selfie|portrait|upper body|cowboy shot|full body|close-up|face|from above|from below|from side|from behind|pov|wide shot|very wide shot|dutch angle|profile)$/u;
// A shot's own expression replaces the one in the person's look.
const EXPRESSION_TAG = /\b(?:expression|smile|smiling|grin|grinning|smirk|smirking|frown|frowning|scowl|scowling|pout|pouting|laugh|laughing|blush|blushing)$|^(?:serious|stern|angry|sad|crying|tears|surprised|worried|tired|bored|calm|annoyed|open mouth|closed mouth|closed eyes|wink|tongue out)$/u;
// What a person wears and carries: it may change from picture to picture.
const CLOTHING_TAG = /\b(?:shirt|blouse|dress|gown|nightgown|coat|jacket|vest|waistcoat|apron|cloak|cape|robe|robes|uniform|armor|armour|trousers|pants|breeches|skirt|kilt|boots|shoes|sandals|gloves|hat|cap|hood|hoodie|scarf|shawl|belt|sash|collar|sleeves?|tunic|corset|bodice|leggings|stockings|socks|jeans|sweater|jumper|cardigan|overalls|smock|kimono|yukata|pajamas|pyjamas|swimsuit|bikini|nightwear|clothes|outfit|necklace|earrings?|bracelets?|bandana|veil|mask|glasses|eyewear|goggles|satchel|backpack|holster|bracers|gauntlets|tabard|surcoat|hakama|towel)\b|^(?:barefoot|bare shoulders|off shoulder|sleeveless)$/u;
// Where and when a picture is set: a place, the time of day, the weather or the light, with at most one
// plain word before it ("inn interior", "lantern light"); never a pose that names a place ("leaning on counter").
const SETTING_TAG = /^(?!(?:[a-z]+ing|on|in|at|behind|near|by|under|over|against|beside)\b)(?:[a-z]+ )?(?:indoors|outdoors|interior|room|tavern|inn|bar|pub|kitchen|bedroom|hall|street|alley|road|harbor|harbour|dock|docks|pier|port|market|forest|woods|garden|field|meadow|beach|shore|stairs|staircase|library|church|temple|castle|ruins|cave|city|town|village|night|day|evening|dusk|dawn|sunset|sunrise|rain|snow|fog|mist|light|lighting|candlelight|firelight|moonlight|sunlight|scenery|sky|background)$/u;
// A main garment: a new one in a picture is a change of clothes; an accessory alone is not.
const GARMENT_TAG = /\b(?:shirt|blouse|dress|gown|nightgown|nightdress|coat|jacket|vest|waistcoat|cloak|cape|robe|robes|uniform|armor|armour|tunic|corset|bodice|sweater|jumper|cardigan|overalls|smock|kimono|yukata|pajamas|pyjamas|swimsuit|bikini|suit|hoodie|hakama|apron|frock|chemise|doublet|jerkin|cassock)\b/u;
// Who they are: face, hair and body, held by the look and the seed in every picture.
const BODY_TAG = /\b(?:hair|hairstyle|ponytail|braid|braids|bangs|eyes?|eyebrows|breasts?|chest|skin|beard|mustache|moustache|stubble|freckles|wrinkles|scars?|tattoos?|ears|horns|fangs|lips)\b|^(?:1girl|1boy|1other|solo|male focus|female focus|mature female|mature male|old man|old woman|young woman|young man|tall|short|slim|slender|petite|muscular|athletic|stocky|plump|heavyset|wiry|lanky|curvy|thin|skinny)$/u;

/**
 * What a picture's description says the person wears ("dark green wool
 * dress", "me in my ball gown"), for when the shot's model left it out.
 * Only a garment they are in: not one they hold or someone else's.
 */
export function clothingFromDescription(text) {
    const tags = [];
    for (const part of String(text || '').toLocaleLowerCase().split(/[,;.!?]|\band\b|\bwith\b/u)) {
        if (/\b(?:your|his|their|holding|carrying|hands? you|folding|mending|selling)\b/u.test(part)) continue;
        const words = part.trim().split(/\s+/u).filter(Boolean);
        const at = words.findIndex(word => GARMENT_TAG.test(word));
        if (at < 0) continue;
        const phrase = words.slice(Math.max(0, at - 3), at + 1)
            .filter(word => !/^(?:me|my|her|in|a|an|the|wearing|wear|wears|worn|dressed|still|now|just|of|out|on)$/u.test(word))
            .join(' ');
        if (phrase && !tags.includes(phrase)) tags.push(phrase);
    }
    return tags.slice(0, 3);
}

/** A look's clothes, as words for the shot's model: what the person usually wears. */
export function outfitOf(tags) {
    return (tags || []).filter(tag => CLOTHING_TAG.test(tag) && !BODY_TAG.test(tag)).join(', ');
}

/** Picture files belong to the chat like its portraits, so they go when the chat goes. */
export function pictureFileStem(chatId, id) {
    return portraitFileStem(chatId, `picture ${id}`);
}

/**
 * The request that turns a picture's description into tags: who is in it
 * (the sender, someone the story knows, or nobody), and the shot itself:
 * framing, pose, expression, what they wear when it is not their usual, the
 * place and the light. In a quiet word in person the picture is the player's
 * own view of the person, there and then.
 */
export function buildPictureMessages({ description, channel = 'text', sender = '', viewer = '', senderLocation = '', placeSummary = '', people = [], usualOutfit = '', others = null } = {}) {
    const names = [...new Set(people.map(person => cleanString(person?.name, 120)).filter(Boolean))].slice(0, 30);
    const player = cleanString(viewer, 120) || 'the player';
    const user = [`Picture: ${cleanString(description, 600)}`];
    user.push(`${channel === 'aside' ? 'Person' : 'Sender'}: ${sender}${senderLocation ? `, at ${senderLocation}` : ''}${placeSummary ? ` (${cleanString(placeSummary, 300)})` : ''}`);
    if (cleanString(usualOutfit)) user.push(`${sender} usually wears: ${cleanString(usualOutfit, 300)}`);
    if (channel === 'aside' && Array.isArray(others)) user.push(others.length ? `Others nearby: ${others.slice(0, 8).join(', ')}` : `${sender} and ${player} are alone.`);
    if (names.length && channel !== 'aside') user.push(`PEOPLE: ${names.join(', ')}`);
    user.push('', 'SUBJECT and TAGS:');
    const what = channel === 'mind'
        ? `The picture is an image ${sender} shows someone in their mind: a memory, or what they see right now, as clear as sight.`
        : channel === 'aside'
            ? `The picture shows ${sender} as ${player} sees them right now, face to face${senderLocation ? ` at ${senderLocation}` : ''}: what they are doing, their pose and expression, and the place around them, as the conversation shows it. Draw only ${sender}: ${player} is the one looking.`
            : `The picture is a photo ${sender} took and sent from their phone.`;
    return [
        {
            role: 'system',
            content: [
                'You write the prompt for a picture drawn by an anime-style SDXL image model (Illustrious) that reads Danbooru tags.',
                what,
                'Answer with exactly two lines and nothing else.',
                channel === 'aside'
                    ? 'SUBJECT: sender.'
                    : channel === 'mind'
                        ? `SUBJECT: who is in the picture. ${sender} shows it through their own eyes, so they are not in it unless Picture says they are ("me at…", "myself"): nobody for a place, an animal or a thing, one name from the PEOPLE list if it shows that person, sender only when Picture shows ${sender}. "My" (my room, my rag) does not put them in it.`
                        : `SUBJECT: who the picture shows: sender if it shows ${sender} (a selfie, "me", "myself"), one name from the PEOPLE list if it shows that person, or nobody for a place, an animal or a thing. "My" (my room, my cat) does not put them in it.`,
                'TAGS: comma-separated lowercase Danbooru tags, most important first: the framing (selfie, upper body, cowboy shot, full body, close-up, from above, from side, pov), the pose (standing, sitting, leaning on counter, lying on bed, arms crossed, waving, walking) and what they are doing or holding, the expression, then the place and its details, the time of day, the weather and the light.',
                `Never describe the person's face, hair or body: those are added separately. Clothes: when Picture says what they wear, or the moment dresses them differently from usual (a nightgown at home, armour for a fight, finery for a ball, wet clothes in the rain), you must give two to four clothing tags for it; otherwise leave clothes out. Always give one or two tags for the place (indoors, tavern, street, bedroom, harbor) so the picture is set where they are. For nobody, start with no humans, and add scenery when it shows a place.`,
                'At most 16 tags. No names, no quality or style tags, no sentences, no weights or brackets, nothing with writing on it, nothing sexual.',
            ].join(' '),
        },
        { role: 'user', content: user.join('\n') },
    ];
}

/** The shot as `{ subject: { kind: 'sender'|'person', name } | null, tags }`; in person (`aside`), always the sender. */
export function parsePictureReply(text, { sender = '', people = [], channel = 'text' } = {}) {
    const clean = String(text || '').replace(/<think>[\s\S]*?<\/think>/giu, '').replace(/```[a-z]*\n?|```/giu, '');
    const subjectValue = cleanString(/^\s*\**subject\**\s*:\s*(.+)$/imu.exec(clean)?.[1], 160).replace(/["'*.]/gu, '').trim();
    const tagLine = /^\s*\**tags\**\s*:\s*(.+)$/imu.exec(clean)?.[1]
        || clean.split('\n').map(line => line.trim()).find(line => line.includes(',') && !/^\**subject\**\s*:/iu.test(line)) || '';
    const key = canonicalNameKey(subjectValue);
    let subject = null;
    if (channel === 'aside' || /^(?:the )?(?:sender|me|myself|self)$/iu.test(subjectValue) || (key && key === canonicalNameKey(sender))) {
        subject = { kind: 'sender', name: sender };
    } else if (key && !/^(?:nobody|no one|none|no humans|nothing|scenery|no person|no people)$/iu.test(subjectValue)) {
        const match = people.find(person => [person?.name, ...(person?.aliases || [])].some(alias => alias && canonicalNameKey(alias) === key));
        if (match) subject = { kind: canonicalNameKey(match.name) === canonicalNameKey(sender) ? 'sender' : 'person', name: match.name };
    }
    const nameWords = nameWordsOf(sender, ...people.map(person => person?.name || ''));
    const tags = [];
    for (const raw of tagLine.split(',')) {
        const tag = cleanTag(raw);
        if (!tag || tag.length > 40 || QUALITY_TAG.test(tag) || tags.includes(tag)) continue;
        if (tag.split(' ').some(word => nameWords.has(word))) continue;
        // A person's face, hair and body come from their look; what they wear in this picture is the shot's.
        if (subject ? BODY_TAG.test(tag) && !CLOTHING_TAG.test(tag) : /^(?:1girl|1boy|1other|solo|male focus|female focus)$/u.test(tag)) continue;
        tags.push(tag);
    }
    if (!subject && tags[0] !== 'no humans') {
        const at = tags.indexOf('no humans');
        if (at > 0) tags.splice(at, 1);
        tags.unshift('no humans');
    }
    return { subject, tags: tags.slice(0, 18) };
}

/**
 * A picture's prompt: for a person, their subject tag and the shot's framing,
 * then their look (face, hair and body as in their portrait, so the seed
 * draws the same person), the outfit (their usual one, or the shot's when it
 * dresses them differently: a new garment, not an accessory), then what they
 * are doing and the place; for nobody, the place and then the rest of the
 * shot. The shot's expression sits with the face. Over the prompt window the
 * finer points give way first (the shot's actions past two, the place past
 * two, the outfit past three, the look past seven), and the place and the
 * expression outlast the details of the pose.
 */
export function composePicturePrompt({ identity = [], scene = [], style = PORTRAIT_DEFAULTS.style, channel = 'text', mindStyle = PICTURE_DEFAULTS.mindStyle } = {}) {
    const shotExpression = scene.some(tag => EXPRESSION_TAG.test(tag));
    const look = identity.length ? withChestTag(identity).map(drawableMark) : [];
    const isClothing = tag => CLOTHING_TAG.test(tag) && !BODY_TAG.test(tag);
    const usual = look.filter(isClothing);
    const shotClothes = scene.filter(isClothing);
    // A new kind of garment is a change of clothes: the usual ones go. An accessory alone is worn
    // with them, and one of theirs named loosely ("white shirt" for "white linen shirt") is theirs.
    const garmentOf = tag => GARMENT_TAG.exec(tag)?.[0] || '';
    const usualGarments = new Set(usual.map(garmentOf).filter(Boolean));
    const theirs = tag => usual.includes(tag) || usualGarments.has(garmentOf(tag));
    const changed = shotClothes.some(tag => GARMENT_TAG.test(tag) && !theirs(tag));
    // Face, hair and body; the clothes are held apart, so the window never trims them first.
    const person = look
        .filter(tag => !(shotExpression && EXPRESSION_TAG.test(tag)))
        .filter(tag => !isClothing(tag));
    const framing = scene.filter(tag => PICTURE_FRAMING.test(tag));
    const outfit = !person.length ? [] : changed ? shotClothes : [...new Set([...usual, ...shotClothes.filter(tag => !theirs(tag))])];
    const others = scene.filter(tag => !PICTURE_FRAMING.test(tag) && tag !== 'no humans' && !outfit.includes(tag) && !(person.length && isClothing(tag)));
    // Where they are is kept over the finer points of what they are doing; the face's expression
    // in this shot sits with the face and outlasts both.
    const setting = others.filter(tag => SETTING_TAG.test(tag));
    const expression = others.filter(tag => !setting.includes(tag) && EXPRESSION_TAG.test(tag));
    const action = others.filter(tag => !setting.includes(tag) && !expression.includes(tag));
    const mood = channel === 'mind' ? splitTags(mindStyle) : [];
    const tail = cleanString(style, 400);
    let head;
    let looks = [];
    if (person.length && SUBJECT_TAGS.has(person[0])) {
        head = [person[0], 'solo', ...(framing.length ? framing : ['upper body'])];
        looks = person.slice(1);
    } else if (person.length) {
        head = ['solo', ...(framing.length ? framing : ['upper body'])];
        looks = person;
    } else {
        head = ['no humans', ...framing];
    }
    // With nobody in it, the place is the subject and leads; with someone, it frames what they do.
    const build = () => [...new Set((person.length
        ? [...head, ...looks, ...expression, ...outfit, ...action, ...setting, ...mood, tail]
        : [...head, ...setting, ...action, ...expression, ...mood, tail]).filter(Boolean))].join(', ');
    // Over the prompt window, the finer points give way first, the person last: the action's
    // extras, the place's, the outfit's, then the look's, and so on down to the essentials.
    const steps = [
        [action, 2], [expression, 1], [setting, 2], [outfit, 3], [looks, 7],
        [action, 1], [outfit, 2], [looks, 5], [setting, 1],
        [action, 0], [looks, 0], [expression, 0], [setting, 0], [outfit, 0],
    ];
    while (estimatedTokens(build()) > PROMPT_TOKEN_BUDGET) {
        const step = steps.find(([list, keep]) => list.length > keep);
        if (!step) break;
        step[0].pop();
    }
    return build();
}

/** A picture's negative: the person's (chest included), or for nobody, no people at all. */
export function pictureNegativeFor(identity, base = PORTRAIT_DEFAULTS.negative) {
    if (identity?.length) return portraitNegativeFor(withChestTag(identity), base);
    const parts = splitTags(base);
    for (const tag of ['1girl', '1boy', 'people']) if (!parts.includes(tag)) parts.push(tag);
    return parts.join(', ');
}
