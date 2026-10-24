import { canonicalNameKey } from './core.js?v=49';
import { sendInnerLoreRequest } from './llm-client.js?v=19';
import { buildProgressionRepairMessages } from './progression-prompts.js';
import { PROGRESSION_JSON_SCHEMA } from './structured-output.js';
import {
    appendDslEvaluationKeyContract,
    appendOutputDiagnostics,
    escalateRepairSettings,
    normalizeOutputFormat,
    outputParseDiagnostics,
    parseInnerLoreOutput,
    prepareOutputMessages,
    structuredRequestOptions,
} from './output-codec.js?v=5';

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
    const diagnostics = [];
    if (expectedEventKeys.length) {
        const expected = new Set(expectedEventKeys);
        if (options.lenientAcknowledgements) reconcileAcknowledgements(payload, expectedEventKeys, diagnostics);
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
            for (const field of MATCH_FIELDS) {
                try {
                    validateMatchedCondition(evaluation, field, options);
                } catch (error) {
                    // A claimed match that cannot be grounded is worth nothing,
                    // while failing the whole pass over it costs a repair call
                    // and retries: drop the claim and keep the acknowledgement.
                    if (options.lenientMatches === false) throw error;
                    delete evaluation[field];
                    diagnostics.push({ code: 'match_downgraded', key, field, reason: String(error?.message || error).slice(0, 200) });
                }
            }
            seen.add(key);
        }
        const missing = expectedEventKeys.filter(key => !seen.has(key));
        if (missing.length) {
            throw new Error(`World Progression omitted event evaluation acknowledgement${missing.length === 1 ? '' : 's'}: ${missing.join(', ')}.`);
        }
    } else if (payload.event_evaluations.length) {
        throw new Error('World Progression returned event evaluations when no triggerable events were supplied.');
    }
    appendOutputDiagnostics(payload, diagnostics);
    return payload;
}

/**
 * Assisted profiles: a missing, duplicate, unknown or unacknowledged
 * evaluation is settled locally as "not matched" instead of through a repair
 * call that re-sends the whole prompt. Nothing here can create a match.
 */
function reconcileAcknowledgements(payload, expectedEventKeys, diagnostics) {
    const expected = new Set(expectedEventKeys);
    const seen = new Set();
    const kept = [];
    for (const evaluation of payload.event_evaluations) {
        if (!evaluation || typeof evaluation !== 'object' || Array.isArray(evaluation)) {
            diagnostics.push({ code: 'evaluation_dropped', reason: 'not an object' });
            continue;
        }
        const key = typeof evaluation.key === 'string' ? evaluation.key : '';
        if (!expected.has(key)) { diagnostics.push({ code: 'evaluation_dropped', key, reason: 'unknown key' }); continue; }
        if (seen.has(key)) { diagnostics.push({ code: 'evaluation_dropped', key, reason: 'duplicate key' }); continue; }
        if (evaluation.evaluated !== true) { evaluation.evaluated = true; diagnostics.push({ code: 'evaluation_marked_evaluated', key }); }
        if (typeof evaluation.reason !== 'string' || !evaluation.reason.trim()) {
            evaluation.reason = 'No reason given by the model.';
            diagnostics.push({ code: 'evaluation_reason_filled', key });
        }
        seen.add(key);
        kept.push(evaluation);
    }
    for (const key of expectedEventKeys) {
        if (seen.has(key)) continue;
        kept.push({ key, evaluated: true, reason: 'Not evaluated by the model; treated as not matched.' });
        diagnostics.push({ code: 'acknowledgement_filled', key });
    }
    payload.event_evaluations = kept;
}

/** A reply that already carries progression records, in DSL or JSON, is a draft the model can correct without the prompt. */
export function outputLooksLikeDraft(output) {
    const text = String(output || '');
    if (text.trim().length < 80) return false;
    return /INNERLORE\s+PROGRESSION\b/iu.test(text) || /^\s*(?:```[a-z]*\s*)?\{[\s\S]*"time"/u.test(text);
}

export async function requestProgressionPatch(settings, messages, signal, options = {}) {
    const requestSettings = progressionRequestSettings(settings);
    requestSettings.telemetryKind = 'progression';
    // A missing or malformed acknowledgement is settled locally as "not
    // matched" for every profile, not only assisted ones: a repair call for
    // an echo record is the most expensive way to learn nothing happened.
    const validationOptions = {
        discardImpossibleMatches: true,
        lenientMatches: true,
        lenientAcknowledgements: true,
        ...options,
    };
    const format = normalizeOutputFormat(settings.maintenanceOutputFormat);
    const requestMessages = appendDslEvaluationKeyContract(
        prepareOutputMessages(messages, { format, task: 'progression' }),
        format,
        validationOptions.expectedEventKeys,
    );
    const requestOptions = structuredRequestOptions(format, PROGRESSION_JSON_SCHEMA);
    const firstOutput = await sendInnerLoreRequest(requestSettings, requestMessages, signal, requestOptions);
    try {
        const parsed = parseInnerLoreOutput(firstOutput, {
            format, task: 'progression', salvageTruncated: true,
        });
        return {
            payload: validateProgressionPayload(parsed, validationOptions),
            repaired: false,
            rawLength: firstOutput.length,
            outputFormat: format,
            parseDiagnostics: outputParseDiagnostics(parsed),
        };
    } catch (firstError) {
        if (settings.repairMalformedJson === false) throw firstError;
        const repairSettings = escalateRepairSettings(requestSettings, firstError, firstOutput);
        // An output that is recognizably a progression document is repaired
        // from itself, the way the curator's is; the full source prompt (the
        // passage, every record and definition, often 25k+ tokens) goes along
        // only when the output is not usable as a draft at all.
        const repairMessages = buildProgressionRepairMessages(firstOutput, {
            ...validationOptions,
            sourceMessages: outputLooksLikeDraft(firstOutput) ? [] : requestMessages,
        });
        repairMessages.at(-1).content += ` The local parser or validator error was: ${String(firstError?.message || firstError).slice(0, 1_000)}`;
        const preparedRepairMessages = prepareOutputMessages(repairMessages, { format, task: 'progression' });
        const repairOutput = await sendInnerLoreRequest(
            repairSettings,
            preparedRepairMessages,
            signal,
            requestOptions,
        );
        const parsed = parseInnerLoreOutput(repairOutput, {
            format, task: 'progression', salvageTruncated: true,
        });
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
