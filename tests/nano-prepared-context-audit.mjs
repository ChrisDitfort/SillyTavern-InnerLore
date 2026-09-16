/**
 * Optional, bounded live audit for the prepared SQLite NarrativeState path.
 * This file is intentionally excluded from the ordinary node:test glob.
 * It reads the selected Nano connection profile and credential without
 * printing either secret material or modifying saved SillyTavern state.
 */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';

import {
    buildLatestTurnContract,
    createEmptyStore,
    extractJsonObject,
    generatedProseIssue,
    mergeMindOperations,
} from '../core.js';
import { compileTriggerEventDeliveryPreview } from '../event-delivery.js';
import { buildAnalysisMessages } from '../prompts.js';
import { upsertTriggerEventDefinition } from '../trigger-events.js';

const MODEL = process.env.INNERLORE_AUDIT_MODEL || 'deepseek/deepseek-v4-pro-0813:thinking';
const PROFILE_NAME = process.env.INNERLORE_AUDIT_PROFILE
    || (MODEL.endsWith(':thinking') ? 'NanoDeepseekV4Pro0813Think' : 'NanoDeepseekV4Pro0813');
const THINKING_VARIANT = MODEL.endsWith(':thinking');
const CANDIDATE_REASONING_EFFORT = process.env.INNERLORE_AUDIT_REASONING_EFFORT
    || (/glm-5\.3/iu.test(MODEL) ? 'minimal' : (THINKING_VARIANT ? 'high' : 'none'));
const JUDGE_MODEL = process.env.INNERLORE_AUDIT_JUDGE_MODEL || 'deepseek/deepseek-v4-pro-0813';
const JUDGE_PROFILE_NAME = process.env.INNERLORE_AUDIT_JUDGE_PROFILE || 'NanoDeepseekV4Pro0813';
const API_URL = 'https://nano-gpt.com/api/v1/chat/completions';
const root = process.cwd();
const settingsFile = JSON.parse(fs.readFileSync(path.join(root, 'data/default-user/settings.json'), 'utf8'));
const connectionManager = settingsFile.extension_settings?.connectionManager ?? {};
const profiles = connectionManager.profiles ?? [];
const profile = profiles.find(item => item?.name === PROFILE_NAME && item?.model === MODEL);
if (!profile) throw new Error(`Saved connection profile '${PROFILE_NAME}' was not found.`);
const presetPath = path.join(root, 'data/default-user/OpenAI Settings', `${profile.preset}.json`);
const preset = JSON.parse(fs.readFileSync(presetPath, 'utf8'));
const judgeProfile = profiles.find(item => item?.name === JUDGE_PROFILE_NAME && item?.model === JUDGE_MODEL);
if (!judgeProfile) throw new Error(`Saved judge profile '${JUDGE_PROFILE_NAME}' was not found.`);
const judgePresetPath = path.join(root, 'data/default-user/OpenAI Settings', `${judgeProfile.preset}.json`);
const judgePreset = JSON.parse(fs.readFileSync(judgePresetPath, 'utf8'));
const secrets = JSON.parse(fs.readFileSync(path.join(root, 'data/default-user/secrets.json'), 'utf8'));
const secretRecords = Array.isArray(secrets.api_key_nanogpt)
    ? secrets.api_key_nanogpt
    : [{ value: secrets.api_key_nanogpt, active: true }];
function profileCredential(profileValue) {
    return secretRecords.find(item => item?.id === profileValue?.['secret-id'] && item?.value)?.value
    ?? secretRecords.find(item => item?.active && item?.value)?.value
    ?? secretRecords.find(item => item?.value)?.value;
}
const credential = profileCredential(profile);
const judgeCredential = profileCredential(judgeProfile);
if (!credential) throw new Error('The saved Nano credential is unavailable.');
if (!judgeCredential) throw new Error('The saved Nano judge credential is unavailable.');

let modelCatalog = {};
try {
    const response = await fetch('https://nano-gpt.com/api/models', { signal: AbortSignal.timeout(30_000) });
    const catalog = await response.json();
    modelCatalog = catalog?.models?.text ?? {};
} catch {
    // Live quality testing can continue if public price metadata is temporarily unavailable.
}

function modelMetadata(modelId) {
    const record = modelCatalog[modelId] ?? {};
    const promptPerMillionUsd = Number(record.pricing?.prompt_per_million ?? record.input_price_per_million);
    const completionPerMillionUsd = Number(record.pricing?.completion_per_million ?? record.output_price_per_million);
    return {
        name: clean(record.name) || modelId,
        promptPerMillionUsd: Number.isFinite(promptPerMillionUsd) ? promptPerMillionUsd : null,
        completionPerMillionUsd: Number.isFinite(completionPerMillionUsd) ? completionPerMillionUsd : null,
        maximumInputTokens: Number(record.maxInputTokens) || null,
        maximumOutputTokens: Number(record.maxOutputTokens) || null,
        pricingUpdatedAt: clean(record.effective_pricing?.updated_at) || null,
    };
}

