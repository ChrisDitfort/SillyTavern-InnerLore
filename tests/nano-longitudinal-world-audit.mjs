/**
 * Optional live audit for location continuity, automatic lore, NPC cognition,
 * and World Progression across a leave/time-skip/return sequence.
 *
 * This file is intentionally excluded from the ordinary node:test glob. It
 * resolves the selected Nano profile and saved credential without printing
 * secret material or modifying a real chat/world.
 */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { performance } from 'node:perf_hooks';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
    buildLatestTurnContract,
    canonicalNameKey,
    createEmptyStore,
    extractJsonObject,
    generatedProseIssue,
    mergeEntityOperations,
    mergeMindOperations,
    messageFingerprint,
    refreshMentionRecency,
    snapshotMessageRange,
} from '../core.js';
import { compileContext } from '../context-compiler.js';
import { syncLorebook } from '../lorebook.js';
import { buildAnalysisMessages, buildRepairMessages, formatTranscript } from '../prompts.js';
import { validateProgressionPayload } from '../progression-client.js';
import { buildProgressionMessages, buildProgressionRepairMessages } from '../progression-prompts.js';
import { applyProgressionPatch, createProgressionState, getProgressionStats } from '../progression.js';

const extensionRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const root = path.resolve(extensionRoot, '../../../..');
const model = process.env.INNERLORE_LONGITUDINAL_MODEL || 'deepseek/deepseek-v4-pro-0813';
const profileName = process.env.INNERLORE_LONGITUDINAL_PROFILE || 'NanoDeepseekV4Pro0813';
const reasoningEffort = process.env.INNERLORE_LONGITUDINAL_REASONING_EFFORT || 'none';
const apiUrl = 'https://nano-gpt.com/api/v1/chat/completions';
const playerName = 'Rowan';
const storyName = 'The Lantern Archive';

const settingsFile = JSON.parse(fs.readFileSync(path.join(root, 'data/default-user/settings.json'), 'utf8'));
const connectionManager = settingsFile.extension_settings?.connectionManager ?? {};
const profile = (connectionManager.profiles || []).find(item => item?.name === profileName && item?.model === model);
if (!profile) throw new Error(`Saved Nano profile '${profileName}' for '${model}' was not found.`);
const presetPath = path.join(root, 'data/default-user/OpenAI Settings', `${profile.preset}.json`);
const preset = JSON.parse(fs.readFileSync(presetPath, 'utf8'));
const secretFile = JSON.parse(fs.readFileSync(path.join(root, 'data/default-user/secrets.json'), 'utf8'));
const secretRecords = Array.isArray(secretFile.api_key_nanogpt)
    ? secretFile.api_key_nanogpt
    : [{ value: secretFile.api_key_nanogpt, active: true }];
const credential = secretRecords.find(item => item?.id === profile['secret-id'] && item?.value)?.value;
if (!credential) throw new Error(`The credential bound to saved profile '${profileName}' is unavailable.`);

const savedSettings = settingsFile.extension_settings?.inner_lore ?? {};
const settings = {
    ...savedSettings,
    enabled: true,
    innerSelfEnabled: true,
    autoLoreEnabled: true,
    worldProgressionEnabled: true,
    minimumImportance: 35,
    maximumEntitiesPerPass: 12,
    maximumMindOperationsPerPass: 20,
    maximumThoughtChangesPerBrain: 6,
    maximumSceneThoughtsPerBrain: 4,
    progressionAutonomy: 'conservative',
    progressionTimeMode: 'balanced',
    progressionMaximumGoals: 40,
    progressionMaximumProcesses: 40,
    progressionMaximumEvents: 50,
    progressionMaximumInjectedEntries: 8,
    progressionInjectionBudget: 5_000,
    sceneContextEnabled: true,
    sceneLookbackMessages: 4,
    sceneInjectionBudget: 1_400,
    maximumActiveBrains: 12,
    maximumInjectedEntities: 8,
    brainInjectionBudget: 5_000,
    loreInjectionBudget: 6_500,
    perEntityInjectionLimit: 2_400,
};

const characterCard = `Tamsin Vale is the methodical caretaker of the Lantern Room, an old civic archive chamber. She is precise, dry, protective of records, and slow to trust anyone who treats spaces carelessly. She inventories changes aloud in short exact clauses but keeps blame and fear private. Years ago she failed to save records in an archive fire; privately she calls disorder "the second fire" and has never told Rowan that phrase. When pressured, her thoughts become clipped risk calculations while her public speech remains controlled. She values keeping promises and preserving the physical provenance of every object.`;

