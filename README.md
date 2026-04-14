## Kyrgyz AI Service — STT + Chat + TTS (Diploma-ready)

FastAPI service that:

- **STT (Speech-to-Text)** runs **in the browser** (Transformers.js + web worker)
- **Chats in Kyrgyz** using Groq’s `llama-3.3-70b-versatile`
- **Synthesizes speech (TTS)** using local ONNX models (`female.onnx` / `male.onnx`)
- **Realtime conversation (Gemini-style)** via **WebSocket** streaming (`/ws`)
- **Multi-chat UI** with left sidebar (create/rename/delete), persisted in browser
- **Dark/Light theme toggle**
- **Login via Gmail code** (email OTP) + **JWT**
- **PostgreSQL** (Docker Compose)
- Serves a **single modern web app** (STT + Chat + TTS) at:
  - **`/`** (after building the frontend)

---

### 1. Project layout

- **`app/main.py`** – FastAPI app, Groq client, ONNX TTS pipeline
- **`app/text/*`** – Kyrgyz text cleaners, symbols, number normalization
- **`app/tts_utils.py`** – `intersperse()` helper used for Matcha-style inputs
- **`app/models/`** – ONNX models:
  - `female.onnx`
  - `male.onnx`
- **`app/static/index.html`** – fallback page (shown if frontend is not built/copied yet)
- **`app/static/tts.html`** – text → audio UI
- **`../whisper-web/`** – React/Vite web app (STT + Chat + TTS)
- **`frontend/`** – React/Vite web app (embedded for one-folder deploy)
- **`tests/`** – small smoke tests for text pipeline and `intersperse`

---

### 2. Prerequisites

- Python **3.10+** (project currently tested on 3.10 / 3.13)
- `pip`
- For local TTS:
  - **Windows**: `onnxruntime`, `soundfile` are installed via `requirements.txt`
  - **Linux (Docker)**: image installs `espeak-ng` for phonemizer
- A **Groq API key** (`GROQ_API_KEY`)  
  (if you only want text→audio and not AI chat, Groq is _not_ required).

---

### 3. Environment variables (`.env`)

Create a `.env` file in `kyrgyz-ai-service/`:

```env
GROQ_API_KEY=your_groq_key_here
JWT_SECRET=change_me_long_random

# Gmail SMTP (recommended: App Password)
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your_gmail@gmail.com
SMTP_PASSWORD=your_app_password
SMTP_FROM=your_gmail@gmail.com
```

> **Important:** Do **not** commit real API keys to GitHub. Use a dummy value in any public README/code and keep your own key only in local `.env` or deployment secrets.
> Same rule applies to your Gmail **App Password**. Keep it in `.env` / server secrets only.

You can also configure other keys later if you extend the project.

---

### 4. Installing dependencies (local Python)

From inside the `kyrgyz-ai-service` directory:

```bash
cd kyrgyz-ai-service
pip install -r requirements.txt
```

For development, you can also install `pytest` to run the small test suite:

```bash
pip install pytest
pytest tests/ -v
```

---

### 5. Adding the ONNX models

Place your voice models under `app/models/`:

- `app/models/female.onnx`
- `app/models/male.onnx`

The service will automatically try to load both models on startup:

- If both are present, **both toggles** (female/male voice) will be active.
- If one is missing, it’s reported in `/health`.

---

### 6. Running the server (local)

From `kyrgyz-ai-service`:

```bash
cd kyrgyz-ai-service
set PYTHONPATH=%CD%      # Windows (cmd)
# or in PowerShell: $env:PYTHONPATH = (Get-Location).Path

uvicorn app.main:app --host 0.0.0.0 --port 8000
```

Now open (backend):

- **Legacy Text → Audio UI:** `http://127.0.0.1:8000/tts-ui`
- **Health check:** `http://127.0.0.1:8000/health`
- **Interactive docs (OpenAPI):** `http://127.0.0.1:8000/docs`

### 6.1 Build the modern web app (STT+Chat+TTS)

From the project root (`KG_AI`):

```bash
cd kyrgyz-ai-service/frontend
npm install
npm run build
```

#### Recommended (deploy-ready): copy the frontend into the backend

This makes deployment easy (one service folder contains the built UI).

From `KG_AI` (PowerShell):

```powershell
.\kyrgyz-ai-service\scripts\build_frontend.ps1
```

Then start the backend as above and open:

- **Modern web app:** `http://127.0.0.1:8000/`

The header chip in the UI shows whether:

- Groq key is configured
- ONNX models (female/male) are loaded

---

### 7. Running with Docker

From `kyrgyz-ai-service/`:

First build the frontend (so Docker doesn’t need npm network):

```powershell
.\scripts\build_frontend.ps1
```

```bash
docker compose up --build
```

This starts:

- `app` on `http://127.0.0.1:8000/`
- `postgres` on port `5432`

Build the image from the project root:

```bash
cd kyrgyz-ai-service
docker build -t kyrgyz-ai-service .
```

Run the container:

```bash
docker run \
  --rm \
  -p 8000:8000 \
  --env-file .env \
  kyrgyz-ai-service
```

Then open:

- `http://127.0.0.1:8000/` – modern web app (STT + Chat + TTS) **if** you built+copied the frontend
- `http://127.0.0.1:8000/tts-ui` – text → audio UI

> Note: The Dockerfile already installs `espeak-ng` for the phonemizer backend.

### 7.1 Server deployment (simple)

