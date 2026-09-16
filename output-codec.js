import { extractJsonObject } from './core.js';

export const OUTPUT_FORMAT_JSON = 'json';
export const OUTPUT_FORMAT_DSL = 'dsl';

const TASKS = Object.freeze({
    curator: 'CURATOR',
    progression: 'PROGRESSION',
    event_director: 'EVENT_DIRECTOR',
});

const ENTITY_TYPES = new Set([
    'location', 'item', 'character', 'faction', 'organization', 'creature', 'event', 'concept',
]);
const BLOCKED_PATH_PARTS = new Set(['__proto__', 'prototype', 'constructor']);
const MAXIMUM_DOCUMENT_CHARACTERS = 250_000;
const MAXIMUM_LINES = 20_000;
const MAXIMUM_RECORDS = 1_000;
const MAXIMUM_ARRAY_INDEX = 1_000;
const MAXIMUM_PATH_DEPTH = 16;
const DSL_PARSE_DIAGNOSTICS = Symbol('innerloreDslParseDiagnostics');
const ROOT_ITEM_PATHS = Object.freeze({
    curator: new Set(['spatial.set', 'persistent_self.set', 'voice.set', 'relationships', 'current_mind.emotions']),
    progression: new Set(['timeline']),
    event_director: new Set(['source_refs']),
});
const ITEM_IDENTITY_FIELDS = Object.freeze({
    'spatial.set': 'key',
    'persistent_self.set': 'key',
    'voice.set': 'key',
    relationships: 'target',
    set: 'key',
    'current_mind.emotions': 'name',
    timeline: 'key',
});
const PRIMITIVE_LIST_PATHS = Object.freeze({
    curator: new Set([
        'aliases', 'keys', 'facts', 'history', 'unresolved',
        'remove_facts', 'remove_relationships', 'remove_history', 'resolve_threads',
        'spatial.delete', 'persistent_self.delete', 'voice.delete',
        'current_mind.relevant_memory_keys', 'current_mind.inner_thoughts', 'delete',
    ]),
    progression: new Set([
        'basis', 'completed_actions', 'blockers', 'requirements', 'conditions', 'subjects',
    ]),
    event_director: new Set(['subjects']),
});

export function normalizeOutputFormat(value) {
    return String(value || '').trim().toLocaleLowerCase() === OUTPUT_FORMAT_DSL
        ? OUTPUT_FORMAT_DSL
        : OUTPUT_FORMAT_JSON;
}

function normalizeTask(value) {
    const task = String(value || '').trim().toLocaleLowerCase().replaceAll('-', '_');
    if (!TASKS[task]) throw new Error(`Unknown InnerLore output task "${task || '(empty)'}".`);
    return task;
}

function stripReasoningAndFences(value) {
    return String(value ?? '')
        .replace(/<think>[\s\S]*?<\/think>/giu, '')
        .replace(/<thinking>[\s\S]*?<\/thinking>/giu, '')
        .replace(/```(?:innerlore|dsl|text)?/giu, '')
        .replace(/```/gu, '')
        .replaceAll('\r\n', '\n')
        .replaceAll('\r', '\n');
}

function dslError(lineNumber, message) {
    const error = new Error(`InnerLore DSL line ${lineNumber}: ${message}`);
    error.name = 'InnerLoreDslError';
    error.lineNumber = lineNumber;
    return error;
}

function decodeText(value, lineNumber) {
    let output = '';
    for (let index = 0; index < value.length; index++) {
        const character = value[index];
        if (character !== '\\') {
            output += character;
            continue;
        }
        const next = value[++index];
        if (next === undefined) throw dslError(lineNumber, 'a value ends with an incomplete escape.');
        if (next === 'n') output += '\n';
        else if (next === 'r') output += '\r';
        else if (next === 't') output += '\t';
        else if (next === '\\') output += '\\';
        else {
            // Natural-language values frequently contain an incidental
            // backslash. Preserve unknown escapes rather than corrupting data.
            output += `\\${next}`;
        }
    }
    return output;
}

function parseScalar(rawValue, lineNumber) {
    const value = rawValue.trim();
    if (!value) throw dslError(lineNumber, 'a field value is empty; omit the field instead.');
    if (/^TEXT\s/iu.test(value)) return decodeText(value.slice(5), lineNumber);
    if (/^NULL$/iu.test(value)) return null;
    if (/^(?:TRUE|FALSE)$/iu.test(value)) return /^TRUE$/iu.test(value);
    if (/^EMPTY_LIST$/iu.test(value)) return [];
    if (/^EMPTY_MAP$/iu.test(value)) return {};
    if (/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:e[+-]?\d+)?$/iu.test(value)) {
        const number = Number(value);
        if (!Number.isFinite(number)) throw dslError(lineNumber, `numeric value "${value}" is not finite.`);
        return number;
    }
    return decodeText(value, lineNumber);
}

function pathTokens(rawPath, lineNumber) {
    if (rawPath.length > 300) throw dslError(lineNumber, 'the field path is too long.');
    const parts = rawPath.split('.');
    if (!parts.length || parts.length > MAXIMUM_PATH_DEPTH) {
        throw dslError(lineNumber, `field paths may contain at most ${MAXIMUM_PATH_DEPTH} levels.`);
    }
    const tokens = [];
    for (const part of parts) {
        const match = /^([a-z][a-z0-9_]*)(?:\[(\d+)\])?$/u.exec(part);
        if (!match) throw dslError(lineNumber, `invalid field path "${rawPath}".`);
        if (BLOCKED_PATH_PARTS.has(match[1])) throw dslError(lineNumber, `unsafe field name "${match[1]}".`);
        tokens.push(match[1]);
        if (match[2] !== undefined) {
            const index = Number(match[2]);
            if (index > MAXIMUM_ARRAY_INDEX) {
                throw dslError(lineNumber, `array index ${index} exceeds ${MAXIMUM_ARRAY_INDEX}.`);
            }
            tokens.push(index);
        }
    }
    return tokens;
}

