import assert from 'node:assert/strict';
import test from 'node:test';

import {
    brainPsychologyCount,
    compilePromptInjection,
    createEmptyStore,
    createHistoryPrefixPromptStore,
    mergeMindOperations,
    normalizeStore,
    renderBrain,
} from '../core.js';
import { buildAnalysisMessages } from '../prompts.js';

function addMind(store, character, options = {}, messageIndex = 4) {
    mergeMindOperations(store, [{
        character,
        persistent_self: { set: options.facets || [] },
        voice: { set: options.voice || [] },
        relationships: options.relationships || [],
        ...(Object.hasOwn(options, 'currentMind') ? { current_mind: options.currentMind } : {}),
    }], {
        messageIndex,
        maximumOperations: 20,
        maximumThoughts: 50,
        maximumThoughtChanges: 20,
        maximumSceneThoughts: 4,
    });
    return store.brains[character.toLocaleLowerCase()];
}

test('Persistent Self, voice, relationships, and Current Mind survive a saved-state round trip', () => {
    const store = createEmptyStore('psychology-round-trip');
    addMind(store, 'Maya', {
        facets: [
            { key: 'self_reliance', kind: 'self_concept', statement: "I don't need anyone to rescue me.", confidence: 'confirmed' },
            { key: 'intimacy_conflict', kind: 'contradiction', statement: 'I crave closeness, then punish myself for needing it.' },
        ],
        voice: [{ key: 'guarded_cadence', kind: 'cadence', statement: 'I speak in clipped, deliberate sentences when exposed.' }],
        relationships: [{
            target: 'Daniel',
            set: [{ key: 'earned_reliance', kind: 'trust', statement: 'I can rely on Daniel when things become serious.' }],
        }],
        currentMind: {
            perception: 'Daniel is turning toward the door.',
            interpretation: 'He has finally had enough of me.',
            emotions: [{ name: 'fear', intensity: 'high', cause: 'I may be abandoned.' }],
            inner_thoughts: ['Stop him.'],
            intention: 'Make him pause without admitting I need him.',
        },
    }, 12);

    const restored = normalizeStore(JSON.parse(JSON.stringify(store)), 'psychology-round-trip');
    const brain = restored.brains.maya;
    assert.equal(brain.psychologyVersion, 2);
    assert.equal(brain.persistentSelf.facets.self_reliance.statement, "I don't need anyone to rescue me.");
    assert.equal(brain.persistentSelf.voice.guarded_cadence.kind, 'cadence');
    assert.equal(brain.persistentSelf.relationships.daniel.aspects.earned_reliance.kind, 'trust');
    assert.equal(brain.currentMind.interpretation, 'He has finally had enough of me.');
    assert.equal(Object.hasOwn(brain, 'thoughts'), false);
});

test('transient reactions replace one another and never accumulate as durable memories', () => {
    const store = createEmptyStore('transient-boundary');
    const brain = addMind(store, 'Maya', {
        facets: [{ key: 'guarded', kind: 'behavioral_tendency', statement: 'I conceal needs that could be used against me.' }],
        currentMind: {
            emotions: [{ name: 'panic', intensity: 'high', cause: 'Daniel reached the door.' }],
            inner_thoughts: ['Please do not leave.'],
            impulse: 'Call him back.',
        },
    }, 20);

    mergeMindOperations(store, [{
        character: 'Maya',
        current_mind: {
            interpretation: 'He stopped and is listening.',
            emotions: [{ name: 'relief', intensity: 'moderate', cause: 'He did not leave.' }],
            inner_thoughts: ['Good. Breathe.'],
        },
    }], { messageIndex: 21, maximumSceneThoughts: 4 });

    assert.deepEqual(brain.currentMind.innerThoughts, ['Good. Breathe.']);
    assert.equal(brain.currentMind.emotions[0].name, 'relief');
    assert.deepEqual(Object.keys(brain.persistentSelf.facets), ['guarded']);

    mergeMindOperations(store, [{ character: 'Maya', current_mind: null }], { messageIndex: 22 });
    assert.deepEqual(brain.currentMind.innerThoughts, ['Good. Breathe.'],
        'an incidental nullable field must not erase a still-active mind');
    mergeMindOperations(store, [{
        character: 'Maya',
        current_mind: null,
        clear_current_mind: true,
    }], { messageIndex: 23 });
    assert.equal(brain.currentMind, null, 'clearing Current Mind requires an explicit flag');
});

