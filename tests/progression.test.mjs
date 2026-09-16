import assert from 'node:assert/strict';
import test from 'node:test';

import {
    applyProgressionPatch,
    buildProgressionInjection,
    compileProgressionInjection,
    createProgressionState,
    extractDeterministicElapsedAnchors,
    formatClockRange,
    getProgressionStats,
    normalizeProgressionState,
    runProgressionScheduler,
} from '../progression.js';
import { buildProgressionMessages } from '../progression-prompts.js';

function emptyPatch(time) {
    return { time, goals: [], processes: [], events: [] };
}

test('critical-path timing adds new NPC dialogue while deduplicating overlapping player action narration', () => {
    const result = applyProgressionPatch(createProgressionState(), {
        time: {
            // Deliberately under-reported: the local timeline calculation must win.
            elapsed: { minimum_seconds: 5, estimated_seconds: 15, maximum_seconds: 40 },
            confidence: 0.8,
            basis: ['Jet approaches and greets Aldric; Aldric then gives a multi-sentence answer.'],
            completed_actions: ['approached Aldric', 'greeted Aldric', 'heard Aldric’s answer'],
            timeline: [
                {
                    key: 'approach',
                    description: 'Jet walks across the study to Aldric.',
                    actor: 'Jet',
                    kind: 'movement',
                    parallel_group: 'approach_and_greeting',
                    overlap_confirmed: true,
                    overlap_evidence: 'Jet says hello while still walking across the study.',
                    duration: { minimum_seconds: 5, estimated_seconds: 8, maximum_seconds: 12 },
                },
                {
                    key: 'player_greeting',
                    description: 'Jet says hello during the approach.',
                    actor: 'Jet',
                    kind: 'speech',
                    parallel_group: 'approach_and_greeting',
                    overlap_confirmed: true,
                    overlap_evidence: 'Jet says hello while still walking across the study.',
                    duration: { minimum_seconds: 1, estimated_seconds: 2, maximum_seconds: 3 },
                },
                {
                    key: 'aldric_answer',
                    description: 'Aldric answers with several sentences.',
                    actor: 'Aldric',
                    kind: 'speech',
                    // A model may incorrectly reuse the exchange group. With no
                    // confirmed/evidenced overlap, local calculation keeps this
                    // later answer sequential.
                    parallel_group: 'approach_and_greeting',
                    duration: { minimum_seconds: 18, estimated_seconds: 25, maximum_seconds: 35 },
                },
                {
                    key: 'reaction_after_answer',
                    description: 'Aldric pauses and closes the ledger after speaking.',
                    actor: 'Aldric',
                    kind: 'reaction',
                    parallel_group: 'reaction_after_answer',
                    duration: { minimum_seconds: 2, estimated_seconds: 4, maximum_seconds: 8 },
                },
            ],
        },
        goals: [],
        processes: [],
        events: [],
    }, { messageIndex: 1 });

    assert.deepEqual(result.timeResult.reportedDuration, {
        minimumSeconds: 5,
        estimatedSeconds: 15,
        maximumSeconds: 40,
    });
    assert.deepEqual(result.timeResult.duration, {
        minimumSeconds: 25,
        estimatedSeconds: 37,
        maximumSeconds: 55,
    });
    assert.equal(result.state.clock.estimatedSeconds, 37);
    assert.equal(result.state.clock.lastTimeline.length, 4);
});

test('declarative exact elapsed anchors are local, deduplicate narration restatements, and exclude future deadlines', () => {
    const transcript = `[message 4; PLAYER — Rowan]\nThree full days pass while I wait at the market. The glazier is due in five days.\n\n[message 5; STORY — Narrator]\nThree days pass under heavy rain.`;
    const anchors = extractDeterministicElapsedAnchors(transcript);
    assert.equal(anchors.totalSeconds, 259_200);
    assert.equal(anchors.anchors.length, 1);
    assert.equal(anchors.anchors[0].evidence.length, 2);

    const result = applyProgressionPatch(createProgressionState(), emptyPatch({
        elapsed: { minimum_seconds: 60, estimated_seconds: 120, maximum_seconds: 180 },
        confidence: 0.5,
        basis: [],
        completed_actions: [],
        timeline: [],
    }), { messageIndex: 5, passageText: transcript });
    assert.deepEqual(result.timeResult.duration, {
        minimumSeconds: 259_200,
        estimatedSeconds: 259_200,
        maximumSeconds: 259_200,
    });
    assert.match(result.state.clock.lastExactAnchor, /three full days pass/iu);
});

