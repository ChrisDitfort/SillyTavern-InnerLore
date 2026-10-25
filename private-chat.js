/**
 * Private conversations with one person, apart from the story's narration: a
 * quiet word in person, a text on the world's message device, or mind to
 * mind. Pure helpers: the threads kept in chat metadata, which channels can
 * reach a person right now, the prompts for the person's replies, the parsing
 * of those replies, and the transcript the story receives when a conversation
 * closes. Nothing here touches the DOM or SillyTavern.
 */
import { canonicalNameKey, cleanString, clipAtBoundary, curatedLocationOf, escapeHtml, normalizeEntityType, renderCompactEntity } from './core.js?v=49';
import {
    ABILITY_KEYS,
    USABLE_ABILITY_LEVEL,
    abilitiesKnown,
    abilityLevel,
    abilityList,
    abilityTier,
    canRejectMind,
    contactOf,
    deviceOf,
    linkOf,
    standingTier,
} from './game.js?v=6';
import { mindAccess, normalizeCommunication } from './communication.js?v=1';

export const THREADS_METADATA_KEY = 'innerlore_threads';
/** On a story message: the private conversation it carries. */
export const PRIVATE_EXTRA_KEY = 'inner_lore_private';
export const MAX_BUBBLES_PER_REPLY = 4;
export const MAX_BUBBLE_CHARS = 600;
const MAX_THREAD_BUBBLES = 400;

export const CHANNELS = Object.freeze({
    aside: Object.freeze({ key: 'aside', label: 'Private chat', short: 'In person', noun: 'quiet word', composer: 'Say quietly', verb: 'says' }),
    text: Object.freeze({ key: 'text', label: 'Text', short: 'Text', noun: 'text conversation', composer: 'Text', verb: 'texts' }),
    mind: Object.freeze({ key: 'mind', label: 'Mind', short: 'Mind', noun: 'mind-speech', composer: 'Think', verb: 'thinks' }),
});
export const CHANNEL_KEYS = Object.freeze(Object.keys(CHANNELS));

export function isChannel(value) {
    return Object.hasOwn(CHANNELS, String(value || ''));
}

export function threadKey(name, channel) {
    return `${canonicalNameKey(name)}:${channel}`;
}

// --- threads -------------------------------------------------------------------

function validBubble(bubble) {
    return bubble && typeof bubble === 'object'
        && (bubble.from === 'player' || bubble.from === 'person')
        && typeof bubble.text === 'string' && bubble.text.trim();
}

/** The threads saved in chat metadata, checked and in a shape the rest can trust. */
export function normalizeThreads(value) {
    const threads = {};
    if (!value || typeof value !== 'object') return threads;
    for (const [key, raw] of Object.entries(value)) {
        if (!raw || typeof raw !== 'object' || !isChannel(raw.channel) || !cleanString(raw.person)) continue;
        const person = cleanString(raw.person, 160);
        const channel = raw.channel;
        const expectedKey = threadKey(person, channel);
        if (key !== expectedKey) continue;
        threads[key] = {
            key,
            person,
            personKey: canonicalNameKey(person),
            channel,
            bubbles: (Array.isArray(raw.bubbles) ? raw.bubbles : []).filter(validBubble).slice(-MAX_THREAD_BUBBLES).map(bubble => ({
                from: bubble.from,
                text: cleanString(bubble.text, MAX_BUBBLE_CHARS),
                at: Number.isFinite(bubble.at) ? bubble.at : 0,
                flushed: bubble.flushed === true,
                ...(isPictureId(bubble.picture?.id) ? { picture: pictureOf(bubble.picture) } : {}),
            })),
            status: ['open', 'rejected', 'ended'].includes(raw.status) ? raw.status : 'open',
            // An outcome the story has not been told yet (a shut link, a closed talk).
            outcome: ['rejected', 'ended'].includes(raw.outcome) ? raw.outcome : null,
            opened: Number.isFinite(raw.opened) ? raw.opened : 0,
            updated: Number.isFinite(raw.updated) ? raw.updated : 0,
            // The chat length when the person shut the link: the story must move on before another try.
            closedAtLength: Number.isInteger(raw.closedAtLength) ? raw.closedAtLength : -1,
        };
    }
    return threads;
}

export function createThread(name, channel) {
    const person = cleanString(name, 160);
    const now = Date.now();
    return {
        key: threadKey(person, channel),
        person,
        personKey: canonicalNameKey(person),
        channel,
        bubbles: [],
        status: 'open',
        outcome: null,
        opened: now,
        updated: now,
        closedAtLength: -1,
    };
}

/** A picture's id: lower-case letters, digits and dashes (it names a file and a store record). */
export function isPictureId(value) {
    return typeof value === 'string' && /^[a-z0-9][a-z0-9-]{3,79}$/u.test(value);
}