function containerFor(nextToken) {
    return typeof nextToken === 'number' ? [] : {};
}

function descendForWrite(root, tokens, lineNumber) {
    let parent = root;
    for (let index = 0; index < tokens.length - 1; index++) {
        const token = tokens[index];
        const nextToken = tokens[index + 1];
        if (typeof token === 'number') {
            if (!Array.isArray(parent)) throw dslError(lineNumber, 'an indexed path did not point to a list.');
            if (token > parent.length) {
                throw dslError(lineNumber, `array index ${token} creates a gap; use contiguous zero-based indexes.`);
            }
            if (parent[token] === undefined) parent[token] = containerFor(nextToken);
            else if (!parent[token] || typeof parent[token] !== 'object') {
                throw dslError(lineNumber, 'a field path attempts to descend through a scalar value.');
            }
            parent = parent[token];
            continue;
        }
        if (!parent || typeof parent !== 'object' || Array.isArray(parent)) {
            throw dslError(lineNumber, 'a field path attempts to descend through a non-map value.');
        }
        if (!Object.hasOwn(parent, token)) parent[token] = containerFor(nextToken);
        else if (!parent[token] || typeof parent[token] !== 'object') {
            throw dslError(lineNumber, `field "${token}" is already a scalar value.`);
        }
        parent = parent[token];
    }
    return { parent, finalToken: tokens.at(-1) };
}

function writeScalar(root, rawPath, operator, value, lineNumber) {
    const tokens = pathTokens(rawPath, lineNumber);
    const { parent, finalToken } = descendForWrite(root, tokens, lineNumber);
    if (operator === '+=') {
        if (typeof finalToken === 'number') {
            throw dslError(lineNumber, 'the += operator targets a named list field, not an indexed item.');
        }
        if (!Object.hasOwn(parent, finalToken)) parent[finalToken] = [];
        if (!Array.isArray(parent[finalToken])) {
            throw dslError(lineNumber, `field "${rawPath}" is not a list and cannot use +=.`);
        }
        parent[finalToken].push(value);
        return { duplicateIgnored: false };
    }
    if (typeof finalToken === 'number') {
        if (!Array.isArray(parent)) throw dslError(lineNumber, 'an indexed assignment did not point to a list.');
        if (finalToken > parent.length) {
            throw dslError(lineNumber, `array index ${finalToken} creates a gap; use contiguous zero-based indexes.`);
        }
        if (parent[finalToken] !== undefined) {
            if (Object.is(parent[finalToken], value)) return { duplicateIgnored: true };
            throw dslError(lineNumber, `field "${rawPath}" is assigned twice.`);
        }
        parent[finalToken] = value;
        return { duplicateIgnored: false };
    }
    if (!parent || typeof parent !== 'object' || Array.isArray(parent)) {
        throw dslError(lineNumber, 'a named assignment did not point to a map.');
    }
    if (Object.hasOwn(parent, finalToken)) {
        if (Object.is(parent[finalToken], value)) return { duplicateIgnored: true };
        throw dslError(lineNumber, `field "${rawPath}" is assigned twice.`);
    }
    parent[finalToken] = value;
    return { duplicateIgnored: false };
}

function appendMap(root, rawPath, lineNumber) {
    const tokens = pathTokens(rawPath, lineNumber);
    if (typeof tokens.at(-1) === 'number') {
        throw dslError(lineNumber, 'ITEM targets a named list field, not an indexed item.');
    }
    const { parent, finalToken } = descendForWrite(root, tokens, lineNumber);
    let reopenedNull = false;
    if (!Object.hasOwn(parent, finalToken)) parent[finalToken] = [];
    else if (parent[finalToken] === null) {
        // Models sometimes emit `list = NULL` immediately before supplying
        // replacement ITEM blocks. Reopening that exact null as a list is
        // lossless: the following ITEMs provide the intended replacement.
        parent[finalToken] = [];
        reopenedNull = true;
    }
    if (!Array.isArray(parent[finalToken])) {
        throw dslError(lineNumber, `ITEM target "${rawPath}" is not a list.`);
    }
    const item = {};
    parent[finalToken].push(item);
    return { item, list: parent[finalToken], reopenedNull };
}

function pruneEmptyListMaps(value, diagnostics, path = '') {
    if (Array.isArray(value)) {
        for (let index = value.length - 1; index >= 0; index--) {
            const item = value[index];
            pruneEmptyListMaps(item, diagnostics, `${path}[${index}]`);
            if (item && typeof item === 'object' && !Array.isArray(item) && !Object.keys(item).length) {
                value.splice(index, 1);
                diagnostics.push({ code: 'empty_item_removed', path: `${path}[${index}]` });
            }
        }
        return;
    }
    if (!value || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) {
        pruneEmptyListMaps(child, diagnostics, path ? `${path}.${key}` : key);
    }
}

function decodedHeaderValue(value, lineNumber) {
    const trimmed = value.trim();
    if (!trimmed) return '';
    return decodeText(trimmed.replace(/^TEXT\s/iu, ''), lineNumber);
}

