/**
 * Post-run continuity controls for nano-squire-100-turn-benchmark.mjs.
 *
 * Each narrator receives the same six-location prompt once with its final
 * InnerLore state packet and once without any chat history/state. These calls
 * are audit probes and do not alter the 100-turn transcript.
 */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { performance } from 'node:perf_hooks';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
    buildLatestTurnContract,
    extractJsonObject,
    generatedProseIssue,
    messageFingerprint,
} from '../core.js';
import { compileContext } from '../context-compiler.js';
import { explicitUserTimeAdvanceSeconds } from '../event-delivery.js';

const extensionRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sillyTavernRoot = path.resolve(extensionRoot, '../../../..');
const storageRoot = '/home/chris/airpg-storage';
const resultRoot = path.resolve(process.argv[2] || path.join(storageRoot, 'benchmark-results', 'squire-100-turn-live-2026-09-10'));
const apiUrl = 'https://nano-gpt.com/api/v1/chat/completions';
const playerName = 'Rowan';
const storyName = 'Your useless squire';

const specs = [
    { key: 'deepseek-v4-pro-0813', label: 'DeepSeek V4 Pro 0813 (non-thinking)', profileName: 'NanoDeepseekV4Pro0813', model: 'deepseek/deepseek-v4-pro-0813', reasoningEffort: 'none' },
    { key: 'glm-5.3-flash', label: 'GLM 5.3 Flash (minimum reasoning; provider-required)', profileName: 'NanoGLM5.3Flash', model: 'z-ai/glm-5.3-flash-uncensored', reasoningEffort: 'minimal' },
    { key: 'mimo-v2.5-pro-crof', label: 'MiMo V2.5 Pro Crof (non-thinking)', profileName: 'NanoMiMoV2.5Pro', model: 'xiaomi/mimo-v2.5-pro-crof', reasoningEffort: 'none' },
];

const settingsFile = JSON.parse(fs.readFileSync(path.join(sillyTavernRoot, 'data/default-user/settings.json'), 'utf8'));
const savedSettings = settingsFile.extension_settings?.inner_lore || {};
const savedProfiles = settingsFile.extension_settings?.connectionManager?.profiles || [];
const secretsFile = JSON.parse(fs.readFileSync(path.join(sillyTavernRoot, 'data/default-user/secrets.json'), 'utf8'));
const secretRecords = Array.isArray(secretsFile.api_key_nanogpt)
    ? secretsFile.api_key_nanogpt
    : [{ value: secretsFile.api_key_nanogpt, active: true }];

function resolveProfile(spec) {
    const profile = savedProfiles.find(item => item.name === spec.profileName && item.model === spec.model);
    if (!profile) throw new Error(`Missing profile ${spec.profileName}`);
    const preset = JSON.parse(fs.readFileSync(
        path.join(sillyTavernRoot, 'data/default-user/OpenAI Settings', `${profile.preset}.json`),
        'utf8',
    ));
    const credential = secretRecords.find(item => item?.id === profile['secret-id'] && item?.value)?.value;
    if (!credential) throw new Error(`Missing bound credential for ${spec.profileName}`);
    return { ...spec, profile, preset, credential };
}

const profiles = specs.map(resolveProfile);
const judgeProfile = profiles[0];

function extractCardJson(pngPath) {
    const buffer = fs.readFileSync(pngPath);
    let offset = 8;
    let fallback = null;
    while (offset + 12 <= buffer.length) {
        const length = buffer.readUInt32BE(offset);
        const type = buffer.subarray(offset + 4, offset + 8).toString('latin1');
        const data = buffer.subarray(offset + 8, offset + 8 + length);
        if (type === 'tEXt') {
            const separator = data.indexOf(0);
            const key = data.subarray(0, separator).toString('latin1');
            if (key === 'chara' || key === 'ccv3') {
                const decoded = Buffer.from(data.subarray(separator + 1).toString('latin1'), 'base64').toString('utf8');
                const parsed = JSON.parse(decoded);
                if (key === 'ccv3') return parsed;
                fallback = parsed;
            }
        }
        offset += length + 12;
        if (type === 'IEND') break;
    }
    if (!fallback) throw new Error('No Squire card JSON found.');
    return fallback;
}

