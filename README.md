## Kyrgyz AI Service - STT + Chat + TTS

FastAPI service with a built-in React frontend for the diploma project.

Main capabilities:

- STT (Speech-to-Text) runs in the browser using Transformers.js + Web Worker
- Realtime Kyrgyz chat over WebSocket
- TTS (Text-to-Speech) with local ONNX voice models
- Live voice loop endpoint for low-latency voice-to-voice interaction
- Login with email OTP + JWT
- PostgreSQL via Docker Compose

The project uses one source of frontend truth: the folder frontend inside this repository.

---

### 1. Project Layout

- app/main.py - FastAPI app, routes, websocket endpoints, model loading
- app/live_service.py - live websocket flow logic
- app/text/ - text normalization helpers
- app/models/ - ONNX TTS models (female.onnx, male.onnx)
- app/frontend_dist/ - built frontend copied for backend serving
- frontend/ - React/Vite frontend source
- scripts/build_frontend.ps1 - builds frontend and copies dist into app/frontend_dist
- scripts/live_smoke.py - smoke test for live websocket endpoint
- tests/ - unit tests for text pipeline and tts utils

---

### 2. Prerequisites

- Python 3.10+
- pip
- Node.js 18+ and npm
- Groq API key for chat features

Linux/Docker note: Dockerfile installs espeak-ng for phonemizer support.

---

### 3. Environment Variables

Create .env in kyrgyz-ai-service:

```env
GROQ_API_KEY=your_groq_key_here
JWT_SECRET=change_me_long_random

# Gmail SMTP (App Password recommended)
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your_gmail@gmail.com
SMTP_PASSWORD=your_app_password
SMTP_FROM=your_gmail@gmail.com
```

Never commit real secrets.

---

### 4. Install Dependencies

Backend:

```bash
cd kyrgyz-ai-service
pip install -r requirements.txt
```

Frontend:

```bash
cd kyrgyz-ai-service/frontend
npm install
```

---

### 5. Add TTS Models

Place your ONNX files in app/models:

- app/models/female.onnx
- app/models/male.onnx

If a model is missing, it will be reported by /health.

---

### 6. Run Locally

#### 6.1 Backend

```bash
cd kyrgyz-ai-service
set PYTHONPATH=%CD%
uvicorn app.main:app --host 0.0.0.0 --port 8000
```

PowerShell alternative for PYTHONPATH:

```powershell
$env:PYTHONPATH = (Get-Location).Path
```

Backend URLs:

- http://127.0.0.1:8000/health
- http://127.0.0.1:8000/docs

#### 6.2 Frontend dev mode

```bash
cd kyrgyz-ai-service/frontend
npm run dev
```

Open the printed Vite URL (usually http://localhost:5173).

#### 6.3 Frontend production build for backend

Build frontend:

```bash
cd kyrgyz-ai-service/frontend
npm run build
```

Copy build output for backend serving:

```powershell
cd C:\Users\Erbol\Desktop\KG_AI
.\kyrgyz-ai-service\scripts\build_frontend.ps1
```

Then open:

- http://127.0.0.1:8000/

---

### 7. Docker

From kyrgyz-ai-service:

```powershell
.\scripts\build_frontend.ps1
docker compose up --build
```

Services:

- app: http://127.0.0.1:8000/
- postgres: 5432

---

### 8. API Overview

#### GET /health

Returns service state, model loading state, and Groq configuration status.

#### POST /ask

Chat completion + synthesized speech URL.

Request example:

```json
{
  "message": "Salam, Bishkek tuuraluu aytyp berchi",
  "model": "female"
}
```

#### POST /tts

Direct text to speech without LLM generation.

Request example:

```json
{
  "text": "Salam, bul tike textten sintez.",
  "model": "male"
}
```

#### WebSocket /ws

Streaming chat websocket used by the frontend for text deltas and final audio response.

#### WebSocket /ws/live

Low-latency live voice websocket.

- Client sends PCM chunks and control messages (start, stop, interrupt)
- Server emits transcript, llm deltas, turn lifecycle events, and audio chunks

Smoke test:

```bash
cd kyrgyz-ai-service
python scripts/live_smoke.py --wav path/to/short_speech.wav --url ws://127.0.0.1:8000/ws/live
```

---

### 9. Tests

```bash
cd kyrgyz-ai-service
pytest tests/ -v
```

---

### 10. Git And Large Files

This repository intentionally ignores large generated and model artifacts via .gitignore.

Important:

- .gitignore does not remove files already committed in history
- If push size becomes very large, check for previously committed model/build files in git history

Model and build paths that should stay untracked:

- frontend/public/models/
- app/models/
- frontend/dist/
- app/frontend_dist/