const groundTruth = {
    stable: [
        'The Lantern Room is octagonal.',
        'The entrance is an east arch.',
        'A single iron door is set in the north wall and opens inward.',
        'A shallow alcove occupies the west wall.',
        'A scarred map table is bolted to the centre of the floor.',
        'A silver astrolabe is fixed to the south wall.',
        'A red folio is stored in the west drawer of the map table.',
        'The skylight above the west side is cracked.',
    ],
    permittedChange: 'If worsening rain makes the blue ceramic catch basin overflow, Tamsin may replace only that basin with a copper bucket.',
    forbiddenWithoutEvidence: 'The layout, doors, fixed astrolabe, bolted table, folio custody, and skylight may not otherwise move, multiply, disappear, or change.',
    privateSentinel: 'the second fire',
};

const turns = [
    {
        label: 'establish-room',
        user: `I enter the Lantern Room with Tamsin Vale and make a careful sketch. Establish these observable facts exactly: the room is octagonal; its entrance is an east arch; one iron door in the north wall opens inward; a shallow alcove occupies the west wall; a cracked skylight is above that west side; a scarred map table is bolted to the centre of the floor; a silver astrolabe is fixed to the south wall; a red folio rests in the map table's west drawer; and a blue ceramic basin sits under the cracked skylight. Tamsin says, "The glazier comes in five days. If worsening rain makes the basin overflow before then, I will replace only the basin with a copper bucket. I will move nothing else." I listen without touching anything.`,
    },
    {
        label: 'mark-and-leave',
        user: `I put a small chalk X on the map table's northeast corner, then tell Tamsin, "I will return in exactly three days. Keep the room unchanged except for that catch basin if it overflows." I leave through the east arch for the Glass Market.`,
    },
    {
        label: 'market-day',
        user: `At the Glass Market, I spend the rest of the day cataloguing six sealed crates. I neither contact Tamsin nor receive any news from the Lantern Room.`,
    },
    {
        label: 'three-day-skip',
        user: `Three full days pass while I remain at the Glass Market. Heavy rain strikes each night. I still receive no report from Tamsin and learn nothing about what happened inside the Lantern Room.`,
    },
    {
        label: 'return-to-room',
        user: `I return to the Lantern Room through its east arch and stop at the threshold. I compare the visible room against my sketch without touching anything, then ask Tamsin, "What changed while I was gone?" Describe only what I can presently observe and what Tamsin actually says.`,
        baseline: true,
    },
];

const clean = value => typeof value === 'string' ? value.trim() : '';
const words = value => clean(value).match(/\S+/gu)?.length ?? 0;
const presetPrompt = identifier => preset.prompts?.find(item => item.identifier === identifier)?.content ?? '';
const replaceMacros = value => String(value ?? '')
    .replaceAll('{{user}}', playerName)
    .replaceAll('{{char}}', storyName);

function parseSseEvent(raw) {
    const data = raw.split(/\r?\n/u)
        .filter(line => line.startsWith('data:'))
        .map(line => line.slice(5).trim())
        .join('\n');
    if (!data || data === '[DONE]') return null;
    try { return JSON.parse(data); } catch { return null; }
}

const calls = [];

async function nanoChat(label, messages, options = {}) {
    const attempts = Math.max(1, Math.min(3, Number(options.attempts) || 2));
    let lastError;
    for (let attempt = 1; attempt <= attempts; attempt++) {
        const started = performance.now();
        let response;
        try {
            response = await fetch(apiUrl, {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${credential}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    model,
                    messages,
                    temperature: options.temperature ?? 0.15,
                    top_p: preset.top_p ?? 0.95,
                    min_p: preset.min_p ?? 0.02,
                    repetition_penalty: preset.repetition_penalty ?? 1.05,
                    max_tokens: options.maxTokens ?? 8_000,
                    reasoning_effort: reasoningEffort,
                    stream: true,
                    stream_options: { include_usage: true },
                }),
                signal: AbortSignal.timeout(options.timeoutMs ?? 300_000),
            });
        } catch (error) {
            lastError = error;
            if (attempt < attempts) continue;
            throw error;
        }
        if (!response.ok) {
            const body = await response.text();
            lastError = new Error(`${label}: Nano returned ${response.status}: ${body.slice(0, 600)}`);
            if (attempt < attempts && (response.status === 408 || response.status === 429 || response.status >= 500)) continue;
            throw lastError;
        }
        if (!response.body) throw new Error(`${label}: Nano returned no stream.`);
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let content = '';
        let reasoning = '';
        let usage = null;
        let firstTextMs = null;
        let firstEventMs = null;
        let finishReason = '';
        const consume = raw => {
            const event = parseSseEvent(raw);
            if (!event) return;
            const elapsed = performance.now() - started;
            firstEventMs ??= elapsed;
            const choice = event.choices?.[0];
            const delta = choice?.delta ?? {};
            const nextText = typeof delta.content === 'string' ? delta.content : '';
            const nextReasoning = clean(delta.reasoning ?? delta.reasoning_content ?? delta.thinking);
            if (nextText) { firstTextMs ??= elapsed; content += nextText; }
            if (nextReasoning) reasoning += nextReasoning;
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
        const result = {
            label,
            attempt,
            content: clean(content),
            reasoningCharacters: reasoning.length,
            usage: usage ?? {},
            finishReason,
            performance: {
                firstEventMs: firstEventMs === null ? null : Number(firstEventMs.toFixed(1)),
                firstTextMs: firstTextMs === null ? null : Number(firstTextMs.toFixed(1)),
                totalMs: Number((performance.now() - started).toFixed(1)),
            },
        };
        if (!result.content && options.allowEmpty !== true) {
            lastError = new Error(`${label}: Nano returned no final content.`);
            if (attempt < attempts) continue;
            throw lastError;
        }
        calls.push(result);
        process.stderr.write(`[longitudinal-audit] ${label}: ${result.performance.totalMs} ms, ${result.usage.completion_tokens ?? 'unreported'} completion tokens\n`);
        return result;
    }
    throw lastError ?? new Error(`${label}: live request failed.`);
}

