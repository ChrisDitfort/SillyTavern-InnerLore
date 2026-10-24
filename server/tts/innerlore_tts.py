#!/usr/bin/env python3
"""
InnerLore voice server: local text-to-speech for the Fold through sherpa-onnx.

Runs Supertonic 3 (default), Kokoro or Kitten entirely on the phone's CPU and
serves WAV audio to the InnerLore extension (through SillyTavern's
innerlore-storage plugin, or directly with CORS):

  GET  /health            -> {"ok": true, "engine": ..., "voices": [...], "sample_rate": ...}
  GET  /voices            -> the same voice list
  POST /speak             -> audio/wav; body {"text": "...", "voice": "<id>", "speed": 1.0,
                             "tone": "firm", "kind": "speech", "quick": false, "takes": 1, "steps": 8, "silence": 1.5}
  POST /transcribe        -> {"ok": true, "text": "..."}; body = WAV bytes (audio/wav) or
                             {"audio": "<base64 wav>"}; speech-to-text on the phone too

One synthesis at a time (the model is not thread-safe and the phone has four
usable cores); requests queue. Environment:

  INNERLORE_TTS_MODELS   directory holding the model packs (default ~/.innerlore-tts/models)
  INNERLORE_TTS_ENGINE   supertonic | kokoro | kitten (default supertonic)
  INNERLORE_TTS_PORT     default 8778
  INNERLORE_TTS_THREADS  default 2 (the two big cores; more only adds the slow cores)
  INNERLORE_STT          parakeet | moonshine | off (default parakeet: NeMo Parakeet TDT-CTC 110M int8)
  INNERLORE_TTS_TAKES    takes drawn for a lively tone, 1-3 (default 1: measured, a second draw adds
                         almost no intonation (spread +0.02) for double the synthesis time)

Supertonic draws fresh noise for every clip (no seed is exposed), so the same
voice can come out a fifth higher on one short line and sound like someone
else. Pitch anchoring: every clip's pitch is measured against the voice's own
(the pack's measured pitch, then a running average of what that voice read);
a clip too far from it is drawn again (up to three draws) and the closest one
is kept. With takes >= 2, a lively tone (excited, angry, afraid...) draws
that many takes and keeps the one with the wider intonation; a flat tone
(sad, cold, tired...) keeps the narrower one.
"""

import base64
import io
import json
import os
import sys
import threading
import time
import wave
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import numpy as np
import sherpa_onnx

MODELS = Path(os.environ.get('INNERLORE_TTS_MODELS') or Path.home() / '.innerlore-tts' / 'models')
ENGINE = (os.environ.get('INNERLORE_TTS_ENGINE') or 'supertonic').lower()
PORT = int(os.environ.get('INNERLORE_TTS_PORT') or 8778)
THREADS = int(os.environ.get('INNERLORE_TTS_THREADS') or 2)
STT = (os.environ.get('INNERLORE_STT') or 'parakeet').lower()
# Supertonic generation: flow-matching steps (quality, cost) and the silence
# scale at punctuation (pause length). Requests may override both.
STEPS = int(os.environ.get('INNERLORE_TTS_STEPS') or 0)
SILENCE = float(os.environ.get('INNERLORE_TTS_SILENCE') or 0)
TAKES = min(3, max(1, int(os.environ.get('INNERLORE_TTS_TAKES') or 1)))
MAX_TEXT = 1_200
# Pitch anchoring: the target pitch relative to the voice's own, the allowed
# deviation (natural log), and whether the tone wants a lively intonation
# (True), a flat one (False) or does not care (None). Clips longer than this
# average out on their own and are never redrawn.
# Only short lines are redrawn: a short clip already synthesizes at 0.8-0.95x
# real time on the Fold, so even one redraw puts the player behind. Narration
# (steady narrator voice, long runs) is never redrawn, nor is anything while
# another request waits, nor a clip the client marks quick (the first of a
# stream, which must start at once).
ANCHOR_MAX_CHARS = 110
ANCHOR_DRAWS = 2
TONE_PITCH = {
    'excited': (1.06, 0.16, True), 'surprised': (1.08, 0.18, True), 'shout': (1.08, 0.2, True), 'loud': (1.05, 0.16, True),
    'angry': (1.04, 0.16, True), 'afraid': (1.05, 0.16, True), 'urgent': (1.04, 0.14, True), 'pleading': (1.04, 0.14, True),
    'pain': (1.05, 0.18, True), 'happy': (1.03, 0.14, True), 'amused': (1.02, 0.14, True), 'curious': (1.02, 0.14, True),
    'question': (1.02, 0.14, True), 'mocking': (1.0, 0.14, True), 'tense': (1.03, 0.14, None),
    'sad': (0.96, 0.12, False), 'tired': (0.96, 0.12, False), 'bored': (0.96, 0.12, False), 'cold': (0.97, 0.1, False),
    'firm': (0.98, 0.1, False), 'wary': (0.98, 0.12, False), 'sly': (0.97, 0.12, False), 'whisper': (0.97, 0.12, False),
    'quiet': (0.97, 0.12, False), 'lust': (0.95, 0.12, False), 'aroused': (0.97, 0.12, None), 'tender': (0.98, 0.12, None),
    'dreamy': (0.97, 0.12, None), 'drunk': (0.97, 0.14, None), 'hesitant': (1.0, 0.12, None), 'disgusted': (0.98, 0.12, None),
}
LIVELY_CV, FLAT_CV = 0.26, 0.16
MAX_AUDIO_BYTES = 12 * 1024 * 1024

