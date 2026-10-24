import { cleanString } from './core.js?v=49';
import { buildRepairMessages } from './prompts.js?v=11';
import { CURATOR_JSON_SCHEMA } from './structured-output.js';
import {
    OUTPUT_FORMAT_DSL,
    escalateRepairSettings,
    normalizeOutputFormat,
    outputParseDiagnostics,
    parseInnerLoreOutput,
    prepareOutputMessages,
    structuredRequestOptions,
} from './output-codec.js?v=5';

function context() {
    return SillyTavern.getContext();
}

/** The fork's shell, when the extension runs inside it (worlds, API connections, services). */
export function shell() {
    return typeof window !== 'undefined' ? (window.InnerLoreShell || null) : null;
}

/**
 * The shell's OpenAI-compatible connections in the connection-manager profile
 * shape the pickers and provider budgets already understand.
 */
/**
 * The fork's connection records. The shell publishes its API after the
 * extensions have initialised, so before that moment (the first picker fill,
 * which also saves) the records are read from the settings themselves;
 * otherwise the saved pick is compared against the wrong list, found missing,
 * and replaced by a legacy default on every page load.
 */
export function shellConnections() {
    const live = shell()?.getConnections?.();
    if (Array.isArray(live)) return live;
    const stored = context().extensionSettings?.innerlore_shell?.connections;
    return Array.isArray(stored) ? stored : [];
}

/** True under the fork, whether or not its API has been published yet. */
export function underShell() {
    return Boolean(shell()) || Boolean(context().extensionSettings?.innerlore_shell);
}

export function shellConnectionProfiles() {
    const connections = shellConnections();
    return connections
        .filter(connection => connection?.id && connection.mode === 'cc' && connection.background !== false)
        .map(connection => ({
            id: connection.id,
            name: connection.name || connection.model || connection.id,
            mode: 'cc',
            api: 'custom',
            'api-url': connection.url || '',
            model: connection.model || '',
            'secret-id': connection.secretId || '',
            'prompt-post-processing': connection.promptPostProcessing || '',
            shell: true,
        }));
}

/** A profile by id from whichever source is live: the shell's connections or SillyTavern's profiles. */
export function findConnectionProfile(profileId) {
    if (!profileId) return null;
    return listConnectionProfiles().find(profile => profile.id === profileId)
        || (context().extensionSettings?.connectionManager?.profiles || []).find(profile => profile?.id === profileId)
        || null;
}

/**
 * Under the shell, background requests go straight to SillyTavern's chat
 * completion service with the connection's endpoint, model and key; the
 * connection-manager extension is not involved.
 */
function shellRequestService(ctx) {
    if (!shell()) return null;
    return {
        async sendRequest(profileId, prompt, maxTokens, custom = {}, overridePayload = {}) {
            const connection = shell().getConnection?.(profileId) || shellConnections().find(entry => entry?.id === profileId);
            if (!connection) throw new Error('The selected InnerLore connection no longer exists. Pick one under InnerLore → Background Model.');
            if (connection.mode !== 'cc') throw new Error(`${connection.name} is a NovelAI connection; background passes need an OpenAI-compatible one.`);
            if (!ctx.ChatCompletionService?.processRequest) throw new Error('SillyTavern chat completion service is unavailable.');
            const messages = Array.isArray(prompt) ? prompt : [{ role: 'user', content: prompt }];
            return ctx.ChatCompletionService.processRequest({
                stream: custom.stream === true,
                messages,
                max_tokens: maxTokens,
                model: connection.model,
                chat_completion_source: 'custom',
                secret_id: connection.secretId || undefined,
                custom_url: connection.url,
                custom_prompt_post_processing: connection.promptPostProcessing || undefined,
                custom_include_body: connection.includeBody || undefined,
                ...overridePayload,
            }, {}, custom.extractData !== false, custom.signal ?? null);
        },
    };
}

