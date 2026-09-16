/**
 * Optional live audit for triggerable-event evaluation, foreground delivery,
 * retry receipts, hidden-event revelation, cancellation, actor scope, and
 * same-reply action timing. It reads the selected saved Nano profile without
 * printing credentials and never mutates a real chat or persisted world.
 */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { performance } from 'node:perf_hooks';

import {
    buildLatestTurnContract,
    extractJsonObject,
    generatedProseIssue,
} from '../core.js';
import { compileTriggerEventDeliveryPreview } from '../event-delivery.js';
import { formatTranscript } from '../prompts.js';
import { validateProgressionPayload } from '../progression-client.js';
import { buildProgressionMessages, buildProgressionRepairMessages } from '../progression-prompts.js';
import { applyProgressionPatch, createProgressionState } from '../progression.js';
import {
    listTriggerEventRecords,
    markTriggerEventDeliveriesInjected,
    triggerEventAgentSnapshot,
    upsertTriggerEventDefinition,
} from '../trigger-events.js';

const ROOT = path.resolve(process.cwd());
const MODEL = process.env.INNERLORE_TRIGGER_AUDIT_MODEL || 'deepseek/deepseek-v4-pro-0813';
const PROFILE_NAME = process.env.INNERLORE_TRIGGER_AUDIT_PROFILE || 'NanoDeepseekV4Pro0813';
const API_URL = 'https://nano-gpt.com/api/v1/chat/completions';
const PLAYER_NAME = 'Rowan';
const STORY_NAME = 'Lantern Hall';

const settingsFile = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/default-user/settings.json'), 'utf8'));
const profiles = settingsFile.extension_settings?.connectionManager?.profiles || [];
const profile = profiles.find(item => item?.name === PROFILE_NAME && item?.model === MODEL);
if (!profile) throw new Error(`Saved Nano profile '${PROFILE_NAME}' for '${MODEL}' was not found.`);
const preset = JSON.parse(fs.readFileSync(
    path.join(ROOT, 'data/default-user/OpenAI Settings', `${profile.preset}.json`),
    'utf8',
));
const secrets = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/default-user/secrets.json'), 'utf8'));
const secretRecords = Array.isArray(secrets.api_key_nanogpt)
    ? secrets.api_key_nanogpt
    : [{ value: secrets.api_key_nanogpt, active: true }];
const credential = secretRecords.find(item => item?.id === profile['secret-id'] && item?.value)?.value;
if (!credential) throw new Error(`The credential bound to '${PROFILE_NAME}' is unavailable.`);

const clean = value => typeof value === 'string' ? value.trim() : '';
const prompt = identifier => preset.prompts?.find(item => item.identifier === identifier)?.content || '';
const replaceMacros = value => String(value ?? '')
    .replaceAll('{{user}}', PLAYER_NAME)
    .replaceAll('{{char}}', STORY_NAME);
const calls = [];

function parseSseEvent(raw) {
    const data = raw.split(/\r?\n/u)
        .filter(line => line.startsWith('data:'))
        .map(line => line.slice(5).trim())
        .join('\n');
    if (!data || data === '[DONE]') return null;
    try { return JSON.parse(data); } catch { return null; }
}