# Voice labels per engine. Supertonic's pack carries ten styles with no
# names; the genders and pitches below were measured from each voice. Kokoro's
# and Kitten's packs name their voices in the order the pack lists them.
SUPERTONIC_VOICES = [
    {'id': 's0', 'sid': 0, 'name': 'Female 1 (bright)', 'gender': 'female', 'pitch': 186},
    {'id': 's1', 'sid': 1, 'name': 'Female 2 (mid)', 'gender': 'female', 'pitch': 181},
    {'id': 's2', 'sid': 2, 'name': 'Female 3 (low)', 'gender': 'female', 'pitch': 165},
    {'id': 's3', 'sid': 3, 'name': 'Female 4 (brightest)', 'gender': 'female', 'pitch': 193},
    {'id': 's4', 'sid': 4, 'name': 'Female 5 (lowest)', 'gender': 'female', 'pitch': 162},
    {'id': 's5', 'sid': 5, 'name': 'Male 1 (light)', 'gender': 'male', 'pitch': 132},
    {'id': 's6', 'sid': 6, 'name': 'Male 2 (deepest)', 'gender': 'male', 'pitch': 85},
    {'id': 's7', 'sid': 7, 'name': 'Male 3 (deep)', 'gender': 'male', 'pitch': 98},
    {'id': 's8', 'sid': 8, 'name': 'Male 4 (mid)', 'gender': 'male', 'pitch': 120},
    {'id': 's9', 'sid': 9, 'name': 'Male 5 (deep)', 'gender': 'male', 'pitch': 89},
]


def find_pack(prefixes):
    if not MODELS.is_dir():
        return None
    for entry in sorted(MODELS.iterdir()):
        if entry.is_dir() and any(entry.name.startswith(prefix) for prefix in prefixes):
            return entry
    return None


def kokoro_voice_names(pack):
    # The pack's README lists voice names in speaker-id order.
    names = []
    readme = pack / 'README.md'
    if readme.exists():
        for line in readme.read_text(errors='ignore').splitlines():
            parts = line.split('|')
            if len(parts) >= 3 and parts[1].strip().isdigit():
                names.append(parts[2].strip())
    return names