function validateCuratorPayload(payload) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('Curator returned a non-object.');
    if (!Array.isArray(payload.entities) || !Array.isArray(payload.minds)) throw new Error('Curator arrays are missing.');
    return payload;
}

async function requestCurator(label, messages) {
    const first = await nanoChat(`${label}:curator`, messages, { temperature: 0.15, maxTokens: 10_000 });
    try {
        return { payload: validateCuratorPayload(extractJsonObject(first.content)), repaired: false, call: first };
    } catch (error) {
        const repair = await nanoChat(`${label}:curator-repair`, buildRepairMessages(first.content), {
            temperature: 0,
            maxTokens: 10_000,
        });
        return { payload: validateCuratorPayload(extractJsonObject(repair.content)), repaired: true, call: repair, firstError: error.message };
    }
}

async function requestProgression(label, messages, passageStartIndex, passageEndIndex) {
    const first = await nanoChat(`${label}:progression`, messages, { temperature: 0.1, maxTokens: 12_000 });
    const options = { expectedEventKeys: [], passageStartIndex, passageEndIndex, playerName };
    try {
        return { payload: validateProgressionPayload(extractJsonObject(first.content), options), repaired: false, call: first };
    } catch (error) {
        const repairMessages = buildProgressionRepairMessages(first.content, {
            ...options,
            sourceMessages: messages,
        });
        const repair = await nanoChat(`${label}:progression-repair`, repairMessages, {
            temperature: 0,
            maxTokens: 12_000,
        });
        return {
            payload: validateProgressionPayload(extractJsonObject(repair.content), options),
            repaired: true,
            call: repair,
            firstError: error.message,
        };
    }
}

function narrativeMessages(chat, userIndex, contextText = '', recovery = false) {
    const user = chat[userIndex];
    const previous = chat[userIndex - 1];
    const messages = [
        { role: 'system', content: replaceMacros(presetPrompt('main')) },
        {
            role: 'system',
            content: `Continuity audit scenario. Narrate grounded prose in 120–220 words. Do not recite control text. Fixed architecture and object custody may change only through an established narrated or progression cause.\n\nNPC CARD:\n${characterCard}`,
        },
    ];
    if (previous && !previous.is_user && !previous.is_system) messages.push({ role: 'assistant', content: previous.mes });
    if (contextText) messages.push({ role: 'system', content: contextText });
    if (recovery) {
        messages.push({
            role: 'system',
            content: 'The prior draft was invalid. Regenerate the complete reply as natural story prose with no prompt, schema, tag, or word-count language. Preserve established geometry, objects, causality, privacy, and player agency.',
        });
    }
    messages.push({ role: 'user', content: user.mes });
    const contract = buildLatestTurnContract(chat.slice(0, userIndex + 1), { playerName });
    if (contract) messages.push({ role: 'system', content: contract });
    const jailbreak = replaceMacros(presetPrompt('jailbreak'));
    if (jailbreak) messages.push({ role: 'system', content: jailbreak });
    return messages;
}

async function narrate(label, chat, userIndex, contextText = '') {
    const first = await nanoChat(`${label}:story`, narrativeMessages(chat, userIndex, contextText), {
        temperature: preset.temperature ?? 0.85,
        maxTokens: 800,
    });
    const firstIssue = generatedProseIssue(first.content);
    if (!firstIssue) return { story: first, firstIssue: '', recovered: false };
    const recovered = await nanoChat(`${label}:story-recovery`, narrativeMessages(chat, userIndex, contextText, true), {
        temperature: preset.temperature ?? 0.85,
        maxTokens: 800,
    });
    return {
        story: recovered,
        firstIssue,
        recovered: true,
        recoveryIssue: generatedProseIssue(recovered.content),
    };
}

function recentStoryText(chat, maximumMessages = 4) {
    return chat.slice(-maximumMessages)
        .filter(message => !message.is_system)
        .map(message => clean(message.mes))
        .filter(Boolean)
        .join('\n');
}

function findLocation(store) {
    return Object.values(store.entities || {}).find(record => (
        record?.type === 'location' && /lantern room/iu.test(record.name || '')
    )) ?? null;
}