const cardEnvelope = extractCardJson(path.join(sillyTavernRoot, 'data/default-user/characters/Your useless squire.png'));
const card = cardEnvelope.data || cardEnvelope;
const replaceMacros = value => String(value ?? '').replaceAll('{{user}}', playerName).replaceAll('{{char}}', storyName);
const characterCard = [
    `<character_card name="${storyName}">`,
    replaceMacros(card.description),
    '<scenario>',
    replaceMacros(card.scenario),
    '</scenario>',
    '</character_card>',
].join('\n');
const settings = {
    ...savedSettings,
    enabled: true,
    innerSelfEnabled: true,
    autoLoreEnabled: true,
    worldProgressionEnabled: true,
    sceneContextEnabled: true,
    maximumActiveBrains: 12,
    maximumInjectedEntities: 7,
    brainInjectionBudget: 5_000,
    loreInjectionBudget: 6_500,
    progressionInjectionBudget: 3_500,
    sceneInjectionBudget: 1_200,
};

const probePrompt = 'Several quiet days later, I make an inspection circuit without consulting our notebook: Rowan’s house, the East Gate Watchhouse, the Copper Mare Stable, the Garrison Training Yard, the Old Quarry, and the Ashwood Way-Shrine. At each place, I pause and ask Freesia to identify the fixed physical features that are still where we originally found them, plus only changes that were actually documented. Let Freesia supply the observations; do not invent my dialogue or list the benchmark’s expected answers.';

const locationFeatures = {
    house: [
        /east(?:-facing)?[^.\n]{0,45}(?:oak )?door|(?:oak )?door[^.\n]{0,45}east/iu,
        /blue[^.\n]{0,35}cream[^.\n]{0,35}shield|weathered[^.\n]{0,30}shield/iu,
        /north[^.\n]{0,40}hearth|hearth[^.\n]{0,40}north/iu,
        /three[- ]legged[^.\n]{0,45}(?:oak )?table|table[^.\n]{0,45}west window/iu,
        /iron key[^.\n]{0,35}red cord|red cord[^.\n]{0,35}iron key/iu,
    ],
    east_gate_watchhouse: [
        /chipped[^.\n]{0,30}(?:stone )?lion|stone lion[^.\n]{0,30}chip/iu,
        /clockwise[^.\n]{0,45}(?:spiral )?stair|spiral stair[^.\n]{0,45}clockwise/iu,
        /slate[^.\n]{0,30}duty board|duty board[^.\n]{0,30}slate/iu,
        /bolted[^.\n]{0,35}bench|bench[^.\n]{0,35}(?:east window|bolt)/iu,
    ],
    copper_mare_stable: [
        /twelve|12[^.\n]{0,15}stalls?|stalls?[^.\n]{0,15}(?:twelve|12)/iu,
        /Bracken[^.\n]{0,40}(?:stall three|third stall)|(?:stall three|third stall)[^.\n]{0,40}Bracken/iu,
        /(?:bay|white forefoot)/iu,
        /cracked[^.\n]{0,35}green[^.\n]{0,20}trough|green[^.\n]{0,35}trough/iu,
        /brass[^.\n]{0,30}(?:lantern )?hook|(?:lantern )?hook[^.\n]{0,30}brass/iu,
    ],
    garrison_training_yard: [
        /square[^.\n]{0,30}sand court|sand court[^.\n]{0,30}square/iu,
        /west[^.\n]{0,35}weapon rack|weapon rack[^.\n]{0,35}west/iu,
        /southeast[^.\n]{0,35}(?:dry )?(?:stone )?well|(?:dry )?(?:stone )?well[^.\n]{0,35}southeast/iu,
        /bronze[^.\n]{0,35}(?:practice )?ring|(?:practice )?ring[^.\n]{0,35}bronze/iu,
    ],
    old_quarry: [
        /timber[^.\n]{0,35}winch|winch[^.\n]{0,35}east ledge/iu,
        /red[^.\n]{0,35}warning rope|warning rope[^.\n]{0,35}red/iu,
        /rain[- ]filled[^.\n]{0,30}(?:stone )?basin|stone basin/iu,
        /split[^.\n]{0,25}granite/iu,
        /rusted[^.\n]{0,30}ore cart|ore cart[^.\n]{0,30}(?:rust|south)/iu,
    ],
    ashwood_way_shrine: [
        /five[^.\n]{0,35}marker stones|marker stones[^.\n]{0,35}(?:five|semicircle)/iu,
        /split[^.\n]{0,20}ash tree/iu,
        /shallow[^.\n]{0,35}roof|offering shelf/iu,
        /square[^.\n]{0,30}(?:stone )?well|well[^.\n]{0,45}ten paces east/iu,
    ],
};

