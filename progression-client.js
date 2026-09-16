import { canonicalNameKey } from './core.js';
import { sendInnerLoreRequest } from './llm-client.js?v=7';
import { buildProgressionRepairMessages } from './progression-prompts.js';
import { PROGRESSION_JSON_SCHEMA } from './structured-output.js';
import {
    appendDslEvaluationKeyContract,
    normalizeOutputFormat,
    outputParseDiagnostics,
    parseInnerLoreOutput,
    prepareOutputMessages,
    structuredRequestOptions,
} from './output-codec.js';

function progressionRequestSettings(settings) {
    const dedicatedProfile = settings.progressionConnectionProfileId || settings.connectionProfileId;
    return {
        ...settings,
        connectionProfileId: dedicatedProfile,
        fallbackConnectionProfileId: settings.progressionFallbackConnectionProfileId
            || settings.fallbackConnectionProfileId
            || '',
        maximumResponseTokens: settings.progressionMaximumResponseTokens ?? 10_000,
        requestTimeoutSeconds: settings.progressionRequestTimeoutSeconds ?? 90,
        temperature: settings.progressionTemperature ?? 0.1,
    };
}

const MATCH_FIELDS = ['trigger_action', 'cancellation', 'revelation', 'public_reveal', 'resolution'];

function discardImpossibleConfiguredMatches(evaluation, options = {}) {
    if (options.discardImpossibleMatches !== true) return;
    for (const field of MATCH_FIELDS) {
        // Explicit matched:false is equivalent to the required omission. It
        // carries no authority and is safe to normalize before strict checks.
        if (Object.hasOwn(evaluation, field) && evaluation[field]?.matched !== true) delete evaluation[field];
    }
    const contract = options.expectedEventContracts?.[evaluation?.key];
    if (!contract) return;
    const configured = {
        trigger_action: contract.actionCondition,
        cancellation: contract.cancellationCondition,
        revelation: contract.revealCondition,
        resolution: contract.resolutionCondition,
    };
    for (const [field, condition] of Object.entries(configured)) {
        // These fields are definition-specific predicates. A provider can
        // occasionally use one as a generic label for the event's own
        // delivery; dropping that impossible claim is safer than losing every
        // otherwise valid acknowledgement in the progression pass.
        if (!condition && Object.hasOwn(evaluation, field)) delete evaluation[field];
    }
}

