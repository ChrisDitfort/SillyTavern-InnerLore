import { cleanString } from './core.js';
import { buildRepairMessages } from './prompts.js';
import { CURATOR_JSON_SCHEMA } from './structured-output.js';
import {
    OUTPUT_FORMAT_DSL,
    escalateRepairSettings,
    normalizeOutputFormat,
    outputParseDiagnostics,
    parseInnerLoreOutput,
    prepareOutputMessages,
    structuredRequestOptions,
} from './output-codec.js';

function context() {
    return SillyTavern.getContext();
}

export function listConnectionProfiles() {
    const ctx = context();
    const profiles = ctx.extensionSettings?.connectionManager?.profiles;
    if (!Array.isArray(profiles)) return [];
    try {
        const supported = ctx.ConnectionManagerRequestService?.getSupportedProfiles?.();
        if (Array.isArray(supported)) return supported;
    } catch (error) {
        console.warn('[InnerLore] Could not filter supported connection profiles:', error);
    }
    return profiles.filter(profile => profile?.id && profile?.name);
}

export function chooseDefaultProfileId(currentId = '') {
    const profiles = listConnectionProfiles();
    if (currentId && profiles.some(profile => profile.id === currentId)) return currentId;

    const extensionSettings = context().extensionSettings || {};
    const summaryceptionId = extensionSettings.summaryception?.connectionProfileId;
    if (summaryceptionId && profiles.some(profile => profile.id === summaryceptionId)) return summaryceptionId;

    const preferred = profiles.find(profile => /mimo.*summary|summary.*mimo/i.test(profile.name))
        || profiles.find(profile => /summary/i.test(profile.name));
    if (preferred) return preferred.id;

    const selected = extensionSettings.connectionManager?.selectedProfile;
    if (selected && profiles.some(profile => profile.id === selected)) return selected;
    return profiles[0]?.id || '';
}

function textFromContent(content) {
    if (typeof content === 'string') return content;
    if (!Array.isArray(content)) return '';
    return content
        .map(part => typeof part === 'string' ? part : (part?.text || part?.content || ''))
        .filter(Boolean)
        .join('\n');
}

export function extractResponseText(raw) {
    if (typeof raw === 'string') return raw;
    const finalCandidates = [
        raw?.content,
        raw?.message?.content,
        raw?.choices?.[0]?.message?.content,
        raw?.choices?.[0]?.text,
        raw?.data?.content,
        raw?.data?.message?.content,
        raw?.response,
        raw?.text,
    ];
    for (const candidate of finalCandidates) {
        const text = textFromContent(candidate);
        if (text.trim()) return text;
    }

    // Some reasoning variants place their only usable structured result in the
    // reasoning channel. This is a fallback only: ordinary final content always
    // wins, and requestJsonPatch still applies strict JSON/schema validation.
    const reasoningCandidates = [
        raw?.reasoning,
        raw?.reasoning_content,
        raw?.message?.reasoning,
        raw?.message?.reasoning_content,
        raw?.choices?.[0]?.message?.reasoning,
        raw?.choices?.[0]?.message?.reasoning_content,
        raw?.data?.reasoning,
        raw?.data?.message?.reasoning,
    ];
    for (const candidate of reasoningCandidates) {
        const text = textFromContent(candidate);
        if (text.trim()) return text;
    }
    return '';
}

