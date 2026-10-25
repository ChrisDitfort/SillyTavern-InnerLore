import assert from 'node:assert/strict';
import test from 'node:test';

import {
    chooseDefaultProfileId,
    listConnectionProfiles,
    backgroundInFlightCount,
    connectionFallbackProfileIds,
    extractResponseText,
    featherlessCost,
    limitedHost,
    isConcurrencyRejection,
    isTransientRequestError,
    oneAtATimeProvider,
    providerConcurrency,
    providerHasRoom,
    providerInUse,
    sendInnerLoreRequest,
    setStoryIdleGate,
    storyProvider,
    withRequestTimeout,
    fitsBesideStory,
    storyProviderBodyLines,
    scheduleBackgroundTasks,
    describeBackgroundSchedule,
    shellRoles,
    setPeerProviderUnits,
    peerProviderUsed,
} from '../llm-client.js?v=21';

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

function novelAiContext(sendRequest, { mainApi = 'openai', chatCompletionSettings = {} } = {}) {
    globalThis.SillyTavern = {
        getContext: () => ({
            mainApi,
            chatCompletionSettings,
            extensionSettings: { connectionManager: { profiles: [
                { id: 'glm', name: 'GLM 4.6 Novel AI', api: 'custom', 'api-url': 'https://text.novelai.net/oa/v1' },
                { id: 'claude', name: 'Claude Bridge', api: 'custom', 'api-url': 'http://127.0.0.1:8790/innerlore/v1' },
            ] } },
            ConnectionManagerRequestService: { sendRequest },
        }),
    };
}

test('NovelAI profiles and a NovelAI story are recognised as one-at-a-time', () => {
    novelAiContext(async () => '');
    assert.equal(oneAtATimeProvider('glm'), 'novelai.net');
    assert.equal(oneAtATimeProvider('claude'), '');
    assert.equal(storyProvider(), '');
    novelAiContext(async () => '', { mainApi: 'novel' });
    assert.equal(storyProvider(), 'novelai.net', 'Erato and Kayra');
    novelAiContext(async () => '', { chatCompletionSettings: { chat_completion_source: 'custom', custom_url: 'https://text.novelai.net/oa/v1' } });
    assert.equal(storyProvider(), 'novelai.net', 'GLM or Xialong as the story model');
});

test('requests through NovelAI take turns, and the wait is not counted against their timeout', async () => {
    const started = [];
    let release;
    novelAiContext(async () => {
        started.push(Date.now());
        if (started.length === 1) await new Promise(resolve => { release = resolve; });
        return () => (async function* () { yield { text: '{"entities":[],"minds":[]}' }; })();
    });
    const settings = { ...streamingSettings, connectionProfileId: 'glm', providerConcurrency: 2, requestTimeoutSeconds: 15 };
    const first = sendInnerLoreRequest(settings, [{ role: 'user', content: 'Return JSON.' }]);
    const second = sendInnerLoreRequest(settings, [{ role: 'user', content: 'Return JSON.' }]);
    await new Promise(resolve => setTimeout(resolve, 40));
    assert.equal(started.length, 1, 'the second waits for the first');
    assert.ok(providerInUse('novelai.net'));
    release();
    await Promise.all([first, second]);
    assert.equal(started.length, 2);
    assert.equal(providerInUse('novelai.net'), false);
});

test('with two slots a NovelAI background request still waits for a NovelAI story', async () => {
    const sent = [];
    novelAiContext(async () => {
        sent.push(Date.now());
        return () => (async function* () { yield { text: '{"entities":[],"minds":[]}' }; })();
    }, { mainApi: 'novel' });
    try {
        const story = storyGate();
        const request = sendInnerLoreRequest({ ...streamingSettings, connectionProfileId: 'glm', providerConcurrency: 2 }, [{ role: 'user', content: 'Return JSON.' }]);
        await new Promise(resolve => setTimeout(resolve, 30));
        assert.equal(sent.length, 0, 'NovelAI serves one request at a time');
        assert.equal(providerInUse('novelai.net'), false, 'it waits before taking the turn the story would wait for');
        story.finish();
        await request;
        assert.equal(sent.length, 1);
        const busyStory = storyGate();
        await sendInnerLoreRequest({ ...streamingSettings, connectionProfileId: 'claude', providerConcurrency: 2 }, [{ role: 'user', content: 'Return JSON.' }]);
        assert.equal(sent.length, 2, 'another provider goes beside the story');
        busyStory.finish();
    } finally {
        setStoryIdleGate(null);
    }
});

