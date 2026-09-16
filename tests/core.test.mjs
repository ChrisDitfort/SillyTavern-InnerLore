import assert from 'node:assert/strict';
import test from 'node:test';

import {
    alignExplicitLocationOperations,
    buildLatestTurnContract,
    buildPromptInjection,
    compactEntityFacts,
    compilePromptInjection,
    createEmptyStore,
    entityId,
    extractExplicitChoiceSet,
    extractDeclaredLocationNames,
    extractJsonObject,
    findUnresolvedIdentityPlaceholders,
    generatedProseIssue,
    incompleteProseReason,
    mergeEntityOperations,
    mergeMindOperations,
    messageRangeMatchesSnapshot,
    renderBrain,
    renderLoreContent,
    selectRelevantEntities,
    snapshotMessageRange,
    textMentions,
} from '../core.js';

test('latest-turn contract preserves a closed user choice set verbatim', () => {
    const text = 'Two options. Wards or Nameless. The council will vote on the decision. I have no objections to the outcome.';
    assert.deepEqual(extractExplicitChoiceSet(text), ['Wards', 'Nameless']);

    const contract = buildLatestTurnContract([
        { is_user: false, mes: 'They may become wards or enter a septry.' },
        { is_user: true, mes: text },
    ]);
    assert.match(contract, /CLOSED CHOICE SET \(2\): "Wards" \| "Nameless"/u);
    assert.match(contract, /Every earlier alternative outside this set is invalid/u);
    assert.match(contract, /Complete the requested vote, state the final tally/u);
    assert.match(contract, /Every counted vote must be attributable to a proper-named voter/u);
    assert.match(contract, /destination, mechanism, consequence/u);
    assert.match(contract, /USER HAS YIELDED TO THE OUTCOME/u);
    assert.match(contract, /IDENTITY GATE/u);
    assert.doesNotMatch(contract, /septry/iu);
});

test('latest-turn contract does not convert casual uses of or into closed choices', () => {
    assert.deepEqual(extractExplicitChoiceSet('I walk over or perhaps wait by the door.'), []);
    assert.deepEqual(extractExplicitChoiceSet('Do you know whether Aldric lives or died?'), []);
    assert.deepEqual(extractExplicitChoiceSet('The only choices are "take the northern road" or "remain at court".'), [
        'take the northern road',
        'remain at court',
    ]);
});

