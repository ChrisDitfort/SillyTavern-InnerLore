/**
 * InnerLore voice effects: emotional colouring applied to a synthesized clip
 * in the browser. The voice model has no emotion control, so each tone
 * shapes the delivery after synthesis: pitch, breathiness, tremor,
 * brightness and drive, on top of the speed, loudness and pause the server
 * and scheduler already apply. Pure module: Float32Array in, Float32Array out.
 */

/**
 * What each tone does to the sound. pitch in semitones; breath 0..1 adds
 * envelope-shaped noise (a whisper is mostly breath); tremor is a slow
 * wobble of loudness (depth 0..1 at hz); lowpass in Hz dulls the voice;
 * drive 0..1 adds a little edge; mix below 1 thins the voice itself.
 */
export const TONE_EFFECTS = Object.freeze({
    // No pitch shifting: even a half semitone reads as processing, not as a
    // mood. The voice is left intact; only breath, tremor, a little dulling
    // and edge remain, and most of each mood comes from pace, loudness,
    // pauses and punctuation (TONES and toneText in speech.js).
    neutral: {},
    plain: {},
    question: {},
    warm: {},
    tender: {},
    sad: { lowpass: 7500 },
    tired: { lowpass: 7500 },
    bored: {},
    dreamy: {},
    hesitant: { tremor: 0.04, hz: 5 },
    quiet: {},
    whisper: { breath: 0.5, mix: 0.6, lowpass: 8000 },
    afraid: { tremor: 0.12, hz: 6.5 },
    tense: { tremor: 0.05, hz: 5.5 },
    urgent: {},
    angry: { drive: 0.1 },
    shout: { drive: 0.16 },
    loud: { drive: 0.08 },
    excited: {},
    happy: {},
    amused: {},
    mocking: {},
    sly: {},
    cold: {},
    wary: {},
    curious: {},
    pleading: { tremor: 0.08, hz: 5.5 },
    firm: { drive: 0.04 },
    surprised: {},
    pain: { tremor: 0.14, hz: 7, drive: 0.06 },
    disgusted: {},
    aroused: { breath: 0.08 },
    lust: { breath: 0.1 },
    drunk: { lowpass: 7500, tremor: 0.06, hz: 3 },
});

function hann(length) {
    const window = new Float32Array(length);
    for (let i = 0; i < length; i += 1) window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / length);
    return window;
}

/**
 * Pitch shift that keeps the length: the clip is time-stretched by the
 * ratio with WSOLA (each 40 ms grain is placed where it best continues the
 * previous one, so grains do not fight), then read back at the ratio.
 */
export function pitchShift(samples, rate, semitones) {
    if (!samples?.length || !Number.isFinite(semitones) || Math.abs(semitones) < 0.05) return samples;
    const ratio = 2 ** (semitones / 12);
    const stretched = timeStretch(samples, rate, ratio);
    const out = new Float32Array(samples.length);
    for (let i = 0; i < out.length; i += 1) {
        const source = i * ratio;
        const index = Math.floor(source);
        if (index + 1 >= stretched.length) break;
        const fraction = source - index;
        out[i] = stretched[index] * (1 - fraction) + stretched[index + 1] * fraction;
    }
    return out;
}

/** WSOLA time stretch: `factor` > 1 makes the clip longer at the same pitch. */
export function timeStretch(samples, rate, factor) {
    if (!samples?.length || !Number.isFinite(factor) || Math.abs(factor - 1) < 0.002) return samples;
    const grain = Math.max(128, Math.round(rate * 0.04));
    const hopOut = Math.floor(grain / 2);
    const hopIn = hopOut / factor;
    const search = Math.floor(rate * 0.008);
    const window = hann(grain);
    const length = Math.floor(samples.length * factor) + grain;
    const out = new Float32Array(length);
    let previous = 0;
    for (let frame = 0, position = 0; position + grain <= length; frame += 1, position += hopOut) {
        const nominal = Math.round(frame * hopIn);
        if (nominal + grain >= samples.length) break;
        let best = nominal;
        if (frame > 0) {
            // The natural continuation of the last grain is hopOut further on; find the
            // candidate near the nominal position that matches it best.
            const target = previous + hopOut;
            let bestScore = -Infinity;
            const low = Math.max(0, nominal - search);
            const high = Math.min(samples.length - grain - 1, nominal + search);
            for (let candidate = low; candidate <= high; candidate += 2) {
                let score = 0;
                for (let i = 0; i < grain; i += 8) {
                    const t = target + i;
                    if (t >= samples.length) break;
                    score += samples[candidate + i] * samples[t];
                }
                if (score > bestScore) {
                    bestScore = score;
                    best = candidate;
                }
            }
        }
        for (let i = 0; i < grain; i += 1) out[position + i] += samples[best + i] * window[i];
        previous = best;
    }
    return out.subarray(0, Math.floor(samples.length * factor));
}

