# Kyrgyz AI Web (Frontend)

React/Vite web app for the diploma project:

- **STT (Speech-to-Text)**: runs **in the browser** using Transformers.js + web worker
- **Realtime chat (Gemini-style)**: streaming text via **WebSocket** (`/ws`)
- **TTS (Text-to-Speech)**: calls the FastAPI backend (`/tts`) to synthesize Kyrgyz speech

This frontend is designed to be served by the backend service in `../kyrgyz-ai-service/`.

---

## Run (dev)

```bash
cd whisper-web
npm install
npm run dev
```

Then open the Vite URL (usually `http://localhost:5173/`).

> Note: In dev mode, the frontend expects the backend to run at the same origin. For simplest development, run the backend on `http://127.0.0.1:8000/` and use the production build served by FastAPI (next section).

---

## Build (production)

```bash
cd whisper-web
npm install
npm run build
```

To make the backend serve this UI at `/`, run:

```powershell
.\kyrgyz-ai-service\scripts\build_frontend.ps1
```