export function newPictureId(now = Date.now(), random = Math.random) {
    return `pic-${now.toString(36)}-${Math.floor(random() * 36 ** 6).toString(36).padStart(6, '0')}`;
}

/**
 * A bubble's picture: its id, and for a picture of the moment (the player's
 * own view of the person in a quiet word, not something they sent) the
 * scene it was drawn from.
 */
function pictureOf(value) {
    return {
        id: value.id,
        ...(value.moment === true ? { moment: true, about: cleanString(value.about, 900) } : {}),
    };
}

/** A line, or with `picture: { id }` a picture whose text is what it shows. */
export function appendBubble(thread, from, text, { picture = null } = {}) {
    const clean = cleanString(text, MAX_BUBBLE_CHARS);
    if (!clean) return null;
    const bubble = { from: from === 'player' ? 'player' : 'person', text: clean, at: Date.now(), flushed: false };
    if (isPictureId(picture?.id)) bubble.picture = pictureOf(picture);
    thread.bubbles.push(bubble);
    if (thread.bubbles.length > MAX_THREAD_BUBBLES) thread.bubbles.splice(0, thread.bubbles.length - MAX_THREAD_BUBBLES);
    thread.updated = bubble.at;
    return bubble;
}

/** What the story has not been told yet: never a picture of the moment, which is only the player's view. */
export function pendingBubbles(thread) {
    return (thread?.bubbles || []).filter(bubble => !bubble.flushed && !bubble.picture?.moment);
}

export function hasPendingStory(thread) {
    return pendingBubbles(thread).length > 0 || Boolean(thread?.outcome);
}

export function markFlushed(thread) {
    for (const bubble of thread.bubbles) bubble.flushed = true;
    thread.outcome = null;
}

/** A closed thread opens again when the player writes; a shut mind only once the story has moved on. */
export function canWriteTo(thread, chatLength) {
    if (!thread) return { ok: true };
    if (thread.status === 'rejected' && thread.closedAtLength >= 0 && chatLength <= thread.closedAtLength) {
        return { ok: false, reason: `${thread.person} has shut you out; let the story move on before reaching again` };
    }
    return { ok: true };
}

export function threadPreview(thread) {
    const last = thread?.bubbles?.at(-1) || null;
    return {
        key: thread.key,
        person: thread.person,
        channel: thread.channel,
        status: thread.status,
        updated: thread.updated,
        lastText: last ? (last.picture ? `${thread.channel === 'mind' ? 'Image' : 'Picture'}: ${last.text}` : last.text) : '',
        lastFrom: last ? last.from : '',
        count: thread.bubbles?.length || 0,
    };
}

export function sortedThreads(threads) {
    return Object.values(threads || {}).sort((a, b) => (b.updated || 0) - (a.updated || 0));
}

// --- who can be reached, and how ---------------------------------------------------

function deviceWord(device) {
    return device?.name || 'phone';
}

function contactWord(device) {
    return /phone|mobile|cell/iu.test(device?.name || '') ? 'number' : 'contact';
}

/**
 * Which channels can reach a person right now. `present` says whether they
 * are with the player; the game state says whether the player has a device,
 * their contact, and the gift of mind-speech. `judge: true` means the world
 * has not settled the question yet and the ability judge must be asked first.
 */
export function channelAvailability(state, person, { present = false, personKnown = true, world = null } = {}) {
    const name = cleanString(person, 160) || 'them';
    const device = deviceOf(state);
    const comm = normalizeCommunication(world);
    const result = {
        aside: present
            ? { ok: true }
            : { ok: false, reason: `${name} is not here with you` },
    };
    // A world without the system has no such channel at all.
    if (!comm.text) {
        result.text = { ok: false, off: true, reason: 'There are no messages from afar in this world' };
    } else if (!device.known) {
        result.text = { ok: false, judge: true, reason: 'Whether you have any way to send messages from afar is not settled yet' };
    } else if (!device.present) {
        result.text = { ok: false, reason: `You have no ${deviceWord(device)} or other way to message anyone from afar` };
    } else if (!contactOf(state, name)) {
        result.text = { ok: false, reason: `You don't have ${name}'s ${contactWord(device)}` };
    } else {
        result.text = { ok: true, device, contact: contactOf(state, name) };
    }
    if (!comm.mind) {
        result.mind = { ok: false, off: true, reason: 'There is no mind-speech in this world' };
    } else if (!abilitiesKnown(state, 'player') || (personKnown && !abilitiesKnown(state, { name }))) {
        result.mind = { ok: false, judge: true, reason: 'Whether you have the gift to reach a mind is not settled yet' };
    } else {
        const level = abilityLevel(state, 'player', ABILITY_KEYS.telepathy);
        if (level <= 0) result.mind = { ok: false, reason: 'You have no gift of mind-speech' };
        else if (level < USABLE_ABILITY_LEVEL) result.mind = { ok: false, reason: 'Your gift is latent: too faint to reach anyone on purpose' };
        else {
            // The contest: the player's reach against the person's guard, unless they agreed before.
            const access = mindAccess({
                playerLevel: level,
                ward: abilityLevel(state, { name }, ABILITY_KEYS.mindWard),
                gift: abilityLevel(state, { name }, ABILITY_KEYS.telepathy),
                consent: linkOf(state, name)?.consent || null,
                knowledge: comm.mindKnowledge,
            });
            result.mind = { ok: true, level, tier: abilityTier(level), access, canReject: access.canBlock };
        }
    }
    return result;
}

