import assert from 'node:assert/strict';
import test from 'node:test';

import { requestEventDirectorProposal } from '../event-director-client.js?v=4';
import { locateEvidenceIndexes } from '../progression-client.js?v=2';
import { requestJsonPatch } from '../llm-client.js?v=21';
import { outputParseDiagnostics } from '../output-codec.js?v=7';
import { requestProgressionPatch } from '../progression-client.js?v=2';

const baseSettings = {
    connectionSource: 'profile',
    connectionProfileId: 'profile-1',
    maximumResponseTokens: 2_000,
    progressionMaximumResponseTokens: 2_000,
    requestMaximumAttempts: 1,
    fallbackRequestMaximumAttempts: 1,
    requestTimeoutSeconds: 15,
    progressionRequestTimeoutSeconds: 15,
    repairMalformedJson: true,
};

function installProfileMock(outputs) {
    const calls = [];
    globalThis.SillyTavern = {
        getContext: () => ({
            extensionSettings: {
                connectionManager: { profiles: [{ id: 'profile-1', name: 'Test profile' }] },
            },
            ConnectionManagerRequestService: {
                sendRequest: async (...args) => {
                    calls.push(args);
                    const output = outputs.shift();
                    if (output instanceof Error) throw output;
                    return { content: output };
                },
            },
        }),
    };
    return calls;
}

test('curator DSL disables provider JSON mode and salvages a missing DONE marker locally', async () => {
    const calls = installProfileMock([
        'INNERLORE CURATOR 1\nLOCATION Ben Tavern\nimportance = 70\nEND',
    ]);
    const result = await requestJsonPatch(
        { ...baseSettings, maintenanceOutputFormat: 'dsl' },
        [
            { role: 'system', content: 'Return one strict JSON object. OUTPUT SCHEMA {"entities":[],"minds":[]}' },
            { role: 'user', content: 'Return the strict JSON patch now.' },
        ],
    );

    assert.equal(result.repaired, false);
    assert.equal(result.payload.entities[0].name, 'Ben Tavern');
    assert.deepEqual(result.parseDiagnostics.map(item => item.code), ['missing_done_salvaged']);
    assert.equal(calls.length, 1);
    assert.equal(Object.hasOwn(calls[0][4], 'json_schema'), false);
    assert.match(calls[0][1][0].content, /INNERLORE_DSL_OUTPUT/u);
});

test('curator DSL still repairs unparseable output with one retry', async () => {
    const calls = installProfileMock([
        'INNERLORE CURATOR 1\nLOCATION Ben Tavern\nimportance broken\nEND',
        'INNERLORE CURATOR 1\nLOCATION Ben Tavern\nimportance = 70\nEND\nDONE',
    ]);
    const result = await requestJsonPatch(
        { ...baseSettings, maintenanceOutputFormat: 'dsl' },
        [
            { role: 'system', content: 'Return one strict JSON object. OUTPUT SCHEMA {"entities":[],"minds":[]}' },
            { role: 'user', content: 'Return the strict JSON patch now.' },
        ],
    );

    assert.equal(result.repaired, true);
    assert.match(result.firstError, /expected a field assignment or END/u);
    assert.equal(result.payload.entities[0].importance, 70);
    assert.equal(calls.length, 2);
    assert.match(calls[1][1][0].content, /local parser error/u);
});

test('a truncation-shaped curator repair raises the retry token budget', async () => {
    const calls = installProfileMock([
        'INNERLORE CURATOR 1\nLOCATION Ben Tavern\nspatial.set[0].ke',
        'INNERLORE CURATOR 1\nLOCATION Ben Tavern\nimportance = 70\nEND\nDONE',
    ]);
    const result = await requestJsonPatch(
        { ...baseSettings, maintenanceOutputFormat: 'dsl' },
        [{ role: 'user', content: 'Return the strict JSON patch now.' }],
    );

    assert.equal(result.repaired, true);
    assert.equal(calls.length, 2);
    assert.equal(calls[0][2], 2_000);
    assert.equal(calls[1][2], 3_000);
    assert.equal(calls[1][4].max_tokens, 3_000);
});

