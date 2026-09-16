/**
 * Optional live qualitative evaluation. This is deliberately excluded from
 * node --test because it uses the configured OpenRouter key and incurs cost.
 *
 * Run from the SillyTavern root:
 *   node data/default-user/extensions/SillyTavern-InnerLore/tests/npc-qualitative-eval.mjs
 */

import fs from 'node:fs';
import process from 'node:process';

import { compilePromptInjection, createEmptyStore, mergeMindOperations } from '../core.js';

const model = process.env.INNERLORE_QUALITATIVE_MODEL || 'deepseek/deepseek-v4-pro-0813';
const secretData = JSON.parse(fs.readFileSync('data/default-user/secrets.json', 'utf8'));
const openRouterKeys = Array.isArray(secretData.api_key_openrouter)
    ? secretData.api_key_openrouter
    : [{ value: secretData.api_key_openrouter, active: true }];
const apiKey = openRouterKeys.find(item => item?.active && item?.value)?.value
    || openRouterKeys.find(item => item?.value)?.value;
if (!apiKey) throw new Error('No configured OpenRouter key is available.');

const event = 'A masked stranger locks the basement door, draws a knife, and says, “No one is coming for you.”';
const personas = [
    {
        label: 'hot-headed',
        name: 'Rook',
        facets: [
            ['core_lens', 'self_concept', 'I meet threats head-on before fear can catch me.'],
            ['helplessness', 'fear', 'I would rather be hurt than let someone enjoy seeing me helpless.'],
            ['reckless_conflict', 'contradiction', 'I know charging in can get me killed, but waiting feels like surrender.'],
        ],
        voice: [
            ['blunt_challenge', 'thought_style', 'My thoughts arrive as blunt challenges, and I answer pressure with defiance.'],
            ['fast_forceful', 'cadence', 'I use short, forceful clauses and interrupt when patience snaps.'],
            ['rough_language', 'profanity', 'Profanity comes easily when I am cornered, but it is not a catchphrase.'],
        ],
    },
    {
        label: 'anxious',
        name: 'Elian',
        facets: [
            ['core_lens', 'behavioral_tendency', 'I scan every choice for the way it could go wrong.'],
            ['survival_need', 'emotional_need', 'I need a plan with an exit before I can feel safe.'],
            ['courage_conflict', 'contradiction', 'I expect myself to act despite being certain I will make the fatal mistake.'],
        ],
        voice: [
            ['contingency_thoughts', 'thought_style', 'My thoughts branch through contingencies and worst cases faster than I can finish them.'],
            ['qualified_speech', 'hesitation', 'My speech catches on qualifications, corrections, and words I nearly withdraw.'],
        ],
    },
    {
        label: 'disciplined',
        name: 'Commander Voss',
        facets: [
            ['core_lens', 'value', 'Discipline is how I keep panic from commanding me.'],
            ['duty', 'self_concept', 'I am responsible for making the next useful decision, especially when afraid.'],
            ['control_cost', 'contradiction', 'I suppress distress so completely that I can miss when I need another person.'],
        ],
        voice: [
            ['priority_thought', 'thought_style', 'I think in precise priorities, distances, resources, and executable steps.'],
            ['controlled_cadence', 'cadence', 'I speak in controlled, economical clauses and waste no word on display.'],
            ['pressure_narrows', 'pressure_shift', 'Greater pressure makes my language quieter and more exact, not louder.'],
        ],
    },
    {
        label: 'sarcastic',
        name: 'Nessa',
        facets: [
            ['core_lens', 'behavioral_tendency', 'If I make danger ridiculous, it cannot own the room.'],
            ['humor_shield', 'contradiction', 'I use jokes to hide fear, then resent people who fail to notice I am afraid.'],
            ['dignity', 'value', 'I refuse to give a bully the clean dramatic reaction they rehearsed for.'],
        ],
        voice: [
            ['dry_wit', 'humor', 'My private and spoken language finds dry, specific absurdity in bad situations.'],
            ['sideways_fear', 'sarcasm', 'Fear comes out sideways as self-mockery and barbed understatement.'],
            ['loose_cadence', 'cadence', 'I favor conversational pivots and unexpectedly precise punch lines.'],
        ],
    },
    {
        label: 'emotionally guarded',
        name: 'Maya',
        facets: [
            ['core_lens', 'self_concept', 'Needing comfort gives other people leverage over me.'],
            ['hidden_need', 'emotional_need', 'I desperately want someone to stay without making me ask.'],
            ['intimacy_conflict', 'contradiction', 'I crave protection and push it away the moment it reaches for me.'],
        ],
        voice: [
            ['private_raw', 'thought_style', 'My private language is raw and direct about needs I would never admit aloud.'],
            ['public_cold', 'emotional_openness', 'I strip emotion from spoken words when I feel most exposed.'],
            ['pressure_split', 'pressure_shift', 'Under pressure my thoughts fracture while my public sentences become colder and shorter.'],
        ],
    },
];