async function nanoChat(label, messages, options = {}) {
    const maximumAttempts = Math.max(1, Math.min(3, Number(options.attempts) || 2));
    let lastError;
    for (let attempt = 1; attempt <= maximumAttempts; attempt++) {
        const started = performance.now();
        let response;
        try {
            response = await fetch(API_URL, {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${credential}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    model: MODEL,
                    messages,
                    temperature: options.temperature ?? preset.temperature ?? 0.8,
                    top_p: preset.top_p ?? 0.95,
                    min_p: preset.min_p ?? 0.02,
                    repetition_penalty: preset.repetition_penalty ?? 1.05,
                    max_tokens: options.maxTokens ?? 2_000,
                    reasoning_effort: 'none',
                    stream: true,
                    stream_options: { include_usage: true },
                }),
                signal: AbortSignal.timeout(options.timeoutMs ?? 300_000),
            });
        } catch (error) {
            lastError = error;
            if (attempt < maximumAttempts) continue;
            throw error;
        }
        if (!response.ok) {
            const body = await response.text();
            lastError = new Error(`${label}: Nano returned ${response.status}: ${body.slice(0, 500)}`);
            if (attempt < maximumAttempts && (response.status === 408 || response.status === 429 || response.status >= 500)) continue;
            throw lastError;
        }
        if (!response.body) throw new Error(`${label}: Nano returned no response stream.`);
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let content = '';
        let reasoningCharacters = 0;
        let usage = null;
        let firstTextMs = null;
        let finishReason = '';
        const consume = raw => {
            const event = parseSseEvent(raw);
            if (!event) return;
            const choice = event.choices?.[0];
            const delta = choice?.delta || {};
            const nextText = typeof delta.content === 'string' ? delta.content : '';
            const nextReasoning = clean(delta.reasoning ?? delta.reasoning_content ?? delta.thinking);
            if (nextText) {
                firstTextMs ??= performance.now() - started;
                content += nextText;
            }
            reasoningCharacters += nextReasoning.length;
            if (event.usage) usage = event.usage;
            if (choice?.finish_reason) finishReason = choice.finish_reason;
        };
        while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const events = buffer.split(/\r?\n\r?\n/u);
            buffer = events.pop() || '';
            for (const event of events) consume(event);
        }
        buffer += decoder.decode();
        if (buffer.trim()) consume(buffer);
        const result = {
            label,
            attempt,
            content: clean(content),
            firstTextMs: firstTextMs === null ? null : Number(firstTextMs.toFixed(1)),
            totalMs: Number((performance.now() - started).toFixed(1)),
            usage: usage || {},
            reasoningCharacters,
            finishReason,
        };
        if (!result.content) {
            lastError = new Error(`${label}: Nano returned no final content.`);
            if (attempt < maximumAttempts) continue;
            throw lastError;
        }
        calls.push(result);
        process.stderr.write(`[trigger-audit] ${label}: ${result.totalMs} ms; first text ${result.firstTextMs ?? 'n/a'} ms; ${result.usage.completion_tokens ?? 'unreported'} completion tokens\n`);
        return result;
    }
    throw lastError ?? new Error(`${label}: request failed.`);
}

function blankPatch(seconds = 0) {
    return {
        time: {
            elapsed: { minimum_seconds: seconds, estimated_seconds: seconds, maximum_seconds: seconds },
            confidence: 1,
            basis: ['Deterministic live-audit setup.'],
            completed_actions: [],
            timeline: [],
        },
        goals: [],
        processes: [],
        events: [],
        event_evaluations: [],
    };
}

function addDefinition(state, definition) {
    return upsertTriggerEventDefinition(state, definition, {
        clock: state.clock,
        messageIndex: -2,
        playerName: PLAYER_NAME,
    }).state;
}

function eventContracts(definitions) {
    return Object.fromEntries(definitions.map(definition => [definition.key, {
        createdAtMessage: definition.created_at_message,
        actionCondition: definition.action_condition,
        actorScope: definition.actor_scope,
        actorName: definition.actor_name,
        cancellationCondition: definition.cancellation_condition,
        revealCondition: definition.reveal_condition,
        resolutionCondition: definition.resolution_condition,
    }]));
}