test('latest-turn contract preserves player speech ownership when an NPC is addressed', () => {
    const contract = buildLatestTurnContract([
        { is_user: false, mes: 'Harrow introduces himself to Jet and Freesia.' },
        { is_user: true, name: 'Jet Storm', mes: '"Thank you, Harrow. I appreciate it."' },
    ], { playerName: 'Jet Storm' });

    assert.match(contract, /PLAYER CHARACTER: "Jet Storm"/u);
    assert.match(contract, /standalone quoted line is spoken or performed by the player character/u);
    assert.match(contract, /used only in direct address is the recipient, not the speaker/u);
    assert.match(contract, /Never transfer the player character's dialogue, gratitude/u);
    assert.match(contract, /NPCs must respond to the actual speaker or actor/u);
    assert.match(contract, /"Thank you, Harrow\. I appreciate it\."/u);
});

test('latest-turn contract promotes a retrieved individual case policy without an emotion mapping', () => {
    const contract = buildLatestTurnContract([
        { is_user: true, name: 'Daniel', mes: 'Maya watches me reach for the door.' },
    ], {
        playerName: 'Daniel',
        expressionCaseStressPermitted: true,
        expressionCaseStressRequired: true,
        expressionCharacterName: 'Maya',
        expressionIdentityAnchor: 'I need reassurance and refuse to ask for it plainly.',
        expressionVoiceAnchor: 'My private voice turns exposed needs into irritated self-commands.',
        expressionOuterVoiceAnchor: 'I clip my public sentences and correct myself when a need nearly escapes.',
        expressionEmphasisAnchor: 'When restraint breaks, my private words compress to lower case, repeat, then punch one denied need into capitals.',
        expressionAnchorTerms: ['reassurance', 'refuse', 'ask'],
    });

    assert.match(contract, /expression_style_guidance priority="soft"/u);
    assert.match(contract, /prefer one sparse case shift inside direct private thought/iu);
    assert.match(contract, /expressive guidance, not a literal completion condition/iu);
    assert.doesNotMatch(contract, /MECHANICAL COMPLETION CHECK|final_surface_validation/iu);
    assert.match(contract, /INDIVIDUAL SURFACE POLICY: "When restraint breaks/iu);
    assert.match(contract, /private_specificity_gate priority="hard"/u);
    assert.match(contract, /FOCAL NPC: "Maya"/u);
    assert.match(contract, /STABLE PRIVATE LENS: "I need reassurance and refuse to ask for it plainly\."/u);
    assert.match(contract, /INDIVIDUAL SPOKEN FORM: "I clip my public sentences and correct myself/iu);
    assert.match(contract, /SUGGESTED LENS VOCABULARY: "reassurance" \| "refuse" \| "ask"/u);
    assert.match(contract, /freely express the same idea without copying it/iu);
    assert.match(contract, /A token stammer, one clipped word, or narrator commentary/iu);
    assert.match(contract, /INDIVIDUAL SURFACE POLICY as a palette, not a quota/iu);
    assert.match(contract, /Generic fear, generic bravery, generic compliance, and generic self-commands do not satisfy/iu);
});

test('latest-turn contract treats recurring mannerisms as cooled surfaces, not compulsory personality', () => {
    const contract = buildLatestTurnContract([
        { is_user: true, name: 'Jet Storm', mes: 'Show me how you maintain your sword.' },
    ], {
        playerName: 'Jet Storm',
        expressionSurfaceCooldown: true,
        expressionCharacterName: 'Freesia',
        expressionIdentityAnchor: 'I believe my mistakes define me more than any title ever could.',
        expressionVoiceAnchor: 'My thoughts run through anxious corrections.',
        expressionOuterVoiceAnchor: 'I stammer and restart around authority.',
        expressionAnchorTerms: ['mistakes', 'define', 'title'],
    });

    assert.match(contract, /surface_novelty_gate priority="hard"/u);
    assert.match(contract, /persistent anchor is an interpretive lens, not an instruction to mention or touch the same object/iu);
    assert.match(contract, /do not repeat a cooled gesture, prop interaction, gaze beat/iu);
    assert.match(contract, /without mechanically repeating its most obvious recent tic/iu);
    assert.match(contract, /cooldown already contains its stammer/iu);
    assert.match(contract, /Surface novelty must not flatten personality/iu);
});

test('incomplete prose detection catches hard stream cutoffs without flagging complete endings', () => {
    assert.equal(incompleteProseReason(''), 'empty output');
    assert.equal(
        incompleteProseReason('A fourth councilor hesitates. “The septry. It is'),
        'unclosed quotation',
    );
    assert.equal(
        incompleteProseReason('The Chancellor turns toward the'),
        'trailing connector',
    );
    assert.equal(
        incompleteProseReason('The Chancellor turns toward Eleanor'),
        'missing terminal punctuation',
    );
    assert.equal(
        incompleteProseReason('Lady Veyra, the Chancellor, inclines her head. “Wardship,” she says.'),
        '',
    );
    assert.equal(
        incompleteProseReason('“Wait—” Aldric catches the closing door.'),
        '',
    );
    assert.equal(
        incompleteProseReason('Lord Harrow answers, "Wards." Lady Voss follows. "Nameless." The tally is complete.'),
        '',
    );
});

test('generated prose validation rejects exposed control text without flagging natural prose', () => {
    assert.equal(
        generatedProseIssue('Aim for 120–190 words.\nMara opens the north door.'),
        'prompt instruction echo',
    );
    assert.equal(
        generatedProseIssue('Keep the reply 120–190 words.The rain hits the tower.'),
        'prompt instruction echo',
    );
    assert.equal(
        generatedProseIssue('Target 120–180 words.'),
        'prompt instruction echo',
    );
    assert.equal(
        generatedProseIssue('Aim for roughly 120–180The rain hits the tower.'),
        'prompt instruction echo',
    );
    assert.equal(
        generatedProseIssue('Aim for roughly 120Rowan walks Freesia to the northern target lane.'),
        'prompt instruction echo',
    );
    assert.equal(
        generatedProseIssue("Never write the player character's dialogue, thoughts, decisionsRain hits the tower."),
        'prompt instruction echo',
    );
    assert.equal(
        generatedProseIssue('Do not prematurely resolve the scene.'),
        'prompt instruction echo',
    );
    assert.equal(
        generatedProseIssue("Do not write the player character's next move, speech, or reaction after the described beat.Rain falls."),
        'prompt instruction echo',
    );
    assert.equal(
        generatedProseIssue('Leave the scene open for Rowan to act rather than prematurely concluding it.'),
        'prompt instruction echo',
    );
    assert.equal(
        generatedProseIssue('Keep the scene open for Rowan.The lever moves.'),
        'prompt instruction echo',
    );
    assert.equal(
        generatedProseIssue('“Do not leave the scene,” Mara says. Rain falls against the window.'),
        '',
    );
    assert.equal(
        generatedProseIssue("Do not recap the user's action back at them. Do not quote the user's message.\nMara opens the door."),
        'prompt instruction echo',
    );
    assert.equal(
        generatedProseIssue("Do not paraphrase the user's message back.\n\nKey facts from the latest user turn:\n1. Ari points at Mara."),
        'prompt instruction echo',
    );
    assert.equal(
        generatedProseIssue('<inner_lore_trigger_delivery mandatory="true">A courier arrives.</inner_lore_trigger_delivery>'),
        'internal prompt markup exposed',
    );
    assert.equal(
        generatedProseIssue('Use vivid, concrete detail selectively. Do not reveal private narrator-state facts as character knowledge.\n</context_contract>\nThe courier arrives.'),
        'internal prompt markup exposed',
    );
    assert.equal(
        generatedProseIssue('Do not end mid-sentence or mid-quotation.Rowan crosses to the covered weigh-station.'),
        'prompt instruction echo',
    );
    assert.equal(
        generatedProseIssue("Do not preempt the user's next input or resolveRowan steps onto the sand."),
        'prompt instruction echo',
    );
    assert.equal(
        generatedProseIssue('Avoid quoted strings with control-block markers.\n\nThe marker stones stand unchanged.'),
        'prompt instruction echo',
    );
    assert.equal(
        generatedProseIssue('Advance one meaningful beat; keep the reply roughly 120-180 words. Rain strikes the roof.'),
        'prompt instruction echo',
    );
    assert.equal(
        generatedProseIssue('“Do not end the sentence there,” Mara says. Rain falls against the window.'),
        '',
    );
    assert.equal(
        generatedProseIssue('Mara studies the note. “Your instructions say to finish in ten minutes,” she says.'),
        '',
    );
    assert.equal(generatedProseIssue('The Chancellor turns toward the'), 'trailing connector');
});

test('extractJsonObject ignores reasoning and Markdown fences', () => {
    const parsed = extractJsonObject('<think>private reasoning</think>```json\n{"entities":[],"minds":[],}\n```');
    assert.deepEqual(parsed, { entities: [], minds: [] });
});

test('entity patches preserve omitted canon and require explicit resolution', () => {
    const store = createEmptyStore('test');
    const created = mergeEntityOperations(store, [{
        type: 'location',
        name: 'The Glass Archive',
        aliases: ['Archive'],
        importance: 80,
        summary: 'A sealed repository beneath the old city.',
        facts: ['The eastern door requires a silver seal.'],
        unresolved: ['Who removed the seventh ledger?'],
    }], { messageIndex: 4, minimumImportance: 35 });
    assert.equal(created.created, 1);

    const id = entityId('location', 'The Glass Archive');
    mergeEntityOperations(store, [{
        type: 'location',
        name: 'Archive',
        aliases: ['The Glass Archive'],
        importance: 85,
        current_state: 'Its eastern door is open.',
    }], { messageIndex: 8, minimumImportance: 35 });

    const record = store.entities[id];
    assert.ok(record, 'alias update should merge into the existing location');
    assert.deepEqual(record.facts, ['The eastern door requires a silver seal.']);
    assert.deepEqual(record.unresolved, ['Who removed the seventh ledger?']);

    mergeEntityOperations(store, [{
        type: 'location',
        name: 'The Glass Archive',
        importance: 85,
        resolve_threads: ['Who removed the seventh ledger?'],
    }], { messageIndex: 10, minimumImportance: 35 });
    assert.deepEqual(record.unresolved, []);
});

test('location spatial assertions use stable keys and repeated no-op patches do not rewrite the record', () => {
    const store = createEmptyStore('spatial-invariants');
    const created = mergeEntityOperations(store, [{
        type: 'location',
        name: 'Lantern Room',
        importance: 90,
        spatial: { set: [
            { key: 'room_shape', kind: 'topology', subject: 'Lantern Room', relation: 'shape', object: 'octagonal', statement: 'The Lantern Room is octagonal.', confidence: 'confirmed' },
            { key: 'north_door', kind: 'entrance', subject: 'iron door', relation: 'door_at', object: 'north wall', statement: 'One iron door is set in the north wall.', confidence: 'confirmed' },
        ] },
    }], { messageIndex: 1, minimumImportance: 0 });
    assert.equal(created.created, 1);
    const record = store.entities[entityId('location', 'Lantern Room')];
    const revision = record.revision;

    const repeated = mergeEntityOperations(store, [{
        type: 'location',
        name: 'Lantern Room',
        importance: 90,
        spatial: { set: [
            { key: 'room_shape', kind: 'topology', subject: 'Lantern Room', relation: 'shape', object: 'octagonal', statement: 'The Lantern Room is octagonal.', confidence: 'confirmed' },
        ] },
    }], { messageIndex: 3, minimumImportance: 0 });
    assert.equal(repeated.updated, 0);
    assert.equal(repeated.skipped, 1);
    assert.equal(record.revision, revision);

    const changed = mergeEntityOperations(store, [{
        type: 'location',
        name: 'Lantern Room',
        importance: 90,
        spatial: { set: [
            { key: 'north_door', kind: 'entrance', subject: 'iron door', relation: 'door_at', object: 'east wall', statement: 'The iron door is now set in the east wall.', confidence: 'confirmed' },
        ] },
    }], { messageIndex: 5, minimumImportance: 0 });
    assert.equal(changed.updated, 1);
    assert.equal(record.spatial.invariants.north_door.object, 'east wall');
    assert.match(renderLoreContent(record), /Spatial invariants:[\s\S]*north_door/u);
});

test('canonical reconciliation keeps a named place as one location across item-labelled patches', () => {
    const store = createEmptyStore('canonical-place');
    mergeEntityOperations(store, [{
        type: 'location',
        name: 'Copper Mare Stable',
        importance: 80,
        summary: 'A twelve-stall stable beside the north gate.',
        spatial: { set: [{
            key: 'stall_count', kind: 'topology', subject: 'Copper Mare Stable',
            relation: 'contains', object: 'twelve stalls', statement: 'The stable contains twelve stalls.',
            confidence: 'confirmed',
        }] },
    }], { messageIndex: 2, minimumImportance: 0 });
    const result = mergeEntityOperations(store, [{
        type: 'item',
        name: 'Copper Mare Stable',
        importance: 75,
        facts: ['Its north doors have an iron latch.'],
    }], { messageIndex: 4, minimumImportance: 0 });

    assert.deepEqual(Object.keys(store.entities), ['location:copper mare stable']);
    const stable = store.entities['location:copper mare stable'];
    assert.equal(stable.type, 'location');
    assert.deepEqual(stable.facts, ['Its north doors have an iron latch.']);
    assert.ok(stable.spatial.invariants.stall_count);
    assert.equal(result.created, 0);
    assert.equal(result.updated, 1);
});

test('canonical reconciliation upgrades an item-labelled creature without duplicating it', () => {
    const store = createEmptyStore('canonical-creature');
    mergeEntityOperations(store, [{
        type: 'item', name: 'grey pigeon', importance: 70,
        summary: 'A grey pigeon bearing a green ribbon.',
    }], { messageIndex: 2, minimumImportance: 0 });
    const upgraded = mergeEntityOperations(store, [{
        type: 'creature', name: 'grey pigeon', importance: 80,
        facts: ['The pigeon descended into the training yard.'],
    }], { messageIndex: 4, minimumImportance: 0 });

    assert.deepEqual(Object.keys(store.entities), ['creature:grey pigeon']);
    assert.equal(store.entities['creature:grey pigeon'].type, 'creature');
    assert.match(store.entities['creature:grey pigeon'].summary, /green ribbon/u);
    assert.deepEqual(store.entities['creature:grey pigeon'].facts, [
        'The pigeon descended into the training yard.',
    ]);
    assert.equal(upgraded.created, 0);
    assert.equal(upgraded.updated, 1);
});

test('pre-existing cross-type duplicates collapse and structured containment links sublocations', () => {
    const store = createEmptyStore('canonical-cleanup');
    store.entities['location:copper mare stable'] = {
        id: 'location:copper mare stable', type: 'location', name: 'Copper Mare Stable', importance: 80,
        aliases: [], keys: [], facts: ['Twelve stalls.'], relationships: [], history: [], unresolved: [],
        spatial: { invariants: {} }, enabled: true, pinned: false, revision: 1,
    };
    store.entities['item:copper mare stable'] = {
        id: 'item:copper mare stable', type: 'item', name: 'Copper Mare Stable', importance: 60,
        aliases: [], keys: [], facts: ['A cracked green trough stands inside.'], relationships: [], history: [], unresolved: [],
        enabled: true, pinned: false, revision: 1,
    };
    store.entities['location:ashwood way shrine'] = {
        id: 'location:ashwood way shrine', type: 'location', name: 'Ashwood Way Shrine', importance: 75,
        aliases: [], keys: [], facts: [], relationships: [], history: [], unresolved: [], enabled: true, pinned: false, revision: 1,
        spatial: { invariants: {
            square_well: {
                key: 'square_well', kind: 'placement', subject: 'Square Well', relation: 'located_at',
                object: 'ten paces east of the marker stones', statement: 'The Square Well stands ten paces east of the shrine marker stones.',
                confidence: 'confirmed', sourceMessage: 5,
            },
        } },
    };

    const cleaned = mergeEntityOperations(store, [{
        type: 'location', name: 'Square Well', importance: 55,
        summary: 'A square stone well beside the shrine.',
    }], { messageIndex: 8, minimumImportance: 0 });

    assert.equal(cleaned.reconciled, 1);
    assert.deepEqual(cleaned.removedIds, ['item:copper mare stable']);
    assert.equal(Object.values(store.entities).filter(entity => entity.name === 'Copper Mare Stable').length, 1);
    assert.deepEqual(store.entities['location:copper mare stable'].facts.sort(), [
        'A cracked green trough stands inside.',
        'Twelve stalls.',
    ]);
    const well = store.entities['location:square well'];
    assert.equal(well.parentLocationId, 'location:ashwood way shrine');
    assert.equal(well.parentLocationName, 'Ashwood Way Shrine');
    assert.equal(well.spatial.invariants.parent_location.relation, 'part_of');
});

test('explicitly established sublocations keep their full names before curator merge', () => {
    const store = createEmptyStore('explicit-location-identities');
    mergeEntityOperations(store, [{
        type: 'location', name: 'East Gate', importance: 80,
        summary: 'The outer gate of the town.',
    }], { messageIndex: 1, minimumImportance: 0 });
    const passage = [
        '[message 14; PLAYER — Rowan]',
        'At the Garrison Training Yard I stop to establish fixed landmarks: a square court and a west rack.',
        '[message 26; PLAYER — Rowan]',
        'At the East Gate Watchhouse I establish fixed landmarks: a duty board and an east-window bench.',
    ].join('\n');
    assert.deepEqual(extractDeclaredLocationNames(passage), [
        'Garrison Training Yard',
        'East Gate Watchhouse',
    ]);
    const aligned = alignExplicitLocationOperations(store, [
        {
            type: 'location', name: 'garrison barracks', importance: 85,
            summary: 'The Garrison Training Yard has a square court and west rack.',
        },
        {
            type: 'location', name: 'East Gate', importance: 85,
            summary: 'The gate complex has a slate duty board and east-window bench.',
        },
    ], passage);
    assert.deepEqual(aligned.map(operation => operation.name), [
        'Garrison Training Yard',
        'East Gate Watchhouse',
    ]);
    assert.equal(aligned[1].parent_location, 'East Gate');
});

test('an omitted explicitly established location receives one minimal canonical seed', () => {
    const aligned = alignExplicitLocationOperations(
        createEmptyStore('explicit-location-seed'),
        [{ type: 'character', name: 'Mara', importance: 80 }],
        'At the Old Quarry I establish fixed landmarks before Mara speaks.',
    );
    assert.deepEqual(aligned.map(operation => [operation.type, operation.name]), [
        ['character', 'Mara'],
        ['location', 'Old Quarry'],
    ]);
    assert.deepEqual(
        extractDeclaredLocationNames('At the table I establish which reports are true.'),
        [],
    );
});

test('insignificant new entities are rejected but existing records can still update', () => {
    const store = createEmptyStore('test');
    const result = mergeEntityOperations(store, [{
        type: 'item',
        name: 'Ordinary Spoon',
        importance: 10,
        facts: ['It is clean.'],
    }], { minimumImportance: 35, messageIndex: 1 });
    assert.equal(result.skipped, 1);
    assert.equal(Object.keys(store.entities).length, 0);
});

test('character fact compaction removes dialogue ledgers but preserves durable canon', () => {
    const character = {
        type: 'character',
        name: 'Freesia',
        facts: [
            "Freesia is Jet's squire.",
            'Freesia said she would wait in her room.',
            'Freesia asked which books Jet would bring.',
            'Her borrowed tunic belongs to the household.',
        ],
    };
    assert.deepEqual(compactEntityFacts(character), [
        "Freesia is Jet's squire.",
        'Her borrowed tunic belongs to the household.',
    ]);
    assert.deepEqual(compactEntityFacts({
        type: 'item',
        facts: ['The plaque says the eastern door requires a silver seal.'],
    }), ['The plaque says the eastern door requires a silver seal.']);
});

test('character minds remain compartmentalized and reuse stable keys', () => {
    const store = createEmptyStore('test');
    mergeMindOperations(store, [
        {
            character: 'Mara',
            persistent_self: { set: [
                { key: 'hidden_map', kind: 'secret', statement: 'I hid the map beneath my coat.', confidence: 'confirmed' },
            ] },
            relationships: [{
                target: 'Ivo',
                set: [{ key: 'trust', kind: 'trust', statement: 'I do not trust Ivo yet.', confidence: 'inferred' }],
            }],
        },
        {
            character: 'Ivo',
            persistent_self: { set: [{ key: 'opinion_of_mara', kind: 'opinion', statement: 'I think Mara is withholding something.', confidence: 'inferred' }] },
        },
    ], { messageIndex: 3, maximumThoughts: 20 });

    mergeMindOperations(store, [{
        character: 'Mara',
        relationships: [{
            target: 'Ivo',
            set: [{ key: 'trust', kind: 'trust', statement: 'I trust Ivo with the door, but not the map.', confidence: 'confirmed' }],
        }],
    }], { messageIndex: 6, maximumThoughts: 20 });

    assert.equal(store.brains.mara.persistentSelf.relationships.ivo.aspects.trust.statement, 'I trust Ivo with the door, but not the map.');
    assert.equal(store.brains.ivo.persistentSelf.facets.hidden_map, undefined);
    assert.equal(store.brains.mara.persistentSelf.facets.hidden_map.confidence, 'confirmed');
});

test('Current Mind replaces transient state without polluting Persistent Self', () => {
    const store = createEmptyStore('bounded-minds');
    mergeMindOperations(store, [{
        character: 'Mara',
        relationships: [{ target: 'Ivo', set: [{
            key: 'trust', kind: 'trust', statement: 'I do not trust Ivo yet.', confidence: 'inferred',
        }] }],
    }], { messageIndex: 2, maximumThoughtChanges: 6, maximumSceneThoughts: 2 });

    mergeMindOperations(store, [{
        character: 'Mara',
        persistent_self: { set: [{ key: 'recover_map', kind: 'goal', statement: 'I must recover the map.' }] },
        relationships: [{ target: 'Ivo', set: [{
            key: 'trust', kind: 'trust', statement: 'I trust Ivo with the door, but not the map.', confidence: 'confirmed',
        }] }],
        current_mind: {
            interpretation: 'That glance was meant to test me.',
            emotions: [{ name: 'embarrassment', intensity: 'high', cause: 'Ivo noticed my hesitation.' }],
            inner_thoughts: ['He saw that. Damn it.', 'Do not let him see me flinch.'],
            impulse: 'Hide the map and retreat.',
            restraint: 'Leaving now would confirm his suspicion.',
        },
    }], {
        messageIndex: 5,
        maximumThoughts: 20,
        maximumThoughtChanges: 4,
        maximumSceneThoughts: 1,
    });

    const brain = store.brains.mara;
    assert.equal(brain.persistentSelf.relationships.ivo.aspects.trust.statement, 'I trust Ivo with the door, but not the map.');
    assert.ok(brain.persistentSelf.facets.recover_map);
    assert.equal(brain.currentMind.innerThoughts.length, 1);
    assert.equal(Object.values(brain.persistentSelf.facets).some(facet => /glance|flinch/iu.test(facet.statement)), false);

    mergeMindOperations(store, [{
        character: 'Mara',
        current_mind: { interpretation: 'Ivo has moved on.', inner_thoughts: ['Good. Focus.'] },
    }], { messageIndex: 6, maximumSceneThoughts: 1 });
    assert.deepEqual(brain.currentMind.innerThoughts, ['Good. Focus.']);
});

test('NPC brain consolidation removes near-duplicate durable facets but preserves contradiction', () => {
    const store = createEmptyStore('brain-consolidation');
    const result = mergeMindOperations(store, [{
        character: 'Freesia',
        persistent_self: { set: [
            {
                key: 'trusts_rowan_correction', kind: 'belief',
                statement: 'I trust Rowan to correct me without humiliating me.', confidence: 'confirmed', basis: 'story',
            },
            {
                key: 'trusts_rowan_mistakes', kind: 'belief',
                statement: 'I trust Rowan to correct my mistakes without humiliating me.', confidence: 'confirmed', basis: 'story',
            },
            {
                key: 'doubts_rowan', kind: 'belief',
                statement: 'I do not trust Rowan to correct me without humiliating me.', confidence: 'inferred', basis: 'story',
            },
        ] },
    }], {
        messageIndex: 20,
        maximumThoughtChanges: 6,
        maximumThoughts: 30,
        minimumStoryFacetObservations: 1,
        consolidationSimilarity: 0.88,
    });

    const facets = Object.values(store.brains.freesia.persistentSelf.facets);
    assert.equal(result.consolidatedEntries, 1);
    assert.equal(facets.length, 2);
    assert.ok(facets.some(entry => entry.statement.includes('my mistakes')));
    assert.ok(facets.some(entry => /do not trust/u.test(entry.statement)));
    assert.ok(facets.some(entry => entry.basis === 'consolidated'));
    assert.equal(store.brains.freesia.consolidation.totalMerged, 1);
});

test('NPC brain consolidation never merges different names or numeric anchors', () => {
    const store = createEmptyStore('brain-anchor-consolidation');
    const result = mergeMindOperations(store, [{
        character: 'Freesia',
        persistent_self: { set: [
            { key: 'rowan_first', kind: 'belief', statement: 'I trust Rowan to guard gate 1 without abandoning me.' },
            { key: 'ivo_first', kind: 'belief', statement: 'I trust Ivo to guard gate 1 without abandoning me.' },
            { key: 'rowan_second', kind: 'belief', statement: 'I trust Rowan to guard gate 2 without abandoning me.' },
        ] },
    }], {
        messageIndex: 20,
        maximumThoughtChanges: 6,
        maximumThoughts: 30,
        minimumStoryFacetObservations: 1,
        consolidationSimilarity: 0.88,
    });

    assert.equal(result.consolidatedEntries, 0);
    assert.equal(Object.keys(store.brains.freesia.persistentSelf.facets).length, 3);
});

test('mind injection preserves durable personality anchors without letting one conflict dominate', () => {
    const brain = {
        name: 'Freesia',
        persistentSelf: {
            voice: {},
            relationships: {},
            facets: {
                fear_of_failure: { key: 'fear_of_failure', kind: 'fear', confidence: 'inferred', sourceMessage: 2, statement: "I'm afraid I'll fail before I can prove myself." },
                desire_to_prove_herself: { key: 'desire_to_prove_herself', kind: 'desire', confidence: 'confirmed', sourceMessage: 4, statement: 'I want to earn my place and make my reputation a liar.' },
                conflict_one: { key: 'conflict_one', kind: 'contradiction', confidence: 'confirmed', sourceMessage: 20, statement: 'I hate being measured by a scale no one explains.' },
                conflict_two: { key: 'conflict_two', kind: 'contradiction', confidence: 'confirmed', sourceMessage: 20, statement: 'I distrust what he meant when he measured me.' },
                conflict_three: { key: 'conflict_three', kind: 'contradiction', confidence: 'confirmed', sourceMessage: 20, statement: 'I still resent the argument about being measured.' },
                current_belief: { key: 'current_belief', kind: 'belief', confidence: 'confirmed', sourceMessage: 20, statement: 'The promised lesson may finally show me what he expects.' },
            },
        },
    };

    const rendered = renderBrain(brain, 3_000, {
        currentIndex: 20,
        focusText: 'He ends the argument and promises a lesson in her room.',
        maximumThoughts: 6,
    });
    assert.match(rendered, /afraid I'll fail/u);
    assert.match(rendered, /earn my place/u);
    assert.ok((rendered.match(/\[contradiction;/gu) || []).length <= 2);
});

test('role-only characters are flagged and explicitly promote to one public identity', () => {
    const store = createEmptyStore('identity-promotion');
    mergeEntityOperations(store, [{
        type: 'character',
        name: 'Lord Chancellor',
        aliases: ['The Chancellor'],
        identity_kind: 'descriptor',
        importance: 75,
        summary: 'A consequential court official whose public name has not been stated.',
    }], { minimumImportance: 0, messageIndex: 2 });
    mergeMindOperations(store, [{
        character: 'Lord Chancellor',
        identity_kind: 'descriptor',
        set: [{ key: 'current_goal', category: 'goal', thought: 'I must present the ruling.', confidence: 'confirmed' }],
    }], { messageIndex: 2 });

    const unnamedPassage = 'The Lord Chancellor steps forward. “The court has reached its decision.” The Chancellor waits.';
    assert.deepEqual(findUnresolvedIdentityPlaceholders(store.entities, unnamedPassage), ['Lord Chancellor']);
    assert.match(
        buildLatestTurnContract([{ is_user: true, mes: 'Proceed to the next matter.' }], {
            identityPlaceholders: ['Lord Chancellor'],
        }),
        /REQUIRED IDENTITY REPAIRS: "Lord Chancellor"/u,
    );

    mergeEntityOperations(store, [{
        type: 'character',
        name: 'Osric Vale',
        aliases: ['Lord Chancellor', 'The Chancellor'],
        identity_kind: 'public_name',
        promote_name: true,
        importance: 80,
        current_state: 'Osric Vale has publicly sealed the ruling.',
    }], { minimumImportance: 0, messageIndex: 4 });

    assert.equal(store.entities['character:lord chancellor'], undefined);
    assert.equal(store.entities['character:osric vale'].name, 'Osric Vale');
    assert.ok(store.entities['character:osric vale'].aliases.includes('Lord Chancellor'));
    assert.equal(store.brains['lord chancellor'], undefined);
    assert.equal(store.brains['osric vale'].name, 'Osric Vale');
    assert.equal(store.brains['osric vale'].persistentSelf.facets.current_goal.statement, 'I must present the ruling.');
    assert.deepEqual(
        findUnresolvedIdentityPlaceholders(store.entities, 'Osric Vale, the Lord Chancellor, seals the ruling.'),
        [],
    );
});

test('relevance scanning uses aliases and injection is bounded to the current scene', () => {
    const store = createEmptyStore('test');
    mergeEntityOperations(store, [{
        type: 'location',
        name: 'The Glass Archive',
        aliases: ['Archive'],
        importance: 90,
        summary: 'A sealed repository.',
    }], { minimumImportance: 0, messageIndex: 2 });
    mergeMindOperations(store, [{
        character: 'Mara',
        set: [{ key: 'goal', category: 'goal', thought: 'I need to recover the seventh ledger.', confidence: 'confirmed' }],
    }], { messageIndex: 2 });

    assert.equal(textMentions('Mara enters the Archive.', ['The Glass Archive', 'Archive']), true);
    assert.equal(selectRelevantEntities(store.entities, 'Mara enters the Archive.', { currentIndex: 20 })[0].name, 'The Glass Archive');

    const injection = buildPromptInjection(store, 'Mara enters the Archive.', {
        enabled: true,
        innerSelfEnabled: true,
        autoLoreEnabled: true,
        currentIndex: 3,
        maximumActiveBrains: 2,
        maximumInjectedEntities: 2,
        brainInjectionBudget: 1_500,
        loreInjectionBudget: 1_500,
    });
    assert.match(injection, /narrator_only="true"/);
    assert.match(injection, /Mara/);
    assert.match(injection, /Glass Archive/);
    assert.match(injection, /never let one character know another's secrets/i);
});

test('strong scene retrieval stores but omits unrelated off-screen open threads', () => {
    const store = createEmptyStore('scene-filter');
    mergeEntityOperations(store, [
        {
            type: 'location',
            name: "Jet Storm's house",
            importance: 90,
            current_state: 'Freesia is returning from the hot spring.',
        },
        {
            type: 'character',
            name: 'Freesia',
            importance: 90,
            current_state: 'She is walking toward the house.',
        },
        {
            type: 'character',
            name: 'Harrow',
            importance: 80,
            current_state: 'He remains elsewhere.',
            unresolved: ['What will Harrow do with the cellar prisoner?'],
        },
        {
            type: 'character',
            name: 'Bound prisoner',
            importance: 80,
            current_state: 'The prisoner remains in the cellar.',
            unresolved: ['Who arranged the imprisonment?'],
        },
    ], { minimumImportance: 0, messageIndex: 2 });

    const compiled = compilePromptInjection(store, 'Earlier, Harrow guarded the prisoner.', {
        enabled: true,
        innerSelfEnabled: false,
        autoLoreEnabled: true,
        currentIndex: 30,
        maximumInjectedEntities: 6,
        loreInjectionBudget: 5_000,
        scene: {
            location: { id: entityId('location', "Jet Storm's house"), name: "Jet Storm's house" },
            participants: [{ id: 'character:freesia', name: 'Freesia' }],
            objects: [],
            latestText: 'Freesia walks up the path toward the house.',
            focusText: 'Freesia returns to the house to dress and wait for her lesson.',
        },
    });

    assert.deepEqual(compiled.selectedEntities.map(item => item.name), [
        "Jet Storm's house",
        'Freesia',
    ]);
    assert.ok(compiled.omittedEntities.some(item => item.name === 'Harrow'));
    assert.ok(compiled.omittedEntities.some(item => item.name === 'Bound prisoner'));
    assert.doesNotMatch(compiled.text, /cellar prisoner|arranged the imprisonment/iu);
});

test('manual lore content is protected from automatic rendering', () => {
    const content = renderLoreContent({
        type: 'item',
        name: 'Moon Key',
        manualOverride: true,
        manualContent: 'This is the user-edited canonical entry.',
    });
    assert.equal(content, 'This is the user-edited canonical entry.');
});

test('message snapshots reject a response generated for a discarded swipe', () => {
    const chat = [
        { is_user: true, mes: 'What happened?' },
        { is_user: false, mes: 'Rejected first swipe.' },
    ];
    const snapshot = snapshotMessageRange(chat, 0, 1);
    assert.equal(messageRangeMatchesSnapshot(chat, snapshot), true);

    chat[1].mes = 'Selected replacement swipe.';
    assert.equal(messageRangeMatchesSnapshot(chat, snapshot), false);
});