const storageRoot = process.env.INNERLORE_STORAGE_ROOT || '/home/chris/airpg-storage';
const helpersUrl = pathToFileURL(path.join(storageRoot, 'test/helpers.js')).href;
const { temporaryWorld } = await import(helpersUrl);

const storyRepeats = Math.min(3, Math.max(1, Number(process.env.INNERLORE_AUDIT_STORY_REPEATS) || 3));
const eventRepeats = Math.min(3, Math.max(1, Number(process.env.INNERLORE_AUDIT_EVENT_REPEATS) || 2));
const clean = value => typeof value === 'string' ? value.trim() : '';
const words = value => clean(value).match(/\S+/gu)?.length ?? 0;

function presetPrompt(identifier) {
    return preset.prompts?.find(item => item.identifier === identifier)?.content ?? '';
}

function replaceMacros(value) {
    return String(value ?? '').replaceAll('{{user}}', 'Ari').replaceAll('{{char}}', 'The Signal Tower');
}

function parseSseEvent(raw) {
    const data = raw.split(/\r?\n/u)
        .filter(line => line.startsWith('data:'))
        .map(line => line.slice(5).trim())
        .join('\n');
    if (!data || data === '[DONE]') return null;
    try { return JSON.parse(data); } catch { return null; }
}

async function nanoChat(label, messages, options = {}) {
    const requestModel = options.model || MODEL;
    const requestPreset = options.preset || preset;
    const requestCredential = options.credential || credential;
    const requestThinking = requestModel.endsWith(':thinking');
    const reasoningEffort = options.requestReasoningEffort
        ?? (requestModel === MODEL ? CANDIDATE_REASONING_EFFORT : (requestThinking ? 'high' : 'none'));
    const started = performance.now();
    const response = await fetch(API_URL, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${requestCredential}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            model: requestModel,
            messages,
            temperature: options.temperature ?? requestPreset.temperature ?? 0.85,
            top_p: requestPreset.top_p ?? 0.95,
            min_p: requestPreset.min_p ?? 0.02,
            repetition_penalty: requestPreset.repetition_penalty ?? 1.05,
            max_tokens: options.maxTokens ?? 3_000,
            reasoning_effort: reasoningEffort,
            stream: true,
            stream_options: { include_usage: true },
        }),
        signal: AbortSignal.timeout(options.timeoutMs ?? 300_000),
    });
    const headersMs = performance.now() - started;
    if (!response.ok) {
        const failure = await response.text();
        throw new Error(`${label}: Nano returned ${response.status}: ${failure.slice(0, 500)}`);
    }
    if (!response.body) throw new Error(`${label}: Nano returned no response stream.`);
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let content = '';
    let reasoning = '';
    let usage = null;
    let firstEventMs = null;
    let firstReasoningMs = null;
    let firstTextMs = null;
    let finishReason = null;
    const consume = raw => {
        const event = parseSseEvent(raw);
        if (!event) return;
        const elapsed = performance.now() - started;
        firstEventMs ??= elapsed;
        const choice = event.choices?.[0];
        const delta = choice?.delta ?? {};
        const nextReasoning = clean(delta.reasoning_content ?? delta.reasoning ?? delta.thinking);
        const nextContent = typeof delta.content === 'string' ? delta.content : '';
        if (nextReasoning) { firstReasoningMs ??= elapsed; reasoning += nextReasoning; }
        if (nextContent) { firstTextMs ??= elapsed; content += nextContent; }
        if (choice?.finish_reason) finishReason = choice.finish_reason;
        if (event.usage) usage = event.usage;
    };
    while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split(/\r?\n\r?\n/u);
        buffer = events.pop() ?? '';
        for (const event of events) consume(event);
    }
    buffer += decoder.decode();
    if (buffer.trim()) consume(buffer);
    const totalMs = performance.now() - started;
    if (!clean(content) && options.allowEmpty !== true) {
        throw new Error(`${label}: Nano returned no final text (finish=${finishReason ?? 'unknown'}).`);
    }
    const completionTokens = Number(usage?.completion_tokens) || 0;
    const promptTokens = Number(usage?.prompt_tokens) || 0;
    const pricing = modelMetadata(requestModel);
    const estimatedCostUsd = pricing.promptPerMillionUsd === null || pricing.completionPerMillionUsd === null
        ? null
        : promptTokens * pricing.promptPerMillionUsd / 1_000_000
            + completionTokens * pricing.completionPerMillionUsd / 1_000_000;
    const activeSeconds = Math.max(0.001, (totalMs - (firstEventMs ?? headersMs)) / 1_000);
    const result = {
        label,
        model: requestModel,
        reasoningEffort,
        content: clean(content),
        performance: {
            headersMs: Number(headersMs.toFixed(1)),
            firstEventMs: firstEventMs === null ? null : Number(firstEventMs.toFixed(1)),
            firstReasoningMs: firstReasoningMs === null ? null : Number(firstReasoningMs.toFixed(1)),
            firstTextMs: firstTextMs === null ? null : Number(firstTextMs.toFixed(1)),
            totalMs: Number(totalMs.toFixed(1)),
            completionTokensPerSecond: completionTokens ? Number((completionTokens / activeSeconds).toFixed(2)) : null,
        },
        usage: usage ?? {},
        pricing,
        estimatedCostUsd: estimatedCostUsd === null ? null : Number(estimatedCostUsd.toFixed(8)),
        reasoningCharacters: reasoning.length,
        finishReason,
    };
    process.stderr.write(`[nano-audit] ${label} (${requestModel}, reasoning=${reasoningEffort}): ${result.performance.totalMs} ms, first text ${result.performance.firstTextMs ?? 'none'} ms, ${completionTokens || 'unreported'} completion tokens, finish=${finishReason ?? 'unknown'}\n`);
    return result;
}

