import assert from 'node:assert/strict';
import test from 'node:test';

import { createProgressionState } from '../progression.js';
import { upsertTriggerEventDefinition } from '../trigger-events.js';
import { buildEventDirectorMessages, buildEventDirectorRepairMessages } from '../event-director-prompts.js';
import {
    addEventProposal,
    decideAutomaticEventGeneration,
    eventDefinitionFromProposal,
    expireEventProposals,
    markEventProposalArmed,
    stripAutomaticEventStateForRebuild,
    validateEventDirectorPayload,
} from '../event-director.js';

const source = {
    id: 'lore:location:mill', kind: 'lore', name: 'Old Mill', revision: 3,
    messageIndex: 12, graphNodeId: 'innerlore:entity:mill', generated: false,
};

const payload = overrides => ({
    proposal: {
        key: 'mill_warning_bell',
        title: 'The mill warning bell rings',
        description: 'A jam in the established mill mechanism rings its warning bell.',
        trigger_mode: 'any',
        trigger_after_seconds: 300,
        trigger_time_certainty: 'estimated',
        cancellation_condition: 'The mill mechanism is repaired before the jam develops.',
        activation_visibility: 'hidden',
        reveal_after_seconds: 60,
        resolution_condition: 'The jam is repaired or the mill is shut down.',
        consequences: 'The miller investigates and nearby workers can notice the warning without forcing a player response.',
        subjects: ['Old Mill'],
        priority: 55,
        confidence: 0.91,
        source_refs: [{ kind: source.kind, id: source.id }],
        rationale: 'Uses the unresolved mill mechanism and adds a bounded choice.',
        ...overrides,
    },
    reason: 'A grounded low-stakes pressure beat is available.',
});

const validation = state => ({
    state,
    sources: [source],
    playerName: 'Rowan',
    minimumConfidence: 0.82,
    includePrivateMinds: false,
});

test('Event Director is inert by default and review proposals count toward the configured pool', () => {
    const state = createProgressionState();
    assert.equal(decideAutomaticEventGeneration(state, {
        automaticEventDirectorEnabled: false, worldProgressionEnabled: true,
    }, 12).reason, 'disabled');
    const candidate = validateEventDirectorPayload(payload(), validation(state)).proposal;
    const proposed = addEventProposal(state, candidate, {
        branchId: 'main', currentMessageIndex: 12, sourceStoreRevision: 4, expirationTurns: 40,
    }).state;
    const decision = decideAutomaticEventGeneration(proposed, {
        automaticEventDirectorEnabled: true,
        automaticEventDirectorActivity: 'quiet',
        worldProgressionEnabled: true,
    }, 30);
    assert.equal(decision.due, false);
    assert.equal(decision.pendingProposals, 1);
    assert.equal(decision.reason, 'event_pool_full');
});

test('a validated proposal promotes through the existing trigger event pipeline with bounded provenance', () => {
    let state = createProgressionState();
    const candidate = validateEventDirectorPayload(payload(), validation(state)).proposal;
    const added = addEventProposal(state, candidate, {
        branchId: 'main', headFingerprint: 'head-12', currentMessageIndex: 12,
        sourceStoreRevision: 4, expirationTurns: 40, profileId: 'glm-5.3-full',
    });
    state = added.state;
    const definitionInput = eventDefinitionFromProposal(added.proposal);
    const armed = upsertTriggerEventDefinition(state, definitionInput, {
        clock: state.clock, messageIndex: 12, playerName: 'Rowan',
    });
    state = markEventProposalArmed(armed.state, added.proposal.id, armed.definition.id).state;
    assert.equal(armed.definition.origin, 'automatic_director');
    assert.equal(armed.definition.actionTiming, 'after_outcome');
    assert.equal(armed.definition.priority, 55);
    assert.equal(armed.definition.provenance.sourceRefs[0].id, source.id);
    assert.equal(state.eventProposals[added.proposal.id].status, 'armed');
    assert.equal(decideAutomaticEventGeneration(state, {
        automaticEventDirectorEnabled: true, automaticEventDirectorActivity: 'quiet', worldProgressionEnabled: true,
    }, 30).reason, 'event_pool_full');
});

test('local validation rejects weak grounding, unknown citations, missing reveals, and player-agency prescriptions', () => {
    const state = createProgressionState();
    assert.throws(() => validateEventDirectorPayload(payload({ confidence: 0.4 }), validation(state)), /below/u);
    assert.throws(() => validateEventDirectorPayload(payload({
        source_refs: [{ kind: 'lore', id: 'lore:missing' }],
    }), validation(state)), /unknown source/u);
    assert.throws(() => validateEventDirectorPayload(payload({
        reveal_after_seconds: undefined,
        reveal_condition: undefined,
    }), validation(state)), /requires a reveal/u);
    assert.throws(() => validateEventDirectorPayload(payload({
        consequences: 'Rowan must agree to enter the mill and feels afraid.',
    }), validation(state)), /player action/u);
});

test('generated proposals expire and are removed with generated definitions during rebuild', () => {
    let state = createProgressionState();
    const candidate = validateEventDirectorPayload(payload(), validation(state)).proposal;
    const added = addEventProposal(state, candidate, {
        branchId: 'main', currentMessageIndex: 12, sourceStoreRevision: 4, expirationTurns: 4,
    });
    state = added.state;
    const armed = upsertTriggerEventDefinition(state, eventDefinitionFromProposal(added.proposal), {
        clock: state.clock, messageIndex: 12, playerName: 'Rowan',
    });
    state = markEventProposalArmed(armed.state, added.proposal.id, armed.definition.id).state;
    const expiration = expireEventProposals(state, { branchId: 'main', currentMessageIndex: 17 });
    assert.equal(expiration.expired[0].reason, 'proposal_expired');
    const stripped = stripAutomaticEventStateForRebuild(expiration.state);
    assert.equal(stripped.definitionsRemoved, 1);
    assert.deepEqual(stripped.state.eventProposals, {});
});

test('director prompts expose the configured confidence contract and repairs explain failures', () => {
    const messages = buildEventDirectorMessages({
        context: { sources: [source] }, playerName: 'Rowan', minimumConfidence: 0.87,
    });
    assert.match(messages[0].content, /honest confidence of at least 0\.87/u);
    assert.match(messages[0].content, /rather than inflating/u);
    const repaired = buildEventDirectorRepairMessages('{"proposal":{}}', {
        sourceMessages: messages,
        validationError: 'confidence 0.70 is below 0.87',
    });
    assert.match(repaired.at(-1).content, /confidence 0\.70 is below 0\.87/u);
    assert.match(repaired.at(-1).content, /proposal:null/u);
});
