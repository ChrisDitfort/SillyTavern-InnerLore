import assert from 'node:assert/strict';
import test from 'node:test';

import { planNarratorPromptDelivery } from '../prompts.js';

test('a delivered main prompt needs no order change', () => {
    assert.equal(planNarratorPromptDelivery(null), null);
    assert.equal(planNarratorPromptDelivery(undefined), null);
    assert.equal(planNarratorPromptDelivery([
        { identifier: 'main', enabled: true },
        { identifier: 'chatHistory', enabled: true },
    ]), null);
    // Missing enabled flag counts as enabled, matching the prompt manager.
    assert.equal(planNarratorPromptDelivery([{ identifier: 'main' }]), null);
});

test('a disabled main prompt is reported for in-place enablement', () => {
    assert.deepEqual(planNarratorPromptDelivery([
        { identifier: 'charDescription', enabled: true },
        { identifier: 'main', enabled: false },
    ]), { existed: true, index: 1 });
});

test('a novelist preset that omits main is reported for front-loading', () => {
    // The exact shape of the "Xialong Story Mode" preset that let a story
    // model narrate the player's actions: no main entry in the order at all.
    const order = [
        { identifier: 'dialogueExamples', enabled: false },
        { identifier: 'charDescription', enabled: true },
        { identifier: 'charPersonality', enabled: true },
        { identifier: 'scenario', enabled: true },
        { identifier: 'personaDescription', enabled: true },
        { identifier: 'worldInfoBefore', enabled: true },
        { identifier: 'worldInfoAfter', enabled: true },
        { identifier: 'chatHistory', enabled: true },
    ];
    assert.deepEqual(planNarratorPromptDelivery(order), { existed: false, index: -1 });
});

test('swap and restore keep the temporary order change symmetrical', () => {
    // Mirrors applyNarratorPromptSwap/restoreNarratorPromptSwap contract:
    // whatever the plan reports, applying then restoring the described change
    // must return the order list to its original identity and content.
    for (const order of [
        [{ identifier: 'main', enabled: false }, { identifier: 'chatHistory', enabled: true }],
        [{ identifier: 'chatHistory', enabled: true }],
    ]) {
        const original = order.map(item => ({ ...item }));
        const plan = planNarratorPromptDelivery(order);
        let restore;
        if (plan) {
            if (plan.existed) {
                restore = { index: plan.index, item: { ...order[plan.index] } };
                order[plan.index] = { identifier: 'main', enabled: true };
            } else {
                restore = { index: -1, item: null };
                order.unshift({ identifier: 'main', enabled: true });
            }
        }
        assert.ok(order.some(item => item.identifier === 'main' && item.enabled !== false));
        // restore
        const index = order.findIndex(item => item?.identifier === 'main');
        if (restore.index === -1) order.splice(index, 1);
        else order[index] = restore.item;
        assert.deepEqual(order, original);
    }
});