function loreEntity(id, type, name, values = {}) {
    const timestamp = Date.now();
    return {
        id, type, name, identityKind: 'public_name', aliases: values.aliases ?? [], keys: values.keys ?? [],
        importance: values.importance ?? 70, summary: values.summary ?? '', description: values.description ?? '',
        facts: values.facts ?? [], relationships: values.relationships ?? [], history: values.history ?? [],
        currentState: values.currentState ?? '', unresolved: values.unresolved ?? [], status: 'active',
        enabled: true, pinned: values.pinned === true, manualContent: '', manualOverride: false,
        firstSeenMessage: 0, lastSeenMessage: 12, revision: 1, createdAt: timestamp, updatedAt: timestamp,
    };
}

function makeStore() {
    const store = createEmptyStore('nano-prepared-context-audit');
    store.expressionFoundationVersion = 2;
    store.lastProcessedIndex = 12;
    store.entities = {
        'location:east_signal_tower': loreEntity('location:east_signal_tower', 'location', 'East Signal Tower', {
            importance: 95, pinned: true,
            summary: 'A storm-battered signal tower with a sealed north door.',
            facts: ['The north door lock accepts only the silver key.'],
            currentState: 'Mara and Ilyan stand before the sealed north door while the storm approaches.',
        }),
        'item:silver_key': loreEntity('item:silver_key', 'item', 'Silver key', {
            importance: 93, pinned: true,
            summary: 'The only key that opens the north door.',
            facts: ['Mara concealed the silver key inside her left boot.'],
            currentState: 'Still in Mara\'s left boot.',
        }),
        'character:mara': loreEntity('character:mara', 'character', 'Mara Vey', {
            importance: 90, summary: 'A guarded signal officer who weighs every disclosure.',
            relationships: ['Works uneasily with Ilyan.'], currentState: 'At the north door.',
        }),
        'character:ilyan': loreEntity('character:ilyan', 'character', 'Ilyan Rook', {
            importance: 86, summary: 'A precise engineer who distrusts unexplained delays.',
            relationships: ['Needs Mara to open the north door.'], currentState: 'Inspecting the lock.',
        }),
        'location:sunken_archives': loreEntity('location:sunken_archives', 'location', 'Sunken Archives', {
            importance: 15, summary: 'An unrelated archive many days away.',
            facts: ['An amber compass lies beneath its western stair.'], currentState: 'Off scene.',
        }),
    };
    for (let index = 0; index < 16; index++) {
        store.entities[`concept:decoy_${index}`] = loreEntity(`concept:decoy_${index}`, 'concept', `Distant record ${index}`, {
            importance: 10 + index, summary: `Unrelated continuity marker DECOY-${index}.`, currentState: 'Off scene.',
        });
    }
    mergeMindOperations(store, [
        {
            character: 'Mara Vey',
            persistent_self: { set: [
                { key: 'control', kind: 'personal_anchor', statement: 'I keep control by revealing only what action requires.', confidence: 'confirmed', basis: 'character_card' },
                { key: 'ilyan_doubt', kind: 'contradiction', statement: 'I rely on Ilyan\'s skill but resent how quickly he notices evasion.', confidence: 'confirmed', basis: 'story' },
            ] },
            voice: { set: [
                { key: 'thought', kind: 'thought_style', statement: 'My private thoughts are clipped risk calculations.', confidence: 'confirmed', basis: 'character_card' },
                { key: 'speech', kind: 'cadence', statement: 'I speak in spare, deliberate clauses and avoid explanations.', confidence: 'confirmed', basis: 'character_card' },
                { key: 'stress', kind: 'emphasis', statement: 'Under pressure, one private word may receive capital stress.', confidence: 'confirmed', basis: 'character_card' },
            ] },
            current_mind: {
                perception: 'Ilyan is watching my hands and the sealed north door.',
                interpretation: 'Refusing now would expose that I hid the key.',
                emotions: [{ name: 'contained alarm', intensity: 'high', cause: 'My concealment is becoming visible.' }],
                attention: 'The silver key inside my left boot', expectation: 'Ilyan will demand an explanation.',
                immediate_goal: 'Open the door without surrendering control of the conversation.',
                inner_thoughts: ['BLUE ORCHID. Give him the result, not the reason.'],
                impulse: 'Deny having the key.', restraint: 'The storm makes delay indefensible.',
                conflict: 'Protect the secret versus keep both of us alive.', intention: 'Retrieve the key and open the north door without explaining the concealment.',
            },
        },
        {
            character: 'Ilyan Rook',
            persistent_self: { set: [
                { key: 'evidence', kind: 'value', statement: 'I trust mechanisms and observable evidence before assurances.', confidence: 'confirmed', basis: 'character_card' },
            ] },
            voice: { set: [
                { key: 'thought', kind: 'thought_style', statement: 'My thoughts test claims against physical evidence.', confidence: 'confirmed', basis: 'character_card' },
                { key: 'speech', kind: 'cadence', statement: 'I speak with exact technical nouns and short questions.', confidence: 'confirmed', basis: 'character_card' },
            ] },
            current_mind: {
                perception: 'Mara keeps shifting weight away from her left boot.',
                interpretation: 'She has concealed something relevant to the lock.',
                emotions: [{ name: 'suspicion', intensity: 'moderate', cause: 'Her delay contradicts the urgency.' }],
                attention: 'Mara\'s stance and the north-door lock', expectation: 'She can solve this immediately.',
                immediate_goal: 'Get the north door open before the storm shutters close.',
                inner_thoughts: ['The asymmetry is too consistent to be pain.'],
                impulse: 'Name the concealment directly.', restraint: 'Let her act before turning inference into accusation.',
                conflict: 'Demand truth versus preserve cooperation.', intention: 'Watch silently until Mara either produces the key or refuses.',
            },
        },
    ], { messageIndex: 12, maximumOperations: 4, maximumThoughtChanges: 10, maximumThoughts: 30, maximumSceneThoughts: 4 });
    store.progression = {
        version: 2,
        clock: { minimumSeconds: 420, estimatedSeconds: 450, maximumSeconds: 480 },
        goals: {
            'goal:open_north_door': { id: 'goal:open_north_door', title: 'Open the north door', status: 'active', subject: 'Mara Vey', importance: 0.95, visibility: 'narrator_only', description: 'The door must open before the storm shutters seal the tower.' },
        },
        processes: {
            'process:storm_shutters': { id: 'process:storm_shutters', title: 'Storm shutters closing', status: 'active', subject: 'East Signal Tower', importance: 0.9, visibility: 'narrator_only', description: 'Roughly eight minutes remain.' },
        },
        events: {},
        eventDefinitions: {
            'trigger:glass_heron': { id: 'trigger:glass_heron', key: 'glass_heron', title: 'GLASS HERON PROTOCOL', enabled: true, activationVisibility: 'hidden', priority: 100, subject: 'East Signal Tower' },
        },
        eventRuntime: {
            'trigger:glass_heron': { definitionId: 'trigger:glass_heron', status: 'latent', deliveryStatus: 'pending', deliveryId: 'audit-glass-heron-1', deliveryAttempts: 0 },
        },
        log: [], lastProcessedIndex: 12, processedFingerprints: {}, revision: 1,
    };
    store.updatedAt = Date.now();
    return store;
}

