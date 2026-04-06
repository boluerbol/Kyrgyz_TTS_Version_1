import os
import time
import traceback
import uuid
from typing import Dict, Literal, Optional

import numpy as np
import onnxruntime as ort
import soundfile as sf
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Request, Response, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from openai import OpenAI
from pydantic import BaseModel

from app.memory import default_memory
from app.text_processor import KyrgyzTextProcessor
from app.text import cleaners as text_cleaners
from app.tts_utils import intersperse

load_dotenv()

current_dir = os.path.dirname(os.path.abspath(__file__))
STATIC_DIR = os.path.join(current_dir, "static")
MODEL_DIR = os.path.join(current_dir, "models")
FEMALE_MODEL_PATH = os.path.join(MODEL_DIR, "female.onnx")
MALE_MODEL_PATH = os.path.join(MODEL_DIR, "male.onnx")

os.makedirs(STATIC_DIR, exist_ok=True)

text_processor = KyrgyzTextProcessor()
tts_sessions: Dict[str, ort.InferenceSession] = {}
openai_client: Optional[OpenAI] = None
startup_messages: list[str] = []
memory = default_memory()

SESSION_COOKIE = "sid"
MAX_HISTORY = 12
SYSTEM_PROMPT = "Сен кыргыз тилинде сүйлөгөн акылдуу жардамчысың. Кыска жооп бер."


def _init_backends() -> None:
    global tts_sessions, openai_client
    api_key = os.getenv("GROQ_API_KEY")
    if not api_key:
        startup_messages.append("GROQ_API_KEY is not set; /ask will fail until it is configured.")
    else:
        try:
            openai_client = OpenAI(api_key=api_key, base_url="https://api.groq.com/openai/v1")
            startup_messages.append("Groq OpenAI client initialized.")
        except Exception as e:
            startup_messages.append(f"OpenAI client error: {e}")

    for gender, model_path in [("female", FEMALE_MODEL_PATH), ("male", MALE_MODEL_PATH)]:
        if not os.path.isfile(model_path):
            startup_messages.append(f"ONNX model missing: {gender} -> {model_path}")
            continue
        try:
            tts_sessions[gender] = ort.InferenceSession(model_path, providers=["CPUExecutionProvider"])
            startup_messages.append(f"ONNX model loaded: {gender} -> {model_path}")
        except Exception as e:
            startup_messages.append(f"ONNX load failed ({gender}): {e}")


_init_backends()

app = FastAPI(title="Kyrgyz AI Service", version="1.0.0")
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")


@app.get("/")
async def root():
    return FileResponse(os.path.join(STATIC_DIR, "index.html"))


@app.get("/tts-ui")
async def tts_ui():
    return FileResponse(os.path.join(STATIC_DIR, "tts.html"))


@app.get("/health")
async def health():
    return {
        "ok": (len(tts_sessions) > 0) and openai_client is not None,
        "models": {
            "female": {"path": FEMALE_MODEL_PATH, "loaded": "female" in tts_sessions},
            "male": {"path": MALE_MODEL_PATH, "loaded": "male" in tts_sessions},
        },
        "groq_configured": bool(os.getenv("GROQ_API_KEY")),
        "details": startup_messages,
    }


class ChatRequest(BaseModel):
    message: str
    model: Literal["female", "male"] = "female"


class TTSRequest(BaseModel):
    text: str
    model: Literal["female", "male"] = "female"


def _get_tts_session(gender: str) -> ort.InferenceSession:
    if gender not in tts_sessions:
        raise HTTPException(
            status_code=503,
            detail=f"TTS model not loaded. Missing or failed to load '{gender}' model.",
        )
    return tts_sessions[gender]


def _save_audio(audio: np.ndarray, *, gender: str) -> str:
    # Unique filename to avoid concurrent-request collisions and browser caching issues.
    ts_ms = int(time.time() * 1000)
    filename = f"browser_{gender}_{ts_ms}.wav"
    file_path = os.path.join(STATIC_DIR, filename)
    sf.write(file_path, audio * 0.9, 22050, subtype="PCM_24")
    return f"/static/{filename}"


