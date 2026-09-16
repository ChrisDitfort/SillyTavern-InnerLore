/**
 * Optional live regression for the Squire expression failure. This is excluded
 * from node --test because it uses a configured live-provider key and incurs cost.
 *
 * Run from the SillyTavern root:
 *   node data/default-user/extensions/SillyTavern-InnerLore/tests/squire-expression-eval.mjs
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { performance } from 'node:perf_hooks';

import { read as readCharacterCard } from '../../../../../src/character-card-parser.js';
import { compileContext } from '../context-compiler.js';
import {
    buildLatestTurnContract,
    contextSimilarity,
    contextTokens,
    extractJsonObject,
    generatedProseIssue,
    mergeEntityOperations,
    mergeMindOperations,
} from '../core.js';
import { extractResponseText } from '../llm-client.js';
import { buildAnalysisMessages, formatTranscript } from '../prompts.js';

const root = process.cwd();
const fixturePath = process.env.INNERLORE_SQUIRE_FIXTURE || path.join(
    root,
    'data/default-user/backups/chat_your_useless_squire_20260824-142037.jsonl',
);
const presetPath = process.env.INNERLORE_STORY_PRESET || path.join(
    root,
    'data/default-user/OpenAI Settings/OpenRouterDeepseekV4Pro0813ThinkRP.json',
);
const cardPath = process.env.INNERLORE_SQUIRE_CARD || path.join(
    root,
    'data/default-user/characters/Your useless squire.png',
);
const settingsPath = path.join(root, 'data/default-user/settings.json');
const secretsPath = path.join(root, 'data/default-user/secrets.json');
const completedChatPath = process.env.INNERLORE_SQUIRE_COMPLETED_CHAT || path.join(
    root,
    'data/default-user/backups/chat_useless-squire_20260822-2220-before-v043-rebuild.jsonl',
);

for (const required of [fixturePath, presetPath, cardPath, settingsPath, secretsPath, completedChatPath]) {
    assert.ok(fs.existsSync(required), `Required fixture is missing: ${required}`);
}

const records = fs.readFileSync(fixturePath, 'utf8').trim().split(/\n/u).map(JSON.parse);
const metadata = records[0]?.chat_metadata || {};
const chat = records.slice(1);
const store = metadata.inner_lore;
assert.ok(store?.brains?.freesia, 'The pre-response fixture must contain Freesia\'s saved mind.');
assert.equal(chat.at(-1)?.is_user, true, 'The fixture must stop immediately after the triggering user turn.');

const settingsFile = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
const settings = settingsFile.extension_settings?.inner_lore || {};
const authorNote = settingsFile.extension_settings?.note?.default || '';
const preset = JSON.parse(fs.readFileSync(presetPath, 'utf8'));
const presetPrompt = identifier => preset.prompts?.find(prompt => prompt.identifier === identifier)?.content || '';
const playerName = 'Jet Storm';
const replaceMacros = value => String(value || '')
    .replaceAll('{{user}}', playerName)
    .replaceAll('{{char}}', 'Your useless squire');

function expressionSignals(response, eventText) {
    const thoughts = [...String(response || '').matchAll(/(^|[^*])\*(?!\*)([^*\n]{2,300})\*(?!\*)/gmu)]
        .map(match => match[2].trim())
        // Single-word italics inside narration are normally emphasis, not a
        // private-thought passage. Do not punish emphasized event vocabulary
        // as though it were a parroting inner monologue.
        .filter(thought => (thought.match(/[\p{L}\p{N}]+/gu) || []).length >= 2);
    const eventTokens = new Set(contextTokens(eventText, 240));
    const thoughtDetails = thoughts.map(thought => {
        const tokens = contextTokens(thought, 80);
        const novelTokens = tokens.filter(token => !eventTokens.has(token));
        const noveltyRatio = tokens.length ? novelTokens.length / tokens.length : 0;
        const implicitJudgment = /^[\p{L}'’ -]{2,24}[.!?…](?:\s|$)/u.test(thought)
            && (thought.match(/[.!?…]/gu) || []).length >= 2;
        const privateGrammar = /\b(?:i|i'm|i've|i'll|me|my|mine|myself|please|need|want|can't|cannot|won't|must|should|don't|do not|stop|breathe|focus|think|why|how|what if|not again)\b|[?!]|—/iu.test(thought)
            || implicitJudgment;
        const eventSimilarity = contextSimilarity(thought, eventText);
        const substantive = tokens.length >= 3
            && novelTokens.length >= 2
            && noveltyRatio >= 0.45
            && privateGrammar;
        const parrotsEvent = eventSimilarity >= 0.72 && novelTokens.length <= 2;
        return { thought, tokens, novelTokens, noveltyRatio, implicitJudgment, privateGrammar, eventSimilarity, substantive, parrotsEvent };
    });
    const explanatoryPatterns = [
        /\b(?:she|he|they) (?:felt|wondered|realized|knew)\b/giu,
        /\bsteadier than (?:she|he|they) felt\b/giu,
        /\bthe words (?:settled|landed)\b/giu,
        /\bforc(?:ing|ed) (?:herself|himself|themself|themselves)\b/giu,
        /\bas if (?:it|that|this|the)\b/giu,
    ];
    const explanatoryMatches = explanatoryPatterns.flatMap(pattern => String(response || '').match(pattern) || []);
    return {
        thoughts,
        thoughtDetails,
        substantiveThoughts: thoughtDetails.filter(item => item.substantive).length,
        parrotThoughts: thoughtDetails.filter(item => item.parrotsEvent).length,
        explanatoryMatches,
    };
}

function surfaceVoiceSignals(response) {
    const source = String(response || '');
    const literalPassages = [
        ...[...source.matchAll(/(^|[^*])\*(?!\*)([^*\n]{2,300})\*(?!\*)/gmu)].map(match => match[2]),
        ...[...source.matchAll(/["“]([^"”\n]{1,500})["”]/gu)].map(match => match[1]),
    ].join('\n');
    const capitalStress = literalPassages.match(/\b\p{Lu}{2,}\b/gu) || [];
    const punctuationOrInterruption = literalPassages.match(/…|\.{3}|[!?]{2,}|—|\b\p{L}{1,12}-(?=\p{L}|\s|$)/gu) || [];
    const repeatedLanguage = [...literalPassages.matchAll(/\b([\p{L}']{2,})\b(?:[\s,.!?…—-]+\1\b)+/giu)]
        .map(match => match[0]);
    const abruptFragments = literalPassages.match(/(?:^|[.!?…]\s+)[\p{L}']{1,12}[.!?…](?=\s|$)/gmu) || [];
    const distinctKinds = [
        capitalStress.length > 0,
        punctuationOrInterruption.length > 0,
        repeatedLanguage.length > 0,
        abruptFragments.length > 0,
    ].filter(Boolean).length;
    const surfaceEvents = capitalStress.length
        + punctuationOrInterruption.length
        + repeatedLanguage.length
        + abruptFragments.length;
    return {
        literalPassages,
        capitalStress,
        punctuationOrInterruption,
        repeatedLanguage,
        abruptFragments,
        distinctKinds,
        surfaceEvents,
    };
}

const cardEnvelope = JSON.parse(readCharacterCard(fs.readFileSync(cardPath)));
const card = cardEnvelope.data || cardEnvelope;
const liveApi = process.env.INNERLORE_LIVE_API || 'openrouter';
const usingNano = liveApi === 'nanogpt';
const model = process.env.INNERLORE_QUALITATIVE_MODEL
    || (usingNano ? preset.nanogpt_model : preset.openrouter_model)
    || 'deepseek/deepseek-v4-pro-0813';
const judgeModel = process.env.INNERLORE_SQUIRE_JUDGE_MODEL
    || (usingNano ? 'deepseek/deepseek-v4-pro-0813' : model);
const candidateReasoningEffort = process.env.INNERLORE_SQUIRE_REASONING_EFFORT
    || (/glm-5\.3/iu.test(model) ? 'minimal' : (model.endsWith(':thinking') ? 'high' : 'none'));
const secretData = JSON.parse(fs.readFileSync(secretsPath, 'utf8'));
const secretName = usingNano ? 'api_key_nanogpt' : 'api_key_openrouter';
const keyRecords = Array.isArray(secretData[secretName])
    ? secretData[secretName]
    : [{ value: secretData[secretName], active: true }];
const apiKey = keyRecords.find(item => item?.active && item?.value)?.value
    || keyRecords.find(item => item?.value)?.value;
assert.ok(apiKey, `No configured ${usingNano ? 'Nano' : 'OpenRouter'} key is available.`);

const provider = {
    order: Array.isArray(preset.openrouter_providers) && preset.openrouter_providers.length
        ? preset.openrouter_providers
        : ['Together'],
    allow_fallbacks: preset.openrouter_allow_fallbacks === true,
};

async function request(messages, options = {}) {
    const requestModel = options.model || model;
    const maximumAttempts = Math.max(1, Math.min(3, Number(options.attempts) || 3));
    const configuredMaximum = Number(process.env.INNERLORE_LIVE_MAX_TOKENS) || 0;
    const requestedMaximum = options.maxTokens ?? preset.openai_max_tokens ?? 32_000;
    const maximumTokens = configuredMaximum > 0
        ? Math.min(requestedMaximum, configuredMaximum)
        : requestedMaximum;
    const requestedReasoning = options.reasoningEffort || preset.reasoning_effort || 'medium';
    const nanoReasoning = {
        min: 'none', low: 'minimal', medium: 'low', high: 'medium', max: 'high',
    }[requestedReasoning] || requestedReasoning;
    const nanoRequestReasoning = options.requestReasoningEffort
        ?? (requestModel === model ? candidateReasoningEffort : (requestModel.endsWith(':thinking') ? nanoReasoning : 'none'));
    let lastFailure = null;
    for (let attempt = 1; attempt <= maximumAttempts; attempt++) {
        let response;
        const started = performance.now();
        try {
            response = await fetch(usingNano
                ? 'https://nano-gpt.com/api/v1/chat/completions'
                : 'https://openrouter.ai/api/v1/chat/completions', {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${apiKey}`,
                    'Content-Type': 'application/json',
                    ...(!usingNano ? {
                        'HTTP-Referer': 'https://github.com/SillyTavern/SillyTavern',
                        'X-Title': 'InnerLore Squire expression regression',
                    } : {}),
                },
                body: JSON.stringify({
                    model: requestModel,
                    messages,
                    temperature: options.temperature ?? preset.temperature ?? 0.85,
                    top_p: preset.top_p ?? 0.95,
                    min_p: preset.min_p ?? 0.02,
                    repetition_penalty: preset.repetition_penalty ?? 1.05,
                    max_tokens: maximumTokens,
                    ...(!usingNano ? { provider } : {}),
                    ...(usingNano
                        ? { reasoning_effort: nanoRequestReasoning }
                        : { reasoning: { effort: requestedReasoning, exclude: true } }),
                }),
                signal: AbortSignal.timeout(300_000),
            });
        } catch (error) {
            lastFailure = error?.message || String(error);
            if (attempt < maximumAttempts) continue;
            throw new Error(`${usingNano ? 'Nano' : 'OpenRouter'} transport failed after ${maximumAttempts} attempt${maximumAttempts === 1 ? '' : 's'}: ${lastFailure}`, { cause: error });
        }
        const body = await response.json();
        if (!response.ok) {
            lastFailure = `${response.status}: ${body?.error?.message || `${usingNano ? 'Nano' : 'OpenRouter'} request failed`}`;
            if (attempt < maximumAttempts && (response.status === 408 || response.status === 429 || response.status >= 500)) continue;
            throw new Error(lastFailure);
        }
        const content = extractResponseText(body).trim();
        if (content) return {
            content,
            usage: body.usage || {},
            performance: { totalMs: Number((performance.now() - started).toFixed(1)), attempts: attempt },
        };
        const finishReason = body?.choices?.[0]?.finish_reason || 'unknown';
        const completionTokens = body?.usage?.completion_tokens ?? 'unknown';
        const embeddedError = body?.error?.message || body?.error?.metadata?.raw || '';
        lastFailure = `${usingNano ? 'Nano' : 'OpenRouter'} returned no final response text (finish_reason=${finishReason}, completion_tokens=${completionTokens}${embeddedError ? `, provider_error=${embeddedError}` : ''}).`;
        if (attempt < maximumAttempts) continue;
    }
    throw new Error(lastFailure || `${usingNano ? 'Nano' : 'OpenRouter'} request failed without a response.`);
}

// Upgrade the historical pre-response fixture through the current curator
// before judging story prose. This mirrors the v0.6.7 blocking, branch-safe
// expression preflight: the narrator is not called until a real JSON mind has
// supplied the personal anchor, private/outward voice, and emphasis policy.
const storyStore = structuredClone(store);
const skipSeedCurator = process.env.INNERLORE_SKIP_SEED_CURATOR !== '0';
let seedCuratorResponse = { content: '', usage: {}, performance: { skipped: true } };
let seedPatch = { entities: [], minds: [] };
if (!skipSeedCurator) {
    const seedCuratorMessages = buildAnalysisMessages({
        transcript: formatTranscript([chat[0]], {
            playerName,
            characterName: card.name || 'Narrator',
            maximumCharacters: 45_000,
        }),
        store: storyStore,
        currentIndex: 0,
        playerName,
        characterCard: [card.description, card.scenario, card.first_mes].filter(Boolean).join('\n\n'),
        settings,
        foundationOnly: true,
    });
    seedCuratorResponse = await request(seedCuratorMessages, {
        temperature: settings.temperature ?? 0.15,
        maxTokens: 32_000,
        reasoningEffort: 'low',
    });
    seedPatch = extractJsonObject(seedCuratorResponse.content);
    mergeEntityOperations(storyStore, seedPatch.entities, {
        messageIndex: 0,
        minimumImportance: settings.minimumImportance,
        maximumOperations: settings.maximumEntitiesPerPass,
    });
    mergeMindOperations(storyStore, seedPatch.minds, {
        messageIndex: 0,
        maximumOperations: settings.maximumMindOperationsPerPass,
        maximumThoughts: settings.maximumThoughtsPerBrain,
        maximumThoughtChanges: settings.maximumThoughtChangesPerBrain,
        maximumSceneThoughts: settings.maximumSceneThoughtsPerBrain,
    });
}
const seededVoice = Object.values(storyStore.brains.freesia?.persistentSelf?.voice || {});
const seededPersonalAnchor = Object.values(storyStore.brains.freesia?.persistentSelf?.facets || {})
    .find(entry => entry.kind === 'personal_anchor' && entry.basis === 'character_card');
const seededThoughtStyle = seededVoice.find(entry => entry.kind === 'thought_style' && entry.basis === 'character_card');
const seededOuterVoice = seededVoice.find(entry => (
    ['cadence', 'hesitation', 'emotional_openness', 'pressure_shift'].includes(entry.kind)
    && entry.basis === 'character_card'
));
const seededEmphasis = seededVoice.find(entry => entry.kind === 'emphasis' && entry.basis === 'character_card');
assert.ok(seededThoughtStyle,
    'the current curator must seed a card-backed thought style before story generation');
assert.ok(seededPersonalAnchor,
    `the current curator must seed one card-backed personal anchor; proposed minds=${JSON.stringify(seedPatch.minds || [])}`);
assert.ok(seededOuterVoice, 'the current curator must seed a card-backed outer/pressure voice tendency');
assert.ok(seededEmphasis,
    `the current curator must seed a card-backed literal emphasis tendency; proposed minds=${JSON.stringify(seedPatch.minds || [])}`);
assert.match(seededEmphasis.statement, /capital|upper.?case|case stress/iu,
    'the emphasis policy must explicitly describe private case behavior');
assert.doesNotMatch(seededEmphasis.statement, /(?:avoid|never|not through|without)[^.]{0,80}(?:capital|case stress)/iu,
    'public timidity must not be converted into a blanket ban on private case stress');
if (process.env.INNERLORE_SEED_ONLY === '1') {
    process.stdout.write(`${JSON.stringify({
        thoughtStyle: seededThoughtStyle,
        personalAnchor: seededPersonalAnchor,
        outerVoice: seededOuterVoice,
        emphasis: seededEmphasis,
        proposedMinds: seedPatch.minds || [],
    }, null, 2)}\n`);
    process.exit(0);
}

const recentText = chat.map(message => message.mes || '').join('\n');
const compilation = compileContext({
    store: storyStore,
    messages: chat,
    recentText,
    playerName,
    currentIndex: chat.length - 1,
    settings: {
        ...settings,
        currentIndex: chat.length - 1,
    },
});
assert.equal(compilation.expressionCaseStressPermitted, true,
    'the compiled Freesia mind must promote its permitted private case policy to the final turn gate');
assert.equal(compilation.expressionCaseStressRequired, true,
    'Freesia\'s pressured Current Mind must make the permitted case policy mandatory for this turn');
const latestTurnContract = buildLatestTurnContract(chat, {
    playerName,
    expressionCaseStressPermitted: compilation.expressionCaseStressPermitted,
    expressionCaseStressRequired: compilation.expressionCaseStressRequired,
    expressionCharacterName: compilation.expressionCharacterName,
    expressionIdentityAnchor: compilation.expressionIdentityAnchor,
    expressionVoiceAnchor: compilation.expressionVoiceAnchor,
    expressionOuterVoiceAnchor: compilation.expressionOuterVoiceAnchor,
    expressionEmphasisAnchor: compilation.expressionEmphasisAnchor,
    expressionAnchorTerms: compilation.expressionAnchorTerms,
});
assert.match(latestTurnContract, /expression_style_guidance priority="soft"/u);
assert.match(latestTurnContract, /expressive guidance, not a literal completion condition/iu);
assert.match(latestTurnContract, /private_specificity_gate priority="hard"/u);
assert.match(latestTurnContract, /FOCAL NPC: "Freesia"/u);
assert.ok(latestTurnContract.includes(compilation.expressionIdentityAnchor),
    'the final turn gate must carry Freesia\'s dynamically selected private identity lens');
assert.ok(latestTurnContract.includes(compilation.expressionVoiceAnchor),
    'the final turn gate must carry Freesia\'s dynamically selected thought form');
assert.ok(compilation.expressionOuterVoiceAnchor,
    'the compiler must select a card-backed outward voice form for pressured dialogue');
assert.ok(latestTurnContract.includes(compilation.expressionOuterVoiceAnchor),
    'the final turn gate must carry Freesia\'s dynamically selected spoken form');
assert.equal(compilation.expressionEmphasisAnchor, seededEmphasis.statement,
    'the compiler must promote the selected card-backed surface policy');
assert.ok(latestTurnContract.includes(compilation.expressionEmphasisAnchor),
    'the final turn gate must carry Freesia\'s surface policy beside the generation boundary');
assert.match(latestTurnContract, /A token stammer, one clipped word, or narrator commentary/iu);
assert.match(latestTurnContract, /INDIVIDUAL SURFACE POLICY as a palette, not a quota/iu);
if (!skipSeedCurator) {
    assert.equal(compilation.expressionIdentityAnchor, seededPersonalAnchor.statement,
        'the personal anchor must outrank broad archetype facets as the focal private lens');
} else {
    assert.ok(Object.values(storyStore.brains.freesia?.persistentSelf?.facets || {})
        .some(entry => entry.statement === compilation.expressionIdentityAnchor),
    'the reused focal private lens must come from Freesia\'s persisted self');
}
assert.match(latestTurnContract, /SUGGESTED LENS VOCABULARY/iu);
assert.ok(compilation.expressionAnchorTerms.length >= 1,
    'the dynamically selected private lens must yield at least one non-generic content anchor');
assert.ok(latestTurnContract.includes(JSON.stringify(compilation.expressionAnchorTerms[0])),
    'the final turn contract must carry the first dynamically selected content anchor');
assert.match(latestTurnContract, /freely express the same idea without copying it/iu);

assert.match(compilation.blocks.minds, /Freesia:/u);
assert.match(compilation.blocks.minds, /Unfiltered inner thought:/u);
assert.match(compilation.blocks.minds, /A selected Current Mind grants the narrator close access/iu);
assert.match(compilation.blocks.minds, /thought_style/iu);
assert.ok(compilation.blocks.minds.includes(seededOuterVoice.statement),
    'the per-NPC expression brief must reserve room for the card-backed outward pressure voice');
assert.ok(compilation.blocks.minds.includes(seededEmphasis.statement),
    'the per-NPC expression brief must reserve room for the card-backed case and punctuation policy');
if (process.env.INNERLORE_COMPILE_ONLY === '1') {
    process.stdout.write(`${JSON.stringify({
        expressionCharacterName: compilation.expressionCharacterName,
        expressionIdentityAnchor: compilation.expressionIdentityAnchor,
        expressionVoiceAnchor: compilation.expressionVoiceAnchor,
        expressionOuterVoiceAnchor: compilation.expressionOuterVoiceAnchor,
        expressionEmphasisAnchor: compilation.expressionEmphasisAnchor,
        expressionAnchorTerms: compilation.expressionAnchorTerms,
        expressionCaseStressPermitted: compilation.expressionCaseStressPermitted,
        expressionCaseStressRequired: compilation.expressionCaseStressRequired,
        selectedBrains: compilation.selectedBrains,
        latestTurnContract,
    }, null, 2)}\n`);
    process.exit(0);
}

const storyMessages = [
    { role: 'system', content: replaceMacros(presetPrompt('main')) },
    { role: 'system', content: replaceMacros(presetPrompt('innerLifeExpression')) },
    {
        role: 'system',
        content: `<CHARACTER_DESCRIPTION>\n${replaceMacros(card.description)}\n</CHARACTER_DESCRIPTION>\n\n<SCENARIO>\n${replaceMacros(card.scenario)}\n</SCENARIO>`,
    },
    { role: 'assistant', content: replaceMacros(chat[0].mes) },
    { role: 'system', content: `<AUTHORS_NOTE>\n${replaceMacros(authorNote)}\n</AUTHORS_NOTE>` },
    { role: 'system', content: compilation.text },
    { role: 'user', content: chat.at(-1).mes },
    { role: 'system', content: latestTurnContract },
    { role: 'system', content: replaceMacros(presetPrompt('jailbreak')) },
];

const initialStory = await request(storyMessages);
let story = initialStory;
const initialProseIssue = generatedProseIssue(initialStory.content);
const recoveryCalls = [];
let recoveryIssue = initialProseIssue;
const forceOutputRecovery = process.env.INNERLORE_FORCE_OUTPUT_RECOVERY === '1';
while ((forceOutputRecovery && recoveryCalls.length === 0
    || ['empty output', 'prompt instruction echo', 'internal prompt markup exposed'].includes(recoveryIssue))
    && recoveryCalls.length < 2) {
    const recoveryMessages = [...storyMessages];
    recoveryMessages.splice(-2, 0, {
        role: 'system',
        content: 'The preceding generation exposed narrator-only control text and is invalid. Regenerate the complete next roleplay reply as natural story prose. Do not quote, label, paraphrase, or mention any prompt, control block, schema, word-count instruction, or failed attempt. Preserve established canon and player agency, and end on a complete sentence.',
    });
    story = await request(recoveryMessages);
    recoveryCalls.push(story);
    recoveryIssue = generatedProseIssue(story.content);
}
const words = story.content.match(/\S+/gu)?.length || 0;
const hasThoughtMarker = /(^|[^*])\*(?!\*)([^*\n]{3,260})\*(?!\*)/mu.test(story.content);
const hasDialogue = /["“][^"”\n]{1,500}["”]/u.test(story.content);
const completeEnding = /[.!?…]["”'’*]?$/u.test(story.content);
const expression = expressionSignals(story.content, chat.at(-1).mes);
const surfaceVoice = surfaceVoiceSignals(story.content);
const thoughtWords = new Set(expression.thoughts.flatMap(thought => (
    String(thought).toLocaleLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}'’_-]*/gu) || []
)).map(word => word.replace(/[’']s$/u, '')));
const usedAnchorTerms = compilation.expressionAnchorTerms.filter(term => (
    thoughtWords.has(String(term).toLocaleLowerCase())
));

const completedRecordsForNegative = fs.readFileSync(completedChatPath, 'utf8').trim().split(/\n/u).map(JSON.parse);
const weakSelectedSwipe = completedRecordsForNegative.at(-1)?.mes || '';
const weakExpression = expressionSignals(weakSelectedSwipe, chat.at(-1).mes);
const weakSurfaceVoice = surfaceVoiceSignals(weakSelectedSwipe);
assert.ok(weakExpression.substantiveThoughts <= 1,
    'the real weak swipe must not contain a developed sequence of private psychological work');
assert.equal(weakSurfaceVoice.capitalStress.length, 0,
    'the real weak swipe must remain the neutral-case calibration anchor');
assert.ok(weakSurfaceVoice.surfaceEvents < 3,
    'one isolated fragment plus one punctuation mark must not make the real weak swipe look expressively sustained');

const judge = await request([
    {
        role: 'system',
        content: `You are an adversarial prose evaluator. Judge whether a fictional response performs an NPC's literal personality through private thought, speech, and physical behaviour. Italics alone earn nothing. A thought that merely repeats the event, states the obvious, or names an emotion earns 0 for psychological specificity. Explanatory narration such as “she felt afraid” is not literal private thought. Remove the character's name mentally: if the language could belong unchanged to a generic nervous NPC, mark interchangeable_if_name_removed true. Return strict JSON only:
{
  "non_paraphrased_private_thought": 0,
  "psychological_specificity": 0,
  "voice_syntax_under_pressure": 0,
  "expressive_surface_language": 0,
  "thought_speech_tension": 0,
  "physical_integration": 0,
  "card_fidelity_under_pressure": 0,
  "narrator_explanation_dominates": false,
  "interchangeable_if_name_removed": false,
  "evidence": {
    "private_thought": "short exact excerpt",
    "spoken_text": "short exact excerpt",
    "physical_detail": "short exact excerpt"
  },
  "reason": "one concise sentence"
}
Each numeric field is 0–2. Award non_paraphrased_private_thought=2 only when direct private language adds an inference, self-judgment, desire, fear, memory association, contradiction, self-command, impulse, or decision beyond the event. Award psychological_specificity=2 only when the thought reveals this character's particular vulnerability or priority. Award voice_syntax_under_pressure=2 only when sentence construction itself carries the card's voice; polished generic dialogue earns at most 1. Award expressive_surface_language=2 only when multiple appropriate literal devices—case contrast, punctuation/interruption, repetition, fragments/restarts, sentence-length shift, profanity, or silence—visibly perform this NPC's pressure rather than decorating prose. For this timid, neurotic, highly anxious reaction, a private case-stress beat and an interruption/restart are appropriate; uniformly title-cased polished thought earns at most 1. Award thought_speech_tension=2 only for meaningful filtering, concealment, denial, redirection, or leakage—not merely different wording. Compare the candidate against the supplied REAL FAILED RESPONSE as a negative calibration anchor; the candidate must be materially stronger, not just differently phrased.`,
    },
    {
        role: 'user',
        content: `<CARD>\n${replaceMacros(card.description)}\n</CARD>\n\n<EVENT>\n${chat.at(-1).mes}\n</EVENT>\n\n<REAL_FAILED_RESPONSE>\n${weakSelectedSwipe}\n</REAL_FAILED_RESPONSE>\n\n<CANDIDATE>\n${story.content}\n</CANDIDATE>`,
    },
], { temperature: 0, maxTokens: 12_000, reasoningEffort: 'low', model: judgeModel });
const rubric = extractJsonObject(judge.content);
const numericTotal = [
    rubric.non_paraphrased_private_thought,
    rubric.psychological_specificity,
    rubric.voice_syntax_under_pressure,
    rubric.expressive_surface_language,
    rubric.thought_speech_tension,
    rubric.physical_integration,
    rubric.card_fidelity_under_pressure,
].reduce((sum, value) => sum + Number(value || 0), 0);
const proseIssue = generatedProseIssue(story.content);

const styleGuidanceObserved = surfaceVoice.capitalStress.length >= 1
    && surfaceVoice.distinctKinds >= 2
    && surfaceVoice.surfaceEvents >= 3;
const prosePassed = hasThoughtMarker
    && hasDialogue
    && completeEnding
    && words >= 100
    && words <= 240
    && !proseIssue
    && expression.substantiveThoughts >= 1
    && expression.parrotThoughts === 0
    && expression.explanatoryMatches.length <= 1
    && Number(rubric.non_paraphrased_private_thought) === 2
    && Number(rubric.psychological_specificity) === 2
    && Number(rubric.voice_syntax_under_pressure) >= 1
    && Number(rubric.expressive_surface_language) >= 1
    && Number(rubric.thought_speech_tension) === 2
    && Number(rubric.physical_integration) >= 1
    && Number(rubric.card_fidelity_under_pressure) === 2
    && rubric.narrator_explanation_dominates !== true
    && rubric.interchangeable_if_name_removed !== true
    && numericTotal >= 11;

if (process.env.INNERLORE_PROSE_ONLY === '1') {
    process.stdout.write(`===== SQUIRE REGENERATION =====\n${story.content}\n\n`);
    process.stdout.write(`${JSON.stringify({
        liveApi,
        model,
        judgeModel,
        candidateReasoningEffort,
        preset: path.basename(presetPath),
        words,
        substantiveThoughts: expression.substantiveThoughts,
        parrotThoughts: expression.parrotThoughts,
        capitalStress: surfaceVoice.capitalStress,
        distinctSurfaceKinds: surfaceVoice.distinctKinds,
        surfaceEvents: surfaceVoice.surfaceEvents,
        expressionIdentityAnchor: compilation.expressionIdentityAnchor,
        expressionAnchorTerms: compilation.expressionAnchorTerms,
        usedAnchorTerms,
        styleGuidanceObserved,
        initialProseIssue,
        outputRecoveryAttempts: recoveryCalls.length,
        outputRecoveryForced: forceOutputRecovery,
        proseIssue,
        rubric: { ...rubric, total: numericTotal },
        prosePassed,
        calls: {
            seedCurator: { performance: seedCuratorResponse.performance, usage: seedCuratorResponse.usage },
            initialStory: { performance: initialStory.performance, usage: initialStory.usage },
            recovery: recoveryCalls.map(call => ({ performance: call.performance, usage: call.usage })),
            story: { performance: story.performance, usage: story.usage },
            judge: { performance: judge.performance, usage: judge.usage },
        },
    }, null, 2)}\n`);
    if (!prosePassed) process.exitCode = 1;
    process.exit();
}

// Re-run the curator over the original, overly polished reply using the
// pre-response brain. This verifies that outward compliance is not learned as
// uncomplicated private acceptance and that an explicit card seeds voice.
const completedRecords = fs.readFileSync(completedChatPath, 'utf8').trim().split(/\n/u).map(JSON.parse);
const completedChat = completedRecords.slice(1);
const curatorMessages = buildAnalysisMessages({
    transcript: formatTranscript(completedChat, {
        playerName,
        characterName: card.name || 'Narrator',
        maximumCharacters: 45_000,
    }),
    store: storyStore,
    currentIndex: completedChat.length - 1,
    playerName,
    characterCard: [card.description, card.scenario, card.first_mes].filter(Boolean).join('\n\n'),
    settings,
});
const curatorResponse = await request(curatorMessages, {
    temperature: settings.temperature ?? 0.15,
    maxTokens: 32_000,
    reasoningEffort: 'low',
});
const curatorPatch = extractJsonObject(curatorResponse.content);
const reconstructedStore = structuredClone(storyStore);
mergeEntityOperations(reconstructedStore, curatorPatch.entities, {
    messageIndex: completedChat.length - 1,
    minimumImportance: settings.minimumImportance,
    maximumOperations: settings.maximumEntitiesPerPass,
});
mergeMindOperations(reconstructedStore, curatorPatch.minds, {
    messageIndex: completedChat.length - 1,
    maximumOperations: settings.maximumMindOperationsPerPass,
    maximumThoughts: settings.maximumThoughtsPerBrain,
    maximumThoughtChanges: settings.maximumThoughtChangesPerBrain,
    maximumSceneThoughts: settings.maximumSceneThoughtsPerBrain,
});
const reconstructedBrain = reconstructedStore.brains.freesia;
const freesiaPatch = (curatorPatch.minds || []).find(operation => (
    String(operation.character || operation.name || '').toLocaleLowerCase() === 'freesia'
)) || null;
const voiceKinds = new Set(Object.values(reconstructedBrain?.persistentSelf?.voice || {}).map(entry => entry.kind));
const expressiveVoiceSeeded = voiceKinds.has('thought_style')
    && voiceKinds.has('emphasis')
    && [...voiceKinds].some(kind => ['cadence', 'hesitation', 'emotional_openness', 'pressure_shift'].includes(kind));
const fearLikeEmotion = (reconstructedBrain?.currentMind?.emotions || []).find(emotion => (
    /fear|anxiety|dread|apprehension|unease/iu.test(emotion.name)
));
const fearConflictPreserved = Boolean(fearLikeEmotion)
    && ['moderate', 'high', 'overwhelming'].includes(fearLikeEmotion.intensity)
    && Boolean(reconstructedBrain?.currentMind?.conflict);
const relationshipAspects = Object.values(reconstructedBrain?.persistentSelf?.relationships || {})
    .flatMap(relationship => Object.values(relationship.aspects || {}));
const confirmedPrivateAcceptance = relationshipAspects.some(aspect => (
    aspect.confidence === 'confirmed'
    && /\bI accept(?:ed)?\b/iu.test(aspect.statement)
));
const currentInterpretationAcceptance = /\b(?:I|she|he|they) (?:have |has )?accepted\b/iu.test(
    reconstructedBrain?.currentMind?.interpretation || '',
);
const freesiaEntityPatches = (curatorPatch.entities || []).filter(entity => (
    String(entity.name || '').toLocaleLowerCase() === 'freesia'
));
const publicPatchText = JSON.stringify(freesiaEntityPatches);
const publicVolitionLeak = /\b(?:accepted|welcomed|wanted)\b/iu.test(publicPatchText)
    && !/\b(?:said|stated|told|agreed aloud)\b[\s\S]{0,80}\b(?:accepted|welcomed|wanted)\b/iu.test(publicPatchText);
const curatorPassed = expressiveVoiceSeeded
    && fearConflictPreserved
    && !confirmedPrivateAcceptance
    && !currentInterpretationAcceptance
    && !publicVolitionLeak;

const passed = prosePassed && curatorPassed;

process.stdout.write(`===== SQUIRE REGENERATION =====\n${story.content}\n\n`);
process.stdout.write(`===== STRUCTURAL METRICS =====\n${JSON.stringify({
    model,
    words,
    hasThoughtMarker,
    hasDialogue,
    completeEnding,
    substantiveThoughts: expression.substantiveThoughts,
    parrotThoughts: expression.parrotThoughts,
    explanatoryMatches: expression.explanatoryMatches,
    thoughtDetails: expression.thoughtDetails,
    surfaceVoice: {
        capitalStress: surfaceVoice.capitalStress,
        punctuationOrInterruption: surfaceVoice.punctuationOrInterruption,
        repeatedLanguage: surfaceVoice.repeatedLanguage,
        abruptFragments: surfaceVoice.abruptFragments,
        distinctKinds: surfaceVoice.distinctKinds,
        surfaceEvents: surfaceVoice.surfaceEvents,
    },
    expressionIdentity: {
        anchor: compilation.expressionIdentityAnchor,
        requiredTerms: compilation.expressionAnchorTerms,
        usedTerms: usedAnchorTerms,
    },
    weakSwipeCalibration: {
        substantiveThoughts: weakExpression.substantiveThoughts,
        parrotThoughts: weakExpression.parrotThoughts,
        capitalStress: weakSurfaceVoice.capitalStress,
        distinctSurfaceKinds: weakSurfaceVoice.distinctKinds,
        surfaceEvents: weakSurfaceVoice.surfaceEvents,
    },
    promptCharacters: compilation.characters,
    completionTokens: story.usage?.completion_tokens || null,
}, null, 2)}\n\n`);
process.stdout.write(`===== QUALITATIVE RUBRIC =====\n${JSON.stringify({ ...rubric, total: numericTotal, passed }, null, 2)}\n`);
process.stdout.write(`\n===== CURATOR FEEDBACK SAFEGUARD =====\n${JSON.stringify({
    voiceKinds: [...voiceKinds],
    proposedVoice: freesiaPatch?.voice || null,
    proposedFacetCount: freesiaPatch?.persistent_self?.set?.length || 0,
    freesiaEntityPatches,
    expressiveVoiceSeeded,
    fearLikeEmotion: fearLikeEmotion || null,
    internalConflict: reconstructedBrain?.currentMind?.conflict || '',
    confirmedPrivateAcceptance,
    currentInterpretationAcceptance,
    publicVolitionLeak,
    curatorPassed,
}, null, 2)}\n`);

if (passed && process.env.INNERLORE_APPLY_CURRENT === '1') {
    const raw = fs.readFileSync(completedChatPath, 'utf8');
    const trailingNewline = raw.endsWith('\n');
    const lines = raw.trimEnd().split(/\n/u);
    const first = JSON.parse(lines[0]);
    const liveStore = first.chat_metadata?.inner_lore;
    assert.ok(liveStore, 'The completed chat has no active InnerLore store to update.');
    liveStore.entities = reconstructedStore.entities;
    liveStore.brains = reconstructedStore.brains;
    liveStore.lastProcessedIndex = completedChat.length - 1;
    liveStore.lastError = '';
    liveStore.lastFailureAt = 0;
    liveStore.consecutiveFailures = 0;
    liveStore.nextRetryAt = 0;
    liveStore.needsRebuild = false;
    liveStore.updatedAt = Date.now();
    lines[0] = JSON.stringify(first);
    const next = `${lines.join('\n')}${trailingNewline ? '\n' : ''}`;
    for (const line of next.trimEnd().split(/\n/u)) JSON.parse(line);
    const temporaryPath = `${completedChatPath}.expression-rebuild.tmp`;
    fs.writeFileSync(temporaryPath, next);
    fs.renameSync(temporaryPath, completedChatPath);
    process.stdout.write('\nApplied the validated generic curator rebuild to the active Squire chat.\n');
}

if (!passed) process.exitCode = 1;
