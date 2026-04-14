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
# from fastapi_limiter import FastAPILimiter  # Disabled for Docker - add slowapi==0.1.9 to Dockerfile
from openai import OpenAI
from pydantic import BaseModel
import structlog
import secrets

from app.api_auth import router as auth_router
from app.api_data import router as data_router
from app.auth import decode_token
from fastapi import Depends
from app.deps import get_current_user
from app.db import engine
from sqlalchemy import text
from app.db import SessionLocal
from app.models_db import Base as DbBase
from app.models_db import Conversation as DbConversation
from app.models_db import Message as DbMessage
from app.memory import default_memory
from app.text_processor import KyrgyzTextProcessor
from app.text import cleaners as text_cleaners
from app.tts_utils import intersperse
from app.live_service import LiveSession

load_dotenv()

# Configure structlog for production-ready JSON logging
structlog.configure(
    processors=[
        structlog.stdlib.filter_by_level,
        structlog.stdlib.add_logger_name,
        structlog.stdlib.add_log_level,
        structlog.stdlib.PositionalArgumentsFormatter(),
        structlog.processors.TimeStamper(fmt="iso"),
        structlog.processors.StackInfoRenderer(),
        structlog.processors.format_exc_info,
        structlog.processors.JSONRenderer()
    ],
    context_class=dict,
    logger_factory=structlog.stdlib.LoggerFactory(),
    wrapper_class=structlog.stdlib.BoundLogger,
    cache_logger_on_first_use=True,
)

logger = structlog.get_logger("kyrgyz_ai")

# Auto-generate strong JWT_SECRET if weak (security improvement)
jwt_secret = os.getenv("JWT_SECRET", "")
if len(jwt_secret) < 32:
    logger.warning("JWT_SECRET too weak, generating secure one - SAVE TO .env!")
    jwt_secret = secrets.token_urlsafe(64)
    logger.info("Generated JWT_SECRET", preview=jwt_secret[:16]+"...")
os.environ["JWT_SECRET"] = jwt_secret

current_dir = os.path.dirname(os.path.abspath(__file__))
STATIC_DIR = os.path.join(current_dir, "static")
SERVICE_ROOT = os.path.abspath(os.path.join(current_dir, ".."))
FRONTEND_DIST_DIR = os.path.abspath(os.path.join(current_dir, "frontend_dist"))
FRONTEND_DIST_DIR_FALLBACK = os.path.abspath(os.path.join(SERVICE_ROOT, "frontend", "dist"))
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
SYSTEM_PROMPT = (
    "Ар дайым кыргыз тилинде жооп бер.\n"
    "Колдонуучу сен кимсиң/эмнесиң/кайдан чыктың деп сураса, так ушул сүйлөм менен жооп бер:\n"
    "\"Мен Ала-Тоо тарабынан иштелип чыккан Aibum мун.\"\n"
    "Андан кийин кыскача кантип жардам бере аларыңды айт.\n"
)


def _init_backends() -> None:
    global tts_sessions, openai_client
    logger.info("Initializing Kyrgyz AI backends")
    
    api_key = os.getenv("GROQ_API_KEY")
    if not api_key:
        logger.warning("GROQ_API_KEY missing - /ask endpoint disabled")
        startup_messages.append("GROQ_API_KEY not set")
    else:
        try:
            openai_client = OpenAI(api_key=api_key, base_url="https://api.groq.com/openai/v1")
            startup_messages.append("Groq OK")
            logger.info("Groq Llama client ready")
        except Exception as e:
            logger.error("Groq init failed", exc_info=e)
            startup_messages.append(f"Groq error: {e}")

    for gender, model_path in [("female", FEMALE_MODEL_PATH), ("male", MALE_MODEL_PATH)]:
        if not os.path.isfile(model_path):
            logger.warning("TTS model missing", gender=gender, path=model_path)
            startup_messages.append(f"TTS {gender} missing")
            continue
        try:
            tts_sessions[gender] = ort.InferenceSession(model_path, providers=["CPUExecutionProvider"])
            startup_messages.append(f"TTS {gender} ready")
            logger.info("TTS model loaded", gender=gender, path=model_path)
        except Exception as e:
            logger.error("TTS load failed", gender=gender, exc_info=e)
            startup_messages.append(f"TTS {gender} failed")

    logger.info("Backend init complete", tts_models=len(tts_sessions), groq=bool(openai_client))


_init_backends()

app = FastAPI(title="Kyrgyz AI Service", version="1.1.0 - Improved")
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")
app.include_router(auth_router)
app.include_router(data_router)

# DB tables (alembic will manage future changes)
DbBase.metadata.create_all(bind=engine)