def _save_audio_named(audio: np.ndarray, *, filename: str) -> str:
    file_path = os.path.join(STATIC_DIR, filename)
    sf.write(file_path, audio * 0.9, 22050, subtype="PCM_24")
    return f"/static/{filename}"


def _synthesize(text: str, *, gender: str) -> dict:
    session = _get_tts_session(gender)

    cleaned_text = text_cleaners.kygryz_cleaners2(text.strip())
    sequence = text_processor.text_to_sequence(text.strip())
    if not sequence:
        raise ValueError(f"Empty phoneme sequence after processing. Text: {text!r}")

    sequence = intersperse(sequence, 0)

    x = np.array(sequence, dtype=np.int64)[None, :]
    x_lengths = np.array([x.shape[1]], dtype=np.int64)
    scales = np.array([0.667, 1.0], dtype=np.float32)

    outputs = session.run(None, {"x": x, "x_lengths": x_lengths, "scales": scales})
    wav = outputs[0]
    wav_lengths = outputs[1]

    actual_samples = int(wav_lengths[0])
    audio = wav[0][:actual_samples].astype(np.float32)
    audio = audio - np.mean(audio)
    max_abs = np.max(np.abs(audio))
    if max_abs > 0:
        audio = audio / max_abs

    audio_url = _save_audio(audio, gender=gender)
    return {"kyrgyz_text": text, "cleaned_text": cleaned_text, "audio_url": audio_url}


def _synthesize_chunk(text: str, *, gender: str, session_id: str, chunk_idx: int) -> dict:
    session = _get_tts_session(gender)

    cleaned_text = text_cleaners.kygryz_cleaners2(text.strip())
    sequence = text_processor.text_to_sequence(text.strip())
    if not sequence:
        raise ValueError(f"Empty phoneme sequence after processing. Text: {text!r}")
    sequence = intersperse(sequence, 0)

    x = np.array(sequence, dtype=np.int64)[None, :]
    x_lengths = np.array([x.shape[1]], dtype=np.int64)
    scales = np.array([0.667, 1.0], dtype=np.float32)

    outputs = session.run(None, {"x": x, "x_lengths": x_lengths, "scales": scales})
    wav = outputs[0]
    wav_lengths = outputs[1]

    actual_samples = int(wav_lengths[0])
    audio = wav[0][:actual_samples].astype(np.float32)
    audio = audio - np.mean(audio)
    max_abs = np.max(np.abs(audio))
    if max_abs > 0:
        audio = audio / max_abs

    ts_ms = int(time.time() * 1000)
    safe_sid = session_id.replace("-", "")[:12]
    filename = f"chunk_{gender}_{safe_sid}_{ts_ms}_{chunk_idx}.wav"
    audio_url = _save_audio_named(audio, filename=filename)
    return {"kyrgyz_text": text, "cleaned_text": cleaned_text, "audio_url": audio_url}


def _get_or_set_session(http_request: Request, http_response: Response) -> str:
    sid = http_request.cookies.get(SESSION_COOKIE)
    if not sid:
        sid = uuid.uuid4().hex
        http_response.set_cookie(
            SESSION_COOKIE,
            sid,
            httponly=False,
            samesite="lax",
            max_age=60 * 60 * 24 * 30,
        )
    return sid


@app.post("/ask")
async def ask_kyrgyz_ai(request: ChatRequest, http_request: Request, http_response: Response):
    if not openai_client:
        raise HTTPException(
            status_code=503,
            detail="LLM client not configured. Set GROQ_API_KEY in the environment.",
        )
    try:
        sid = _get_or_set_session(http_request, http_response)

        history = memory.recent(sid, limit=MAX_HISTORY)
        messages = [{"role": "system", "content": SYSTEM_PROMPT}]
        messages.extend(history)
        messages.append({"role": "user", "content": request.message})

        memory.add(sid, "user", request.message)
        completion = openai_client.chat.completions.create(
            model="llama-3.3-70b-versatile",
            messages=messages,
        )
        ai_text = completion.choices[0].message.content or ""
        memory.add(sid, "assistant", ai_text)
        return _synthesize(ai_text, gender=request.model)

    except HTTPException:
        raise
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e)) from e