function validateMatchedCondition(evaluation, field, options = {}) {
    const condition = evaluation[field];
    if (condition === undefined) return;
    if (!condition || typeof condition !== 'object' || Array.isArray(condition)) {
        throw new Error(`World Progression event evaluation "${evaluation.key}" field "${field}" must be an object.`);
    }
    if (condition.matched !== true) {
        throw new Error(`World Progression event evaluation "${evaluation.key}" included "${field}" without matched:true.`);
    }
    if (!Array.isArray(condition.evidence) || !condition.evidence.some(item => typeof item === 'string' && item.trim())) {
        throw new Error(`World Progression event evaluation "${evaluation.key}" matched "${field}" without evidence.`);
    }
    if (!Array.isArray(condition.message_indexes)
        || !condition.message_indexes.length
        || !condition.message_indexes.every(Number.isInteger)) {
        throw new Error(`World Progression event evaluation "${evaluation.key}" matched "${field}" without integer message_indexes.`);
    }
    const contract = options.expectedEventContracts?.[evaluation.key];
    const minimumIndex = Math.max(
        Number.isInteger(options.passageStartIndex) ? options.passageStartIndex : Number.MIN_SAFE_INTEGER,
        Number.isInteger(contract?.createdAtMessage) ? contract.createdAtMessage + 1 : Number.MIN_SAFE_INTEGER,
    );
    const maximumIndex = Number.isInteger(options.passageEndIndex)
        ? options.passageEndIndex
        : Number.MAX_SAFE_INTEGER;
    if (!condition.message_indexes.every(index => index >= minimumIndex && index <= maximumIndex)) {
        throw new Error(`World Progression event evaluation "${evaluation.key}" matched "${field}" outside the eligible message range ${minimumIndex}–${maximumIndex}.`);
    }
    if (field === 'trigger_action' && (typeof condition.actor !== 'string' || !condition.actor.trim())) {
        throw new Error(`World Progression event evaluation "${evaluation.key}" matched trigger_action without an actor.`);
    }
    if (field === 'trigger_action' && contract) {
        if (!contract.actionCondition) {
            throw new Error(`World Progression event evaluation "${evaluation.key}" matched trigger_action without a configured action condition.`);
        }
        const actor = canonicalNameKey(condition.actor);
        const player = canonicalNameKey(options.playerName);
        const named = canonicalNameKey(contract.actorName);
        const actorAccepted = contract.actorScope === 'player'
            ? Boolean(player && actor === player)
            : contract.actorScope === 'npc'
                ? Boolean(actor && (!player || actor !== player))
                : contract.actorScope === 'named'
                    ? Boolean(named && actor === named)
                    : Boolean(actor);
        if (!actorAccepted) {
            throw new Error(`World Progression event evaluation "${evaluation.key}" attributed trigger_action to an ineligible actor.`);
        }
    }
    const configuredCondition = {
        cancellation: 'cancellationCondition',
        revelation: 'revealCondition',
        resolution: 'resolutionCondition',
    }[field];
    if (contract && configuredCondition && !contract[configuredCondition]) {
        throw new Error(`World Progression event evaluation "${evaluation.key}" matched "${field}" without that configured condition.`);
    }
}

export function validateProgressionPayload(payload, options = {}) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
        throw new Error('World Progression Engine returned a non-object JSON value.');
    }
    if (!payload.time || typeof payload.time !== 'object') {
        throw new Error('World Progression Engine response is missing the time object.');
    }
    for (const key of ['goals', 'processes', 'events']) {
        const value = payload[key];
        // A few otherwise compatible providers serialize an empty/no-op
        // collection as null, an omitted field, or {}. Normalizing only those
        // semantically empty shapes is fail-closed: no mutation is created,
        // while any populated non-array remains invalid.
        if (value === undefined || value === null
            || (typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 0)) {
            payload[key] = [];
        }
        if (!Array.isArray(payload[key])) throw new Error(`World Progression Engine response field "${key}" must be an array.`);
    }
    // Older compatible profiles may omit this when no editor definitions are
    // active. Normalize it instead of spending a repair call on an empty list.
    if (payload.event_evaluations === undefined) payload.event_evaluations = [];
    if (!Array.isArray(payload.event_evaluations)) {
        throw new Error('World Progression Engine response field "event_evaluations" must be an array.');
    }
    const expectedEventKeys = [...new Set((Array.isArray(options.expectedEventKeys) ? options.expectedEventKeys : [])
        .filter(key => typeof key === 'string' && key))];
    if (expectedEventKeys.length) {
        const expected = new Set(expectedEventKeys);
        const seen = new Set();
        for (const evaluation of payload.event_evaluations) {
            if (!evaluation || typeof evaluation !== 'object' || Array.isArray(evaluation)) {
                throw new Error('World Progression event evaluations must be objects.');
            }
            const key = typeof evaluation.key === 'string' ? evaluation.key : '';
            if (!expected.has(key)) {
                throw new Error(`World Progression returned an unknown event evaluation key "${key || '(missing)'}".`);
            }
            if (seen.has(key)) throw new Error(`World Progression returned duplicate event evaluation key "${key}".`);
            if (evaluation.evaluated !== true) {
                throw new Error(`World Progression did not acknowledge event "${key}" with evaluated:true.`);
            }
            if (typeof evaluation.reason !== 'string' || !evaluation.reason.trim()) {
                throw new Error(`World Progression event evaluation "${key}" is missing its reason.`);
            }
            discardImpossibleConfiguredMatches(evaluation, options);
            for (const field of MATCH_FIELDS) validateMatchedCondition(evaluation, field, options);
            seen.add(key);
        }
        const missing = expectedEventKeys.filter(key => !seen.has(key));
        if (missing.length) {
            throw new Error(`World Progression omitted event evaluation acknowledgement${missing.length === 1 ? '' : 's'}: ${missing.join(', ')}.`);
        }
    } else if (payload.event_evaluations.length) {
        throw new Error('World Progression returned event evaluations when no triggerable events were supplied.');
    }
    return payload;
}

