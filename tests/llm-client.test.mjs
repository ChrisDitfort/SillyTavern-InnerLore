import assert from 'node:assert/strict';
import test from 'node:test';

import {
    connectionFallbackProfileIds,
    extractResponseText,
    isTransientRequestError,
    sendInnerLoreRequest,
    withRequestTimeout,
} from '../llm-client.js';

test('response extraction prefers final content over private reasoning', () => {
    const text = extractResponseText({
        content: '{"entities":[],"minds":[]}',
        reasoning: 'This should not replace a valid final answer.',
    });
    assert.equal(text, '{"entities":[],"minds":[]}');
});

test('response extraction recovers a reasoning-only structured payload', () => {
    const text = extractResponseText({
        content: '',
        reasoning: 'Analysis complete.\n{"entities":[],"minds":[]}',
    });
    assert.match(text, /"entities":\[\]/u);
});

test('request timeout aborts a hung background call', async () => {
    let receivedSignal;
    await assert.rejects(
        withRequestTimeout(signal => {
            receivedSignal = signal;
            return new Promise(() => {});
        }, null, 20),
        error => error?.name === 'TimeoutError' && /timed out/u.test(error.message),
    );
    assert.equal(receivedSignal.aborted, true);
});

test('external cancellation remains distinct from a timeout', async () => {
    const controller = new AbortController();
    const request = withRequestTimeout(() => new Promise(() => {}), controller.signal, 5_000);
    controller.abort();
    await assert.rejects(request, error => error?.name === 'AbortError');
});

test('transport failures remain identifiable after request and subsystem wrapping', () => {
    const transport = new Error('socket hang up');
    const request = new Error('InnerLore request failed: socket hang up', { cause: transport });
    const subsystem = new Error(`continuity curator: ${request.message}`, { cause: request });

    assert.equal(isTransientRequestError(subsystem), true);
    assert.equal(isTransientRequestError(new Error(
        'API request failed: Upstream error from Together: Stream error: h2 protocol error: error reading a body from connection',
    )), true);
    assert.equal(isTransientRequestError(new Error('Returned JSON does not match the required schema.')), false);
});

test('fallback profile routing is ordered, deduplicated, and excludes the primary', () => {
    assert.deepEqual(connectionFallbackProfileIds({
        connectionProfileId: 'primary',
        fallbackConnectionProfileId: 'fallback-a',
        fallbackConnectionProfileIds: ['primary', 'fallback-a', 'fallback-b'],
    }), ['fallback-a', 'fallback-b']);
});

test('a configured fallback profile receives a transiently failed background request', async () => {
    const calls = [];
    const profiles = [
        { id: 'primary', name: 'Primary' },
        { id: 'fallback', name: 'Fallback' },
    ];
    globalThis.SillyTavern = {
        getContext: () => ({
            extensionSettings: { connectionManager: { profiles } },
            ConnectionManagerRequestService: {
                sendRequest: async profileId => {
                    calls.push(profileId);
                    if (profileId === 'primary') throw new Error('503 service unavailable');
                    return { content: '{"entities":[],"minds":[]}' };
                },
            },
        }),
    };

    const output = await sendInnerLoreRequest({
        connectionSource: 'profile',
        connectionProfileId: 'primary',
        fallbackConnectionProfileId: 'fallback',
        requestMaximumAttempts: 1,
        fallbackRequestMaximumAttempts: 1,
        requestTimeoutSeconds: 15,
        maximumResponseTokens: 800,
    }, [{ role: 'user', content: 'Return JSON.' }]);

    assert.deepEqual(calls, ['primary', 'fallback']);
    assert.match(output, /"entities"/u);
});