def load_engine():
    model = sherpa_onnx.OfflineTtsModelConfig(num_threads=THREADS, provider='cpu')
    voices = []
    if ENGINE == 'supertonic':
        pack = find_pack(['sherpa-onnx-supertonic'])
        if not pack:
            raise SystemExit(f'No Supertonic pack under {MODELS}')
        def file(stem):
            for candidate in (f'{stem}.int8.onnx', f'{stem}.onnx'):
                if (pack / candidate).exists():
                    return str(pack / candidate)
            raise SystemExit(f'{pack} lacks {stem}')
        # build_voices.py blends the ten styles into thirty voices; use them when present.
        extended = pack / 'voice-extended.bin'
        listing = pack / 'voices.json'
        voice_file = extended if extended.exists() and listing.exists() else pack / 'voice.bin'
        model.supertonic = sherpa_onnx.OfflineTtsSupertonicModelConfig(
            duration_predictor=file('duration_predictor'), text_encoder=file('text_encoder'),
            vector_estimator=file('vector_estimator'), vocoder=file('vocoder'),
            tts_json=str(pack / 'tts.json'), unicode_indexer=str(pack / 'unicode_indexer.bin'),
            voice_style=str(voice_file))
        if voice_file == extended:
            voices = [{'id': v['id'], 'sid': v['sid'], 'name': v['name'], 'gender': v['gender'], 'pitch': v.get('pitch', 0), 'blend': v.get('blend'),
                       **({'noisy': True, 'lowpass': v['lowpass']} if v.get('lowpass') else {}),
                       **({'spread': v['spread']} if v.get('spread') is not None else {}),
                       **({'unstable': True} if v.get('unstable') else {})}
                      for v in json.loads(listing.read_text())['voices']]
        else:
            voices = list(SUPERTONIC_VOICES)
    elif ENGINE == 'kokoro':
        pack = find_pack(['kokoro'])
        if not pack:
            raise SystemExit(f'No Kokoro pack under {MODELS}')
        onnx = pack / 'model.int8.onnx' if (pack / 'model.int8.onnx').exists() else pack / 'model.onnx'
        lexicons = ','.join(str(entry) for entry in sorted(pack.glob('lexicon*.txt')))
        model.kokoro = sherpa_onnx.OfflineTtsKokoroModelConfig(
            model=str(onnx), voices=str(pack / 'voices.bin'), tokens=str(pack / 'tokens.txt'),
            data_dir=str(pack / 'espeak-ng-data'), dict_dir=str(pack / 'dict') if (pack / 'dict').is_dir() else '',
            lexicon=lexicons, lang='en-us')
        names = kokoro_voice_names(pack)
        voices = [{'id': f'k{i}', 'sid': i, 'name': name, 'gender': 'female' if name[1:2] == 'f' else 'male' if name[1:2] == 'm' else ''}
                  for i, name in enumerate(names)]
    elif ENGINE == 'kitten':
        pack = find_pack(['kitten'])
        if not pack:
            raise SystemExit(f'No Kitten pack under {MODELS}')
        onnx = pack / 'model.int8.onnx' if (pack / 'model.int8.onnx').exists() else pack / 'model.onnx'
        model.kitten = sherpa_onnx.OfflineTtsKittenModelConfig(
            model=str(onnx), voices=str(pack / 'voices.bin'), tokens=str(pack / 'tokens.txt'), data_dir=str(pack / 'espeak-ng-data'))
        voices = []
    else:
        raise SystemExit(f'Unknown engine {ENGINE}')
    tts = sherpa_onnx.OfflineTts(sherpa_onnx.OfflineTtsConfig(model=model))
    if not voices or len(voices) != tts.num_speakers:
        prefix = ENGINE[0]
        voices = [{'id': f'{prefix}{i}', 'sid': i, 'name': f'Voice {i + 1}', 'gender': ''} for i in range(tts.num_speakers)] \
            if not voices else voices[:tts.num_speakers]
    return tts, voices


def load_recognizer():
    """The speech-to-text model for voice input; None when off or no pack is present."""
    if STT == 'off':
        return None
    if STT == 'parakeet':
        pack = find_pack(['sherpa-onnx-nemo-parakeet'])
        if not pack:
            print('[innerlore-tts] no Parakeet pack; voice input off', flush=True)
            return None
        model = next((entry for entry in sorted(pack.iterdir()) if entry.suffix == '.onnx'), None)
        return sherpa_onnx.OfflineRecognizer.from_nemo_ctc(model=str(model), tokens=str(pack / 'tokens.txt'), num_threads=THREADS)
    pack = find_pack(['sherpa-onnx-moonshine'])
    if not pack:
        print('[innerlore-tts] no Moonshine pack; voice input off', flush=True)
        return None
    def part(prefix):
        names = sorted(entry for entry in os.listdir(pack) if entry.startswith(prefix) and entry.endswith('.onnx'))
        return str(pack / names[0]) if names else ''
    return sherpa_onnx.OfflineRecognizer.from_moonshine(
        preprocessor=part('preprocess'), encoder=part('encode'), uncached_decoder=part('uncached_decode'),
        cached_decoder=part('cached_decode'), tokens=str(pack / 'tokens.txt'), num_threads=THREADS)