// --- what the person knows -------------------------------------------------------------

/** The person's mind in a few lines: what they feel, want and think now, and who they are underneath. */
export function mindSummary(brain, { playerName = '', maximumCharacters = 900 } = {}) {
    if (!brain) return '';
    const lines = [];
    const mind = brain.currentMind;
    if (mind) {
        const emotions = (mind.emotions || []).map(emotion => `${emotion.name}${emotion.intensity ? ` (${emotion.intensity})` : ''}`);
        if (emotions.length) lines.push(`Feels: ${emotions.join(', ')}.`);
        if (mind.perception) lines.push(`Notices: ${mind.perception}`);
        if (mind.interpretation) lines.push(`Reads it as: ${mind.interpretation}`);
        if (mind.immediateGoal) lines.push(`Wants now: ${mind.immediateGoal}`);
        if (mind.intention) lines.push(`Means to: ${mind.intention}`);
        if (mind.internalConflict) lines.push(`Torn: ${mind.internalConflict}`);
        for (const thought of (mind.innerThoughts || []).slice(0, 3)) lines.push(`Thinks: "${thought}"`);
    }
    const facets = Object.values(brain.persistentSelf?.facets || {}).slice(0, 6);
    if (facets.length) lines.push(`Underneath: ${facets.map(facet => facet.statement).join(' ')}`);
    const voice = Object.values(brain.persistentSelf?.voice || {}).slice(0, 3);
    if (voice.length) lines.push(`Voice: ${voice.map(anchor => anchor.statement).join(' ')}`);
    const playerKey = canonicalNameKey(playerName);
    const relationship = playerKey ? Object.values(brain.persistentSelf?.relationships || {}).find(record => record?.id === playerKey) : null;
    const aspects = Object.values(relationship?.aspects || {}).slice(0, 4);
    if (aspects.length) lines.push(`About ${playerName}: ${aspects.map(aspect => aspect.statement).join(' ')}`);
    return cleanString(lines.join('\n'), maximumCharacters);
}

/** The person's record, mind and standing as a brief for their reply, plus where they are. */
export function personBrief(store, name, state, { playerName = 'the player', maximumCharacters = 1_800 } = {}) {
    const entities = store?.entities || {};
    const key = canonicalNameKey(name);
    const entity = Object.values(entities).find(record => ['character', 'creature'].includes(normalizeEntityType(record?.type)) && canonicalNameKey(record.name) === key) || null;
    const brain = store?.brains?.[key] || null;
    const location = entity ? curatedLocationOf(entities, entity)?.name || cleanString(entity.currentLocationName, 160) : '';
    const standing = state?.standings?.[key] || null;
    const parts = [];
    if (entity) parts.push(renderCompactEntity(entity, Math.max(400, Math.round(maximumCharacters * 0.55)), { layoutLimit: 0 }));
    else parts.push(`${name}: nothing is recorded about them yet beyond the story itself.`);
    const mind = mindSummary(brain, { playerName, maximumCharacters: Math.max(300, Math.round(maximumCharacters * 0.45)) });
    if (mind) parts.push(`${name}'s mind:\n${mind}`);
    if (standing) {
        const reason = standing.notes?.at(-1)?.reason;
        parts.push(`${name} regards ${playerName}: ${standingTier(standing.score)} (${standing.score > 0 ? '+' : ''}${standing.score})${reason ? ` - ${clipAtBoundary(reason, 120)}` : ''}.`);
    }
    const gifts = abilityList(state, { name });
    if (gifts.length) parts.push(`${name}'s gifts: ${gifts.map(gift => `${gift.name} (${gift.tier})`).join(', ')}.`);
    return { entity, brain, location, standing, text: cleanString(parts.filter(Boolean).join('\n'), maximumCharacters) };
}

// --- the prompts for the person's replies ----------------------------------------------

