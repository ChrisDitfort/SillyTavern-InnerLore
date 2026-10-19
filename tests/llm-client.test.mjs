import assert from 'node:assert/strict';
import test from 'node:test';

import {
    backgroundInFlightCount,
    connectionFallbackProfileIds,
    extractResponseText,
    isConcurrencyRejection,
    isTransientRequestError,
    providerConcurrency,
    sendInnerLoreRequest,
    setStoryIdleGate,
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

function streamingProfileContext(sendRequest) {
    globalThis.SillyTavern = {
        getContext: () => ({
            extensionSettings: { connectionManager: { profiles: [{ id: 'novel', name: 'Background Model ' }] } },
            ConnectionManagerRequestService: { sendRequest },
        }),
    };
}

const streamingSettings = {
    connectionSource: 'profile',
    connectionProfileId: 'novel',
    requestMaximumAttempts: 3,
    requestTimeoutSeconds: 15,
    maximumResponseTokens: 800,
};

test('a rejected key behind an empty stream is reported once, not retried as empty text', async () => {
    const calls = [];
    // SillyTavern answers a streamed request whose provider replied 401 with
    // an empty stream; only the non-streaming route raises the real error.
    streamingProfileContext(async (_profileId, _messages, _maxTokens, custom) => {
        calls.push(custom.stream);
        if (custom.stream) return () => (async function* () {})();
        throw new Error('Unauthorized');
    });
    await assert.rejects(
        sendInnerLoreRequest(streamingSettings, [{ role: 'user', content: 'Return JSON.' }]),
        error => /rejected InnerLore's connection profile "Background Model": Unauthorized/u.test(error.message)
            && !isTransientRequestError(error),
    );
    assert.deepEqual(calls, [true, false], 'one stream, one probe, no blind retries');
});

test('a genuinely empty stream stays transient', async () => {
    streamingProfileContext(async (_profileId, _messages, _maxTokens, custom) => (
        custom.stream ? () => (async function* () {})() : { content: '' }
    ));
    await assert.rejects(
        sendInnerLoreRequest({ ...streamingSettings, requestMaximumAttempts: 1 }, [{ role: 'user', content: 'Return JSON.' }]),
        /no visible text/u,
    );
});

test('a streamed background request holds its slot until the stream ends', async () => {
    let inFlightMidStream = -1;
    streamingProfileContext(async () => () => (async function* () {
        yield { text: '{"entities":' };
        await new Promise(resolve => setTimeout(resolve, 20));
        inFlightMidStream = backgroundInFlightCount();
        yield { text: '{"entities":[],"minds":[]}' };
    })());
    const output = await sendInnerLoreRequest(streamingSettings, [{ role: 'user', content: 'Return JSON.' }]);
    assert.match(output, /"minds"/u);
    assert.equal(inFlightMidStream, 1, 'the story gate sees background work while it streams');
    assert.equal(backgroundInFlightCount(), 0);
});

test('provider concurrency is one slot unless two are chosen', () => {
    assert.equal(providerConcurrency({}), 1);
    assert.equal(providerConcurrency({ providerConcurrency: 2 }), 2);
    assert.equal(providerConcurrency({ providerConcurrency: '2' }), 2);
    assert.equal(providerConcurrency({ providerConcurrency: 3 }), 1);
});

test('only a short reply can be a provider concurrency rejection', () => {
    assert.equal(isConcurrencyRejection('Concurrent generation is locked'), true);
    assert.equal(isConcurrencyRejection(''), false);
    const record = `INNERLORE CURATOR 1\nLOCATION Ben Tavern\nsummary = A busy inn whose cellar door stays locked after dark.\n${'fact = The taproom is crowded at dusk.\n'.repeat(6)}END\nDONE`;
    assert.equal(isConcurrencyRejection(record), false);
});

test('a background reply that mentions a locked door is accepted', async () => {
    const reply = `{"entities":[{"type":"location","name":"Cellar","summary":"${'The cellar door is locked and the inn above is busy. '.repeat(5)}"}],"minds":[]}`;
    streamingProfileContext(async () => () => (async function* () { yield { text: reply }; })());
    const output = await sendInnerLoreRequest(streamingSettings, [{ role: 'user', content: 'Return JSON.' }]);
    assert.equal(output, reply);
});

function storyGate() {
    let finish;
    const finished = new Promise(resolve => { finish = resolve; });
    let waits = 0;
    setStoryIdleGate(async () => {
        waits++;
        await finished;
    });
    return { finish, waits: () => waits };
}

test('with one slot a background request waits for the story; with two it goes at once', async () => {
    const sent = [];
    streamingProfileContext(async () => {
        sent.push(Date.now());
        return () => (async function* () { yield { text: '{"entities":[],"minds":[]}' }; })();
    });
    try {
        const story = storyGate();
        const oneSlot = sendInnerLoreRequest(streamingSettings, [{ role: 'user', content: 'Return JSON.' }]);
        await new Promise(resolve => setTimeout(resolve, 30));
        assert.equal(sent.length, 0, 'one slot: held until the story finishes');
        story.finish();
        await oneSlot;
        assert.equal(sent.length, 1);

        const busyStory = storyGate();
        await sendInnerLoreRequest({ ...streamingSettings, providerConcurrency: 2 }, [{ role: 'user', content: 'Return JSON.' }]);
        assert.equal(sent.length, 2, 'two slots: sent while the story is still writing');
        assert.equal(busyStory.waits(), 0);
        busyStory.finish();
    } finally {
        setStoryIdleGate(null);
    }
});

test('with two slots a provider that refuses a second request is retried after the story', async () => {
    const replies = ['Concurrent generation is locked', '{"entities":[],"minds":[]}'];
    streamingProfileContext(async () => {
        const text = replies.shift();
        return () => (async function* () { yield { text }; })();
    });
    try {
        const story = storyGate();
        const request = sendInnerLoreRequest({ ...streamingSettings, providerConcurrency: 2 }, [{ role: 'user', content: 'Return JSON.' }]);
        await new Promise(resolve => setTimeout(resolve, 30));
        assert.equal(replies.length, 1, 'the first attempt went out beside the story and was refused');
        assert.equal(story.waits(), 1, 'the retry waits for the story');
        story.finish();
        assert.equal(await request, '{"entities":[],"minds":[]}');
    } finally {
        setStoryIdleGate(null);
    }
});