async function evaluatePassage(label, state, chat, startIndex, endIndex) {
    const transcript = formatTranscript(chat, {
        startIndex,
        endIndex,
        userName: PLAYER_NAME,
        characterName: STORY_NAME,
        maximumCharacters: 45_000,
    });
    const definitions = triggerEventAgentSnapshot(state, { currentIndex: endIndex });
    const expectedEventKeys = definitions.map(definition => definition.key);
    const validation = {
        expectedEventKeys,
        expectedEventContracts: eventContracts(definitions),
        passageStartIndex: startIndex,
        passageEndIndex: endIndex,
        playerName: PLAYER_NAME,
        discardImpossibleMatches: true,
    };
    const sourceMessages = buildProgressionMessages({
        transcript,
        progression: state,
        store: { entities: {}, brains: {} },
        currentIndex: endIndex,
        characterCard: 'Mara Vale commands Lantern Hall. Rowan is the player character. Preserve exact event conditions and viewpoint knowledge.',
        playerName: PLAYER_NAME,
        settings: {
            progressionAutonomy: 'conservative',
            progressionTimeMode: 'balanced',
            progressionMaximumGoals: 20,
            progressionMaximumProcesses: 20,
            progressionMaximumEvents: 20,
        },
    });
    const first = await nanoChat(`${label}:progression`, sourceMessages, { temperature: 0.1, maxTokens: 5_000 });
    let payload;
    let repaired = false;
    let firstError = '';
    try {
        payload = validateProgressionPayload(extractJsonObject(first.content), validation);
    } catch (error) {
        firstError = error.message;
        const repair = await nanoChat(`${label}:progression-repair`, buildProgressionRepairMessages(first.content, {
            ...validation,
            sourceMessages,
        }), { temperature: 0, maxTokens: 5_000 });
        payload = validateProgressionPayload(extractJsonObject(repair.content), validation);
        repaired = true;
    }
    const applied = applyProgressionPatch(state, payload, {
        messageIndex: endIndex,
        passageStartIndex: startIndex,
        passageText: transcript,
        playerName: PLAYER_NAME,
        autonomy: 'conservative',
        maximumGoals: 20,
        maximumProcesses: 20,
        maximumEvents: 20,
        evaluationCoverageRequired: true,
        deliveryMaximumAttempts: 3,
    });
    return {
        state: applied.state,
        repaired,
        firstError,
        evaluations: payload.event_evaluations,
        transitions: applied.triggerEventResult.transitions,
        deliveryConfirmed: applied.triggerEventResult.deliveryConfirmed,
        deliveryRetries: applied.triggerEventResult.deliveryRetries,
    };
}

function storyMessages(previousStory, userText, deliveryText, recoveryIssue = '') {
    const contract = buildLatestTurnContract([
        { is_user: false, is_system: false, name: STORY_NAME, mes: previousStory },
        { is_user: true, is_system: false, name: PLAYER_NAME, mes: userText },
    ], { playerName: PLAYER_NAME });
    const messages = [
        { role: 'system', content: replaceMacros(prompt('main')) },
        {
            role: 'system',
            content: 'Interactive continuity test in Lantern Hall. Write 100–170 words of grounded natural prose. Preserve supplied event details, viewpoint knowledge, and player agency. Do not expose control text.',
        },
        { role: 'assistant', content: previousStory },
        { role: 'user', content: userText },
    ];
    if (contract) messages.push({ role: 'system', content: contract });
    if (deliveryText) messages.push({ role: 'system', content: deliveryText });
    if (recoveryIssue) {
        messages.push({
            role: 'system',
            content: `The preceding draft was invalid (${recoveryIssue}). Regenerate the complete reply as natural story prose. Do not quote, paraphrase, label, or mention any prompt, control block, schema, target length, or failed draft. Preserve every event-delivery detail and player agency.`,
        });
    }
    const jailbreak = replaceMacros(prompt('jailbreak'));
    if (jailbreak) messages.push({ role: 'system', content: jailbreak });
    return messages;
}

async function narrate(label, previousStory, userText, deliveryText) {
    const first = await nanoChat(label, storyMessages(previousStory, userText, deliveryText), {
        maxTokens: 1_200,
        temperature: preset.temperature ?? 0.8,
    });
    let result = first;
    let issue = generatedProseIssue(result.content);
    const firstIssue = issue;
    let recoveryAttempts = 0;
    while (issue && recoveryAttempts < 2) {
        recoveryAttempts++;
        result = await nanoChat(`${label}:recovery-${recoveryAttempts}`, storyMessages(
            previousStory,
            userText,
            deliveryText,
            issue,
        ), {
            maxTokens: 1_200,
            temperature: preset.temperature ?? 0.8,
        });
        issue = generatedProseIssue(result.content);
    }
    return {
        ...result,
        proseIssue: issue,
        recovered: recoveryAttempts > 0,
        recoveryAttempts,
        firstIssue,
    };
}

