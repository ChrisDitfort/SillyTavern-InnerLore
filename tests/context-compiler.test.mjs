import assert from 'node:assert/strict';
import test from 'node:test';

import { compileContext } from '../context-compiler.js';
import {
    clipAtBoundary,
    createEmptyStore,
    mergeEntityOperations,
    mergeMindOperations,
    renderCompactEntity,
} from '../core.js';
import { createProgressionState } from '../progression.js';
import { deriveSceneState } from '../scene.js';

function squireFixture() {
    const store = createEmptyStore('context-compiler-squire');
    mergeEntityOperations(store, [
        {
            type: 'location',
            name: "Jet Storm's House",
            importance: 80,
            current_state: 'Jet and Freesia are seated beside the hearth in the main room.',
        },
        {
            type: 'location',
            name: 'Hot Spring',
            importance: 65,
            current_state: 'Not visited in the current scene; the invitation was declined.',
        },
        {
            type: 'item',
            name: "Marshal's Writ",
            importance: 70,
            current_state: "In Jet Storm's coat.",
        },
        {
            type: 'item',
            name: "Freesia's Practice Sword",
            aliases: ['practice sword'],
            importance: 60,
            current_state: 'Leaning beside the desk in the spare room upstairs.',
        },
        {
            type: 'character',
            name: 'Jet Storm',
            importance: 90,
            current_state: 'Seated in the main room beside the hearth.',
            unresolved: ['Why did the marshal assign Freesia to him?'],
        },
        {
            type: 'character',
            name: 'Freesia',
            importance: 90,
            current_state: 'Seated beside the hearth, waiting for her next lesson.',
            unresolved: ['Can she bear the danger required of a squire?'],
        },
    ], { messageIndex: 1, minimumImportance: 0, maximumOperations: 20 });

    mergeMindOperations(store, [{
        character: 'Freesia',
        set: [
            {
                key: 'old_hot_spring_discomfort',
                category: 'emotion',
                thought: 'The hot spring invitation still makes me want to hide.',
                confidence: 'confirmed',
                retention: 'scene',
            },
            {
                key: 'prove_squire',
                category: 'goal',
                thought: "I must prove myself as Jet Storm's squire.",
                confidence: 'confirmed',
                retention: 'durable',
            },
        ],
    }], { messageIndex: 1, maximumOperations: 10, maximumThoughts: 20 });
    mergeMindOperations(store, [{
        character: 'Freesia',
        set: [{
            key: 'bound_man_uncertainty',
            category: 'fear',
            thought: 'I do not know who the bound man is or what Jet expects me to do here.',
            confidence: 'confirmed',
            retention: 'scene',
        }],
    }], { messageIndex: 19, maximumOperations: 10, maximumThoughts: 20 });

    const progression = createProgressionState();
    progression.goals['goal:prove_squire'] = {
        key: 'prove_squire',
        owner: 'Freesia',
        title: "Prove herself as Jet Storm's squire",
        nextStep: 'Face the current lesson without retreating.',
        status: 'active',
        deadlineState: 'unscheduled',
        progress: 20,
        priority: 75,
    };
    progression.events['event:first_light'] = {
        key: 'first_light',
        title: 'Freesia ready at first light',
        subjects: ['Freesia'],
        trigger: 'First light tomorrow',
        status: 'scheduled',
        priority: 55,
        dueAt: { minimumSeconds: 30_000, estimatedSeconds: 32_000, maximumSeconds: 34_000 },
    };
    store.progression = progression;

    const messages = [
        { is_user: true, name: 'Jet Storm', mes: 'Sit by the fire while we discuss your duties.' },
        { is_user: false, name: 'Narrator', mes: 'Freesia sits beside the hearth and listens.' },
        { is_user: true, name: 'Jet Storm', mes: 'Follow me, Freesia. You lead her down into the dungeon where a man is tied to a chair.' },
        {
            is_user: false,
            name: 'Narrator',
            mes: 'Freesia follows down the cold stairwell. A bound man waits below. Her practice sword is still upstairs.',
        },
    ];
    return { store, messages };
}

