import assert from 'node:assert/strict';
import test from 'node:test';

import {
    appendDslEvaluationKeyContract,
    appendOutputDiagnostics,
    dslOutputContract,
    escalateRepairSettings,
    normalizeOutputFormat,
    outputParseDiagnostics,
    parseInnerLoreDsl,
    parseInnerLoreOutput,
    prepareOutputMessages,
    stringifyInnerLoreDsl,
    structuredRequestOptions,
} from '../output-codec.js';

test('curator DSL maps readable location and mind records to the canonical object', () => {
    const result = parseInnerLoreDsl(`Some harmless provider preamble.
\`\`\`dsl
INNERLORE CURATOR 1
LOCATION Ben Tavern
importance = 72
aliases += Ben's Place
facts += The brass bell hangs above the east door.
spatial.set[0].key = east_door
spatial.set[0].kind = entrance
spatial.set[0].subject = Ben Tavern
spatial.set[0].relation = entrance_at
spatial.set[0].object = east wall
spatial.set[0].statement = The entrance is in the east wall.
spatial.set[0].confidence = confirmed
END
MIND Freesia
active = TRUE
persistent_self.set[0].key = prove_myself
persistent_self.set[0].kind = goal
persistent_self.set[0].statement = I will earn this post through the work.
persistent_self.set[0].confidence = confirmed
persistent_self.set[0].basis = story
current_mind.inner_thoughts += I can do the next part.
END
DONE
\`\`\`` , 'curator');

    assert.equal(result.entities[0].type, 'location');
    assert.equal(result.entities[0].name, 'Ben Tavern');
    assert.equal(result.entities[0].importance, 72);
    assert.equal(result.entities[0].spatial.set[0].relation, 'entrance_at');
    assert.equal(result.minds[0].character, 'Freesia');
    assert.equal(result.minds[0].active, true);
    assert.deepEqual(result.minds[0].current_mind.inner_thoughts, ['I can do the next part.']);
});

test('all three DSL task payloads survive a canonical round trip', () => {
    const fixtures = [
        ['curator', {
            entities: [{
                type: 'item', name: 'Seal 7', importance: 81,
                aliases: [], facts: ['Its mark reads "VII".', 'A line\nbreak is preserved.'],
                spatial: { set: [], delete: ['old_placement'] },
            }],
            minds: [{
                character: 'Freesia', active: true, clear_current_mind: false,
                current_mind: null,
                relationships: [{
                    target: 'Rowan', aliases: ['Ser Rowan'],
                    set: [{ key: 'earned_trust', kind: 'trust', statement: 'I trust his corrections.', confidence: 'inferred', basis: 'story' }],
                }],
            }],
        }],
        ['progression', {
            time: {
                elapsed: { minimum_seconds: 10, estimated_seconds: 20, maximum_seconds: 40 },
                confidence: 0.75, basis: [], completed_actions: ['Rowan opens the door.'],
            },
            goals: [{ key: 'prepare', owner: 'Freesia', progress: 0, status: 'active', blockers: [] }],
            processes: [],
            events: [{ key: 'arrival', requires_player_action: false, subjects: ['Courier'] }],
            event_evaluations: [{
                key: 'door', evaluated: true, reason: 'The configured action matched.',
                trigger_action: {
                    matched: true, actor: 'Rowan', evidence: ['Rowan opens the door.'], message_indexes: [4],
                },
            }],
        }],
        ['event_director', {
            proposal: {
                key: 'bell_jam', title: 'The bell jams', trigger_mode: 'any',
                trigger_after_seconds: 300, subjects: ['Ben Tavern'], priority: 55,
                confidence: 0.91, source_refs: [{ kind: 'lore', id: 'lore:location:ben_tavern' }],
            },
            reason: 'The mechanism is unresolved.',
        }],
        ['event_director', { proposal: null, reason: 'No grounded proposal is useful yet.' }],
    ];

    for (const [task, fixture] of fixtures) {
        const encoded = stringifyInnerLoreDsl(fixture, task);
        assert.deepEqual(parseInnerLoreDsl(encoded, task), fixture, `${task}\n${encoded}`);
    }
});

