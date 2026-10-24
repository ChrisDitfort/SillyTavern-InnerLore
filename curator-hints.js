// Code-found hints for assisted (smaller) models running the curator and the
// progression engine: who is still tracked by a descriptor, which proper names
// in the passage match no record, and the amounts, times and commitments the
// passage states. Pure functions over the store and the passage text.
import { passageProperNames, unnamedDescriptorPeople } from './core.js?v=49';
import { amountMentions, normalizeGameState } from './game.js?v=4';

const TIME_PATTERN = /\b(?:at|by|before|after|until|till|come|around|near)\s+(?:dawn|first light|sunrise|sunup|noon|midday|dusk|sundown|sunset|nightfall|midnight|the (?:\w+ )?bell|the (?:morning|evening|afternoon|night)|the hour|\d+ o'?clock|the tide|high tide|low tide|the turn of the tide)\b|\b(?:tonight|tomorrow|at first light|by morning|next (?:morning|day|week|tide)|in (?:an|one|two|three|\d+) (?:hour|hours|day|days|week|weeks)|within the hour|in a quarter hour|a quarter hour)\b/giu;
const COMMITMENT_PATTERN = /\b(?:offer(?:s|ed)?|promis(?:e|es|ed)|swear(?:s)?|swore|vow(?:s|ed)?|owe(?:s|d)?|agree(?:s|d)? to|will (?:pay|bring|send|come|sail|meet|return|wait|find|tell|take|give|keep|hold|be)|shall (?:pay|bring|send|come|sail|meet|return)|wants? (?:you|him|her|them) to|needs? (?:you|him|her|them) to|hire(?:s|d)?|job for|errand|passage (?:north|south|east|west|to)|sails? (?:at|on|with|tomorrow|tonight)|leaves? (?:at|on|tomorrow|tonight)|due (?:at|by|on|back)|be back by|barred? (?:at|by|in)|looking for (?:a|an|someone)|a word with|meet (?:me|you|him|her) (?:at|by|in))\b/giu;

function fragmentsAround(text, pattern, radius, limit) {
    const body = String(text || '').replace(/\[message[^\]\n]*\]/gu, ' ').replace(/\s+/gu, ' ');
    // Windows around the matches, merged where they overlap, cut at word boundaries.
    const windows = [];
    for (const match of body.matchAll(pattern)) {
        const start = Math.max(0, match.index - radius);
        const end = Math.min(body.length, match.index + match[0].length + radius);
        const last = windows.at(-1);
        if (last && start <= last.end) last.end = Math.max(last.end, end);
        else windows.push({ start, end });
    }
    const out = [];
    for (const window of windows.slice(0, limit)) {
        let start = window.start;
        let end = window.end;
        if (start > 0) { const space = body.indexOf(' ', start); if (space >= 0 && space < end) start = space + 1; }
        if (end < body.length) { const space = body.lastIndexOf(' ', end); if (space > start) end = space; }
        const fragment = body.slice(start, end).trim();
        if (fragment) out.push(`${start > 0 ? '…' : ''}${fragment}${end < body.length ? '…' : ''}`);
    }
    return out;
}

// Units to recognise amounts by when the game has no currency yet.
const GENERIC_UNITS = [
    ['sovereign', 'sovereigns'], ['pound', 'pounds'], ['crown', 'crowns'], ['guinea', 'guineas'], ['mark', 'marks'],
    ['florin', 'florins'], ['shilling', 'shillings'], ['groat', 'groats'], ['penny', 'pence'], ['ducat', 'ducats'],
    ['gold', 'gold'], ['silver', 'silver'], ['copper', 'copper'], ['coin', 'coins'], ['piece', 'pieces'],
].map(([name, plural], index, list) => ({ name, plural, abbreviation: '', value: list.length - index }));

function amountsNamed(transcript, store) {
    try {
        const currency = store?.game ? normalizeGameState(store.game).currency : null;
        if (currency?.units?.length) return amountMentions(transcript, currency).map(item => `"${item.text}" = ${item.formatted}`);
        return amountMentions(transcript, { name: 'coin', units: GENERIC_UNITS }).map(item => `"${item.text}"`);
    } catch { return []; }
}

/** Times, deadlines and arrangements the passage states, as short quoted fragments. */
export function commitmentMentions(transcript) {
    return {
        times: fragmentsAround(transcript, TIME_PATTERN, 50, 6),
        commitments: fragmentsAround(transcript, COMMITMENT_PATTERN, 60, 8),
    };
}