def read_wav(data):
    with wave.open(io.BytesIO(data), 'rb') as wav:
        rate = wav.getframerate()
        channels = wav.getnchannels()
        width = wav.getsampwidth()
        frames = wav.readframes(wav.getnframes())
    if width == 2:
        samples = np.frombuffer(frames, dtype='<i2').astype(np.float32) / 32768.0
    elif width == 4:
        samples = np.frombuffer(frames, dtype='<i4').astype(np.float32) / 2147483648.0
    elif width == 1:
        samples = (np.frombuffer(frames, dtype=np.uint8).astype(np.float32) - 128.0) / 128.0
    else:
        raise ValueError(f'unsupported sample width {width}')
    if channels > 1:
        samples = samples.reshape(-1, channels).mean(axis=1)
    return rate, samples


def lowpass(samples, sample_rate, cutoff, passes=2):
    """A gentle de-hiss for voices that carry noise above the voice band: a
    cascaded biquad low-pass (about 24 dB per octave above cutoff)."""
    import math
    x = np.asarray(samples, dtype=np.float64)
    w = 2 * math.pi * cutoff / sample_rate
    alpha = math.sin(w) / (2 * 0.7071)
    c = math.cos(w)
    a0 = 1 + alpha
    b = np.array([(1 - c) / 2, 1 - c, (1 - c) / 2]) / a0
    a = np.array([-2 * c, 1 - alpha]) / a0
    for _ in range(passes):
        y = np.zeros_like(x)
        x1 = x2 = y1 = y2 = 0.0
        for i in range(len(x)):
            y0 = b[0] * x[i] + b[1] * x1 + b[2] * x2 - a[0] * y1 - a[1] * y2
            x2, x1, y2, y1 = x1, x[i], y1, y0
            y[i] = y0
        x = y
    return x.astype(np.float32)


def pitch_stats(samples, rate):
    """Median pitch (Hz) and its spread (std / median) over the voiced frames of a clip."""
    x = np.asarray(samples, dtype=np.float32)
    frame, hop = int(rate * 0.04), int(rate * 0.02)
    if len(x) <= frame:
        return 0.0, 0.0
    lo, hi = int(rate / 420), int(rate / 70)
    window = np.hanning(frame).astype(np.float32)
    found = []
    frames = np.lib.stride_tricks.sliding_window_view(x, frame)[::hop]
    energy = np.sqrt(np.mean(frames ** 2, axis=1))
    loud = frames[energy >= max(0.02, float(energy.max()) * 0.15)]
    if not len(loud):
        return 0.0, 0.0
    loud = (loud - loud.mean(axis=1, keepdims=True)) * window
    spectrum = np.fft.rfft(loud, n=2 * frame, axis=1)
    ac = np.fft.irfft(np.abs(spectrum) ** 2, axis=1)[:, :frame]
    for row in ac:
        if row[0] <= 0:
            continue
        k = int(np.argmax(row[lo:hi])) + lo
        if row[k] / row[0] > 0.4:
            found.append(rate / k)
    if len(found) < 3:
        return 0.0, 0.0
    f0 = np.array(found)
    median = float(np.median(f0))
    return median, float(np.std(f0) / median) if median else 0.0


def to_wav(samples, sample_rate):
    pcm = np.clip(np.asarray(samples, dtype=np.float32), -1.0, 1.0)
    data = (pcm * 32767).astype('<i2').tobytes()
    buffer = io.BytesIO()
    with wave.open(buffer, 'wb') as out:
        out.setnchannels(1)
        out.setsampwidth(2)
        out.setframerate(sample_rate)
        out.writeframes(data)
    return buffer.getvalue()