test('progression injection removes semantic duplicates across goal, process, and beat categories', () => {
    const payload = {
        time: { elapsed: 0, confidence: 1, basis: [], completed_actions: [], timeline: [] },
        goals: [{ key: 'glazier_arrival_goal', owner: 'Lantern Room', title: 'Glazier arrives', description: 'The glazier is due.', status: 'active', progress: 0, visibility: 'narrator' }],
        processes: [{ key: 'glazier_arrival_process', subject_type: 'location', subject_name: 'Lantern Room', kind: 'other', title: 'Glazier arrives', description: 'The glazier is due.', status: 'active', progress: 20, visibility: 'narrator' }],
        events: [{ key: 'glazier_arrival_event', title: 'Glazier arrives', kind: 'arrival', description: 'The glazier is due.', status: 'due', priority: 90, visibility: 'narrator', subjects: ['Lantern Room'], evidence: ['Due now.'] }],
    };
    const state = applyProgressionPatch(createProgressionState(), payload, { messageIndex: 2 }).state;
    const injection = compileProgressionInjection(state, 'The glazier returns to the Lantern Room.', {
        latestText: 'What changed before the glazier arrives?',
        progressionMaximumInjectedEntries: 8,
        progressionInjectionBudget: 5_000,
    });
    assert.equal(injection.selected.filter(item => /glazier arrives/iu.test(item.title)).length, 1);
    assert.equal((injection.text.match(/Glazier arrives/giu) || []).length, 1);
});

test('unchanged progression operations are skipped without revision or log churn', () => {
    const operation = { key: 'repair_roof', owner: 'Mara', title: 'Repair roof', description: 'Repair the archive roof.', status: 'active', progress: 10, visibility: 'private', evidence: ['Work began.'] };
    let applied = applyProgressionPatch(createProgressionState(), {
        time: { elapsed: 0, confidence: 1, basis: [], completed_actions: [], timeline: [] },
        goals: [operation], processes: [], events: [],
    }, { messageIndex: 1 });
    const firstRevision = applied.state.goals['goal:repair_roof'].revision;
    const firstLogLength = applied.state.log.length;
    applied = applyProgressionPatch(applied.state, {
        time: { elapsed: 0, confidence: 1, basis: [], completed_actions: [], timeline: [] },
        goals: [operation], processes: [], events: [],
    }, { messageIndex: 3 });
    assert.equal(applied.goalResult.updated, 0);
    assert.equal(applied.goalResult.skipped, 1);
    assert.equal(applied.state.goals['goal:repair_roof'].revision, firstRevision);
    assert.equal(applied.state.log.length, firstLogLength);
});

test('elapsed time accumulates uncertainty ranges and schedules possibly-due then definitely-due beats', () => {
    let state = createProgressionState();
    let result = applyProgressionPatch(state, {
        time: {
            elapsed: { minimum_seconds: 3, estimated_seconds: 6, maximum_seconds: 10 },
            confidence: 0.8,
            basis: ['Jet walks a few steps to Aldric and exchanges one greeting.'],
            completed_actions: ['approached Aldric', 'said hello'],
        },
        goals: [{
            key: 'aldric_deliver_ledger',
            owner: 'Aldric',
            title: 'Deliver the sealed ledger',
            status: 'active',
            progress: 10,
            due_in_seconds: { minimum_seconds: 100, estimated_seconds: 110, maximum_seconds: 120 },
            evidence: ['Aldric says the ledger must reach the steward.'],
        }],
        processes: [],
        events: [{
            key: 'courier_returns',
            title: 'The courier returns',
            status: 'scheduled',
            priority: 80,
            due_in_seconds: { minimum_seconds: 50, estimated_seconds: 55, maximum_seconds: 60 },
            evidence: ['The courier promised to return shortly.'],
        }],
    }, { messageIndex: 2, autonomy: 'conservative' });
    state = result.state;

    assert.deepEqual(state.clock.lastCompletedActions, ['approached Aldric', 'said hello']);
    assert.equal(state.clock.minimumSeconds, 3);
    assert.equal(state.clock.estimatedSeconds, 6);
    assert.equal(state.clock.maximumSeconds, 10);
    assert.equal(Object.keys(state.goals).length, 1);
    assert.equal(state.events['event:courier_returns'].status, 'scheduled');

    state = applyProgressionPatch(state, emptyPatch({
        elapsed: { minimum_seconds: 40, estimated_seconds: 45, maximum_seconds: 50 },
        confidence: 0.6,
        basis: ['The room is searched.'],
        completed_actions: ['searched the room'],
    }), { messageIndex: 4 }).state;
    assert.equal(state.events['event:courier_returns'].status, 'possibly_due');

    state = applyProgressionPatch(state, emptyPatch({
        elapsed: { minimum_seconds: 30, estimated_seconds: 38, maximum_seconds: 45 },
        confidence: 0.7,
        basis: ['A further wait occurs.'],
        completed_actions: ['waited'],
    }), { messageIndex: 6 }).state;
    assert.equal(state.events['event:courier_returns'].status, 'due');
    assert.equal(state.goals['goal:aldric_deliver_ledger'].deadlineState, 'possibly_due');
    assert.match(formatClockRange(state.clock), /range/);
});