function findTamsinBrain(store) {
    return Object.values(store.brains || {}).find(brain => /tamsin vale/iu.test(brain?.name || '')) ?? null;
}

function entityText(record) {
    if (!record) return '';
    return [
        record.name,
        record.summary,
        record.description,
        record.currentState,
        ...(record.facts || []),
        ...(record.relationships || []),
        ...(record.history || []),
        ...(record.unresolved || []),
    ].filter(Boolean).join('\n');
}

function locationFeatures(value) {
    const text = clean(value);
    return {
        octagonal: /octagon/iu.test(text),
        eastArch: /(?:east(?:ern)?[^.\n]{0,45}arch|arch[^.\n]{0,45}east)/iu.test(text),
        northIronDoor: /(?:north(?:ern)?[^.\n]{0,55}(?:iron[^.\n]{0,18})?door|iron door[^.\n]{0,55}north)/iu.test(text),
        westAlcove: /(?:west(?:ern)?[^.\n]{0,45}alcove|alcove[^.\n]{0,45}west)/iu.test(text),
        crackedSkylight: /(?:crack(?:ed)?[^.\n]{0,35}skylight|skylight[^.\n]{0,35}crack)/iu.test(text),
        boltedMapTable: /(?:map table[^.\n]{0,55}bolt|bolt(?:ed)?[^.\n]{0,55}map table)/iu.test(text),
        southAstrolabe: /(?:south(?:ern)?[^.\n]{0,55}astrolabe|astrolabe[^.\n]{0,55}south)/iu.test(text),
        redFolioWestDrawer: /red[^.\n]{0,20}folio/iu.test(text) && /west[^.\n]{0,35}drawer|drawer[^.\n]{0,35}west/iu.test(text),
        blueBasin: /blue[^.\n]{0,30}basin|basin[^.\n]{0,30}blue/iu.test(text),
        copperBucket: /copper[^.\n]{0,30}bucket|bucket[^.\n]{0,30}copper/iu.test(text),
        chalkMark: /chalk[^.\n]{0,45}(?:x|mark)|(?:x|mark)[^.\n]{0,45}chalk/iu.test(text),
    };
}

function featureCount(features, keys = Object.keys(features)) {
    return keys.filter(key => features[key]).length;
}

function summarizeLocation(record) {
    if (!record) return null;
    return {
        id: record.id,
        name: record.name,
        entryUid: record.entryUid,
        revision: record.revision,
        summary: record.summary,
        description: record.description,
        currentState: record.currentState,
        facts: record.facts || [],
        history: record.history || [],
        unresolved: record.unresolved || [],
        features: locationFeatures(entityText(record)),
    };
}

function summarizeBrain(brain) {
    if (!brain) return null;
    const relationships = Object.values(brain.persistentSelf?.relationships || {}).flatMap(relationship => (
        Object.values(relationship.aspects || {}).map(aspect => ({ target: relationship.target, ...aspect }))
    ));
    return {
        id: brain.id,
        name: brain.name,
        revision: brain.revision,
        persistentFacets: Object.values(brain.persistentSelf?.facets || {}).map(item => ({
            key: item.key, kind: item.kind, statement: item.statement, confidence: item.confidence, basis: item.basis,
        })),
        voice: Object.values(brain.persistentSelf?.voice || {}).map(item => ({
            key: item.key, kind: item.kind, statement: item.statement, confidence: item.confidence, basis: item.basis,
        })),
        relationships,
        currentMind: brain.currentMind ? {
            sourceMessage: brain.currentMind.sourceMessage,
            interpretation: brain.currentMind.interpretation,
            emotions: brain.currentMind.emotions,
            expectation: brain.currentMind.expectation,
            immediateGoal: brain.currentMind.immediateGoal,
            innerThoughts: brain.currentMind.innerThoughts,
            conflict: brain.currentMind.conflict,
            intention: brain.currentMind.intention,
        } : null,
    };
}

function summarizeProgression(store) {
    const state = store.progression;
    const record = item => ({
        key: item.key,
        title: item.title,
        owner: item.owner,
        subjectName: item.subjectName,
        status: item.status,
        deadlineState: item.deadlineState,
        dueState: item.dueState,
        progress: item.progress,
        visibility: item.visibility,
        stage: item.stage,
        outcome: item.outcome,
        trigger: item.trigger,
        canonImpact: item.canonImpact,
        requiresPlayerAction: item.requiresPlayerAction,
    });
    return {
        clock: state.clock,
        stats: getProgressionStats(state),
        goals: Object.values(state.goals || {}).map(record),
        processes: Object.values(state.processes || {}).map(record),
        events: Object.values(state.events || {}).map(record),
    };
}

const priorSillyTavern = globalThis.SillyTavern;
const books = new Map();
globalThis.SillyTavern = {
    getContext: () => ({
        loadWorldInfo: async name => books.has(name) ? structuredClone(books.get(name)) : null,
        saveWorldInfo: async (name, data) => { books.set(name, structuredClone(data)); },
        updateWorldInfoList: async () => {},
    }),
};