# Legacy migration (remove after alembic upgrade head)
try:
    with engine.begin() as conn:
        conn.execute(text("ALTER TABLE users ADD COLUMN IF NOT EXISTS name VARCHAR(120)"))
except:
    pass  # Ignore if exists

def _frontend_dir() -> Optional[str]:
    for p in [FRONTEND_DIST_DIR, FRONTEND_DIST_DIR_FALLBACK]:
        if os.path.isdir(p) and os.path.isfile(os.path.join(p, "index.html")):
            return p
    logger.warning("No frontend dist found")
    return None


def _serve_frontend_file(path_in_dist: str) -> FileResponse:
    dist = _frontend_dir()
    if dist:
        return FileResponse(os.path.join(dist, path_in_dist))
    # Fallback (won't happen post-cleanup)
    return FileResponse(os.path.join(STATIC_DIR, "index.html"))


# Mount frontend assets if available
_dist = _frontend_dir()
if _dist:
    assets_dir = os.path.join(_dist, "assets")
    if os.path.isdir(assets_dir):
        app.mount("/assets", StaticFiles(directory=assets_dir), name="vite_assets")

@app.get("/")
async def root():
    return _serve_frontend_file("index.html")


@app.get("/health")
async def health():
    return {
        "ok": bool(tts_sessions) and bool(openai_client),
        "version": "1.1.0-improved",
        "models": {
            "female": {"loaded": "female" in tts_sessions},
            "male": {"loaded": "male" in tts_sessions},
        },
        "groq": bool(os.getenv("GROQ_API_KEY")),
        "jwt_secure": len(os.getenv("JWT_SECRET", "")) >= 32,
        "details": startup_messages,
    }


class ChatRequest(BaseModel):
    message: str = ""
    model: Literal["female", "male"] = "female"


class TTSRequest(BaseModel):
    text: str = ""
    model: Literal["female", "male"] = "female"


def _get_tts_session(gender: str) -> ort.InferenceSession:
    session = tts_sessions.get(gender)
    if not session:
        logger.error("TTS session missing", gender=gender)
        raise HTTPException(status_code=503, detail=f"TTS {gender} unavailable")
    return session


def _save_audio(audio: np.ndarray, *, gender: str) -> str:
    ts_ms = int(time.time() * 1000)
    filename = f"audio_{gender}_{ts_ms}.wav"
    file_path = os.path.join(STATIC_DIR, filename)
    sf.write(file_path, audio * 0.95, 22050, subtype="PCM_24")
    
    # Cleanup: keep last 100 files max
    import glob
    wav_files = glob.glob(os.path.join(STATIC_DIR, "*.wav"))
    if len(wav_files) > 100:
        oldest = sorted(wav_files)[:len(wav_files)-100]
        for f in oldest:
            os.remove(f)
            logger.debug("Cleaned old audio", file=os.path.basename(f))
    
    logger.debug("Audio saved", filename=filename)
    return f"/static/{filename}"


def _synthesize(text: str, *, gender: str) -> dict:
    if not text.strip():
        raise ValueError("Empty text")
    
    logger.info("TTS synthesize", gender=gender, text_len=len(text))
    session = _get_tts_session(gender)

    cleaned = text_cleaners.kygryz_cleaners2(text.strip())
    sequence = text_processor.text_to_sequence(text.strip())
    if not sequence:
        raise ValueError("Empty phoneme sequence")

    sequence = intersperse(sequence, 0)
    x = np.array(sequence, dtype=np.int64)[None, :]
    x_lengths = np.array([x.shape[1]], dtype=np.int64)
    scales = np.array([0.667, 1.0], dtype=np.float32)

    outputs = session.run(None, {"x": x, "x_lengths": x_lengths, "scales": scales})
    wav = outputs[0][0, :int(outputs[1][0])].astype(np.float32)
    
    # Normalize
    wav = wav - np.mean(wav)
    if np.max(np.abs(wav)) > 0:
        wav /= np.max(np.abs(wav))

    audio_url = _save_audio(wav, gender=gender)
    logger.info("TTS complete", duration=len(wav)/22050)
    return {"kyrgyz_text": text, "cleaned_text": cleaned, "audio_url": audio_url}


@app.post("/ask")
async def ask_kyrgyz_ai(request: ChatRequest, http_request: Request, http_response: Response, user = Depends(get_current_user)):
    if not openai_client:
        raise HTTPException(503, "Groq not configured")
    try:
        sid = http_request.cookies.get(SESSION_COOKIE, uuid.uuid4().hex)
        http_response.set_cookie(SESSION_COOKIE, sid, httponly=False, samesite="lax", max_age=2592000)

        history = memory.recent(sid, limit=MAX_HISTORY)
        messages = [{"role": "system", "content": SYSTEM_PROMPT}] + history + [{"role": "user", "content": request.message}]
        
        memory.add(sid, "user", request.message)
        completion = openai_client.chat.completions.create(model="llama-3.3-70b-versatile", messages=messages)
        ai_text = completion.choices[0].message.content or "Кечиресиз, жооп таппай калдым."
        memory.add(sid, "assistant", ai_text)
        
        return _synthesize(ai_text, gender=request.model)
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Ask error", exc_info=e)
        raise HTTPException(500, str(e)) from e


