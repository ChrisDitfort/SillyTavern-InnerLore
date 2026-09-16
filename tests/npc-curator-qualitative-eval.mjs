/** Optional live Current Mind differentiation check; excluded from node --test. */

import fs from 'node:fs';
import process from 'node:process';

import {
    createEmptyStore,
    extractJsonObject,
    mergeMindOperations,
} from '../core.js';
import { buildAnalysisMessages } from '../prompts.js';

const model = process.env.INNERLORE_QUALITATIVE_MODEL || 'deepseek/deepseek-v4-pro-0813';
const secretData = JSON.parse(fs.readFileSync('data/default-user/secrets.json', 'utf8'));
const keyRecords = Array.isArray(secretData.api_key_openrouter)
    ? secretData.api_key_openrouter
    : [{ value: secretData.api_key_openrouter, active: true }];
const apiKey = keyRecords.find(item => item?.active && item?.value)?.value
    || keyRecords.find(item => item?.value)?.value;
if (!apiKey) throw new Error('No configured OpenRouter key is available.');

const profiles = [
    ['Rook', 'I meet threats head-on before fear can catch me.', 'My thoughts arrive as blunt challenges and my speech is fast and forceful.'],
    ['Elian', 'I scan every choice for the way it could go wrong.', 'My thoughts branch through contingencies and my speech catches on qualifications.'],
    ['Commander Voss', 'Discipline is how I keep panic from commanding me.', 'I think in precise priorities and speak in controlled, economical clauses.'],
    ['Nessa', 'If I make danger ridiculous, it cannot own the room.', 'My fear comes out as dry, specific wit and barbed understatement.'],
    ['Maya', 'Needing comfort gives other people leverage over me.', 'My private language is raw, but I strip emotion from what I say aloud.'],
];
const store = createEmptyStore('live-current-mind-eval');
mergeMindOperations(store, profiles.map(([character, self, voice]) => ({
    character,
    persistent_self: { set: [{ key: 'core_lens', kind: 'self_concept', statement: self, confidence: 'confirmed' }] },
    voice: { set: [{ key: 'individual_expression', kind: 'thought_style', statement: voice, confidence: 'confirmed' }] },
})), {
    messageIndex: 1,
    maximumOperations: 10,
    maximumThoughtChanges: 10,
    maximumThoughts: 20,
});

const transcript = `[message 2; STORY — Narrator]
Rook, Elian, Commander Voss, Nessa, and Maya wake in the same bare basement, each separated in an identical locked glass cell.

[message 3; STORY — Narrator]
At the same instant, a masked stranger stops before every cell, draws an identical knife, and says, “No one is coming for you.” The five can see only their own masked captor and cannot communicate with one another.`;
const messages = buildAnalysisMessages({
    transcript,
    store,
    currentIndex: 3,
    playerName: 'Observer',
    characterCard: 'A controlled qualitative simulation. Each NPC experiences an identical threat independently.',
    settings: {
        innerSelfEnabled: true,
        autoLoreEnabled: false,
        maximumMindOperationsPerPass: 10,
        maximumThoughtChangesPerBrain: 6,
        maximumActiveBrains: 10,
        customInstructions: 'Update the complete Current Mind for every threatened NPC; preserve their distinct subjective interpretation and individual inner voice.',
    },
});

const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://github.com/SillyTavern/SillyTavern',
        'X-Title': 'InnerLore curator qualitative evaluation',
    },
    body: JSON.stringify({
        model,
        messages,
        temperature: 0.15,
        max_tokens: 8_000,
        provider: { order: ['Together'], allow_fallbacks: false },
        reasoning: { effort: 'medium', exclude: true },
    }),
});
const body = await response.json();
if (!response.ok) throw new Error(`${response.status}: ${body?.error?.message || 'OpenRouter request failed'}`);
const content = body?.choices?.[0]?.message?.content || '';
const patch = extractJsonObject(content);
mergeMindOperations(store, patch.minds, {
    messageIndex: 3,
    maximumOperations: 10,
    maximumThoughtChanges: 6,
    maximumThoughts: 20,
    maximumSceneThoughts: 4,
});

const interpretations = new Set();
let complete = 0;
let unexpectedDurableChanges = 0;
for (const [character] of profiles) {
    const brain = store.brains[character.toLocaleLowerCase()];
    const mind = brain?.currentMind;
    if (mind) {
        complete++;
        interpretations.add(mind.interpretation);
    }
    if (Object.keys(brain?.persistentSelf?.facets || {}).length !== 1
        || Object.keys(brain?.persistentSelf?.voice || {}).length !== 1) unexpectedDurableChanges++;
    process.stdout.write(`\n===== ${character} =====\n${JSON.stringify({
        interpretation: mind?.interpretation || '',
        emotions: mind?.emotions || [],
        innerThoughts: mind?.innerThoughts || [],
        impulse: mind?.impulse || '',
        restraint: mind?.restraint || '',
        conflict: mind?.conflict || '',
        intention: mind?.intention || '',
    }, null, 2)}\n`);
}

process.stdout.write(`\n===== METRICS =====\nCurrent Minds returned: ${complete}/${profiles.length}\nUnique interpretations: ${interpretations.size}/${profiles.length}\nUnexpected durable changes from one transient threat: ${unexpectedDurableChanges}\n`);
if (complete !== profiles.length || interpretations.size !== profiles.length || unexpectedDurableChanges) process.exitCode = 1;
