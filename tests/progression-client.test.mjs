import assert from 'node:assert/strict';
import test from 'node:test';

import { validateProgressionPayload } from '../progression-client.js';
import { buildProgressionRepairMessages } from '../progression-prompts.js';

function payload(eventEvaluations = []) {
    return {
        time: {
            elapsed: { minimum_seconds: 0, estimated_seconds: 0, maximum_seconds: 0 },
            confidence: 1,
            basis: [],
            completed_actions: [],
        },
        goals: [],
        processes: [],
        events: [],
        event_evaluations: eventEvaluations,
    };
}

test('progression validation requires one explicit acknowledgement per supplied event', () => {
    const valid = payload([
        { key: 'alarm', evaluated: true, reason: 'No configured condition matched this passage.' },
        {
            key: 'vault',
            evaluated: true,
            reason: 'Jet completed the configured action.',
            trigger_action: {
                matched: true,
                actor: 'Jet',
                evidence: ['Jet opens the sealed vault.'],
                message_indexes: [14],
            },
        },
    ]);
    assert.equal(validateProgressionPayload(valid, { expectedEventKeys: ['alarm', 'vault'] }), valid);

    assert.throws(
        () => validateProgressionPayload(payload([
            { key: 'alarm', evaluated: true, reason: 'Nothing matched.' },
        ]), { expectedEventKeys: ['alarm', 'vault'] }),
        /omitted event evaluation acknowledgement: vault/u,
    );
    assert.throws(
        () => validateProgressionPayload(payload([
            { key: 'alarm', evaluated: true, reason: 'Nothing matched.' },
            { key: 'alarm', evaluated: true, reason: 'Still nothing matched.' },
        ]), { expectedEventKeys: ['alarm'] }),
        /duplicate event evaluation key "alarm"/u,
    );
    assert.throws(
        () => validateProgressionPayload(payload([
            { key: 'invented', evaluated: true, reason: 'Invented.' },
        ]), { expectedEventKeys: ['alarm'] }),
        /unknown event evaluation key "invented"/u,
    );
});

test('progression validation rejects ungrounded match objects', () => {
    assert.throws(
        () => validateProgressionPayload(payload([{
            key: 'vault',
            evaluated: true,
            reason: 'Claimed a match.',
            trigger_action: {
                matched: true,
                actor: 'Jet',
                evidence: [],
                message_indexes: [14],
            },
        }]), { expectedEventKeys: ['vault'] }),
        /without evidence/u,
    );
    assert.throws(
        () => validateProgressionPayload(payload([{
            key: 'vault',
            evaluated: true,
            reason: 'Claimed a match.',
            trigger_action: {
                matched: true,
                actor: '',
                evidence: ['The vault opens.'],
                message_indexes: [14],
            },
        }]), { expectedEventKeys: ['vault'] }),
        /without an actor/u,
    );
    assert.throws(
        () => validateProgressionPayload(payload([{
            key: 'alarm',
            evaluated: false,
            reason: 'Skipped it.',
        }]), { expectedEventKeys: ['alarm'] }),
        /evaluated:true/u,
    );
});

test('progression validation enforces event age, passage range, configured conditions, and actor scope', () => {
    const options = {
        expectedEventKeys: ['vault'],
        expectedEventContracts: {
            vault: {
                createdAtMessage: 10,
                actionCondition: 'The player opens the vault.',
                actorScope: 'player',
                actorName: '',
                cancellationCondition: '',
                revealCondition: '',
                resolutionCondition: '',
            },
        },
        passageStartIndex: 8,
        passageEndIndex: 14,
        playerName: 'Jet',
    };
    const evaluation = (actor, messageIndex) => payload([{
        key: 'vault',
        evaluated: true,
        reason: 'A claimed action match.',
        trigger_action: {
            matched: true,
            actor,
            evidence: [`${actor} opens the vault.`],
            message_indexes: [messageIndex],
        },
    }]);

    assert.doesNotThrow(() => validateProgressionPayload(evaluation('Jet', 12), options));
    assert.throws(
        () => validateProgressionPayload(evaluation('Jet', 10), options),
        /outside the eligible message range 11–14/u,
    );
    assert.throws(
        () => validateProgressionPayload(evaluation('Aldric', 12), options),
        /ineligible actor/u,
    );
    assert.throws(
        () => validateProgressionPayload(payload([{
            key: 'vault',
            evaluated: true,
            reason: 'A claimed cancellation.',
            cancellation: {
                matched: true,
                evidence: ['A treaty is signed.'],
                message_indexes: [12],
            },
        }]), options),
        /without that configured condition/u,
    );
});

