import { useEffect, useMemo, useRef, useState } from "react";
import { apiSttModels, apiWarmupSttModel, type SttModelInfo } from "../../api/kyrgyzService";
import type { Transcriber } from "../../hooks/useTranscriber";
import { useAppStore } from "../../state/appStore";

type LiveServerEvent =
  | { type: "live_ready"; sample_rate: number; default_stt_model?: string }
  | { type: "listening"; model: "female" | "male"; stt_model?: string }
  | { type: "speech_start" }
  | { type: "turn_start"; turn_id: number; trigger: string }
  | { type: "transcript"; turn_id: number; text: string }
  | { type: "llm_delta"; turn_id: number; delta: string }
  | { type: "llm_done"; turn_id: number; text: string }
  | { type: "audio_chunk_meta"; turn_id: number; seq: number; text: string; sample_rate: number; mime: string }
  | { type: "turn_done"; turn_id: number }
  | { type: "interrupted"; reason: string }
  | { type: "no_speech"; turn_id: number }
  | { type: "warn"; code?: string; requested?: string; selected?: string }
  | { type: "error"; message: string };

function downsampleFloat32(input: Float32Array, inRate: number, outRate: number): Float32Array {
  if (inRate === outRate) return input;
  const ratio = inRate / outRate;
  const outLen = Math.max(1, Math.round(input.length / ratio));
  const out = new Float32Array(outLen);
  let pos = 0;
  for (let i = 0; i < outLen; i++) {
    const nextPos = Math.min(input.length, Math.round((i + 1) * ratio));
    let sum = 0;
    let count = 0;
    for (let j = pos; j < nextPos; j++) {
      sum += input[j];
      count += 1;
    }
    out[i] = count ? sum / count : 0;
    pos = nextPos;
  }
  return out;
}

function floatToInt16(input: Float32Array): Int16Array {
  const out = new Int16Array(input.length);
  for (let i = 0; i < input.length; i++) {
    const s = Math.max(-1, Math.min(1, input[i]));
    out[i] = s < 0 ? s * 32768 : s * 32767;
  }
  return out;
}

type PlaybackChunk = {
  audio: ArrayBuffer;
  seq?: number;
  text?: string;
};

type LivePageProps = {
  setTab: (tab: string) => void;
  transcriber: Transcriber;
};