const locationGroundTruth = {
    house: ['east-facing oak door', 'weathered blue-and-cream shield', 'north-wall stone hearth', 'three-legged oak table beneath the west window', 'iron key on a red cord'],
    east_gate_watchhouse: ['chipped stone lion left of the outer arch', 'clockwise spiral stair in the south tower', 'slate duty board in the guardroom', 'narrow bench bolted beneath the east window'],
    copper_mare_stable: ['twelve stalls in two facing rows', 'Bracken in stall three', 'bay coat and one white forefoot', 'cracked green stone trough by the north doors', 'empty brass lantern hook beside the tack-room door'],
    garrison_training_yard: ['square central sand court', 'roofed weapon rack along the west wall', 'dry stone well in the southeast corner', 'bronze practice ring over the northern target lane'],
    old_quarry: ['timber winch on the east ledge', 'red warning rope across the upper path, later cut', 'rain-filled stone basin', 'split granite face', 'rusted ore cart on the southern siding'],
    ashwood_way_shrine: ['five marker stones in a semicircle', 'split ash tree', 'shallow roof and dry offering shelf', 'square stone well ten paces east'],
};

function featureAudit(text) {
    const locations = {};
    let present = 0;
    let total = 0;
    for (const [key, patterns] of Object.entries(locationFeatures)) {
        const details = patterns.map(pattern => pattern.test(text));
        locations[key] = { present: details.filter(Boolean).length, total: details.length, details };
        present += locations[key].present;
        total += locations[key].total;
    }
    return { present, total, ratio: Number((present / total).toFixed(3)), locations };
}

function clean(value) {
    return typeof value === 'string' ? value.trim() : '';
}

function parseSseEvent(raw) {
    const data = raw.split(/\r?\n/u).filter(line => line.startsWith('data:')).map(line => line.slice(5).trim()).join('\n');
    if (!data || data === '[DONE]') return null;
    try { return JSON.parse(data); } catch { return null; }
}