function channelRules(channel, { person, player, device, location, place, canReject, pictures = false, access = null }) {
    const where = location ? `, at ${location}` : '';
    if (channel === 'text') {
        const name = deviceWord(device);
        const rules = [
            `CHANNEL: a ${name} message. ${person} is on their own ${name}, wherever they are${where}, and ${player} is elsewhere. ${person} can only know what the messages say; they cannot see or hear ${player}.`,
            `Write as ${person} would actually type: short messages, a few words to two sentences each, in their own register. No narration, no actions, no stage directions, no asterisks, no emoji unless ${person} is the kind to use them.`,
        ];
        if (pictures) rules.push(`${person} can send a photo from the ${name} when ${player} asks for one or when a picture says it better: put it on its own line as [picture: what it shows, in a few plain words], for example [picture: me behind the bar, ledger in hand] or [picture: the harbour from the pier at dusk]. At most one picture in a reply; most replies have none, and ${person} may refuse to send one.`);
        return rules;
    }
    if (channel === 'mind') {
        const rules = [
            `CHANNEL: mind to mind. ${player} has reached into ${person}'s mind with a gift of mind-speech; ${person} is wherever they are${where}, and hears ${player}'s thoughts as thoughts. ${person} cannot see ${player} unless they are together.`,
            `Answer in ${person}'s thoughts: terse, immediate, coloured by what they feel. No narration, no spoken dialogue, no asterisks.`,
        ];
        if (access) {
            rules.push(...mindContactRules({ person, player, access }));
            if (pictures) rules.push(mindPictureRule(person, player));
            return rules;
        }
        if (pictures) rules.push(mindPictureRule(person, player));
        rules.push(canReject
            ? `${person} has a gift of their own: they feel this touch and can shut it out. Decide as ${person} would, from their nature and how they regard ${player}. If they refuse the contact, now or later in the conversation, reply with the single line [rejects] and nothing else; otherwise answer.`
            : `${person} has no way to shut the link: the thoughts arrive whether welcome or not. They may be startled, frightened, suspicious or angry, and may refuse to engage, but whatever they think in answer travels back along the link.`);
        return rules;
    }
    return [
        `CHANNEL: a quiet word in person. ${person} and ${player} are talking privately, apart from anyone else${place ? ` at ${place}` : ''}. ${player}'s lines are what ${player} says, in ${player}'s own voice.`,
        `Write ${person}'s spoken lines as plain dialogue without quotation marks. A brief beat of gesture or expression may go in *asterisks*, a few words at most: this is talk, not narration.`,
    ];
}

function mindPictureRule(person, player) {
    return `${person} can also show ${player} an image in the mind: a memory, what they see right now, or a face. When it fits, put it on its own line as [image: what it shows, in a few plain words], for example [image: the docks at night, a lantern swinging] or [image: me as I am now, tired at the window]. At most one in a reply; most replies have none.`;
}

/**
 * How a reached mind answers, from the contest (consent, the reach against
 * the person's guard) and how well the world knows mind-speech. How the
 * person regards the player is in their brief; these lines say what it
 * decides.
 */
export function mindContactRules({ person, player, access }) {
    const lines = [];
    if (access.knowledge === 'common') lines.push(`Mind-speech is common knowledge here: ${person} knows at once what this is.`);
    else if (access.knowledge === 'secret') lines.push(access.expected || access.consented
        ? `Mind-speech is a secret almost nobody knows of; ${person} knows it, and knows this touch.`
        : `Mind-speech is a secret almost nobody knows of. Unless ${person} has the gift themselves, a voice in their head is frightening and strange: they may doubt their senses, pray, panic or keep very still.`);
    else lines.push(access.expected || access.consented
        ? `Mind-speech is rare, but ${person} knows it when it comes.`
        : `Mind-speech is known to exist but rare: unless ${person} has the gift, being reached startles them, though they understand what it is.`);
    if (access.consented) {
        lines.push(`${person} agreed before to be reached this way: the link is open and welcome. They answer as to a caller they let in, in their own manner and present mood.`);
    } else if (access.overwhelming) {
        lines.push(`${player}'s gift is far beyond anything ${person} could resist: the contact is clear and cannot be shut out or ignored. ${person} answers in their own voice and temper, shaped by how they regard ${player}.`);
    } else if (access.canBlock) {
        lines.push(`${person} did not invite this, and their mind is guarded as strongly as ${player}'s reach: they can shut the contact out. Whether they do follows from how they regard ${player}, their nature and what is said: a friend may let it pass, a stranger hesitate, someone hostile or proud shut it at once. If they shut it out, now or later in the conversation, reply with the single line [rejects] and nothing else.`);
    } else {
        lines.push(`${person} did not invite this and cannot shut it out: the thoughts arrive whether welcome or not. How they answer follows from how they regard ${player} and their nature: they may welcome it, be wary, refuse to engage or rage, but whatever they think in answer travels back along the link.`);
    }
    if (access.refused && !access.consented) lines.push(`${person} refused this kind of contact before.`);
    if (!access.consented) lines.push(`If ${person} agrees to be reached this way again from now on, add a final line that says exactly: [consents]`);
    return lines;
}