function featherlessContext(sendRequest, storyModel = '') {
    globalThis.SillyTavern = {
        getContext: () => ({
            mainApi: storyModel ? 'openai' : 'textgenerationwebui',
            chatCompletionSettings: storyModel ? { chat_completion_source: 'custom', custom_url: 'https://api.featherless.ai/v1', custom_model: storyModel } : {},
            extensionSettings: { connectionManager: { profiles: [
                { id: 'gemma', name: 'Featherless Gemma', api: 'custom', 'api-url': 'https://api.featherless.ai/v1', model: 'coder3101/gemma-4-31B-it-heretic' },
            ] } },
            ConnectionManagerRequestService: { sendRequest },
        }),
    };
}

test('a Featherless model costs 1, 2 or 4 of the plan\'s units by its size', () => {
    assert.equal(featherlessCost('inflatebot/MN-12B-Mag-Mell-R1'), 1);
    assert.equal(featherlessCost('coder3101/gemma-4-31B-it-heretic'), 2);
    assert.equal(featherlessCost('Tetratype/Gemma-4-26B-A4B-it-heretic-antislop'), 2);
    assert.equal(featherlessCost('darkc0de/Qwen3.8-27B-heretic'), 2);
    assert.equal(featherlessCost('TheDrummer/Anubis-70B-v1.1'), 4);
    assert.equal(featherlessCost('zai-org/GLM-5.3'), 4, 'no size in the name: counted as large');
});

test('with the story on a 2-unit Featherless model, background requests leave the story its units', async () => {
    const started = [];
    const releases = [];
    featherlessContext(async () => {
        started.push(Date.now());
        await new Promise(resolve => releases.push(resolve));
        return () => (async function* () { yield { text: '{"entities":[],"minds":[]}' }; })();
    }, 'coder3101/gemma-4-31B-it-heretic');
    const settings = { ...streamingSettings, connectionProfileId: 'gemma', providerConcurrency: 2 };
    const first = sendInnerLoreRequest(settings, [{ role: 'user', content: 'Return JSON.' }]);
    const second = sendInnerLoreRequest(settings, [{ role: 'user', content: 'Return JSON.' }]);
    await new Promise(resolve => setTimeout(resolve, 40));
    assert.equal(started.length, 1, 'two units are kept for the story, so one background request runs at a time');
    assert.ok(providerHasRoom('featherless.ai', 2), 'the story can still leave');
    releases.shift()();
    await first;
    await new Promise(resolve => setTimeout(resolve, 40));
    assert.equal(started.length, 2);
    releases.shift()();
    await second;
    assert.equal(providerInUse('featherless.ai'), false);
});

test('with the story on a 70B Featherless model, a background request waits for the story', async () => {
    const sent = [];
    featherlessContext(async () => {
        sent.push(Date.now());
        return () => (async function* () { yield { text: '{"entities":[],"minds":[]}' }; })();
    }, 'TheDrummer/Anubis-70B-v1.1');
    try {
        const story = storyGate();
        const request = sendInnerLoreRequest({ ...streamingSettings, connectionProfileId: 'gemma', providerConcurrency: 2 }, [{ role: 'user', content: 'Return JSON.' }]);
        await new Promise(resolve => setTimeout(resolve, 30));
        assert.equal(sent.length, 0, 'the 70B story takes all four units');
        story.finish();
        await request;
        assert.equal(sent.length, 1);
    } finally {
        setStoryIdleGate(null);
    }
});

test('a planner on the story\'s one-slot provider does not fit beside the story; other providers do', () => {
    novelAiContext(async () => '', { chatCompletionSettings: { chat_completion_source: 'custom', custom_url: 'https://text.novelai.net/oa/v1', custom_model: 'xialong-v1' } });
    assert.equal(fitsBesideStory('glm'), false, 'NovelAI serves one request at a time');
    assert.equal(fitsBesideStory('claude'), true, 'another provider is unaffected');
    novelAiContext(async () => '');
    assert.equal(fitsBesideStory('glm'), true, 'no limited story provider');
});