/** Identity hints: unnamed descriptor people and unmatched proper names. */
export function identityHints(options = {}) {
    const { store, transcript, playerName } = options;
    const descriptors = unnamedDescriptorPeople(store);
    const known = Object.values(store?.entities || {})
        .flatMap(record => [record?.name, ...(record?.aliases || [])])
        .filter(Boolean);
    const names = passageProperNames(transcript, { known, player: playerName });
    if (!descriptors.length && !names.length) return '';
    const lines = ['<IDENTITY_HINTS>'];
    if (descriptors.length) {
        lines.push(`People tracked only by a descriptor, not yet named: ${descriptors.join('; ')}.`);
        lines.push('If PASSAGE reveals a proper name for one of them, patch THAT record: name = the proper name, aliases += the descriptor, promote_name = TRUE, identity_kind = public_name. Never create a second record or a second mind for the same person.');
    }
    if (names.length) {
        lines.push(`Proper names in PASSAGE that match no record: ${names.map(item => item.name).join('; ')}.`);
        lines.push('Each is one of: (a) the revealed name of a descriptor person above, (b) a new person, place, ship or item worth a record, or (c) nothing to track. Decide for each; never both (a) and (b).');
    }
    lines.push('</IDENTITY_HINTS>');
    return lines.join('\n');
}

/** Coverage checklist: amounts, times and arrangements the passage states, which some record must carry. */
export function coverageChecklist(options = {}) {
    const { store, transcript } = options;
    const amounts = amountsNamed(transcript, store);
    const { times, commitments } = commitmentMentions(transcript);
    const paragraphs = String(transcript || '').replace(/\[message[^\]\n]*\]/gu, '').split(/\n\s*\n/u).map(part => part.trim()).filter(part => part.length > 60).length;
    if (!amounts.length && !times.length && !commitments.length && paragraphs < 2) return '';
    const lines = [
        '<COVERAGE_CHECKLIST>',
        'Found by InnerLore in PASSAGE. Each item must be carried by some record (a fact, a history line, an unresolved thread, a current_state or a summary) unless it is truly not worth tracking; you may list what you leave out on one line "SKIPPED: …" before the INNERLORE header.',
        paragraphs >= 2 ? `- PASSAGE has ${paragraphs} paragraphs. Every paragraph that states something a narrator must remember later (an offer, a warning, a rumour, a rule of the place, a price, who holds what, what someone said they will do) yields at least one fact or history line on the person or place concerned; a paragraph of pure description or movement needs nothing.` : '',
        amounts.length ? `- Amounts and prices named: ${amounts.join('; ')}.` : '',
        times.length ? `- Times and deadlines: ${times.join(' | ')}` : '',
        commitments.length ? `- Offers, promises and arrangements: ${commitments.join(' | ')}` : '',
        '</COVERAGE_CHECKLIST>',
    ].filter(Boolean);
    return lines.join('\n');
}

/** Every hint block for the curator prompt, blank line separated; '' when there is nothing to say. */
export function buildCuratorHints(options = {}) {
    const blocks = [identityHints(options), coverageChecklist(options)].filter(Boolean);
    return blocks.length ? `${blocks.join('\n\n')}\n\n` : '';
}

/** The progression engine's sweep block for assisted models: commitments first, then the document. */
export function requiredSweep(transcript) {
    const { times, commitments } = commitmentMentions(transcript);
    const lines = [
        '<REQUIRED_SWEEP>',
        'Begin your answer with SWEEP: lines, plain text before the INNERLORE header (in JSON mode, put them in time.basis instead): one line per promise, offer, appointment, deadline, future arrival, hire or ongoing task that COMPLETED_PASSAGE states, each ending with "-> GOAL/PROCESS/EVENT <key>" or "-> already tracked as <key>". Every line not already tracked becomes a record in the document; a sweep line with no record behind it is an error.',
        times.length ? `Times and deadlines found by InnerLore: ${times.join(' | ')}` : '',
        commitments.length ? `Offers, promises and arrangements found by InnerLore: ${commitments.join(' | ')}` : '',
        '</REQUIRED_SWEEP>',
    ].filter(Boolean);
    return `${lines.join('\n')}\n\n`;
}
