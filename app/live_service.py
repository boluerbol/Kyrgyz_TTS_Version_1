import asyncio
import io
import json
import os
import re
import time
from typing import Optional

import numpy as np
import onnxruntime as ort
import soundfile as sf
from fastapi import WebSocket
from openai import APIConnectionError, APITimeoutError, OpenAI

from app.text import cleaners as text_cleaners
from app.text_processor import KyrgyzTextProcessor
from app.tts_utils import intersperse


SENTENCE_RE = re.compile(r"(.+?[.!?\n]+)(\s|$)", re.DOTALL)


class LiveSession:
    """Low-latency voice loop session over a single WebSocket connection."""

    def __init__(
        self,
        *,
        websocket: WebSocket,
        openai_client: OpenAI,
        tts_sessions: dict[str, ort.InferenceSession],
        text_processor: KyrgyzTextProcessor,
        system_prompt: str,
        logger,
    ):
        self.websocket = websocket
        self.openai_client = openai_client
        self.tts_sessions = tts_sessions
        self.text_processor = text_processor
        self.system_prompt = system_prompt
        self.logger = logger

        self.voice_model = "female"
        self.sample_rate = 16000
        self.vad_threshold = float(os.getenv("LIVE_VAD_THRESHOLD", "0.015"))
        self.silence_ms = int(os.getenv("LIVE_SILENCE_MS", "360"))
        self.min_utter_ms = int(os.getenv("LIVE_MIN_UTTER_MS", "220"))
        self.max_utter_ms = int(os.getenv("LIVE_MAX_UTTER_MS", "12000"))
        self.stt_timeout_sec = float(os.getenv("LIVE_STT_TIMEOUT_SEC", "25"))
        self.chat_timeout_sec = float(os.getenv("LIVE_CHAT_TIMEOUT_SEC", "35"))
        self.stt_retries = int(os.getenv("LIVE_STT_RETRIES", "1"))

        self._buf = bytearray()
        self._voice_started_at_ms: Optional[float] = None
        self._last_voice_at_ms: Optional[float] = None
        self._turn_task: Optional[asyncio.Task] = None
        self._turn_id = 0

    async def run(self) -> None:
        await self.websocket.send_json(
            {
                "type": "live_ready",
                "sample_rate": self.sample_rate,
                "pcm_format": "s16le",
                "vad_threshold": self.vad_threshold,
            }
        )

        while True:
            msg = await self.websocket.receive()

            if msg.get("type") == "websocket.disconnect":
                await self.interrupt("disconnect", notify_client=False)
                return

            audio_bytes = msg.get("bytes")
            if audio_bytes is not None:
                await self.on_audio_bytes(audio_bytes)
                continue

            text = msg.get("text")
            if text:
                await self.on_text_message(text)

    async def on_text_message(self, text: str) -> None:
        payload = json.loads(text)
        msg_type = payload.get("type")

        if msg_type == "start":
            self.voice_model = payload.get("model", self.voice_model)
            await self.websocket.send_json({"type": "listening", "model": self.voice_model})
            return

        if msg_type == "stop":
            await self.flush_buffer(trigger="stop")
            return

        if msg_type == "interrupt":
            await self.interrupt(payload.get("reason", "manual"))
            return

        if msg_type == "ping":
            await self.websocket.send_json({"type": "pong"})

    async def on_audio_bytes(self, data: bytes) -> None:
        if not data:
            return

        now_ms = time.monotonic() * 1000.0
        rms = self._pcm_rms(data)
        is_speech = rms >= self.vad_threshold

        if is_speech and self._turn_task and not self._turn_task.done():
            await self.interrupt("barge-in")

        self._buf.extend(data)

        if is_speech:
            if self._voice_started_at_ms is None:
                self._voice_started_at_ms = now_ms
                await self.websocket.send_json({"type": "speech_start"})
            self._last_voice_at_ms = now_ms

        if self._voice_started_at_ms is None:
            return

        utter_ms = self._pcm_duration_ms(bytes(self._buf), self.sample_rate)
        silence_gap = now_ms - self._last_voice_at_ms if self._last_voice_at_ms else 0

        if utter_ms >= self.max_utter_ms:
            await self.flush_buffer(trigger="max_utter")
            return

        if utter_ms >= self.min_utter_ms and silence_gap >= self.silence_ms:
            await self.flush_buffer(trigger="silence")

    async def flush_buffer(self, trigger: str) -> None:
        pcm = bytes(self._buf)
        self._buf.clear()
        self._voice_started_at_ms = None
        self._last_voice_at_ms = None

        if not pcm:
            return

        self._turn_id += 1
        turn_id = self._turn_id
        await self.websocket.send_json({"type": "turn_start", "turn_id": turn_id, "trigger": trigger})

        if self._turn_task and not self._turn_task.done():
            await self.interrupt("new_turn")

        self._turn_task = asyncio.create_task(self._run_turn(turn_id, pcm))

    async def interrupt(self, reason: str, notify_client: bool = True) -> None:
        self._buf.clear()
        self._voice_started_at_ms = None
        self._last_voice_at_ms = None

        if self._turn_task and not self._turn_task.done():
            self._turn_task.cancel()
            try:
                await self._turn_task
            except asyncio.CancelledError:
                pass
        if notify_client:
            try:
                await self.websocket.send_json({"type": "interrupted", "reason": reason})
            except Exception:
                pass

    async def _run_turn(self, turn_id: int, pcm: bytes) -> None:
        try:
            transcript = await self._transcribe_pcm(pcm)
            transcript = (transcript or "").strip()
            if not transcript:
                await self.websocket.send_json({"type": "no_speech", "turn_id": turn_id})
                await self.websocket.send_json({"type": "turn_done", "turn_id": turn_id})
                return

            await self.websocket.send_json({"type": "transcript", "turn_id": turn_id, "text": transcript})
            await self._stream_llm_and_tts(turn_id, transcript)
            await self.websocket.send_json({"type": "turn_done", "turn_id": turn_id})
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            self.logger.error("live turn failed", turn_id=turn_id, exc_info=exc)
            await self.websocket.send_json({"type": "error", "turn_id": turn_id, "message": str(exc)})
            await self.websocket.send_json({"type": "turn_done", "turn_id": turn_id})

    async def _transcribe_pcm(self, pcm: bytes) -> str:
        wav_bytes = self._pcm_to_wav_bytes(pcm, self.sample_rate)
        stt_model = os.getenv("LIVE_STT_MODEL", "whisper-large-v3-turbo")
        stt_language = os.getenv("LIVE_STT_LANGUAGE", "").strip()

        def _call_stt() -> str:
            def _as_text(resp_obj) -> str:
                if isinstance(resp_obj, str):
                    return resp_obj
                return getattr(resp_obj, "text", "") or str(resp_obj)

            # Primary attempt: honor configured language if provided.
            try:
                buf = io.BytesIO(wav_bytes)
                buf.name = "live_input.wav"
                kwargs = {
                    "model": stt_model,
                    "file": buf,
                    "response_format": "text",
                    "timeout": self.stt_timeout_sec,
                }
                if stt_language:
                    kwargs["language"] = stt_language
                resp = self.openai_client.audio.transcriptions.create(**kwargs)
                return _as_text(resp)
            except Exception as exc:
                # Common provider mismatch: unsupported language code.
                msg = str(exc).lower()
                if "unsupported language" not in msg and "language must be" not in msg:
                    raise

            # Fallback: retry without language and let backend auto-detect.
            buf = io.BytesIO(wav_bytes)
            buf.name = "live_input.wav"
            resp = self.openai_client.audio.transcriptions.create(
                model=stt_model,
                file=buf,
                response_format="text",
                timeout=self.stt_timeout_sec,
            )
            return _as_text(resp)

        last_exc: Optional[Exception] = None
        for attempt in range(self.stt_retries + 1):
            try:
                return await asyncio.to_thread(_call_stt)
            except (APITimeoutError, APIConnectionError) as exc:
                last_exc = exc
                if attempt >= self.stt_retries:
                    raise
                await asyncio.sleep(0.25 * (attempt + 1))
            except Exception as exc:
                msg = str(exc).lower()
                if "timed out" in msg or "timeout" in msg:
                    last_exc = exc
                    if attempt >= self.stt_retries:
                        raise
                    await asyncio.sleep(0.25 * (attempt + 1))
                    continue
                raise
        if last_exc:
            raise last_exc
        return ""

    async def _stream_llm_and_tts(self, turn_id: int, user_text: str) -> None:
        messages = [
            {"role": "system", "content": self.system_prompt},
            {"role": "user", "content": user_text},
        ]

        stream = await asyncio.to_thread(
            lambda: self.openai_client.chat.completions.create(
                model="llama-3.3-70b-versatile",
                messages=messages,
                stream=True,
                timeout=self.chat_timeout_sec,
            )
        )

        complete_text = ""
        pending = ""
        chunk_seq = 0

        tts_queue: asyncio.Queue[Optional[str]] = asyncio.Queue()

        async def tts_worker() -> None:
            nonlocal chunk_seq
            while True:
                sentence = await tts_queue.get()
                if sentence is None:
                    tts_queue.task_done()
                    return
                sentence = sentence.strip()
                if sentence:
                    chunk_seq += 1
                    wav_bytes = await asyncio.to_thread(self._synthesize_sentence_wav, sentence)
                    await self.websocket.send_json(
                        {
                            "type": "audio_chunk_meta",
                            "turn_id": turn_id,
                            "seq": chunk_seq,
                            "text": sentence,
                            "sample_rate": 22050,
                            "mime": "audio/wav",
                        }
                    )
                    await self.websocket.send_bytes(wav_bytes)
                tts_queue.task_done()

        worker_task = asyncio.create_task(tts_worker())

        try:
            stream_iter = iter(stream)

            def _next_chunk_or_none():
                try:
                    return next(stream_iter)
                except StopIteration:
                    return None

            while True:
                chunk = await asyncio.to_thread(_next_chunk_or_none)
                if chunk is None:
                    break

                delta = chunk.choices[0].delta.content or ""
                if not delta:
                    continue
                complete_text += delta
                pending += delta
                await self.websocket.send_json({"type": "llm_delta", "turn_id": turn_id, "delta": delta})

                sentences, pending = self._split_sentences(pending)
                for sentence in sentences:
                    await tts_queue.put(sentence)

                # Low-latency fallback: if model avoids punctuation for too long,
                # stream mid-sentence chunks after a safe minimum length.
                if len(pending.strip()) >= 80 and " " in pending:
                    split_at = pending.rfind(" ")
                    if split_at > 40:
                        head = pending[:split_at].strip()
                        pending = pending[split_at + 1 :]
                        if head:
                            await tts_queue.put(head)

            tail = pending.strip()
            if tail:
                await tts_queue.put(tail)
        finally:
            await tts_queue.put(None)
            await tts_queue.join()
            await worker_task

        await self.websocket.send_json({"type": "llm_done", "turn_id": turn_id, "text": complete_text})

    def _synthesize_sentence_wav(self, text: str) -> bytes:
        session = self.tts_sessions.get(self.voice_model) or self.tts_sessions.get("female")
        if not session:
            raise RuntimeError("No TTS model loaded for live mode")

        cleaned = text_cleaners.kygryz_cleaners2(text.strip())
        sequence = self.text_processor.text_to_sequence(cleaned)
        if not sequence:
            raise RuntimeError("Empty phoneme sequence for TTS")

        x = np.array(intersperse(sequence, 0), dtype=np.int64)[None, :]
        x_lengths = np.array([x.shape[1]], dtype=np.int64)
        scales = np.array([0.667, 1.0], dtype=np.float32)

        outputs = session.run(None, {"x": x, "x_lengths": x_lengths, "scales": scales})
        wav = outputs[0][0, : int(outputs[1][0])].astype(np.float32)
        wav = wav - np.mean(wav)
        peak = np.max(np.abs(wav))
        if peak > 0:
            wav = wav / peak

        out = io.BytesIO()
        sf.write(out, wav * 0.95, 22050, format="WAV", subtype="PCM_16")
        return out.getvalue()

    @staticmethod
    def _pcm_rms(pcm: bytes) -> float:
        arr = np.frombuffer(pcm, dtype=np.int16)
        if arr.size == 0:
            return 0.0
        arr_f = arr.astype(np.float32) / 32768.0
        return float(np.sqrt(np.mean(arr_f * arr_f)))

    @staticmethod
    def _pcm_duration_ms(pcm: bytes, sample_rate: int) -> float:
        samples = len(pcm) / 2
        return (samples / sample_rate) * 1000.0

    @staticmethod
    def _pcm_to_wav_bytes(pcm: bytes, sample_rate: int) -> bytes:
        arr = np.frombuffer(pcm, dtype=np.int16)
        out = io.BytesIO()
        sf.write(out, arr, sample_rate, format="WAV", subtype="PCM_16")
        return out.getvalue()

    @staticmethod
    def _split_sentences(text: str) -> tuple[list[str], str]:
        done: list[str] = []
        cursor = 0
        for match in SENTENCE_RE.finditer(text):
            done.append(match.group(1))
            cursor = match.end(1)
        return done, text[cursor:]