function openRecord(task, line, result, lineNumber) {
    if (task === 'curator') {
        const match = /^(LOCATION|ITEM|CHARACTER|FACTION|ORGANIZATION|CREATURE|EVENT|CONCEPT|ENTITY|MIND)(?:\s+(.+))?$/iu.exec(line);
        if (!match) return null;
        const kind = match[1].toLocaleLowerCase();
        const name = decodedHeaderValue(match[2] || '', lineNumber);
        if (kind === 'mind') {
            const record = {};
            if (name) record.character = name;
            result.minds.push(record);
            return record;
        }
        const record = {};
        if (kind !== 'entity') record.type = kind;
        if (name) record.name = name;
        result.entities.push(record);
        return record;
    }
    if (task === 'progression') {
        const match = /^(TIME|GOAL|PROCESS|EVENT|EVALUATION)(?:\s+(.+))?$/iu.exec(line);
        if (!match) return null;
        const kind = match[1].toLocaleLowerCase();
        const key = decodedHeaderValue(match[2] || '', lineNumber);
        if (kind === 'time') {
            if (result.__timeSeen) throw dslError(lineNumber, 'TIME may appear only once.');
            result.__timeSeen = true;
            return result.time;
        }
        const target = kind === 'evaluation'
            ? result.event_evaluations
            : ({ goal: result.goals, process: result.processes, event: result.events })[kind];
        const record = {};
        if (key) record.key = key;
        target.push(record);
        return record;
    }
    const match = /^PROPOSAL(?:\s+(.+))?$/iu.exec(line);
    if (!match) return null;
    if (result.__proposalSeen) throw dslError(lineNumber, 'only one PROPOSAL or NO_PROPOSAL declaration is allowed.');
    result.__proposalSeen = true;
    result.proposal = {};
    const key = decodedHeaderValue(match[1] || '', lineNumber);
    if (key) result.proposal.key = key;
    return result.proposal;
}

function initialPayload(task) {
    if (task === 'curator') return { entities: [], minds: [] };
    if (task === 'progression') {
        return {
            time: {}, goals: [], processes: [], events: [], event_evaluations: [], __timeSeen: false,
        };
    }
    return { proposal: null, reason: '', __proposalSeen: false, __reasonSeen: false };
}

function isTopLevelDeclaration(task, line) {
    if (task === 'curator') {
        return /^(?:LOCATION|ITEM|CHARACTER|FACTION|ORGANIZATION|CREATURE|EVENT|CONCEPT|ENTITY|MIND)(?:\s+.+)?$/iu.test(line);
    }
    if (task === 'progression') {
        return /^(?:TIME|GOAL|PROCESS|EVENT|EVALUATION)(?:\s+.+)?$/iu.test(line);
    }
    return /^(?:PROPOSAL(?:\s+.+)?|NO_PROPOSAL|REASON\s*=\s*.+)$/iu.test(line);
}

/**
 * Parse InnerLore DSL v1 into the same plain object consumed by the existing
 * JSON validators and mutation engines. This parser deliberately has no eval,
 * arbitrary aliases, or prototype-bearing dynamic assignments. Its small set
 * of safe structural normalizations is surfaced through parse diagnostics.
 */