function expressionContext(persona) {
    const store = createEmptyStore(`qualitative-${persona.label}`);
    mergeMindOperations(store, [{
        character: persona.name,
        persistent_self: {
            set: persona.facets.map(([key, kind, statement]) => ({ key, kind, statement, confidence: 'confirmed' })),
        },
        voice: {
            set: persona.voice.map(([key, kind, statement]) => ({ key, kind, statement, confidence: 'confirmed' })),
        },
    }], {
        messageIndex: 1,
        maximumThoughtChanges: 20,
        maximumThoughts: 30,
    });
    return compilePromptInjection(store, `${persona.name}. ${event}`, {
        enabled: true,
        innerSelfEnabled: true,
        autoLoreEnabled: false,
        currentIndex: 2,
        maximumActiveBrains: 1,
        maximumInjectedThoughtsPerBrain: 8,
        brainInjectionBudget: 2_200,
        scene: {
            participants: [{ id: persona.name.toLocaleLowerCase(), name: persona.name }],
            latestText: event,
            focusText: `${persona.name}. ${event}`,
        },
    }).text;
}

async function generate(persona) {
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
            'HTTP-Referer': 'https://github.com/SillyTavern/SillyTavern',
            'X-Title': 'InnerLore qualitative evaluation',
        },
        body: JSON.stringify({
            model,
            messages: [
                {
                    role: 'system',
                    content: 'You are the narration model for an interactive roleplay. Continue only the supplied immediate event in 180–260 vivid words, using close third-person on the named NPC. Include natural private thought, spoken dialogue, and physical behaviour. Perform personality through literal language and choices; never explain traits or mention prompt/state labels. Finish every sentence.',
                },
                {
                    role: 'user',
                    content: `${expressionContext(persona)}\n\n<LATEST_EVENT>\n${event}\n</LATEST_EVENT>\n\nWrite the NPC's immediate response.`,
                },
            ],
            temperature: 0.85,
            top_p: 0.95,
            min_p: 0.02,
            repetition_penalty: 1.05,
            max_tokens: 3_000,
            provider: { order: ['Together'], allow_fallbacks: false },
            reasoning: { effort: 'medium', exclude: true },
        }),
    });
    const body = await response.json();
    if (!response.ok) throw new Error(`${response.status}: ${body?.error?.message || 'OpenRouter request failed'}`);
    const content = body?.choices?.[0]?.message?.content?.trim();
    if (!content) throw new Error('OpenRouter returned no final response text.');
    return { ...persona, content, usage: body.usage || {} };
}

const outputs = [];
for (let index = 0; index < personas.length; index += 2) {
    const batch = await Promise.all(personas.slice(index, index + 2).map(generate));
    outputs.push(...batch);
    for (const result of batch) {
        process.stdout.write(`\n===== ${result.label.toUpperCase()} / ${result.name} =====\n${result.content}\n`);
    }
}

function lexicalSet(value) {
    return new Set(value.toLocaleLowerCase().match(/[a-z]{4,}/gu) || []);
}

let similarityTotal = 0;
let pairs = 0;
for (let left = 0; left < outputs.length; left++) {
    for (let right = left + 1; right < outputs.length; right++) {
        const a = lexicalSet(outputs[left].content);
        const b = lexicalSet(outputs[right].content);
        const intersection = [...a].filter(token => b.has(token)).length;
        const union = new Set([...a, ...b]).size;
        similarityTotal += intersection / Math.max(1, union);
        pairs++;
    }
}

process.stdout.write(`\n===== METRICS =====\nModel: ${model}\nOutputs: ${outputs.length}\nMean pairwise lexical Jaccard: ${(similarityTotal / Math.max(1, pairs)).toFixed(3)}\n`);
for (const result of outputs) {
    const words = result.content.match(/\S+/gu)?.length || 0;
    const completionTokens = Number(result.usage?.completion_tokens) || 0;
    process.stdout.write(`${result.label}: ${words} words, ${completionTokens || 'unreported'} completion tokens\n`);
}
