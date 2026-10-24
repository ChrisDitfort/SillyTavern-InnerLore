/**
 * InnerLore's story context for text-completion models (NovelAI's Erato and
 * Kayra, and any model that continues plain prose): the compiled facts written
 * the way those models read a story, as short "----" lore entries (memory, at
 * the top of the prompt) and bracketed notes (the author's note, near the
 * newest text). A prose model continues text instead of following rules, so
 * this carries only what is true now and what the people present want, none
 * of the tagged sections and instructions a chat model gets.
 */
import { canonicalNameKey, cleanString, clipAtBoundary } from './core.js?v=49';

const TEXT_COMPLETION_APIS = new Set(['novel', 'textgenerationwebui', 'kobold', 'koboldhorde']);

export function isTextCompletionApi(mainApi) {
    return TEXT_COMPLETION_APIS.has(String(mainApi || ''));
}

// English prose runs about 3.6 characters a token in NovelAI's tokenizers.
const CHARACTERS_PER_TOKEN = 3.6;

/**
 * InnerLore's share of a text model's context. The story itself needs the
 * rest: SillyTavern fills it with the newest turns, which is what a
 * co-writing model continues from.
 */
export function textPacketBudget(contextTokens) {
    const tokens = Number(contextTokens) || 8_000;
    return Math.round(Math.min(24_000, Math.max(1_600, tokens * 0.3 * CHARACTERS_PER_TOKEN)));
}

const clip = (value, length) => clipAtBoundary(cleanString(value, 4_000).replace(/\s+/gu, ' '), length);
const sentence = value => {
    const text = cleanString(value, 4_000).replace(/\s+/gu, ' ').replace(/[\s.;,]+$/u, '');
    return text ? `${text}.` : '';
};

