"""
Transcribe a video or audio file with word timestamps, and measure its loudness envelope.

    .venv/bin/python -I cutroom/py/transcribe.py --input talk.mp4 --out transcript.json \
        [--engine faster|openai] [--model small.en] [--language en]

Writes one JSON file:
    { engine, model, language, duration,
      words: [{ text, start, end, p }],
      envelope: { rate: 100, db: [int, ...] } }     # RMS in dBFS, 10 ms frames

Progress goes to stderr as JSON lines: {"progress": 0.42}. ffmpeg does the
decoding (16 kHz mono PCM), so any format ffmpeg reads works, and nothing here
depends on PyAV.
"""
import argparse
import json
import subprocess
import sys

import numpy as np

SR = 16000
PAD = 1.0  # seconds of silence in front: Whisper drops a first word that starts at 0.0
# Whisper leaves out "um" and "uh" unless the prompt shows them. Cutting them needs them transcribed.
FILLER_PROMPT = "Umm, let me think like, hmm... Okay, here's what I'm, like, thinking."


def log(**kw):
    print(json.dumps(kw), file=sys.stderr, flush=True)


def decode(path):
    raw = subprocess.run(
        ["ffmpeg", "-nostdin", "-v", "error", "-i", path, "-vn", "-f", "s16le", "-ac", "1", "-ar", str(SR), "-"],
        capture_output=True, check=True,
    ).stdout
    return np.frombuffer(raw, np.int16).astype(np.float32) / 32768.0


def envelope(audio, rate=100):
    hop = SR // rate
    n = len(audio) // hop
    if n == 0:
        return []
    frames = audio[: n * hop].reshape(n, hop)
    rms = np.sqrt(np.mean(frames * frames, axis=1) + 1e-12)
    return [int(round(x)) for x in np.clip(20 * np.log10(rms), -90, 0)]


def run_faster(audio, model_name, language, duration):
    from faster_whisper import WhisperModel

    model = WhisperModel(model_name, device="cpu", compute_type="int8")
    segments, info = model.transcribe(
        audio,
        language=language,
        word_timestamps=True,
        initial_prompt=FILLER_PROMPT,
        condition_on_previous_text=False,
        vad_filter=False,
    )
    words = []
    for seg in segments:
        for w in seg.words or []:
            words.append({"text": w.word, "start": w.start - PAD, "end": w.end - PAD, "p": round(float(w.probability), 3)})
        log(progress=min(1.0, max(0.0, (seg.end - PAD) / max(duration, 0.1))))
    return words, info.language


def run_openai(audio, model_name, language, duration):
    import whisper  # openai-whisper, optional: pip install openai-whisper

    model = whisper.load_model("turbo" if model_name == "large-v3-turbo" else model_name)
    result = model.transcribe(audio, language=language, word_timestamps=True, initial_prompt=FILLER_PROMPT,
                              condition_on_previous_text=False, verbose=None)
    words = []
    for seg in result["segments"]:
        for w in seg.get("words", []):
            words.append({"text": w["word"], "start": w["start"] - PAD, "end": w["end"] - PAD, "p": round(float(w.get("probability", 1)), 3)})
        log(progress=min(1.0, max(0.0, (seg["end"] - PAD) / max(duration, 0.1))))
    return words, result.get("language", language)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--input", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--engine", default="faster", choices=["faster", "openai"])
    ap.add_argument("--model", default="small.en")
    ap.add_argument("--language", default=None)
    a = ap.parse_args()

    log(stage="decode")
    audio = decode(a.input)
    duration = len(audio) / SR
    env = envelope(audio)
    padded = np.concatenate([np.zeros(int(SR * PAD), np.float32), audio])

    language = a.language or ("en" if a.model.endswith(".en") else None)
    log(stage="transcribe", engine=a.engine, model=a.model)
    runner = run_openai if a.engine == "openai" else run_faster
    words, lang = runner(padded, a.model, language, duration)

    for w in words:
        w["start"] = round(max(0.0, min(duration, w["start"])), 3)
        w["end"] = round(max(w["start"], min(duration, w["end"])), 3)

    with open(a.out, "w") as f:
        json.dump({"engine": a.engine, "model": a.model, "language": lang, "duration": duration,
                   "words": words, "envelope": {"rate": 100, "db": env}}, f)
    log(progress=1.0, words=len(words))


if __name__ == "__main__":
    main()