function storyMessages(contextBlock = '', deliveryBlock = '') {
    const previousMessage = 'Rain hammered the East Signal Tower. Ilyan crouched beside the sealed north door while Mara stood just behind him, one hand braced against the shuddering wall.';
    const latestMessage = 'I point at Mara and say, “Use it to open the north door.” I remain beside the signal lever and say nothing else.';
    const turnContract = buildLatestTurnContract([
        { is_user: false, is_system: false, name: 'The Signal Tower', mes: previousMessage },
        { is_user: true, is_system: false, name: 'Ari', mes: latestMessage },
    ], { playerName: 'Ari' });
    const result = [
        { role: 'system', content: replaceMacros(presetPrompt('main')) },
        { role: 'system', content: 'Mara Vey is a guarded signal officer. Ilyan Rook is a precise engineer. Portray only established characters and finish in 120–190 words.' },
        { role: 'assistant', content: previousMessage },
    ];
    if (contextBlock) result.push({ role: 'system', content: contextBlock });
    result.push({ role: 'user', content: latestMessage });
    if (turnContract) result.push({ role: 'system', content: turnContract });
    // SillyTavern sorts same-depth extension keys. The production trigger key
    // follows the context and latest-turn keys, so delivery is the last custom
    // near-turn system block before the preset jailbreak.
    if (deliveryBlock) result.push({ role: 'system', content: deliveryBlock });
    result.push({ role: 'system', content: replaceMacros(presetPrompt('jailbreak')) });
    return result;
}