export function parseInnerLoreDsl(value, requestedTask) {
    const task = normalizeTask(requestedTask);
    const text = stripReasoningAndFences(value);
    if (text.length > MAXIMUM_DOCUMENT_CHARACTERS) {
        throw new Error(`InnerLore DSL exceeds ${MAXIMUM_DOCUMENT_CHARACTERS} characters.`);
    }
    const allLines = text.split('\n');
    if (allLines.length > MAXIMUM_LINES) throw new Error(`InnerLore DSL exceeds ${MAXIMUM_LINES} lines.`);
    const headerPattern = /^INNERLORE\s+(CURATOR|PROGRESSION|EVENT[_-]DIRECTOR)\s+1$/iu;
    const headerIndex = allLines.findIndex(line => headerPattern.test(line.trim()));
    if (headerIndex < 0) throw new Error(`The model response contained no INNERLORE ${TASKS[task]} 1 header.`);
    const declared = headerPattern.exec(allLines[headerIndex].trim())?.[1]
        ?.toLocaleLowerCase().replace('-', '_');
    if (declared !== task) {
        throw dslError(headerIndex + 1, `document task ${declared} does not match expected task ${task}.`);
    }

    const result = initialPayload(task);
    const diagnostics = [];
    const itemParents = new WeakMap();
    const itemPaths = new WeakMap();
    let record = null;
    let contexts = [];
    let records = 0;
    let done = false;
    let lastAppend = null;
    let finalDoneIndex = -1;
    for (let index = allLines.length - 1; index > headerIndex; index--) {
        if (allLines[index].trim() === 'DONE') {
            finalDoneIndex = index;
            break;
        }
    }
    for (let index = headerIndex + 1; index < allLines.length; index++) {
        const lineNumber = index + 1;
        let line = allLines[index].trim();
        if (!line) continue;
        if (line === 'DONE') {
            lastAppend = null;
            if (index !== finalDoneIndex) {
                if (record) {
                    diagnostics.push({
                        code: 'premature_done_closed_record', lineNumber, openLevels: contexts.length,
                    });
                    record = null;
                    contexts = [];
                } else {
                    diagnostics.push({ code: 'premature_done_ignored', lineNumber });
                }
                continue;
            }
            if (record) {
                diagnostics.push({
                    code: 'implicit_end_before_done', lineNumber, openLevels: contexts.length,
                });
                record = null;
                contexts = [];
            }
            done = true;
            break;
        }
        if (line === 'END') {
            lastAppend = null;
            if (!record) {
                diagnostics.push({ code: 'orphan_end_ignored', lineNumber });
                continue;
            }
            let nextLine = '';
            for (let lookahead = index + 1; lookahead < allLines.length; lookahead++) {
                nextLine = allLines[lookahead].trim();
                if (nextLine) break;
            }
            const nextContinuesRecord = contexts.length === 1
                && (ROOT_ITEM_PATHS[task].has(nextLine)
                    || /^[a-z][a-z0-9_.\[\]]*\s*(?:\+=|=)\s*.+$/u.test(nextLine));
            if (nextContinuesRecord) {
                diagnostics.push({ code: 'early_outer_end_ignored', lineNumber });
                continue;
            }
            contexts.pop();
            if (!contexts.length) record = null;
            continue;
        }
        const nestedItemDeclaration = /^ITEM\s+[a-z][a-z0-9_.]*$/u.test(line)
            || (record && contexts.length > 1
                && itemPaths.get(contexts.at(-1)) === 'relationships'
                && /^ITEM\s+.+$/u.test(line));
        if (record && !nestedItemDeclaration && isTopLevelDeclaration(task, line)) {
            diagnostics.push({
                code: 'implicit_end_before_record', lineNumber, openLevels: contexts.length,
            });
            record = null;
            contexts = [];
            lastAppend = null;
        }
        if (record) {
            if (ROOT_ITEM_PATHS[task].has(line)) {
                diagnostics.push({ code: 'bare_item_path_normalized', lineNumber, path: line });
                line = `ITEM ${line}`;
            }
            let item = /^ITEM\s+([a-z][a-z0-9_.]*)$/u.exec(line);
            if (!item && contexts.length > 1 && itemPaths.get(contexts.at(-1)) === 'relationships') {
                const namedRelationshipItem = /^ITEM\s+(.+)$/u.exec(line);
                if (namedRelationshipItem && !Object.hasOwn(contexts.at(-1), 'target')) {
                    contexts.at(-1).target = decodedHeaderValue(namedRelationshipItem[1], lineNumber);
                    diagnostics.push({ code: 'named_relationship_item_normalized', lineNumber });
                    continue;
                }
            }
            if (item) {
                lastAppend = null;
                if (ROOT_ITEM_PATHS[task].has(item[1]) && contexts.length > 1) {
                    diagnostics.push({
                        code: 'implicit_end_before_root_item', lineNumber, openLevels: contexts.length - 1,
                    });
                    contexts = [record];
                }
                if (contexts.length >= MAXIMUM_PATH_DEPTH) {
                    throw dslError(lineNumber, `ITEM nesting may contain at most ${MAXIMUM_PATH_DEPTH} levels.`);
                }
                const appended = appendMap(contexts.at(-1), item[1], lineNumber);
                if (appended.reopenedNull) {
                    diagnostics.push({ code: 'null_list_reopened', lineNumber, path: item[1] });
                }
                itemParents.set(appended.item, appended.list);
                itemPaths.set(appended.item, item[1]);
                contexts.push(appended.item);
                continue;
            }
            const abbreviatedAppend = /^\+=\s+(.+)$/u.exec(line);
            if (abbreviatedAppend) {
                if (!lastAppend || lastAppend.target !== contexts.at(-1)) {
                    throw dslError(lineNumber, 'a shorthand += line must immediately follow a named += field in the same block.');
                }
                line = `${lastAppend.path} += ${abbreviatedAppend[1]}`;
                diagnostics.push({ code: 'implicit_list_path', lineNumber, path: lastAppend.path });
            }
            let assignment = /^([a-z][a-z0-9_.\[\]]*)\s*(\+=|=)\s*(.+)$/u.exec(line);
            if (!assignment) {
                const activeItem = contexts.length > 1 ? contexts.at(-1) : null;
                const identityField = activeItem ? ITEM_IDENTITY_FIELDS[itemPaths.get(activeItem)] : '';
                if (identityField && !Object.hasOwn(activeItem, identityField)) {
                    line = `${identityField} = ${line}`;
                    diagnostics.push({
                        code: 'bare_item_identity_normalized',
                        lineNumber,
                        path: itemPaths.get(activeItem),
                        field: identityField,
                    });
                    assignment = /^([a-z][a-z0-9_.\[\]]*)\s*(\+=|=)\s*(.+)$/u.exec(line);
                }
            }
            if (!assignment) throw dslError(lineNumber, 'expected a field assignment or END.');
            const rootPath = assignment[1].split('.')[0];
            if (contexts.length > 1
                && ['current_mind', 'persistent_self', 'voice', 'spatial'].includes(rootPath)
                && !assignment[1].startsWith(`${itemPaths.get(contexts.at(-1)) || ''}.`)) {
                diagnostics.push({
                    code: 'implicit_end_before_root_field', lineNumber, openLevels: contexts.length - 1,
                });
                contexts = [record];
            }
            let target = contexts.at(-1);
            const dottedEmotion = /^current_mind\.emotions\.(name|intensity|cause)$/u.exec(assignment[1]);
            if (dottedEmotion) {
                const tokens = pathTokens('current_mind.emotions', lineNumber);
                const { parent, finalToken } = descendForWrite(target, tokens, lineNumber);
                let reopenedNull = false;
                if (!Object.hasOwn(parent, finalToken)) parent[finalToken] = [];
                else if (parent[finalToken] === null) {
                    parent[finalToken] = [];
                    reopenedNull = true;
                }
                if (!Array.isArray(parent[finalToken])) {
                    throw dslError(lineNumber, 'dotted emotion fields require current_mind.emotions to be a list.');
                }
                const field = dottedEmotion[1];
                let emotion = parent[finalToken].at(-1);
                if (!emotion || (field === 'name' && Object.hasOwn(emotion, 'name'))) {
                    emotion = {};
                    parent[finalToken].push(emotion);
                }
                if (Object.hasOwn(emotion, field)) {
                    throw dslError(lineNumber, `emotion field "${field}" is assigned twice before the next emotion name.`);
                }
                emotion[field] = parseScalar(assignment[3], lineNumber);
                if (reopenedNull) {
                    diagnostics.push({ code: 'null_list_reopened', lineNumber, path: 'current_mind.emotions' });
                }
                if (field === 'name' || Object.keys(emotion).length === 1) {
                    diagnostics.push({ code: 'dotted_emotion_item_normalized', lineNumber });
                }
                lastAppend = null;
                continue;
            }
            if (assignment[1] === 'current_mind.emotions' && assignment[2] === '=') {
                const tuple = assignment[3].split('|');
                if (tuple.length >= 3 && tuple[0].trim() && tuple[1].trim() && tuple.slice(2).join('|').trim()) {
                    const appended = appendMap(target, assignment[1], lineNumber);
                    if (appended.reopenedNull) {
                        diagnostics.push({ code: 'null_list_reopened', lineNumber, path: assignment[1] });
                    }
                    appended.item.name = decodedHeaderValue(tuple[0], lineNumber);
                    appended.item.intensity = decodedHeaderValue(tuple[1], lineNumber);
                    appended.item.cause = decodedHeaderValue(tuple.slice(2).join('|'), lineNumber);
                    diagnostics.push({ code: 'emotion_tuple_normalized', lineNumber });
                    lastAppend = null;
                    continue;
                }
            }
            const implicitIdentity = assignment[2] === '='
                && /^(?:key|target|name)$/u.test(assignment[1])
                && Object.hasOwn(target, assignment[1])
                && itemParents.has(target);
            if (implicitIdentity) {
                const list = itemParents.get(target);
                const sibling = {};
                list.push(sibling);
                itemParents.set(sibling, list);
                itemPaths.set(sibling, itemPaths.get(target));
                contexts[contexts.length - 1] = sibling;
                target = sibling;
                diagnostics.push({
                    code: 'implicit_item_rollover', lineNumber, field: assignment[1],
                });
            }
            const scalarValue = parseScalar(assignment[3], lineNumber);
            let operator = assignment[2];
            if (operator === '='
                && PRIMITIVE_LIST_PATHS[task].has(assignment[1])
                && scalarValue !== null
                && typeof scalarValue !== 'object') {
                operator = '+=';
                diagnostics.push({
                    code: 'scalar_list_assignment_normalized', lineNumber, path: assignment[1],
                });
            }
            const writeResult = writeScalar(target, assignment[1], operator, scalarValue, lineNumber);
            if (writeResult.duplicateIgnored) {
                diagnostics.push({
                    code: 'duplicate_scalar_ignored', lineNumber, path: assignment[1],
                });
            }
            lastAppend = operator === '+=' ? { target, path: assignment[1] } : null;
            continue;
        }
        if (task === 'event_director') {
            if (/^NO_PROPOSAL$/iu.test(line)) {
                if (result.__proposalSeen) throw dslError(lineNumber, 'only one PROPOSAL or NO_PROPOSAL declaration is allowed.');
                result.__proposalSeen = true;
                result.proposal = null;
                continue;
            }
            const reason = /^REASON\s*=\s*(.+)$/u.exec(line);
            if (reason) {
                if (result.__reasonSeen) throw dslError(lineNumber, 'REASON is assigned twice.');
                result.__reasonSeen = true;
                result.reason = parseScalar(reason[1], lineNumber);
                if (typeof result.reason !== 'string') throw dslError(lineNumber, 'REASON must be text.');
                continue;
            }
        }
        record = openRecord(task, line, result, lineNumber);
        if (!record) throw dslError(lineNumber, `unknown record declaration "${line.slice(0, 120)}".`);
        contexts = [record];
        lastAppend = null;
        records++;
        if (records > MAXIMUM_RECORDS) throw dslError(lineNumber, `document exceeds ${MAXIMUM_RECORDS} records.`);
    }
    if (!done) throw new Error('The model response ended before the InnerLore DSL DONE marker.');
    if (task === 'progression') {
        if (!result.__timeSeen) throw new Error('InnerLore DSL progression output is missing its TIME record.');
        delete result.__timeSeen;
    }
    if (task === 'event_director') {
        if (!result.__proposalSeen) throw new Error('InnerLore DSL Event Director output is missing PROPOSAL or NO_PROPOSAL.');
        if (!result.__reasonSeen || !result.reason.trim()) throw new Error('InnerLore DSL Event Director output is missing REASON.');
        delete result.__proposalSeen;
        delete result.__reasonSeen;
    }
    pruneEmptyListMaps(result, diagnostics);
    if (diagnostics.length) {
        Object.defineProperty(result, DSL_PARSE_DIAGNOSTICS, {
            value: Object.freeze(diagnostics.map(item => Object.freeze({ ...item }))),
            configurable: false,
            enumerable: false,
            writable: false,
        });
    }
    return result;
}

