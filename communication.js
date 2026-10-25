/**
 * How people talk at a distance in a world: messages on a device (a phone, a
 * sending stone), and mind-speech. A world turns each on or off, says what the
 * player starts with (or leaves it to the story), says how well known
 * mind-speech is, and carries rules the player can rewrite. The planner and
 * the ledger read the rules when they bring people into the story, so a
 * person's gifts are known from the start; a conversation reads them when
 * someone is reached. Pure: no DOM, no SillyTavern.
 */
import { cleanString } from './core.js?v=49';

/** The starting gift a world can give the player, as levels on the 0-100 ability scale. */
export const MIND_LEVELS = Object.freeze({ none: 0, latent: 10, novice: 30, adept: 55, expert: 80, master: 95 });
export const MIND_LEVEL_LABELS = Object.freeze({
    story: 'Decided from the card, the persona and the story',
    none: 'None',
    latent: 'Latent (felt, not yet usable)',
    novice: 'Novice',
    adept: 'Adept',
    expert: 'Expert',
    master: 'Master (cannot be shut out)',
});
export const MIND_KNOWLEDGE_LABELS = Object.freeze({
    common: 'Common knowledge: known, accepted, reached by consent',
    rare: 'Rare: known to exist, seldom met',
    secret: 'Secret: unknown to almost everyone',
});
const START_PHONE = new Set(['story', 'yes', 'no']);
const KNOWLEDGE = new Set(Object.keys(MIND_KNOWLEDGE_LABELS));

export const COMMUNICATION_DEFAULTS = Object.freeze({
    // Messages from afar on the world's device.
    text: true,
    // The player starts with one: 'story' (the card, the persona and the story decide), 'yes' or 'no'.
    startPhone: 'story',
    // What the world calls it.
    deviceName: 'phone',
    // Mind-speech.
    mind: true,
    // The player's starting gift: 'story', or a key of MIND_LEVELS.
    startMind: 'story',
    // How well known mind-speech is: 'common', 'rare' or 'secret'.
    mindKnowledge: 'rare',
    // The player's own rules; empty means the defaults for the choices above.
    rules: '',
});

/** A world's settings, checked and completed with the defaults. */
export function normalizeCommunication(value) {
    const raw = value && typeof value === 'object' ? value : {};
    return {
        text: raw.text !== false,
        startPhone: START_PHONE.has(raw.startPhone) ? raw.startPhone : COMMUNICATION_DEFAULTS.startPhone,
        deviceName: cleanString(raw.deviceName, 40).toLocaleLowerCase() || COMMUNICATION_DEFAULTS.deviceName,
        mind: raw.mind !== false,
        startMind: raw.startMind === 'story' || Object.hasOwn(MIND_LEVELS, raw.startMind) ? raw.startMind : COMMUNICATION_DEFAULTS.startMind,
        mindKnowledge: KNOWLEDGE.has(raw.mindKnowledge) ? raw.mindKnowledge : COMMUNICATION_DEFAULTS.mindKnowledge,
        rules: cleanString(raw.rules, 4_000),
    };
}

const KNOWLEDGE_RULE = Object.freeze({
    common: 'Mind-speech is common knowledge. Everyone knows what it is; people with the gift reach each other by consent, as others would call, and an unasked touch is a liberty, not a mystery.',
    rare: 'Mind-speech is known to exist but rare. Most people have never been reached; it startles them, though they understand what it is, and many distrust those who can do it.',
    secret: 'Mind-speech is a secret almost nobody knows exists. Unless a person has the gift themselves, a voice in their head is frightening and strange: they may doubt their senses, pray, panic or keep it to themselves.',
});

/**
 * The rules a world plays by, written out: the defaults for its choices, so
 * the player has something to start from when they rewrite them.
 */