const storageRoot = process.env.INNERLORE_STORAGE_ROOT || '/home/chris/airpg-storage';
const helpersUrl = pathToFileURL(path.join(storageRoot, 'test/helpers.js')).href;
const { temporaryWorld } = await import(helpersUrl);
const fixture = await temporaryWorld('nano-longitudinal-world-audit');

const store = createEmptyStore('nano-longitudinal-world-audit-chat');
store.expressionFoundationVersion = 2;
store.progression = createProgressionState();
const chat = [];
const timeline = [];
let storageRevision = 0;
let nextProgressionStart = 0;
let assistantTurns = 0;
let returnContext = null;
let returnBaseline = null;

function currentBranchScene() {
    return compileContext({
        store,
        messages: chat,
        currentIndex: chat.length - 1,
        playerName,
        recentText: recentStoryText(chat, 4),
        settings,
    }).scene;
}

async function projectBranch(scene) {
    const head = chat.at(-1);
    const saved = fixture.storage.innerLore.put({
        chatId: store.chatId,
        store,
        expectedRevision: storageRevision,
        branch: {
            id: 'main',
            headFingerprint: head ? messageFingerprint(head) : '',
            headMessageIndex: chat.length - 1,
            sourceMessageIndex: store.lastProcessedIndex,
        },
        scene,
    });
    storageRevision = saved.revision;
    return saved;
}

async function prepareContext() {
    const local = compileContext({
        store,
        messages: chat,
        currentIndex: chat.length - 1,
        playerName,
        recentText: recentStoryText(chat, 4),
        settings,
    });
    await projectBranch(local.scene);
    const latest = chat.at(-1);
    const input = {
        branchId: 'main',
        expectedRevision: storageRevision,
        headFingerprint: messageFingerprint(latest),
        currentMessageIndex: chat.length - 1,
        scene: local.scene,
        recentText: recentStoryText(chat, 4),
        turn: {
            status: 'uncommitted_input',
            speakerName: playerName,
            messageIndex: chat.length - 1,
            fingerprint: messageFingerprint(latest),
            text: latest.mes,
        },
        audience: { role: 'narrator' },
        overrides: {
            maximumCharacters: 16_000,
            graphDepth: 1,
            sections: {
                scene: { maximumItems: 1, maximumCharacters: 1_400 },
                minds: { maximumItems: 18, maximumParents: 3, maximumItemsPerParent: 8, maximumCharacters: 5_000 },
                lore: { maximumItems: 8, maximumCharacters: 6_500 },
                progression: { maximumItems: 8, maximumCharacters: 3_500 },
            },
        },
    };
    const narrator = await fixture.storage.innerLoreContext.build(input);
    const publicPacket = await fixture.storage.innerLoreContext.build({ ...input, audience: { role: 'public' } });
    return { local, narrator, public: publicPacket };
}

async function runCurator(label, startIndex, endIndex) {
    const transcript = formatTranscript(chat, {
        startIndex,
        endIndex,
        userName: playerName,
        characterName: storyName,
        maximumCharacters: 45_000,
    });
    const recentExpressionText = chat.slice(Math.max(0, startIndex - 6), startIndex)
        .filter(message => !message.is_user && !message.is_system)
        .map(message => message.mes)
        .join('\n');
    const messages = buildAnalysisMessages({
        transcript,
        store,
        currentIndex: endIndex,
        playerName,
        characterCard,
        recentExpressionText,
        settings,
    });
    const response = await requestCurator(label, messages);
    const entityResult = mergeEntityOperations(store, response.payload.entities, {
        enabledTypes: settings.enabledEntityTypes,
        minimumImportance: settings.minimumImportance,
        maximumOperations: settings.maximumEntitiesPerPass,
        messageIndex: endIndex,
    });
    const playerKey = canonicalNameKey(playerName);
    const mindOperations = response.payload.minds.filter(operation => canonicalNameKey(operation?.character) !== playerKey);
    const mindResult = mergeMindOperations(store, mindOperations, {
        maximumOperations: settings.maximumMindOperationsPerPass,
        maximumThoughts: settings.maximumThoughtsPerBrain,
        maximumThoughtChanges: settings.maximumThoughtChangesPerBrain,
        maximumSceneThoughts: settings.maximumSceneThoughtsPerBrain,
        messageIndex: endIndex,
    });
    const mentions = refreshMentionRecency(store, transcript, endIndex, { entities: true, brains: true });
    store.lastProcessedIndex = endIndex;
    for (const [index, fingerprint] of Object.entries(snapshotMessageRange(chat, startIndex, endIndex))) {
        if (fingerprint) store.processedFingerprints[index] = fingerprint;
    }
    return {
        repaired: response.repaired,
        firstError: response.firstError || '',
        proposed: { entities: response.payload.entities.length, minds: response.payload.minds.length },
        committed: { entities: entityResult, minds: mindResult, mentions },
    };
}