export function outputParseDiagnostics(payload) {
    return Array.isArray(payload?.[DSL_PARSE_DIAGNOSTICS])
        ? payload[DSL_PARSE_DIAGNOSTICS].map(item => ({ ...item }))
        : [];
}

export function parseInnerLoreOutput(value, options = {}) {
    const format = normalizeOutputFormat(options.format);
    return format === OUTPUT_FORMAT_DSL
        ? parseInnerLoreDsl(value, options.task)
        : extractJsonObject(value);
}

function encodeText(value) {
    const encoded = String(value)
        .replaceAll('\\', '\\\\')
        .replaceAll('\n', '\\n')
        .replaceAll('\r', '\\r')
        .replaceAll('\t', '\\t');
    return /^(?:NULL|TRUE|FALSE|EMPTY_LIST|EMPTY_MAP|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:e[+-]?\d+)?)$/iu.test(encoded)
        || /^TEXT\s/iu.test(encoded)
        ? `TEXT ${encoded}`
        : encoded;
}

function encodeScalar(value) {
    if (value === null) return 'NULL';
    if (value === true) return 'TRUE';
    if (value === false) return 'FALSE';
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
    return encodeText(value);
}

function flattenRecord(value, lines, prefix = '') {
    for (const [key, child] of Object.entries(value || {})) {
        if (child === undefined) continue;
        const path = prefix ? `${prefix}.${key}` : key;
        if (Array.isArray(child)) {
            if (!child.length) {
                lines.push(`${path} = EMPTY_LIST`);
                continue;
            }
            if (child.every(item => item === null || typeof item !== 'object')) {
                for (const item of child) lines.push(`${path} += ${encodeScalar(item)}`);
                continue;
            }
            if (child.every(item => item && typeof item === 'object' && !Array.isArray(item))) {
                for (const item of child) {
                    lines.push(`ITEM ${path}`);
                    flattenRecord(item, lines);
                    lines.push('END');
                }
                continue;
            }
            child.forEach((item, index) => {
                if (!item || typeof item !== 'object' || Array.isArray(item)) {
                    lines.push(`${path}[${index}] = ${encodeScalar(item)}`);
                } else {
                    flattenRecord(item, lines, `${path}[${index}]`);
                }
            });
            continue;
        }
        if (child && typeof child === 'object') {
            if (!Object.keys(child).length) lines.push(`${path} = EMPTY_MAP`);
            else flattenRecord(child, lines, path);
            continue;
        }
        lines.push(`${path} = ${encodeScalar(child)}`);
    }
}