test('DSL typed values preserve ambiguous strings and escaped text', () => {
    const parsed = parseInnerLoreDsl(`INNERLORE CURATOR 1
CONCEPT Typed values
facts += TEXT TRUE
facts += TEXT 12
facts += one\\ntwo
importance = 12
promote_name = FALSE
description = A path with C:\\\\notes remains readable.
END
DONE`, 'curator');

    assert.deepEqual(parsed.entities[0].facts, ['TRUE', '12', 'one\ntwo']);
    assert.equal(parsed.entities[0].importance, 12);
    assert.equal(parsed.entities[0].promote_name, false);
    assert.equal(parsed.entities[0].description, 'A path with C:\\notes remains readable.');
});

test('DSL safely normalizes an empty ITEM and an omitted ITEM boundary before a repeated stable key', () => {
    const parsed = parseInnerLoreDsl(`INNERLORE CURATOR 1
LOCATION Ben Tavern
ITEM spatial.set
END
ITEM spatial.set
key = east_door
kind = entrance
key = north_hearth
kind = fixture
END
END
DONE`, 'curator');

    assert.deepEqual(parsed.entities[0].spatial.set, [
        { key: 'east_door', kind: 'entrance' },
        { key: 'north_hearth', kind: 'fixture' },
    ]);
    assert.deepEqual(outputParseDiagnostics(parsed).map(item => item.code).sort(), [
        'empty_item_removed', 'implicit_item_rollover',
    ]);
});

test('DSL recovers explicit top-level records after omitted END and a premature DONE marker', () => {
    const parsed = parseInnerLoreDsl(`INNERLORE PROGRESSION 1
TIME
elapsed.minimum_seconds = 1
elapsed.estimated_seconds = 2
elapsed.maximum_seconds = 3
confidence = 0.8
GOAL prepare
owner = Freesia
status = active
END
DONE
EVALUATION exact_alarm_key
evaluated = TRUE
reason = Nothing matched.
END
DONE`, 'progression');

    assert.equal(parsed.goals[0].key, 'prepare');
    assert.equal(parsed.event_evaluations[0].key, 'exact_alarm_key');
    assert.deepEqual(outputParseDiagnostics(parsed).map(item => item.code), [
        'implicit_end_before_record', 'premature_done_ignored',
    ]);
});

test('DSL ignores a surplus END only after all data-bearing records are closed', () => {
    const parsed = parseInnerLoreDsl(`INNERLORE CURATOR 1
LOCATION Ben Tavern
importance = 70
END
END
DONE`, 'curator');
    assert.equal(parsed.entities[0].name, 'Ben Tavern');
    assert.deepEqual(outputParseDiagnostics(parsed), [{ code: 'orphan_end_ignored', lineNumber: 5 }]);
});

test('DSL normalizes GLM shorthand for relationship and repeated emotion item blocks', () => {
    const parsed = parseInnerLoreDsl(`INNERLORE CURATOR 1
MIND Freesia
relationships
ITEM Rowan
ITEM set
key = precise_correction
kind = trust
statement = I trust the precision.
confidence = inferred
basis = story
END
END
END
current_mind.emotions
name = anxiety
intensity = moderate
cause = The inspection.
current_mind.emotions
name = hope
intensity = low
cause = One success.
current_mind.impulse = Keep practicing.
END
DONE`, 'curator');

    assert.equal(parsed.minds[0].relationships[0].target, 'Rowan');
    assert.equal(parsed.minds[0].relationships[0].set[0].key, 'precise_correction');
    assert.deepEqual(parsed.minds[0].current_mind.emotions.map(item => item.name), ['anxiety', 'hope']);
    assert.equal(parsed.minds[0].current_mind.impulse, 'Keep practicing.');
    const codes = outputParseDiagnostics(parsed).map(item => item.code);
    assert.ok(codes.includes('bare_item_path_normalized'));
    assert.ok(codes.includes('named_relationship_item_normalized'));
    assert.ok(codes.includes('implicit_end_before_root_item'));
    assert.ok(codes.includes('implicit_end_before_root_field'));
});