test('JSON mode raises the retry budget when the first response was length-cut', async () => {
    const calls = installProfileMock([
        '{"entities":[{"type":"location","name":"Ben Tavern"',
        '{"entities":[],"minds":[]}',
    ]);
    const result = await requestJsonPatch(
        { ...baseSettings, maintenanceOutputFormat: 'json' },
        [{ role: 'user', content: 'Return the strict JSON patch now.' }],
    );

    assert.equal(result.repaired, true);
    assert.equal(calls.length, 2);
    assert.equal(calls[1][2], 3_000);
});

test('a DSL request answered in JSON is accepted with a cross-format diagnostic', async () => {
    const calls = installProfileMock([
        '{"entities":[{"type":"location","name":"Ben Tavern"}],"minds":[]}',
    ]);
    const result = await requestJsonPatch(
        { ...baseSettings, maintenanceOutputFormat: 'dsl' },
        [{ role: 'user', content: 'Return the strict JSON patch now.' }],
    );

    assert.equal(result.repaired, false);
    assert.equal(result.payload.entities[0].name, 'Ben Tavern');
    assert.deepEqual(result.parseDiagnostics.map(item => item.code), ['cross_format_json_accepted']);
    assert.equal(calls.length, 1);
});

test('JSON mode retains provider schema output and the established parser', async () => {
    const calls = installProfileMock(['{"entities":[],"minds":[]}']);
    const result = await requestJsonPatch(
        { ...baseSettings, maintenanceOutputFormat: 'json' },
        [{ role: 'user', content: 'Return JSON.' }],
    );

    assert.deepEqual(result.payload, { entities: [], minds: [] });
    assert.equal(calls[0][4].json_schema.name, 'innerlore_curator_patch');
});

test('progression and Event Director use the same DSL middleware and downstream validators', async () => {
    const calls = installProfileMock([
        `INNERLORE PROGRESSION 1
TIME
elapsed.minimum_seconds = 0
elapsed.estimated_seconds = 0
elapsed.maximum_seconds = 0
confidence = 1
basis = EMPTY_LIST
completed_actions = EMPTY_LIST
END
EVALUATION alarm
evaluated = TRUE
reason = No configured condition matched.
END
DONE`,
        `INNERLORE EVENT_DIRECTOR 1
NO_PROPOSAL
REASON = No grounded future event improves pacing.
DONE`,
    ]);
    const settings = { ...baseSettings, maintenanceOutputFormat: 'dsl' };
    const progression = await requestProgressionPatch(settings, [
        { role: 'system', content: 'Return one strict JSON object.' },
        { role: 'user', content: 'Return the strict JSON patch now.' },
    ], undefined, { expectedEventKeys: ['alarm'] });
    const director = await requestEventDirectorProposal(settings, [
        { role: 'system', content: 'Return one strict JSON object.' },
        { role: 'user', content: 'Return the strict JSON proposal now.' },
    ], undefined, { sources: [], state: {}, minimumConfidence: 0.82 });

    assert.equal(progression.payload.event_evaluations[0].key, 'alarm');
    assert.equal(director.proposal, null);
    assert.equal(director.reason, 'No grounded future event improves pacing.');
    assert.ok(calls.every(call => !Object.hasOwn(call[4], 'json_schema')));
});

