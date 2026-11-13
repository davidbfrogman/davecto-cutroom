"""Transcribe a video to word timings for the beats (R.w in kit/retro.js).

    python words.py <video> <out.json> [model]     model: small.en (default), medium.en, ...

Writes [{"t": start, "e": end, "w": "word"}, ...] in seconds. Runs faster-whisper on the CPU
(int8). Uses the Python venv Cutroom installs (lib/deps.mjs finds it)."""
import json
import subprocess
import sys

import numpy as np

SR = 16000
PAD = 1.0  # seconds of silence in front: Whisper drops a first word that starts at 0.0


def main(src, out, model_name="small.en"):
    from faster_whisper import WhisperModel

    raw = subprocess.run(["ffmpeg", "-nostdin", "-v", "error", "-i", src, "-vn", "-f", "s16le", "-ac", "1", "-ar", str(SR), "-"],
                         capture_output=True, check=True).stdout
    audio = np.concatenate([np.zeros(int(PAD * SR), np.float32), np.frombuffer(raw, np.int16).astype(np.float32) / 32768.0])
    model = WhisperModel(model_name, device="cpu", compute_type="int8")
    segments, _ = model.transcribe(audio, language="en", word_timestamps=True, condition_on_previous_text=False, vad_filter=False)
    words = [{"t": round(max(0.0, w.start - PAD), 3), "e": round(max(0.0, w.end - PAD), 3), "w": w.word.strip()}
             for seg in segments for w in (seg.words or []) if w.word.strip()]
    with open(out, "w") as f:
        json.dump(words, f)
    print(f"{len(words)} words → {out}")


if __name__ == "__main__":
    main(*sys.argv[1:])