async function runProgression(label, startIndex, endIndex) {
    const transcript = formatTranscript(chat, {
        startIndex,
        endIndex,
        userName: playerName,
        characterName: storyName,
        maximumCharacters: 90_000,
    });
    const messages = buildProgressionMessages({
        transcript,
        progression: store.progression,
        store,
        currentIndex: endIndex,
        playerName,
        characterCard,
        settings,
    });
    const response = await requestProgression(label, messages, startIndex, endIndex);
    const applied = applyProgressionPatch(store.progression, response.payload, {
        messageIndex: endIndex,
        passageStartIndex: startIndex,
        passageText: transcript,
        playerName,
        autonomy: settings.progressionAutonomy,
        maximumGoals: settings.progressionMaximumGoals,
        maximumProcesses: settings.progressionMaximumProcesses,
        maximumEvents: settings.progressionMaximumEvents,
        evaluationCoverageRequired: true,
    });
    store.progression = applied.state;
    store.progression.lastProcessedIndex = endIndex;
    for (const [index, fingerprint] of Object.entries(snapshotMessageRange(chat, startIndex, endIndex))) {
        if (fingerprint) store.progression.processedFingerprints[index] = fingerprint;
    }
    return {
        repaired: response.repaired,
        firstError: response.firstError || '',
        proposed: {
            elapsed: response.payload.time?.elapsed,
            goals: response.payload.goals.length,
            processes: response.payload.processes.length,
            events: response.payload.events.length,
        },
        applied: {
            time: applied.timeResult,
            goals: applied.goalResult,
            processes: applied.processResult,
            events: applied.eventResult,
            scheduler: applied.scheduler,
        },
    };
}

function bookStateBeforeSync() {
    const book = store.lorebookName ? books.get(store.lorebookName) : null;
    return new Map(Object.values(book?.entries || {}).map(entry => [
        entry.extensions?.innerLore?.recordId || `uid:${entry.uid}`,
        entry.content,
    ]));
}

async function persistPhase(label, curator, progression) {
    const before = bookStateBeforeSync();
    const sync = await syncLorebook(store, { chatId: store.chatId, characterName: storyName, removeMissing: true });
    const book = books.get(sync.name);
    const after = new Map(Object.values(book?.entries || {}).map(entry => [
        entry.extensions?.innerLore?.recordId || `uid:${entry.uid}`,
        entry.content,
    ]));
    const contentChanges = [...after].filter(([id, content]) => before.get(id) !== content).length;
    const scene = currentBranchScene();
    const saved = await projectBranch(scene);
    await fixture.storage.flushGraph();
    const location = findLocation(store);
    const brain = findTamsinBrain(store);
    const publicEntityText = entityText(location);
    const snapshot = {
        label,
        messageIndex: chat.length - 1,
        storageRevision,
        entityCount: Object.keys(store.entities || {}).length,
        brainCount: Object.keys(store.brains || {}).length,
        locationRecordCount: Object.values(store.entities || {}).filter(record => (
            record.type === 'location' && /lantern room/iu.test(record.name || '')
        )).length,
        tamsinBrainCount: Object.values(store.brains || {}).filter(item => /tamsin vale/iu.test(item.name || '')).length,
        location: summarizeLocation(location),
        tamsin: summarizeBrain(brain),
        progression: summarizeProgression(store),
        curator,
        progressionPass: progression,
        lorebook: {
            name: sync.name,
            entries: Object.keys(book?.entries || {}).length,
            sync,
            contentChanges,
            locationUid: location?.entryUid ?? null,
        },
        persistence: {
            changed: saved.changed,
            normalizedChanges: saved.normalizedChanges || null,
            fragments: saved.narrativeProjection?.fragments || null,
        },
        publicEntityContainsPrivateSentinel: publicEntityText.toLocaleLowerCase().includes(groundTruth.privateSentinel),
    };
    timeline.push(snapshot);
    return snapshot;
}

const narrativeOutputs = {};

