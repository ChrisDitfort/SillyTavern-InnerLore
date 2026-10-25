import { sendInnerLoreRequest } from './llm-client.js?v=21';
import { validateEventDirectorPayload } from './event-director.js?v=4';
import { buildEventDirectorRepairMessages } from './event-director-prompts.js';
import { EVENT_DIRECTOR_JSON_SCHEMA } from './structured-output.js';
import {
    escalateRepairSettings,
    normalizeOutputFormat,
    outputParseDiagnostics,
    parseInnerLoreOutput,
    prepareOutputMessages,
    structuredRequestOptions,
} from './output-codec.js?v=7';

function requestSettings(settings) {
    return {
        ...settings,
        connectionProfileId: settings.progressionConnectionProfileId || settings.connectionProfileId,
        fallbackConnectionProfileId: settings.progressionFallbackConnectionProfileId
            || settings.fallbackConnectionProfileId
            || '',
        maximumResponseTokens: Math.min(4_000, Math.max(1_200, Number(settings.progressionMaximumResponseTokens) || 2_000)),
        requestTimeoutSeconds: settings.progressionRequestTimeoutSeconds ?? 90,
        temperature: Math.min(0.35, Math.max(0, Number(settings.progressionTemperature) || 0.1)),
    };
}

const DECLINED_CODES = new Set(['low_confidence', 'duplicate']);

export async function requestEventDirectorProposal(settings, messages, signal, validationOptions = {}) {
    const configured = requestSettings(settings);
    const format = normalizeOutputFormat(settings.maintenanceOutputFormat);
    const requestMessages = prepareOutputMessages(messages, { format, task: 'event_director' });
    const requestOptions = structuredRequestOptions(format, EVENT_DIRECTOR_JSON_SCHEMA);
    const firstOutput = await sendInnerLoreRequest(
        configured, requestMessages, signal, requestOptions,
    );
    try {
        const parsed = parseInnerLoreOutput(firstOutput, {
            format, task: 'event_director', salvageTruncated: true,
        });
        return {
            ...validateEventDirectorPayload(parsed, validationOptions),
            repaired: false,
            rawLength: firstOutput.length,
            outputFormat: format,
            parseDiagnostics: outputParseDiagnostics(parsed),
        };
    } catch (firstError) {
        // The model answered properly but the answer is not worth arming: too
        // little confidence, or an event the world already has. That is a
        // "no proposal" result, not a malformed one; a repair call would only
        // ask the model to say the same thing again.
        if (DECLINED_CODES.has(firstError?.code)) {
            return {
                proposal: null,
                reason: firstError.message || String(firstError),
                declined: firstError.code,
                repaired: false,
                rawLength: firstOutput.length,
                outputFormat: format,
                parseDiagnostics: [{ code: `declined_${firstError.code}` }],
            };
        }
        if (settings.repairMalformedJson === false) throw firstError;
        const repairSettings = escalateRepairSettings(configured, firstError, firstOutput);
        const repairMessages = buildEventDirectorRepairMessages(firstOutput, {
            sourceMessages: requestMessages,
            validationError: firstError.message || String(firstError),
        });
        const preparedRepairMessages = prepareOutputMessages(repairMessages, { format, task: 'event_director' });
        const repairOutput = await sendInnerLoreRequest(
            repairSettings,
            preparedRepairMessages,
            signal,
            requestOptions,
        );
        const parsed = parseInnerLoreOutput(repairOutput, {
            format, task: 'event_director', salvageTruncated: true,
        });
        return {
            ...validateEventDirectorPayload(parsed, validationOptions),
            repaired: true,
            rawLength: repairOutput.length,
            outputFormat: format,
            firstError: firstError?.message || String(firstError),
            parseDiagnostics: outputParseDiagnostics(parsed),
        };
    }
}