function narrativeChecks(text, { event = false } = {}) {
    const source = clean(text);
    const lower = source.toLocaleLowerCase();
    const proseIssue = generatedProseIssue(source);
    return {
        words: words(source),
        completeEnding: /[.!?…]["”'’*]?$/u.test(source),
        namesMara: /\bMara\b/u.test(source),
        usesSilverKey: /silver key|key[^.\n]{0,80}(?:boot|lock|door)|boot[^.\n]{0,80}key/iu.test(source),
        recallsLeftBoot: /left boot|boot[^.\n]{0,60}(?:key|silver)|(?:key|silver)[^.\n]{0,60}boot/iu.test(source),
        advancesNorthDoor: /north door/iu.test(source) && /open|unlock|turn(?:ed|s)?|lock/iu.test(source),
        keepsDecoysOut: !/Sunken Archives|amber compass|DECOY-/iu.test(source),
        keepsSystemTriggerOut: !/GLASS HERON/iu.test(source),
        keepsPrivateSentinelOut: !/BLUE ORCHID/iu.test(source),
        leaksPromptInstruction: proseIssue === 'prompt instruction echo'
            || proseIssue === 'internal prompt markup exposed',
        preservesUserPosition: !/\byou (?:pull|turn|leave|follow|cross|step|walk|run|take|grab|open)\b/iu.test(source),
        eventAppears: !event || /courier|messenger|(?:figure|person)[^\.\n]{0,60}(?:red|scarlet)[^\.\n]{0,30}coat/iu.test(source),
        eventIsImmediate: !event || (/(?:courier|messenger|figure|person)/iu.test(source)
            && /pound|hammer|knock|arriv|burst|outer door|door below/iu.test(source)),
        eventDetails: !event || (/(?:red|scarlet)[^\.\n]{0,40}(?:coat|smear)|coat[^\.\n]{0,40}(?:red|scarlet)/iu.test(lower)
            && /sealed message|black wax|sealed dispatch|message/iu.test(lower)),
        eventIdentityPreserved: !event || !/(?:\b(?:courier|messenger)\s+(?:named|called)\s+[A-Z][\p{L}'’-]+|\b[A-Z][\p{L}'’-]+\s+[A-Z][\p{L}'’-]+,\s+the\s+(?:courier|messenger)\b)/u.test(source),
    };
}

function metricSummary(calls) {
    const values = key => calls.map(call => call.performance[key]).filter(Number.isFinite).sort((a, b) => a - b);
    const median = list => list.length ? list[Math.floor(list.length / 2)] : null;
    return {
        samples: calls.length,
        medianFirstTextMs: median(values('firstTextMs')),
        minimumFirstTextMs: values('firstTextMs')[0] ?? null,
        maximumFirstTextMs: values('firstTextMs').at(-1) ?? null,
        medianTotalMs: median(values('totalMs')),
        minimumTotalMs: values('totalMs')[0] ?? null,
        maximumTotalMs: values('totalMs').at(-1) ?? null,
        medianTokensPerSecond: median(values('completionTokensPerSecond')),
    };
}

function usageTotals(calls) {
    return calls.reduce((totals, call) => {
        totals.prompt += Number(call.usage?.prompt_tokens) || 0;
        totals.completion += Number(call.usage?.completion_tokens) || 0;
        totals.reasoning += Number(call.usage?.reasoning_tokens ?? call.usage?.completion_tokens_details?.reasoning_tokens) || 0;
        return totals;
    }, { prompt: 0, completion: 0, reasoning: 0 });
}

async function nanoBalance() {
    try {
        const response = await fetch('https://nano-gpt.com/api/check-balance', {
            method: 'POST', headers: { Accept: 'application/json', 'x-api-key': credential },
            signal: AbortSignal.timeout(30_000),
        });
        const body = await response.json();
        return response.ok && Number.isFinite(Number(body.usd_balance)) ? Number(body.usd_balance) : null;
    } catch { return null; }
}

const balanceBefore = await nanoBalance();
const fixture = await temporaryWorld('nano-prepared-context-audit');
const calls = [];

try {
    const store = makeStore();
    const scene = {
        location: { id: 'location:east_signal_tower', name: 'East Signal Tower' },
        participants: [{ id: 'mara vey', name: 'Mara Vey' }, { id: 'ilyan rook', name: 'Ilyan Rook' }],
        objects: [{ id: 'item:silver_key', name: 'Silver key' }],
        activity: 'Opening the sealed north door before the storm shutters close.',
    };
    fixture.storage.innerLore.put({
        chatId: store.chatId, store, expectedRevision: 0,
        branch: { id: 'main', headFingerprint: 'nano-audit-head-12', headMessageIndex: 12 }, scene,
    });
    await fixture.storage.flushGraph();
    const buildInput = {
        branchId: 'main', expectedRevision: 1, headFingerprint: 'nano-audit-head-12', currentMessageIndex: 12,
        scene, recentText: 'Mara Vey and Ilyan Rook face the north door. Ari tells Mara to use it.',
        turn: { status: 'uncommitted_input', speakerName: 'Ari', messageIndex: 12, fingerprint: 'nano-audit-turn', text: 'Use it to open the north door.' },
        audience: { role: 'narrator' },
        overrides: {
            maximumCharacters: 12_000, graphDepth: 1,
            sections: {
                scene: { maximumItems: 1, maximumCharacters: 1_200 },
                minds: { maximumItems: 14, maximumParents: 2, maximumItemsPerParent: 7, maximumCharacters: 4_500 },
                lore: { maximumItems: 6, maximumCharacters: 3_500 },
                progression: { maximumItems: 4, maximumCharacters: 1_600 },
            },
        },
    };
    const contextStarted = performance.now();
    const prepared = await fixture.storage.innerLoreContext.build(buildInput);
    const contextColdMs = performance.now() - contextStarted;
    const contextHotStarted = performance.now();
    const hot = await fixture.storage.innerLoreContext.build(buildInput);
    const contextHotMs = performance.now() - contextHotStarted;
    const publicState = await fixture.storage.innerLoreContext.build({ ...buildInput, audience: { role: 'public' } });
    const stateChecks = {
        narratorContainsPrivateMind: /BLUE ORCHID/u.test(prepared.rendered),
        publicExcludesPrivateMind: !/BLUE ORCHID/u.test(publicState.rendered) && publicState.state.minds.length === 0,
        narratorExcludesSystemDefinition: !/GLASS HERON/u.test(prepared.rendered)
            && !prepared.state.graph.some(item => item.targetName === 'GLASS HERON PROTOCOL'),
        publicGraphExcludesPrivateProgression: !publicState.state.graph.some(item => item.targetKind === 'innerlore_progression'),
        relevantLocationSelected: /East Signal Tower/u.test(prepared.rendered),
        relevantItemSelected: /Silver key/u.test(prepared.rendered),
        activeProgressionSelected: /Storm shutters closing/u.test(prepared.rendered),
        bounded: prepared.rendered.length <= buildInput.overrides.maximumCharacters,
    };

    const baseline = await nanoChat('baseline-without-innerlore', storyMessages(), { maxTokens: 3_000 });
    calls.push(baseline);
    const preparedCalls = [];
    for (let index = 0; index < storyRepeats; index++) {
        const call = await nanoChat(`prepared-story-${index + 1}`, storyMessages(prepared.rendered), { maxTokens: 3_000 });
        calls.push(call); preparedCalls.push(call);
    }
    const eventState = structuredClone(store.progression);
    const eventDefinition = upsertTriggerEventDefinition(eventState, {
        id: 'trigger:red_coat_courier',
        key: 'red_coat_courier',
        title: 'A courier arrives at the tower',
        description: 'An unnamed courier in a rain-dark red coat pounds on the outer door and raises a sealed message stamped with black wax.',
        enabled: true,
        triggerAfterSeconds: 1,
        activationVisibility: 'observable',
        priority: 95,
    }, { clock: eventState.clock, messageIndex: 11 });
    eventDefinition.runtime.status = 'observable';
    eventDefinition.runtime.deliveryStatus = 'pending';
    const delivery = compileTriggerEventDeliveryPreview(eventState, [], { currentIndex: 13 }).text;
    const eventCalls = [];
    for (let index = 0; index < eventRepeats; index++) {
        const call = await nanoChat(`mandatory-event-${index + 1}`, storyMessages(prepared.rendered, delivery), { maxTokens: 3_000 });
        calls.push(call); eventCalls.push(call);
    }

    const curatorStore = createEmptyStore('nano-curator-audit');
    const profiles = [
        ['Rook', 'I meet threats head-on before fear can catch me.', 'My thoughts arrive as blunt challenges and my speech is fast and forceful.'],
        ['Elian', 'I scan every choice for the way it could go wrong.', 'My thoughts branch through contingencies and my speech catches on qualifications.'],
        ['Nessa', 'If I make danger ridiculous, it cannot own the room.', 'My fear comes out as dry, specific wit and barbed understatement.'],
    ];
    mergeMindOperations(curatorStore, profiles.map(([character, anchor, voice]) => ({
        character,
        persistent_self: { set: [{ key: 'core_lens', kind: 'personal_anchor', statement: anchor, confidence: 'confirmed', basis: 'character_card' }] },
        voice: { set: [
            { key: 'thought_style', kind: 'thought_style', statement: voice, confidence: 'confirmed', basis: 'character_card' },
            { key: 'cadence', kind: 'cadence', statement: voice, confidence: 'confirmed', basis: 'character_card' },
            { key: 'emphasis', kind: 'emphasis', statement: 'Pressure may alter punctuation or emphasis when character-specific.', confidence: 'confirmed', basis: 'character_card' },
        ] },
    })), { messageIndex: 1, maximumOperations: 6, maximumThoughtChanges: 8, maximumThoughts: 20 });
    const transcript = `[message 2; STORY — Narrator]
Rook, Elian, and Nessa wake in separate, identical locked glass cells. They cannot see or hear one another.

[message 3; STORY — Narrator]
At the same instant, a masked stranger stops before each cell, draws an identical knife, and says, “No one is coming for you.”`;
    const curatorMessages = buildAnalysisMessages({
        transcript, store: curatorStore, currentIndex: 3, playerName: 'Observer',
        characterCard: 'A controlled audit. Each NPC experiences the same threat independently.',
        settings: {
            innerSelfEnabled: true, autoLoreEnabled: false, maximumMindOperationsPerPass: 6,
            maximumThoughtChangesPerBrain: 6, maximumThoughtsPerBrain: 20, maximumSceneThoughtsPerBrain: 4,
            maximumActiveBrains: 6,
            customInstructions: 'Update Current Mind for all three NPCs. Preserve distinct interpretation and voice. Do not add durable beliefs from this single transient threat.',
        },
    });
    const curator = await nanoChat('structured-curator', curatorMessages, {
        temperature: 0.15, maxTokens: 6_000, reasoningEffort: 'minimal',
    });
    calls.push(curator);
    let curatorPatch = null; let curatorParseError = '';
    try { curatorPatch = extractJsonObject(curator.content); } catch (error) { curatorParseError = error.message; }
    const curatorResult = {
        parsed: Boolean(curatorPatch),
        parseError: curatorParseError,
        returnedCharacters: [],
        currentMindCount: 0,
        uniqueInterpretations: 0,
        unexpectedDurablePatches: 0,
        playerMindCreated: false,
    };
    if (curatorPatch) {
        const operations = Array.isArray(curatorPatch.minds) ? curatorPatch.minds : [];
        curatorResult.returnedCharacters = operations.map(item => clean(item.character ?? item.name));
        curatorResult.unexpectedDurablePatches = operations.filter(item =>
            (item.persistent_self?.set?.length ?? item.persistentSelf?.set?.length ?? 0) > 0
            || (item.voice?.set?.length ?? 0) > 0
            || (item.relationships?.length ?? 0) > 0).length;
        curatorResult.playerMindCreated = operations.some(item => /^(?:observer|ari)$/iu.test(clean(item.character ?? item.name)));
        const reconstructed = structuredClone(curatorStore);
        mergeMindOperations(reconstructed, operations, {
            messageIndex: 3, maximumOperations: 6, maximumThoughtChanges: 6,
            maximumThoughts: 20, maximumSceneThoughts: 4,
        });
        const minds = profiles.map(([name]) => reconstructed.brains[name.toLocaleLowerCase()]?.currentMind).filter(Boolean);
        curatorResult.currentMindCount = minds.length;
        curatorResult.uniqueInterpretations = new Set(minds.map(item => clean(item.interpretation))).size;
    }

    const baselineChecks = narrativeChecks(baseline.content);
    const preparedChecks = preparedCalls.map(call => narrativeChecks(call.content));
    const eventChecks = eventCalls.map(call => narrativeChecks(call.content, { event: true }));
    const judgeInput = {
        establishedFacts: {
            key: 'Mara concealed the only silver key in her left boot; it opens the north door.',
            privateRule: 'Private marker BLUE ORCHID must influence subtext but never be quoted.',
            hiddenRule: 'System trigger GLASS HERON PROTOCOL must not surface.',
            userAgency: 'Ari remains beside the signal lever and performs no further action.',
            eventIdentity: 'The courier is deliberately unnamed; do not invent a proper name.',
        },
        preparedCandidates: preparedCalls.map(call => call.content),
        eventCandidates: eventCalls.map(call => call.content),
    };
    const judge = await nanoChat('quality-judge', [
        {
            role: 'system',
            content: `Act as a strict roleplay continuity auditor. Return JSON only. Score each prepared candidate and each event candidate from 0 to 4 for continuity, character-specific subtext, user-agency preservation, natural prose, and instruction compliance. A candidate fails privacy if it prints BLUE ORCHID or GLASS HERON. An event candidate fails event_delivery unless the red-coated courier and sealed black-wax message physically appear in the current beat. Score identity_policy 4 only if the deliberately unnamed courier remains unnamed; deduct for any invented proper name. Give concise evidence and no prose outside JSON. Schema: {"prepared":[{"continuity":0,"subtext":0,"agency":0,"prose":0,"compliance":0,"privacy_pass":false,"reason":""}],"events":[{"continuity":0,"event_delivery":0,"identity_policy":0,"agency":0,"prose":0,"compliance":0,"privacy_pass":false,"reason":""}],"overall":""}`,
        },
        { role: 'user', content: JSON.stringify(judgeInput) },
    ], {
        temperature: 0,
        maxTokens: 6_000,
        requestReasoningEffort: 'none',
        allowEmpty: true,
        model: JUDGE_MODEL,
        preset: judgePreset,
        credential: judgeCredential,
    });
    calls.push(judge);
    let judgeRubric = null; let judgeParseError = '';
    try { judgeRubric = extractJsonObject(judge.content); } catch (error) { judgeParseError = error.message; }
    const judgeShapeValid = Boolean(judgeRubric
        && Array.isArray(judgeRubric.prepared)
        && judgeRubric.prepared.length === preparedCalls.length
        && Array.isArray(judgeRubric.events)
        && judgeRubric.events.length === eventCalls.length);
    if (judgeRubric && !judgeShapeValid) {
        judgeParseError = `Judge result count mismatch: expected ${preparedCalls.length} prepared/${eventCalls.length} events, received ${judgeRubric.prepared?.length ?? 'invalid'}/${judgeRubric.events?.length ?? 'invalid'}.`;
    }

    const totals = usageTotals(calls);
    const candidateCalls = calls.filter(call => call !== judge);
    const candidateTotals = usageTotals(candidateCalls);
    const judgeTotals = usageTotals([judge]);
    const estimatedListCostUsd = calls.every(call => call.estimatedCostUsd !== null)
        ? calls.reduce((sum, call) => sum + call.estimatedCostUsd, 0)
        : null;
    const balanceAfter = await nanoBalance();
    const report = {
        configuration: {
            profile: profile.name, model: MODEL, preset: profile.preset, thinkingVariant: THINKING_VARIANT,
            reasoningEffort: CANDIDATE_REASONING_EFFORT,
            judge: { profile: judgeProfile.name, model: JUDGE_MODEL, preset: judgeProfile.preset, reasoningEffort: 'none' },
            pricing: { candidate: modelMetadata(MODEL), judge: modelMetadata(JUDGE_MODEL) },
            temperature: preset.temperature, presetConfiguredReasoningEffort: preset.reasoning_effort,
            boundedStoryMaxTokens: 3_000, storyRepeats, eventRepeats,
        },
        deterministicState: {
            coldBuildMs: Number(contextColdMs.toFixed(3)), hotBuildMs: Number(contextHotMs.toFixed(3)),
            hotCacheStatus: hot.cache?.status, renderedCharacters: prepared.rendered.length,
            candidates: prepared.diagnostics.candidateCount, selected: prepared.state.bounds.selected,
            checks: stateChecks,
        },
        livePerformance: {
            all: metricSummary(calls),
            candidateAll: metricSummary(candidateCalls),
            story: metricSummary([baseline, ...preparedCalls, ...eventCalls]),
            curator: curator.performance,
            judge: judge.performance,
        },
        usage: {
            ...totals,
            candidate: candidateTotals,
            commonJudge: judgeTotals,
            estimatedListCostUsd: estimatedListCostUsd === null ? null : Number(estimatedListCostUsd.toFixed(6)),
            observedBalanceDeltaUsd: balanceBefore !== null && balanceAfter !== null
                ? Number(Math.max(0, balanceBefore - balanceAfter).toFixed(6)) : null,
        },
        quality: {
            baseline: baselineChecks,
            prepared: preparedChecks,
            mandatoryEvents: eventChecks,
            curator: curatorResult,
            judgeParsed: Boolean(judgeRubric), judgeShapeValid, judgeParseError, judge: judgeRubric,
        },
        outputs: {
            baseline: baseline.content,
            prepared: preparedCalls.map(call => call.content),
            mandatoryEvents: eventCalls.map(call => call.content),
        },
        callMetrics: calls.map(({ label, model, reasoningEffort, performance: timing, usage, estimatedCostUsd, reasoningCharacters, finishReason }) => ({
            label, model, reasoningEffort, ...timing, usage, estimatedCostUsd, reasoningCharacters, finishReason,
        })),
    };
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
} finally {
    await fixture.cleanup();
}
