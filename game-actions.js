/**
 * InnerLore game actions: the player's purchases, sales, gifts, pickups,
 * payments and uses, applied by the game system itself. The story model asks
 * for them through tools (or writes the call as text when its provider has no
 * tool parser), the trade screen asks for them directly, and in every case
 * the game checks purse, stock and price, applies the result, and hands the
 * narrator a plain statement of what happened to tell.
 *
 * Pure module: no SillyTavern or DOM dependencies.
 */

import { cleanString, normalizeName } from './core.js?v=49';
import {
    activeItems,
    applyGameOperations,
    bodyHolding,
    carriedItems,
    contentWords,
    findPerson,
    formatMoney,
    gameKey,
    holderKey,
    isCarried,
    itemsAtPlace,
    nameKey,
    normalizeGameState,
    parseMoney,
    placeWithStage,
    pricesAtPlace,
    purseText,
    resolveHolder,
    rootHolder,
    standingTier,
    wordsContained,
} from './game.js?v=6';

export const ACTION_SOURCE = 'action';
const MAX_ACTIONS_PER_TURN = 8;
/** An offer this far under the listed price is still accepted from someone the seller likes. */
const HAGGLE_FLOOR = 0.7;
const WARM_TIERS = new Set(['warm', 'friendly', 'close']);

const ACTION_BY_TOOL = Object.freeze({
    game_trade: { actions: ['buy', 'sell'] },
    game_transfer: { actions: ['give', 'receive', 'take', 'drop'] },
    game_coin: { actions: ['pay', 'collect'] },
    game_consume: { actions: ['consume'] },
});

// --- the player's own exchanges ---------------------------------------------------

const MONEY_WORDS = ['coin', 'coins', 'copper', 'coppers', 'silver', 'silvers', 'gold', 'golds', 'crown', 'crowns', 'shilling', 'shillings',
    'penny', 'pennies', 'pence', 'money', 'payment', 'fee', 'fare', 'toll', 'cash', 'credit', 'credits', 'dollar', 'dollars', 'bucks',
    'mark', 'marks', 'sovereign', 'sovereigns', 'ducat', 'ducats', 'florin', 'florins', 'denarius', 'denarii', 'bit', 'bits'];
const NUMBER_WORDS = ['a', 'an', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve',
    'twenty', 'thirty', 'forty', 'fifty', 'hundred', 'few', 'several', 'some', 'half'];
