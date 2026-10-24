#!/usr/bin/env python3
"""
Builds more voices for Supertonic by blending its style embeddings.

The pack's voice.bin holds ten voices (five female, five male) as style
vectors. Averaging two voices of the same gender gives a new, plausible voice
between them, so every pair becomes one more voice: 30 in all. Each blend is
checked by synthesizing a sentence, transcribing it back with the speech
recognizer, and measuring its pitch; blends that come out garbled are dropped.

Writes voice-extended.bin and voices.json next to voice.bin. The voice server
uses them when present.

  venv/bin/python build_voices.py [pack-dir]
"""

import itertools
import json
import os
import struct
import sys
import time
from pathlib import Path

import numpy as np
import sherpa_onnx

MODELS = Path(os.environ.get('INNERLORE_TTS_MODELS') or Path.home() / '.innerlore-tts' / 'models')
SENTENCE = 'The harbour was quiet that evening, and the lamps along the quay burned low.'
BASE = [
    ('Female 1 (bright)', 'female'), ('Female 2 (mid)', 'female'), ('Female 3 (low)', 'female'),
    ('Female 4 (brightest)', 'female'), ('Female 5 (lowest)', 'female'),
    ('Male 1 (light)', 'male'), ('Male 2 (deepest)', 'male'), ('Male 3 (deep)', 'male'),
    ('Male 4 (mid)', 'male'), ('Male 5 (deep)', 'male'),
]


def find(prefix):
    for entry in sorted(MODELS.iterdir()):
        if entry.is_dir() and entry.name.startswith(prefix):
            return entry
    return None


def pitch(samples, rate):
    x = np.asarray(samples, dtype=np.float32)
    frame, hop, found = int(rate * 0.04), int(rate * 0.02), []
    for i in range(0, len(x) - frame, hop):
        w = x[i:i + frame]
        if np.sqrt(np.mean(w ** 2)) < 0.02:
            continue
        w = w - w.mean()
        ac = np.correlate(w, w, 'full')[frame - 1:]
        lo, hi = int(rate / 400), int(rate / 70)
        seg = ac[lo:hi]
        if seg.size == 0 or ac[0] <= 0:
            continue
        k = int(np.argmax(seg)) + lo
        if ac[k] / ac[0] > 0.4:
            found.append(rate / k)
    return float(np.median(found)) if found else 0.0


def hiss(samples, rate):
    x = np.asarray(samples, dtype=np.float32)
    spec = np.abs(np.fft.rfft(x * np.hanning(len(x)))) ** 2
    freqs = np.fft.rfftfreq(len(x), 1 / rate)
    return float(spec[freqs > 8000].sum() / spec.sum() * 100)


def words(text):
    return [w for w in ''.join(c.lower() if c.isalnum() or c == ' ' else ' ' for c in text).split() if w]


def word_error(expected, actual):
    a, b = words(expected), words(actual)
    d = list(range(len(b) + 1))
    for i in range(1, len(a) + 1):
        prev, d[0] = d[0], i
        for j in range(1, len(b) + 1):
            cur = d[j]
            d[j] = min(d[j] + 1, d[j - 1] + 1, prev + (a[i - 1] != b[j - 1]))
            prev = cur
    return d[len(b)] / max(1, len(a))