test('player-required beats cannot be auto-resolved and unsupported final states are rejected', () => {
    let state = createProgressionState();
    state = applyProgressionPatch(state, {
        time: { elapsed: 5, confidence: 0.9, basis: ['A question is asked.'], completed_actions: ['asked a question'] },
        goals: [{
            key: 'player_accepts_oath',
            owner: 'World',
            title: 'The player accepts the oath',
            status: 'completed',
            progress: 100,
            evidence: [],
        }],
        processes: [],
        events: [{
            key: 'player_opens_vault',
            title: 'Jet opens the vault',
            status: 'occurred_offscreen',
            requires_player_action: true,
            priority: 100,
            evidence: ['An NPC hopes Jet will open it.'],
        }],
    }, { messageIndex: 2, autonomy: 'director' }).state;

    assert.equal(state.goals['goal:player_accepts_oath'].status, 'active');
    assert.equal(state.events['event:player_opens_vault'].status, 'due');
    assert.equal(state.events['event:player_opens_vault'].requiresPlayerAction, true);

    const injection = buildProgressionInjection(state, 'Jet stands beside the vault.', {
        progressionMaximumInjectedEntries: 8,
        progressionInjectionBudget: 5_000,
    });
    assert.match(injection, /never auto-resolve/i);
    assert.match(injection, /not automatically known/i);
});

test('distinct processes on one subject stay separate and final transitions need fresh evidence', () => {
    let state = applyProgressionPatch(createProgressionState(), {
        time: { elapsed: 1, confidence: 1, basis: ['A moment passes.'], completed_actions: [] },
        goals: [{ key: 'aldric_search', owner: 'Aldric', title: 'Search the quay', status: 'active', evidence: ['Aldric begins searching.'] }],
        processes: [
            { key: 'quay_crane_repair', subject_type: 'location', subject_name: 'Cinder Quay', title: 'Repair the crane', status: 'active', evidence: ['Repairs begin.'] },
            { key: 'quay_tide_cleanup', subject_type: 'location', subject_name: 'Cinder Quay', title: 'Clear the tide debris', status: 'active', evidence: ['Cleanup begins.'] },
        ],
        events: [],
    }, { messageIndex: 1 }).state;
    assert.equal(Object.keys(state.processes).length, 2);

    state = applyProgressionPatch(state, {
        time: { elapsed: 1, confidence: 1, basis: ['Another moment passes.'], completed_actions: [] },
        goals: [{ key: 'aldric_search', owner: 'Aldric', title: 'Search the quay', status: 'completed', evidence: [] }],
        processes: [{ key: 'quay_crane_repair', subject_name: 'Cinder Quay', title: 'Repair the crane', status: 'completed', evidence: [] }],
        events: [{ key: 'unfounded_offscreen', title: 'An unfounded event happens', status: 'occurred_offscreen', evidence: [] }],
    }, { messageIndex: 3, autonomy: 'simulation' }).state;
    assert.equal(state.goals['goal:aldric_search'].status, 'active');
    assert.equal(state.processes['process:quay_crane_repair'].status, 'active');
    assert.equal(state.events['event:unfounded_offscreen'].status, 'latent');
});