class Server:
    def __init__(self):
        started = time.time()
        self.tts, self.voices = load_engine()
        self.by_id = {voice['id']: voice for voice in self.voices}
        self.lock = threading.Lock()
        self.spoken = 0
        self.redrawn = 0
        self.waiting = 0
        # What each voice actually reads at: the pack's measured pitch, then a
        # running average of the clips kept for it.
        self.anchor = {voice['id']: float(voice['pitch']) for voice in self.voices if voice.get('pitch')}
        self.heard = 0
        print(f'[innerlore-tts] {ENGINE}: {len(self.voices)} voices at {self.tts.sample_rate} Hz, loaded in {time.time() - started:.1f}s, {THREADS} threads', flush=True)
        started = time.time()
        try:
            self.recognizer = load_recognizer()
        except Exception as error:  # noqa: BLE001
            print(f'[innerlore-tts] speech recognizer failed to load: {error}', flush=True)
            self.recognizer = None
        if self.recognizer:
            print(f'[innerlore-tts] voice input: {STT} loaded in {time.time() - started:.1f}s', flush=True)

    def transcribe(self, wav_bytes):
        if not self.recognizer:
            raise RuntimeError('voice input is off: no speech model loaded')
        rate, samples = read_wav(wav_bytes)
        if not len(samples):
            return ''
        with self.lock:
            started = time.time()
            stream = self.recognizer.create_stream()
            stream.accept_waveform(rate, samples)
            self.recognizer.decode_stream(stream)
            text = stream.result.text.strip()
            self.heard += 1
            print(f'[innerlore-tts] heard {len(samples) / rate:.1f}s -> {len(text)} chars in {time.time() - started:.1f}s', flush=True)
        return text

    def speak(self, text, voice_id, speed, steps=None, silence=None, tone='', takes=None, kind='', quick=False):
        voice = self.by_id.get(str(voice_id)) or self.voices[0]
        speed = min(1.6, max(0.6, float(speed or 1.0)))
        config = sherpa_onnx.GenerationConfig()
        config.sid = voice['sid']
        config.speed = speed
        steps = int(steps or STEPS or 0)
        silence = float(silence or SILENCE or 0)
        if steps > 0 and hasattr(config, 'num_steps'):
            config.num_steps = min(50, max(1, steps))
        if silence > 0 and hasattr(config, 'silence_scale'):
            config.silence_scale = min(5.0, max(0.1, silence))
        tone = str(tone or '').strip().lower()
        center, tolerance, lively = TONE_PITCH.get(tone, (1.0, 0.12, None))
        takes = min(3, max(1, int(takes or TAKES)))
        anchor = self.anchor.get(voice['id'])
        anchored = bool(anchor) and len(text) <= ANCHOR_MAX_CHARS and str(kind or 'speech') != 'narration' and not quick
        wanted = takes if (lively is True and anchored) else 1
        self.waiting += 1
        with self.lock:
            self.waiting -= 1
            started = time.time()
            draws = []
            while len(draws) < max(ANCHOR_DRAWS, wanted):
                audio = self.tts.generate(text, config)
                if not anchored:
                    draws.append((0.0, 0.0, 0.0, audio))
                    break
                f0, spread = pitch_stats(audio.samples, audio.sample_rate)
                score = abs(np.log(f0 / (anchor * center))) if f0 else 0.0
                if lively is True:
                    score += 0.4 * max(0.0, LIVELY_CV - spread)
                elif lively is False:
                    score += 0.4 * max(0.0, spread - FLAT_CV)
                draws.append((score, f0, spread, audio))
                best = min(draws, key=lambda draw: draw[0])
                if len(draws) >= wanted and (not best[1] or abs(np.log(best[1] / (anchor * center))) <= tolerance):
                    break
                if self.waiting and len(draws) >= wanted:
                    break  # someone is queued behind this clip: keep the player fed
            score, f0, spread, audio = min(draws, key=lambda draw: draw[0])
            samples = audio.samples
            # The anchor follows what the voice reads at, but only clips that landed
            # near it: an outlier kept for want of a better draw must not drag it along.
            if anchored and f0 and len(samples) >= 2 * audio.sample_rate and abs(np.log(f0 / (anchor * center))) <= tolerance:
                self.anchor[voice['id']] = anchor * 0.85 + (f0 / center) * 0.15
            if voice.get('lowpass'):
                samples = lowpass(samples, audio.sample_rate, float(voice['lowpass']))
            seconds = len(samples) / audio.sample_rate
            self.spoken += 1
            self.redrawn += max(0, len(draws) - 1)
            detail = ''
            if anchored:
                others = ' '.join(f'{draw[1]:.0f}' for draw in draws if draw is not min(draws, key=lambda d: d[0]))
                detail = f' {tone or "plain"} f0 {f0:.0f}Hz (anchor {anchor:.0f}, spread {spread:.2f})' + (f' kept of {len(draws)} draws [{others}]' if len(draws) > 1 else '')
            print(f'[innerlore-tts] {voice["id"]} {len(text)} chars -> {seconds:.1f}s audio in {time.time() - started:.1f}s{detail}', flush=True)
        return to_wav(samples, audio.sample_rate), audio.sample_rate


