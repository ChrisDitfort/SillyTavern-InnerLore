import assert from 'node:assert/strict';
import test from 'node:test';

import { requestEventDirectorProposal } from '../event-director-client.js';
import { requestJsonPatch } from '../llm-client.js';
import { requestProgressionPatch } from '../progression-client.js';

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