def main():
    pack = Path(sys.argv[1]) if len(sys.argv) > 1 else find('sherpa-onnx-supertonic')
    if not pack:
        raise SystemExit('No Supertonic pack found')
    raw = (pack / 'voice.bin').read_bytes()
    n, a1, a2, _, b1, b2 = struct.unpack('<6q', raw[:48])
    data = np.frombuffer(raw[48:], dtype=np.float32)
    ttl = data[:n * a1 * a2].reshape(n, a1, a2)
    dp = data[n * a1 * a2:].reshape(n, b1, b2)
    voices = [{'id': f's{i}', 'name': name, 'gender': gender, 'blend': None} for i, (name, gender) in enumerate(BASE[:n])]
    ttl_out, dp_out = [ttl[i] for i in range(n)], [dp[i] for i in range(n)]
    for gender in ('female', 'male'):
        members = [i for i, voice in enumerate(voices[:n]) if voice['gender'] == gender]
        for a, b in itertools.combinations(members, 2):
            ttl_out.append((ttl[a] + ttl[b]) / 2)
            dp_out.append((dp[a] + dp[b]) / 2)
            voices.append({'id': f'b{a}{b}', 'name': '', 'gender': gender, 'blend': [a, b]})
    # Brighter, more feminine voices: the female styles pushed further from the
    # male centroid (k = 0.25 / 0.5). They stay intelligible and raise the pitch
    # by 10-50 Hz; the noise check below drops any that hiss.
    female = [i for i, voice in enumerate(voices[:n]) if voice['gender'] == 'female']
    male = [i for i, voice in enumerate(voices[:n]) if voice['gender'] == 'male']
    if female and male:
        fem_ttl, mal_ttl = ttl[female].mean(0), ttl[male].mean(0)
        fem_dp, mal_dp = dp[female].mean(0), dp[male].mean(0)
        for base in female[:3]:
            for k in (0.25, 0.5):
                ttl_out.append(ttl[base] + k * (fem_ttl - mal_ttl))
                dp_out.append(dp[base] + k * (fem_dp - mal_dp))
                voices.append({'id': f'x{base}{int(k * 100)}', 'name': '', 'gender': 'female', 'blend': [base, 'fem', k]})
    count = len(ttl_out)
    header = struct.pack('<6q', count, a1, a2, count, b1, b2)
    out = pack / 'voice-extended.bin'
    out.write_bytes(header + np.stack(ttl_out).astype(np.float32).tobytes() + np.stack(dp_out).astype(np.float32).tobytes())

    def model(stem):
        for candidate in (f'{stem}.int8.onnx', f'{stem}.onnx'):
            if (pack / candidate).exists():
                return str(pack / candidate)
        raise SystemExit(f'{pack} lacks {stem}')
    config = sherpa_onnx.OfflineTtsModelConfig(num_threads=2, provider='cpu')
    config.supertonic = sherpa_onnx.OfflineTtsSupertonicModelConfig(
        duration_predictor=model('duration_predictor'), text_encoder=model('text_encoder'), vector_estimator=model('vector_estimator'),
        vocoder=model('vocoder'), tts_json=str(pack / 'tts.json'), unicode_indexer=str(pack / 'unicode_indexer.bin'), voice_style=str(out))
    tts = sherpa_onnx.OfflineTts(sherpa_onnx.OfflineTtsConfig(model=config))
    asr_pack = find('sherpa-onnx-nemo-parakeet')
    recognizer = sherpa_onnx.OfflineRecognizer.from_nemo_ctc(model=str(next(asr_pack.glob('*.onnx'))), tokens=str(asr_pack / 'tokens.txt'), num_threads=2) if asr_pack else None
    kept = []
    for sid, voice in enumerate(voices):
        started = time.time()
        audio = tts.generate(SENTENCE, sid=sid, speed=1.0)
        f0 = pitch(audio.samples, audio.sample_rate)
        error = None
        if recognizer:
            stream = recognizer.create_stream()
            stream.accept_waveform(audio.sample_rate, np.asarray(audio.samples, dtype=np.float32))
            recognizer.decode_stream(stream)
            error = word_error(SENTENCE, stream.result.text)
        noise = hiss(audio.samples, audio.sample_rate)
        ok = f0 > 0 and (error is None or error <= 0.25) and (noise < 1.0 or sid < n)
        print(f"{voice['id']:>5} sid={sid:2d} f0={f0:5.0f} wer={'-' if error is None else f'{error:.2f}'} hiss={noise:.2f}% {'ok' if ok else 'DROPPED'} ({time.time() - started:.1f}s)", flush=True)
        if not ok:
            continue
        voice.update({'sid': sid, 'pitch': round(f0)})
        if noise >= 1.0:
            voice['lowpass'] = 6000
        kept.append(voice)
    # Blends are named by pitch within their gender.
    for gender in ('female', 'male'):
        blends = sorted((v for v in kept if v['blend'] and v['blend'][1] != 'fem'), key=lambda v: -v['pitch'] if gender == 'female' else v['pitch'])
        blends = [v for v in blends if v['gender'] == gender]
        for k, voice in enumerate(blends):
            voice['name'] = f"{'Female' if gender == 'female' else 'Male'} blend {k + 1} ({voice['pitch']} Hz)"
    bright = sorted((v for v in kept if v['blend'] and v['blend'][1] == 'fem'), key=lambda v: -v['pitch'])
    for k, voice in enumerate(bright):
        voice['name'] = f"Female bright {k + 1} ({voice['pitch']} Hz)"
    for voice in kept:
        if voice['id'] == 's2' or (voice['blend'] and 2 in voice['blend'][:2]):
            voice['lowpass'] = 6000
            if voice['id'] == 's2' and '(low)' in voice['name']:
                voice['name'] = voice['name'].replace('(low)', '(low, de-hissed)')
    (pack / 'voices.json').write_text(json.dumps({'sentence': SENTENCE, 'voices': kept}, indent=1))
    print(f'{len(kept)} voices -> {out.name}, voices.json', flush=True)


if __name__ == '__main__':
    main()