function pushRecord(lines, declaration, record, omitted = []) {
    lines.push(declaration);
    const body = Object.fromEntries(Object.entries(record || {}).filter(([key]) => !omitted.includes(key)));
    flattenRecord(body, lines);
    lines.push('END');
}

/** Serialize trusted fixtures for round-trip tests and diagnostic exports. */
export function stringifyInnerLoreDsl(payload, requestedTask) {
    const task = normalizeTask(requestedTask);
    const lines = [`INNERLORE ${TASKS[task]} 1`];
    if (task === 'curator') {
        for (const entity of Array.isArray(payload?.entities) ? payload.entities : []) {
            const type = ENTITY_TYPES.has(String(entity?.type || '').toLocaleLowerCase())
                ? String(entity.type).toLocaleUpperCase()
                : 'ENTITY';
            pushRecord(lines, `${type}${entity?.name ? ` ${encodeText(entity.name)}` : ''}`, entity, ['type', 'name']);
        }
        for (const mind of Array.isArray(payload?.minds) ? payload.minds : []) {
            pushRecord(lines, `MIND${mind?.character ? ` ${encodeText(mind.character)}` : ''}`, mind, ['character']);
        }
    } else if (task === 'progression') {
        pushRecord(lines, 'TIME', payload?.time || {});
        for (const [field, declaration] of [
            ['goals', 'GOAL'], ['processes', 'PROCESS'], ['events', 'EVENT'], ['event_evaluations', 'EVALUATION'],
        ]) {
            for (const record of Array.isArray(payload?.[field]) ? payload[field] : []) {
                pushRecord(lines, `${declaration}${record?.key ? ` ${encodeText(record.key)}` : ''}`, record, ['key']);
            }
        }
    } else {
        if (payload?.proposal) {
            pushRecord(lines, `PROPOSAL${payload.proposal.key ? ` ${encodeText(payload.proposal.key)}` : ''}`, payload.proposal, ['key']);
        } else {
            lines.push('NO_PROPOSAL');
        }
        lines.push(`REASON = ${encodeScalar(payload?.reason || 'No grounded proposal is available.')}`);
    }
    lines.push('DONE');
    return lines.join('\n');
}

function taskExample(task) {
    if (task === 'curator') {
        return `INNERLORE CURATOR 1
LOCATION Ben Tavern
importance = 72
facts += A brass bell hangs above the east door.
ITEM spatial.set
key = east_door
kind = entrance
subject = Ben Tavern
relation = entrance_at
object = east wall
statement = Ben Tavern's entrance is in its east wall.
confidence = confirmed
END
END
MIND Freesia
ITEM relationships
target = Rowan
ITEM set
key = earned_trust
kind = trust
statement = I trust his corrections more than his reassurance.
confidence = inferred
basis = story
END
END
ITEM current_mind.emotions
name = anxiety
intensity = moderate
cause = The inspection is approaching.
END
current_mind.inner_thoughts += I can still make this count.
END
DONE`;
    }
    if (task === 'progression') {
        return `INNERLORE PROGRESSION 1
TIME
elapsed.minimum_seconds = 20
elapsed.estimated_seconds = 35
elapsed.maximum_seconds = 60
confidence = 0.8
basis += One short exchange and a walk across the room.
completed_actions += Freesia crosses the room.
END
GOAL prove_them_wrong
owner = Freesia
title = Prove the gossip wrong
status = active
progress = 20
visibility = private
END
DONE`;
    }
    return `INNERLORE EVENT_DIRECTOR 1
NO_PROPOSAL
REASON = No sufficiently grounded proposal is available.
DONE`;
}