test('scene compiler follows a performed move without carrying unrelated recent lore into context', () => {
    const { store, messages } = squireFixture();
    const scene = deriveSceneState(messages, store, {
        currentIndex: 20,
        playerName: 'Jet Storm',
        lookbackMessages: 4,
    });
    assert.equal(scene.location.name.toLowerCase(), 'the dungeon');
    assert.deepEqual(new Set(scene.participants.map(item => item.name)), new Set(['Jet Storm', 'Freesia']));
    assert.deepEqual(scene.objects, [], 'an item explicitly left upstairs is not in the active object set');

    const recentText = messages.map(message => message.mes).join('\n');
    const compiled = compileContext({
        store,
        messages,
        recentText,
        playerName: 'Jet Storm',
        currentIndex: 20,
        settings: {
            enabled: true,
            innerSelfEnabled: true,
            autoLoreEnabled: true,
            worldProgressionEnabled: true,
            currentIndex: 20,
            sceneLookbackMessages: 4,
            maximumActiveBrains: 8,
            maximumInjectedThoughtsPerBrain: 6,
            maximumSceneThoughtAge: 6,
            maximumInjectedEntities: 8,
            brainRecencyMessages: 10,
            loreRecencyMessages: 16,
            brainInjectionBudget: 3_000,
            loreInjectionBudget: 4_000,
            progressionMaximumInjectedEntries: 8,
            progressionInjectionBudget: 2_000,
        },
    });

    assert.match(compiled.blocks.scene, /Location\/focus: the dungeon/i);
    assert.doesNotMatch(compiled.blocks.scene, /Objects currently in play/u);
    assert.doesNotMatch(compiled.blocks.lore, /Jet Storm's House|Hot Spring|Marshal's Writ/u);
    assert.doesNotMatch(compiled.blocks.lore, /Seated (?:in the main room|beside the hearth)/iu, 'a performed move suppresses stale participant positions');
    assert.match(compiled.blocks.lore, /Practice Sword/);
    assert.match(compiled.blocks.lore, /upstairs/);
    assert.match(compiled.blocks.minds, /bound man is or what Jet expects/i);
    assert.doesNotMatch(compiled.blocks.minds, /hot spring invitation/i, 'expired scene emotion must leave active context');
    assert.doesNotMatch(compiled.blocks.minds, /I must prove myself as Jet Storm's squire/i, 'progression owns the duplicate goal concept');
    assert.doesNotMatch(compiled.blocks.progression, /ready at first light/i, 'a distant scheduled beat must not follow its actor into an unrelated scene');
    assert.match(compiled.blocks.progression, /Prove herself as Jet Storm's squire/i);
    assert.match(compiled.diagnostics, /Saved but not injected:[\s\S]*Hot Spring/u);
});

test('scene compiler does not mistake an infinitive or deferred appointment for current movement', () => {
    const store = createEmptyStore('context-compiler-infinitive');
    mergeEntityOperations(store, [
        {
            type: 'location',
            name: 'Study',
            importance: 70,
            current_state: 'A book-lined room inside the house.',
        },
        {
            type: 'location',
            name: "Jet Storm's House",
            aliases: ['the house', 'house'],
            importance: 80,
            current_state: 'Freesia is returning along the nearby path.',
        },
        {
            type: 'location',
            name: 'Spare Room',
            aliases: ['room'],
            importance: 75,
            current_state: "Freesia's assigned room inside the house.",
        },
        { type: 'character', name: 'Jet Storm', importance: 90 },
        { type: 'character', name: 'Freesia', importance: 90 },
    ], { messageIndex: 1, minimumImportance: 0, maximumOperations: 20 });

    const messages = [
        {
            is_user: true,
            name: 'Jet Storm',
            mes: "You may get dressed. I'll come to your room later to go over the books that I want you to study.",
        },
        {
            is_user: false,
            name: 'Narrator',
            mes: 'Freesia dresses, then walks up the stone path toward the house.',
        },
    ];
    const scene = deriveSceneState(messages, store, {
        currentIndex: 2,
        playerName: 'Jet Storm',
        lookbackMessages: 2,
    });

    assert.equal(scene.location.name, "Jet Storm's House");
    assert.notEqual(scene.location.name.toLowerCase(), 'study');
    assert.notEqual(scene.location.name.toLowerCase(), 'spare room');
});

test('scene compiler ignores speech idioms that resemble movement destinations', () => {
    const store = createEmptyStore('context-compiler-idiom');
    const messages = [
        {
            is_user: true,
            name: 'Jet Storm',
            mes: 'Freesia, tell me what happened.',
        },
        {
            is_user: false,
            name: 'Narrator',
            mes: 'The words come out in pieces, each one harder than the last.',
        },
    ];

    const scene = deriveSceneState(messages, store, {
        currentIndex: 1,
        playerName: 'Jet Storm',
        lookbackMessages: 2,
    });

    assert.equal(scene.location, null);
});

test('priority entity rendering keeps current state and open canon first and clips only at boundaries', () => {
    const record = {
        name: 'Northwatch Vault',
        type: 'location',
        summary: 'A very long historical overview that should be lower priority than immediate continuity. '.repeat(8),
        currentState: 'The eastern door is open and Mara is standing inside.',
        unresolved: ['Who removed the seventh ledger?'],
        facts: ['The western stacks were catalogued in winter. '.repeat(8)],
        relationships: [],
    };
    const rendered = renderCompactEntity(record, 260, { focusText: 'Mara enters through the eastern door.' });
    assert.ok(rendered.indexOf('Current:') < rendered.indexOf('Open:'));
    assert.ok(rendered.indexOf('Open:') < rendered.indexOf('Overview:'));
    assert.doesNotMatch(rendered, /continui…|immediat…|histor…/u);

    const clipped = clipAtBoundary('First complete sentence. Second sentence contains material that will not fit.', 34);
    assert.match(clipped, /^First complete sentence\.\s*…$/u);
});