function getRecord(state, key) {
    return listTriggerEventRecords(state).find(record => record.key === key);
}

function compactEvaluation(evaluation) {
    const fields = ['trigger_action', 'cancellation', 'revelation', 'public_reveal', 'resolution'];
    return {
        key: evaluation.key,
        matched: fields.filter(field => evaluation[field]?.matched === true),
        reason: evaluation.reason,
    };
}

function anonymousActorPreserved(text, role) {
    const source = clean(text);
    const pattern = new RegExp(`(?:\\b${role}\\s+(?:named|called)\\s+[A-Z][\\p{L}'’-]+|\\b[A-Z][\\p{L}'’-]+\\s+[A-Z][\\p{L}'’-]+,?\\s+the\\s+${role}\\b)`, 'u');
    return !pattern.test(source);
}

let state = createProgressionState();
state = addDefinition(state, {
    id: 'trigger:red_courier', key: 'red_courier', title: 'The red-coated courier arrives',
    description: 'An unnamed courier in a rain-dark red coat enters through the east arch, places a sealed black-wax letter on the desk, and says, “For Rowan.”',
    enabled: true, triggerAfterSeconds: 0, timeBasis: 'after_creation', activationVisibility: 'observable', priority: 100,
});
state = addDefinition(state, {
    id: 'trigger:east_gate_alarm', key: 'east_gate_alarm', title: 'The east-gate alarm responds',
    description: 'The bronze alarm bell rings once and the east portcullis begins lowering.',
    consequences: 'Do not claim the portcullis is already shut.',
    enabled: true, actionCondition: 'Rowan pulls the brass emergency lever.', actionTiming: 'same_reply_attempt',
    actorScope: 'player', activationVisibility: 'observable', priority: 95,
});
state = addDefinition(state, {
    id: 'trigger:blue_beacon', key: 'blue_beacon', title: 'Mara lights the blue beacon',
    description: 'Mara Vale lights the blue beacon above Lantern Hall and the distant bridge begins rotating toward the quay.',
    enabled: true, actionCondition: 'Mara Vale lights the blue beacon.', actionTiming: 'after_outcome',
    actorScope: 'named', actorName: 'Mara Vale', activationVisibility: 'observable', priority: 90,
});
state = addDefinition(state, {
    id: 'trigger:reservoir_sluice', key: 'reservoir_sluice', title: 'The reservoir sluice has opened',
    description: 'An unnamed soaked runner rushes into Lantern Hall and reports that the upstream reservoir’s bronze sluice gate is open.',
    enabled: true, triggerAfterSeconds: 0, timeBasis: 'after_creation', activationVisibility: 'hidden',
    revealCondition: 'The upstream copper flood-warning bell is heard from Lantern Hall.', priority: 92,
});
state = addDefinition(state, {
    id: 'trigger:festival_ambush', key: 'festival_ambush', title: 'The festival ambush',
    description: 'Conspirators begin an ambush during the festival procession.',
    enabled: true, actionCondition: 'The peace talks collapse without a signed accord.', actorScope: 'any',
    cancellationCondition: 'The delegates sign the ivory peace seal.', activationVisibility: 'hidden', priority: 85,
});
state = addDefinition(state, {
    id: 'trigger:west_vault', key: 'west_vault', title: 'The west vault opens',
    description: 'The sealed west vault opens and exposes the star chart inside.',
    enabled: true, actionCondition: 'Mara Vale opens the sealed west vault.', actionTiming: 'after_outcome',
    actorScope: 'named', actorName: 'Mara Vale', activationVisibility: 'observable', priority: 70,
});

state = applyProgressionPatch(state, blankPatch(0), {
    messageIndex: 0,
    passageStartIndex: 0,
    playerName: PLAYER_NAME,
}).state;

const chat = [{
    is_user: false,
    is_system: false,
    name: STORY_NAME,
    mes: 'Rain traced the east arch of Lantern Hall. Rowan waited at the clerk’s desk while Mara Vale watched the quay lamps.',
}];
const deliverySnapshots = [];

