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

test('curator DSL disables provider JSON mode, parses locally, and repairs a missing DONE marker', async () => {
    const calls = installProfileMock([
        'INNERLORE CURATOR 1\nLOCATION Ben Tavern\nimportance = 70\nEND',
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
    assert.match(result.firstError, /DONE marker/u);
    assert.equal(result.payload.entities[0].name, 'Ben Tavern');
    assert.equal(calls.length, 2);
    assert.equal(Object.hasOwn(calls[0][4], 'json_schema'), false);
    assert.match(calls[0][1][0].content, /INNERLORE_DSL_OUTPUT/u);
    assert.match(calls[1][1][0].content, /local parser error/u);
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