test('story-derived facets wait for independent reinforcement while card and significant-event anchors can promote immediately', () => {
    const store = createEmptyStore('durable-consolidation');
    const first = mergeMindOperations(store, [{
        character: 'Tamsin Vale',
        persistent_self: { set: [{
            key: 'rowan_keeps_promises',
            kind: 'belief',
            statement: 'I am beginning to believe Rowan keeps promises.',
            confidence: 'inferred',
            basis: 'story',
        }] },
        current_mind: { attention: 'Rowan returning on time.' },
    }], {
        messageIndex: 3,
        maximumThoughtChanges: 6,
        minimumStoryFacetObservations: 2,
    });
    const brain = store.brains['tamsin vale'];
    assert.equal(first.deferredFacetCandidates, 1);
    assert.equal(brain.persistentSelf.facets.rowan_keeps_promises, undefined);
    assert.equal(brain.durableCandidates.rowan_keeps_promises.observations, 1);

    const sameMessage = mergeMindOperations(store, [{
        character: 'Tamsin Vale',
        persistent_self: { set: [{
            key: 'rowan_keeps_promises', kind: 'belief',
            statement: 'I am beginning to believe Rowan keeps promises.', confidence: 'inferred', basis: 'story',
        }] },
    }], { messageIndex: 3, maximumThoughtChanges: 6, minimumStoryFacetObservations: 2 });
    assert.equal(sameMessage.promotedFacetCandidates, 0);
    assert.equal(brain.durableCandidates.rowan_keeps_promises.observations, 1);

    const reinforced = mergeMindOperations(store, [{
        character: 'Tamsin Vale',
        persistent_self: { set: [{
            key: 'rowan_keeps_promises', kind: 'belief',
            statement: 'I am beginning to believe Rowan keeps promises.', confidence: 'inferred', basis: 'story',
        }] },
    }], { messageIndex: 5, maximumThoughtChanges: 6, minimumStoryFacetObservations: 2 });
    assert.equal(reinforced.promotedFacetCandidates, 1);
    assert.equal(brain.persistentSelf.facets.rowan_keeps_promises.basis, 'consolidated');
    assert.equal(brain.durableCandidates.rowan_keeps_promises, undefined);

    mergeMindOperations(store, [{
        character: 'Tamsin Vale',
        persistent_self: { set: [
            { key: 'archive_fire', kind: 'personal_anchor', statement: 'The archive fire shapes how I guard records.', confidence: 'confirmed', basis: 'character_card' },
            { key: 'vow_to_guard_room', kind: 'goal', statement: 'I will guard this room until relief arrives.', confidence: 'confirmed', basis: 'story', promotion: 'significant_event' },
        ] },
    }], { messageIndex: 7, maximumThoughtChanges: 6, minimumStoryFacetObservations: 2 });
    assert.ok(brain.persistentSelf.facets.archive_fire);
    assert.ok(brain.persistentSelf.facets.vow_to_guard_room);
});

test('a reswipe prompt keeps pre-response identity while stripping discarded-branch psychology', () => {
    const store = createEmptyStore('reswipe-prefix');
    addMind(store, 'Freesia', {
        facets: [{ key: 'self_doubt', kind: 'self_concept', statement: 'I expect to fail, but I make myself try.', basis: 'character_card' }],
        voice: [{ key: 'nervous_self_talk', kind: 'thought_style', statement: 'My private voice rehearses failure in clipped corrections.', basis: 'character_card' }],
        relationships: [{
            target: 'Jet',
            set: [{ key: 'approval_need', kind: 'dependency', statement: 'I want Jet to decide I am worth teaching.' }],
        }],
        currentMind: {
            interpretation: 'Jet may dismiss me before I begin.',
            inner_thoughts: ['Do not apologize. Not yet.'],
        },
    }, 0);
    mergeMindOperations(store, [{
        character: 'Freesia',
        persistent_self: {
            set: [{ key: 'discarded_memory', kind: 'memory', statement: 'Jet accepted the bargain in the discarded reply.' }],
        },
        voice: {
            set: [
                { key: 'card_hesitation', kind: 'hesitation', statement: 'I restart sentences before authority.', basis: 'character_card' },
                { key: 'discarded_cadence', kind: 'cadence', statement: 'I now speak with effortless confidence.', basis: 'story' },
            ],
        },
        relationships: [{
            target: 'Jet',
            set: [{ key: 'discarded_acceptance', kind: 'trust', statement: 'I now trust his methods completely.' }],
        }],
        current_mind: {
            interpretation: 'The discarded bargain is settled.',
            inner_thoughts: ['I accepted it.'],
        },
    }], { messageIndex: 2, maximumThoughtChanges: 20, maximumThoughts: 30 });

    const prefix = createHistoryPrefixPromptStore(store, 2);
    const brain = prefix.brains.freesia;
    assert.ok(brain.persistentSelf.facets.self_doubt);
    assert.ok(brain.persistentSelf.voice.nervous_self_talk);
    assert.ok(brain.persistentSelf.voice.card_hesitation,
        'card-backed voice remains branch-safe even when reconstructed in a later batch');
    assert.ok(brain.persistentSelf.relationships.jet.aspects.approval_need);
    assert.equal(brain.persistentSelf.facets.discarded_memory, undefined);
    assert.equal(brain.persistentSelf.voice.discarded_cadence, undefined);
    assert.equal(brain.persistentSelf.relationships.jet.aspects.discarded_acceptance, undefined);
    assert.equal(brain.currentMind, null);
    assert.equal(prefix.progression, null);
    assert.equal(prefix.needsRebuild, false);
    assert.equal(prefix.lastProcessedIndex, -1);
});