/** One-pole low-pass: dulls the voice above `cutoff` Hz. */
export function lowpass(samples, rate, cutoff) {
    if (!samples?.length || !cutoff || cutoff >= rate / 2) return samples;
    const alpha = 1 - Math.exp((-2 * Math.PI * cutoff) / rate);
    const out = new Float32Array(samples.length);
    let state = 0;
    for (let i = 0; i < samples.length; i += 1) {
        state += alpha * (samples[i] - state);
        out[i] = state;
    }
    return out;
}

/** Breath: noise shaped by the voice's own loudness, high-passed so it sits above the voice. */
export function breath(samples, rate, amount, mix = 1) {
    if (!samples?.length || !amount) return samples;
    const out = new Float32Array(samples.length);
    const follow = 1 - Math.exp(-1 / (rate * 0.008));
    const hp = 1 - Math.exp((-2 * Math.PI * 1_800) / rate);
    let envelope = 0;
    let lowState = 0;
    let seed = 0x9E3779B9;
    const random = () => {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        return seed / 4294967296 - 0.5;
    };
    for (let i = 0; i < samples.length; i += 1) {
        const level = Math.abs(samples[i]);
        envelope += follow * (level - envelope);
        const noise = random();
        lowState += hp * (noise - lowState);
        const hissy = noise - lowState;
        out[i] = samples[i] * mix + hissy * envelope * amount * 2.2;
    }
    return out;
}

/** Tremor: a slow wobble of loudness, the shake in a frightened or pleading voice. */
export function tremor(samples, rate, depth, hz = 6) {
    if (!samples?.length || !depth) return samples;
    const out = new Float32Array(samples.length);
    const step = (2 * Math.PI * hz) / rate;
    for (let i = 0; i < samples.length; i += 1) out[i] = samples[i] * (1 - depth * (0.5 - 0.5 * Math.cos(step * i)));
    return out;
}

/** Drive: a soft clip that gives a raised or angry voice an edge. */
export function drive(samples, amount) {
    if (!samples?.length || !amount) return samples;
    const k = 1 + amount * 6;
    const norm = Math.tanh(k);
    const out = new Float32Array(samples.length);
    for (let i = 0; i < samples.length; i += 1) out[i] = Math.tanh(samples[i] * k) / norm;
    return out;
}

function peak(samples) {
    let max = 0;
    for (let i = 0; i < samples.length; i += 1) max = Math.max(max, Math.abs(samples[i]));
    return max;
}

/** The effect a tone name stands for, or none. */
export function effectForTone(tone) {
    return TONE_EFFECTS[String(tone || '').toLocaleLowerCase()] || {};
}

/** A clip coloured by a tone. Returns the same array when the tone changes nothing. */
export function applyToneEffects(samples, rate, tone, strength = 1) {
    const effect = typeof tone === 'string' ? effectForTone(tone) : (tone || {});
    const amount = Math.min(1.5, Math.max(0, Number(strength) || 0));
    if (!samples?.length || !amount || !Object.keys(effect).length) return samples;
    const before = peak(samples);
    let out = samples;
    if (effect.pitch) out = pitchShift(out, rate, effect.pitch * amount);
    if (effect.lowpass) out = lowpass(out, rate, effect.lowpass + (1 - Math.min(1, amount)) * (rate / 2 - effect.lowpass));
    if (effect.breath) out = breath(out, rate, effect.breath * amount, effect.mix ?? 1);
    if (effect.tremor) out = tremor(out, rate, effect.tremor * amount, effect.hz || 6);
    if (effect.drive) out = drive(out, effect.drive * amount);
    // Keep the clip's loudness where it was; the tone's gain is applied by the player.
    const after = peak(out);
    if (after > 0 && before > 0) {
        const scale = Math.min(2, before / after);
        if (Math.abs(scale - 1) > 0.02) {
            const scaled = new Float32Array(out.length);
            for (let i = 0; i < out.length; i += 1) scaled[i] = out[i] * scale;
            out = scaled;
        }
    }
    return out;
}