SERVER = None


class Handler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):  # quiet
        pass

    def _headers(self, status, content_type, length):
        self.send_response(status)
        self.send_header('Content-Type', content_type)
        self.send_header('Content-Length', str(length))
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.end_headers()

    def _json(self, status, payload):
        body = json.dumps(payload).encode()
        self._headers(status, 'application/json', len(body))
        self.wfile.write(body)

    def do_OPTIONS(self):
        self._headers(204, 'text/plain', 0)

    def do_GET(self):
        if self.path.split('?')[0] in ('/health', '/voices', '/'):
            return self._json(200, {'ok': True, 'engine': ENGINE, 'voices': SERVER.voices, 'sample_rate': SERVER.tts.sample_rate, 'spoken': SERVER.spoken,
                                    'stt': STT if SERVER.recognizer else '', 'heard': SERVER.heard, 'steps': STEPS, 'silence': SILENCE,
                                    'takes': TAKES, 'redrawn': SERVER.redrawn, 'anchors': {k: round(v) for k, v in SERVER.anchor.items()}})
        self._json(404, {'ok': False, 'error': 'not found'})

    def do_POST(self):
        route = self.path.split('?')[0]
        if route == '/transcribe':
            return self._transcribe()
        if route != '/speak':
            return self._json(404, {'ok': False, 'error': 'not found'})
        try:
            length = int(self.headers.get('Content-Length') or 0)
            payload = json.loads(self.rfile.read(length) or b'{}')
            text = str(payload.get('text') or '').strip()[:MAX_TEXT]
            if not text:
                return self._json(400, {'ok': False, 'error': 'text is empty'})
            wav, _ = SERVER.speak(text, payload.get('voice'), payload.get('speed'), payload.get('steps'), payload.get('silence'),
                                  payload.get('tone'), payload.get('takes'), payload.get('kind'), bool(payload.get('quick')))
            self._headers(200, 'audio/wav', len(wav))
            self.wfile.write(wav)
        except Exception as error:  # noqa: BLE001
            print(f'[innerlore-tts] error: {error}', flush=True)
            self._json(500, {'ok': False, 'error': str(error)})


def _transcribe_impl(self):
    try:
        length = int(self.headers.get('Content-Length') or 0)
        if length > MAX_AUDIO_BYTES:
            return self._json(413, {'ok': False, 'error': 'audio too large'})
        body = self.rfile.read(length)
        content_type = (self.headers.get('Content-Type') or '').lower()
        if 'json' in content_type:
            payload = json.loads(body or b'{}')
            body = base64.b64decode(str(payload.get('audio') or ''))
        if not body:
            return self._json(400, {'ok': False, 'error': 'no audio'})
        text = SERVER.transcribe(body)
        return self._json(200, {'ok': True, 'text': text})
    except Exception as error:  # noqa: BLE001
        print(f'[innerlore-tts] transcribe error: {error}', flush=True)
        return self._json(500, {'ok': False, 'error': str(error)})


Handler._transcribe = _transcribe_impl


def main():
    global SERVER
    SERVER = Server()
    httpd = ThreadingHTTPServer(('127.0.0.1', PORT), Handler)
    print(f'[innerlore-tts] listening on http://127.0.0.1:{PORT}', flush=True)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == '__main__':
    main()