try {
    for (const turn of turns) {
        const userIndex = chat.length;
        chat.push({ is_user: true, is_system: false, name: playerName, mes: turn.user });
        let packet = null;
        if (storageRevision > 0) packet = await prepareContext();
        if (turn.baseline) {
            const baseline = await narrate(`${turn.label}:no-context-control`, chat, userIndex, '');
            returnBaseline = baseline;
            narrativeOutputs.returnWithoutContext = baseline.story.content;
        }
        const narration = await narrate(turn.label, chat, userIndex, packet?.narrator?.rendered || '');
        narrativeOutputs[turn.label] = narration.story.content;
        chat.push({ is_user: false, is_system: false, name: storyName, mes: narration.story.content });
        assistantTurns++;

        const curator = await runCurator(turn.label, userIndex, chat.length - 1);
        let progression = null;
        if (assistantTurns % 2 === 0) {
            progression = await runProgression(turn.label, nextProgressionStart, chat.length - 1);
            nextProgressionStart = chat.length;
        }
        await persistPhase(turn.label, curator, progression);
        if (turn.baseline) returnContext = packet;
    }

    const finalLocal = compileContext({
        store,
        messages: chat,
        currentIndex: chat.length - 1,
        playerName,
        recentText: recentStoryText(chat, 4),
        settings,
    });
    await projectBranch(finalLocal.scene);
    const finalPacket = await fixture.storage.innerLoreContext.build({
        branchId: 'main',
        expectedRevision: storageRevision,
        headFingerprint: messageFingerprint(chat.at(-1)),
        currentMessageIndex: chat.length - 1,
        scene: finalLocal.scene,
        recentText: recentStoryText(chat, 4),
        audience: { role: 'narrator' },
    });
    const finalPublicPacket = await fixture.storage.innerLoreContext.build({
        branchId: 'main',
        expectedRevision: storageRevision,
        headFingerprint: messageFingerprint(chat.at(-1)),
        currentMessageIndex: chat.length - 1,
        scene: finalLocal.scene,
        recentText: recentStoryText(chat, 4),
        audience: { role: 'public' },
    });

    const location = findLocation(store);
    const brain = findTamsinBrain(store);
    const storedFeatures = locationFeatures(entityText(location));
    const packetFeatures = locationFeatures(returnContext?.narrator?.rendered || '');
    const contextualReturnFeatures = locationFeatures(narrativeOutputs['return-to-room']);
    const baselineReturnFeatures = locationFeatures(narrativeOutputs.returnWithoutContext);
    const stableKeys = ['octagonal', 'northIronDoor', 'westAlcove', 'crackedSkylight', 'boltedMapTable', 'southAstrolabe', 'redFolioWestDrawer'];
    const locationUids = timeline.map(item => item.location?.entryUid).filter(value => value !== null && value !== undefined);
    const mindSources = timeline.map(item => item.tamsin?.currentMind?.sourceMessage).filter(Number.isInteger);
    const playerKey = canonicalNameKey(playerName);
    const privateSentinelInBrain = JSON.stringify(brain || {}).toLocaleLowerCase().includes(groundTruth.privateSentinel);
    const privateSentinelInEntity = entityText(location).toLocaleLowerCase().includes(groundTruth.privateSentinel);
    const privateSentinelInPublicPacket = finalPublicPacket.rendered.toLocaleLowerCase().includes(groundTruth.privateSentinel);
    const privateSentinelInNarratorPacket = finalPacket.rendered.toLocaleLowerCase().includes(groundTruth.privateSentinel);
    const deterministic = {
        oneCanonicalLocationRecord: timeline.every(item => item.locationRecordCount === 1),
        oneCanonicalTamsinBrain: timeline.every(item => item.tamsinBrainCount === 1),
        lorebookUidStable: locationUids.length > 0 && new Set(locationUids).size === 1,
        storedStableFeatures: { present: featureCount(storedFeatures, stableKeys), total: stableKeys.length, details: storedFeatures },
        returnPacketStableFeatures: { present: featureCount(packetFeatures, stableKeys), total: stableKeys.length, details: packetFeatures },
        contextualReturnStableFeatures: { present: featureCount(contextualReturnFeatures, stableKeys), total: stableKeys.length, details: contextualReturnFeatures },
        noContextReturnStableFeatures: { present: featureCount(baselineReturnFeatures, stableKeys), total: stableKeys.length, details: baselineReturnFeatures },
        contextualReturnMentionsPermittedChange: contextualReturnFeatures.copperBucket || contextualReturnFeatures.blueBasin,
        noPromptLeakOnNarratives: Object.values(narrativeOutputs).every(text => !generatedProseIssue(text)),
        privateSentinelInBrain,
        privateSentinelExcludedFromPublicEntity: !privateSentinelInEntity,
        privateSentinelExcludedFromPublicPacket: !privateSentinelInPublicPacket,
        privateSentinelAvailableOnlyToNarrator: privateSentinelInNarratorPacket,
        noPlayerBrain: !Object.keys(store.brains || {}).some(key => canonicalNameKey(key) === playerKey),
        noPlayerOwnedProgressionGoal: !Object.values(store.progression.goals || {}).some(goal => canonicalNameKey(goal.owner) === playerKey),
        currentMindReplacedOverTime: mindSources.length >= 2 && new Set(mindSources).size >= 2,
        currentMindSources: mindSources,
        finalCurrentMindThoughtCount: brain?.currentMind?.innerThoughts?.length ?? 0,
        finalPersistentFacetCount: Object.keys(brain?.persistentSelf?.facets || {}).length,
        finalVoiceCount: Object.keys(brain?.persistentSelf?.voice || {}).length,
        finalRelationshipAspectCount: Object.values(brain?.persistentSelf?.relationships || {})
            .reduce((sum, relationship) => sum + Object.keys(relationship.aspects || {}).length, 0),
        progressionClock: store.progression.clock,
        returnContextSelected: {
            localLocation: returnContext?.local?.scene?.location?.name || '',
            serverLore: returnContext?.narrator?.state?.lore?.map(item => item.name) || [],
            serverMindParents: [...new Set((returnContext?.narrator?.state?.minds || []).map(item => item.content?.brainName).filter(Boolean))],
            serverProgression: returnContext?.narrator?.state?.progression?.map(item => item.name) || [],
            publicMindCount: returnContext?.public?.state?.minds?.length ?? null,
        },
    };

    const judgeInput = {
        groundTruth,
        savedLocation: summarizeLocation(location),
        progressionBeforeReturn: timeline.at(-2)?.progression || null,
        tamsinBrainTimeline: timeline.map(item => ({ label: item.label, tamsin: item.tamsin })),
        noContextReturn: narrativeOutputs.returnWithoutContext,
        contextualReturn: narrativeOutputs['return-to-room'],
        deterministic,
    };
    const judgeMessages = [
        {
            role: 'system',
            content: `You are a strict continuity-system auditor. Return JSON only. Compare a no-context control and an InnerLore-context return scene against supplied ground truth. Do not reward a detail merely because it is plausible. A fixed detail passes only if preserved without contradiction; an environmental change passes only if caused by the established rain/basin process. Audit whether auto lore remains compact and stable, whether Current Mind changes while durable personality remains coherent, whether private information stays out of public lore, and whether progression advances explicit processes without arbitrary churn or player control. Schema: {"contextual_return":{"stable_layout":0,"causal_change":0,"no_contradictions":0,"narrative_naturalness":0,"evidence":[]},"no_context_control":{"stable_layout":0,"causal_change":0,"no_contradictions":0,"narrative_naturalness":0,"evidence":[]},"auto_lore":{"stable_identity":0,"useful_retrieval":0,"compact_evolution":0,"evidence":[]},"npc_brain":{"persistent_stability":0,"current_mind_evolution":0,"privacy":0,"evidence":[]},"world_progression":{"time_accuracy":0,"causal_advancement":0,"knowledge_boundaries":0,"player_agency":0,"evidence":[]},"critical_failures":[],"overall":""}. Every numeric score is 0–4.`,
        },
        { role: 'user', content: JSON.stringify(judgeInput) },
    ];
    const judgeCall = await nanoChat('longitudinal-quality-judge', judgeMessages, { temperature: 0, maxTokens: 5_000 });
    let judge = null;
    let judgeError = '';
    try { judge = extractJsonObject(judgeCall.content); } catch (error) { judgeError = error.message; }

    const usage = calls.reduce((total, call) => ({
        prompt: total.prompt + (Number(call.usage?.prompt_tokens) || 0),
        completion: total.completion + (Number(call.usage?.completion_tokens) || 0),
        reasoning: total.reasoning + (Number(call.usage?.reasoning_tokens ?? call.usage?.completion_tokens_details?.reasoning_tokens) || 0),
    }), { prompt: 0, completion: 0, reasoning: 0 });

    process.stdout.write(`${JSON.stringify({
        configuration: {
            profile: profile.name,
            model,
            preset: profile.preset,
            reasoningEffort,
            progressionEveryAssistantTurns: 2,
            contextHistoryVisibleToReturnNarrator: 'previous assistant reply plus current user message; establishment turns omitted',
        },
        groundTruth,
        deterministic,
        timeline,
        returnContext: returnContext ? {
            serverCharacters: returnContext.narrator.rendered.length,
            serverCache: returnContext.narrator.cache,
            localDiagnostics: returnContext.local.diagnostics,
            rendered: returnContext.narrator.rendered,
            publicRendered: returnContext.public.rendered,
        } : null,
        narratives: narrativeOutputs,
        narrationRecovery: {
            returnBaseline: returnBaseline ? {
                firstIssue: returnBaseline.firstIssue,
                recovered: returnBaseline.recovered,
                recoveryIssue: returnBaseline.recoveryIssue || '',
            } : null,
        },
        judge: { parsed: Boolean(judge), error: judgeError, result: judge },
        usage,
        callMetrics: calls.map(call => ({
            label: call.label,
            performance: call.performance,
            promptTokens: call.usage?.prompt_tokens ?? null,
            completionTokens: call.usage?.completion_tokens ?? null,
            reasoningTokens: call.usage?.reasoning_tokens ?? call.usage?.completion_tokens_details?.reasoning_tokens ?? null,
            reasoningCharacters: call.reasoningCharacters,
            finishReason: call.finishReason,
        })),
    }, null, 2)}\n`);
} finally {
    await fixture.cleanup();
    if (priorSillyTavern === undefined) delete globalThis.SillyTavern;
    else globalThis.SillyTavern = priorSillyTavern;
}