test('story requests on limited providers get thinking off and the preset samplers, never repeating keys the body has', () => {
    assert.deepEqual(storyProviderBodyLines('featherless.ai', '', { top_k: 0, min_p: 0.02 }), ['reasoning_effort: none', 'chat_template_kwargs:', '  enable_thinking: false', 'min_p: 0.02']);
    assert.deepEqual(storyProviderBodyLines('novelai.net', '', { top_k: 250, min_p: 0 }), ['top_k: 250']);
    assert.deepEqual(storyProviderBodyLines('featherless.ai', 'reasoning_effort: none\nchat_template_kwargs:\n  enable_thinking: false', { top_k: 64 }), ['top_k: 64']);
    assert.deepEqual(storyProviderBodyLines('', '', { top_k: 250 }), [], 'an unlimited provider is left alone');
    assert.equal(limitedHost('https://nano-gpt.com/api/subscription/v1'), 'nano-gpt.com', 'the NanoGPT subscription is a budgeted provider');
    assert.deepEqual(storyProviderBodyLines('nano-gpt.com', '', { custom_model: 'z-ai/glm-5.3-flash-uncensored', top_k: 0, min_p: 0 }), ['reasoning_effort: low'], 'GLM 5.3 thinks briefly on NanoGPT');
    assert.deepEqual(storyProviderBodyLines('nano-gpt.com', 'reasoning_effort: medium', { custom_model: 'z-ai/glm-5.3-flash-uncensored' }), [], 'a connection\'s own effort line wins');
    assert.deepEqual(storyProviderBodyLines('nano-gpt.com', '', { custom_model: 'nousresearch/hermes-4-405b', top_k: 40 }), ['top_k: 40'], 'other NanoGPT models get only the sampling lines');
    assert.deepEqual(storyProviderBodyLines('novelai.net', 'top_k: 40', {}, 'top_k: 250\nrepetition_penalty: 1.1\nextra:\n  a: 1'), ['repetition_penalty: 1.1', 'extra:', '  a: 1'], "the user's YAML replaces the defaults, minus keys already sent");
});

test('under the fork the connection pickers read the shell records from settings before the shell API is published', () => {
    const previousWindow = globalThis.window;
    const previousTavern = globalThis.SillyTavern;
    try {
        globalThis.window = {};
        globalThis.SillyTavern = {
            getContext: () => ({
                extensionSettings: {
                    innerlore_shell: {
                        connections: [
                            { id: 'legacy-featherless', name: 'Featherless (InnerLore)', mode: 'cc', url: 'https://api.featherless.ai/v1', model: 'gemma', background: true },
                            { id: 'nano-glm', name: 'NanoGPT GLM', mode: 'cc', url: 'https://nano-gpt.com/api/subscription/v1', model: 'glm', background: true },
                            { id: 'erato', name: 'Erato', mode: 'novel', background: false },
                        ],
                    },
                    connectionManager: { profiles: [{ id: 'legacy-featherless', name: 'Featherless (InnerLore)' }], selectedProfile: 'legacy-featherless' },
                },
            }),
        };
        assert.deepEqual(listConnectionProfiles().map(profile => profile.id), ['legacy-featherless', 'nano-glm']);
        assert.equal(chooseDefaultProfileId('nano-glm'), 'nano-glm', 'the saved pick survives the first fill');
        assert.equal(chooseDefaultProfileId('gone'), 'legacy-featherless');
    } finally {
        globalThis.window = previousWindow;
        globalThis.SillyTavern = previousTavern;
    }
});