test('DSL losslessly normalizes observed GLM continuation, identity, null-list, and emotion tuple shorthand', () => {
    const curator = parseInnerLoreDsl(`INNERLORE CURATOR 1
CHARACTER Freesia
facts += Completed the drill.
+= Corrected her retreat.
+= Chose the lighter bow.
unresolved = Whether Rowan will accept her remains unanswered.
unresolved = Whether the marshal will approve her remains unanswered.
END
MIND Freesia
current_mind.emotions = NULL
ITEM current_mind.emotions
name = wary pride
intensity = moderate
cause = The inspection went well.
END
current_mind.emotions = Unease|low|The latch tripped after the shot.
current_mind.emotions = Fragile confidence|moderate|Her answer held steady.
END
DONE`, 'curator');

    assert.deepEqual(curator.entities[0].facts, [
        'Completed the drill.', 'Corrected her retreat.', 'Chose the lighter bow.',
    ]);
    assert.deepEqual(curator.entities[0].unresolved, [
        'Whether Rowan will accept her remains unanswered.',
        'Whether the marshal will approve her remains unanswered.',
    ]);
    assert.deepEqual(curator.minds[0].current_mind.emotions, [
        { name: 'wary pride', intensity: 'moderate', cause: 'The inspection went well.' },
        { name: 'Unease', intensity: 'low', cause: 'The latch tripped after the shot.' },
        { name: 'Fragile confidence', intensity: 'moderate', cause: 'Her answer held steady.' },
    ]);
    assert.deepEqual(outputParseDiagnostics(curator).map(item => item.code), [
        'implicit_list_path',
        'implicit_list_path',
        'scalar_list_assignment_normalized',
        'scalar_list_assignment_normalized',
        'null_list_reopened',
        'emotion_tuple_normalized',
        'emotion_tuple_normalized',
    ]);

    const progression = parseInnerLoreDsl(`INNERLORE PROGRESSION 1
TIME
elapsed.minimum_seconds = 40
elapsed.estimated_seconds = 60
elapsed.maximum_seconds = 100
confidence = 0.8
ITEM timeline
retrieval
description = Freesia retrieves the arrow.
actor = Freesia
kind = action
evidence =The arrow is back in her hand.
END
END
DONE`, 'progression');
    assert.equal(progression.time.timeline[0].key, 'retrieval');
    assert.equal(progression.time.timeline[0].evidence, 'The arrow is back in her hand.');
    assert.deepEqual(outputParseDiagnostics(progression), [{
        code: 'bare_item_identity_normalized', lineNumber: 8, path: 'timeline', field: 'key',
    }]);
});

test('DSL maps repeated dotted emotion fields to distinct list items', () => {
    const parsed = parseInnerLoreDsl(`INNERLORE CURATOR 1
MIND Freesia
current_mind.emotions.name = pride
current_mind.emotions.intensity = moderate
current_mind.emotions.cause = The inspection went cleanly.
current_mind.emotions.name = anxiety
current_mind.emotions.intensity = low
current_mind.emotions.cause = Noon is approaching.
END
DONE`, 'curator');

    assert.deepEqual(parsed.minds[0].current_mind.emotions, [
        { name: 'pride', intensity: 'moderate', cause: 'The inspection went cleanly.' },
        { name: 'anxiety', intensity: 'low', cause: 'Noon is approaching.' },
    ]);
    assert.deepEqual(outputParseDiagnostics(parsed).map(item => item.code), [
        'dotted_emotion_item_normalized', 'dotted_emotion_item_normalized',
    ]);
});

