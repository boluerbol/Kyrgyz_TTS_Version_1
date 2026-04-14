import argparse
import asyncio
import json
import ssl
import sys
from pathlib import Path

import numpy as np
import soundfile as sf
import websockets


def to_pcm16_mono_16k(wav_path: Path) -> bytes:
    audio, sr = sf.read(str(wav_path), dtype="float32", always_2d=False)
    if audio.ndim == 2:
        audio = np.mean(audio, axis=1)

    if sr != 16000:
        ratio = sr / 16000.0
        out_len = max(1, int(round(len(audio) / ratio)))
        out = np.zeros(out_len, dtype=np.float32)
        pos = 0
        for i in range(out_len):
            nxt = min(len(audio), int(round((i + 1) * ratio)))
            if nxt <= pos:
                out[i] = audio[min(pos, len(audio) - 1)] if len(audio) else 0.0
            else:
                out[i] = float(np.mean(audio[pos:nxt]))
            pos = nxt
        audio = out

    audio = np.clip(audio, -1.0, 1.0)
    pcm = (audio * 32767.0).astype(np.int16)
    return pcm.tobytes()


async def run_smoke(url: str, token: str | None, wav_path: Path, model: str, timeout_s: float) -> int:
    if token:
        join = "&" if "?" in url else "?"
        url = f"{url}{join}token={token}"

    pcm = to_pcm16_mono_16k(wav_path)
    chunk_bytes = 3200  # ~100ms at 16kHz mono s16le

    ssl_ctx = None
    if url.startswith("wss://"):
        ssl_ctx = ssl.create_default_context()

    events: list[str] = []
    transcript_seen = False
    llm_delta_seen = False
    audio_meta_seen = False
    audio_binary_seen = False
    turn_done_seen = False

    async with websockets.connect(url, ssl=ssl_ctx, max_size=None) as ws:
        ready_raw = await asyncio.wait_for(ws.recv(), timeout=timeout_s)
        print("ready:", ready_raw)

        await ws.send(json.dumps({"type": "start", "model": model}))

        for i in range(0, len(pcm), chunk_bytes):
            await ws.send(pcm[i : i + chunk_bytes])
            await asyncio.sleep(0.02)

        await ws.send(json.dumps({"type": "stop"}))

        deadline = asyncio.get_event_loop().time() + timeout_s
        while asyncio.get_event_loop().time() < deadline:
            remaining = max(0.1, deadline - asyncio.get_event_loop().time())
            try:
                msg = await asyncio.wait_for(ws.recv(), timeout=remaining)
            except asyncio.TimeoutError:
                break

            if isinstance(msg, bytes):
                audio_binary_seen = True
                events.append("audio_binary")
                print(f"binary audio chunk: {len(msg)} bytes")
                continue

            try:
                payload = json.loads(msg)
            except Exception:
                print("non-json text event:", msg)
                continue

            t = payload.get("type", "unknown")
            events.append(t)
            print("event:", payload)

            if t == "transcript":
                transcript_seen = True
            if t == "llm_delta":
                llm_delta_seen = True
            if t == "audio_chunk_meta":
                audio_meta_seen = True
            if t == "turn_done":
                turn_done_seen = True
                break
            if t == "error":
                print("server error:", payload.get("message"))
                break

    print("events:", events)

    missing = []
    if not transcript_seen:
        missing.append("transcript")
    if not llm_delta_seen:
        missing.append("llm_delta")
    if not audio_meta_seen:
        missing.append("audio_chunk_meta")
    if not audio_binary_seen:
        missing.append("audio_binary")
    if not turn_done_seen:
        missing.append("turn_done")

    if missing:
        print("SMOKE FAILED. Missing:", ", ".join(missing))
        return 1

    print("SMOKE PASSED")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="Live mode smoke test for /ws/live")
    parser.add_argument("--url", default="ws://127.0.0.1:8000/ws/live", help="Live WS URL")
    parser.add_argument("--token", default=None, help="Optional auth token")
    parser.add_argument("--wav", required=True, help="Path to short speech WAV/OGG/MP3 file")
    parser.add_argument("--model", default="female", choices=["female", "male"], help="TTS voice model")
    parser.add_argument("--timeout", type=float, default=25.0, help="Timeout seconds")
    args = parser.parse_args()

    wav_path = Path(args.wav)
    if not wav_path.exists():
        print(f"Input audio file does not exist: {wav_path}")
        return 2

    return asyncio.run(run_smoke(args.url, args.token, wav_path, args.model, args.timeout))


if __name__ == "__main__":
    sys.exit(main())
