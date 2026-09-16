import { sendInnerLoreRequest } from './llm-client.js?v=7';
import { validateEventDirectorPayload } from './event-director.js';
import { buildEventDirectorRepairMessages } from './event-director-prompts.js';
import { EVENT_DIRECTOR_JSON_SCHEMA } from './structured-output.js';
import {
    normalizeOutputFormat,
    outputParseDiagnostics,
    parseInnerLoreOutput,
    prepareOutputMessages,
    structuredRequestOptions,
} from './output-codec.js';

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

export async function requestEventDirectorProposal(settings, messages, signal, validationOptions = {}) {
    const configured = requestSettings(settings);
    const format = normalizeOutputFormat(settings.maintenanceOutputFormat);
    const requestMessages = prepareOutputMessages(messages, { format, task: 'event_director' });
    const requestOptions = structuredRequestOptions(format, EVENT_DIRECTOR_JSON_SCHEMA);
    const firstOutput = await sendInnerLoreRequest(
        configured, requestMessages, signal, requestOptions,
    );
    try {
        const parsed = parseInnerLoreOutput(firstOutput, { format, task: 'event_director' });
        return {
            ...validateEventDirectorPayload(parsed, validationOptions),
            repaired: false,
            rawLength: firstOutput.length,
            outputFormat: format,
            parseDiagnostics: outputParseDiagnostics(parsed),
        };
    } catch (firstError) {
        if (settings.repairMalformedJson === false) throw firstError;
        const repairMessages = buildEventDirectorRepairMessages(firstOutput, {
            sourceMessages: requestMessages,
            validationError: firstError.message || String(firstError),
        });
        const preparedRepairMessages = prepareOutputMessages(repairMessages, { format, task: 'event_director' });
        const repairOutput = await sendInnerLoreRequest(
            configured,
            preparedRepairMessages,
            signal,
            requestOptions,
        );
        const parsed = parseInnerLoreOutput(repairOutput, { format, task: 'event_director' });
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