/** A bubble as the reply model reads it: a picture is written the way the person sent it. */
function bubbleText(bubble, channel) {
    const text = cleanString(bubble?.text, MAX_BUBBLE_CHARS);
    if (!text || !bubble?.picture) return text;
    return channel === 'mind' ? `[image: ${text}]` : `[picture: ${text}]`;
}

/**
 * Chat-completion messages for the person's next reply: the rules and
 * briefing as the system message, then the conversation so far as alternating
 * turns, the player's bubbles as the user and the person's as the assistant.
 */
export function buildPrivateReplyMessages(options = {}) {
    const thread = options.thread;
    const channel = CHANNELS[thread?.channel] || CHANNELS.aside;
    const player = cleanString(options.playerName, 160) || 'the player';
    const person = cleanString(thread?.person, 160) || 'the other person';
    const pictures = options.pictures === true && channel.key !== 'aside';
    const rules = channelRules(channel.key, {
        person, player, device: options.device, location: options.personLocation, place: options.placeName, canReject: options.canReject === true, pictures, access: options.access || null,
    });
    const lines = [
        `You write ${person}'s side of a private ${channel.noun} with ${player} inside an interactive story. Reply only as ${person}: in character, in ${person}'s own voice, grounded in who they are, what they know, want and feel right now, and how they regard ${player}. Never write ${player}'s next line, never narrate the wider scene, never add headings, labels, names before lines, or commentary.`,
        '',
        ...rules,
        '',
        'FORMAT',
        `- One to three messages from ${person}, each on its own line, nothing else.`,
        `- If ${person} ends the conversation after these messages (${channel.key === 'text' ? 'puts the device away' : channel.key === 'mind' ? 'withdraws from the link' : 'turns back to the others'}), add a final line that says exactly: [ends]`,
        '- Keep every message short. This is a conversation, not a story passage.',
        ...(pictures ? [`- A ${channel.key === 'mind' ? '[image: ...]' : '[picture: ...]'} line counts as one of the messages.`] : []),
    ];
    const blocks = [];
    if (cleanString(options.worldCard)) blocks.push(`<WORLD>\n${clipAtBoundary(cleanString(options.worldCard, 6_000), 1_800)}\n</WORLD>`);
    blocks.push(`<PERSON>\n${cleanString(options.personBrief, 4_000) || `${person}: no record yet.`}\n</PERSON>`);
    if (cleanString(options.persona)) blocks.push(`<${player.toUpperCase().replace(/[^A-Z0-9]+/gu, '_') || 'PLAYER'}>\n${clipAtBoundary(cleanString(options.persona, 3_000), 700)}\n</${player.toUpperCase().replace(/[^A-Z0-9]+/gu, '_') || 'PLAYER'}>`);
    const recent = (Array.isArray(options.recentStory) ? options.recentStory : [])
        .filter(entry => cleanString(entry?.text))
        .map(entry => `${cleanString(entry.name, 80) || 'Story'}: ${clipAtBoundary(cleanString(entry.text, 4_000), 900)}`);
    if (recent.length) blocks.push(`<RECENT_STORY>\n${recent.join('\n\n')}\n</RECENT_STORY>`);
    const now = [
        options.personLocation ? `${person} is at ${options.personLocation}.` : '',
        options.placeName ? `${player} is at ${options.placeName}.` : '',
        options.clockLabel ? `Story time: ${options.clockLabel}.` : '',
    ].filter(Boolean).join(' ');
    if (now) blocks.push(`<NOW>\n${now}\n</NOW>`);
    const worldRules = channel.key === 'aside' ? '' : cleanString(options.worldRules, 4_000);
    if (worldRules) blocks.push(`<WORLD_RULES>\n${worldRules}\n</WORLD_RULES>`);
    const custom = cleanString(options.customInstructions, 2_000);
    if (custom) blocks.push(`<ADDITIONAL_INSTRUCTIONS>\n${custom}\n</ADDITIONAL_INSTRUCTIONS>`);
    const system = `${lines.join('\n')}\n\n${blocks.join('\n\n')}`;

    const turns = [];
    for (const bubble of thread?.bubbles || []) {
        if (bubble.picture?.moment) continue;
        const role = bubble.from === 'player' ? 'user' : 'assistant';
        const text = bubbleText(bubble, channel.key);
        if (!text) continue;
        const last = turns.at(-1);
        if (last && last.role === role) last.content += `\n${text}`;
        else turns.push({ role, content: text });
    }
    if (!turns.length || turns[0].role !== 'user') turns.unshift({ role: 'user', content: channel.key === 'mind' ? '(reaches out)' : '(waits)' });
    if (turns.at(-1).role !== 'user') turns.push({ role: 'user', content: '(waits for more)' });
    return [{ role: 'system', content: system }, ...turns];
}