async function sendViaProfile(settings, messages, signal, options = {}) {
    const ctx = context();
    const service = ctx.ConnectionManagerRequestService;
    if (!service?.sendRequest) {
        throw new Error('SillyTavern Connection Manager request service is unavailable.');
    }
    const profileId = settings.connectionProfileId;
    if (!profileId) throw new Error('Select an InnerLore connection profile first.');
    if (!listConnectionProfiles().some(profile => profile.id === profileId)) {
        throw new Error('The selected InnerLore connection profile no longer exists or is unsupported.');
    }

    const maximumTokens = Math.max(800, Math.min(32_000, Number(settings.maximumResponseTokens) || 6_000));
    const raw = await service.sendRequest(
        profileId,
        messages,
        maximumTokens,
        {
            // Streaming keeps bytes flowing, which mobile/proxy links between the
            // browser and SillyTavern require: silent non-streaming requests are
            // dropped after ~60s, while reasoning models regularly need longer.
            stream: true,
            signal,
            extractData: true,
            // Apply the selected profile's generation preset so reasoning and
            // provider routing match that profile. The explicit values below
            // still keep InnerLore's JSON temperature and token budget.
            includePreset: true,
            includeInstruct: false,
        },
        {
            temperature: Number(settings.temperature) || 0.15,
            top_p: 0.9,
            max_tokens: maximumTokens,
            include_reasoning: false,
            ...(options.jsonSchema ? { json_schema: options.jsonSchema } : {}),
        },
    );
    if (typeof raw === 'function') {
        // Streaming response: an async generator whose chunks carry the
        // accumulated text. Only the final chunk's values are meaningful here.
        let text = '';
        let reasoning = '';
        for await (const chunk of raw()) {
            if (typeof chunk?.text === 'string' && chunk.text) text = chunk.text;
            if (typeof chunk?.state?.reasoning === 'string' && chunk.state.reasoning) reasoning = chunk.state.reasoning;
        }
        const streamed = text.trim() ? text : reasoning;
        if (!streamed.trim()) throw new Error('The selected connection profile returned no visible text.');
        return streamed;
    }
    const text = extractResponseText(raw);
    if (!text.trim()) throw new Error('The selected connection profile returned no visible text.');
    return text;
}

async function sendViaActiveConnection(settings, messages, signal, options = {}) {
    const generateRaw = context().generateRaw;
    if (typeof generateRaw !== 'function') throw new Error('SillyTavern generateRaw() is unavailable.');
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

    const systemPrompt = messages
        .filter(message => message.role === 'system')
        .map(message => message.content)
        .join('\n\n');
    const prompt = messages
        .filter(message => message.role !== 'system')
        .map(message => `${message.role.toUpperCase()}:\n${message.content}`)
        .join('\n\n');
    const maximumTokens = Math.max(800, Math.min(32_000, Number(settings.maximumResponseTokens) || 6_000));

    let raw;
    if (generateRaw.length <= 1) {
        raw = await generateRaw({
            prompt,
            systemPrompt,
            responseLength: maximumTokens,
            signal,
            ...(options.jsonSchema ? { jsonSchema: options.jsonSchema } : {}),
        });
    } else {
        raw = await generateRaw(prompt, systemPrompt);
    }
    const text = extractResponseText(raw);
    if (!text.trim()) throw new Error('The active SillyTavern connection returned no visible text.');
    return text;
}

function abortError() {
    const error = new Error('InnerLore model request was cancelled.');
    error.name = 'AbortError';
    return error;
}

function timeoutError(milliseconds) {
    const seconds = Math.max(0.001, milliseconds / 1_000);
    const error = new Error(`InnerLore model request timed out after ${Number(seconds.toFixed(3))} seconds.`);
    error.name = 'TimeoutError';
    return error;
}

export async function withRequestTimeout(callback, externalSignal, timeoutMilliseconds) {
    if (externalSignal?.aborted) throw abortError();
    const milliseconds = Math.max(1, Number(timeoutMilliseconds) || 1);
    const controller = new AbortController();
    let timer;
    let onExternalAbort;
    let timedOut = false;

    const guard = new Promise((resolve, reject) => {
        timer = setTimeout(() => {
            timedOut = true;
            controller.abort();
            reject(timeoutError(milliseconds));
        }, milliseconds);
        if (externalSignal) {
            onExternalAbort = () => {
                controller.abort();
                reject(abortError());
            };
            externalSignal.addEventListener('abort', onExternalAbort, { once: true });
        }
    });

    try {
        return await Promise.race([
            Promise.resolve().then(() => callback(controller.signal)),
            guard,
        ]);
    } catch (error) {
        if (timedOut && !externalSignal?.aborted) throw timeoutError(milliseconds);
        throw error;
    } finally {
        clearTimeout(timer);
        externalSignal?.removeEventListener?.('abort', onExternalAbort);
    }
}