export async function requestProgressionPatch(settings, messages, signal, options = {}) {
    const requestSettings = progressionRequestSettings(settings);
    const validationOptions = { discardImpossibleMatches: true, ...options };
    const format = normalizeOutputFormat(settings.maintenanceOutputFormat);
    const requestMessages = appendDslEvaluationKeyContract(
        prepareOutputMessages(messages, { format, task: 'progression' }),
        format,
        validationOptions.expectedEventKeys,
    );
    const requestOptions = structuredRequestOptions(format, PROGRESSION_JSON_SCHEMA);
    const firstOutput = await sendInnerLoreRequest(requestSettings, requestMessages, signal, requestOptions);
    try {
        const parsed = parseInnerLoreOutput(firstOutput, { format, task: 'progression' });
        return {
            payload: validateProgressionPayload(parsed, validationOptions),
            repaired: false,
            rawLength: firstOutput.length,
            outputFormat: format,
            parseDiagnostics: outputParseDiagnostics(parsed),
        };
    } catch (firstError) {
        if (settings.repairMalformedJson === false) throw firstError;
        const repairMessages = buildProgressionRepairMessages(firstOutput, {
            ...validationOptions,
            sourceMessages: requestMessages,
        });
        repairMessages.at(-1).content += ` The local parser or validator error was: ${String(firstError?.message || firstError).slice(0, 1_000)}`;
        const preparedRepairMessages = prepareOutputMessages(repairMessages, { format, task: 'progression' });
        const repairOutput = await sendInnerLoreRequest(
            requestSettings,
            preparedRepairMessages,
            signal,
            requestOptions,
        );
        const parsed = parseInnerLoreOutput(repairOutput, { format, task: 'progression' });
        return {
            payload: validateProgressionPayload(parsed, validationOptions),
            repaired: true,
            rawLength: repairOutput.length,
            outputFormat: format,
            firstError: firstError?.message || String(firstError),
            parseDiagnostics: outputParseDiagnostics(parsed),
        };
    }
}

export async function testProgressionConnection(settings) {
    const format = normalizeOutputFormat(settings.maintenanceOutputFormat);
    const messages = prepareOutputMessages([
        { role: 'system', content: 'Return strict JSON only.' },
        {
            role: 'user',
            content: 'Return exactly: {"time":{"elapsed":{"minimum_seconds":0,"estimated_seconds":0,"maximum_seconds":0},"confidence":1,"basis":[],"completed_actions":[]},"goals":[],"processes":[],"events":[],"event_evaluations":[]}',
        },
    ], { format, task: 'progression' });
    if (format === 'dsl') {
        messages[1].content = 'Return exactly:\nINNERLORE PROGRESSION 1\nTIME\nelapsed.minimum_seconds = 0\nelapsed.estimated_seconds = 0\nelapsed.maximum_seconds = 0\nconfidence = 1\nbasis = EMPTY_LIST\ncompleted_actions = EMPTY_LIST\nEND\nDONE';
    }
    const output = await sendInnerLoreRequest(
        progressionRequestSettings(settings), messages, undefined,
        structuredRequestOptions(format, PROGRESSION_JSON_SCHEMA),
    );
    validateProgressionPayload(parseInnerLoreOutput(output, { format, task: 'progression' }));
    return true;
}