test('production validation drops definition-impossible match labels without losing valid delivery evidence', () => {
    const candidate = payload([{
        key: 'courier',
        evaluated: true,
        reason: 'The courier arrival was visibly delivered.',
        trigger_action: {
            matched: true,
            actor: 'Courier',
            evidence: ['The courier enters.'],
            message_indexes: [12],
        },
        public_reveal: {
            matched: true,
            evidence: ['The courier enters and presents the letter.'],
            message_indexes: [12],
        },
    }]);
    const result = validateProgressionPayload(candidate, {
        expectedEventKeys: ['courier'],
        expectedEventContracts: {
            courier: {
                createdAtMessage: 5,
                actionCondition: '',
                cancellationCondition: '',
                revealCondition: '',
                resolutionCondition: '',
            },
        },
        passageStartIndex: 10,
        passageEndIndex: 12,
        discardImpossibleMatches: true,
    });

    assert.equal(result.event_evaluations[0].trigger_action, undefined);
    assert.equal(result.event_evaluations[0].public_reveal.matched, true);
});

test('production validation treats explicit negative match objects as omission', () => {
    const candidate = payload([{
        key: 'alarm',
        evaluated: true,
        reason: 'The lever was not touched.',
        trigger_action: { matched: false, evidence: [], message_indexes: [] },
        public_reveal: { matched: false },
    }]);
    const result = validateProgressionPayload(candidate, {
        expectedEventKeys: ['alarm'],
        expectedEventContracts: {
            alarm: { actionCondition: 'Rowan pulls the lever.' },
        },
        discardImpossibleMatches: true,
    });

    assert.equal(result.event_evaluations[0].trigger_action, undefined);
    assert.equal(result.event_evaluations[0].public_reveal, undefined);
});

test('progression validation safely normalizes semantically empty operation collections', () => {
    const candidate = payload();
    candidate.goals = {};
    candidate.processes = null;
    delete candidate.events;
    const result = validateProgressionPayload(candidate);
    assert.deepEqual(result.goals, []);
    assert.deepEqual(result.processes, []);
    assert.deepEqual(result.events, []);

    const unsafe = payload();
    unsafe.goals = { title: 'Unstructured mutation' };
    assert.throws(() => validateProgressionPayload(unsafe), /field "goals" must be an array/u);
});

test('repair prompts retain the original passage and definitions', () => {
    const sourceMessages = [
        { role: 'system', content: 'World Progression Engine rules.' },
        {
            role: 'user',
            content: '<TRIGGERABLE_EVENT_DEFINITIONS>[{"key":"alarm"}]</TRIGGERABLE_EVENT_DEFINITIONS>\n<COMPLETED_PASSAGE>The bell remains silent.</COMPLETED_PASSAGE>',
        },
    ];
    const repaired = buildProgressionRepairMessages('{"time":{}}', {
        expectedEventKeys: ['alarm'],
        sourceMessages,
    });

    assert.deepEqual(repaired.slice(0, 2), sourceMessages);
    assert.equal(repaired[2].role, 'assistant');
    assert.match(repaired[3].content, /Re-evaluate against the original completed passage and definitions/u);
    assert.match(repaired[3].content, /Expected keys: \["alarm"\]/u);
    assert.match(repaired[3].content, /Allowed match fields by event/u);
});