function dslFieldReference(task) {
    if (task === 'curator') {
        return `DSL FIELD REFERENCE
Entity record header: LOCATION|ITEM|CHARACTER|FACTION|ORGANIZATION|CREATURE|EVENT|CONCEPT canonical name
Entity scalar fields: identity_kind, promote_name, importance, summary, description, current_state, parent_location, status
Entity text lists using +=: aliases, keys, facts, relationships, history, unresolved, remove_facts, remove_relationships, remove_history, resolve_threads, spatial.delete
Entity map-list block: ITEM spatial.set
  fields: key, kind, subject, relation, object, statement, confidence

Mind record header: MIND canonical character name
Mind scalar fields: identity_kind, promote_name, active, clear_current_mind
Mind text list using +=: aliases
Mind map-list block: ITEM persistent_self.set
  fields: key, kind, statement, confidence, basis, optional promotion
Mind text list using +=: persistent_self.delete
Mind map-list block: ITEM voice.set
  fields: key, kind, statement, confidence, basis
Mind text list using +=: voice.delete
Mind map-list block: ITEM relationships
  fields: target, aliases += text, delete += text, remove
  nested map-list block inside it: ITEM set
    fields: key, kind, statement, confidence, basis
Current Mind scalar fields use current_mind.field = text: perception, interpretation, attention, expectation, immediate_goal, impulse, restraint, internal_conflict, intention
Current Mind text lists using +=: current_mind.relevant_memory_keys, current_mind.inner_thoughts
Current Mind emotion block: ITEM current_mind.emotions
  fields: name, intensity, cause
To clear Current Mind, use current_mind = NULL and clear_current_mind = TRUE.`;
    }
    if (task === 'progression') {
        return `DSL FIELD REFERENCE
TIME record scalar paths: elapsed.minimum_seconds, elapsed.estimated_seconds, elapsed.maximum_seconds, confidence, explicit_anchor, current_time_label
TIME text lists using +=: basis, completed_actions
TIME timeline map-list block: ITEM timeline
  fields: key, description, actor, kind, parallel_group, overlap_confirmed, overlap_evidence, duration.minimum_seconds, duration.estimated_seconds, duration.maximum_seconds, evidence

GOAL stable_key fields: owner, title, description, status, progress, visibility, source_event_key, due_in_seconds.minimum_seconds, due_in_seconds.estimated_seconds, due_in_seconds.maximum_seconds, next_step; blockers, requirements, evidence use +=
PROCESS stable_key fields: subject_type, subject_name, kind, title, description, status, stage, progress, visibility, source_event_key, due_in_seconds.minimum_seconds, due_in_seconds.estimated_seconds, due_in_seconds.maximum_seconds, outcome; conditions and evidence use +=
EVENT stable_key fields: title, kind, description, status, trigger, priority, visibility, source_event_key, requires_player_action, due_in_seconds.minimum_seconds, due_in_seconds.estimated_seconds, due_in_seconds.maximum_seconds, canon_impact; subjects and evidence use +=
EVALUATION exact_definition_key requires evaluated = TRUE and reason = text. Emit only matched condition blocks. For each matched trigger_action, cancellation, revelation, public_reveal, or resolution, use dotted fields such as trigger_action.matched = TRUE; evidence and message_indexes use +=; trigger_action also requires actor.`;
    }
    return `DSL FIELD REFERENCE
PROPOSAL stable_key scalar fields: title, description, trigger_mode, trigger_after_seconds, trigger_time_certainty, action_condition, actor_scope, actor_name, cancellation_condition, activation_visibility, reveal_after_seconds, reveal_condition, resolution_condition, consequences, priority, confidence, rationale
Required enum values: trigger_mode = any|all; trigger_time_certainty = estimated|definite; actor_scope = any|player|npc|named; activation_visibility = hidden|observable. The word public is never valid for activation_visibility. actor_name is required only with named.
A hidden proposal must include reveal_after_seconds or reveal_condition. An immediately visible proposal must use activation_visibility = observable. trigger_after_seconds and reveal_after_seconds are numeric seconds; confidence is 0..1; priority is 0..65.
PROPOSAL text list using +=: subjects
PROPOSAL source map-list block: ITEM source_refs
  fields: kind = lore|goal|process|event|npc_motive, id = exact supplied source ID
After END, emit REASON = text. For no proposal, use NO_PROPOSAL followed by REASON = text.`;
}

function replaceCanonicalOutputSchema(content, task) {
    const marker = 'OUTPUT SCHEMA';
    const start = content.indexOf(marker);
    if (start < 0) return content;
    if (task === 'event_director') {
        const suffixMarker = '\n\nOmit trigger_after_seconds';
        const suffix = content.indexOf(suffixMarker, start);
        return suffix < 0
            ? `${content.slice(0, start)}${dslFieldReference(task)}`
            : `${content.slice(0, start)}${dslFieldReference(task)}${content.slice(suffix)}`;
    }
    // Curator and progression place their canonical JSON examples at the end
    // of the system message. In DSL mode the compact field reference carries
    // the same shape without priming the model to emit braces and indexes.
    return `${content.slice(0, start)}${dslFieldReference(task)}`;
}