- **Option A (recommended):** build the frontend and copy it into `kyrgyz-ai-service/app/frontend_dist` using `scripts/build_frontend.ps1`, then deploy only `kyrgyz-ai-service/`.
- **Option B (monorepo):** deploy both `kyrgyz-ai-service/` and `whisper-web/`, build `whisper-web`, and the backend will automatically serve `../whisper-web/dist` as a fallback.

---

### 8. API overview

#### `GET /health`

Returns overall status:

- `ok` – `true` if at least one TTS model is loaded **and** Groq is configured
- `models.female` / `models.male` – path + loaded flags
- `groq_configured` – whether `GROQ_API_KEY` is set
- `details` – startup log messages

#### `POST /ask`

Chat with Kyrgyz AI and get synthesized audio.

**Request body:**

```json
{
  "message": "Салам, Бишкек тууралуу айтып берчи",
  "model": "female"   // or "male"
}
```

**Response:**

```json
{
  "kyrgyz_text": "… AI жооп …",
  "cleaned_text": "… нормалдаштырылган текст …",
  "audio_url": "/static/browser_female_1234567890.wav"
}
```

#### `POST /tts`

Generate audio **directly from text**, no AI completion.

**Request body:**

```json
{
  "text": "Салам, бул түздөн-түз тексттен синтезделмекчи.",
  "model": "male"
}
```

**Response:**

```json
{
  "kyrgyz_text": "Салам, бул түздөн-түз тексттен синтезделмекчи.",
  "cleaned_text": "… синтезге даярдалган текст …",
  "audio_url": "/static/browser_male_1234567890.wav"
}
```

You can embed this endpoint from other services (e.g. a website or mobile app) to get Kyrgyz speech from text.

#### `GET /ws` (WebSocket)

Realtime streaming chat (frontend uses this for “Gemini-like” experience).

Client sends:

```json
{
  "type": "user_message",
  "message": "Салам!",
  "model": "female",
  "stream_audio": true,
  "history": [{ "role": "user", "content": "..." }, { "role": "assistant", "content": "..." }]
}
```

Server streams back:

- `text_start`, `text_delta`, `text_done`
- `audio_chunk` (multiple chunks)
- `done`

#### `GET /ws/live` (WebSocket, low-latency voice loop)

Live endpoint for voice-to-voice conversation with interruption support.

Client sends:

- Binary frames: raw PCM `s16le` chunks (mono, `16000 Hz`) from mic
- JSON control messages:

```json
{ "type": "start", "model": "female" }
```

```json
{ "type": "stop" }
```

```json
{ "type": "interrupt", "reason": "client_interrupt" }
```

Server sends (JSON):

- `live_ready` (sample rate and VAD hints)
- `listening`
- `speech_start`
- `turn_start`
- `transcript`
- `llm_delta` (streamed Groq tokens)
- `audio_chunk_meta` (metadata for following binary WAV bytes)
- `llm_done`
- `turn_done`
- `interrupted`
- `error`

Server also sends binary frames:

- WAV bytes for each synthesized sentence chunk (TTS starts per completed sentence, not full response end)

Interruption behavior:

- If user speaks while AI is generating/playing, server cancels in-flight turn (barge-in)
- Manual interrupt is also supported via JSON `interrupt`

Smoke test script:

```bash
cd kyrgyz-ai-service
python scripts/live_smoke.py --wav path/to/short_speech.wav --url ws://127.0.0.1:8000/ws/live
```

Expected pass criteria:

- transcript event
- llm_delta event
- audio_chunk_meta event
- binary audio chunk(s)
- turn_done event

Live troubleshooting:

- If speaking does nothing in UI, check the Live page counters:
  - `Sent PCM chunks` should increase while recording
  - `Decode failures` should stay low
- If `Sent PCM chunks = 0`, browser decoding of tiny recorder chunks failed. The page now batches recorder chunks before decoding to PCM; try speaking for at least 1-2 seconds.
- If `no_speech` appears, raise mic input level or reduce background noise.

---

### 9. Frontend features

**Chat UI** (`/`):

- Modern dark “neumorphic” style
- Kyrgyz system prompt, short answers
- Chat messages with:
  - user / assistant labels
  - synthesized audio player
  - error blocks (if `/ask` fails)
- **Model toggle:** “Аял үн / Эркек үн”
  - Selected model persisted in `localStorage`

**Text → Audio UI** (`/tts-ui`):

- Large text area for custom Kyrgyz text
- Same female/male voice toggle
- Returns:
  - audio player
  - cleaned text actually used for TTS
- `Ctrl + Enter` / `Cmd + Enter` shortcut to synthesize

---

### 10. Running tests

From `kyrgyz-ai-service`:

```bash
pytest tests/ -v
```

Currently includes:

- `tests/test_text_pipeline.py` – Kyrgyz text → ID sequence sanity check
- `tests/test_tts_utils.py` – `intersperse()` behavior (Matcha-style)

---

### 11. Deploying / sharing

When pushing to GitHub:

- **Include:**
  - all `app/` code
  - `requirements.txt`, `Dockerfile`, `README.md`, `tests/`
- **Do NOT include:**
  - real `.env` values (especially `GROQ_API_KEY`)
  - large ONNX files if you prefer (you can host them elsewhere or provide a download link)

You can link to this README from the GitHub repo home page so others can:

1. Clone the repo  
2. Add their own `.env` and models  
3. Run `uvicorn app.main:app` or use Docker  

That’s it — the project is ready to be shared and run by other people.




git init
git add .
git commit -m "Initial Kyrgyz AI service"
git branch -M main
git remote add origin https://github.com/<your-username>/<your-repo>.git
git push -u origin main
