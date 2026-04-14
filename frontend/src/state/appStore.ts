import { create } from "zustand";
import type { HealthResponse, VoiceModel } from "../api/kyrgyzService";

export type TabKey = "chat" | "live" | "stt" | "tts";
export type WsStatus = "disconnected" | "connecting" | "connected" | "error";

export type ChatRole = "user" | "assistant" | "system" | "error";
export type ChatMessage = {
  id: string;
  role: ChatRole;
  text: string;
  createdAt: number;
  streaming?: boolean;
  audioUrls?: string[];
};

export type Conversation = {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: ChatMessage[];
};

type Persisted = {
  conversations: Conversation[];
  activeConversationId?: string;
  voice: VoiceModel;
};

function uid() {
  return `${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function loadPersisted(): Persisted | null {
  try {
    const raw = localStorage.getItem("ky_ai_state_v2");
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function savePersisted(p: Persisted) {
  try {
    localStorage.setItem("ky_ai_state_v2", JSON.stringify(p));
  } catch {
    // ignore
  }
}

function defaultConversation(): Conversation {
  const now = Date.now();
  return {
    id: uid(),
    title: "Ала-Тоо",
    createdAt: now,
    updatedAt: now,
    messages: [
      {
        id: uid(),
        role: "system",
        text:
          "Салам! Бул жерде кыргыз тилинде реал-тайм сүйлөшө аласыз. STT менен текстке айлантып, анан AI'га жибериңиз.",
        createdAt: now,
      },
    ],
  };
}

type AppState = {
  tab: TabKey;
  setTab: (tab: TabKey) => void;

  voice: VoiceModel;
  setVoice: (voice: VoiceModel) => void;

  health?: HealthResponse;
  setHealth: (health?: HealthResponse) => void;

  wsStatus: WsStatus;
  wsError?: string;
  setWsStatus: (s: WsStatus, err?: string) => void;

  sttText: string;
  setSttText: (text: string) => void;

  ttsText: string;
  setTtsText: (v: string) => void;
  ttsAudioUrl?: string;
  ttsCleaned?: string;
  setTtsResult: (r: { audioUrl?: string; cleaned?: string }) => void;

  busy: {
    health: boolean;
    tts: boolean;
    wsSend: boolean;
  };
  setBusy: (k: keyof AppState["busy"], v: boolean) => void;

  error?: string;
  setError: (e?: string) => void;

  chatInput: string;
  setChatInput: (v: string) => void;

  isAuthed: boolean;
  token?: string;
  setAuth: (token?: string) => void;
  syncFromServer: () => Promise<void>;
  loadMessagesForConversation: (id: string) => Promise<void>;

  conversations: Conversation[];
  activeConversationId?: string;
  activeConversation?: Conversation;

  newConversation: () => string;
  setActiveConversation: (id: string) => void;
  renameConversation: (id: string, title: string) => void;
  deleteConversation: (id: string) => void;

  pushMessage: (convId: string, msg: Omit<ChatMessage, "id" | "createdAt">) => string;
  upsertAssistantDelta: (convId: string, msgId: string, delta: string) => void;
  finishStreaming: (convId: string, msgId: string) => void;
  addAudioChunk: (convId: string, msgId: string, url: string) => void;
  clearConversation: (convId: string) => void;
};

export const useAppStore = create<AppState>((set, get) => {
  const persisted = loadPersisted();
  const seedVoice: VoiceModel = persisted?.voice || "female";
  const seedConvs = persisted?.conversations?.length
    ? persisted.conversations
    : [defaultConversation()];
  const seedActive = persisted?.activeConversationId || seedConvs[0]?.id;

  const persist = () => {
    const s = get();
    savePersisted({
      conversations: s.conversations,
      activeConversationId: s.activeConversationId,
      voice: s.voice,
    });
  };

  return {
    tab: "chat",
    setTab: (tab) => set({ tab }),

    voice: seedVoice,
    setVoice: (voice) => {
      set({ voice });
      persist();
    },

    health: undefined,
    setHealth: (health) => set({ health }),

    wsStatus: "disconnected",
    wsError: undefined,
    setWsStatus: (wsStatus, wsError) => set({ wsStatus, wsError }),

    sttText: "",
    setSttText: (sttText) => set({ sttText }),

    ttsText: "",
    setTtsText: (ttsText) => set({ ttsText }),
    ttsAudioUrl: undefined,
    ttsCleaned: undefined,
    setTtsResult: ({ audioUrl, cleaned }) =>
      set({ ttsAudioUrl: audioUrl, ttsCleaned: cleaned }),

    busy: { health: false, tts: false, wsSend: false },
    setBusy: (k, v) => set((s) => ({ busy: { ...s.busy, [k]: v } })),

    error: undefined,
    setError: (error) => set({ error }),

    chatInput: "",
    setChatInput: (chatInput) => set({ chatInput }),

    isAuthed: !!localStorage.getItem("ky_token"),
    token: localStorage.getItem("ky_token") || undefined,
    setAuth: (token) => {
      if (token) localStorage.setItem("ky_token", token);
      else localStorage.removeItem("ky_token");
      set({
        token: token || undefined,
        isAuthed: !!token,
        // when logging out, clear server-backed conversations in memory
        ...(token
          ? {}
          : {
              conversations: [defaultConversation()],
              activeConversationId: undefined,
            }),
      });
    },

    syncFromServer: async () => {
      const token = get().token || localStorage.getItem("ky_token");
      if (!token) return;
      const res = await fetch("/api/conversations", {
        headers: { authorization: `Bearer ${token}` },
      });
      if (!res.ok) return;
      const rows = (await res.json()) as { id: number; title: string; updated_at: string }[];
      const convs: Conversation[] = rows.map((r) => ({
        id: `db:${r.id}`,
        title: r.title,
        createdAt: Date.now(),
        updatedAt: new Date(r.updated_at).getTime(),
        messages: [],
      }));
      set((s) => ({
        conversations: convs.length ? convs : s.conversations,
        activeConversationId: convs[0]?.id || s.activeConversationId,
      }));
      // Load messages for active conversation
      const active = (convs[0]?.id || get().activeConversationId || "").replace("db:", "");
      if (active) {
        const mRes = await fetch(`/api/conversations/${active}/messages`, {
          headers: { authorization: `Bearer ${token}` },
        });
        if (mRes.ok) {
          const msgs = (await mRes.json()) as { id: number; role: string; content: string; created_at: string }[];
          set((s) => ({
            conversations: s.conversations.map((c) =>
              c.id === `db:${active}`
                ? {
                    ...c,
                    messages: msgs.map((m) => ({
                      id: `dbm:${m.id}`,
                      role: m.role as any,
                      text: m.content,
                      createdAt: new Date(m.created_at).getTime(),
                    })),
                  }
                : c,
            ),
          }));
        }
      }
    },

    loadMessagesForConversation: async (id: string) => {
      const token = get().token || localStorage.getItem("ky_token");
      if (!token) return;
      if (!id.startsWith("db:")) return;
      const convId = id.replace("db:", "");
      const mRes = await fetch(`/api/conversations/${convId}/messages`, {
        headers: { authorization: `Bearer ${token}` },
      });
      if (!mRes.ok) return;
      const msgs = (await mRes.json()) as { id: number; role: string; content: string; created_at: string }[];
      set((s) => ({
        conversations: s.conversations.map((c) =>
          c.id === id
            ? {
                ...c,
                messages: msgs.map((m) => ({
                  id: `dbm:${m.id}`,
                  role: m.role as any,
                  text: m.content,
                  createdAt: new Date(m.created_at).getTime(),
                })),
              }
            : c,
        ),
      }));
    },

    conversations: seedConvs,
    activeConversationId: seedActive,
    get activeConversation() {
      const s = get();
      return s.conversations.find((c) => c.id === s.activeConversationId);
    },

    newConversation: () => {
      const token = get().token || localStorage.getItem("ky_token");
      if (token) {
        // server-backed conversation (optimistic)
        const tempId = `tmp:${uid()}`;
        const now = Date.now();
        set((s) => ({
          conversations: [
            { id: tempId, title: "Ала-Тоо AI", createdAt: now, updatedAt: now, messages: [] },
            ...s.conversations,
          ],
          activeConversationId: tempId,
        }));
        fetch("/api/conversations", {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
          body: JSON.stringify({ title: "Ala-Too AI " }),
        })
          .then((r) => r.json())
          .then((data) => {
            const id = `db:${data.id}`;
            set((s) => ({
              conversations: s.conversations.map((c) =>
                c.id === tempId
                  ? { ...c, id, title: data.title || c.title, updatedAt: Date.now() }
                  : c,
              ),
              activeConversationId: s.activeConversationId === tempId ? id : s.activeConversationId,
            }));
          })
          .catch(() => {});
        return tempId;
      }
      const c = defaultConversation();
      set((s) => ({
        conversations: [c, ...s.conversations],
        activeConversationId: c.id,
      }));
      persist();
      return c.id;
    },

    setActiveConversation: (id) => {
      set({ activeConversationId: id });
      persist();
      const token = get().token || localStorage.getItem("ky_token");
      if (token && id.startsWith("db:")) {
        get().loadMessagesForConversation(id).catch(() => {});
      }
    },

    renameConversation: (id, title) => {
      const t = title.trim() || "Чат";
      const token = get().token || localStorage.getItem("ky_token");
      if (token && id.startsWith("db:")) {
        const convId = id.replace("db:", "");
        fetch(`/api/conversations/${convId}`, {
          method: "PATCH",
          headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
          body: JSON.stringify({ title: t }),
        }).catch(() => {});
      }
      set((s) => ({
        conversations: s.conversations.map((c) =>
          c.id === id ? { ...c, title: t, updatedAt: Date.now() } : c,
        ),
      }));
      persist();
    },

    deleteConversation: (id) => {
      const token = get().token || localStorage.getItem("ky_token");
      if (token && id.startsWith("db:")) {
        const convId = id.replace("db:", "");
        fetch(`/api/conversations/${convId}`, {
          method: "DELETE",
          headers: { authorization: `Bearer ${token}` },
        }).catch(() => {});
      }
      set((s) => {
        const next = s.conversations.filter((c) => c.id !== id);
        const nextActive =
          s.activeConversationId === id ? next[0]?.id : s.activeConversationId;
        return { conversations: next.length ? next : [defaultConversation()], activeConversationId: nextActive };
      });
      persist();
    },

    pushMessage: (convId, msg) => {
      const mId = uid();
      const now = Date.now();
      const token = get().token || localStorage.getItem("ky_token");
      if (token && convId.startsWith("db:") && (msg.role === "user" || msg.role === "assistant" || msg.role === "system")) {
        const dbConvId = convId.replace("db:", "");
        fetch(`/api/conversations/${dbConvId}/messages`, {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
          body: JSON.stringify({ role: msg.role, content: msg.text }),
        }).catch(() => {});
      }
      set((s) => ({
        conversations: s.conversations.map((c) =>
          c.id === convId
            ? {
                ...c,
                updatedAt: now,
                messages: [...c.messages, { ...msg, id: mId, createdAt: now }],
              }
            : c,
        ),
      }));
      persist();
      return mId;
    },

    upsertAssistantDelta: (convId, msgId, delta) => {
      set((s) => ({
        conversations: s.conversations.map((c) => {
          if (c.id !== convId) return c;
          return {
            ...c,
            updatedAt: Date.now(),
            messages: c.messages.map((m) =>
              m.id === msgId ? { ...m, text: (m.text || "") + delta } : m,
            ),
          };
        }),
      }));
      persist();
    },

    finishStreaming: (convId, msgId) => {
      set((s) => ({
        conversations: s.conversations.map((c) => {
          if (c.id !== convId) return c;
          return {
            ...c,
            updatedAt: Date.now(),
            messages: c.messages.map((m) =>
              m.id === msgId ? { ...m, streaming: false } : m,
            ),
          };
        }),
      }));
      persist();
    },

    addAudioChunk: (convId, msgId, url) => {
      set((s) => ({
        conversations: s.conversations.map((c) => {
          if (c.id !== convId) return c;
          return {
            ...c,
            updatedAt: Date.now(),
            messages: c.messages.map((m) =>
              m.id === msgId
                ? { ...m, audioUrls: [...(m.audioUrls || []), url] }
                : m,
            ),
          };
        }),
      }));
      persist();
    },

    clearConversation: (convId) => {
      const now = Date.now();
      set((s) => ({
        conversations: s.conversations.map((c) =>
          c.id === convId
            ? {
                ...c,
                updatedAt: now,
                messages: c.messages.filter((m) => m.role === "system").slice(0, 1),
              }
            : c,
        ),
      }));
      persist();
    },
  };
});