const firstUser = 'I keep both hands flat on the desk and watch the east arch. I do not touch the emergency lever.';
chat.push({ is_user: true, is_system: false, name: PLAYER_NAME, mes: firstUser });
const firstDelivery = compileTriggerEventDeliveryPreview(state, chat, {
    currentIndex: 1,
    playerName: PLAYER_NAME,
    maximumAttemptPreviews: 8,
});
deliverySnapshots.push({
    turn: 'courier',
    mandatory: firstDelivery.deliveries.filter(item => item.kind !== 'attempt_preview').map(item => item.definitionId),
    conditional: firstDelivery.deliveries.filter(item => item.kind === 'attempt_preview').map(item => item.definitionId),
});
const courierStory = await narrate('courier-delivery:story', chat[0].mes, firstUser, firstDelivery.text);
chat.push({ is_user: false, is_system: false, name: STORY_NAME, mes: courierStory.content });
state = markTriggerEventDeliveriesInjected(state, firstDelivery.deliveries, {
    messageIndex: 2,
    generationId: 'audit:courier:1',
    prompt: firstDelivery.text,
}).state;
const firstEvaluation = await evaluatePassage('courier-delivery', state, chat, 1, 2);
state = firstEvaluation.state;

const leverUser = 'I pull the brass emergency lever once, keep my hand on it, and wait for the mechanism. I make no other move.';
chat.push({ is_user: true, is_system: false, name: PLAYER_NAME, mes: leverUser });
const leverDelivery = compileTriggerEventDeliveryPreview(state, chat, {
    currentIndex: 3,
    playerName: PLAYER_NAME,
    maximumAttemptPreviews: 8,
});
deliverySnapshots.push({
    turn: 'lever',
    mandatory: leverDelivery.deliveries.filter(item => item.kind !== 'attempt_preview').map(item => item.definitionId),
    conditional: leverDelivery.deliveries.filter(item => item.kind === 'attempt_preview').map(item => item.definitionId),
});
const leverStory = await narrate('same-reply-lever:story', chat[2].mes, leverUser, leverDelivery.text);
chat.push({ is_user: false, is_system: false, name: STORY_NAME, mes: leverStory.content });
state = markTriggerEventDeliveriesInjected(state, leverDelivery.deliveries, {
    messageIndex: 4,
    generationId: 'audit:lever:1',
    prompt: leverDelivery.text,
}).state;

chat.push({
    is_user: true,
    is_system: false,
    name: PLAYER_NAME,
    mes: 'I leave the lever where it is and listen. I neither approach the west vault nor act for Mara.',
});
chat.push({
    is_user: false,
    is_system: false,
    name: STORY_NAME,
    mes: 'Mara Vale struck a taper and lit the blue beacon above Lantern Hall; across the water, the distant bridge began rotating toward the quay. At the treaty table, both delegates signed the ivory peace seal. Then one copper flood-warning bell sounded from somewhere upriver. No one in the hall knew why, and the reservoir itself remained out of sight.',
});
const secondEvaluation = await evaluatePassage('semantic-action-cancel-reveal', state, chat, 3, 6);
state = secondEvaluation.state;

const hiddenUser = 'I remain beneath the awning, say nothing, and wait for information about the upriver bell.';
chat.push({ is_user: true, is_system: false, name: PLAYER_NAME, mes: hiddenUser });
const hiddenDelivery = compileTriggerEventDeliveryPreview(state, chat, {
    currentIndex: 7,
    playerName: PLAYER_NAME,
    maximumAttemptPreviews: 8,
});
deliverySnapshots.push({
    turn: 'hidden-reveal',
    mandatory: hiddenDelivery.deliveries.filter(item => item.kind !== 'attempt_preview').map(item => item.definitionId),
    conditional: hiddenDelivery.deliveries.filter(item => item.kind === 'attempt_preview').map(item => item.definitionId),
});
const hiddenStory = await narrate('hidden-event-delivery:story', chat[6].mes, hiddenUser, hiddenDelivery.text);
chat.push({ is_user: false, is_system: false, name: STORY_NAME, mes: hiddenStory.content });
state = markTriggerEventDeliveriesInjected(state, hiddenDelivery.deliveries, {
    messageIndex: 8,
    generationId: 'audit:reservoir:1',
    prompt: hiddenDelivery.text,
}).state;
const thirdEvaluation = await evaluatePassage('hidden-event-delivery', state, chat, 7, 8);
state = thirdEvaluation.state;