export function listConnectionProfiles() {
    const ctx = context();
    if (underShell()) return shellConnectionProfiles();
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

/**
 * Story/background concurrency follows the provider's request slots
 * (settings.providerConcurrency).
 *
 * One slot (the default): serialized. Story and background work never
 * overlap on the provider - whichever is in flight finishes first. Background
 * requests wait for any active story generation; the story request waits for
 * in-flight background work to drain before it leaves (see
 * waitForBackgroundIdle, awaited from the prompt-ready hook, which shows
 * "Narrating - background work finishing first").
 *
 * Two slots: the story owns one and background work the other. The story
 * never waits for background work, and background requests no longer wait for
 * the story. Background work itself stays one request at a time, and a new
 * pass does not begin while a reply is being written (index.js defers it), so
 * two slots are never exceeded and no pass reads a half-written reply.
 */
export function providerConcurrency(settings = {}) {
    return Number(settings.providerConcurrency) === 2 ? 2 : 1;
}

const CONCURRENCY_REJECTION_PATTERN = /(concurrent|locked|already generating|busy)/i;

/**
 * A provider that refuses a second simultaneous generation answers with a
 * short error line. A full background reply naming a locked door or a busy
 * market is not one, so only a short reply can count as a rejection.
 */
export function isConcurrencyRejection(text) {
    const value = String(text || '').trim();
    return value.length > 0 && value.length <= 200 && CONCURRENCY_REJECTION_PATTERN.test(value);
}
/**
 * Speed telemetry: one entry per model request (background kinds and the
 * story lifecycle events fed from the extension entry). Ring-buffered,
 * exportable, never sent anywhere - a local measurement tool for tuning
 * pass sizes, cadence, and scheduling on real playthroughs.
 */
const telemetry = {
    entries: [],
    turnId: 0,
};

export function recordTelemetryEntry(entry) {
    telemetry.entries.push({ t: Date.now(), turn: telemetry.turnId, ...entry });
    if (telemetry.entries.length > 800) telemetry.entries.splice(0, telemetry.entries.length - 800);
}

export function nextTelemetryTurn() {
    telemetry.turnId += 1;
    return telemetry.turnId;
}

export function getTelemetry() {
    return { startedAt: telemetry.startedAt || null, turnId: telemetry.turnId, entries: [...telemetry.entries] };
}

export function resetTelemetry() {
    telemetry.entries = [];
    telemetry.turnId = 0;
}

function estimateMessageChars(messages) {
    try {
        // The content lengths plus a little per message for role and quoting:
        // close enough for telemetry, without serializing a 100k prompt twice.
        return (Array.isArray(messages) ? messages : []).reduce((total, message) => {
            const content = message?.content;
            const text = typeof content === 'string' ? content : JSON.stringify(content ?? '');
            return total + text.length + 40;
        }, 2);
    } catch {
        return 0;
    }
}

const serializationState = {
    backgroundInFlight: 0,
    peerBackgroundInFlight: 0,
    lastBackgroundFinishedAt: 0,
};

let slotListener = null;

export function setSlotListener(listener) {
    slotListener = typeof listener === 'function' ? listener : null;
}

export function setPeerBackgroundInFlight(count) {
    const next = Math.max(0, Number(count) || 0);
    if (next !== serializationState.peerBackgroundInFlight) {
        serializationState.peerBackgroundInFlight = next;
        slotListener?.('peer', next);
    }
}

let waitForStoryIdle = null;

export function setStoryIdleGate(gate) {
    waitForStoryIdle = typeof gate === 'function' ? gate : null;
}

export function backgroundInFlightCount() {
    return serializationState.backgroundInFlight + serializationState.peerBackgroundInFlight;
}

export async function waitForBackgroundIdle() {
    // The story waits until background work is actually done, then starts.
    // Background requests carry their own request timeouts, so this wait is
    // bounded by their completion - there is no separate cutoff that could
    // let the story race an unfinished background pass onto the provider.
    while (backgroundInFlightCount() > 0) {
        await new Promise(resolve => setTimeout(resolve, 500));
    }
}

/**
 * Providers that limit how much one account runs at once, and refuse more
 * with 429. NovelAI serves one generation at a time. Featherless's plan has
 * 4 concurrency units and a model costs 1 (under 16B parameters), 2 (under
 * 35B, such as Gemma 4 31B) or 4 (70B and every large model). Requests
 * through these providers share the budget here; the wait is not part of a
 * request's timeout.
 */
// Request budgets per provider: NovelAI serves one generation at a time, Featherless four concurrency
// units, the NanoGPT subscription ten requests at once.
const LIMITED_PROVIDERS = Object.freeze({ 'novelai.net': 1, 'featherless.ai': 4, 'nano-gpt.com': 10 });
const providerUnits = new Map();

export function limitedHost(url) {
    let host = '';
    try {
        host = new URL(String(url || '')).hostname;
    } catch {
        return '';
    }
    return Object.keys(LIMITED_PROVIDERS).find(item => host === item || host.endsWith(`.${item}`)) || '';
}

/** A model's size in billions of parameters from its name ("Gemma-4-31B" is 31); Infinity when unnamed. */
export function modelSizeBillions(model) {
    const sizes = [...String(model || '').matchAll(/(\d+(?:\.\d+)?)\s*[bB](?![a-z])/gu)].map(match => Number(match[1]));
    return sizes.length ? Math.max(...sizes) : Infinity;
}

/** Featherless's cost class from the model's size in its name; unknown sizes count as large. */
export function featherlessCost(model) {
    const size = modelSizeBillions(model);
    return size < 16 ? 1 : size < 35 ? 2 : 4;
}

function providerCost(provider, model) {
    return provider === 'featherless.ai' ? featherlessCost(model) : 1;
}

/** The limited provider a connection profile uses, if any. */
export function oneAtATimeProvider(profileId) {
    const profile = findConnectionProfile(profileId);
    if (!profile) return '';
    if (profile.api === 'novel') return 'novelai.net';
    return limitedHost(profile['api-url']);
}

function profileCost(profileId) {
    const profile = findConnectionProfile(profileId);
    return providerCost(oneAtATimeProvider(profileId), profile?.model);
}

/** Whether this provider host limits how much one account runs at once. */
export function isLimitedProvider(provider) {
    return Boolean(provider && LIMITED_PROVIDERS[provider]);
}

/**
 * Body lines a story request on a limited provider needs that SillyTavern's
 * custom source drops unless the preset is bound to the connection: thinking
 * off on Featherless, and the preset's top_k and min_p (NovelAI's Xialong
 * wants top_k 250). `custom` is the user's own YAML; its top-level sections
 * replace the defaults. Keys already in `existing` are never repeated.
 */
export function storyProviderBodyLines(provider, existing, preset = {}, custom = '') {
    if (!isLimitedProvider(provider)) return [];
    const has = key => new RegExp(`^\\s*${key}\\s*:`, 'mu').test(String(existing || ''));
    const lines = [];
    const own = String(custom || '').trim();
    if (own) {
        let section = null;
        for (const line of own.split('\n')) {
            const key = /^([A-Za-z_][\w.-]*)\s*:/u.exec(line)?.[1];
            if (key) section = has(key) ? null : key;
            if (section) lines.push(line);
        }
        return lines;
    }
    if (provider === 'featherless.ai') {
        if (!has('reasoning_effort')) lines.push('reasoning_effort: none');
        if (!has('chat_template_kwargs')) lines.push('chat_template_kwargs:', '  enable_thinking: false');
    }
    // NanoGPT: GLM 5.3 cannot stop thinking, so it thinks briefly; other models are sent as they are.
    if (provider === 'nano-gpt.com' && /glm-5\.3/iu.test(String(preset.custom_model || '')) && !has('reasoning_effort')) {
        lines.push('reasoning_effort: low');
    }
    if (!has('top_k') && Number(preset.top_k) > 0) lines.push(`top_k: ${Math.round(Number(preset.top_k))}`);
    if (!has('min_p') && Number(preset.min_p) > 0) lines.push(`min_p: ${Number(preset.min_p)}`);
    return lines;
}

/**
 * Whether a background request on this profile can run while the story is
 * being written: a different provider always can; a shared limited provider
 * only when its budget holds both (Featherless: a 31B model beside a 31B
 * story; NovelAI: never).
 */
export function fitsBesideStory(profileId) {
    const provider = oneAtATimeProvider(profileId);
    if (!provider || provider !== storyProvider()) return true;
    return LIMITED_PROVIDERS[provider] - storyCost() >= profileCost(profileId);
}

/**
 * The limited provider the story itself runs on, if any: NovelAI's text
 * completion (Erato, Kayra) or chat endpoint (GLM, Xialong), or Featherless.
 */
export function storyProvider() {
    const ctx = context();
    if (ctx.mainApi === 'novel') return 'novelai.net';
    if (ctx.mainApi === 'textgenerationwebui' && ctx.textCompletionSettings?.type === 'featherless') return 'featherless.ai';
    const chat = ctx.chatCompletionSettings;
    if (ctx.mainApi === 'openai' && chat?.chat_completion_source === 'custom') return limitedHost(chat.custom_url);
    return '';
}

/** The share of its provider's budget a story request takes. */
export function storyCost() {
    const ctx = context();
    const provider = storyProvider();
    const model = ctx.mainApi === 'textgenerationwebui' ? ctx.textCompletionSettings?.featherless_model : ctx.chatCompletionSettings?.custom_model;
    return provider ? providerCost(provider, model) : 0;
}

function unitsOf(provider) {
    if (!providerUnits.has(provider)) providerUnits.set(provider, { used: 0, waiting: [] });
    return providerUnits.get(provider);
}

/** Whether a background request holds or waits for this provider's budget. */
export function providerInUse(provider) {
    const units = provider ? providerUnits.get(provider) : null;
    return Boolean(units && (units.used > 0 || units.waiting.length));
}

/** Whether `cost` more units fit beside the background requests on this provider now. */
export function providerHasRoom(provider, cost = 1) {
    if (!provider || !LIMITED_PROVIDERS[provider]) return true;
    return (providerUnits.get(provider)?.used || 0) + cost <= LIMITED_PROVIDERS[provider];
}

/**
 * Wait until `cost` units of this provider's budget are free, keeping
 * `reserve` units for the story; resolves to the function that returns them.
 */
export async function takeProviderTurn(provider, signal, { cost = 1, reserve = 0 } = {}) {
    if (!provider || !LIMITED_PROVIDERS[provider]) return () => {};
    const units = unitsOf(provider);
    const room = Math.max(cost, LIMITED_PROVIDERS[provider] - reserve);
    await new Promise((resolve, reject) => {
        const entry = () => {
            if (signal?.aborted) return true;
            if (units.used + cost > room) return false;
            units.used += cost;
            resolve();
            return true;
        };
        const abandon = () => {
            const index = units.waiting.indexOf(entry);
            if (index >= 0) units.waiting.splice(index, 1);
            reject(new DOMException('Aborted', 'AbortError'));
        };
        if (!entry()) {
            units.waiting.push(entry);
            signal?.addEventListener?.('abort', abandon, { once: true });
        }
    });
    let returned = false;
    return () => {
        if (returned) return;
        returned = true;
        units.used = Math.max(0, units.used - cost);
        for (let index = 0; index < units.waiting.length; index++) {
            if (units.waiting[index]()) units.waiting.splice(index--, 1);
        }
    };
}

async function withBackgroundSlot(task, signal, { waitForStory = true } = {}) {
    // With one provider slot, story and background never overlap: a
    // background request waits for any active story generation before leaving.
    // With two, the story has its own slot and this request goes now.
    if (waitForStory && waitForStoryIdle) {
        await waitForStoryIdle(signal);
    }
    serializationState.backgroundInFlight++;
    slotListener?.('own', serializationState.backgroundInFlight);
    try {
        return await task();
    } catch (error) {
        throw error;
    } finally {
        serializationState.backgroundInFlight--;
        serializationState.lastBackgroundFinishedAt = Date.now();
        slotListener?.('own', serializationState.backgroundInFlight);
    }
}

async function sendViaProfile(settings, messages, signal, options = {}) {
    const ctx = context();
    const service = shellRequestService(ctx) || ctx.ConnectionManagerRequestService;
    if (!service?.sendRequest) {
        throw new Error('SillyTavern Connection Manager request service is unavailable.');
    }
    const profileId = settings.connectionProfileId;
    if (!profileId) throw new Error(shell() ? 'Pick a background connection under InnerLore → Background Model first.' : 'Select an InnerLore connection profile first.');
    if (!listConnectionProfiles().some(profile => profile.id === profileId)) {
        throw new Error('The selected InnerLore connection profile no longer exists or is unsupported.');
    }

    const maximumTokens = Math.max(800, Math.min(32_000, Number(settings.maximumResponseTokens) || 6_000));
    // A provider that serves one request at a time cannot write the story and
    // this at once, whatever the slot setting says.
    const provider = oneAtATimeProvider(profileId);
    const sharesStoryProvider = Boolean(provider) && provider === storyProvider()
        && LIMITED_PROVIDERS[provider] < storyCost() + profileCost(profileId);
    const waitForStory = providerConcurrency(settings) < 2 || sharesStoryProvider;
    // The slot covers the whole generation: a streamed request returns its
    // generator immediately, so the stream is read inside the slot too.
    // Releasing it before the body arrives would let the story start while
    // this background reply is still generating on the provider.
    const generate = waitForStoryFirst => withBackgroundSlot(async () => {
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
        if (typeof raw !== 'function') return { raw };
        // Streaming response: an async generator whose chunks carry the
        // accumulated text. Only the final chunk's values are meaningful here.
        let text = '';
        let reasoning = '';
        for await (const chunk of raw()) {
            if (typeof chunk?.text === 'string' && chunk.text) text = chunk.text;
            if (typeof chunk?.state?.reasoning === 'string' && chunk.state.reasoning) reasoning = chunk.state.reasoning;
        }
        return { streamed: true, text, reasoning };
    }, signal, { waitForStory: waitForStoryFirst });
    let result = await generate(waitForStory);
    if (result.streamed && isConcurrencyRejection(result.text) && !waitForStory) {
        // Set to two slots, but this provider (often a fallback profile on a
        // one-slot service) serves one at a time: go again after the story.
        console.warn('[InnerLore] The provider refused a second simultaneous request; retrying after the story finishes.');
        result = await generate(true);
    }
    if (result.streamed) {
        const streamed = result.text.trim() ? result.text : result.reasoning;
        if (isConcurrencyRejection(result.text)) {
            throw new Error('Provider reported a concurrent generation lock despite serialized scheduling.');
        }
        if (!streamed.trim()) throw await describeEmptyStream(service, profileId, signal, waitForStory);
        return streamed;
    }
    const text = extractResponseText(result.raw);
    if (!text.trim()) throw new Error('The selected connection profile returned no visible text.');
    return text;
}

/**
 * SillyTavern's stream reader drops a provider error that arrives as a plain
 * JSON body (an expired key answers `{"statusCode":401,"message":
 * "Unauthorized"}`), so a rejected request looks exactly like an empty reply
 * and was retried as transient forever. A tiny non-streaming probe gets the
 * provider's real error, which SillyTavern does raise, and reports it as an
 * actionable failure instead.
 */
async function describeEmptyStream(service, profileId, signal, waitForStory = true) {
    try {
        await withBackgroundSlot(() => service.sendRequest(
            profileId,
            [{ role: 'user', content: 'Reply with OK.' }],
            16,
            { stream: false, signal, extractData: true, includePreset: false, includeInstruct: false },
            { max_tokens: 16 },
        ), signal, { waitForStory });
    } catch (error) {
        if (error?.name === 'AbortError' || signal?.aborted) throw error;
        const detail = cleanString(error?.message, 300);
        if (detail && !isTransientRequestError(error)) {
            const name = listConnectionProfiles().find(profile => profile.id === profileId)?.name?.trim() || profileId;
            return new Error(
                `The provider rejected InnerLore's connection profile "${name}": ${detail}. `
                + (shell() ? 'Check its API key, model and endpoint under Settings → API.' : 'Check that profile\'s API key, model, and endpoint under Connection Profiles.'),
                { cause: error },
            );
        }
    }
    return new Error('The selected connection profile returned no visible text.');
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
    const slot = { waitForStory: providerConcurrency(settings) < 2 };

    let raw;
    if (generateRaw.length <= 1) {
        raw = await withBackgroundSlot(() => generateRaw({
            prompt,
            systemPrompt,
            responseLength: maximumTokens,
            signal,
            ...(options.jsonSchema ? { jsonSchema: options.jsonSchema } : {}),
        }), signal, slot);
    } else {
        raw = await withBackgroundSlot(() => generateRaw(prompt, systemPrompt), signal, slot);
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
    const telemetryStart = Date.now();
    const telemetryChars = estimateMessageChars(messages);
    const telemetryKind = options.telemetryKind || settings.telemetryKind
        || (settings.autoLoreEnabled === false && settings.maximumEntitiesPerPass === 1 ? 'foundation'
            : settings.progressionRequest === true ? 'progression' : 'background');
    try {
        const output = await sendInnerLoreRequestInner(settings, messages, signal, options);
        recordTelemetryEntry({
            kind: telemetryKind, phase: 'background',
            durationMs: Date.now() - telemetryStart,
            inChars: telemetryChars,
            outChars: typeof output === 'string' ? output.length : 0,
            status: 'ok',
        });
        return output;
    } catch (error) {
        recordTelemetryEntry({
            kind: telemetryKind, phase: 'background',
            durationMs: Date.now() - telemetryStart,
            inChars: telemetryChars,
            outChars: 0,
            status: 'error',
            error: String(error?.message || error).slice(0, 120),
        });
        throw error;
    }
}

async function sendInnerLoreRequestInner(settings, messages, signal, options = {}) {
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
    let startedAt = Date.now();
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
            const provider = route.source === 'profile' ? oneAtATimeProvider(route.profileId) : '';
            const queuedAt = Date.now();
            let endTurn = () => {};
            try {
                // On the story's own provider, keep the story's share free. When
                // both cannot fit (NovelAI's single slot), let a story being
                // written finish first, before taking the turn it would wait for.
                const cost = provider ? profileCost(route.profileId) : 0;
                const reserve = provider && provider === storyProvider() ? storyCost() : 0;
                if (reserve && LIMITED_PROVIDERS[provider] - reserve < cost && waitForStoryIdle) await waitForStoryIdle(signal);
                const fitsBeside = LIMITED_PROVIDERS[provider] - reserve >= cost;
                endTurn = await takeProviderTurn(provider, signal, { cost, reserve: fitsBeside ? reserve : 0 });
                // Waiting for a one-at-a-time provider is not the request's time.
                startedAt += Date.now() - queuedAt;
                const output = await withRequestTimeout(async attemptSignal => {
                    if (route.source === 'active') {
                        return await sendViaActiveConnection(routeSettings, messages, attemptSignal, options);
                    }
                    return await sendViaProfile(routeSettings, messages, attemptSignal, options);
                }, signal, Math.min(timeoutMilliseconds, circuitBreakerMilliseconds - (Date.now() - startedAt)));
                endTurn();
                if (routeIndex > 0) {
                    console.warn(`[InnerLore] Background request recovered through fallback profile ${route.profileId}.`);
                }
                return output;
            } catch (error) {
                endTurn();
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