@app.post("/tts")
async def tts_only(request: TTSRequest, user = Depends(get_current_user)):
    return _synthesize(request.text, gender=request.model)


@app.post("/session/reset")
async def reset_session(http_request: Request, http_response: Response):
    sid = http_request.cookies.get(SESSION_COOKIE, uuid.uuid4().hex)
    memory.clear(sid)
    return {"ok": True}


@app.websocket("/ws")
async def ws_chat(websocket: WebSocket):
    await websocket.accept()
    sid = websocket.cookies.get(SESSION_COOKIE) or uuid.uuid4().hex
    token = websocket.query_params.get("token")
    authed_user_id = int(decode_token(token)["sub"]) if token and decode_token(token) else None

    if not openai_client:
        await websocket.send_json({"type": "error", "message": "AI not available"})
        return

    try:
        while True:
            payload = await websocket.receive_json()
            if payload.get("type") == "reset":
                memory.clear(sid)
                await websocket.send_json({"type": "reset_ok"})
                continue

            user_msg = payload.get("message", "").strip()
            if not user_msg:
                continue

            gender = payload.get("model", "female")
            history = payload.get("history", [])
            conv_id = payload.get("conversation_id")
            
            messages = [{"role": "system", "content": SYSTEM_PROMPT}]
            if history:
                messages.extend(history[-MAX_HISTORY:])
            else:
                history = memory.recent(sid, MAX_HISTORY)
                messages.extend(history)
            messages.append({"role": "user", "content": user_msg})

            # Persist if authed
            if authed_user_id and isinstance(conv_id, int):
                db = SessionLocal()
                try:
                    c = db.query(DbConversation).filter(DbConversation.id == conv_id, DbConversation.user_id == authed_user_id).first()
                    if c:
                        db.add(DbMessage(conversation_id=c.id, role="user", content=user_msg))
                        db.commit()
                finally:
                    db.close()

            await websocket.send_json({"type": "text_start"})

            full_text = ""
            stream = openai_client.chat.completions.create(model="llama-3.3-70b-versatile", messages=messages, stream=True)
            for chunk in stream:
                delta = chunk.choices[0].delta.content or ""
                if delta:
                    full_text += delta
                    await websocket.send_json({"type": "text_delta", "delta": delta})

            await websocket.send_json({"type": "text_done", "text": full_text})

            # Final TTS
            tts = _synthesize(full_text, gender=gender)
            await websocket.send_json({"type": "audio_final", "audio_url": tts["audio_url"], "cleaned_text": tts["cleaned_text"]})

            if not history:
                memory.add(sid, "assistant", full_text)

            if authed_user_id and isinstance(conv_id, int):
                db = SessionLocal()
                try:
                    c = db.query(DbConversation).filter(DbConversation.id == conv_id, DbConversation.user_id == authed_user_id).first()
                    if c:
                        db.add(DbMessage(conversation_id=c.id, role="assistant", content=full_text))
                        db.commit()
                finally:
                    db.close()

            await websocket.send_json({"type": "done"})

    except WebSocketDisconnect:
        logger.debug("WS disconnected", sid=sid[:8])
    except Exception as e:
        logger.error("WS error", exc_info=e)
        await websocket.send_json({"type": "error", "message": str(e)})


@app.websocket("/ws/live")
async def ws_live(websocket: WebSocket):
    await websocket.accept()
    if not openai_client:
        await websocket.send_json({"type": "error", "message": "AI not available"})
        await websocket.close()
        return

    session = LiveSession(
        websocket=websocket,
        openai_client=openai_client,
        tts_sessions=tts_sessions,
        text_processor=text_processor,
        system_prompt=SYSTEM_PROMPT,
        logger=logger,
    )

    try:
        await session.run()
    except WebSocketDisconnect:
        logger.debug("live ws disconnected")
    except Exception as e:
        logger.error("live ws error", exc_info=e)
        try:
            await websocket.send_json({"type": "error", "message": str(e)})
        except Exception:
            pass


@app.get("/{full_path:path}")
async def spa_fallback(full_path: str):
    dist = _frontend_dir()
    if dist:
        candidate = os.path.join(dist, full_path)
        if os.path.isfile(candidate):
            return FileResponse(candidate)
        return FileResponse(os.path.join(dist, "index.html"))
    return {"error": "Frontend not built - run frontend build script"}
