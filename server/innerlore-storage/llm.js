/**
 * The server's chat-completion transport: one OpenAI-compatible request to
 * the connection's endpoint with the key from the user's secret store, the
 * connection's prompt post-processing and extra body, a timeout, retries on
 * passing failures, and a fallback connection. Ported from the browser's
 * sendInnerLoreRequestInner so a job gets the same behaviour the pass had.
 */
import { extractResponseText, isConcurrencyRejection, isTransientRequestError } from '../../llm-client.js?v=21';
import { providerCost, providerOf } from './provider-budget.js';
import { readSecretFromFile } from './st-bridge.js';

const DEFAULTS = Object.freeze({
    attempts: 3,
    fallbackAttempts: 1,
    timeoutMs: 90_000,
    breakerMs: 90_000,
    maxTokens: 6_000,
    temperature: 0.15,
    topP: 0.9,
});

function cleanConnection(input) {
    if (!input || typeof input !== 'object') return null;
    const url = String(input.url || '').trim().replace(/\/+$/u, '');
    const model = String(input.model || '').trim();
    if (!/^https?:\/\//u.test(url) || !model) return null;
    return {
        id: String(input.id || ''),
        name: String(input.name || model),
        url,
        model,
        secretId: String(input.secretId || ''),
        promptPostProcessing: String(input.promptPostProcessing || ''),
        includeBody: String(input.includeBody || ''),
        mode: 'cc',
    };
}

function timeoutError(milliseconds) {
    const error = new Error(`InnerLore model request timed out after ${Math.round(milliseconds / 1000)} seconds.`);
    error.name = 'TimeoutError';
    return error;
}

function hasBodyKey(yaml, key) {
    return new RegExp(`^\\s*${key}\\s*:`, 'mu').test(String(yaml || ''));
}

export function createLlm({ helpers, budget, fetchImpl = globalThis.fetch, log = () => {} } = {}) {
    const getHelpers = typeof helpers === 'function' ? helpers : async () => (helpers || {});

    async function sendOnce(connection, { messages, maxTokens, temperature, topP, jsonSchema, names, directories, signal, timeoutMs }) {
        const tools = await getHelpers();
        const key = tools.readSecret ? tools.readSecret(directories, 'api_key_custom', connection.secretId || null) : readSecretFromFile(directories, 'api_key_custom', connection.secretId);
        let prompt = messages.map(message => ({ role: message.role, content: String(message.content ?? '') }));
        if (connection.promptPostProcessing && tools.postProcessPrompt) {
            prompt = tools.postProcessPrompt(prompt, connection.promptPostProcessing, { charName: names?.characterName || 'Narrator', userName: names?.playerName || 'You' });
        }
        const body = {
            model: connection.model,
            messages: prompt,
            max_tokens: maxTokens,
            temperature,
            top_p: topP,
            stream: false,
            include_reasoning: false,
            ...(jsonSchema ? { response_format: { type: 'json_schema', json_schema: { name: jsonSchema.name || 'innerlore', strict: Boolean(jsonSchema.strict), schema: jsonSchema.schema || jsonSchema } } } : {}),
        };
        if (connection.includeBody && tools.mergeObjectWithYaml) {
            try { tools.mergeObjectWithYaml(body, connection.includeBody); } catch (error) { log(`extra body of ${connection.name} ignored: ${error?.message || error}`); }
        }
        // NanoGPT's GLM 5.3 cannot stop thinking; a low effort keeps it to a few tokens.
        if (providerOf(connection) === 'nano-gpt.com' && /glm-5\.3/iu.test(connection.model) && !hasBodyKey(connection.includeBody, 'reasoning_effort') && body.reasoning_effort === undefined) {
            body.reasoning_effort = 'low';
        }
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(timeoutError(timeoutMs)), timeoutMs);
        const onAbort = () => controller.abort(signal?.reason || new DOMException('Aborted', 'AbortError'));
        signal?.addEventListener?.('abort', onAbort, { once: true });
        try {
            const response = await fetchImpl(`${connection.url}/chat/completions`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', ...(key ? { Authorization: `Bearer ${key}` } : {}) },
                body: JSON.stringify(body),
                signal: controller.signal,
            });
            const text = await response.text();
            if (!response.ok) {
                const error = new Error(`The provider answered ${response.status}: ${text.slice(0, 300)}`);
                error.status = response.status;
                throw error;
            }
            let json;
            try { json = JSON.parse(text); } catch { throw new Error(`The provider sent a reply that is not JSON: ${text.slice(0, 200)}`); }
            if (json?.error) throw new Error(`The provider rejected the request: ${String(json.error?.message || JSON.stringify(json.error)).slice(0, 300)}`);
            const output = extractResponseText(json);
            if (isConcurrencyRejection(output)) throw new Error('Provider reported a concurrent generation lock.');
            if (!String(output || '').trim()) throw new Error('The connection returned no visible text.');
            return output;
        } catch (error) {
            if (controller.signal.aborted && controller.signal.reason?.name === 'TimeoutError' && !signal?.aborted) throw controller.signal.reason;
            throw error;
        } finally {
            clearTimeout(timer);
            signal?.removeEventListener?.('abort', onAbort);
        }
    }

    return {
        /**
         * Sends `messages` on `connection`, retrying passing failures up to
         * `attempts` times within `breakerMs`, then once on `fallback`.
         * Resolves to the reply text.
         */
        async request({
            connection: connectionInput, fallback: fallbackInput, messages, maxTokens = DEFAULTS.maxTokens, temperature = DEFAULTS.temperature,
            topP = DEFAULTS.topP, jsonSchema = null, names = {}, directories, signal, attempts = DEFAULTS.attempts,
            fallbackAttempts = DEFAULTS.fallbackAttempts, timeoutMs = DEFAULTS.timeoutMs, breakerMs = DEFAULTS.breakerMs, kind = 'background',
        }) {
            const connection = cleanConnection(connectionInput);
            if (!connection) throw new Error('The job has no usable connection (an OpenAI-compatible URL and a model are required).');
            const fallback = cleanConnection(fallbackInput);
            const routes = [connection, ...(fallback && fallback.id !== connection.id ? [fallback] : [])];
            const timeout = Math.max(15_000, Math.min(300_000, Number(timeoutMs) || DEFAULTS.timeoutMs));
            const breaker = Math.max(timeout, Math.max(15_000, Math.min(300_000, Number(breakerMs) || DEFAULTS.breakerMs)));
            let lastError = null;
            let startedAt = Date.now();
            for (let routeIndex = 0; routeIndex < routes.length; routeIndex++) {
                const route = routes[routeIndex];
                const routeAttempts = routeIndex === 0 ? Math.max(1, Math.min(3, attempts)) : Math.max(1, Math.min(2, fallbackAttempts));
                const provider = providerOf(route);
                const cost = providerCost(provider, route.model);
                for (let attempt = 1; attempt <= routeAttempts; attempt++) {
                    if (signal?.aborted) throw signal.reason || new DOMException('Aborted', 'AbortError');
                    const remaining = breaker - (Date.now() - startedAt);
                    if (remaining <= 0) { lastError = timeoutError(breaker); break; }
                    const queuedAt = Date.now();
                    const release = budget ? await budget.take(provider, cost, { signal }) : () => {};
                    // Waiting for a provider's turn is not the request's time.
                    startedAt += Date.now() - queuedAt;
                    try {
                        const output = await sendOnce(route, {
                            messages, maxTokens, temperature, topP, jsonSchema, names, directories, signal,
                            timeoutMs: Math.min(timeout, Math.max(15_000, breaker - (Date.now() - startedAt))),
                        });
                        release();
                        if (routeIndex > 0) log(`${kind}: recovered through the fallback connection ${route.name}`);
                        return output;
                    } catch (error) {
                        release();
                        if (error?.name === 'AbortError' || signal?.aborted) throw error;
                        lastError = error;
                        const transient = isTransientRequestError(error) || error?.status === 429 || (error?.status >= 500 && error?.status < 600);
                        if (attempt === routeAttempts || !transient || (error?.name === 'TimeoutError' && attempt >= 2)) break;
                        log(`${kind}: passing failure on ${route.name}, retrying (${attempt}/${routeAttempts - 1}): ${error?.message || error}`);
                        await new Promise(resolve => setTimeout(resolve, Math.min(1_500 * attempt, Math.max(0, breaker - (Date.now() - startedAt)))));
                    }
                }
                if (routeIndex < routes.length - 1) log(`${kind}: ${route.name} failed; trying the fallback connection ${routes[routeIndex + 1].name}`);
            }
            throw new Error(lastError?.message || 'InnerLore model request failed', { cause: lastError });
        },
    };
}