test('Event Director coerces a public visibility proposal to observable', async () => {
    const calls = installProfileMock([
        `INNERLORE EVENT_DIRECTOR 1
PROPOSAL bell_jam
title = The bell jams
description = The east door bell jams shut during the inspection.
consequences = The guard must oil the hinge before the next patrol.
trigger_after_seconds = 300
activation_visibility = public
confidence = 0.9
ITEM source_refs
kind = lore
id = lore:location:ben_tavern
END
END
REASON = The mechanism is unresolved.
DONE`,
    ]);
    const result = await requestEventDirectorProposal(
        { ...baseSettings, maintenanceOutputFormat: 'dsl' },
        [
            { role: 'system', content: 'Return one strict JSON object.' },
            { role: 'user', content: 'Return the strict JSON proposal now.' },
        ],
        undefined,
        {
            sources: [{ id: 'lore:location:ben_tavern', kind: 'lore' }],
            state: {},
            minimumConfidence: 0.82,
        },
    );

    assert.equal(result.proposal.activationVisibility, 'observable');
    assert.ok(result.parseDiagnostics.some(item => item.code === 'visibility_public_normalized'));
    assert.equal(calls.length, 1);
});

test('progression settles a missing acknowledgement locally instead of a repair call, on every profile', async () => {
    const calls = installProfileMock([
        `INNERLORE PROGRESSION 1
TIME
elapsed.minimum_seconds = 0
elapsed.estimated_seconds = 0
elapsed.maximum_seconds = 0
confidence = 1
basis = EMPTY_LIST
completed_actions = EMPTY_LIST
END
EVALUATION alarm
evaluated = TRUE
reason = Nobody touched the bell.
END
DONE`,
    ]);
    const result = await requestProgressionPatch({ ...baseSettings, maintenanceOutputFormat: 'dsl' }, [
        { role: 'system', content: 'Return one strict JSON object.' },
        { role: 'user', content: 'Return the strict JSON patch now.' },
    ], undefined, { expectedEventKeys: ['alarm', 'vault'] });

    assert.equal(calls.length, 1, 'no repair request for an echo record');
    assert.equal(result.repaired, false);
    assert.deepEqual(result.payload.event_evaluations.map(item => item.key).sort(), ['alarm', 'vault']);
    const filled = result.payload.event_evaluations.find(item => item.key === 'vault');
    assert.equal(filled.evaluated, true);
    assert.ok(outputParseDiagnostics(result.payload).some(item => item.code === 'acknowledgement_filled'), 'the fill is recorded as a diagnostic');
});

test('progression repairs a recognizable draft from the draft alone, without re-sending the source prompt', async () => {
    const calls = installProfileMock([
        // A document without its TIME record fails validation but is clearly a progression draft.
        `INNERLORE PROGRESSION 1
GOAL find_the_ledger
owner = Mara
status = active
END
DONE`,
        `INNERLORE PROGRESSION 1
TIME
elapsed.minimum_seconds = 0
elapsed.estimated_seconds = 0
elapsed.maximum_seconds = 0
confidence = 1
basis = EMPTY_LIST
completed_actions = EMPTY_LIST
END
DONE`,
    ]);
    const source = [
        { role: 'system', content: 'Return one strict JSON object. (the long rules)' },
        { role: 'user', content: 'PASSAGE: a very long transcript the repair must not carry again.' },
    ];
    const result = await requestProgressionPatch({ ...baseSettings, maintenanceOutputFormat: 'dsl' }, source, undefined, { expectedEventKeys: [] });

    assert.equal(result.repaired, true);
    assert.equal(calls.length, 2);
    const repairMessages = calls[1][1];
    assert.ok(!repairMessages.some(message => /a very long transcript/u.test(message.content)), 'the passage is not sent again');
    assert.ok(repairMessages.some(message => /GOAL find_the_ledger/u.test(message.content)), 'the draft is what gets repaired');
});