const OBJECT = '(?:her|him|them|it|this|that|these|those|the|a|an|my|our|his|their|one|two|three|some|\\d+)';
const NEGATED = /\b(?:don'?t|do not|doesn'?t|didn'?t|won'?t|will not|wouldn'?t|can'?t|cannot|couldn'?t|unable to|refuse[sd]? to|refusing to|decline[sd]? to|declining to|instead of|rather than|without|no longer|not|never|no)\s+(?:\w+\s+){0,2}$/u;
const ASKED_OF_OTHERS = /\b(?:do|does|did|can|could|will|would|are|is)\s+(?:you|he|she|they|it|someone|anyone)\s+(?:\w+\s+){0,1}$/u;
// Someone is asked, told or expected to do it ("she asks me to pay", "I ask
// her to sell"), or it is demanded of the player ("the guard demands I pay").
const DIRECTED = /\b(?:ask|asks|asked|asking|tell|tells|told|telling|want|wants|wanted|wanting|expect|expects|expected|expecting|order|orders|ordered|ordering|urge|urges|urged|urging|beg|begs|begged|begging|remind|reminds|reminded|reminding|invite|invites|invited|inviting|need|needs|needed|needing|wait for|waits for|waited for|waiting for)\s+(?:\w+\s+){1,3}to\s+$|\b(?:demand|demands|demanded|demanding|insist|insists|insisted|insisting|suggest|suggests|suggested|suggesting|require|requires|required|requiring)\s+(?:that\s+)?(?:i|we|you|he|she|they)\s+$/u;
// Weighing, wondering or supposing is not doing ("should I buy it?", "I could
// pay her", "I think about selling it"); "I'd like to buy" is a decision.
const TENTATIVE = /\b(?:should|shall|can|could|would|might|may)\s+(?:i|we)\s+(?:\w+\s+){0,1}$|\b(?:i|we)(?:'d|\s+(?:could|would|might|may|should))\s+(?:\w+\s+){0,1}$|\b(?:think|thinks|thinking|thought|consider|considers|considering|considered|wonder|wonders|wondering|wondered|debate|debates|debating|debated|weigh|weighs|weighing|weighed)\s+(?:(?:about|of|over|whether|if)\s+)?(?:(?:i|we)\s+(?:should\s+|could\s+|might\s+)?|to\s+)?(?:\w+\s+){0,1}$|\b(?:if|whether)\s+(?:to\s+|(?:i|we)\s+(?:should\s+|could\s+)?)?(?:\w+\s+){0,1}$/u;
// Someone else is the one doing it: the subject right before the verb.
const THIRD_PERSON = /\b(?:she|he|they|it|someone|somebody|everyone|nobody|the\s+(?!and\b|then\b|or\b)\w+|a\s+(?!and\b|then\b|or\b)\w+)\s+(?:\w+ly\s+)?$/u;
const TAKE_IDIOMS = /^\s+(?:a\s+|an\s+|the\s+|my\s+|it\s+|some\s+|her\s+|his\s+|their\s+|your\s+)?(?:look|looks|seat|breath|step|steps|moment|minute|second|glance|peek|chance|walk|stroll|turn|nap|rest|break|bite|aim|cover|care|heart|notice|note|place|part|offen[cs]e|time|easy|leave|stairs|road|lead|hint|bait|while|deep|closer|stock|stand|sides|side|charge|pity|pride|comfort|advantage|interest|hand|hands|arm|word|advice|point)\b/u;
// "give her a nod", "give up", "hand over the reins of the talk": no thing changes hands.
const GIVE_IDIOMS = /^\s*(?:(?:her|him|them|it|you|me)\s+)?(?:a\s+|an\s+|the\s+|my\s+|his\s+|her\s+|their\s+|some\s+)?(?:nod|nods|shrug|shrugs|look|looks|smile|smiles|glance|wave|sigh|laugh|grin|wink|bow|salute|hug|kiss|push|shove|chance|try|shot|thought|break|moment|second|minute|warning|answer|reply|name|word|piece|ear|hand|thanks|way|chase|up|in|look-over|once-over|lift|ride|hint|clue|signal|sign|shoulder)\b/u;
// "accept her apology", "accept the challenge": nothing is handed over.
const RECEIVE_IDIOMS = /^\s+(?:her|his|their|the|my|your|an?)?\s*(?:apology|apologies|invitation|challenge|fate|thanks|compliment|help|advice|explanation|answer|excuse|terms of|point|truth|situation|fact)\b/u;
const MONEY_ALTERNATION = MONEY_WORDS.join('|');

/**
 * Each pattern's verb occurrences that are the player's own act: not negated
 * or refused, not asked of someone else, not someone else's request, not a
 * question or a second thought, and not done by someone else. Patterns
 * marked `asked` are requests by the player ("can you sell me a candle?") and
 * keep only the negation check.
 */
function verbHits(text, pattern, { asked = false } = {}) {
    const hits = [];
    const global = new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`);
    for (const match of text.matchAll(global)) {
        const before = text.slice(Math.max(0, match.index - 60), match.index);
        if (NEGATED.test(before)) continue;
        if (!asked && (ASKED_OF_OTHERS.test(before) || DIRECTED.test(before) || TENTATIVE.test(before) || THIRD_PERSON.test(before))) continue;
        hits.push(match);
    }
    return hits;
}

const INTENT_PATTERNS = Object.freeze([
    ['buy', /\b(?:buy|buys|buying|bought|purchase[sd]?|purchasing|rent(?:s|ed|ing)?|hire[sd]?|hiring)\b/u],
    ['buy', new RegExp(`\\b(?:i'?ll|i will|let me|i'?d like to|i want to)\\s+(?:take|have|get)\\s+(?:it|that|this|them|those|these|one|two|three|a room|the room|a bed|the bed)\\b`, 'u')],
    ['buy', /\b(?:i'?d like|i would like|i want|i'?ll have|give me|get me|i'?ll take)\s+(?:a|an|one|two|three|some|the|another)\s+(?:room|bed|drink|meal|bowl|cup|pint|mug|plate|loaf|ale|beer|wine|stew|bread|round|bath|night)\b/u, { asked: true }],
    // Asking to be sold something is buying: "can you sell me a candle?", "could I get a room?"
    ['buy', /\b(?:sell|sells)\s+me\b/u, { asked: true }],
    ['buy', /\b(?:can|could|may)\s+i\s+(?:get|have|buy|take|rent)\s+(?:a|an|one|two|three|the|some|another)\b/u, { asked: true }],
    ['pay', /\b(?:pay|pays|paying|paid|tip(?:s|ped|ping)?|bribe[sd]?|bribing|settle[sd]?\s+(?:up|the|my|our)|settling\s+(?:up|the|my|our)|cover(?:s|ed)?\s+(?:the|my|our)\s+(?:bill|tab|cost|fee|fare|meal|room|drinks?))\b/u],
    ['sell', /\b(?:sell|sells|selling|sold|pawn(?:s|ed|ing)?|barter(?:s|ed|ing)?)\b/u],
    ['trade', /\b(?:trade|trades|traded|trading|swap|swaps|swapped|swapping|exchange[sd]?|exchanging)\b/u],
    ['give', new RegExp(`\\b(?:give|gives|giving|gave|offer(?:s|ed|ing)?|lend(?:s|ing)?|lent|hand|hands|handed|handing)\\s+(?:over\\s+)?(?:\\w+\\s+)?${OBJECT}\\b`, 'u')],
    // Softer verbs count only with coin in hand, or a recipient and a thing:
    // "slide two coppers across", "toss him a coin", not "pass the guard",
    // "push him away" or "put the coins in my pocket".
    ['give', new RegExp(`\\b(?:pass|passes|passed|passing|slide|slides|slid|sliding|toss|tosses|tossed|tossing|flip|flips|flipped|flipping)\\s+(?:over\\s+)?(?:her|him|them)\\s+(?:${OBJECT}|${MONEY_ALTERNATION})\\b`, 'u')],
    ['give', new RegExp(`\\b(?:pass|passes|passed|passing|slide|slides|slid|sliding|toss|tosses|tossed|tossing|flip|flips|flipped|flipping|press|presses|pressed|pressing|push|pushes|pushed|pushing|count(?:s|ed|ing)?\\s+out)\\s+(?:over\\s+)?(?:\\w+\\s+){0,3}(?:${MONEY_ALTERNATION})\\b`, 'u')],
    ['receive', /\b(?:accept(?:s|ed|ing)?|receive[sd]?|receiving)\b/u],
    ['take', /\b(?:take|takes|taking|took|grab|grabs|grabbed|grabbing|pocket(?:s|ed|ing)?|loot(?:s|ed|ing)?|steal|steals|stealing|stole|snatch(?:es|ed|ing)?|pilfer(?:s|ed|ing)?)\b/u],
    ['take', /\b(?:pick|picks|picked|picking)\s+(?:\w+\s+){0,3}up\b/u],
    ['drop', /\b(?:drop|drops|dropped|dropping|discard(?:s|ed|ing)?|abandon(?:s|ed|ing)?)\b/u],
    ['drop', /\b(?:set|sets|setting|put|puts|putting)\s+(?:\w+\s+){0,3}down\b/u],
    ['drop', /\b(?:throw|throws|threw|throwing|toss|tosses|tossed)\s+(?:\w+\s+){0,3}away\b/u],
    ['drop', /\b(?:leave|leaves|leaving|left)\s+(?:it|them|the|my|this|that)\s+(?:\w+\s+){0,3}(?:behind|here|there|on|in)\b/u],
    ['consume', /\b(?:eat|eats|eating|ate|drink|drinks|drinking|drank|sip|sips|sipped|sipping|gulp(?:s|ed|ing)?|quaff(?:s|ed|ing)?|swallow(?:s|ed|ing)?|devour(?:s|ed|ing)?|chew(?:s|ed|ing)?)\b/u],
    ['consume', /\b(?:light|lights|lighting|lit|burn|burns|burned|burning|use|uses|used|using)\s+(?:up\s+)?(?:the|a|an|my|one|some)\s+\w+/u],
    // "I charge him two coppers", "charge her for the stew"; not "charge at the guard".
    ['collect', new RegExp(`\\b(?:charge[sd]?|charging)\\s+(?:her|him|them|you|the\\s+\\w+|\\w+)\\s+(?:\\d+|${NUMBER_WORDS.join('|')}|for)\\b`, 'u')],
    ['collect', /\b(?:collect(?:s|ed|ing)?|demand(?:s|ed|ing)?|ask(?:s|ed|ing)?\s+for)\s+(?:my|the|our|his|her|their)?\s*(?:payment|pay|wages|coin|coins|money|debt|bounty|reward|share|cut|fee)\b/u],
]);

/** Whether a text names a sum of money (a number or number word before a money word, or a bare money word). */
export function mentionsMoney(text, extraWords = []) {
    const words = [...MONEY_WORDS, ...extraWords.map(word => String(word || '').toLocaleLowerCase()).filter(Boolean)];
    const alternation = [...new Set(words)].map(word => word.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')).join('|');
    const value = String(text || '').toLocaleLowerCase();
    return new RegExp(`\\b(?:\\d+|${NUMBER_WORDS.join('|')})\\s+(?:\\w+\\s+)?(?:${alternation})\\b`, 'u').test(value)
        || /\b(?:coin|coins|money|payment|cash)\b/u.test(value);
}

/**
 * What exchanges the player's own message makes: buy, pay, sell, trade,
 * give, receive, take, drop, consume, collect, and accept (a short "deal",
 * "yes", "here you go" when the narration before it named a price). Only
 * the player's words count: a verb that is negated ("I don't pay") or asked
 * of someone else ("do you sell...?") is not the player doing it, and a
 * price asked ("how much for a bed?") is not an exchange.
 */
export function playerExchangeIntent(text, { previousText = '', currencyWords = [] } = {}) {
    const value = ` ${String(text || '').toLocaleLowerCase().replace(/[‘’]/gu, "'").replace(/[“”]/gu, '"')} `;
    const kinds = new Set();
    for (const [kind, pattern, options] of INTENT_PATTERNS) {
        for (const match of verbHits(value, pattern, options)) {
            if (kind === 'take' && /^tak|^took/u.test(match[0]) && TAKE_IDIOMS.test(value.slice(match.index + match[0].length))) continue;
            // Idioms are read from just after the verb: "give her a nod", "accept her apology".
            const afterVerb = value.slice(match.index + (match[0].match(/^\S+/u)?.[0].length || 0));
            if (kind === 'give' && /^(?:giv|gave|hand|offer|lend|lent)/u.test(match[0]) && GIVE_IDIOMS.test(afterVerb)) continue;
            if (kind === 'receive' && RECEIVE_IDIOMS.test(afterVerb)) continue;
            kinds.add(kind);
            break;
        }
    }
    const money = mentionsMoney(value, currencyWords);
    // Coin handed, slid or tossed over is a payment.
    if (kinds.has('give') && money) kinds.add('pay');
    if (kinds.has('trade')) {
        kinds.add('buy');
        kinds.add('sell');
    }
    const words = value.trim().split(/\s+/u).filter(Boolean);
    const offerBefore = mentionsMoney(previousText, currencyWords) || /\b(?:price|costs?|for sale|sells?|buy|pay|charge)\b/u.test(String(previousText || '').toLocaleLowerCase());
    const shortAgreement = words.length <= 6 && /^\s*["']?\s*(?:yes|yeah|yep|sure|ok(?:ay)?|alright|all right|fine|deal|agreed|done|very well|here(?:'s| is| you go| you are)?)\b/u.test(value);
    const explicitAgreement = /\b(?:deal|agreed|i accept|you have a deal|it'?s a deal|here you go|here you are|keep the change|i'?ll take it|i'?ll pay)\b/u.test(value);
    if (offerBefore && (shortAgreement || explicitAgreement)) kinds.add('accept');
    return { kinds, any: kinds.size > 0, money };
}

/** Which of the player's exchange kinds allow a game action of this kind. */
const CONSENTED_BY = Object.freeze({
    buy: ['buy', 'pay', 'accept', 'trade'],
    sell: ['sell', 'accept', 'trade'],
    pay: ['pay', 'buy', 'accept'],
    collect: ['collect', 'sell', 'accept'],
    give: ['give', 'sell', 'trade', 'pay'],
    receive: ['receive', 'accept', 'buy', 'take', 'collect', 'trade'],
    take: ['take', 'receive'],
    drop: ['drop', 'give'],
    consume: ['consume'],
});

/** Whether the player's own message consents to an action of this kind. */
export function actionConsented(kind, intent) {
    const allowed = CONSENTED_BY[kind] || [];
    return Boolean(intent?.kinds) && allowed.some(item => intent.kinds.has(item));
}

/** A short description of an action for a refusal. */
export function describeAction(action) {
    const a = action || {};
    const what = a.item || (a.amount !== null && a.amount !== undefined ? String(a.amount) : '') || '';
    return `${a.kind || 'action'}${what ? ` ${what}` : ''}${a.person ? ` (${a.person})` : ''}`.trim();
}

/** The tools offered to the story model, in SillyTavern's function-tool shape. */
export const GAME_TOOLS = Object.freeze([
    {
        name: 'game_trade',
        displayName: 'Game: buy or sell',
        description: 'The player buys one thing or service from a person here, or sells one thing they carry to a person here, for coin, because the player\'s newest message says so. The game system checks the purse, the stock and the price, moves the coin and the item, and reports the result. Call it before narrating the purchase or sale, then narrate exactly what it reports; never invent a different price or outcome. Never call it for a price someone only names or asks, and never to report that nothing changed hands.',
        parameters: {
            type: 'object',
            properties: {
                action: { type: 'string', enum: ['buy', 'sell'], description: 'buy: the player pays the person. sell: the person pays the player.' },
                item: { type: 'string', description: 'What changes hands, as the game state names it (a listed ware, a carried thing, or a priced service such as a night\'s bed).' },
                person: { type: 'string', description: 'The seller when buying, the buyer when selling.' },
                price: { type: 'string', description: 'The agreed price with its unit, for example "3 shillings". Leave out to use the listed price.' },
                quantity: { type: 'integer', description: 'How many, when more than one.' },
            },
            required: ['action', 'item', 'person'],
        },
    },
    {
        name: 'game_transfer',
        displayName: 'Game: hand over or pick up',
        description: 'A tracked thing changes hands without payment because the player\'s newest message says so: the player gives something they carry to a person (give), accepts something a person hands them (receive), picks something up from the place, a container or a body (take), or sets something down here (drop). The game system moves it and reports the result. Call it before narrating the handover, then narrate what it reports. Never call it to report that nothing changed hands.',
        parameters: {
            type: 'object',
            properties: {
                action: { type: 'string', enum: ['give', 'receive', 'take', 'drop'] },
                item: { type: 'string', description: 'The thing, as the game state names it.' },
                person: { type: 'string', description: 'Who receives it (give), who hands it over (receive), or whose body or which container it is taken from (take). Leave out for the ground or the place.' },
                quantity: { type: 'integer' },
            },
            required: ['action', 'item'],
        },
    },
    {
        name: 'game_coin',
        displayName: 'Game: pay or be paid',
        description: 'Coin alone changes hands because the player\'s newest message says so: the player pays a person (pay) for a fee, a tip, a bribe, a wager, a debt, or anything that is not a listed item or service; or the player collects coin a person owes them (collect). The game system checks the purse and reports the result. Call it before narrating the payment. Never call it with a zero amount, for a price someone only demands, or to report that no coin moved.',
        parameters: {
            type: 'object',
            properties: {
                action: { type: 'string', enum: ['pay', 'collect'] },
                amount: { type: 'string', description: 'The sum with its unit, for example "2 silver".' },
                person: { type: 'string', description: 'Who is paid (pay) or who pays (collect).' },
                reason: { type: 'string', description: 'What the coin is for, in a few words.' },
            },
            required: ['action', 'amount', 'person'],
        },
    },
    {
        name: 'game_consume',
        displayName: 'Game: use up',
        description: 'The player eats, drinks, burns, breaks or otherwise uses up something they carry, because the player\'s newest message says so. The game system removes it and reports the result.',
        parameters: {
            type: 'object',
            properties: {
                item: { type: 'string', description: 'The carried thing, as the game state names it.' },
                quantity: { type: 'integer' },
            },
            required: ['item'],
        },
    },
]);

export const GAME_TOOL_NAMES = Object.freeze(GAME_TOOLS.map(tool => tool.name));

// --- text tool calls -----------------------------------------------------------

/**
 * Tool calls a model wrote as text because its provider returned them
 * unparsed: Gemma's `call:name{key:value,...}` lines (strings arrive
 * unquoted; their quote tokens are stripped), JSON objects with name and
 * arguments, and `name({...})`. Returns the calls and the prose left over.
 */
export function parseTextToolCalls(text, toolNames = GAME_TOOL_NAMES) {
    const names = new Set(toolNames);
    const source = String(text || '');
    if (!source.trim()) return { calls: [], rest: '' };
    const calls = [];
    let rest = source
        .replace(/<\|tool_call>|<tool_call\|>|<\|tool_response>|<tool_response\|>/gu, '\n')
        .replace(/<\/?tool_call>/gu, '\n')
        .replace(/```(?:json|tool_call|tool_code)?\s*([\s\S]*?)```/gu, '\n$1\n');
    const consume = (start, end) => {
        rest = `${rest.slice(0, start)}\n${rest.slice(end)}`;
    };
    // call:name{...}
    for (;;) {
        const match = /call:\s*([A-Za-z_][\w]*)\s*\{/u.exec(rest);
        if (!match) break;
        const open = match.index + match[0].length - 1;
        const close = matchingBrace(rest, open);
        if (close < 0) break;
        const name = match[1];
        const body = rest.slice(open + 1, close);
        if (names.has(name)) calls.push({ name, arguments: parseGemmaArguments(body) });
        consume(match.index, close + 1);
    }
    // name({...}) and name{...}
    for (const name of names) {
        for (;;) {
            const match = new RegExp(`\\b${name}\\s*\\(?\\s*\\{`, 'u').exec(rest);
            if (!match) break;
            const open = match.index + match[0].length - 1;
            const close = matchingBrace(rest, open);
            if (close < 0) break;
            const body = rest.slice(open + 1, close);
            const parsed = parseJsonObject(`{${body}}`) || parseGemmaArguments(body);
            calls.push({ name, arguments: parsed });
            let end = close + 1;
            if (/^\s*\)/u.test(rest.slice(end))) end += rest.slice(end).indexOf(')') + 1;
            consume(match.index, end);
        }
    }
    // {"name": "...", "arguments": {...}} and {"tool": ..., "parameters": ...}
    for (;;) {
        const match = /\{\s*"(?:name|tool|function)"\s*:/u.exec(rest);
        if (!match) break;
        const close = matchingBrace(rest, match.index);
        if (close < 0) break;
        const parsed = parseJsonObject(rest.slice(match.index, close + 1));
        const name = parsed?.name || parsed?.tool || parsed?.function?.name || parsed?.function;
        const args = parsed?.arguments ?? parsed?.parameters ?? parsed?.function?.arguments ?? parsed?.input ?? {};
        if (parsed && typeof name === 'string' && names.has(name)) {
            calls.push({ name, arguments: typeof args === 'string' ? (parseJsonObject(args) || parseGemmaArguments(args)) : (args || {}) });
        }
        consume(match.index, close + 1);
    }
    rest = rest.replace(/\n{2,}/gu, '\n\n').trim();
    return { calls: calls.slice(0, MAX_ACTIONS_PER_TURN), rest };
}

function matchingBrace(text, open) {
    let depth = 0;
    let quoted = '';
    for (let i = open; i < text.length; i += 1) {
        const char = text[i];
        if (quoted) {
            if (char === '\\') i += 1;
            else if (char === quoted) quoted = '';
            continue;
        }
        if (char === '"') quoted = char;
        else if (char === '{') depth += 1;
        else if (char === '}') {
            depth -= 1;
            if (depth === 0) return i;
        }
    }
    return -1;
}

function parseJsonObject(text) {
    try {
        const value = JSON.parse(text);
        return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
    } catch {
        return null;
    }
}

/** `key:value,key:value` where values may be unquoted and contain spaces. */
export function parseGemmaArguments(body) {
    const result = {};
    const text = String(body || '').trim();
    if (!text) return result;
    // A comma starts a new pair only when a key and a colon follow it.
    const pairs = text.split(/,(?=\s*"?[A-Za-z_][\w]*"?\s*:)/u);
    for (const pair of pairs) {
        const match = /^\s*"?([A-Za-z_][\w]*)"?\s*:\s*([\s\S]*?)\s*$/u.exec(pair);
        if (!match) continue;
        let value = match[2];
        if (/^".*"$/su.test(value) || /^'.*'$/su.test(value)) value = value.slice(1, -1);
        if (/^-?\d+$/u.test(value)) result[match[1]] = Number(value);
        else if (value === 'true' || value === 'false') result[match[1]] = value === 'true';
        else result[match[1]] = value;
    }
    return result;
}

// --- actions ------------------------------------------------------------------

/**
 * One tool call as a game action: { kind, item, person, price, amount,
 * quantity, reason }. Returns null for a call that names no known action.
 */
export function actionFromToolCall(name, args = {}) {
    const raw = args && typeof args === 'object' ? args : {};
    const tool = ACTION_BY_TOOL[name];
    if (!tool) return null;
    const requested = cleanString(String(raw.action || ''), 20).toLocaleLowerCase();
    const kind = tool.actions.includes(requested) ? requested : (tool.actions.length === 1 ? tool.actions[0] : '');
    if (!kind) return null;
    const quantity = Number.isFinite(Number(raw.quantity)) && Number(raw.quantity) > 0 ? Math.round(Number(raw.quantity)) : null;
    return {
        kind,
        item: cleanString(String(raw.item ?? raw.object ?? raw.thing ?? ''), 120),
        person: cleanString(String(raw.person ?? raw.from ?? raw.to ?? raw.seller ?? raw.buyer ?? ''), 120),
        price: raw.price ?? raw.amount ?? null,
        amount: raw.amount ?? raw.price ?? null,
        unit: cleanString(String(raw.unit ?? ''), 40),
        quantity,
        reason: cleanString(String(raw.reason ?? raw.for ?? ''), 160),
    };
}

/** A stable description of an action, for "already done this turn" checks. */
export function actionFingerprint(action) {
    return [action.kind, nameKey(action.item), nameKey(action.person), String(action.price ?? action.amount ?? ''), action.quantity || 1]
        .join('|');
}

function matchItem(candidates, raw) {
    const text = normalizeName(raw);
    if (!text) return null;
    const key = gameKey(text);
    const wanted = nameKey(text);
    const words = contentWords(text);
    return candidates.find(item => item.key === key || (item.baseKey && item.baseKey === key))
        || candidates.find(item => nameKey(item.name) === wanted)
        || candidates.find(item => words.size && wordsContained(contentWords(item.name), words))
        || candidates.find(item => wanted && (nameKey(item.name).includes(wanted) || wanted.includes(nameKey(item.name))))
        || null;
}

function heldBy(state, personKey) {
    return activeItems(state).filter(item => item.holder?.kind === 'character' && nameKey(item.holder.name) === personKey && !item.hidden);
}

function person(raw, state, context) {
    const text = normalizeName(raw);
    if (!text) return null;
    const holder = resolveHolder(text, context);
    if (!holder) return null;
    if (holder.kind === 'item') {
        const body = state.items?.[holder.key];
        if (body?.bodyOf) return { kind: 'body', name: body.bodyOf, body };
        return { kind: 'container', name: holder.name, item: body };
    }
    if (holder.kind === 'character') return { kind: 'character', name: holder.name, id: holder.id };
    if (holder.kind === 'player') return { kind: 'player', name: holder.name };
    if (holder.kind === 'place' && context.people?.has(nameKey(holder.name))) return { kind: 'character', name: holder.name };
    if (holder.kind === 'place' || holder.kind === 'location') {
        // "Mara's body" / a dead person's name resolves to their body.
        const dead = state.dead?.[nameKey(text.replace(/'s body$/iu, ''))];
        if (dead) return { kind: 'body', name: dead.name, body: state.items?.[dead.body] || null };
        if (holder.kind === 'location') return { kind: 'place', name: holder.name, id: holder.id };
        // A name the lore has not recorded yet is a person when the scene
        // shows them here; otherwise nobody of that name is known.
        const present = (context.present || []).find(name => nameKey(name) === nameKey(text)
            || nameKey(name).split(' ').includes(nameKey(text)));
        if (present) return { kind: 'character', name: present };
        return { kind: 'unknown', name: holder.name };
    }
    return null;
}

function money(value, unit, currency) {
    if (value === null || value === undefined || value === '') return null;
    const amount = parseMoney(typeof value === 'number' ? value : String(value), unit || undefined, currency);
    return Number.isFinite(amount) && amount > 0 ? amount : null;
}

function placeOf(state, context) {
    return context.scenePlace ? placeWithStage(state, context.scenePlace) : null;
}

/** The standing tier of a person toward the player, "neutral" when unknown. */
function tierOf(state, name) {
    const standing = state.standings?.[nameKey(name)];
    return standing ? standingTier(standing.score) : 'neutral';
}

function qty(action, item) {
    const wanted = action.quantity || 1;
    return item ? Math.min(wanted, item.quantity || 1) : wanted;
}

function withQuantity(name, quantity) {
    return quantity > 1 ? `${name} ×${quantity}` : name;
}

/**
 * Check and apply one action against the state. Returns the operations and
 * an outcome: { ok, kind, text, reason?, assumed? }. `text` is written for
 * the narrator ("Bought the brass lantern from Mara for 3 shillings").
 */
export function resolveGameAction(stateValue, action, context) {
    // applyGameOperations works in place: never on the caller's state.
    const state = structuredClone(normalizeGameState(stateValue));
    const currency = state.currency;
    const playerName = context.playerName || 'the player';
    const place = placeOf(state, context);
    const fail = (reason, extra = {}) => ({ ops: [], outcome: { ok: false, kind: action.kind, action, text: '', reason, ...extra } });
    const done = (ops, text, extra = {}) => ({ ops, outcome: { ok: true, kind: action.kind, action, text, ...extra } });
    const label = `${action.kind} ${action.item || action.amount || ''}${action.person ? ` (${action.person})` : ''}`.trim();
    const who = action.person ? person(action.person, state, context) : null;
    const partnerNeeded = ['buy', 'sell', 'give', 'receive', 'pay', 'collect'].includes(action.kind);
    if (partnerNeeded) {
        if (!action.person) return fail(`${label}: no person named.`);
        if (!who || who.kind === 'unknown') return fail(`${label}: nobody here is called ${action.person}.`);
        if (who.kind === 'player') return fail(`${label}: that is ${playerName}.`);
        if (who.kind === 'body' && ['buy', 'sell', 'give', 'pay', 'collect'].includes(action.kind)) return fail(`${label}: ${who.name} is dead.`);
        if (who.kind === 'character' && state.dead?.[nameKey(who.name)]) return fail(`${label}: ${who.name} is dead.`);
    }
    const partner = who?.kind === 'character' ? { kind: 'character', name: who.name, ...(who.id ? { id: who.id } : {}) } : null;
    const purseShort = amount => {
        const purse = state.purse || {};
        if (purse.amount === null || purse.amount === undefined) return 0;
        if (purse.minimum) return 0;
        return amount > purse.amount ? amount - purse.amount : 0;
    };
    const partnerCoin = name => {
        const purse = state.purses?.[nameKey(name)];
        return purse && purse.amount !== null && !purse.minimum ? purse.amount : null;
    };
    const after = ops => {
        const next = applyGameOperations(state, ops, { messageIndex: -1, source: ACTION_SOURCE }).state;
        return purseText(next);
    };

    switch (action.kind) {
    case 'buy': {
        const partnerKey = nameKey(partner.name);
        const wares = [
            ...heldBy(state, partnerKey),
            ...(place ? itemsAtPlace(state, place, { includePlanned: true }).filter(item => !item.bodyOf && !bodyHolding(state.items, item)
                && (!item.seller || nameKey(item.seller) === partnerKey) && Number.isFinite(item.price) && item.price !== null) : []),
        ];
        let item = matchItem(wares, action.item);
        const service = !item && place
            ? pricesAtPlace(state, place, [partner.name]).find(price => (!price.seller || nameKey(price.seller) === partnerKey)
                && (nameKey(price.name) === nameKey(action.item) || wordsContained(contentWords(price.name), contentWords(action.item))))
            : null;
        const offered = money(action.price, action.unit, currency);
        const quantity = qty(action, item);
        let listed = null;
        if (item && Number.isFinite(item.price) && item.price !== null) listed = item.price * quantity;
        else if (service) listed = service.amount * quantity;
        let price = offered ?? listed;
        if (!item && !service) {
            // Something the game knows is held or sold by someone else is not theirs to sell.
            const elsewhere = matchItem(activeItems(state).filter(entry => !entry.hidden), action.item);
            if (elsewhere) {
                const keeper = elsewhere.seller || (elsewhere.holder?.kind === 'character' ? elsewhere.holder.name : '')
                    || (isCarried(state.items, elsewhere) ? playerName : '');
                if (keeper && nameKey(keeper) !== partnerKey) return fail(`${label}: ${elsewhere.name} is ${elsewhere.seller ? 'sold' : 'held'} by ${keeper}, not ${partner.name}.`);
            }
            if (!offered) return fail(`${label}: nothing called ${action.item} is on offer from ${partner.name}, and no price was named. Ask the price, or name one of their wares.`);
            // The story put something on sale the ledger has not recorded yet.
            item = null;
        }
        if (price === null) return fail(`${label}: ${partner.name} has not named a price for ${item?.name || action.item}. Ask what they want for it first.`);
        if (listed !== null && offered !== null && offered < listed) {
            const warm = WARM_TIERS.has(tierOf(state, partner.name));
            if (offered < listed * HAGGLE_FLOOR || !warm) {
                return fail(`${label}: ${partner.name} wants ${formatMoney(listed, currency)} for ${item?.name || service?.name || action.item}, not ${formatMoney(offered, currency)}${warm ? '' : ` (they are ${tierOf(state, partner.name)} toward ${playerName} and will not come down)`}. Narrate the refusal or a counter-offer; call again at an accepted price.`);
            }
            price = offered;
        }
        const short = purseShort(price);
        if (short) return fail(`${label}: ${playerName} is short of coin: has ${formatMoney(state.purse.amount, currency)}, the price is ${formatMoney(price, currency)}. Nothing changed hands.`);
        const name = item?.name || service?.name || normalizeName(action.item);
        const ops = [{ type: 'money', amount: price, from: { kind: 'player', name: playerName }, to: partner, reason: `for ${withQuantity(name, quantity)}`, note: 'game action' }];
        if (item) {
            ops.push({ type: 'item.move', key: item.key, to: { kind: 'player', name: playerName }, how: 'buy', quantity, note: `bought from ${partner.name}` });
        } else if (!service) {
            ops.push({ type: 'item.add', key: uniqueKey(state, name), name, kind: 'other', quantity, holder: { kind: 'player', name: playerName }, value: Math.round(price / quantity), note: `bought from ${partner.name}` });
        }
        return done(ops, `Bought ${withQuantity(name, quantity)} from ${partner.name} for ${formatMoney(price, currency)}. Purse now: ${after(ops)}.`, { assumed: !item && !service });
    }
    case 'sell': {
        const item = matchItem(carriedItems(state), action.item);
        if (!item) return fail(`${label}: ${playerName} carries nothing called ${action.item}.`);
        const quantity = qty(action, item);
        const offered = money(action.price, action.unit, currency);
        const price = offered ?? (Number.isFinite(item.value) && item.value ? item.value * quantity : null);
        if (price === null) return fail(`${label}: no price agreed for ${item.name}. Narrate ${partner.name}'s offer, then call again with the agreed price.`);
        const coin = partnerCoin(partner.name);
        if (coin !== null && coin < price) return fail(`${label}: ${partner.name} has only ${formatMoney(coin, currency)}, not ${formatMoney(price, currency)}. Nothing changed hands.`);
        const ops = [
            { type: 'money', amount: price, from: partner, to: { kind: 'player', name: playerName }, reason: `for ${withQuantity(item.name, quantity)}`, note: 'game action' },
            { type: 'item.move', key: item.key, to: partner, how: 'sell', quantity, note: `sold to ${partner.name}` },
        ];
        return done(ops, `Sold ${withQuantity(item.name, quantity)} to ${partner.name} for ${formatMoney(price, currency)}. Purse now: ${after(ops)}.`);
    }
    case 'give': {
        const item = matchItem(carriedItems(state), action.item);
        if (!item) return fail(`${label}: ${playerName} carries nothing called ${action.item}.`);
        const quantity = qty(action, item);
        const ops = [{ type: 'item.move', key: item.key, to: partner, how: 'give', quantity, note: `given to ${partner.name}` }];
        return done(ops, `Gave ${withQuantity(item.name, quantity)} to ${partner.name}.`);
    }
    case 'receive': {
        const partnerKey = nameKey(partner.name);
        const held = activeItems(state).filter(item => item.holder?.kind === 'character' && nameKey(item.holder.name) === partnerKey);
        const item = matchItem(held, action.item);
        const quantity = qty(action, item);
        if (item) {
            const ops = [{ type: 'item.move', key: item.key, to: { kind: 'player', name: playerName }, how: 'give', quantity, note: `from ${partner.name}` }];
            return done(ops, `${partner.name} handed over ${withQuantity(item.name, quantity)}; ${playerName} now carries it.`);
        }
        const name = normalizeName(action.item);
        if (!name) return fail(`${label}: no thing named.`);
        const ops = [{ type: 'item.add', key: uniqueKey(state, name), name, kind: 'other', quantity, holder: { kind: 'player', name: playerName }, note: `from ${partner.name}` }];
        return done(ops, `${partner.name} handed over ${withQuantity(name, quantity)}; ${playerName} now carries it.`, { assumed: true });
    }
    case 'take': {
        const items = state.items || {};
        const here = place ? itemsAtPlace(state, place, { includePlanned: true }) : [];
        let candidates = here.filter(item => !item.bodyOf);
        let from = place?.name ? `here at ${place.name}` : 'here';
        if (who?.kind === 'body') {
            candidates = activeItems(state).filter(item => who.body && bodyHolding(items, item) === who.body.key);
            from = `${who.name}'s body`;
        } else if (who?.kind === 'container') {
            candidates = activeItems(state).filter(item => item.holder?.kind === 'item' && who.item && item.holder.key === who.item.key);
            from = who.name;
        } else if (who?.kind === 'character') {
            const dead = state.dead?.[nameKey(who.name)];
            if (!dead) {
                const held = matchItem(heldBy(state, nameKey(who.name)), action.item);
                return fail(`${label}: ${who.name} is alive and ${held ? `holding ${held.name}` : 'not handing it over'}. Taking it is theft or a request: narrate what ${who.name} does; if they hand it over, call game_transfer with action receive.`);
            }
            candidates = activeItems(state).filter(item => bodyHolding(items, item) === dead.body);
            from = `${who.name}'s body`;
        } else if (who?.kind === 'place') {
            candidates = itemsAtPlace(state, who, { includePlanned: true }).filter(item => !item.bodyOf);
            from = who.name;
        }
        const item = matchItem(candidates, action.item) || (who?.kind !== 'body' && who?.kind !== 'container' && who?.kind !== 'character'
            ? matchItem(activeItems(state).filter(entry => !isCarried(items, entry) && !entry.bodyOf && entry.holder?.kind !== 'character'), action.item)
            : null);
        if (!item) {
            if (who?.kind === 'body' || who?.kind === 'character') {
                const name = normalizeName(action.item);
                if (!name) return fail(`${label}: no thing named.`);
                const ops = [{ type: 'item.add', key: uniqueKey(state, name), name, kind: 'other', quantity: action.quantity || 1, holder: { kind: 'player', name: playerName }, note: `taken from ${from}` }];
                return done(ops, `Took ${withQuantity(name, action.quantity || 1)} from ${from}.`, { assumed: true });
            }
            return fail(`${label}: nothing called ${action.item} is ${from}${here.length ? ` (here: ${here.filter(entry => !entry.hidden).slice(0, 8).map(entry => entry.name).join(', ')})` : ''}.`);
        }
        const quantity = qty(action, item);
        const looted = Boolean(bodyHolding(items, item));
        const owner = item.owner && nameKey(item.owner) !== nameKey(playerName) && !state.dead?.[nameKey(item.owner)] ? item.owner : '';
        const ops = [{ type: 'item.move', key: item.key, to: { kind: 'player', name: playerName }, how: looted ? 'loot' : 'take', quantity, note: `from ${from}` }];
        return done(ops, `Took ${withQuantity(item.name, quantity)} from ${from}${owner ? ` (it belongs to ${owner})` : ''}.`);
    }
    case 'drop': {
        const item = matchItem(carriedItems(state), action.item);
        if (!item) return fail(`${label}: ${playerName} carries nothing called ${action.item}.`);
        const quantity = qty(action, item);
        const to = who?.kind === 'container' && who.item
            ? { kind: 'item', key: who.item.key, name: who.item.name }
            : place ? { kind: 'location', name: place.name, ...(place.id ? { id: place.id } : {}) } : null;
        if (!to) return fail(`${label}: where the player is has not been established.`);
        const ops = [{ type: 'item.move', key: item.key, to, how: 'drop', quantity, note: '' }];
        return done(ops, `Set down ${withQuantity(item.name, quantity)} ${to.kind === 'item' ? `in ${to.name}` : `at ${to.name}`}.`);
    }
    case 'pay': {
        const amount = money(action.amount, action.unit, currency);
        if (!amount) return fail(`${label}: no usable amount.`);
        const short = purseShort(amount);
        if (short) return fail(`${label}: ${playerName} is short of coin: has ${formatMoney(state.purse.amount, currency)}, the sum is ${formatMoney(amount, currency)}. Nothing changed hands.`);
        const ops = [{ type: 'money', amount, from: { kind: 'player', name: playerName }, to: partner, reason: action.reason || '', note: 'game action' }];
        return done(ops, `Paid ${formatMoney(amount, currency)} to ${partner.name}${action.reason ? ` for ${action.reason}` : ''}. Purse now: ${after(ops)}.`);
    }
    case 'collect': {
        const amount = money(action.amount, action.unit, currency);
        if (!amount) return fail(`${label}: no usable amount.`);
        const coin = partnerCoin(partner.name);
        if (coin !== null && coin < amount) return fail(`${label}: ${partner.name} has only ${formatMoney(coin, currency)}, not ${formatMoney(amount, currency)}.`);
        const ops = [{ type: 'money', amount, from: partner, to: { kind: 'player', name: playerName }, reason: action.reason || '', note: 'game action' }];
        return done(ops, `${partner.name} paid ${formatMoney(amount, currency)} to ${playerName}${action.reason ? ` (${action.reason})` : ''}. Purse now: ${after(ops)}.`);
    }
    case 'consume': {
        const item = matchItem(carriedItems(state), action.item);
        if (!item) return fail(`${label}: ${playerName} carries nothing called ${action.item}.`);
        const quantity = qty(action, item);
        const ops = [{ type: 'item.remove', key: item.key, quantity, reason: 'consumed', note: '' }];
        return done(ops, `${withQuantity(item.name, quantity)} used up${item.quantity > quantity ? ` (${item.quantity - quantity} left)` : ''}.`);
    }
    case 'swap': {
        const mine = matchItem(carriedItems(state), action.offer);
        const theirs = matchItem(heldBy(state, nameKey(partner.name)), action.item);
        if (!mine) return fail(`${label}: ${playerName} carries nothing called ${action.offer}.`);
        if (!theirs) return fail(`${label}: ${partner.name} holds nothing called ${action.item}.`);
        const ops = [
            { type: 'item.move', key: mine.key, to: partner, how: 'trade', quantity: 1, note: `traded for ${theirs.name}` },
            { type: 'item.move', key: theirs.key, to: { kind: 'player', name: playerName }, how: 'trade', quantity: 1, note: `traded for ${mine.name}` },
        ];
        return done(ops, `Traded ${mine.name} to ${partner.name} for ${theirs.name}.`);
    }
    default:
        return fail(`${label}: unknown action.`);
    }
}

function uniqueKey(state, name) {
    const base = gameKey(name) || 'thing';
    let key = base;
    for (let n = 2; state.items?.[key]; n += 1) key = `${base}_${n}`;
    return key;
}

/**
 * Resolve several actions in order (a purchase, then a gift of the thing
 * bought), each seeing the state the earlier ones left. Returns every
 * outcome and the operations to journal, in order.
 */
export function resolveGameActions(stateValue, actions, context) {
    let state = structuredClone(normalizeGameState(stateValue));
    const ops = [];
    const outcomes = [];
    for (const action of (Array.isArray(actions) ? actions : []).slice(0, MAX_ACTIONS_PER_TURN)) {
        if (!action?.kind) continue;
        const result = resolveGameAction(state, action, context);
        outcomes.push(result.outcome);
        if (result.ops.length) {
            state = applyGameOperations(state, result.ops, { messageIndex: -1, source: ACTION_SOURCE }).state;
            ops.push(...result.ops);
        }
    }
    return { ops, outcomes, state };
}

/** Whether an identical action is already journaled at or after `sinceIndex`. */
export function actionAlreadyApplied(stateValue, ops, sinceIndex) {
    const state = normalizeGameState(stateValue);
    const recent = state.journal.filter(entry => entry.source === ACTION_SOURCE && entry.at >= sinceIndex);
    if (!recent.length || !ops.length) return false;
    return ops.every(op => recent.some(entry => sameOperation(entry.op, op)));
}

function sameOperation(a, b) {
    if (!a || !b || a.type !== b.type) return false;
    switch (a.type) {
    case 'money':
        return a.amount === b.amount && holderKey(a.from) === holderKey(b.from) && holderKey(a.to) === holderKey(b.to);
    case 'item.move':
        return a.key === b.key && holderKey(a.to) === holderKey(b.to) && (a.quantity ?? null) === (b.quantity ?? null);
    case 'item.add':
        return nameKey(a.name) === nameKey(b.name) && holderKey(a.holder) === holderKey(b.holder);
    case 'item.remove':
        return a.key === b.key && (a.quantity ?? null) === (b.quantity ?? null);
    default:
        return false;
    }
}

/**
 * Ledger records that only repeat what a game action already journaled in
 * the same passage are dropped, so a purchase is never counted twice.
 */
export function dropDuplicateLedgerOps(ops, actionEntries) {
    const entries = (actionEntries || []).filter(entry => entry?.op);
    if (!entries.length) return { ops, dropped: [] };
    const kept = [];
    const dropped = [];
    for (const op of ops || []) {
        const twin = entries.find(entry => ledgerRepeats(entry.op, op));
        if (twin) dropped.push(op);
        else kept.push(op);
    }
    return { ops: kept, dropped };
}

function ledgerRepeats(action, op) {
    if (!action || !op) return false;
    if (op.type === 'money' && action.type === 'money') {
        return op.amount === action.amount && holderKey(op.from) === holderKey(action.from) && holderKey(op.to) === holderKey(action.to);
    }
    if (op.type === 'item.move' && action.type === 'item.move') {
        return op.key === action.key && holderKey(op.to) === holderKey(action.to);
    }
    if ((op.type === 'item.add' || op.type === 'item.move') && action.type === 'item.add') {
        // The ledger "adds" what the action already gave the player.
        return holderKey(op.holder || op.to) === holderKey(action.holder)
            && (op.key === action.key || nameKey(op.name || '') === nameKey(action.name));
    }
    if (op.type === 'item.add' && action.type === 'item.move') {
        return holderKey(op.holder) === holderKey(action.to) && op.key === action.key;
    }
    if (op.type === 'item.remove' && action.type === 'item.remove') return op.key === action.key;
    return false;
}

/** The journal entries of actions resolved for the turn that produced messages `start..end`. */
export function actionEntriesInRange(stateValue, start, end) {
    const state = normalizeGameState(stateValue);
    return state.journal.filter(entry => entry.source === ACTION_SOURCE && entry.at >= start - 1 && entry.at <= end + 1);
}

// --- what the narrator is told --------------------------------------------------

/**
 * The block in the story packet for actions already applied this turn. The
 * narrator tells them as settled facts; a refused one is told as a refusal.
 */
export function renderResolvedActions(outcomes, options = {}) {
    const list = (outcomes || []).filter(outcome => outcome && (outcome.text || outcome.reason));
    if (!list.length) return '';
    const lines = list.map(outcome => (outcome.ok
        ? `- DONE: ${outcome.text}${outcome.assumed ? ' (taken on the story\'s word; the game state did not list it before)' : ''}`
        : `- NOT DONE: ${outcome.reason}`));
    return [
        'RESOLVED THIS TURN (the game system has already applied these; narrate them exactly as stated: the amounts, prices and who holds what are final, and nothing else changed hands):',
        ...lines,
        options.toolsOffered === false
            ? 'Do not call the game tools again for these; narrate.'
            : '',
    ].filter(Boolean).join('\n');
}

/** Standing instructions for a story model that has the game tools. */
export function renderToolGuidance({ offered = true, resolved = false } = {}) {
    if (!offered) return '';
    if (resolved) return 'GAME TOOLS: this turn\'s exchanges are resolved above. Narrate; do not call the tools again.';
    return 'GAME TOOLS: the player\'s newest message moves coin or belongings. For each exchange that message makes (buy, sell, give, accept, pick up, drop, pay, collect, use up), call the matching game tool (game_trade, game_transfer, game_coin, game_consume) BEFORE writing any prose, one call per exchange, with the names the game state uses. The game system applies it and reports what happened; narrate that report exactly (a refused purchase is narrated as refused). Call nothing for what the player did not do: an exchange someone else only offers, demands or prices is narrated as an offer, and the player decides. Never call a tool to report that nothing changed hands, and never write a tool call as text inside the story.';
}

/** A one-line summary of what the trade screen asked for, as the player's message. */
export function panelActionText(action, playerLabel = 'I') {
    const a = action || {};
    switch (a.kind) {
    case 'buy': return `${playerLabel} buy ${a.item} from ${a.person}${a.price ? ` for ${a.price}` : ''}.`;
    case 'sell': return `${playerLabel} sell ${a.item} to ${a.person}${a.price ? ` for ${a.price}` : ''}.`;
    case 'swap': return `${playerLabel} offer ${a.person} ${a.offer} in trade for ${a.item}.`;
    case 'take': return `${playerLabel} take ${a.item}${a.person ? ` from ${a.person}` : ''}.`;
    default: return '';
    }
}

export const __test = { matchItem, sameOperation, ledgerRepeats };