test('off-screen simulation remains explicitly narrator-only instead of becoming public canon', () => {
    const state = applyProgressionPatch(createProgressionState(), {
        time: { elapsed: 300, confidence: 0.7, basis: ['Five minutes pass.'], completed_actions: ['waited'] },
        goals: [],
        processes: [{
            key: 'harbor_repairs',
            subject_type: 'location',
            subject_name: 'Cinder Quay',
            kind: 'construction',
            title: 'Repair the tide crane',
            status: 'active',
            stage: 'Rigging replacement cables',
            progress: 35,
            visibility: 'narrator',
            evidence: ['The repair crew is already working.'],
        }],
        events: [{
            key: 'aldric_sends_warning',
            title: 'Aldric sends a warning',
            status: 'occurred_offscreen',
            priority: 90,
            visibility: 'private',
            subjects: ['Aldric'],
            evidence: ['This follows Aldric’s established plan while the player is elsewhere.'],
        }],
    }, { messageIndex: 8, autonomy: 'simulation' }).state;

    const injection = buildProgressionInjection(state, 'Jet returns to Cinder Quay and asks after Aldric.', {
        progressionMaximumInjectedEntries: 8,
        progressionInjectionBudget: 5_000,
    });
    assert.match(injection, /narrator_only="true"/);
    assert.match(injection, /UNREVEALED SIMULATION/);
    assert.match(injection, /possibilities until naturally revealed/i);
    assert.match(injection, /Repair the tide crane/);

    const compactInjection = buildProgressionInjection(state, 'Aldric at Cinder Quay', {
        progressionMaximumInjectedEntries: 8,
        progressionInjectionBudget: 500,
    });
    assert.ok(compactInjection.length <= 500);
    assert.match(compactInjection, /<\/inner_lore_world_progression>$/u, 'tight budgets must retain a closed safety block');
});

test('progression retrieval reads late passage details and caps one NPC to two injected goals', () => {
    const state = applyProgressionPatch(createProgressionState(), {
        time: { elapsed: 1, confidence: 1, basis: ['A moment passes.'], completed_actions: [] },
        goals: [
            { key: 'freesia_study_heraldry', owner: 'Freesia', title: 'Study the heraldry books', status: 'active', priority: 70, evidence: ['A lesson was promised.'] },
            { key: 'freesia_practice_forms', owner: 'Freesia', title: 'Practice the morning sword forms', status: 'active', priority: 60, evidence: ['Training was discussed.'] },
            { key: 'freesia_mend_cloak', owner: 'Freesia', title: 'Mend the torn travelling cloak', status: 'active', priority: 50, evidence: ['The cloak is torn.'] },
        ],
        processes: [],
        events: [],
    }, { messageIndex: 4 }).state;
    const lateRelevantPassage = `${'Unrelated atmospheric narration fills the earlier passage. '.repeat(8)}Freesia enters her room to study the heraldry books.`;
    assert.ok(lateRelevantPassage.indexOf('heraldry') > 160);

    const injection = buildProgressionInjection(state, lateRelevantPassage, {
        progressionMaximumInjectedEntries: 8,
        progressionInjectionBudget: 5_000,
        scene: {
            location: { id: 'location:spare room', name: 'Spare room' },
            participants: [{ id: 'character:freesia', name: 'Freesia' }],
            objects: [],
            latestText: lateRelevantPassage,
            focusText: lateRelevantPassage,
        },
    });

    assert.match(injection, /Study the heraldry books/u);
    assert.ok((injection.match(/^- GOAL .*Freesia/gmu) || []).length <= 2);
});