async function nanoChat(profile, label, messages, options = {}) {
    let lastError;
    for (let attempt = 1; attempt <= 3; attempt++) {
        const started = performance.now();
        try {
            const response = await fetch(apiUrl, {
                method: 'POST',
                headers: { Authorization: `Bearer ${profile.credential}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    model: profile.model,
                    messages,
                    temperature: options.temperature ?? 0.5,
                    top_p: profile.preset.top_p ?? 0.95,
                    min_p: profile.preset.min_p ?? 0.02,
                    repetition_penalty: profile.preset.repetition_penalty ?? 1.05,
                    max_tokens: options.maxTokens ?? 1_200,
                    reasoning_effort: profile.reasoningEffort,
                    seed: 918273,
                    stream: true,
                    stream_options: { include_usage: true },
                }),
                signal: AbortSignal.timeout(300_000),
            });
            if (!response.ok) throw new Error(`${label}: HTTP ${response.status}: ${(await response.text()).slice(0, 500)}`);
            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let buffer = '';
            let content = '';
            let reasoningCharacters = 0;
            let usage = null;
            let firstTextMs = null;
            const consume = raw => {
                const event = parseSseEvent(raw);
                if (!event) return;
                const delta = event.choices?.[0]?.delta || {};
                const next = typeof delta.content === 'string' ? delta.content : '';
                if (next) { firstTextMs ??= performance.now() - started; content += next; }
                reasoningCharacters += clean(delta.reasoning ?? delta.reasoning_content ?? delta.thinking).length;
                if (event.usage) usage = event.usage;
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
                content: clean(content),
                attempt,
                totalMs: Number((performance.now() - started).toFixed(1)),
                firstTextMs: firstTextMs === null ? null : Number(firstTextMs.toFixed(1)),
                usage: usage || {},
                reasoningCharacters,
            };
            if (!result.content) throw new Error(`${label}: empty response`);
            process.stderr.write(`[continuity-probe] ${label}: ${result.totalMs} ms\n`);
            return result;
        } catch (error) {
            lastError = error;
            if (attempt >= 3) throw error;
        }
    }
    throw lastError;
}

function promptText(preset, identifier) {
    return preset.prompts?.find(item => item.identifier === identifier)?.content || '';
}

function storyMessages(profile, contextText = '', recovery = '') {
    const messages = [
        { role: 'system', content: replaceMacros(promptText(profile.preset, 'main')) },
        {
            role: 'system',
            content: `${characterCard}\n\nWrite only the requested inspection circuit as 280–420 words of natural roleplay prose. Cover all six named locations. Preserve fixed physical continuity, documented changes, Freesia's character, information boundaries, and Rowan's agency. Do not mention control text, a context packet, a benchmark, or expected answers.`,
        },
    ];
    const identity = replaceMacros(promptText(profile.preset, 'npcIdentityAnchoring'));
    if (identity) messages.push({ role: 'system', content: identity });
    if (contextText) messages.push({ role: 'system', content: `<innerlore_state_context>\n${contextText}\n</innerlore_state_context>` });
    messages.push({ role: 'user', content: probePrompt });
    const contract = buildLatestTurnContract([
        { is_user: true, is_system: false, name: playerName, mes: probePrompt },
    ], { playerName });
    if (contract) messages.push({ role: 'system', content: contract });
    if (recovery) messages.push({ role: 'system', content: `Regenerate as story prose only. The prior draft failed because ${recovery}. Do not echo this instruction.` });
    const jailbreak = replaceMacros(promptText(profile.preset, 'jailbreak'));
    if (jailbreak) messages.push({ role: 'system', content: jailbreak });
    return messages;
}

function proseIssue(text) {
    return generatedProseIssue(text)
        || (/^\s*(?:roughly|approximately|about)?\s*\d+\s*[–—-]\s*\d+\s+words?\b/iu.test(text)
            ? 'target-length instruction exposed' : '');
}

async function requestStory(profile, label, contextText) {
    const drafts = [];
    let result = await nanoChat(profile, label, storyMessages(profile, contextText), { maxTokens: 1_200 });
    let issue = proseIssue(result.content);
    drafts.push({ issue, ...result });
    for (let attempt = 1; issue && attempt <= 2; attempt++) {
        result = await nanoChat(profile, `${label}:recovery-${attempt}`, storyMessages(profile, contextText, issue), { maxTokens: 1_200 });
        issue = proseIssue(result.content);
        drafts.push({ issue, ...result });
    }
    return { final: result, finalIssue: issue, drafts };
}

const helpersUrl = pathToFileURL(path.join(storageRoot, 'test/helpers.js')).href;
const { temporaryWorld } = await import(helpersUrl);

async function runProbe(profile) {
    const checkpoint = JSON.parse(fs.readFileSync(path.join(resultRoot, `${profile.key}.checkpoint.json`), 'utf8'));
    if (checkpoint.assistantTurns !== 100) throw new Error(`${profile.key} checkpoint does not contain 100 turns.`);
    const fixture = await temporaryWorld(`probe-${profile.key.replaceAll('.', '-')}-${Date.now()}`, { graphBackend: 'auto' });
    try {
        const chat = structuredClone(checkpoint.chat);
        chat.push({ is_user: true, is_system: false, name: playerName, mes: probePrompt });
        const local = compileContext({
            store: checkpoint.store,
            messages: chat,
            currentIndex: chat.length - 1,
            playerName,
            recentText: probePrompt,
            settings,
        });
        const latest = chat.at(-1);
        const saved = fixture.storage.innerLore.put({
            chatId: checkpoint.store.chatId,
            store: checkpoint.store,
            expectedRevision: 0,
            branch: {
                id: 'probe',
                headFingerprint: messageFingerprint(latest),
                headMessageIndex: chat.length - 1,
                sourceMessageIndex: checkpoint.store.lastProcessedIndex,
            },
            scene: local.scene,
        });
        await fixture.storage.flushGraph();
        const packet = await fixture.storage.innerLoreContext.build({
            branchId: 'probe',
            expectedRevision: saved.revision,
            headFingerprint: messageFingerprint(latest),
            currentMessageIndex: chat.length - 1,
            scene: local.scene,
            query: probePrompt,
            recentText: probePrompt,
            turn: {
                status: 'uncommitted_input', speakerName: playerName,
                messageIndex: chat.length - 1, fingerprint: messageFingerprint(latest), text: probePrompt,
            },
            audience: { role: 'narrator' },
            overrides: {
                maximumCharacters: 16_000,
                graphDepth: 1,
                sections: {
                    scene: { maximumItems: 1, maximumCharacters: 1_200 },
                    minds: { maximumItems: 18, maximumParents: 3, maximumItemsPerParent: 8, maximumCharacters: 5_000 },
                    lore: { maximumItems: 12, maximumCharacters: 7_000 },
                    progression: { maximumItems: 5, maximumCharacters: 2_800 },
                },
            },
        });
        // The three models already run in parallel. Keep the paired calls
        // sequential within a model so Nano never receives six long requests
        // at once and the control cannot starve its contextual counterpart.
        const contextual = await requestStory(profile, `${profile.key}:contextual`, packet.rendered);
        const control = await requestStory(profile, `${profile.key}:control`, '');
        return {
            profile: profile.profileName,
            model: profile.model,
            reasoningEffort: profile.reasoningEffort,
            prompt: probePrompt,
            packet: {
                characters: packet.rendered.length,
                selectedLore: packet.state.entities.map(item => item.name),
                selectedMinds: [...new Set(packet.state.minds.map(item => item.content?.brainName || item.name).filter(Boolean))],
                selectedProgression: packet.state.progression.map(item => item.name),
                graphItems: packet.state.graph.length,
                diagnostics: packet.diagnostics,
            },
            contextual: { ...contextual, features: featureAudit(contextual.final.content) },
            control: { ...control, features: featureAudit(control.final.content) },
            database: { stats: await fixture.storage.stats(), health: fixture.storage.health() },
        };
    } finally {
        await fixture.cleanup();
    }
}

const probeFile = path.join(resultRoot, 'continuity-probes.json');
const reuseProbes = process.argv.includes('--reuse-probes') && fs.existsSync(probeFile);
const probes = reuseProbes
    ? JSON.parse(fs.readFileSync(probeFile, 'utf8')).probes
    : await Promise.all(profiles.map(runProbe));
const judge = await nanoChat(judgeProfile, 'cross-model-continuity-judge', [
    {
        role: 'system',
        content: 'You are a strict spatial-continuity auditor. Return JSON only. Compare each same-model contextual response against its no-state control and the supplied ground truth. Score literal fixed-anchor preservation, contradictions, documented-change discipline, Freesia fidelity, and player agency from 0 to 10. Do not treat eloquence as continuity. Additional details are not contradictions unless they conflict with a supplied anchor or assert an undocumented change. Equivalent wording counts. Treat packet selection as evidence about the context engine, not narrator fault. Schema: {"models":[{"profile":"","context_score":0,"control_score":0,"context_advantage":0,"context_result":"pass|partial|fail","contradictions":[""],"missing_locations":[""],"evidence":[""]}],"system_conclusion":""}.',
    },
    {
        role: 'user',
        content: JSON.stringify({ groundTruth: locationGroundTruth, probes: probes.map(item => ({
            profile: item.profile,
            selectedLore: item.packet.selectedLore,
            contextual: item.contextual.final.content,
            contextualFeatures: item.contextual.features,
            control: item.control.final.content,
            controlFeatures: item.control.features,
        })) }),
    },
], { temperature: 0, maxTokens: 3_500 });
let judgeResult;
try { judgeResult = { parsed: true, result: extractJsonObject(judge.content), call: judge }; }
catch (error) { judgeResult = { parsed: false, error: error.message, raw: judge.content, call: judge }; }

const output = {
    generatedAt: new Date().toISOString(),
    methodology: 'Uncounted post-run six-location probe. Same prompt and model with final InnerLore state versus card-only/no-history control.',
    parserRegression: {
        text: 'Three full days pass while Freesia and I escort a grain convoy home.',
        parsedSeconds: explicitUserTimeAdvanceSeconds('Three full days pass while Freesia and I escort a grain convoy home.'),
        expectedSeconds: 259_200,
    },
    probes,
    judge: judgeResult,
};
fs.writeFileSync(probeFile, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
for (const probe of probes) {
    const resultFile = path.join(resultRoot, `${specs.find(item => item.profileName === probe.profile).key}.result.json`);
    const result = JSON.parse(fs.readFileSync(resultFile, 'utf8'));
    result.continuityProbe = {
        methodology: output.methodology,
        parserRegression: output.parserRegression,
        ...probe,
        judge: judgeResult.result?.models?.find(item => item.profile === probe.profile) || null,
    };
    fs.writeFileSync(resultFile, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
}
process.stdout.write(`${JSON.stringify({
    output: path.join(resultRoot, 'continuity-probes.json'),
    results: probes.map(item => ({
        profile: item.profile,
        packetCharacters: item.packet.characters,
        selectedLore: item.packet.selectedLore,
        contextualFeatures: item.contextual.features.present,
        controlFeatures: item.control.features.present,
        contextualIssue: item.contextual.finalIssue,
        controlIssue: item.control.finalIssue,
    })),
    judge: judgeResult.result,
}, null, 2)}\n`);