test('sparse voice foundations and one relationship change cannot be starved by facet proposals', () => {
    const store = createEmptyStore('voice-budget-fairness');
    const brain = addMind(store, 'Freesia', {
        voice: [{ key: 'nervous_self_talk', kind: 'verbal_habit', statement: 'I whisper instructions to myself when nervous.' }],
    }, 1);

    mergeMindOperations(store, [{
        character: 'Freesia',
        persistent_self: {
            set: Array.from({ length: 6 }, (_, index) => ({
                key: `facet_${index}`,
                kind: 'belief',
                statement: `I carry durable belief ${index}.`,
            })),
        },
        voice: {
            set: [
                { key: 'private_spiral', kind: 'thought_style', statement: 'My private words spiral through mistakes and corrections.' },
                { key: 'authority_hesitation', kind: 'hesitation', statement: 'Around authority, I restart sentences and swallow apologies.' },
                { key: 'pressure_fragmentation', kind: 'pressure_shift', statement: 'Fear fragments my thoughts and thins my spoken voice.' },
            ],
        },
        relationships: [{
            target: 'Jet Storm',
            set: [
                { key: 'conditional_reliance', kind: 'expectation', statement: 'I need his instruction while remaining afraid of his methods.' },
                { key: 'approval_need', kind: 'dependency', statement: 'I badly want him to decide I am worth teaching.' },
            ],
        }],
    }], {
        messageIndex: 2,
        maximumThoughtChanges: 6,
        maximumThoughts: 30,
    });

    assert.equal(Object.keys(brain.persistentSelf.facets).length, 2);
    assert.ok(brain.persistentSelf.voice.private_spiral);
    assert.ok(brain.persistentSelf.voice.authority_hesitation);
    assert.ok(brain.persistentSelf.voice.pressure_fragmentation);
    assert.ok(brain.persistentSelf.relationships['jet storm'].aspects.conditional_reliance);
    assert.equal(brainPsychologyCount(brain), 7, 'six new durable changes plus the pre-existing voice entry survive');
});

test('a significant experience can consolidate into a belief and multidimensional relationship change', () => {
    const store = createEmptyStore('experience-consolidation');
    const brain = addMind(store, 'Maya', {
        facets: [{ key: 'injury_night', kind: 'memory', statement: 'Daniel stayed beside me after I was injured.' }],
        relationships: [{
            target: 'Daniel',
            set: [
                { key: 'want_approval', kind: 'dependency', statement: 'I hate how badly I want Daniel to approve of me.' },
                { key: 'guarded_trust', kind: 'trust', statement: 'I want to trust Daniel, but I am waiting for him to leave.' },
            ],
        }],
    }, 8);

    mergeMindOperations(store, [{
        character: 'Maya',
        persistent_self: {
            set: [{ key: 'dependable_in_crisis', kind: 'belief', statement: 'I can depend on Daniel when things become serious.' }],
            delete: ['injury_night'],
        },
        relationships: [{
            target: 'Daniel',
            set: [
                { key: 'guarded_trust', kind: 'trust', statement: 'Daniel has earned my trust in a crisis, even if closeness still frightens me.' },
                { key: 'injury_kindness', kind: 'shared_experience', statement: 'He stayed when I was hurt and had nothing to offer him.' },
            ],
        }],
    }], { messageIndex: 30, maximumThoughtChanges: 8 });

    assert.equal(brain.persistentSelf.facets.injury_night, undefined);
    assert.equal(brain.persistentSelf.facets.dependable_in_crisis.kind, 'belief');
    assert.match(brain.persistentSelf.relationships.daniel.aspects.guarded_trust.statement, /earned my trust/u);
    assert.ok(brain.persistentSelf.relationships.daniel.aspects.want_approval, 'contradictory dependency remains intact');
});