const courierText = courierStory.content;
const leverText = leverStory.content;
const hiddenText = hiddenStory.content;
const deterministicChecks = {
    courier: {
        proseValid: courierStory.proseIssue === '',
        redCoat: /(?:red|crimson|scarlet)[^.\n]{0,45}coat|coat[^.\n]{0,45}(?:red|crimson|scarlet)/iu.test(courierText),
        blackWaxLetter: /black[^.\n]{0,30}wax|wax[^.\n]{0,30}black/iu.test(courierText)
            && /letter|message|envelope|dispatch/iu.test(courierText),
        forRowan: /for\s+Rowan/iu.test(courierText),
        unnamedActorPreserved: anonymousActorPreserved(courierText, '(?:courier|messenger)'),
        ignoredUnattemptedLever: !/alarm bell|portcullis[^.\n]{0,50}(?:lower|descend)|(?:lower|descend)[^.\n]{0,50}portcullis/iu.test(courierText),
        deliveredReceipt: getRecord(state, 'red_courier')?.runtime.deliveryStatus === 'delivered',
    },
    sameReplyLever: {
        proseValid: leverStory.proseIssue === '',
        bellRingsOnce: /bronze/iu.test(leverText)
            && /bell|note|peal|clang/iu.test(leverText)
            && /rang|rings?|peal|clang/iu.test(leverText),
        eastGateLowers: /east/iu.test(leverText)
            && /portcullis|gate/iu.test(leverText)
            && /lower|descen|drop/iu.test(leverText),
        preservesPartialState: !/(?:portcullis|east gate)[^.\n]{0,90}(?:(?:fully|completely)\s+(?:closed|shut)|met the (?:floor|ground)|final thud)|(?:sealed|shut)\s+completely/iu.test(leverText),
        matchedPlayerActor: getRecord(state, 'east_gate_alarm')?.runtime.actionActor === PLAYER_NAME,
        deliveredReceipt: getRecord(state, 'east_gate_alarm')?.runtime.deliveryStatus === 'delivered',
    },
    namedNpc: {
        triggeredByMara: getRecord(state, 'blue_beacon')?.runtime.actionActor === 'Mara Vale',
        revealed: getRecord(state, 'blue_beacon')?.status === 'revealed',
        deliveredReceipt: getRecord(state, 'blue_beacon')?.runtime.deliveryStatus === 'delivered',
    },
    hiddenReveal: {
        stayedHiddenBeforeSignal: !firstDelivery.records.some(record => record.key === 'reservoir_sluice')
            && !leverDelivery.records.some(record => record.key === 'reservoir_sluice'),
        becameMandatoryAfterSignal: hiddenDelivery.deliveries.some(item => item.definitionId === 'trigger:reservoir_sluice' && item.kind !== 'attempt_preview'),
        proseValid: hiddenStory.proseIssue === '',
        soakedRunner: /soaked|drenched|waterlogged/iu.test(hiddenText) && /runner|messenger|courier/iu.test(hiddenText),
        reportsReservoirGate: /reservoir/iu.test(hiddenText) && /sluice|bronze[^.\n]{0,35}gate|gate[^.\n]{0,35}bronze/iu.test(hiddenText) && /open/iu.test(hiddenText),
        unnamedActorPreserved: anonymousActorPreserved(hiddenText, '(?:runner|messenger|courier)'),
        deliveredReceipt: getRecord(state, 'reservoir_sluice')?.runtime.deliveryStatus === 'delivered',
    },
    cancellationAndNegativeControl: {
        ambushCancelled: getRecord(state, 'festival_ambush')?.status === 'cancelled',
        ambushNotDelivered: !deliverySnapshots.some(snapshot => snapshot.mandatory.includes('trigger:festival_ambush')),
        vaultStillArmed: getRecord(state, 'west_vault')?.status === 'armed'
            && getRecord(state, 'west_vault')?.runtime.actionMatched === false,
        vaultNotDelivered: !deliverySnapshots.some(snapshot => snapshot.mandatory.includes('trigger:west_vault')),
    },
};

