import { sendInnerLoreRequest } from './llm-client.js?v=21';
import { buildGameRepairMessages } from './game-prompts.js?v=7';
import {
    escalateRepairSettings,
    normalizeOutputFormat,
    outputParseDiagnostics,
    parseInnerLoreOutput,
    prepareOutputMessages,
} from './output-codec.js?v=7';

const LIST_FIELDS = Object.freeze({
    game: ['objects', 'money', 'prices', 'standings', 'reputation', 'deaths', 'abilities', 'contacts', 'links'],
    planner: ['stages', 'people', 'objects', 'prices', 'abilities'],
    abilities: ['abilities', 'contacts'],
});
const LIST_LIMITS = Object.freeze({
    objects: 60, money: 30, prices: 40, standings: 30, reputation: 20, deaths: 10, stages: 4, people: 16, abilities: 20, contacts: 20, links: 10,
});
const TASK_LABELS = Object.freeze({ game: 'Game Ledger', planner: 'Scene Planner', abilities: 'Ability Judge' });

/**
 * Settings for one game request. The ledger rides on the curator's
 * profile and the planner on the progression profile unless either has its own.
 */
export function gameRequestSettings(settings, task) {
    if (task === 'abilities') {
        // The judge weighs a few facts and answers briefly: the ledger's model, a little warmer.
        return {
            ...settings,
            connectionProfileId: settings.gameConnectionProfileId || settings.connectionProfileId,
            maximumResponseTokens: 1_500,
            temperature: 0.2,
            telemetryKind: 'judge',
        };
    }
    if (task === 'planner') {
        return {
            ...settings,
            connectionProfileId: settings.plannerConnectionProfileId
                || settings.progressionConnectionProfileId
                || settings.connectionProfileId,
            fallbackConnectionProfileId: settings.progressionFallbackConnectionProfileId
                || settings.fallbackConnectionProfileId
                || '',
            maximumResponseTokens: settings.plannerMaximumResponseTokens ?? 6_000,
            requestTimeoutSeconds: settings.plannerRequestTimeoutSeconds ?? settings.progressionRequestTimeoutSeconds ?? 120,
            // Inventing people and places wants more variety than bookkeeping.
            temperature: settings.plannerTemperature ?? 0.7,
            telemetryKind: 'planner',
        };
    }
    return {
        ...settings,
        connectionProfileId: settings.gameConnectionProfileId || settings.connectionProfileId,
        maximumResponseTokens: settings.gameMaximumResponseTokens ?? 4_000,
        temperature: settings.gameTemperature ?? 0.1,
        telemetryKind: 'game',
    };
}

/**
 * The planner's STAGE record used to be a required echo of each place name;
 * the code knows the places, so a PERSON, OBJECT or PRICE that names its
 * place in `location` is enough. A record with no location at all takes the
 * only planned place when there is exactly one.
 */
function synthesizePlannerStages(payload, places = []) {
    const planned = (Array.isArray(places) ? places : []).map(place => String(place || '').trim()).filter(Boolean);
    const known = new Map(payload.stages.map(stage => [String(stage?.place || '').trim().toLocaleLowerCase(), stage]));
    const placeOf = record => String(record?.location || record?.place_name || '').trim();
    const records = [
        ...payload.people,
        ...payload.objects.filter(object => object?.holder !== 'player'),
        ...payload.prices,
    ];
    for (const record of records) {
        if (!placeOf(record) && planned.length === 1) record.location = planned[0];
        const place = placeOf(record);
        if (!place) continue;
        const key = place.toLocaleLowerCase();
        if (known.has(key)) continue;
        const stage = { place, summary: '', hooks: [], synthesized: true };
        payload.stages.push(stage);
        known.set(key, stage);
    }
}

/** Shape check: lists are lists, records are objects, sizes are bounded. */
export function validateGamePayload(payload, task, options = {}) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
        throw new Error(`InnerLore ${TASK_LABELS[task] || 'Game Ledger'} returned a non-object value.`);
    }
    for (const field of LIST_FIELDS[task]) {
        const value = payload[field];
        if (value === undefined || value === null
            || (typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 0)) {
            payload[field] = [];
        }
        if (!Array.isArray(payload[field])) throw new Error(`Game response field "${field}" must be a list.`);
        if (payload[field].some(record => !record || typeof record !== 'object' || Array.isArray(record))) {
            throw new Error(`Game response field "${field}" must hold records.`);
        }
        payload[field] = payload[field].slice(0, LIST_LIMITS[field] || 40);
    }
    for (const field of ['currency', 'purse', 'device']) {
        if (payload[field] !== undefined && payload[field] !== null
            && (typeof payload[field] !== 'object' || Array.isArray(payload[field]))) {
            throw new Error(`Game response field "${field}" must be a record.`);
        }
    }
    if (task === 'planner') {
        synthesizePlannerStages(payload, options.places);
        if (!payload.stages.length && (payload.people.length || payload.objects.some(object => object.holder !== 'player'))) {
            throw new Error('Scene Planner prepared people or objects without a place: give each a location.');
        }
    }
    return payload;
}

/** Send one ledger or planner request, parse it, and repair it once if needed. */
export async function requestGamePatch(settings, messages, signal, task = 'game', options = {}) {
    const requestSettings = gameRequestSettings(settings, task);
    const format = normalizeOutputFormat(settings.maintenanceOutputFormat);
    const requestMessages = prepareOutputMessages(messages, { format, task });
    const firstOutput = await sendInnerLoreRequest(requestSettings, requestMessages, signal);
    try {
        const parsed = parseInnerLoreOutput(firstOutput, { format, task, salvageTruncated: true });
        return {
            payload: validateGamePayload(parsed, task, options),
            repaired: false,
            rawLength: firstOutput.length,
            outputFormat: format,
            parseDiagnostics: outputParseDiagnostics(parsed),
        };
    } catch (firstError) {
        if (settings.repairMalformedJson === false) throw firstError;
        const repairSettings = escalateRepairSettings(requestSettings, firstError, firstOutput);
        const repairMessages = buildGameRepairMessages(firstOutput, task);
        repairMessages[0].content += ` The local parser or validator error was: ${String(firstError?.message || firstError).slice(0, 1_000)}`;
        const repairOutput = await sendInnerLoreRequest(
            repairSettings,
            prepareOutputMessages(repairMessages, { format, task }),
            signal,
        );
        const parsed = parseInnerLoreOutput(repairOutput, { format, task, salvageTruncated: true });
        return {
            payload: validateGamePayload(parsed, task, options),
            repaired: true,
            rawLength: repairOutput.length,
            outputFormat: format,
            firstError: firstError?.message || String(firstError),
            parseDiagnostics: outputParseDiagnostics(parsed),
        };
    }
}