test('stable keys survive a 1,200-exchange simulation without clock drift or unbounded context', () => {
    let state = createProgressionState();
    for (let turn = 0; turn < 1_200; turn++) {
        const goals = turn % 40 === 0 ? [{
            key: 'aldric_catalogue_archive',
            owner: 'Aldric',
            title: 'Catalogue the archive',
            status: 'active',
            progress: Math.min(100, Math.floor(turn / 12)),
            evidence: [`Archive work observed at exchange ${turn}.`],
        }] : [];
        const processes = turn % 25 === 0 ? [{
            key: 'cinder_quay_restoration',
            subject_type: 'location',
            subject_name: 'Cinder Quay',
            kind: 'construction',
            title: 'Restore Cinder Quay',
            status: 'active',
            stage: `phase ${Math.floor(turn / 100) + 1}`,
            progress: Math.min(99, Math.floor(turn / 13)),
            evidence: [`Restoration activity observed at exchange ${turn}.`],
        }] : [];
        const events = turn % 60 === 0 ? [{
            key: `inspection_${turn}`,
            title: `Harbor inspection ${turn}`,
            status: 'scheduled',
            priority: turn % 120 === 0 ? 85 : 45,
            due_in_seconds: { minimum_seconds: 300, estimated_seconds: 330, maximum_seconds: 360 },
            evidence: [`Inspection announced at exchange ${turn}.`],
        }] : [];
        state = applyProgressionPatch(state, {
            time: {
                elapsed: { minimum_seconds: 5, estimated_seconds: 8, maximum_seconds: 12 },
                confidence: 0.72,
                basis: ['A short physical action and exchange of dialogue complete.'],
                completed_actions: ['completed the exchange'],
            },
            goals,
            processes,
            events,
        }, { messageIndex: turn * 2 + 1, autonomy: 'conservative' }).state;
    }

    assert.equal(state.clock.minimumSeconds, 6_000);
    assert.equal(state.clock.estimatedSeconds, 9_600);
    assert.equal(state.clock.maximumSeconds, 14_400);
    assert.equal(Object.keys(state.goals).length, 1, 'stable goal keys must not fragment');
    assert.equal(Object.keys(state.processes).length, 1, 'stable process keys must not fragment');
    assert.equal(Object.keys(state.events).length, 20);
    assert.ok(state.log.length <= 160, 'audit history must remain bounded');

    const scheduled = runProgressionScheduler(normalizeProgressionState(state)).state;
    const stats = getProgressionStats(scheduled);
    assert.equal(stats.goals, 1);
    assert.equal(stats.processes, 1);
    assert.ok(stats.due >= 1);

    const injection = buildProgressionInjection(scheduled, 'Aldric surveys Cinder Quay.', {
        progressionMaximumInjectedEntries: 6,
        progressionInjectionBudget: 1_800,
    });
    assert.ok(injection.length <= 1_800);
    assert.ok((injection.match(/^- /gm) || []).length <= 6);
    assert.match(injection, /Catalogue the archive/);
    assert.match(injection, /Restore Cinder Quay/);
});

test('agent prompt infers action duration without hard-coded canon and protects SummarySception rebuilds', () => {
    const messages = buildProgressionMessages({
        transcript: '[message 10; PLAYER — Jet]\nI walk up to Aldric and say, "Hello."\n\n[message 11; STORY — Narrator]\nJet crosses the study. "Hello," he says. Aldric looks up.',
        progression: createProgressionState(),
        store: {
            entities: {
                'location:cinder quay': {
                    type: 'location',
                    name: 'Cinder Quay',
                    importance: 90,
                    currentState: 'The eastern crane is under repair.',
                    unresolved: ['When will the replacement fittings arrive?'],
                    facts: [],
                },
            },
            brains: {
                aldric: {
                    name: 'Aldric',
                    persistentSelf: {
                        facets: {
                            archive_plan: { key: 'archive_plan', kind: 'plan', statement: 'I will catalogue the archive before dusk.', confidence: 'confirmed' },
                        },
                    },
                },
                jet: {
                    name: 'Jet',
                    persistentSelf: {
                        facets: {
                            forbidden_player_plan: { key: 'forbidden_player_plan', kind: 'plan', statement: 'The engine must not read this player plan.', confidence: 'inferred' },
                        },
                    },
                },
            },
        },
        characterCard: 'A genre-neutral scenario supplied by the current card.',
        playerName: 'Jet',
        settings: { progressionAutonomy: 'conservative', progressionTimeMode: 'balanced' },
    });
    const system = messages[0].content;
    assert.match(system, /even when nobody writes an explicit phrase/i);
    assert.match(system, /overlapping descriptions are one span, not two/i);
    assert.match(system, /New NPC dialogue, answers, pauses, reactions/i);
    assert.match(system, /120–180 words per minute/i);
    assert.match(system, /parallel_group/i);
    assert.match(system, /COMPRESSED STORY MEMORY/);
    assert.match(system, /Work across any genre/i);
    assert.match(system, /Never invent, select, complete/i);
    assert.match(system, /COMPLETED_PASSAGE message labels are hard source metadata/i);
    assert.match(system, /named or titled only in direct address is the recipient, not the speaker/i);
    assert.match(system, /Never copy a player's act into an NPC's timeline/i);
    assert.match(system, /retain the player as actor even if the restatement omits their name/i);
    assert.doesNotMatch(system, /Dani|Seraphina|daughter/i);
    assert.match(messages[1].content, /eastern crane is under repair/i);
    assert.match(messages[1].content, /catalogue the archive before dusk/i);
    assert.doesNotMatch(messages[1].content, /engine must not read this player plan/i);
});