test('DSL ignores idempotent duplicates and applies last-wins to conflicting ones', () => {
    const parsed = parseInnerLoreDsl(`INNERLORE CURATOR 1
LOCATION Ben Tavern
type = location
importance = 70
importance = 70
END
DONE`, 'curator');
    assert.equal(parsed.entities[0].type, 'location');
    assert.equal(parsed.entities[0].importance, 70);
    assert.deepEqual(outputParseDiagnostics(parsed).map(item => item.code), [
        'duplicate_scalar_ignored', 'duplicate_scalar_ignored',
    ]);

    // JSON.parse keeps the last duplicate key; the DSL layer matches that
    // semantics instead of spending a repair call on a harmless conflict.
    const overwritten = parseInnerLoreDsl(`INNERLORE CURATOR 1
LOCATION Ben Tavern
importance = 70
importance = 71
END
DONE`, 'curator');
    assert.equal(overwritten.entities[0].importance, 71);
    assert.deepEqual(outputParseDiagnostics(overwritten).map(item => item.code), [
        'duplicate_scalar_overwritten',
    ]);
});

test('DSL rejects incomplete, unsafe, duplicate, and sparse assignments', () => {
    assert.throws(
        () => parseInnerLoreDsl('INNERLORE CURATOR 1\nLOCATION Ben Tavern\nname = Duplicate\nEND', 'curator'),
        /assigned twice|DONE marker/u,
    );
    assert.throws(
        () => parseInnerLoreDsl('INNERLORE CURATOR 1\nLOCATION Ben Tavern\nconstructor.value = unsafe\nEND\nDONE', 'curator'),
        /unsafe field name/u,
    );
    assert.throws(
        () => parseInnerLoreDsl('INNERLORE CURATOR 1\nLOCATION Ben Tavern\nspatial.set\[1\].key = gap\nEND\nDONE', 'curator'),
        /creates a gap/u,
    );
    assert.throws(
        () => parseInnerLoreDsl('INNERLORE PROGRESSION 1\nDONE', 'progression'),
        /missing its TIME record/u,
    );
});

