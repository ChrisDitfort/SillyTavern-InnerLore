/**
 * Player choices: the short next moves the narrator offers at the end of a
 * reply. They arrive in a fenced block, are kept out of the story text, and
 * are shown to the player as buttons that fill the message box.
 */

import { cleanString } from './core.js?v=49';

export const CHOICE_KINDS = Object.freeze(['go', 'talk', 'do', 'look']);
export const CHOICES_EXTRA_KEY = 'inner_lore_choices';
const MAXIMUM_CHOICES = 5;

// A ```choices block (closed, or cut off at the end of the reply), or the
// same list wrapped in <choices> tags.
const CHOICE_BLOCKS = [
    /\n*[ \t]*(?:```|~~~)[ \t]*choices[ \t]*\n([\s\S]*?)(?:\n[ \t]*(?:```|~~~)[ \t]*(?=\n|$)|$)/iu,
    /\n*[ \t]*<choices>([\s\S]*?)(?:<\/choices>|$)/iu,
];
const CHOICE_LINE = /^\s*(?:[-*•]\s*)?(go|talk|do|look)\s*[:–-]\s*(.+?)\s*$/iu;

/**
 * Split a reply into its story text and its choices. Text without a choices
 * block comes back unchanged with no choices.
 */
export function extractReplyChoices(text) {
    const source = String(text ?? '');
    for (const pattern of CHOICE_BLOCKS) {
        const match = pattern.exec(source);
        if (!match) continue;
        const choices = [];
        for (const line of match[1].split('\n')) {
            const parsed = CHOICE_LINE.exec(line);
            const label = parsed ? cleanString(parsed[2], 120).replace(/[.;]+$/u, '') : '';
            if (label) choices.push({ kind: parsed[1].toLowerCase(), text: label });
            if (choices.length >= MAXIMUM_CHOICES) break;
        }
        const story = `${source.slice(0, match.index)}${source.slice(match.index + match[0].length)}`.trimEnd();
        return { text: story, choices };
    }
    return { text: source, choices: [] };
}

/**
 * Moves offered when the narrator gave none (a greeting, or an older reply):
 * the ways on, the people present and the objects in play from the camera.
 */
export function fallbackChoices(camera) {
    if (!camera) return [];
    const go = (camera.waysOn || []).filter(way => way.name).slice(0, 2)
        .map(way => ({ kind: 'go', text: `Go to ${way.name}` }));
    const talk = (camera.withYou || []).slice(0, 2)
        .map(person => ({ kind: 'talk', text: `Talk to ${person.name}` }));
    const look = (camera.objects || []).slice(0, 1)
        .map(object => ({ kind: 'look', text: `Look at ${object}` }));
    return [...go, ...talk, ...look].slice(0, MAXIMUM_CHOICES);
}

/** Stored choices from a message's extra data, validated. */
export function storedChoices(message) {
    const value = message?.extra?.[CHOICES_EXTRA_KEY];
    if (!Array.isArray(value)) return [];
    return value
        .filter(choice => CHOICE_KINDS.includes(choice?.kind) && cleanString(choice.text, 120))
        .slice(0, MAXIMUM_CHOICES)
        .map(choice => ({ kind: choice.kind, text: cleanString(choice.text, 120) }));
}
