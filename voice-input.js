/**
 * InnerLore voice input: the player speaks instead of typing. The browser
 * records the microphone, this module turns the samples into the 16 kHz WAV
 * the local speech recognizer wants and decides when the speaker has
 * finished. Pure module: the recorder itself lives in index.js.
 */

export const TARGET_RATE = 16_000;

/** Linear resampling of mono float samples to `targetRate`. */
export function resample(samples, sourceRate, targetRate = TARGET_RATE) {
    const input = samples instanceof Float32Array ? samples : Float32Array.from(samples || []);
    if (!input.length || !sourceRate || sourceRate === targetRate) return input;
    const ratio = sourceRate / targetRate;
    const length = Math.max(1, Math.floor(input.length / ratio));
    const output = new Float32Array(length);
    for (let i = 0; i < length; i += 1) {
        const position = i * ratio;
        const index = Math.floor(position);
        const next = Math.min(input.length - 1, index + 1);
        const fraction = position - index;
        output[i] = input[index] * (1 - fraction) + input[next] * fraction;
    }
    return output;
}

/** Several recorded chunks as one array. */
export function concatChunks(chunks) {
    const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
    const output = new Float32Array(total);
    let offset = 0;
    for (const chunk of chunks) {
        output.set(chunk, offset);
        offset += chunk.length;
    }
    return output;
}

/** 16-bit PCM mono WAV bytes for float samples in -1..1. */
export function encodeWav(samples, sampleRate = TARGET_RATE) {
    const input = samples instanceof Float32Array ? samples : Float32Array.from(samples || []);
    const buffer = new ArrayBuffer(44 + input.length * 2);
    const view = new DataView(buffer);
    const write = (offset, text) => { for (let i = 0; i < text.length; i += 1) view.setUint8(offset + i, text.charCodeAt(i)); };
    write(0, 'RIFF');
    view.setUint32(4, 36 + input.length * 2, true);
    write(8, 'WAVE');
    write(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    write(36, 'data');
    view.setUint32(40, input.length * 2, true);
    let offset = 44;
    for (let i = 0; i < input.length; i += 1, offset += 2) {
        const clamped = Math.max(-1, Math.min(1, input[i]));
        view.setInt16(offset, clamped < 0 ? clamped * 0x8000 : clamped * 0x7FFF, true);
    }
    return new Uint8Array(buffer);
}

export function rms(samples) {
    if (!samples?.length) return 0;
    let sum = 0;
    for (let i = 0; i < samples.length; i += 1) sum += samples[i] * samples[i];
    return Math.sqrt(sum / samples.length);
}

/**
 * Decides when the speaker has finished: once speech has been heard, a
 * stretch of quiet this long ends the recording. The threshold adapts to the
 * room: it sits above the quietest level heard so far.
 */
export function createSilenceTracker({ silenceMs = 1_600, minimumSpeechMs = 300, maximumMs = 90_000, floor = 0.006 } = {}) {
    let noise = null;
    let speechMs = 0;
    let quietMs = 0;
    let totalMs = 0;
    let heardSpeech = false;
    return {
        /** Feed one chunk; returns 'speaking', 'quiet', or 'done' when the utterance ended. */
        feed(samples, sampleRate) {
            const ms = (samples.length / sampleRate) * 1_000;
            totalMs += ms;
            const level = rms(samples);
            noise = noise === null ? level : Math.min(noise * 1.02 + 0.0005, Math.max(noise * 0.995, Math.min(noise, level)));
            const threshold = Math.max(floor, noise * 3);
            const speaking = level > threshold;
            if (speaking) {
                speechMs += ms;
                quietMs = 0;
                if (speechMs >= minimumSpeechMs) heardSpeech = true;
            } else {
                quietMs += ms;
                if (!heardSpeech) speechMs = 0;
            }
            if (totalMs >= maximumMs) return 'done';
            if (heardSpeech && quietMs >= silenceMs) return 'done';
            return speaking ? 'speaking' : 'quiet';
        },
        get heardSpeech() { return heardSpeech; },
        get totalMs() { return totalMs; },
    };
}

/** Trim leading and trailing quiet so the recognizer gets the words only. */
export function trimSilence(samples, sampleRate, { floor = 0.006, padMs = 250 } = {}) {
    const window = Math.max(1, Math.floor(sampleRate / 50));
    let start = -1;
    let end = -1;
    for (let i = 0; i + window <= samples.length; i += window) {
        if (rms(samples.subarray(i, i + window)) > floor) { start = i; break; }
    }
    for (let i = samples.length; i - window >= 0; i -= window) {
        if (rms(samples.subarray(i - window, i)) > floor) { end = i; break; }
    }
    if (start < 0 || end <= start) return new Float32Array(0);
    const pad = Math.floor((padMs / 1_000) * sampleRate);
    return samples.subarray(Math.max(0, start - pad), Math.min(samples.length, end + pad));
}

/** Tidy a transcript for the message box. */
export function tidyTranscript(text) {
    let value = String(text || '').replace(/\s+/gu, ' ').trim();
    if (!value) return '';
    value = value.charAt(0).toLocaleUpperCase() + value.slice(1);
    if (!/[.!?…"”]$/u.test(value)) value += '.';
    return value;
}

/** Base64 of bytes, for the JSON body the plugin proxies. */
export function bytesToBase64(bytes) {
    if (typeof Buffer !== 'undefined') return Buffer.from(bytes).toString('base64');
    let binary = '';
    const step = 0x8000;
    for (let i = 0; i < bytes.length; i += step) binary += String.fromCharCode.apply(null, bytes.subarray(i, i + step));
    return btoa(binary);
}