/**
 * The same conversation for a text-completion story model (NovelAI's Erato
 * and Kayra): bracketed instructions in the style the model knows, then the
 * transcript, ending on the person's name so the model writes their line.
 */
export function buildPrivateReplyTextPrompt(options = {}) {
    const thread = options.thread;
    const channel = CHANNELS[thread?.channel] || CHANNELS.aside;
    const player = cleanString(options.playerName, 160) || 'the player';
    const person = cleanString(thread?.person, 160) || 'the other person';
    const rules = channelRules(channel.key, {
        person, player, device: options.device, location: options.personLocation, place: options.placeName, canReject: options.canReject === true,
        pictures: options.pictures === true && channel.key !== 'aside', access: options.access || null,
    }).join(' ');
    const ending = `If ${person} ends the conversation, their last line is followed by a line reading [ends].`;
    const header = `[ A private ${channel.noun} between ${player} and ${person}, apart from the story's narration. ${rules} Only ${person}'s lines follow, each beginning "${person}:", one to three short lines, no narration. ${ending} ]`;
    const brief = `[ ${person}: ${clipAtBoundary(cleanString(options.personBrief, 4_000).replaceAll('\n', ' '), 900)} ]`;
    const recent = (Array.isArray(options.recentStory) ? options.recentStory : [])
        .filter(entry => cleanString(entry?.text))
        .map(entry => `${cleanString(entry.name, 80) || 'Story'}: ${clipAtBoundary(cleanString(entry.text, 4_000), 500)}`);
    const story = recent.length ? `[ Recent story: ${recent.join(' | ').replaceAll('\n', ' ')} ]` : '';
    const transcript = (thread?.bubbles || [])
        .filter(bubble => !bubble.picture?.moment)
        .map(bubble => `${bubble.from === 'player' ? player : person}: ${bubbleText(bubble, channel.key).replaceAll('\n', ' ')}`)
        .join('\n');
    const custom = cleanString(options.customInstructions, 2_000);
    const prompt = [header, brief, story, custom ? `[ ${custom.replaceAll('\n', ' ')} ]` : '', transcript].filter(Boolean).join('\n');
    return { prompt, prefill: `${person}:`, stop: [`\n${player}:`] };
}

// --- reading the reply ----------------------------------------------------------------

const REJECT_MARK = /^\W*\[?\(?\*?(?:rejects?|refuses?|shuts? (?:you |them |it )?out|blocks? (?:you|the link))\*?\)?\]?\W*$/iu;
const END_MARK = /^\W*\[?\(?\*?(?:ends?|end of (?:conversation|messages)|leaves|conversation ends)\*?\)?\]?\W*$/iu;
const INLINE_REJECT = /\[(?:rejects?|refuses?)\]/iu;
const INLINE_END = /\[(?:ends?)\]/iu;
// "[consents]": the person agrees to be reached mind to mind from now on.
const CONSENT_MARK = /\[(?:consents?|allows?|agrees?|welcomes?)(?: (?:it|you|this|contact|the link))?\]/iu;

function escapeRegExp(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

function speakerPattern(name) {
    const full = cleanString(name, 160);
    const first = full.split(/\s+/u)[0] || full;
    const names = [...new Set([full, first].filter(Boolean))].map(escapeRegExp);
    // "Name: ", "**Name:** ", "**Name**: " and "Name - " all label a line.
    return new RegExp(`^\\s*(?:\\*\\*|__)?\\s*(?:${names.join('|')})\\s*(?:[:\\-–—]\\s*(?:\\*\\*|__)?|(?:\\*\\*|__)\\s*[:\\-–—])\\s*`, 'iu');
}

// "[picture: me at the bar]", "[photo - the harbour]", "[sends a selfie: ...]", "[image: ...]".
const PICTURE_MARK = /\[\s*(?:(?:sends?|shows?|shares?|attaches?)\s+(?:you\s+)?(?:a\s+|an\s+)?)?(picture|photo|photograph|pic|selfie|snapshot|image|mental image|vision)(?:\s+(?:of|in (?:the|my) mind))?\s*(?:[:\-–—]\s*([^\]]{0,300}))?\]/iu;
// "*sends a photo of the bar*": the action some models write for a text.
const PICTURE_ACTION = /\*\s*(?:sends?|snaps?|takes?|attaches?|shares?|shows?)\s+(?:you\s+)?(?:a\s+|an\s+)?(?:quick\s+)?(picture|photo|photograph|pic|selfie|snapshot|image)\s*(?:of\s+)?([^*]{0,200})\*/iu;