function personEntry(name, entity, brain, playerName) {
    const mind = brain?.currentMind || {};
    const feelings = (mind.emotions || []).slice(0, 3)
        .map(emotion => cleanString(emotion?.name, 40) + (emotion?.intensity ? ` (${cleanString(emotion.intensity, 20)})` : ''))
        .filter(Boolean);
    const nature = Object.values(brain?.persistentSelf?.facets || {})
        .sort((a, b) => (Number(b?.confidence) || 0) - (Number(a?.confidence) || 0))
        .slice(0, 2)
        .map(facet => clip(facet?.statement, 140))
        .filter(Boolean);
    const thought = (mind.innerThoughts || []).map(item => clip(item, 160)).find(Boolean);
    // A summary often opens with the name ("Tobbe Rusk, a lean young sailor").
    const summary = cleanString(entity?.summary, 4_000)
        .replace(new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}(?:,\\s*|\\s+is\\s+)`, 'iu'), '');
    const parts = [
        sentence(clip(summary.charAt(0).toLocaleUpperCase() + summary.slice(1), 240)),
        // The description only when there is no summary: they mostly repeat each other.
        !summary && entity?.description ? sentence(clip(entity.description, 220)) : '',
        entity?.currentState ? `Now: ${sentence(clip(entity.currentState, 220))}` : '',
        nature.length ? `Nature: ${nature.map(sentence).join(' ')}` : '',
        mind.perception ? `Notices: ${sentence(clip(mind.perception, 160))}` : '',
        feelings.length ? `Feels: ${feelings.join(', ')}.` : '',
        mind.immediateGoal || mind.intention ? `Wants: ${sentence(clip(mind.immediateGoal || mind.intention, 160))}` : '',
        mind.conflict ? `Torn: ${sentence(clip(mind.conflict, 140))}` : '',
        mind.attention ? `Watching: ${sentence(clip(mind.attention, 140))}` : '',
        thought ? `Thinks: "${thought.replace(/^["*]+|["*]+$/gu, '')}"` : '',
    ].filter(Boolean);
    if (!parts.length) return '';
    return `----\n${name}: ${parts.join(' ')}`.replaceAll('{{user}}', playerName);
}

function placeEntry(entity) {
    if (!entity) return '';
    const layout = Object.values(entity.spatial?.invariants || {})
        .map(item => sentence(clip(item?.statement, 160))).filter(Boolean).slice(0, 3);
    const parts = [sentence(clip(entity.summary, 260)), entity.currentState ? sentence(clip(entity.currentState, 180)) : '', ...layout].filter(Boolean);
    return parts.length ? `----\n${entity.name}: ${parts.join(' ')}` : '';
}

function loreEntry(entity) {
    const summary = sentence(clip(entity?.summary || entity?.description, 220));
    return summary ? `----\n${entity.name}: ${summary}` : '';
}

/**
 * The game lines (purse, what the player carries, what is here and for sale,
 * how people regard the player, recent changes, prepared material) without
 * the ledger's instructions, each as its own bracketed note.
 */
function gameNotes(gameText) {
    const body = String(gameText || '')
        .replace(/<\/?inner_lore_game_state[^>]*>/gu, '')
        .split('\n')
        .map(line => line.trim())
        .filter(Boolean);
    // The first paragraph tells a chat model how to use the ledger.
    return body
        .filter(line => !line.startsWith('This is the game ledger'))
        .map(line => line.replace(/^Prepared for (.+?) \(narrator-only[^)]*\):\s*/u, 'Ready to bring in at $1: '))
        .filter(line => /^[A-Z][^:]{1,80}:\s/u.test(line))
        .map(line => `[ ${line.replace(/\s+/gu, ' ').replace(/\.\.+/gu, '.')} ]`);
}

/**
 * Render the compiled context for a text-completion story model.
 * Returns the memory (lore entries for the top of the prompt) and the note
 * (bracketed lines for the author's note position), each within its share of
 * `budgetCharacters`.
 */
export function renderTextPacket({ compilation, store, playerName = 'the player', gameText = '', budgetCharacters = 8_000 } = {}) {
    const player = cleanString(playerName, 120) || 'the player';
    const playerKey = canonicalNameKey(player);
    const entities = store?.entities || {};
    const brains = store?.brains || {};
    const camera = compilation?.camera || {};
    const byName = name => Object.values(entities).find(entity => entity?.type === 'character'
        && (canonicalNameKey(entity.name) === canonicalNameKey(name)
            || (entity.aliases || []).some(alias => canonicalNameKey(alias) === canonicalNameKey(name)))) || null;

    // Memory: the people present (those with a selected mind first), the
    // place, then the rest of the selected lore.
    const people = [];
    const seen = new Set([playerKey]);
    const addPerson = name => {
        const key = canonicalNameKey(name);
        if (!name || seen.has(key)) return;
        seen.add(key);
        const entity = byName(name);
        const brain = brains[key] || (entity ? brains[canonicalNameKey(entity.name)] : null);
        const entry = personEntry(entity?.name || name, entity, brain, player);
        if (entry) people.push(entry);
    };
    for (const item of camera.withYou || []) addPerson(item?.name);
    for (const item of compilation?.selectedBrains || []) addPerson(item?.name);
    const here = Object.values(entities).find(entity => entity?.type === 'location'
        && canonicalNameKey(entity.name) === canonicalNameKey(camera.where)) || null;
    const lore = (compilation?.selectedEntities || [])
        .map(item => entities[item?.id])
        .filter(entity => entity && entity.id !== here?.id && entity.type !== 'character')
        .map(loreEntry)
        .filter(Boolean);
    for (const item of compilation?.selectedEntities || []) {
        const entity = entities[item?.id];
        if (entity?.type === 'character') addPerson(entity.name);
    }

    // Note: where and when, who is here, the game, and the turn.
    const withYou = (camera.withYou || []).map(item => item?.name).filter(Boolean);
    const scene = [
        camera.time ? sentence(clip(camera.time, 100)) : '',
        camera.where ? `${player} is at ${camera.where}${camera.part ? ` (${clip(camera.part, 60)})` : ''}${camera.within ? `, in ${camera.within}` : ''}.` : '',
        withYou.length ? `With ${player}: ${withYou.join(', ')}.` : '',
        (camera.waysOn || []).length ? `Ways on: ${camera.waysOn.slice(0, 4).map(way => cleanString(way.name || way.relation, 200).replace(/[.;\s]+$/u, '')).filter(Boolean).join('; ')}.` : '',
    ].filter(Boolean).join(' ');
    const notes = [
        scene ? `[ ${scene} ]` : '',
        ...gameNotes(gameText),
        `[ Write what the world does next in answer to ${player}. ${player}'s own words, thoughts and choices belong to the player. ]`,
    ].filter(Boolean);

    const budget = Math.max(800, Number(budgetCharacters) || 8_000);
    const fit = (lines, room, { keepLast = false } = {}) => {
        const kept = [];
        let used = 0;
        const last = keepLast ? lines.at(-1) : null;
        const pool = keepLast ? lines.slice(0, -1) : lines;
        const reserve = last ? last.length + 1 : 0;
        for (const line of pool) {
            if (used + line.length + 1 + reserve > room) continue;
            kept.push(line);
            used += line.length + 1;
        }
        if (last) kept.push(last);
        return kept.join('\n');
    };
    const note = fit(notes, Math.round(budget * 0.35), { keepLast: true });
    const memory = fit([...people, placeEntry(here), ...lore].filter(Boolean), budget - note.length);
    return { memory, note };
}
