import assert from 'node:assert/strict';
import test from 'node:test';

import { bytesToBase64, concatChunks, createSilenceTracker, encodeWav, resample, tidyTranscript, trimSilence } from '../voice-input.js';

function tone(seconds, rate, amplitude = 0.3, frequency = 220) {
    const out = new Float32Array(Math.floor(seconds * rate));
    for (let i = 0; i < out.length; i += 1) out[i] = amplitude * Math.sin((2 * Math.PI * frequency * i) / rate);
    return out;
}

test('resampling keeps the duration; WAV has a valid header', () => {
    const input = tone(0.5, 48_000);
    const output = resample(input, 48_000, 16_000);
    assert.equal(output.length, 8_000);
    const wav = encodeWav(output, 16_000);
    assert.equal(wav.length, 44 + 16_000);
    assert.equal(String.fromCharCode(...wav.subarray(0, 4)), 'RIFF');
    assert.equal(new DataView(wav.buffer).getUint32(24, true), 16_000);
    assert.equal(concatChunks([input, output]).length, input.length + output.length);
    assert.equal(bytesToBase64(new Uint8Array([82, 73, 70, 70])), 'UklGRg==');
});

test('the silence tracker ends an utterance after speech then quiet, never before speech', () => {
    const rate = 16_000;
    const tracker = createSilenceTracker({ silenceMs: 1_000, minimumSpeechMs: 200 });
    const quiet = new Float32Array(1_600).fill(0.001);
    const loud = tone(0.1, rate);
    for (let i = 0; i < 30; i += 1) assert.notEqual(tracker.feed(quiet, rate), 'done', 'three quiet seconds alone do not end it');
    assert.equal(tracker.heardSpeech, false);
    for (let i = 0; i < 5; i += 1) assert.equal(tracker.feed(loud, rate), 'speaking');
    assert.equal(tracker.heardSpeech, true);
    let state = '';
    for (let i = 0; i < 12 && state !== 'done'; i += 1) state = tracker.feed(quiet, rate);
    assert.equal(state, 'done');
    const capped = createSilenceTracker({ maximumMs: 500 });
    let last = '';
    for (let i = 0; i < 6; i += 1) last = capped.feed(loud, rate);
    assert.equal(last, 'done', 'a very long recording is cut at the maximum');
});

test('silence trimming keeps the words with a little padding; transcripts are tidied', () => {
    const rate = 16_000;
    const samples = concatChunks([new Float32Array(rate).fill(0), tone(1, rate), new Float32Array(rate).fill(0)]);
    const trimmed = trimSilence(samples, rate, { padMs: 100 });
    assert.ok(trimmed.length >= rate && trimmed.length <= rate + 2 * 1_600 + 400, `trimmed to ${trimmed.length}`);
    assert.equal(trimSilence(new Float32Array(rate).fill(0), rate).length, 0);
    assert.equal(tidyTranscript('  i buy the lantern from mara  '), 'I buy the lantern from mara.');
    assert.equal(tidyTranscript('Three shillings?'), 'Three shillings?');
    assert.equal(tidyTranscript(''), '');
});