/** A picture mark's description; a bare selfie is a picture of the sender. */
function pictureDescription(kind, text) {
    const description = cleanString(String(text || '').replace(/^["“”']|["“”']$/gu, ''), 300);
    if (description) return description;
    return /selfie/iu.test(kind || '') ? 'a selfie of me' : '';
}

/**
 * The person's reply as bubbles. Name labels are stripped, anything the model
 * wrote for the player is dropped, code fences and reasoning are ignored,
 * the [rejects] / [ends] marks become outcomes, and with `pictures` one
 * [picture: ...] (or [image: ...] in the mind) becomes a picture item.
 * `items` keeps the order ({ kind: 'text'|'picture', text }); `bubbles` is
 * the text lines alone.
 */
export function parsePersonReply(raw, { personName = '', playerName = '', channel = 'aside', pictures = false } = {}) {
    let text = String(raw ?? '');
    text = text.replace(/<think>[\s\S]*?<\/think>/giu, '').replace(/```[a-z]*\n?/giu, '').trim();
    const personLabel = personName ? speakerPattern(personName) : null;
    const playerLabel = playerName ? speakerPattern(playerName) : null;
    const allowPictures = pictures === true && channel !== 'aside';
    const items = [];
    let rejected = false;
    let ended = false;
    let consented = false;
    let pictured = false;
    const addPicture = description => {
        if (!allowPictures || pictured || !description) return;
        pictured = true;
        items.push({ kind: 'picture', text: description });
    };
    for (const rawLine of text.split(/\r?\n/u)) {
        let line = rawLine.trim();
        if (!line) continue;
        if (CONSENT_MARK.test(line)) {
            consented = true;
            line = line.replace(CONSENT_MARK, '').trim();
            if (!line) continue;
        }
        if (REJECT_MARK.test(line)) { rejected = true; continue; }
        if (END_MARK.test(line)) { ended = true; break; }
        if (playerLabel && playerLabel.test(line)) break;
        if (personLabel) line = line.replace(personLabel, '');
        if (INLINE_REJECT.test(line)) { rejected = true; line = line.replace(INLINE_REJECT, '').trim(); }
        if (INLINE_END.test(line)) { ended = true; line = line.replace(INLINE_END, '').trim(); }
        // A picture: its own item, before or after what the line says around it.
        let picture = '';
        let pictureFirst = false;
        const action = PICTURE_ACTION.exec(line);
        if (action) {
            picture = pictureDescription(action[1], action[2]);
            pictureFirst = action.index === 0;
            line = `${line.slice(0, action.index)} ${line.slice(action.index + action[0].length)}`.trim();
        }
        const mark = PICTURE_MARK.exec(line);
        if (mark) {
            picture ||= pictureDescription(mark[1], mark[2]);
            pictureFirst = pictureFirst || mark.index === 0;
            line = `${line.slice(0, mark.index)} ${line.slice(mark.index + mark[0].length)}`.trim();
        }
        // Texts and thoughts carry no stage directions; a quiet word may keep a short beat.
        if (channel !== 'aside') line = line.replace(/\*[^*\n]{1,120}\*/gu, '').replace(/^\([^)\n]{1,120}\)\s*/u, '').trim();
        if (/^[-*•]\s+/u.test(line)) line = line.replace(/^[-*•]\s+/u, '');
        if (/^["“”«»]/u.test(line) && /["“”«»][.!?…]?$/u.test(line) && !/["“”«»].+["“”«»].+["“”«»]/u.test(line)) {
            line = line.replace(/^["“”«»]/u, '').replace(/["“”«»]([.!?…]?)$/u, '$1');
        }
        line = line.trim();
        if (picture && pictureFirst) addPicture(picture);
        if (line) items.push({ kind: 'text', text: clipAtBoundary(line, MAX_BUBBLE_CHARS) });
        if (picture && !pictureFirst) addPicture(picture);
        if (items.length >= MAX_BUBBLES_PER_REPLY) break;
    }
    const kept = items.slice(0, MAX_BUBBLES_PER_REPLY);
    return {
        items: kept,
        bubbles: kept.filter(item => item.kind === 'text').map(item => item.text),
        pictures: kept.filter(item => item.kind === 'picture').map(item => item.text),
        rejected,
        ended,
        consented: consented && !rejected,
    };
}

/** A phone-style number the person shared ("0771 442 118", "+44 7700 900123"); null when none. */
export function sharedNumber(text) {
    const match = /(?<!\w)(\+?\d[\d\s().-]{4,}\d)(?!\w)/u.exec(String(text || ''));
    if (!match) return null;
    const digits = match[1].replace(/\D/gu, '');
    if (digits.length < 5 || digits.length > 15) return null;
    return match[1].replace(/\s+/gu, ' ').trim();
}

// --- the story's copy ---------------------------------------------------------------

function headerLine(channel, player, person) {
    if (channel === 'text') return `[Text messages between ${player} and ${person}]`;
    if (channel === 'mind') return `[Mind-speech between ${player} and ${person}: thoughts passed in silence]`;
    return `[${player} and ${person} talk privately, aside from anyone else]`;
}

function outcomeLine(channel, outcome, player, person) {
    if (outcome === 'rejected') {
        return channel === 'mind'
            ? `[${person} shuts ${player} out of their mind.]`
            : `[${person} will not continue.]`;
    }
    if (outcome === 'ended') {
        if (channel === 'text') return `[${person} stops answering.]`;
        if (channel === 'mind') return `[${person} withdraws from the link.]`;
        return `[${person} ends the talk.]`;
    }
    return '';
}

/**
 * What the story is told when a conversation closes: a bracketed header, the
 * exchanged lines as "Name: text", and the outcome. Plain lines, so every
 * model and every pass reads it the same way.
 */
export function renderTranscript(thread, { playerName = 'Player', bubbles = null, outcome = null } = {}) {
    const player = cleanString(playerName, 160) || 'Player';
    const person = cleanString(thread?.person, 160) || 'someone';
    const lines = [headerLine(thread?.channel, player, person)];
    for (const bubble of bubbles || thread?.bubbles || []) {
        if (bubble.picture?.moment) continue;
        const text = cleanString(bubble.text, MAX_BUBBLE_CHARS).replaceAll('\n', ' ');
        if (!text) continue;
        const said = bubble.picture ? `[${thread?.channel === 'mind' ? 'shows an image in the mind' : 'sends a picture'}: ${text}]` : text;
        lines.push(`${bubble.from === 'player' ? player : person}: ${said}`);
    }
    const closing = outcomeLine(thread?.channel, outcome, player, person);
    if (closing) lines.push(closing);
    return lines.join('\n');
}

/** A story message's transcript read back into header, lines and notes. */
export function parseTranscript(text) {
    const result = { header: '', lines: [], notes: [] };
    for (const raw of String(text || '').split(/\r?\n/u)) {
        const line = raw.trim();
        if (!line) continue;
        if (/^\[.*\]$/u.test(line)) {
            if (!result.header && !result.lines.length) result.header = line.slice(1, -1);
            else result.notes.push(line.slice(1, -1));
            continue;
        }
        const match = /^([^:]{1,80}):\s*(.*)$/u.exec(line);
        if (match) result.lines.push({ name: match[1].trim(), text: match[2].trim() });
        else if (result.lines.length) result.lines.at(-1).text += ` ${line}`;
    }
    return result;
}

const TRANSCRIPT_PICTURE = /^\[(?:sends a picture|shows an image in the mind):\s*(.+)\]$/u;

/**
 * The transcript as a message card in the story log: bubbles, the player's on
 * the right. Pictures become slots carrying their ids (`pictures`, in the
 * order they were sent), which the page fills with the drawn image.
 */
export function renderPrivateCard(text, { playerName = '', channel = 'text', pictures = [] } = {}) {
    const parsed = parseTranscript(text);
    const playerKey = canonicalNameKey(playerName);
    const kind = isChannel(channel) ? channel : 'text';
    const ids = (Array.isArray(pictures) ? pictures : []).map(picture => picture?.id).filter(isPictureId);
    let next = 0;
    const bubbles = parsed.lines.map(line => {
        const mine = playerKey && canonicalNameKey(line.name) === playerKey;
        const picture = TRANSCRIPT_PICTURE.exec(line.text);
        if (picture) {
            const id = ids[next++] || '';
            return `<div class="il-sms-bubble ${mine ? 'is-player' : 'is-person'} is-picture">${renderPictureSlot(id, picture[1], kind)}</div>`;
        }
        return `<div class="il-sms-bubble ${mine ? 'is-player' : 'is-person'}"${mine ? '' : ` data-name="${escapeHtml(line.name)}"`}>${escapeHtml(line.text)}</div>`;
    }).join('');
    const notes = parsed.notes.map(note => `<div class="il-sms-bubble is-note">${escapeHtml(note)}</div>`).join('');
    return `<div class="il-private-card is-${kind}"><div class="il-private-head">${escapeHtml(parsed.header || CHANNELS[kind].label)}</div><div class="il-sms-log">${bubbles}${notes}</div></div>`;
}

/** A picture's place in a bubble: the page fills `[data-picture]` with the image, or says it is on its way. */
export function renderPictureSlot(id, description, channel = 'text') {
    const caption = escapeHtml(cleanString(description, 300));
    return `<figure class="il-sms-picture${channel === 'mind' ? ' is-mind' : ''}"${isPictureId(id) ? ` data-picture="${escapeHtml(id)}"` : ''}><div class="il-sms-picture-frame"><span class="il-sms-picture-wait">${isPictureId(id) ? 'Picture on its way…' : 'A picture'}</span></div><figcaption>${caption}</figcaption></figure>`;
}