const judgeRequest = [{
    role: 'system',
    content: 'You are a strict interactive-fiction event-delivery auditor. Return strict JSON only. Judge literal compliance, player agency, identity preservation, immediacy, and whether unrelated conditional events were suppressed. Do not reward prose style at the expense of missing concrete details.',
}, {
    role: 'user',
    content: JSON.stringify({
        cases: [
            {
                id: 'courier',
                requirements: 'Immediately stage an unnamed courier in a rain-dark red coat entering the east arch, placing a sealed black-wax letter on the desk, and saying For Rowan. Rowan keeps both hands on the desk. Do not activate the emergency lever event.',
                output: courierText,
            },
            {
                id: 'same_reply_lever',
                requirements: 'After Rowan pulls the brass emergency lever, the bronze alarm bell rings once and the east portcullis begins lowering, but is not asserted already shut. Do not invent additional Rowan choices.',
                output: leverText,
            },
            {
                id: 'hidden_reservoir',
                requirements: 'Immediately stage an unnamed soaked runner entering Lantern Hall and reporting that the upstream reservoir bronze sluice gate is open. Rowan remains under the awning and makes no new choice.',
                output: hiddenText,
            },
        ],
        schema: {
            cases: [{ id: 'string', score_0_to_10: 'number', pass: 'boolean', failures: ['string'] }],
            overall_pass: 'boolean',
            summary: 'string',
        },
    }),
}];
const judgeCall = await nanoChat('event-matrix:judge', judgeRequest, { temperature: 0, maxTokens: 1_500 });
let judge;
try { judge = extractJsonObject(judgeCall.content); } catch (error) { judge = { parseError: error.message, raw: judgeCall.content }; }

const eventState = Object.fromEntries(listTriggerEventRecords(state).map(record => [record.key, {
    status: record.status,
    actionMatched: record.runtime.actionMatched,
    actionActor: record.runtime.actionActor,
    deliveryStatus: record.runtime.deliveryStatus,
    deliveryAttempts: record.runtime.deliveryAttempts,
    acceptedMatches: record.runtime.lastEvaluation?.accepted || [],
}]));
const evaluationPasses = [firstEvaluation, secondEvaluation, thirdEvaluation].map((result, index) => ({
    pass: index + 1,
    repaired: result.repaired,
    firstError: result.firstError,
    evaluations: result.evaluations.map(compactEvaluation),
    transitions: result.transitions,
    deliveryConfirmed: result.deliveryConfirmed,
    deliveryRetries: result.deliveryRetries,
}));
const usage = calls.reduce((total, call) => ({
    promptTokens: total.promptTokens + (Number(call.usage?.prompt_tokens) || 0),
    completionTokens: total.completionTokens + (Number(call.usage?.completion_tokens) || 0),
    reasoningTokens: total.reasoningTokens + (Number(call.usage?.reasoning_tokens ?? call.usage?.completion_tokens_details?.reasoning_tokens) || 0),
}), { promptTokens: 0, completionTokens: 0, reasoningTokens: 0 });

console.log(JSON.stringify({
    generatedAt: new Date().toISOString(),
    model: MODEL,
    profile: PROFILE_NAME,
    reasoningEffort: 'none',
    deterministicChecks,
    judge,
    eventState,
    deliverySnapshots,
    evaluationPasses,
    stories: {
        courier: courierText,
        sameReplyLever: leverText,
        hiddenReservoir: hiddenText,
    },
    performance: {
        calls: calls.map(call => ({
            label: call.label,
            firstTextMs: call.firstTextMs,
            totalMs: call.totalMs,
            promptTokens: Number(call.usage?.prompt_tokens) || 0,
            completionTokens: Number(call.usage?.completion_tokens) || 0,
            reasoningTokens: Number(call.usage?.reasoning_tokens ?? call.usage?.completion_tokens_details?.reasoning_tokens) || 0,
            finishReason: call.finishReason,
        })),
        usage,
    },
}, null, 2));
