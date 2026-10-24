import assert from 'node:assert/strict';
import test from 'node:test';

import { TONE_EFFECTS, applyToneEffects, breath, drive, lowpass, pitchShift, timeStretch, tremor } from '../voice-fx.js';
import { TONE_NAMES } from '../speech.js';

const RATE = 16_000;
function tone(seconds, frequency, amplitude = 0.5) {
    const out = new Float32Array(Math.floor(seconds * RATE));
    for (let i = 0; i < out.length; i += 1) out[i] = amplitude * Math.sin((2 * Math.PI * frequency * i) / RATE);
    return out;
}
function pitchOf(samples) {
    // autocorrelation over 70..400 Hz
    let bestLag = 0;
    let best = -Infinity;
    for (let lag = Math.floor(RATE / 400); lag <= Math.floor(RATE / 70); lag += 1) {
        let sum = 0;
        for (let i = 0; i + lag < samples.length; i += 1) sum += samples[i] * samples[i + lag];
        if (sum > best) {
            best = sum;
            bestLag = lag;
        }
    }
    return RATE / bestLag;
}
function rms(samples) {
    let sum = 0;
    for (const value of samples) sum += value * value;
    return Math.sqrt(sum / samples.length);
}

test('pitch shift moves the pitch by the asked semitones and keeps the length', () => {
    const input = tone(1, 220);
    const up = pitchShift(input, RATE, 2);
    const down = pitchShift(input, RATE, -3);
    assert.equal(up.length, input.length);
    assert.ok(Math.abs(pitchOf(up.subarray(2000, 14000)) - 220 * 2 ** (2 / 12)) < 6, `up: ${pitchOf(up.subarray(2000, 14000))}`);
    assert.ok(Math.abs(pitchOf(down.subarray(2000, 14000)) - 220 * 2 ** (-3 / 12)) < 6, `down: ${pitchOf(down.subarray(2000, 14000))}`);
    assert.equal(pitchShift(input, RATE, 0), input, 'no shift returns the input');
    const longer = timeStretch(input, RATE, 1.25);
    assert.ok(Math.abs(longer.length - input.length * 1.25) < 4, 'stretch changes the length');
    assert.ok(Math.abs(pitchOf(longer.subarray(2000, 14000)) - 220) < 3, 'stretch keeps the pitch');
});

test('filters, breath, tremor and drive change the sound in the expected direction', () => {
    const bright = tone(0.5, 6_000, 0.5);
    assert.ok(rms(lowpass(bright, RATE, 1_000)) < rms(bright) * 0.4, 'a low-pass dulls a bright tone');
    const voice = tone(0.5, 200);
    const breathy = breath(voice, RATE, 0.8, 0.45);
    assert.notDeepEqual(Array.from(breathy.subarray(1000, 1010)), Array.from(voice.subarray(1000, 1010)));
    const silent = new Float32Array(RATE / 2);
    assert.equal(rms(breath(silent, RATE, 0.8)), 0, 'breath follows the voice: silence stays silent');
    const shaky = tremor(voice, RATE, 0.5, 6);
    assert.ok(rms(shaky) < rms(voice) && rms(shaky) > rms(voice) * 0.6);
    const edged = drive(voice, 0.4);
    assert.ok(Math.max(...edged) <= 1 && rms(edged) > rms(voice), 'drive raises the body without clipping past 1');
});

test('every tone the narrator may use has an effect entry, and effects keep loudness', () => {
    for (const name of TONE_NAMES) assert.ok(TONE_EFFECTS[name], `missing effect for ${name}`);
    const voice = tone(1, 200);
    const sad = applyToneEffects(voice, RATE, 'sad');
    assert.ok(Math.abs(Math.max(...sad) - 0.5) < 0.08, 'peak loudness stays where it was');
    assert.ok(Math.abs(pitchOf(sad.subarray(2000, 14000)) - 200) < 2, 'the pitch is never moved');
    assert.equal(applyToneEffects(voice, RATE, 'neutral'), voice, 'a neutral tone changes nothing');
    assert.equal(applyToneEffects(voice, RATE, 'sad', 0), voice, 'strength 0 changes nothing');
    const lust = applyToneEffects(voice, RATE, 'lust');
    assert.ok(Math.abs(pitchOf(lust.subarray(2000, 14000)) - 200) < 2 && lust.length === voice.length);
    for (const [name, effect] of Object.entries(TONE_EFFECTS)) assert.equal(effect.pitch || 0, 0, `${name} keeps the voice's identity`);
});