test('the same event produces recognizably different model briefs without hardcoded response text', () => {
    const archetypes = [
        ['Rook', 'I meet threats head-on before fear can catch me.', 'My thoughts arrive as blunt challenges; my speech is fast and forceful.'],
        ['Elian', 'I scan every choice for the way it could go wrong.', 'My thoughts loop through contingencies and my speech catches on qualifications.'],
        ['Commander Voss', 'Discipline is how I keep panic from commanding me.', 'I think in precise priorities and speak in controlled, economical clauses.'],
        ['Nessa', 'If I make danger ridiculous, it cannot own the room.', 'My fear comes out as dry, self-mocking wit and sideways observations.'],
        ['Maya', 'Needing comfort gives other people leverage over me.', 'My private language is raw, but I strip emotion from what I say aloud.'],
    ];
    const strippedBriefs = [];
    for (const [name, self, voice] of archetypes) {
        const store = createEmptyStore(`same-event-${name}`);
        const brain = addMind(store, name, {
            facets: [{ key: 'core_lens', kind: 'self_concept', statement: self }],
            voice: [{ key: 'individual_expression', kind: 'thought_style', statement: voice }],
        }, 3);
        const brief = renderBrain(brain, 1_600, {
            currentIndex: 4,
            focusText: 'A masked stranger locks the basement door and raises a knife.',
            maximumThoughts: 6,
        });
        const withoutName = brief.split('\n').slice(1).join('\n');
        assert.match(withoutName, new RegExp(self.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
        assert.match(withoutName, new RegExp(voice.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
        strippedBriefs.push(withoutName);
    }
    assert.equal(new Set(strippedBriefs).size, archetypes.length);
});

test('Expression guidance preserves private/spoken contradiction and natural emotional typography', () => {
    const store = createEmptyStore('expression-guidance');
    addMind(store, 'Maya', {
        facets: [{ key: 'guarded_need', kind: 'contradiction', statement: 'I want people close and push them away when they can see that.' }],
        voice: [
            { key: 'outer_restraint', kind: 'emotional_openness', statement: 'I remove feeling from spoken words when I most need someone.' },
            { key: 'pressure_language', kind: 'pressure_shift', statement: 'Under severe pressure my private thoughts fracture, while my public sentences become colder.' },
            { key: 'private_emphasis', kind: 'emphasis', statement: 'When restraint starts to break, my private words repeat and jump from lower-case compression to one sharply capitalized stress.' },
        ],
        currentMind: {
            interpretation: 'Daniel means to leave me.',
            emotions: [{ name: 'abandonment fear', intensity: 'overwhelming', cause: 'He opened the door.' }],
            inner_thoughts: ['Please do not leave. Please do not leave me.'],
            impulse: 'Beg him to stay.',
            restraint: 'I will not give him the power of hearing me beg.',
            intention: 'Sound indifferent while trying to delay him.',
        },
    }, 14);

    const injection = compilePromptInjection(store, 'Maya watches Daniel open the door.', {
        enabled: true,
        innerSelfEnabled: true,
        autoLoreEnabled: false,
        currentIndex: 14,
        maximumActiveBrains: 1,
        maximumInjectedThoughtsPerBrain: 6,
        brainInjectionBudget: 2_200,
        scene: {
            participants: [{ id: 'maya', name: 'Maya' }, { id: 'daniel', name: 'Daniel' }],
            latestText: 'Maya watches Daniel open the door.',
            focusText: 'Maya watches Daniel open the door.',
        },
    });

    assert.match(injection.text, /A selected Current Mind grants the narrator close access/iu);
    assert.match(injection.text, /at least one short, unmistakably direct private-thought fragment/iu);
    assert.match(injection.text, /make the thought-speech gap materially visible/iu);
    assert.match(injection.text, /rewording alone is not tension/iu);
    assert.match(injection.text, /Literalize the mind instead of translating it into narrator explanation/iu);
    assert.match(injection.text, /Italics or a fragment marker alone do not make a thought psychologically real/iu);
    assert.match(injection.text, /merely repeats or paraphrases the newest event/iu);
    assert.match(injection.text, /one to three short direct-thought beats/iu);
    assert.match(injection.text, /Current Mind is the NPC's entering subjective state and may predate the newest turn/iu);
    assert.match(injection.text, /never by a mechanical emotion-to-style rule/iu);
    assert.match(injection.text, /Expression synthesis for the newest event/iu);
    assert.match(injection.text, /Private lens that must become audible in direct thought/iu);
    assert.match(injection.text, /Supported pressure-language tendency that must be literally perceptible/iu);
    assert.match(injection.text, /Narrator commentary about how the voice sounds does not count/iu);
    assert.match(injection.text, /do not substitute polished bravery/iu);
    assert.match(injection.text, /Literal surface gate: neutral polished construction throughout is a miss/iu);
    assert.match(injection.text, /at least two supported shifts/iu);
    assert.match(injection.text, /lower-case compression or selective CAPITAL stress/u);
    assert.match(injection.text, /punctuation and interruption/iu);
    assert.match(injection.text, /never decorate every line or use every device/iu);
    assert.match(injection.text, /my private words repeat and jump from lower-case compression/iu);
    assert.match(injection.text, /abandonment fear \(overwhelming\)/iu);
    assert.match(injection.text, /Unfiltered inner thought: Please do not leave/iu);
    assert.match(injection.text, /Decision\/intention: Sound indifferent/iu);
    assert.equal(injection.selectedBrains[0].caseStressPermitted, true,
        'a private emphasis entry that permits case contrast must survive selection');
});

test('surface cooldown rotates a repeated personal anchor and filters already-spent Current Mind wording', () => {
    const store = createEmptyStore('surface-cooldown-freesia');
    const luckyAnchor = 'I keep a lucky charm and reach for it when I need to steady myself against the fear of failing.';
    addMind(store, 'Freesia', {
        facets: [
            { key: 'lucky_river_stone', kind: 'personal_anchor', statement: luckyAnchor, basis: 'character_card' },
            { key: 'useless_self_concept', kind: 'self_concept', statement: 'I believe my mistakes define me more than any title ever could.', basis: 'character_card' },
            { key: 'fear_of_ridicule', kind: 'fear', statement: 'I am afraid of ridicule and desperate to prove I am worth teaching.', basis: 'character_card' },
        ],
        voice: [
            { key: 'anxious_thought', kind: 'thought_style', statement: 'My private thoughts run in anxious corrections.', basis: 'character_card' },
            { key: 'authority_hesitation', kind: 'hesitation', statement: 'I stammer and restart around authority.', basis: 'character_card' },
            { key: 'private_stress', kind: 'emphasis', statement: 'Under pressure, one private word may enter capitals while the sentence fractures.', basis: 'character_card' },
        ],
        currentMind: {
            interpretation: 'I need to look capable even though I feel exposed.',
            emotions: [{ name: 'anxiety', intensity: 'high', cause: 'Jet is judging whether I belong.' }],
            attention: 'On not reaching for the river-stone and keeping my eyes off the floorboards.',
            inner_thoughts: ["Don't reach for the charm. He'll think you're a child."],
            impulse: 'Touch the river-stone and look down.',
            restraint: 'Keep my hand out of my pocket so he does not see the childish ritual.',
            internal_conflict: 'I want reassurance and need to appear capable without asking for it.',
            intention: 'Answer him while hiding how badly I expect to fail.',
        },
    }, 12);
    const recentExpressionText = [
        'Freesia looks at the floorboards. Her hand twitches toward the river-stone. *Do not touch the charm.*',
        'Her fingers reach for her pocket before she stops them. *He will think I am a child.*',
        'Freesia looks away and stammers. The lucky stone stays in her pocket.',
    ].join('\n');
    const diagnostics = {};
    const rendered = renderBrain(store.brains.freesia, 3_000, {
        currentIndex: 12,
        maximumThoughts: 6,
        recentExpressionText,
        scene: {
            participants: [{ id: 'freesia', name: 'Freesia' }],
            latestText: 'Jet asks Freesia to demonstrate how she maintains her sword.',
            focusText: 'Jet asks Freesia to demonstrate how she maintains her sword.',
        },
        diagnostics,
    });

    assert.equal(diagnostics.expressionAnchorRotated, true);
    assert.notEqual(diagnostics.expressionAnchor, luckyAnchor);
    assert.ok(diagnostics.cooledSurfaceDetails >= 3,
        `expected repeated Current Mind surfaces to be filtered; got ${diagnostics.cooledSurfaceDetails}`);
    assert.doesNotMatch(rendered, /Unfiltered inner thought: Don't reach for the charm/iu);
    assert.doesNotMatch(rendered, /Impulse: Touch the river-stone/iu);
    assert.doesNotMatch(rendered, /Attention: On not reaching for the river-stone/iu);
    assert.doesNotMatch(rendered, /\[personal_anchor[^\n]+lucky charm/iu,
        'the stored anchor remains available later but must leave this turn when its surface is cooled');
    assert.match(rendered, /Internal conflict: I want reassurance/iu,
        'underlying psychology must survive even when its prior realization is cooled');
    assert.match(rendered, /Surface cooldown is active/iu);

    const injection = compilePromptInjection(store, 'Jet asks Freesia to demonstrate how she maintains her sword.', {
        enabled: true,
        innerSelfEnabled: true,
        autoLoreEnabled: false,
        currentIndex: 12,
        maximumActiveBrains: 1,
        maximumInjectedThoughtsPerBrain: 6,
        brainInjectionBudget: 3_000,
        recentExpressionText,
        scene: {
            participants: [{ id: 'freesia', name: 'Freesia' }],
            latestText: 'Jet asks Freesia to demonstrate how she maintains her sword.',
            focusText: 'Jet asks Freesia to demonstrate how she maintains her sword.',
        },
    });
    assert.match(injection.blocks.minds, /recent_expression_cooldown priority="hard"/u);
    assert.match(injection.blocks.minds, /already-spent Expression/iu);
    assert.equal(injection.selectedBrains[0].expressionAnchorRotated, true);
    assert.ok(injection.selectedBrains[0].cooledSurfaceDetails >= 3);
    assert.doesNotMatch(injection.selectedBrains[0].expressionAnchorTerms.join(' '), /lucky|charm|river|stone/iu);
});

test('emotionally active focal NPCs receive a literal three-layer expression contract without making it universal', () => {
    const store = createEmptyStore('literal-expression-contract');
    addMind(store, 'Freesia', {
        facets: [
            { key: 'self_doubt', kind: 'self_concept', statement: 'I expect authority figures to discover I am useless.' },
            { key: 'stubborn_effort', kind: 'contradiction', statement: 'I expect to fail and force myself to try anyway.' },
        ],
        voice: [
            { key: 'private_spiral', kind: 'thought_style', statement: 'My private thoughts rush through mistakes and self-corrections.' },
            { key: 'authority_hesitation', kind: 'hesitation', statement: 'Around authority, I restart sentences and try to hide apologies.' },
            { key: 'panic_emphasis', kind: 'emphasis', statement: 'When panic outruns restraint, my thoughts repeat, break on dashes, and punch one feared word into capitals.' },
            { key: 'scene_relevant_murmur', kind: 'verbal_habit', statement: 'I murmur about the knight and brutal training when nervous.' },
        ],
        currentMind: {
            interpretation: 'The knight is deciding whether I am worth training.',
            emotions: [{ name: 'anxiety', intensity: 'high', cause: 'I expect rejection.' }],
            inner_thoughts: ['Please do not laugh.'],
            impulse: 'Apologize and retreat.',
            restraint: 'Stay long enough to hear the answer.',
            internal_conflict: 'I want to prove myself and want to escape judgment.',
        },
    }, 1);

    const injection = compilePromptInjection(store, 'The knight warns Freesia that his training is brutal and may hurt her.', {
        enabled: true,
        innerSelfEnabled: true,
        autoLoreEnabled: false,
        currentIndex: 2,
        maximumActiveBrains: 1,
        brainInjectionBudget: 2_400,
        scene: {
            participants: [{ id: 'freesia', name: 'Freesia' }],
            latestText: 'The knight warns Freesia that his training is brutal and may hurt her.',
            focusText: 'The knight warns Freesia that his training is brutal and may hurt her.',
        },
    });

    assert.match(injection.text, /braid observable physical behaviour/iu);
    assert.match(injection.text, /dialogue containing only what they reveal/iu);
    assert.match(injection.text, /force direct thought into neutral logistics, offscreen action, or every paragraph/iu);
    assert.match(injection.text, /Under pressure, uniformly polished neutral construction is a failure/iu);
    assert.match(injection.text, /My private thoughts rush through mistakes and self-corrections/u);
    assert.match(injection.text, /Supported pressure-language tendency[^\n]+Around authority, I restart sentences/iu,
        'lexical relevance must not crowd the strongest outward pressure tendency out of the expression brief');
    assert.match(injection.text, /Supported pressure-language tendency[^\n]+thoughts repeat, break on dashes/iu,
        'an explicit surface-emphasis voice needs a reserved prompt slot');
    assert.match(injection.text, /Please do not laugh/u);
});

test('reswipe-safe minds without Current Mind still carry stable personality into literal prose', () => {
    const store = createEmptyStore('stable-expression-fallback');
    addMind(store, 'Ilya', {
        facets: [{
            key: 'guarded_need',
            kind: 'contradiction',
            statement: 'I need reassurance and refuse to ask for it plainly.',
            basis: 'character_card',
        }],
        voice: [
            {
                key: 'private_deflection',
                kind: 'thought_style',
                statement: 'My private voice turns exposed needs into irritated self-commands.',
                basis: 'character_card',
            },
            {
                key: 'clipped_surface',
                kind: 'emphasis',
                statement: 'I cut public sentences short and use abrupt punctuation when a need nearly escapes.',
                basis: 'character_card',
            },
        ],
    }, 0);

    const injection = compilePromptInjection(store, 'Daniel reaches for the door while Ilya watches.', {
        enabled: true,
        innerSelfEnabled: true,
        autoLoreEnabled: false,
        currentIndex: 2,
        maximumActiveBrains: 1,
        brainInjectionBudget: 1_600,
        scene: {
            participants: [{ id: 'ilya', name: 'Ilya' }, { id: 'daniel', name: 'Daniel' }],
            latestText: 'Daniel reaches for the door while Ilya watches.',
            focusText: 'Daniel reaches for the door while Ilya watches.',
        },
    });

    assert.match(injection.text, /Stable expression fallback: no fresh transient mind is safe to inject/iu);
    assert.match(injection.text, /perform the supplied personality and voice through literal word choice/iu);
    assert.match(injection.text, /\[emphasis\][^\n]+cut public sentences short/iu);
    assert.doesNotMatch(injection.text, /Current Mind \(transient subjective lens\)/u);
    assert.equal(injection.selectedBrains[0].caseStressPermitted, false,
        'a cadence-only emphasis statement must not silently become a capitalization rule');
});

test('relationship history is retrieved for the scene target while unrelated relationships stay out', () => {
    const store = createEmptyStore('relationship-retrieval');
    const brain = addMind(store, 'Maya', {
        facets: [{ key: 'suspicious', kind: 'bias', statement: 'I look for the price hidden inside generosity.' }],
        relationships: [
            { target: 'Daniel', set: [{ key: 'crisis_trust', kind: 'trust', statement: 'Daniel stayed when the consequences became ugly.' }] },
            { target: 'Nera', set: [{ key: 'old_resentment', kind: 'resentment', statement: 'Nera humiliated me before the entire court.' }] },
        ],
        currentMind: {
            perception: 'Daniel is offering me the key.',
            interpretation: 'His history makes the offer feel safer than it would from anyone else.',
        },
    }, 10);

    const diagnostics = {};
    const rendered = renderBrain(brain, 2_000, {
        currentIndex: 10,
        maximumThoughts: 6,
        diagnostics,
        scene: {
            participants: [{ id: 'maya', name: 'Maya' }, { id: 'daniel', name: 'Daniel' }],
            latestText: 'Daniel offers Maya the vault key.',
            focusText: 'Daniel offers Maya the vault key and waits for her answer.',
        },
    });
    assert.match(rendered, /Subjective relationship with Daniel/u);
    assert.match(rendered, /stayed when the consequences became ugly/u);
    assert.doesNotMatch(rendered, /Nera|entire court/u);
    assert.equal(diagnostics.relationshipsSelected, 1);
});

test('context retrieval remains bounded instead of dumping the complete NPC record', () => {
    const store = createEmptyStore('bounded-psychology-context');
    const facets = Array.from({ length: 40 }, (_, index) => ({
        key: `facet_${index}`,
        kind: index % 2 ? 'belief' : 'opinion',
        statement: `I retain durable perspective number ${index} about a different past subject.`,
    }));
    const relationships = Array.from({ length: 10 }, (_, index) => ({
        target: `Offscreen Person ${index}`,
        set: [{ key: 'history', kind: 'shared_experience', statement: `We share unrelated history marker ${index}.` }],
    }));
    const brain = addMind(store, 'Maya', { facets, relationships }, 2);
    const diagnostics = {};
    const rendered = renderBrain(brain, 900, {
        currentIndex: 3,
        focusText: 'Maya studies the unfamiliar locked door.',
        maximumThoughts: 6,
        diagnostics,
    });

    assert.equal(Object.keys(brain.persistentSelf.facets).length, 19, 'one slot is fairly reserved for a relationship patch');
    assert.equal(brainPsychologyCount(brain), 20, 'the total per-pass durable change bound remains enforced');
    assert.ok(diagnostics.facetsSelected <= 6);
    assert.equal(diagnostics.relationshipsSelected, 0);
    assert.ok(rendered.length <= 900);
    assert.ok(brainPsychologyCount(brain) > diagnostics.facetsSelected);
});

test('many NPC minds remain isolated and bounded across a 600-turn context', () => {
    const store = createEmptyStore('long-v2-psychology');
    const cast = ['Rook', 'Elian', 'Voss', 'Nessa', 'Maya', 'Iria', 'Pell', 'Sable'];
    for (const [index, character] of cast.entries()) {
        addMind(store, character, {
            facets: [{
                key: 'identity_anchor',
                kind: 'self_concept',
                statement: `I am ${character}, and private marker ${index + 100} belongs only to me.`,
            }],
            voice: [{ key: 'voice_anchor', kind: 'cadence', statement: `My cadence carries unique marker ${index + 200}.` }],
            relationships: [{
                target: cast[(index + 1) % cast.length],
                set: [{ key: 'working_trust', kind: 'trust', statement: `I track trust with marker ${index + 300}.` }],
            }],
        }, 0);
    }

    for (let turn = 1; turn <= 600; turn++) {
        mergeMindOperations(store, cast.map((character, index) => ({
            character,
            persistent_self: { set: [{
                key: 'adaptive_belief',
                kind: 'belief',
                statement: `I interpret the latest development through stable personal marker ${index + 400}; revision ${turn}.`,
            }] },
            relationships: [{
                target: cast[(index + 1) % cast.length],
                set: [{ key: 'working_trust', kind: 'trust', statement: `My trust marker ${index + 300} now reflects revision ${turn}.` }],
            }],
            current_mind: {
                interpretation: `Only ${character} interprets scene ${turn} with marker ${index + 500}.`,
                emotions: [{ name: 'concern', intensity: turn % 3 ? 'moderate' : 'high', cause: `scene ${turn}` }],
                inner_thoughts: [`Private current marker ${index + 600}, turn ${turn}.`],
                intention: `Complete next step ${turn} without inheriting another NPC's state.`,
            },
        })), {
            messageIndex: turn,
            maximumOperations: 12,
            maximumThoughts: 30,
            maximumThoughtChanges: 6,
            maximumSceneThoughts: 4,
        });
    }

    assert.equal(Object.keys(store.brains).length, cast.length);
    for (const [index, character] of cast.entries()) {
        const brain = store.brains[character.toLocaleLowerCase()];
        assert.equal(Object.keys(brain.persistentSelf.facets).length, 2);
        assert.equal(Object.keys(brain.persistentSelf.relationships).length, 1);
        assert.equal(brain.currentMind.sourceMessage, 600);
        assert.deepEqual(brain.currentMind.innerThoughts, [`Private current marker ${index + 600}, turn 600.`]);
        const serialized = JSON.stringify(brain);
        for (let other = 0; other < cast.length; other++) {
            if (other !== index) assert.doesNotMatch(serialized, new RegExp(`Private current marker ${other + 600},`));
        }
    }

    const activeCast = cast.slice(0, 4);
    const compiled = compilePromptInjection(store, activeCast.join(', '), {
        enabled: true,
        innerSelfEnabled: true,
        autoLoreEnabled: false,
        currentIndex: 600,
        maximumActiveBrains: 8,
        brainInjectionBudget: 6_000,
        scene: {
            participants: activeCast.map(name => ({ id: name.toLocaleLowerCase(), name })),
            latestText: `${activeCast.join(', ')} face the latest development.`,
            focusText: `${activeCast.join(', ')} face the latest development.`,
        },
    });
    assert.deepEqual(compiled.selectedBrains.map(item => item.name).sort(), [...activeCast].sort());
    assert.ok(compiled.selectedBrains.every(item => item.currentMindIncluded));
    assert.ok(compiled.blocks.minds.length < 9_000);
});

test('old flat brains migrate once: durable meaning survives and scene clutter does not', () => {
    const migrated = normalizeStore({
        version: 1,
        brains: {
            maya: {
                name: 'Maya',
                thoughts: {
                    core_need: { key: 'core_need', category: 'desire', retention: 'durable', thought: 'I want someone to choose me without being asked.', confidence: 'confirmed' },
                    passing_heat: { key: 'passing_heat', category: 'emotion', retention: 'scene', thought: 'I am irritated for the moment.' },
                    obsolete_glance: { key: 'obsolete_glance', category: 'belief', retention: 'scene', thought: 'That glance unsettles me right now.' },
                },
            },
        },
    }, 'migration');
    const brain = migrated.brains.maya;
    assert.equal(migrated.version, 4);
    assert.equal(migrated.expressionFoundationVersion, 0,
        'normalizing an old envelope must not pretend its expression foundation was rebuilt');
    assert.equal(brain.persistentSelf.facets.core_need.kind, 'desire');
    assert.equal(brain.persistentSelf.facets.passing_heat, undefined);
    assert.equal(brain.persistentSelf.facets.obsolete_glance, undefined);
    assert.equal(brain.currentMind, null);
    assert.equal(Object.hasOwn(brain, 'thoughts'), false);
});

test('curator prompt requests the three-layer psychology flow without another narration call', () => {
    const store = createEmptyStore('curator-schema');
    addMind(store, 'Maya', {
        facets: [{ key: 'guarded', kind: 'behavioral_tendency', statement: 'I make myself difficult to read.' }],
        voice: [{ key: 'cadence', kind: 'cadence', statement: 'I use short statements when cornered.' }],
    }, 2);
    const messages = buildAnalysisMessages({
        transcript: '[message 3; PLAYER — Daniel]\nI offer Maya the key.\n\n[message 4; STORY — Narrator]\nMaya looks at the key but does not take it.',
        store,
        currentIndex: 4,
        playerName: 'Daniel',
        characterCard: 'Maya is fiercely self-reliant and privately afraid of abandonment.',
        recentExpressionText: 'Maya folded her arms, looked at the floor, and thought: Do not ask him to stay.',
        settings: {
            innerSelfEnabled: true,
            autoLoreEnabled: true,
            maximumMindOperationsPerPass: 10,
            maximumThoughtChangesPerBrain: 6,
        },
    });
    const system = messages[0].content;
    const user = messages[1].content;
    assert.match(system, /Persistent Self \(durable psychology, individual voice, and subjective relationships\)/u);
    assert.match(system, /personal_anchor stores one compact, concrete/iu);
    assert.match(system, /first card-foundation pass may use four/iu);
    assert.match(system, /world event → NPC perception → interpretation → emotional reaction/u);
    assert.match(system, /Dialogue is not stored here and may later contradict the private thought/u);
    assert.match(system, /infer a minimal expression profile from explicit temperament/iu);
    assert.match(system, /best-supported outer tendency among cadence, hesitation, emotional_openness, and pressure_shift/iu);
    assert.match(system, /case contrast, punctuation, repetition, interruption, fragmentation, or typographic stress/iu);
    assert.match(system, /public timidity, hesitation, guardedness, or formality as evidence that private thought avoids case stress/iu);
    assert.match(system, /selective private case stress permission/iu);
    assert.match(system, /permission is not a requirement to use it every turn/iu);
    assert.match(system, /REQUIRED SPARSE-VOICE CHECK/iu);
    assert.match(system, /Prioritize these compact voice foundations over adding lower-value scene-derived facets/iu);
    assert.match(system, /Distinguish “I said yes” from “I want this,”/u);
    assert.match(system, /dialogue alone must never create a confirmed relationship statement/iu);
    assert.match(system, /neither Current Mind interpretation nor a relationship aspect may simultaneously assert confirmed private acceptance/iu);
    assert.match(system, /Use observable speech-act wording/iu);
    assert.match(system, /does not erase an established vulnerability/iu);
    assert.match(system, /Do not lower fear or close an internal conflict solely because the NPC spoke calmly or said yes/iu);
    assert.match(system, /performed compliance from willing private acceptance/iu);
    assert.match(system, /Never endlessly append scene summaries/u);
    assert.match(system, /never a deterministic state machine/u);
    assert.match(system, /Every persistent_self, voice, and relationship set item requires a basis/iu);
    assert.match(system, /provenance lets a reswipe preserve card identity/iu);
    assert.match(system, /current_mind null AND clear_current_mind true/iu);
    assert.match(system, /Never erase an unresolved active mind merely because/iu);
    assert.match(system, /RECENT_EXPRESSION_COOLDOWN is negative surface evidence/iu);
    assert.match(system, /personal_anchor may colour interpretation/iu);
    assert.match(system, /"current_mind"/u);
    assert.match(system, /"clear_current_mind": false/u);
    assert.match(user, /"persistent_self"/u);
    assert.match(user, /"voice"/u);
    assert.match(system, /"basis": "character_card\|story\|consolidated"/u);
    assert.match(user, /<REQUIRED_SPARSE_VOICE_AUDIT>/u);
    assert.match(user, /<REQUIRED_CARD_DISTINCTIVENESS_AUDIT>/u);
    assert.match(user, /"missing":\["personal_anchor"\]/u);
    assert.match(user, /kind personal_anchor with basis "character_card"/iu);
    assert.match(user, /"character":"Maya","missing":\["thought_style","emphasis"\]/u);
    assert.match(user, /this patch must fill each listed missing voice foundation/iu);
    assert.match(user, /<REQUIRED_FINAL_VOLITION_AUDIT>/u);
    assert.match(user, /<RECENT_EXPRESSION_COOLDOWN priority="hard">/u);
    assert.match(user, /Maya folded her arms, looked at the floor/u);
    assert.match(user, /<REQUIRED_SURFACE_NOVELTY_AUDIT>/u);
    assert.match(user, /never shorten voiced compliance to the narrator claim/iu);
    assert.match(user, /Scan the proposed JSON for these contradictions and correct them before output/iu);
    assert.doesNotMatch(user, /"thoughts"/u);
});