@app.post("/tts")
async def tts_only(request: TTSRequest):
    try:
        return _synthesize(request.text, gender=request.model)
    except HTTPException:
        raise
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e)) from e


@app.post("/session/reset")
async def reset_session(http_request: Request, http_response: Response):
    sid = _get_or_set_session(http_request, http_response)
    memory.clear(sid)
    return {"ok": True}


@app.websocket("/ws")
async def ws_chat(websocket: WebSocket):
    await websocket.accept()
    sid = websocket.cookies.get(SESSION_COOKIE) or uuid.uuid4().hex

    if not openai_client:
        await websocket.send_json(
            {"type": "error", "message": "LLM client not configured. Set GROQ_API_KEY."}
        )
        await websocket.close()
        return

    try:
        while True:
            payload = await websocket.receive_json()
            msg_type = payload.get("type") or "user_message"
            if msg_type == "reset":
                memory.clear(sid)
                await websocket.send_json({"type": "reset_ok"})
                continue

            user_message = (payload.get("message") or "").strip()
            gender = payload.get("model") or "female"
            stream_audio = bool(payload.get("stream_audio", True))
            if not user_message:
                continue

            memory.add(sid, "user", user_message)

            history = memory.recent(sid, limit=MAX_HISTORY)
            messages = [{"role": "system", "content": SYSTEM_PROMPT}]
            messages.extend(history)
            messages.append({"role": "user", "content": user_message})

            await websocket.send_json({"type": "text_start"})

            full_text = ""
            sentence_buf = ""
            chunk_idx = 0

            stream = openai_client.chat.completions.create(
                model="llama-3.3-70b-versatile",
                messages=messages,
                stream=True,
            )

            for event in stream:
                delta = ""
                try:
                    delta = event.choices[0].delta.content or ""
                except Exception:
                    delta = ""
                if not delta:
                    continue

                full_text += delta
                sentence_buf += delta
                await websocket.send_json({"type": "text_delta", "delta": delta})

                if stream_audio and any(p in sentence_buf for p in [".", "!", "?", "…", "\n"]):
                    if len(sentence_buf.strip()) >= 18:
                        try:
                            tts = _synthesize_chunk(
                                sentence_buf, gender=gender, session_id=sid, chunk_idx=chunk_idx
                            )
                            chunk_idx += 1
                            await websocket.send_json(
                                {
                                    "type": "audio_chunk",
                                    "audio_url": tts["audio_url"],
                                    "cleaned_text": tts["cleaned_text"],
                                }
                            )
                            sentence_buf = ""
                        except Exception as e:
                            await websocket.send_json(
                                {"type": "warn", "message": f"TTS chunk failed: {e}"}
                            )

            await websocket.send_json({"type": "text_done", "text": full_text})

            if stream_audio and sentence_buf.strip():
                try:
                    tts = _synthesize_chunk(
                        sentence_buf, gender=gender, session_id=sid, chunk_idx=chunk_idx
                    )
                    await websocket.send_json(
                        {
                            "type": "audio_chunk",
                            "audio_url": tts["audio_url"],
                            "cleaned_text": tts["cleaned_text"],
                        }
                    )
                except Exception as e:
                    await websocket.send_json({"type": "warn", "message": f"TTS chunk failed: {e}"})

            memory.add(sid, "assistant", full_text)
            await websocket.send_json({"type": "done"})

    except WebSocketDisconnect:
        return
    except Exception as e:
        await websocket.send_json({"type": "error", "message": str(e)})
        await websocket.close()