test('output selection retains JSON compatibility and gives DSL an explicit transport contract', () => {
    const json = parseInnerLoreOutput('{"entities":[],"minds":[]}', { format: 'json', task: 'curator' });
    assert.deepEqual(json, { entities: [], minds: [] });
    assert.equal(normalizeOutputFormat('unexpected'), 'json');
    assert.deepEqual(structuredRequestOptions('json', { name: 'schema' }), { jsonSchema: { name: 'schema' } });
    assert.deepEqual(structuredRequestOptions('dsl', { name: 'schema' }), {});

    const messages = prepareOutputMessages([
        { role: 'system', content: 'Return one strict JSON object.\nOUTPUT SCHEMA\n{"entities":[]}' },
        { role: 'user', content: 'The attempted response failed strict validation. Return one corrected strict JSON object only. Return the strict JSON patch now.' },
    ], { format: 'dsl', task: 'curator' });
    assert.match(messages[0].content, /Return InnerLore DSL v1, not JSON/u);
    assert.match(messages[0].content, /DSL FIELD REFERENCE/u);
    assert.doesNotMatch(messages[0].content, /\{"entities"/u);
    assert.match(messages[1].content, /INNERLORE CURATOR 1 DSL document/u);
    assert.doesNotMatch(messages[1].content, /strict JSON/u);
    assert.match(dslOutputContract('event_director'), /NO_PROPOSAL/u);
    const directorMessages = prepareOutputMessages([
        { role: 'system', content: 'Return one strict JSON object.\nOUTPUT SCHEMA\n{"proposal":null}\n\nOmit trigger_after_seconds when unused.' },
    ], { format: 'dsl', task: 'event_director' });
    assert.match(directorMessages[0].content, /activation_visibility = hidden\|observable/u);

    appendDslEvaluationKeyContract(messages, 'dsl', ['range_clear_bell', 'marshal_writ']);
    assert.match(messages[0].content, /EVALUATION range_clear_bell/u);
    assert.match(messages[0].content, /do not shorten a key/iu);
});

test('only an exact uppercase TEXT prefix forces a string scalar', () => {
    const parsed = parseInnerLoreDsl(`INNERLORE CURATOR 1
EVENT text is a medium
summary = Text message arrived
facts += text begins plainly
facts += TEXT remains forced
END
DONE`, 'curator');

    assert.equal(parsed.entities[0].name, 'text is a medium');
    assert.equal(parsed.entities[0].summary, 'Text message arrived');
    assert.deepEqual(parsed.entities[0].facts, ['text begins plainly', 'remains forced']);

    const encoded = stringifyInnerLoreDsl({
        entities: [{ type: 'event', name: 'TEXT is quoted', facts: ['text stays plain'] }],
        minds: [],
    }, 'curator');
    const restored = parseInnerLoreDsl(encoded, 'curator');
    assert.equal(restored.entities[0].name, 'TEXT is quoted');
    assert.deepEqual(restored.entities[0].facts, ['text stays plain']);
});

test('parseInnerLoreOutput salvages truncated and DONE-less DSL documents', () => {
    // Complete records with only the DONE marker missing: nothing is dropped
    // and no repair call is needed.
    const missingDone = parseInnerLoreOutput(
        'INNERLORE CURATOR 1\nLOCATION Ben Tavern\nimportance = 70\nEND',
        { format: 'dsl', task: 'curator', salvageTruncated: true },
    );
    assert.equal(missingDone.entities[0].name, 'Ben Tavern');
    assert.deepEqual(outputParseDiagnostics(missingDone), [{
        code: 'missing_done_salvaged', droppedLines: 0, totalLines: 3,
    }]);

    // A cut that lands mid-token drops only the incomplete tail record; every
    // record closed before the cut survives.
    const truncated = parseInnerLoreOutput(
        'INNERLORE CURATOR 1\nLOCATION Ben Tavern\nimportance = 70\nEND\nMIND Freesia\nactive = TRUE\ncurrent_mind.interpretation The inspect',
        { format: 'dsl', task: 'curator', salvageTruncated: true },
    );
    assert.equal(truncated.entities.length, 1);
    assert.equal(truncated.minds.length, 0);
    assert.deepEqual(outputParseDiagnostics(truncated), [{
        code: 'truncated_tail_dropped', droppedLines: 3, totalLines: 6,
    }]);

    // Nothing salvageable: the original error propagates so repair runs.
    assert.throws(
        () => parseInnerLoreOutput(
            'INNERLORE CURATOR 1\nLOCATION Ben Tavern\nimportance broken',
            { format: 'dsl', task: 'curator', salvageTruncated: true },
        ),
        /expected a field assignment or END/u,
    );

    // Strict parsing without the salvage flag keeps rejecting missing DONE.
    assert.throws(
        () => parseInnerLoreOutput(
            'INNERLORE CURATOR 1\nLOCATION Ben Tavern\nEND',
            { format: 'dsl', task: 'curator' },
        ),
        /DONE marker/u,
    );
});

test('a DSL-mode request answered in JSON is accepted with a diagnostic', () => {
    const parsed = parseInnerLoreOutput('{"entities":[],"minds":[]}', { format: 'dsl', task: 'curator' });
    assert.deepEqual(parsed, { entities: [], minds: [] });
    assert.deepEqual(outputParseDiagnostics(parsed), [{ code: 'cross_format_json_accepted' }]);
});

test('appendOutputDiagnostics extends parse diagnostics after validation', () => {
    const parsed = parseInnerLoreOutput(
        'INNERLORE CURATOR 1\nLOCATION Ben Tavern\nimportance = 70\nimportance = 71\nEND\nDONE',
        { format: 'dsl', task: 'curator' },
    );
    appendOutputDiagnostics(parsed, [{ code: 'validator_coercion' }]);
    assert.deepEqual(outputParseDiagnostics(parsed).map(item => item.code), [
        'duplicate_scalar_overwritten', 'validator_coercion',
    ]);
});

test('a versioned header mismatch reports the unsupported version', () => {
    assert.throws(
        () => parseInnerLoreDsl('INNERLORE CURATOR 2\nDONE', 'curator'),
        /unsupported InnerLore DSL version 2/u,
    );
});

test('the evaluation key contract repeats editor keys verbatim', () => {    const messages = [{ role: 'system', content: 'Reference' }];
    appendDslEvaluationKeyContract(messages, 'dsl', ['Bell Test!', 'UPPER_key', 'lower.key:plain']);
    assert.match(messages[0].content, /EVALUATION Bell Test!/u);
    assert.match(messages[0].content, /EVALUATION UPPER_key/u);
    assert.match(messages[0].content, /EVALUATION lower\.key:plain/u);
    // Count, first-placement, and per-record requirements target the observed
    // failure modes: omitted acknowledgements and evaluations without reason.
    assert.match(messages[0].content, /exactly 3 EVALUATION records/u);
    assert.match(messages[0].content, /as the FIRST records in the document/u);
    assert.match(messages[0].content, /before the TIME record/u);
    assert.match(messages[0].content, /must contain evaluated = TRUE and a reason =/u);

    const singular = [{ role: 'system', content: 'Reference' }];
    appendDslEvaluationKeyContract(singular, 'dsl', ['one_key']);
    assert.match(singular[0].content, /exactly 1 EVALUATION record —/u);
});

test('progression accepts EVALUATION records before the TIME record', () => {
    const parsed = parseInnerLoreDsl(`INNERLORE PROGRESSION 1
EVALUATION alarm
evaluated = TRUE
reason = No configured condition matched.
END
TIME
elapsed.minimum_seconds = 0
elapsed.estimated_seconds = 0
elapsed.maximum_seconds = 0
confidence = 1
END
DONE`, 'progression');
    assert.equal(parsed.event_evaluations[0].key, 'alarm');
    assert.equal(parsed.event_evaluations[0].evaluated, true);
    assert.deepEqual(outputParseDiagnostics(parsed), []);
});

test('truncation-shaped errors escalate the repair token budget', () => {
    const steady = { maximumResponseTokens: 2_000 };
    const jsonCut = new Error('The model response ended before its JSON object was complete.');
    assert.equal(escalateRepairSettings(steady, jsonCut, '').maximumResponseTokens, 3_000);

    const dslCut = new Error('InnerLore DSL line 9: expected a field assignment or END.');
    dslCut.name = 'InnerLoreDslError';
    dslCut.lineNumber = 9;
    assert.equal(escalateRepairSettings(steady, dslCut, 'a\nb\nc\nd\ne\nf\ng\nh\ni').maximumResponseTokens, 3_000);

    const early = new Error('InnerLore DSL line 1: expected a field assignment or END.');
    early.name = 'InnerLoreDslError';
    early.lineNumber = 1;
    assert.equal(escalateRepairSettings(steady, early, 'a\nb\nc').maximumResponseTokens, 2_000);
});

test('the document record cap still rejects oversized output', () => {
    const lines = ['INNERLORE CURATOR 1'];
    for (let index = 0; index <= 1_000; index++) lines.push(`LOCATION Cap ${index}`, 'END');
    assert.throws(() => parseInnerLoreDsl(lines.join('\n'), 'curator'), /exceeds 1000 records/u);
});

test('the curator field reference carries entity coverage and per-field semantics', () => {
    const [reference] = prepareOutputMessages([
        { role: 'system', content: 'Rules.\nOUTPUT SCHEMA\n{"entities":[]}' },
    ], { format: 'dsl', task: 'curator' });
    const contract = reference.content;
    // The JSON schema documents when each field applies; the DSL reference
    // must carry the same semantics plus an explicit completeness rule, or
    // terser DSL patches under-report entities.
    assert.match(contract, /every individually significant entity/u);
    assert.match(contract, /do not stop after the most prominent one or two/u);
    assert.match(contract, /summary \(complete short identity if new or meaningfully changed\)/u);
    assert.match(contract, /importance 0-100/u);
    assert.match(contract, /unresolved \(new open question, promise, threat, task, mystery, or uncertain detail\)/u);
});
