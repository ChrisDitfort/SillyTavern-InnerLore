#!/bin/sh
# Starts the InnerLore voice server inside the Ubuntu proot (see README.md).
HOME_DIR="${HOME:-/home/chris}"
export INNERLORE_TTS_MODELS="${INNERLORE_TTS_MODELS:-$HOME_DIR/.innerlore-tts/models}"
export INNERLORE_TTS_ENGINE="${INNERLORE_TTS_ENGINE:-supertonic}"
export INNERLORE_TTS_THREADS="${INNERLORE_TTS_THREADS:-2}"
export INNERLORE_TTS_PORT="${INNERLORE_TTS_PORT:-8778}"
# Supertonic: 8 flow-matching steps (0.56x real time here) and clearer pauses at punctuation.
export INNERLORE_TTS_STEPS="${INNERLORE_TTS_STEPS:-8}"
export INNERLORE_TTS_SILENCE="${INNERLORE_TTS_SILENCE:-1.5}"
VENV="${INNERLORE_TTS_VENV:-$HOME_DIR/.innerlore-tts/venv}"
cd "$(dirname "$0")" || exit 1
exec "$VENV/bin/python" innerlore_tts.py