function waitForRetry(milliseconds, signal) {
    if (signal?.aborted) return Promise.reject(abortError());
    return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
            signal?.removeEventListener?.('abort', onAbort);
            resolve();
        }, milliseconds);
        const onAbort = () => {
            clearTimeout(timeout);
            reject(abortError());
        };
        signal?.addEventListener?.('abort', onAbort, { once: true });
    });
}

export function isTransientRequestError(error) {
    const message = `${error?.message || ''} ${error?.cause?.message || ''}`.toLowerCase();
    return [
        'no visible text',
        'empty response',
        'network',
        'failed to fetch',
        'fetch failed',
        'timeout',
        'timed out',
        'rate limit',
        'too many requests',
        '429',
        '500',
        '502',
        '503',
        '504',
        'econnreset',
        'econnrefused',
        'socket hang up',
        'stream error',
        'h2 protocol error',
        'error reading a body',
        'upstream error',
        'service unavailable',
        'temporarily unavailable',
    ].some(fragment => message.includes(fragment));
}

export function connectionFallbackProfileIds(settings = {}) {
    const primary = cleanString(settings.connectionProfileId, 240);
    const configured = [
        settings.fallbackConnectionProfileId,
        ...(Array.isArray(settings.fallbackConnectionProfileIds) ? settings.fallbackConnectionProfileIds : []),
    ]
        .map(value => cleanString(value, 240))
        .filter(Boolean)
        .filter((value, index, values) => value !== primary && values.indexOf(value) === index);
    return configured;
}

export async function sendInnerLoreRequest(settings, messages, signal, options = {}) {
    const maximumAttempts = Math.max(1, Math.min(3, Number(settings.requestMaximumAttempts) || 3));
    const fallbackMaximumAttempts = Math.max(1, Math.min(2, Number(settings.fallbackRequestMaximumAttempts) || 1));
    const timeoutMilliseconds = Math.max(15_000, Math.min(300_000, (Number(settings.requestTimeoutSeconds) || 90) * 1_000));
    // The breaker bounds all attempts on one route. A breaker smaller than a
    // single attempt silently strangles slow reasoning models, so the total
    // budget never undercuts the configured per-attempt timeout.
    const circuitBreakerMilliseconds = Math.max(
        Math.max(15_000, Math.min(
            300_000,
            (Number(settings.requestCircuitBreakerSeconds) || 90) * 1_000,
        )),
        timeoutMilliseconds,
    );
    const startedAt = Date.now();
    const fallbackProfiles = connectionFallbackProfileIds(settings);
    const routes = [
        settings.connectionSource === 'active'
            ? { source: 'active', profileId: '' }
            : { source: 'profile', profileId: settings.connectionProfileId },
        ...fallbackProfiles.map(profileId => ({ source: 'profile', profileId })),
    ];
    let lastError;
    for (let routeIndex = 0; routeIndex < routes.length; routeIndex++) {
        const route = routes[routeIndex];
        const routeAttempts = routeIndex === 0 ? maximumAttempts : fallbackMaximumAttempts;
        const routeSettings = {
            ...settings,
            connectionSource: route.source,
            ...(route.profileId ? { connectionProfileId: route.profileId } : {}),
        };
        for (let attempt = 1; attempt <= routeAttempts; attempt++) {
            const remaining = circuitBreakerMilliseconds - (Date.now() - startedAt);
            if (remaining <= 0) {
                lastError = timeoutError(circuitBreakerMilliseconds);
                break;
            }
            try {
                const output = await withRequestTimeout(async attemptSignal => {
                    if (route.source === 'active') {
                        return await sendViaActiveConnection(routeSettings, messages, attemptSignal, options);
                    }
                    return await sendViaProfile(routeSettings, messages, attemptSignal, options);
                }, signal, Math.min(timeoutMilliseconds, remaining));
                if (routeIndex > 0) {
                    console.warn(`[InnerLore] Background request recovered through fallback profile ${route.profileId}.`);
                }
                return output;
            } catch (error) {
                if (error?.name === 'AbortError' || signal?.aborted) throw error;
                lastError = error;
                const transient = isTransientRequestError(error);
                const timeoutLimitReached = error?.name === 'TimeoutError' && attempt >= 2;
                if (attempt === routeAttempts || timeoutLimitReached || !transient) break;
                console.warn(`[InnerLore] Transient model failure; retrying (${attempt}/${routeAttempts - 1}):`, error?.message || error);
                const remainingBeforeRetry = circuitBreakerMilliseconds - (Date.now() - startedAt);
                if (remainingBeforeRetry <= 0) break;
                await waitForRetry(Math.min(1_500 * attempt, remainingBeforeRetry), signal);
            }
        }
        if (routeIndex < routes.length - 1) {
            console.warn(`[InnerLore] Primary background route failed; trying configured fallback profile ${routes[routeIndex + 1].profileId}.`);
        }
    }
    const cause = lastError?.cause?.message ? `: ${lastError.cause.message}` : '';
    throw new Error(`${lastError?.message || 'InnerLore model request failed'}${cause}`, { cause: lastError });
}

