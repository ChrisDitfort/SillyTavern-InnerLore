/**
 * Build a small, branch-local record of recently rendered story expression.
 *
 * This is deliberately derived from selected chat messages instead of being
 * persisted as NPC memory. It exists only to stop stable psychology from
 * becoming a compulsory repeated gesture, prop, phrase, or sentence pattern.
 */

import { cleanString } from './core.js';

function edgeClip(value, maximumLength) {
    const text = cleanString(value, 30_000);
    const maximum = Math.max(120, Number(maximumLength) || 120);
    if (text.length <= maximum) return text;

    const marker = '\n[…middle omitted…]\n';
    const available = Math.max(40, maximum - marker.length);
    const headLength = Math.ceil(available * 0.62);
    const tailLength = Math.max(20, available - headLength);
    let head = text.slice(0, headLength).trimEnd();
    let tail = text.slice(-tailLength).trimStart();
    const headBoundary = Math.max(head.lastIndexOf('\n'), head.lastIndexOf('. '), head.lastIndexOf(' '));
    const tailBoundary = tail.search(/[\s\n]/u);
    if (headBoundary >= Math.floor(headLength * 0.55)) head = head.slice(0, headBoundary).trimEnd();
    if (tailBoundary >= 0 && tailBoundary <= Math.floor(tailLength * 0.35)) tail = tail.slice(tailBoundary).trimStart();
    return `${head}${marker}${tail}`;
}

/**
 * Return the last few visible story replies as bounded negative surface
 * evidence. Player turns and SummarySception/system memory are excluded.
 */
export function collectRecentStoryExpressions(messages, options = {}) {
    const chat = Array.isArray(messages) ? messages : [];
    const endIndex = Number.isInteger(options.endIndex)
        ? Math.min(chat.length - 1, options.endIndex)
        : chat.length - 1;
    const maximumReplies = Math.max(1, Math.min(6, Number(options.maximumReplies) || 3));
    const maximumCharacters = Math.max(400, Math.min(4_000, Number(options.maximumCharacters) || 1_600));
    const replies = [];

    for (let index = endIndex; index >= 0 && replies.length < maximumReplies; index--) {
        const message = chat[index];
        if (!message || message.is_user || message.is_system || !cleanString(message.mes)) continue;
        replies.push({ index, name: cleanString(message.name, 120) || 'Narrator', text: cleanString(message.mes, 30_000) });
    }
    replies.reverse();
    if (!replies.length) return '';

    const separators = Math.max(0, replies.length - 1) * 2;
    const labelAllowance = replies.reduce((sum, reply) => (
        sum + `[story message ${reply.index}; ${reply.name}]\n`.length
    ), 0);
    const perReply = Math.max(120, Math.floor(
        (maximumCharacters - separators - labelAllowance) / replies.length,
    ));
    return cleanString(replies.map(reply => (
        `[story message ${reply.index}; ${reply.name}]\n${edgeClip(reply.text, perReply)}`
    )).join('\n\n'), maximumCharacters);
}
