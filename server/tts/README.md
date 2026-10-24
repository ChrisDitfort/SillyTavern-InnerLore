# InnerLore voice server

Local text-to-speech for InnerLore's voice narration, running on the phone
itself through [sherpa-onnx](https://github.com/k2-fsa/sherpa-onnx). The
extension sends each narration or speech segment here (through SillyTavern's
`innerlore-storage` plugin at `/api/plugins/innerlore-storage/v1/tts/...`) and
plays the WAV that comes back.

## Setup (Ubuntu proot on the Fold, Python 3.14)

```sh
mkdir -p ~/.innerlore-tts/models && cd ~/.innerlore-tts
uv venv --python /usr/bin/python3 venv && uv pip install --python venv/bin/python --link-mode=copy pip
venv/bin/python -m pip install --no-cache-dir sherpa-onnx numpy
cd models
curl -sL -O https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/sherpa-onnx-supertonic-3-tts-int8-2026-05-11.tar.bz2
tar xjf sherpa-onnx-supertonic-3-tts-int8-2026-05-11.tar.bz2 && rm *.tar.bz2
```

Run: `venv/bin/python <extension>/server/tts/innerlore_tts.py` (port 8778).
`run.sh` next to this file does that with the environment set, and the
SillyTavern start script launches it inside the proot.

Engines measured on the Fold 6 (4 usable cores, sentence of ~10 s audio):
Supertonic 3 int8 at 2 threads 0.35x real time (10 voices, 44.1 kHz);
Kitten nano int8 0.4-0.7x (8 voices); Kokoro int8 1.4-1.6x (54 voices,
too slow to keep up with playback). `INNERLORE_TTS_ENGINE=kokoro` switches
when a pack is present.

## Voice input (speech-to-text)

`POST /transcribe` takes a WAV body (any rate, 16-bit mono preferred) or
`{"audio": "<base64 wav>"}` and answers `{"ok": true, "text": "..."}` using
NeMo Parakeet TDT-CTC 110M int8 (English; a 5 s clip takes about 0.4 s on the
Fold). Download `sherpa-onnx-nemo-parakeet_tdt_ctc_110m-en-36000-int8.tar.bz2`
from the sherpa-onnx `asr-models` release into `~/.innerlore-tts/models`.
`INNERLORE_STT=off` disables it.
