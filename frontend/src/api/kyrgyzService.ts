export type VoiceModel = "female" | "male";

export type SttModelInfo = {
  id: string;
  label: string;
  provider?: string;
  supports_live: boolean;
  supports_browser: boolean;
  ready?: boolean;
  warmed?: boolean;
  detail?: string;
};

export type SttModelsResponse = {
  default: string;
  models: SttModelInfo[];
  browser_models: SttModelInfo[];
};

export type HealthResponse = {
  ok: boolean;
  models: {
    female: { path: string; loaded: boolean };
    male: { path: string; loaded: boolean };
  };
  groq_configured: boolean;
  details: string[];
};

export type TtsResponse = {
  kyrgyz_text: string;
  cleaned_text: string;
  audio_url: string;
};

export async function apiHealth(signal?: AbortSignal): Promise<HealthResponse> {
  const res = await fetch(`/health`, { signal });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function apiTts(body: {
  text: string;
  model: VoiceModel;
}): Promise<TtsResponse> {
  const token = localStorage.getItem("ky_token");
  if (!token) {
    console.error("TTS Attempted without token!");
  }
  const res = await fetch(`/api/tts`, {
    method: "POST",
    headers: { 
      "content-type": "application/json",
      ...(token && { Authorization: `Bearer ${token}` })
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(errorData.detail || `Server error: ${res.status}`);
  }
  return res.json();
}

export async function apiAsk(body: {
  message: string;
  model: VoiceModel;
}): Promise<TtsResponse> {
  const res = await fetch(`/ask`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    credentials: "include",
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function apiSttModels(signal?: AbortSignal): Promise<SttModelsResponse> {
  const res = await fetch(`/api/stt-models`, { signal });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function apiWarmupSttModel(model_id?: string): Promise<{ ok: boolean; models: SttModelInfo[] }> {
  const res = await fetch(`/api/stt-models/warmup`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model_id: model_id || null }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