export function defaultCommunicationRules(value) {
    const world = normalizeCommunication(value);
    const lines = [];
    if (world.text) {
        lines.push('MESSAGES FROM AFAR');
        lines.push(`- People reach each other by ${world.deviceName}. Messaging someone takes their number (or the world's equivalent), which the story must give.`);
        lines.push(`- A ${world.deviceName} message carries words, and pictures where the device can take them; the person answers in their own time and manner.`);
    } else {
        lines.push('MESSAGES FROM AFAR: none. No one carries a phone or anything like one.');
    }
    if (world.mind) {
        lines.push('MIND-SPEECH');
        lines.push('- Reaching a mind takes the gift. Its levels: latent (felt, but cannot reach anyone on purpose), novice, adept, expert, master.');
        lines.push(`- ${KNOWLEDGE_RULE[world.mindKnowledge]}`);
        lines.push('- With consent (the person once agreed to be reached this way), the link is open and expected, and they answer as to a welcome caller.');
        lines.push('- Without consent, how the person answers depends on how they regard the reacher, their reputation and the person\'s nature: a friend may welcome it, a stranger be wary, an enemy refuse to engage.');
        lines.push('- A person whose own gift or ward is as strong as the reacher\'s gift can shut the contact out. A weaker mind cannot block it, though it may refuse to answer.');
        lines.push('- A master\'s contact cannot be blocked or ignored: the person hears it plainly and answers in their own voice and temper, shaped by how they regard the reacher.');
        lines.push('- Most people have no gift and no ward. Mages, priests, the bonded and creatures of the mind may have either, by the world\'s lore.');
    } else {
        lines.push('MIND-SPEECH: none. No one can reach another mind.');
    }
    return lines.join('\n');
}

/** The rules in force: the player's own, else the defaults for the world's choices. */
export function communicationRules(value) {
    const world = normalizeCommunication(value);
    return world.rules || defaultCommunicationRules(world);
}

/** The game operations a new save starts with when the world fixes the player's device or gift (nothing when it leaves them to the story). */
export function startingCommunicationOps(value, { deviceKnown = false, mindKnown = false } = {}) {
    const world = normalizeCommunication(value);
    const ops = [];
    if (!deviceKnown) {
        if (!world.text) ops.push({ type: 'device.set', present: false, name: '', channel: '', note: 'the world has no messages from afar' });
        else if (world.startPhone !== 'story') ops.push({ type: 'device.set', present: world.startPhone === 'yes', name: world.deviceName, channel: 'text', note: world.startPhone === 'yes' ? 'the world gives the player one' : 'the world gives the player none' });
    }
    if (!mindKnown) {
        if (!world.mind) ops.push({ type: 'ability.set', holder: { kind: 'player' }, key: 'telepathy', name: 'mind-speech', level: 0, note: 'the world has no mind-speech' });
        else if (world.startMind !== 'story') ops.push({ type: 'ability.set', holder: { kind: 'player' }, key: 'telepathy', name: 'mind-speech', level: MIND_LEVELS[world.startMind], note: `the world starts the player ${world.startMind === 'none' ? 'without the gift' : `as a ${world.startMind}`}` });
    }
    return ops;
}

/**
 * What happens when the player reaches a mind. The person's guard is the
 * stronger of their ward and their own gift; consent is what they agreed to
 * before.
 * - consented: the link is open and expected.
 * - overwhelming: a master's reach, or one far beyond the guard (40 or
 *   more): it cannot be shut out or ignored.
 * - canBlock: no consent, and a guard as strong as the reach: they may shut
 *   it out, by how they regard the player and their nature.
 * - otherwise: they cannot block it, but may refuse to answer.
 * - expected: they know at once what this is (consented, or the world knows
 *   it as common and they have the gift).
 */
export function mindAccess({ playerLevel = 0, ward = 0, gift = 0, consent = null, knowledge = 'rare' } = {}) {
    const reach = Math.max(0, Number(playerLevel) || 0);
    const guard = Math.max(0, Number(ward) || 0, Number(gift) || 0);
    const consented = consent === 'granted';
    const overwhelming = reach >= MIND_LEVELS.master || reach - guard >= 40;
    return {
        reach,
        guard,
        consented,
        refused: consent === 'refused',
        overwhelming,
        canBlock: !consented && !overwhelming && guard >= reach,
        expected: consented || (knowledge === 'common' && (Number(gift) || 0) >= 20),
        knowledge: KNOWLEDGE.has(knowledge) ? knowledge : 'rare',
    };
}