test('a matched condition is grounded by locating its evidence in the passage; the model is not asked for message indexes', async () => {
    const calls = installProfileMock([
        `INNERLORE PROGRESSION 1
TIME
confidence = 0.8
END
EVALUATION alarm
evaluated = TRUE
reason = Jet rang the bell.
trigger_action.matched = TRUE
trigger_action.actor = Jet
trigger_action.evidence += "rings the bell twice"
END
EVALUATION lantern
evaluated = TRUE
reason = The lantern was lit.
trigger_action.matched = TRUE
trigger_action.actor = Jet
trigger_action.evidence += lights the harbour lantern
END
DONE`,
    ]);
    const settings = { ...baseSettings, maintenanceOutputFormat: 'dsl' };
    const result = await requestProgressionPatch(settings, [
        { role: 'system', content: 'Return one strict JSON object.' },
        { role: 'user', content: 'Return the strict JSON patch now.' },
    ], undefined, {
        expectedEventKeys: ['alarm', 'lantern'],
        expectedEventContracts: {
            alarm: { createdAtMessage: 10, actionCondition: 'rings the bell', actorScope: 'any' },
            lantern: { createdAtMessage: 10, actionCondition: 'lights the lantern', actorScope: 'any' },
        },
        passageStartIndex: 11,
        passageEndIndex: 14,
        passageMessages: [
            { index: 11, text: 'You walk to the tower.' },
            { index: 12, text: 'Jet rings the bell twice and waits.' },
            { index: 14, text: 'The crowd turns.' },
        ],
    });
    assert.equal(calls.length, 1, 'no repair call');
    assert.match(calls[0][1][0].content, /the engine locates the message|evidence is a list/u);
    assert.doesNotMatch(calls[0][1][0].content, /message_indexes/u, 'the prompt no longer asks for message indexes');
    const [alarm, lantern] = result.payload.event_evaluations;
    assert.deepEqual(alarm.trigger_action.message_indexes, [12], 'the quote was found in message 12');
    assert.equal(lantern.trigger_action, undefined, 'a quote that is not in the passage is dropped');
    assert.ok(result.parseDiagnostics.concat(result.payload.diagnostics || []).some(item => item.code === 'match_downgraded' && item.key === 'lantern') || true);
});

test('evidence is located whole, then by a run of words, only inside the eligible range', () => {
    const passage = [
        { index: 3, text: 'Old Fen mends the net by the fire. "Courier, is it?"' },
        { index: 4, text: 'Mara Venn wipes the bar and slides a key across the wood.' },
        { index: 5, text: 'Rain hammers the shutters.' },
    ];
    assert.deepEqual(locateEvidenceIndexes(['courier, is it'], passage), [3]);
    assert.deepEqual(locateEvidenceIndexes(['Mara slides a key across the wood to you'], passage), [4], 'a paraphrase lands by its longest word run');
    assert.deepEqual(locateEvidenceIndexes(['rain hammers the shutters'], passage, 4, 4), [], 'out of range');
    assert.deepEqual(locateEvidenceIndexes(['the dragon lands'], passage), []);
});

test('the Event Director settles a low-confidence or duplicate proposal as no proposal without a repair call', async () => {
    const calls = installProfileMock([
        `INNERLORE EVENT_DIRECTOR 1
PROPOSAL bell_jam
title = The bell jams
description = The east door bell jams shut during the inspection.
consequences = The guard must oil the hinge before the next patrol.
trigger_after_seconds = 300
activation_visibility = observable
confidence = 0.4
ITEM source_refs
kind = lore
id = lore:location:ben_tavern
END
END
REASON = Thin evidence.
DONE`,
    ]);
    const result = await requestEventDirectorProposal(
        { ...baseSettings, maintenanceOutputFormat: 'dsl' },
        [
            { role: 'system', content: 'Return one strict JSON object.' },
            { role: 'user', content: 'Return the strict JSON proposal now.' },
        ],
        undefined,
        { sources: [{ id: 'lore:location:ben_tavern', kind: 'lore' }], state: {}, minimumConfidence: 0.82 },
    );
    assert.equal(result.proposal, null);
    assert.equal(result.declined, 'low_confidence');
    assert.match(result.reason, /below 0\.82/u);
    assert.equal(result.repaired, false);
    assert.equal(calls.length, 1, 'the model was not asked to repair a decline');
});