export async function requestJsonPatch(settings, messages, signal) {
    const format = normalizeOutputFormat(settings.maintenanceOutputFormat);
    const requestMessages = prepareOutputMessages(messages, { format, task: 'curator' });
    const requestOptions = structuredRequestOptions(format, CURATOR_JSON_SCHEMA);
    const firstOutput = await sendInnerLoreRequest(settings, requestMessages, signal, requestOptions);
    try {
        const payload = parseInnerLoreOutput(firstOutput, {
            format, task: 'curator', salvageTruncated: true,
        });
        return {
            payload,
            repaired: false,
            rawLength: firstOutput.length,
            outputFormat: format,
            parseDiagnostics: outputParseDiagnostics(payload),
        };
    } catch (firstError) {
        if (settings.repairMalformedJson === false) throw firstError;
        const repairSettings = escalateRepairSettings(settings, firstError, firstOutput);
        const repairMessages = buildRepairMessages(firstOutput);
        repairMessages[0].content += ` The local parser error was: ${cleanString(firstError?.message, 1_000)}`;
        const preparedRepairMessages = prepareOutputMessages(repairMessages, { format, task: 'curator' });
        const repairedOutput = await sendInnerLoreRequest(repairSettings, preparedRepairMessages, signal, requestOptions);
        const payload = parseInnerLoreOutput(repairedOutput, {
            format, task: 'curator', salvageTruncated: true,
        });
        return {
            payload,
            repaired: true,
            rawLength: repairedOutput.length,
            outputFormat: format,
            firstError: firstError?.message || String(firstError),
            parseDiagnostics: outputParseDiagnostics(payload),
        };
    }
}

export async function testInnerLoreConnection(settings) {
    const format = normalizeOutputFormat(settings.maintenanceOutputFormat);
    const messages = prepareOutputMessages([
        { role: 'system', content: 'Return strict JSON only.' },
        { role: 'user', content: 'Return exactly this object: {"entities":[],"minds":[]}' },
    ], { format, task: 'curator' });
    if (format === 'dsl') {
        messages[1].content = 'Return exactly this empty patch:\nINNERLORE CURATOR 1\nDONE';
    }
    const output = await sendInnerLoreRequest(
        settings, messages, undefined, structuredRequestOptions(format, CURATOR_JSON_SCHEMA),
    );
    const parsed = parseInnerLoreOutput(output, { format, task: 'curator' });
    if (!Array.isArray(parsed.entities) || !Array.isArray(parsed.minds)) {
        throw new Error(format === OUTPUT_FORMAT_DSL
            ? 'The connection responded, but did not follow the required InnerLore DSL v1 format.'
            : 'The connection responded, but did not follow the required InnerLore JSON schema.');
    }
    return cleanString(output, 500);
}