export function dslOutputContract(requestedTask) {
    const task = normalizeTask(requestedTask);
    const records = task === 'curator'
        ? 'Use LOCATION, ITEM, CHARACTER, FACTION, ORGANIZATION, CREATURE, EVENT, or CONCEPT for an entity record, and MIND for a private-mind record. Put the canonical entity or character name after the record word.'
        : task === 'progression'
            ? 'Use exactly one TIME record, followed by zero or more GOAL, PROCESS, EVENT, and EVALUATION records. Put each stable key after the record word.'
            : 'Use one PROPOSAL record with its stable key, or the single line NO_PROPOSAL. After it, emit exactly one top-level REASON = text line.';
    return `<INNERLORE_DSL_OUTPUT priority="hard">
Return InnerLore DSL v1, not JSON. The application parses this DSL into the canonical object shape described later and then runs the same strict local validators.

Grammar:
- First line exactly: INNERLORE ${TASKS[task]} 1
- ${records}
- Within a record, write one field per line as: path = value
- Use dotted paths for nested maps: current_mind.interpretation = text
- Append primitive list items with +=: facts += one fact
- Append a map to a list with an ITEM block. For example: ITEM spatial.set, then its fields, then END. ITEM paths are relative to their containing record or ITEM and can nest.
- Repeat the complete field name on every += line. In every ITEM block, emit its named identity field (for example key = retrieval or name = anxiety); never use an unlabeled value.
- Encode current_mind.emotions only as ITEM current_mind.emotions blocks. Never assign the emotions path to NULL, text, or pipe-delimited shorthand before those blocks.
- Numeric list indexes are accepted for compatibility but should not be used; ITEM blocks avoid counting and duplicate-index mistakes.
- Unquoted text continues to the end of its line. Escape an actual newline as \\n and a backslash as \\\\.
- Scalars TRUE, FALSE, NULL, numbers, EMPTY_LIST, and EMPTY_MAP are typed. Prefix an otherwise ambiguous string with TEXT and one space.
- Close every record with END. Close the complete document with DONE.
- Omit unchanged and optional empty fields. Do not emit braces, brackets as values, commas, quotes around values, Markdown, comments, a preamble, or trailing commentary.
${task === 'curator' ? '- The example names and record count are illustrative only. Apply the upstream selection rules and emit a separate MIND record for every eligible NPC; do not limit mind output to the example character.' : ''}

Syntax example only; never copy its fictional facts:
${taskExample(task)}
</INNERLORE_DSL_OUTPUT>`;
}

function replaceJsonDirections(content) {
    return String(content || '')
        .replaceAll('one strict JSON object', 'one InnerLore DSL v1 document')
        .replaceAll('corrected strict JSON object', 'corrected InnerLore DSL v1 document')
        .replaceAll('strict JSON patch', 'InnerLore DSL v1 patch')
        .replaceAll('strict JSON proposal', 'InnerLore DSL v1 proposal')
        .replaceAll('failed strict validation', 'failed local validation')
        .replaceAll('Return strict JSON only.', 'Return InnerLore DSL v1 only.')
        .replaceAll('Output JSON only', 'Output InnerLore DSL v1 only')
        .replaceAll('Before returning JSON', 'Before returning the DSL')
        .replaceAll('proposed JSON', 'proposed DSL data')
        .replace('OUTPUT SCHEMA', 'CANONICAL OBJECT SHAPE AFTER DSL PARSING (field reference only; do not output JSON)');
}

/** Add the DSL transport contract without changing any domain/canon rules. */
export function prepareOutputMessages(messages, options = {}) {
    const format = normalizeOutputFormat(options.format);
    if (format !== OUTPUT_FORMAT_DSL) return messages.map(message => ({ ...message }));
    const task = normalizeTask(options.task);
    let contractAdded = messages.some(message => (
        message?.role === 'system'
        && typeof message.content === 'string'
        && message.content.includes('<INNERLORE_DSL_OUTPUT')
    ));
    return messages.map(message => {
        if (!message || typeof message.content !== 'string') return { ...message };
        let content = message.content;
        if (message.role === 'system') {
            content = replaceCanonicalOutputSchema(content, task);
            content = replaceJsonDirections(content);
            if (!contractAdded) {
                content = `${dslOutputContract(task)}\n\n${content}`;
                contractAdded = true;
            }
        } else if (message.role === 'user') {
            content = content
                .replaceAll('Return one corrected strict JSON object only', 'Return one corrected InnerLore DSL v1 document only')
                .replaceAll('Return one corrected strict JSON object', 'Return one corrected InnerLore DSL v1 document')
                .replaceAll('Return the strict JSON patch now.', `Return the INNERLORE ${TASKS[task]} 1 DSL document now.`)
                .replaceAll('Return the strict JSON proposal now.', `Return the INNERLORE ${TASKS[task]} 1 DSL document now.`)
                .replaceAll('failed strict validation', 'failed local validation')
                .replaceAll('No Markdown or commentary.', 'No Markdown or commentary; end with DONE.');
        }
        return { ...message, content };
    });
}

export function structuredRequestOptions(format, jsonSchema) {
    return normalizeOutputFormat(format) === OUTPUT_FORMAT_JSON && jsonSchema
        ? { jsonSchema }
        : {};
}

export function appendDslEvaluationKeyContract(messages, format, expectedKeys = []) {
    if (normalizeOutputFormat(format) !== OUTPUT_FORMAT_DSL) return messages;
    const keys = [...new Set((Array.isArray(expectedKeys) ? expectedKeys : [])
        .map(value => String(value || '').trim())
        .filter(value => /^[a-z0-9][a-z0-9_.:-]{0,199}$/u.test(value)))];
    const contract = keys.length
        ? `<DSL_EVALUATION_KEYS priority="hard">
Emit exactly one EVALUATION record for every line below, copying only the text after "EVALUATION " as its header key. Do not shorten a key and do not add an id prefix such as "trigger:".
${keys.map(key => `EVALUATION ${key}`).join('\n')}
No other EVALUATION records are allowed.
</DSL_EVALUATION_KEYS>`
        : '<DSL_EVALUATION_KEYS priority="hard">Emit no EVALUATION records because no triggerable-event definitions were supplied.</DSL_EVALUATION_KEYS>';
    const target = messages.find(message => message?.role === 'system' && typeof message.content === 'string');
    if (target && !target.content.includes('<DSL_EVALUATION_KEYS')) target.content += `\n\n${contract}`;
    return messages;
}