export default function LivePage({ setTab, transcriber }: LivePageProps) {
  const token = useAppStore((s) => s.token);
  const voice = useAppStore((s) => s.voice);
  const sttLiveModel = useAppStore((s) => s.sttLiveModel);
  const setSttLiveModel = useAppStore((s) => s.setSttLiveModel);
  const conversations = useAppStore((s) => s.conversations);
  const activeConversationId = useAppStore((s) => s.activeConversationId);
  const syncFromServer = useAppStore((s) => s.syncFromServer);

  const wsRef = useRef<WebSocket | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const captureAudioCtxRef = useRef<AudioContext | null>(null);
  const captureSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const captureProcessorRef = useRef<ScriptProcessorNode | null>(null);
  const playAudioCtxRef = useRef<AudioContext | null>(null);
  const browserRecorderRef = useRef<MediaRecorder | null>(null);
  const browserChunksRef = useRef<Blob[]>([]);
  const browserPendingSendRef = useRef(false);
  const browserTranscribeTimeoutRef = useRef<number | null>(null);
  const connectPromiseRef = useRef<Promise<void> | null>(null);
  const connectResolveRef = useRef<(() => void) | null>(null);
  const connectRejectRef = useRef<((err?: unknown) => void) | null>(null);

  const queueRef = useRef<PlaybackChunk[]>([]);
  const pendingMetaRef = useRef<Array<{ seq?: number; text?: string }>>([]);
  const isPlayingRef = useRef(false);

  const [status, setStatus] = useState("disconnected");
  const [recording, setRecording] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [assistantText, setAssistantText] = useState("");
  const [turnId, setTurnId] = useState<number | null>(null);
  const [lastError, setLastError] = useState<string | null>(null);
  const [queueDepth, setQueueDepth] = useState(0);
  const [currentChunkLabel, setCurrentChunkLabel] = useState("-");
  const [sentPcmChunks, setSentPcmChunks] = useState(0);
  const [decodeFailures, setDecodeFailures] = useState(0);
  const [persistTurn, setPersistTurn] = useState(true);
  const [persistState, setPersistState] = useState("idle");
  const [persistConversationId, setPersistConversationId] = useState<string>("");
  const [liveSttModels, setLiveSttModels] = useState<SttModelInfo[]>([]);
  const [warmingUp, setWarmingUp] = useState(false);
  const [browserTranscribing, setBrowserTranscribing] = useState(false);
  const transcriptRef = useRef("");
  const assistantTextRef = useRef("");

  const dbConversations = useMemo(
    () => conversations.filter((c) => c.id.startsWith("db:")),
    [conversations],
  );

  const persistableConversationId = useMemo(() => {
    if (persistConversationId) return persistConversationId;
    if (activeConversationId && activeConversationId.startsWith("db:")) {
      return activeConversationId.replace("db:", "");
    }
    return dbConversations[0]?.id.replace("db:", "") || null;
  }, [activeConversationId, dbConversations, persistConversationId]);

  useEffect(() => {
    if (!persistConversationId && activeConversationId?.startsWith("db:")) {
      setPersistConversationId(activeConversationId.replace("db:", ""));
    }
  }, [activeConversationId, persistConversationId]);

  useEffect(() => {
    let aborted = false;
    apiSttModels()
      .then((payload) => {
        if (aborted) return;
        const models = [
          ...(payload.models || []).filter((m) => m.supports_live),
          ...(payload.browser_models || []).filter((m) => m.supports_browser),
        ];
        setLiveSttModels(models);
        const hasSelectedReady = models.find((m) => m.id === sttLiveModel && m.ready !== false);
        if (!hasSelectedReady) {
          const fallback = payload.default || models.find((m) => m.ready !== false)?.id || models[0]?.id;
          if (fallback) {
            setSttLiveModel(fallback);
          }
        }
      })
      .catch(() => {
        if (aborted) return;
        setLiveSttModels([]);
      });

    return () => {
      aborted = true;
    };
  }, [setSttLiveModel, sttLiveModel]);

  useEffect(() => {
    transcriptRef.current = transcript;
  }, [transcript]);

  useEffect(() => {
    assistantTextRef.current = assistantText;
  }, [assistantText]);

  useEffect(() => {
    const pending = browserPendingSendRef.current;
    const text = (transcriber.output?.text || "").trim();
    if (!pending || !text) return;
    if (browserTranscribeTimeoutRef.current) {
      window.clearTimeout(browserTranscribeTimeoutRef.current);
      browserTranscribeTimeoutRef.current = null;
    }
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      setLastError("Live WebSocket is not connected");
      browserPendingSendRef.current = false;
      setBrowserTranscribing(false);
      return;
    }
    browserPendingSendRef.current = false;
    setBrowserTranscribing(false);
    ws.send(JSON.stringify({ type: "browser_turn", text }));
  }, [transcriber.output?.text]);

  useEffect(() => {
    if (!browserPendingSendRef.current) return;
    if (transcriber.isBusy) return;
    if ((transcriber.output?.text || "").trim()) return;
    browserPendingSendRef.current = false;
    setBrowserTranscribing(false);
    if (browserTranscribeTimeoutRef.current) {
      window.clearTimeout(browserTranscribeTimeoutRef.current);
      browserTranscribeTimeoutRef.current = null;
    }
    setLastError("Browser STT returned no text");
  }, [transcriber.isBusy, transcriber.output?.text]);

  const connected = useMemo(() => status === "connected", [status]);
  const selectedLiveModel = useMemo(
    () => liveSttModels.find((m) => m.id === sttLiveModel),
    [liveSttModels, sttLiveModel],
  );
  const browserMode = !!selectedLiveModel?.supports_browser;

  useEffect(() => {
    if (browserMode && selectedLiveModel?.id) {
      transcriber.setModel(selectedLiveModel.id);
    }
  }, [browserMode, selectedLiveModel?.id, transcriber]);

  const clearPlaybackQueue = () => {
    queueRef.current = [];
    pendingMetaRef.current = [];
    setQueueDepth(0);
  };

  const stopPlaybackNow = async () => {
    clearPlaybackQueue();
    isPlayingRef.current = false;
    if (playAudioCtxRef.current && playAudioCtxRef.current.state !== "closed") {
      await playAudioCtxRef.current.close();
    }
    playAudioCtxRef.current = null;
  };

  const stopCapturePipeline = async () => {
    if (captureProcessorRef.current) {
      captureProcessorRef.current.disconnect();
      captureProcessorRef.current.onaudioprocess = null;
      captureProcessorRef.current = null;
    }
    if (captureSourceRef.current) {
      captureSourceRef.current.disconnect();
      captureSourceRef.current = null;
    }
    if (captureAudioCtxRef.current && captureAudioCtxRef.current.state !== "closed") {
      await captureAudioCtxRef.current.close();
    }
    captureAudioCtxRef.current = null;
  };

  const stopBrowserRecorder = () => {
    const recorder = browserRecorderRef.current;
    browserRecorderRef.current = null;
    if (recorder && recorder.state !== "inactive") {
      recorder.stop();
    }
  };

  const playNext = async () => {
    if (isPlayingRef.current) return;
    const next = queueRef.current.shift();
    setQueueDepth(queueRef.current.length);
    if (!next) return;

    isPlayingRef.current = true;
    setCurrentChunkLabel(next.seq ? `#${next.seq} ${next.text || ""}` : next.text || "(audio)");
    try {
      if (!playAudioCtxRef.current || playAudioCtxRef.current.state === "closed") {
        playAudioCtxRef.current = new AudioContext();
      }
      const ctx = playAudioCtxRef.current;
      const audio = await ctx.decodeAudioData(next.audio.slice(0));
      const source = ctx.createBufferSource();
      source.buffer = audio;
      source.connect(ctx.destination);
      source.onended = () => {
        isPlayingRef.current = false;
        setCurrentChunkLabel("-");
        void playNext();
      };
      source.start(0);
    } catch (err) {
      isPlayingRef.current = false;
      setCurrentChunkLabel("-");
      setLastError("Audio playback failed");
    }
  };

  const persistLiveTurn = async (userText: string, aiText: string) => {
    if (!persistTurn) return;
    if (!token) return;
    if (!persistableConversationId) {
      setPersistState("no-db-conversation");
      return;
    }
    if (persistableConversationId === "undefined" || persistableConversationId === "null") {
      setPersistState("no-db-conversation");
      return;
    }

    try {
      setPersistState("saving");
      const headers = {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      };

      const userRes = await fetch(`/api/conversations/${persistableConversationId}/messages`, {
        method: "POST",
        headers,
        body: JSON.stringify({ role: "user", content: userText }),
      });
      if (!userRes.ok) throw new Error(`user save failed: ${userRes.status}`);

      const aiRes = await fetch(`/api/conversations/${persistableConversationId}/messages`, {
        method: "POST",
        headers,
        body: JSON.stringify({ role: "assistant", content: aiText }),
      });
      if (!aiRes.ok) throw new Error(`assistant save failed: ${aiRes.status}`);

      await syncFromServer();
      setPersistState("saved");
    } catch (err: any) {
      setPersistState("error");
      setLastError(err?.message || "Persist failed");
    }
  };

  const sendInterrupt = () => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ type: "interrupt", reason: "client_interrupt" }));
  };

  const handleServerEvent = async (evt: LiveServerEvent) => {
    switch (evt.type) {
      case "turn_start":
        setTurnId(evt.turn_id);
        setAssistantText("");
        break;
      case "transcript":
        setTranscript(evt.text);
        break;
      case "llm_delta":
        setAssistantText((prev) => prev + evt.delta);
        break;
      case "audio_chunk_meta":
        pendingMetaRef.current.push({ seq: evt.seq, text: evt.text });
        break;
      case "no_speech":
        setLastError("No speech detected. Try speaking louder or pause less.");
        break;
      case "turn_done":
        if (transcriptRef.current.trim() && assistantTextRef.current.trim()) {
          void persistLiveTurn(transcriptRef.current.trim(), assistantTextRef.current.trim());
        }
        break;
      case "interrupted":
        await stopPlaybackNow();
        break;
      case "warn":
        if (evt.code === "stt_model_fallback" && evt.selected) {
          setSttLiveModel(evt.selected);
          setLastError(`Requested STT model is unavailable, using ${evt.selected}`);
        }
        break;
      case "error":
        setLastError(evt.message);
        break;
      default:
        break;
    }
  };

  const connectWs = async () => {
    if (wsRef.current && (wsRef.current.readyState === WebSocket.OPEN || wsRef.current.readyState === WebSocket.CONNECTING)) {
      return connectPromiseRef.current || Promise.resolve();
    }

    if (connectPromiseRef.current) {
      return connectPromiseRef.current;
    }

    let settled = false;
    connectPromiseRef.current = new Promise<void>((resolve, reject) => {
      connectResolveRef.current = () => {
        if (settled) return;
        settled = true;
        connectPromiseRef.current = null;
        connectResolveRef.current = null;
        connectRejectRef.current = null;
        resolve();
      };
      connectRejectRef.current = (err?: unknown) => {
        if (settled) return;
        settled = true;
        connectPromiseRef.current = null;
        connectResolveRef.current = null;
        connectRejectRef.current = null;
        reject(err);
      };
    });

    const proto = window.location.protocol === "https:" ? "wss" : "ws";
    const host = window.location.port === "5173" ? "127.0.0.1:8000" : window.location.host;
    const qp = token ? `?token=${encodeURIComponent(token)}` : "";
    const ws = new WebSocket(`${proto}://${host}/ws/live${qp}`);
    ws.binaryType = "arraybuffer";
    wsRef.current = ws;

    setStatus("connecting");

    ws.onopen = () => {
      setStatus("connected");
      setLastError(null);
      connectResolveRef.current?.();
      ws.send(JSON.stringify({
        type: "start",
        model: voice,
        ...(browserMode ? {} : { stt_model: sttLiveModel }),
      }));
    };

    ws.onclose = (ev) => {
      setStatus("disconnected");
      if (ev.code !== 1000) {
        setLastError(`Live WS closed (code ${ev.code})`);
      }
      wsRef.current = null;
      if (status !== "connected") {
        connectRejectRef.current?.(new Error("Live WebSocket closed before opening"));
      }
    };

    ws.onerror = () => {
      setStatus("error");
      setLastError("Live WebSocket error");
      connectRejectRef.current?.(new Error("Live WebSocket error"));
    };

    ws.onmessage = (msg) => {
      if (typeof msg.data === "string") {
        try {
          const event = JSON.parse(msg.data) as LiveServerEvent;
          void handleServerEvent(event);
        } catch {
          setLastError("Invalid live event payload");
        }
        return;
      }

      if (msg.data instanceof ArrayBuffer) {
        const meta = pendingMetaRef.current.shift();
        queueRef.current.push({ audio: msg.data, seq: meta?.seq, text: meta?.text });
        setQueueDepth(queueRef.current.length);
        void playNext();
        return;
      }

      if (msg.data instanceof Blob) {
        void msg.data.arrayBuffer().then((buf) => {
          const meta = pendingMetaRef.current.shift();
          queueRef.current.push({ audio: buf, seq: meta?.seq, text: meta?.text });
          setQueueDepth(queueRef.current.length);
          void playNext();
        });
      }
    };
  };

  const disconnectWs = async () => {
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    await stopPlaybackNow();
    setStatus("disconnected");
  };

  const startRecording = async () => {
    if (recording) return;
    if (!connected) {
      try {
        await connectWs();
      } catch (err) {
        setLastError(err instanceof Error ? err.message : "Live WebSocket connect failed");
        return;
      }
    }

    if (!streamRef.current) {
      streamRef.current = await navigator.mediaDevices.getUserMedia({ audio: true });
    }

    sendInterrupt();
    await stopPlaybackNow();

    if (browserMode) {
      try {
        await stopCapturePipeline();
        stopBrowserRecorder();
        browserChunksRef.current = [];
        transcriber.onInputChange();

        const recorder = new MediaRecorder(streamRef.current);
        browserRecorderRef.current = recorder;
        recorder.ondataavailable = (event) => {
          if (event.data.size > 0) {
            browserChunksRef.current.push(event.data);
          }
        };
        recorder.onstop = async () => {
          try {
            const blob = new Blob(browserChunksRef.current, { type: recorder.mimeType || "audio/webm" });
            browserChunksRef.current = [];
            const audioCtx = new AudioContext({ latencyHint: "interactive" });
            const audioBuffer = await audioCtx.decodeAudioData(await blob.arrayBuffer());
            await audioCtx.close();
            browserPendingSendRef.current = true;
            setBrowserTranscribing(true);
            if (browserTranscribeTimeoutRef.current) {
              window.clearTimeout(browserTranscribeTimeoutRef.current);
            }
            browserTranscribeTimeoutRef.current = window.setTimeout(() => {
              browserPendingSendRef.current = false;
              setBrowserTranscribing(false);
              setLastError("Browser STT timed out");
            }, 30000);
            transcriber.start(audioBuffer);
          } catch {
            browserPendingSendRef.current = false;
            setBrowserTranscribing(false);
            setLastError("Browser STT failed");
          }
        };
        recorder.start();
        setRecording(true);
        return;
      } catch {
        setLastError("Browser recording init failed");
        return;
      }
    }

    try {
      await stopCapturePipeline();
      const ctx = new AudioContext({ latencyHint: "interactive" });
      captureAudioCtxRef.current = ctx;
      const source = ctx.createMediaStreamSource(streamRef.current);
      captureSourceRef.current = source;
      const processor = ctx.createScriptProcessor(4096, 1, 1);
      captureProcessorRef.current = processor;

      processor.onaudioprocess = (event: AudioProcessingEvent) => {
        const ws = wsRef.current;
        if (!ws || ws.readyState !== WebSocket.OPEN) return;
        try {
          const mono = event.inputBuffer.getChannelData(0);
          const down = downsampleFloat32(mono, event.inputBuffer.sampleRate, 16000);
          const pcm16 = floatToInt16(down);
          ws.send(pcm16.buffer);
          setSentPcmChunks((v) => v + 1);
        } catch {
          setDecodeFailures((v) => v + 1);
        }
      };

      source.connect(processor);
      processor.connect(ctx.destination);
    } catch {
      setLastError("Microphone capture init failed");
      setDecodeFailures((v) => v + 1);
      return;
    }

    setRecording(true);
  };

  const stopRecording = () => {
    void (async () => {
      if (browserMode) {
        stopBrowserRecorder();
      } else {
        await stopCapturePipeline();
      }
      if (browserTranscribeTimeoutRef.current) {
        window.clearTimeout(browserTranscribeTimeoutRef.current);
        browserTranscribeTimeoutRef.current = null;
      }
      browserPendingSendRef.current = false;
      setBrowserTranscribing(false);
      const ws = wsRef.current;
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "stop" }));
      }
      setRecording(false);
    })();
  };

  useEffect(() => {
    setTab("live");
  }, [setTab]);

  useEffect(() => {
    return () => {
      stopRecording();
      void disconnectWs();
      void stopCapturePipeline();
      if (browserTranscribeTimeoutRef.current) {
        window.clearTimeout(browserTranscribeTimeoutRef.current);
        browserTranscribeTimeoutRef.current = null;
      }
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
      }
    };
  }, []);

  return (
    <div className="h-full overflow-y-auto">
      <div className="p-6 max-w-4xl mx-auto space-y-4">
      <h2 className="text-2xl font-bold dark:text-white">Live Mode</h2>
      <p className="text-sm text-slate-500 dark:text-slate-300">
        Real-time voice loop: microphone {'->'} {browserMode ? "browser STT" : "server STT"} {'->'} assistant stream {'->'} sentence TTS {'->'} streamed audio playback.
      </p>

      <div className="flex gap-2 flex-wrap">
        <select
          className="px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
          value={sttLiveModel}
          onChange={(e) => setSttLiveModel(e.target.value)}
          disabled={connected}
        >
          {liveSttModels.length === 0 ? (
            <option value={sttLiveModel}>{sttLiveModel}</option>
          ) : (
            liveSttModels.map((m) => (
              <option key={m.id} value={m.id} disabled={m.ready === false}>
                {m.ready === false
                  ? `${m.label} (not ready)`
                  : m.supports_browser
                    ? `${m.label} (local browser)`
                    : m.label}
              </option>
            ))
          )}
        </select>
        <button
          className="px-4 py-2 rounded-xl bg-indigo-600 text-white disabled:opacity-50"
          disabled={warmingUp || connected || browserMode}
          onClick={async () => {
            setWarmingUp(true);
            setLastError(null);
            try {
              await apiWarmupSttModel(sttLiveModel);
              const payload = await apiSttModels();
              const models = [
                ...(payload.models || []).filter((m) => m.supports_live),
                ...(payload.browser_models || []).filter((m) => m.supports_browser),
              ];
              setLiveSttModels(models);
            } catch (e: any) {
              setLastError(e?.message || "Warmup failed");
            } finally {
              setWarmingUp(false);
            }
          }}
        >
          {browserMode ? "Browser STT" : warmingUp ? "Warming..." : "Warmup STT"}
        </button>
        <button
          className="px-4 py-2 rounded-xl bg-slate-900 text-white disabled:opacity-50"
          onClick={connectWs}
          disabled={connected}
        >
          Connect
        </button>
        <button
          className="px-4 py-2 rounded-xl bg-slate-300 text-slate-900 disabled:opacity-50"
          onClick={() => void disconnectWs()}
          disabled={!connected}
        >
          Disconnect
        </button>
        <button
          className="px-4 py-2 rounded-xl bg-emerald-600 text-white disabled:opacity-50"
          onClick={() => void startRecording()}
          disabled={!connected || recording}
        >
          {browserMode ? "Record + Transcribe" : "Start Talking"}
        </button>
        <button
          className="px-4 py-2 rounded-xl bg-rose-600 text-white disabled:opacity-50"
          onClick={stopRecording}
          disabled={!recording}
        >
          Stop Talking
        </button>
        <button
          className="px-4 py-2 rounded-xl bg-amber-500 text-white disabled:opacity-50"
          onClick={() => {
            sendInterrupt();
            void stopPlaybackNow();
          }}
          disabled={!connected}
        >
          Interrupt
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="rounded-xl border border-slate-200 dark:border-slate-700 p-4">
          <div className="text-xs uppercase text-slate-500 mb-2">Status</div>
          <div className="font-semibold">{status}</div>
          <div className="text-sm text-slate-600 dark:text-slate-300 mt-2">Turn: {turnId ?? "-"}</div>
          <div className="text-sm text-slate-600 dark:text-slate-300 mt-1">Queue depth: {queueDepth}</div>
          <div className="text-sm text-slate-600 dark:text-slate-300 mt-1">Playing chunk: {currentChunkLabel}</div>
          <div className="text-sm text-slate-600 dark:text-slate-300 mt-1">Sent PCM chunks: {sentPcmChunks}</div>
          <div className="text-sm text-slate-600 dark:text-slate-300 mt-1">Decode failures: {decodeFailures}</div>
          {browserTranscribing && <div className="text-sm text-slate-600 dark:text-slate-300 mt-1">Browser STT: transcribing...</div>}
          {lastError && <div className="text-sm text-rose-500 mt-2">{lastError}</div>}
        </div>

        <div className="rounded-xl border border-slate-200 dark:border-slate-700 p-4">
          <div className="text-xs uppercase text-slate-500 mb-2">Transcript</div>
          <div className="text-sm whitespace-pre-wrap">{transcript || "..."}</div>
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 dark:border-slate-700 p-4">
        <div className="text-xs uppercase text-slate-500 mb-2">Persistence</div>
        <div className="flex items-center gap-3 flex-wrap">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={persistTurn}
              onChange={(e) => setPersistTurn(e.target.checked)}
            />
            Save completed turns to active conversation
          </label>
          <span className="text-xs text-slate-500">Active: {activeConversationId || "none"}</span>
          <span className="text-xs text-slate-500">State: {persistState}</span>
        </div>
        {dbConversations.length > 0 && (
          <div className="mt-2 flex items-center gap-2">
            <span className="text-xs text-slate-500">Save to:</span>
            <select
              className="text-xs rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 py-1"
              value={persistableConversationId || ""}
              onChange={(e) => setPersistConversationId(e.target.value)}
            >
              {dbConversations.map((c) => (
                <option key={c.id} value={c.id.replace("db:", "")}>
                  {c.title}
                </option>
              ))}
            </select>
          </div>
        )}
        {!persistableConversationId && persistTurn && (
          <div className="text-xs text-amber-600 mt-2">
            Active conversation is not server-backed (`db:*`). Select a synced conversation in Chat to persist live turns.
          </div>
        )}
        {conversations.length > 0 && (
          <div className="text-xs text-slate-500 mt-2">Available conversations: {conversations.length} (server: {dbConversations.length})</div>
        )}
      </div>

      <div className="rounded-xl border border-slate-200 dark:border-slate-700 p-4">
        <div className="text-xs uppercase text-slate-500 mb-2">Assistant Stream</div>
        <div className="text-sm whitespace-pre-wrap min-h-[120px]">{assistantText || "..."}</div>
      </div>
      </div>
    </div>
  );
}