test('passes leave together on a budgeted provider and across providers, one after another on an unknown host unless asked', async () => {
    const previousWindow = globalThis.window;
    const previousTavern = globalThis.SillyTavern;
    try {
        globalThis.window = {};
        globalThis.SillyTavern = {
            getContext: () => ({
                extensionSettings: {
                    innerlore_shell: {
                        connections: [
                            { id: 'nano', name: 'NanoGPT', mode: 'cc', url: 'https://nano-gpt.com/api/subscription/v1', model: 'glm', background: true },
                            { id: 'bridge', name: 'Bridge', mode: 'cc', url: 'http://127.0.0.1:8790/innerlore/v1', model: 'opus', background: true },
                            { id: 'novel', name: 'NovelAI GLM', mode: 'cc', url: 'https://text.novelai.net/oa/v1', model: 'glm-4-6', background: true },
                        ],
                        roles: { story: 'nano', curator: 'nano', minds: '', progression: '', game: '', planner: 'bridge', private: '', fallback: '' },
                    },
                },
            }),
        };
        assert.equal(shellRoles().planner, 'bridge', 'roles are read from the settings before the shell API exists');
        const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
        const trace = [];
        const task = (name, profileId, ms = 40, fail = false) => ({
            name, profileId,
            run: async () => {
                trace.push(`${name}:start`);
                await sleep(ms);
                trace.push(`${name}:end`);
                if (fail) throw new Error(`${name} failed`);
                return name;
            },
        });
        const startedBeforeEnded = (a, b) => trace.indexOf(`${a}:start`) < trace.indexOf(`${b}:end`) && trace.indexOf(`${b}:start`) < trace.indexOf(`${a}:end`);

        // NanoGPT has a known budget: its passes overlap without any opt-in.
        let outcomes = await scheduleBackgroundTasks([task('curator', 'nano'), task('progression', 'nano'), task('game', 'nano', 20, true)]);
        assert.ok(startedBeforeEnded('curator', 'progression'), `curator and progression overlapped on NanoGPT: ${trace.join(' ')}`);
        assert.equal(outcomes.curator.value, 'curator');
        assert.match(outcomes.game.error.message, /game failed/u, 'a failed pass reports its error without stopping the others');
        assert.equal(outcomes.progression.value, 'progression');

        // An unknown host runs its passes in order unless the user opts in.
        trace.length = 0;
        await scheduleBackgroundTasks([task('curator', 'bridge'), task('progression', 'bridge')]);
        assert.deepEqual(trace, ['curator:start', 'curator:end', 'progression:start', 'progression:end']);
        trace.length = 0;
        await scheduleBackgroundTasks([task('curator', 'bridge'), task('progression', 'bridge')], { parallel: true });
        assert.ok(startedBeforeEnded('curator', 'progression'), 'with the opt-in the bridge passes overlap');

        // Two providers overlap even without the opt-in; the unknown host keeps its own order.
        trace.length = 0;
        await scheduleBackgroundTasks([task('curator', 'bridge', 60), task('planner', 'nano', 10), task('game', 'bridge', 10)]);
        assert.ok(startedBeforeEnded('curator', 'planner'), 'the NanoGPT planner ran beside the bridge curator');
        assert.ok(trace.indexOf('game:start') > trace.indexOf('curator:end'), 'the bridge game waited for the bridge curator');

        // A cancelled task ends its serial queue; the other queue is unaffected.
        trace.length = 0;
        const cancelled = { name: 'curator', profileId: 'bridge', run: async () => { throw new DOMException('stopped', 'AbortError'); } };
        outcomes = await scheduleBackgroundTasks([cancelled, task('progression', 'bridge'), task('planner', 'nano')]);
        assert.equal(outcomes.curator.error.name, 'AbortError');
        assert.equal(outcomes.progression, undefined, 'the pass behind the cancelled one never started');
        assert.equal(outcomes.planner.value, 'planner');

        assert.equal(describeBackgroundSchedule([task('curator', 'nano'), task('game', 'nano'), task('planner', 'bridge')]), 'curator, game together on nano-gpt.com; planner on 127.0.0.1:8790');
        assert.equal(describeBackgroundSchedule([task('curator', 'bridge'), task('game', 'bridge')]), 'curator, game one after another on 127.0.0.1:8790');
        assert.equal(describeBackgroundSchedule([task('curator', 'novel'), task('game', 'novel')]), 'curator, game together on novelai.net');
    } finally {
        globalThis.window = previousWindow;
        globalThis.SillyTavern = previousTavern;
    }
});

test('what the server holds on a provider counts against the story\'s room', () => {
    assert.equal(providerHasRoom('nano-gpt.com', 1), true);
    setPeerProviderUnits('nano-gpt.com', 10);
    assert.equal(peerProviderUsed('nano-gpt.com'), 10);
    assert.equal(providerHasRoom('nano-gpt.com', 1), false, 'ten server requests fill NanoGPT');
    assert.equal(providerInUse('nano-gpt.com'), true);
    setPeerProviderUnits('nano-gpt.com', 9);
    assert.equal(providerHasRoom('nano-gpt.com', 1), true);
    setPeerProviderUnits('nano-gpt.com', 0);
    assert.equal(providerInUse('nano-gpt.com'), false);
    assert.equal(providerHasRoom('unknown.example', 99), true, 'an unknown host has no budget');
});
