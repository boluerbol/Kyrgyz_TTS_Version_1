import type { VoiceModel } from "../api/kyrgyzService";

export type WsServerEvent =
  | { type: "text_start" }
  | { type: "text_delta"; delta: string }
  | { type: "text_done"; text: string }
  | { type: "audio_chunk"; audio_url: string; cleaned_text?: string }
  | { type: "audio_final"; audio_url: string; cleaned_text?: string }
  | { type: "warn"; message: string }
  | { type: "error"; message: string }
  | { type: "done" }
  | { type: "reset_ok" };

export type WsClientMessage =
  | { type: "reset" }
  | {
      type: "user_message";
      message: string;
      model: VoiceModel;
      stream_audio: boolean;
      conversation_id?: number;
      history?: { role: "user" | "assistant"; content: string }[];
    };

type Handlers = {
  onStatus: (s: "connecting" | "connected" | "disconnected" | "error", err?: string) => void;
  onEvent: (e: WsServerEvent) => void;
};

export class KyrgyzWsClient {
  private ws: WebSocket | null = null;
  private handlers: Handlers;
  private url: string;
  private queue: WsClientMessage[] = [];
  private manuallyClosed = false;

  constructor(handlers: Handlers, token?: string) {
    this.handlers = handlers;
    const proto = window.location.protocol === "https:" ? "wss" : "ws";
    const qp = token ? `?token=${encodeURIComponent(token)}` : "";
    this.url = `${proto}://${window.location.host}/ws${qp}`;
  }

  connect() {
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }

    this.manuallyClosed = false;
    this.handlers.onStatus("connecting");
    const ws = new WebSocket(this.url);
    this.ws = ws;

    ws.onopen = () => {
      this.handlers.onStatus("connected");
      const q = [...this.queue];
      this.queue = [];
      q.forEach((m) => this.send(m));
    };

    ws.onclose = () => {
      this.ws = null;
      this.handlers.onStatus("disconnected");
      if (!this.manuallyClosed) {
        // simple reconnect with backoff-ish delay
        setTimeout(() => this.connect(), 900);
      }
    };

    ws.onerror = () => {
      this.handlers.onStatus("error", "WebSocket error");
    };

    ws.onmessage = (evt) => {
      try {
        const data = JSON.parse(evt.data) as WsServerEvent;
        this.handlers.onEvent(data);
      } catch {
        // ignore
      }
    };
  }

  close() {
    this.manuallyClosed = true;
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.handlers.onStatus("disconnected");
  }

  send(message: WsClientMessage) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      this.queue.push(message);
      this.connect();
      return;
    }
    this.ws.send(JSON.stringify(message));
  }
}

