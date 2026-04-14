import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { apiHealth, apiTts } from "./api/kyrgyzService";
import { AudioManager } from "./components/AudioManager";
import Transcript from "./components/Transcript";
import { ChatComposer } from "./components/chat/ChatComposer";
import { MessageBubble } from "./components/chat/MessageBubble";
import { Sidebar } from "./components/layout/Sidebar";
import { Tabs } from "./components/ui/Tabs";
import { VoiceToggle } from "./components/ui/VoiceToggle";
import { useTranscriber } from "./hooks/useTranscriber";
import { KyrgyzWsClient } from "./realtime/wsClient";
import { useAppStore } from "./state/appStore";
// import { LoginPanel } from "./components/auth/LoginPanel";
import type { VoiceModel } from './api/kyrgyzService';
// src/App.tsx
import { useUiStore } from './state/uiStore';
import AppRoutes from './AppRoutes';

function App() {
    const theme = useUiStore((s) => s.theme);
    const transcriber = useTranscriber();
    const health = useAppStore((s) => s.health);
    const setHealth = useAppStore((s) => s.setHealth);
    const busy = useAppStore((s) => s.busy);
    const setBusy = useAppStore((s) => s.setBusy);
    const error = useAppStore((s) => s.error);
    const setError = useAppStore((s) => s.setError);
    const tab = useAppStore((s) => s.tab);
    const setTab = useAppStore((s) => s.setTab);
    const voice = useAppStore((s) => s.voice as VoiceModel);
    const wsStatus = useAppStore((s) => s.wsStatus);
    const setWsStatus = useAppStore((s) => s.setWsStatus);

    const sttText = useAppStore((s) => s.sttText);
    const setSttText = useAppStore((s) => s.setSttText);

    const activeConversationId = useAppStore((s) => s.activeConversationId);
    const conversations = useAppStore((s) => s.conversations);
    const activeConversation = useMemo(() => 
      conversations.find(c => c.id === activeConversationId), 
      [conversations, activeConversationId]
    );
    // const activeConversation = useAppStore((s) => s.activeConversation);
    const pushMessage = useAppStore((s) => s.pushMessage);
    const upsertAssistantDelta = useAppStore((s) => s.upsertAssistantDelta);
    const finishStreaming = useAppStore((s) => s.finishStreaming);
    const addAudioChunk = useAppStore((s) => s.addAudioChunk);
    const clearConversation = useAppStore((s) => s.clearConversation);
    const setChatInput = useAppStore((s) => s.setChatInput);

    const ttsText = useAppStore((s) => s.ttsText);
    const setTtsText = useAppStore((s) => s.setTtsText);
    const ttsAudioUrl = useAppStore((s) => s.ttsAudioUrl);
    const ttsCleaned = useAppStore((s) => s.ttsCleaned);
    const setTtsResult = useAppStore((s) => s.setTtsResult);

    const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
    const [authedEmail, setAuthedEmail] = useState<string | undefined>(() => localStorage.getItem("ky_authed_email") || undefined);
    const [authedName, setAuthedName] = useState<string | undefined>(() => localStorage.getItem("ky_authed_name") || undefined);
    const setAuth = useAppStore((s) => s.setAuth);
    const syncFromServer = useAppStore((s) => s.syncFromServer);

    const wsRef = useRef<KyrgyzWsClient | null>(null);
    const pendingAssistantId = useRef<string | null>(null);
    const currentConversationIdRef = useRef<string | undefined>(activeConversationId);
    const chatEndRef = useRef<HTMLDivElement | null>(null);
    const token = useAppStore((s) => s.token);
    const sharedProps = {
      // 1. Core Logic & State
    transcriber,
    tab,
    setTab,
    busy,
    setBusy,
    error,
    setError,
    health,
    
    // 2. STT (Speech to Text)
    sttText,
    setSttText,
    
    // 3. TTS (Text to Speech)
    ttsText,
    setTtsText,
    ttsAudioUrl,
    ttsCleaned,
    onTts: async () => {
        const text = ttsText.trim();
        if (!text) return;
    
        setError(undefined);
        setBusy('tts', true); // This triggers the "Generating..." state
    
        try {
          // Ensure 'voice' is the current value from the store
          const r = await apiTts({ text, model: voice });
          
          if (r && r.audio_url) {
            setTtsResult({ 
              audioUrl: r.audio_url, 
              cleaned: r.cleaned_text 
            });
          } else {
            throw new Error("No audio URL returned from server");
          }
        } catch (e: any) {
          console.error("TTS Error:", e);
          setError(e?.message || 'TTS failed');
        } finally {
          // This is what turns "Generating..." back to "Угуу"
          setBusy('tts', false); 
        }
      },

    // 4. Chat & WebSockets
    activeConversation,
    activeConversationId,
    wsStatus,
    wsRef,
    chatEndRef,
    onSendRealtime: (text: string) => {
        if (!activeConversationId) return;
        setError(undefined);
        currentConversationIdRef.current = activeConversationId;
        
        // Push User Message
        pushMessage(activeConversationId, { role: 'user', text });
        setChatInput('');

        // Prepare Assistant Placeholder
        const assistantId = pushMessage(activeConversationId, {
            role: 'assistant',
            text: '',
            streaming: true,
            audioUrls: [],
        });
        pendingAssistantId.current = assistantId;

        setBusy('wsSend', true);
        wsRef.current?.send({
            type: 'user_message',
            message: text,
            model: voice,
            stream_audio: true,
            history: [], // You can calculate history here if needed
        });
    },

    // 5. UI Controls
    voice,
    setVoice: (v: string) => useAppStore.getState().setVoice(v as VoiceModel),
    mobileSidebarOpen,
    setMobileSidebarOpen,
    authedName,
    authedEmail,
    logout: () => {
        localStorage.removeItem('ky_token');
        setAuth(undefined);
    }
      // Add all the other props you currently have in 'protectedProps'
    };
    useEffect(() => {
        const root = window.document.documentElement; // This is the <html> tag
        if (theme === 'dark') {
          root.classList.add('dark');
        } else {
          root.classList.remove('dark');
        }
      }, [theme]);

    useEffect(() => {
        const ac = new AbortController();
        (async () => {
            try {
                setBusy("health", true);
                const h = await apiHealth(ac.signal);
                setHealth(h);
            } catch (e) {
                setHealth(undefined);
            } finally {
                setBusy("health", false);
            }
        })();
        return () => ac.abort();
    }, [setBusy, setHealth]);

    useEffect(() => {
        if (transcriber.output?.text) {
            setSttText(transcriber.output.text);
        }
    }, [transcriber.output?.text, setSttText]);

    useEffect(() => {
        currentConversationIdRef.current = activeConversationId;
    }, [activeConversationId]);

    useEffect(() => {
        wsRef.current?.close();
        wsRef.current = new KyrgyzWsClient(
            {
            onStatus: (s, err) => setWsStatus(s, err),
            onEvent: (e) => {
                const convId = currentConversationIdRef.current;
                const aId = pendingAssistantId.current;
                if (!convId || !aId) return;
                if (e.type === "text_delta") {
                    upsertAssistantDelta(convId, aId, e.delta);
                } else if (e.type === "audio_chunk") {
                    addAudioChunk(convId, aId, e.audio_url);
                } else if (e.type === "audio_final") {
                    // one final output audio file
                    addAudioChunk(convId, aId, e.audio_url);
                } else if (e.type === "warn") {
                    // non-fatal: show in UI as assistant text note
                    upsertAssistantDelta(convId, aId, `\n\n[Эскертүү] ${e.message}`);
                } else if (e.type === "error") {
                    setError(e.message);
                    finishStreaming(convId, aId);
                    pendingAssistantId.current = null;
                    setBusy("wsSend", false);
                } else if (e.type === "done") {
                    finishStreaming(convId, aId);
                    pendingAssistantId.current = null;
                    setBusy("wsSend", false);
                }
            },
            },
            token,
        );
        wsRef.current.connect();
        return () => {
            wsRef.current?.close();
        };
    }, [
        addAudioChunk,
        finishStreaming,
        setBusy,
        setError,
        setWsStatus,
        token,
        upsertAssistantDelta,
    ]);

    const historyForWs = useMemo(() => {
        const conv = activeConversation;
        if (!conv) return [];
        // only user/assistant for model context
        return conv.messages
            .filter((m) => m.role === "user" || m.role === "assistant")
            .map((m) => ({ role: m.role as "user" | "assistant", content: m.text }));
    }, [activeConversation]);

    const onSendRealtime = (text: string) => {
        if (!activeConversationId) return;
        setError(undefined);
        currentConversationIdRef.current = activeConversationId;

        // Update title if it's still default
        const conv = activeConversation;
        if (conv && (conv.title === "Жаңы чат" || conv.title === "Чат")) {
            const t = text.slice(0, 32);
            useAppStore.getState().renameConversation(activeConversationId, t);
        }

        pushMessage(activeConversationId, { role: "user", text });
        setChatInput("");

        // Assistant placeholder to stream into
        const assistantId = pushMessage(activeConversationId, {
            role: "assistant",
            text: "",
            streaming: true,
            audioUrls: [],
        });
        pendingAssistantId.current = assistantId;

        setBusy("wsSend", true);
        const convNumeric =
            activeConversationId.startsWith("db:") ? Number(activeConversationId.replace("db:", "")) : undefined;
        wsRef.current?.send({
            type: "user_message",
            message: text,
            model: voice,
            stream_audio: true,
            conversation_id: convNumeric,
            history: historyForWs,
        });
    };

    useEffect(() => {
        if (tab !== "chat") return;
        // small delay to ensure DOM updated
        const t = setTimeout(() => chatEndRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
        return () => clearTimeout(t);
    }, [activeConversation?.messages?.length, tab]);

    const onTts = async () => {
        const text = ttsText.trim();
        if (!text) return;
        setError(undefined);
        setBusy("tts", true);
        try {
          const r = await apiTts({ text, model: voice as VoiceModel });
            setTtsResult({ audioUrl: r.audio_url, cleaned: r.cleaned_text });
        } catch (e: any) {
            const detail = e?.message || "TTS failed";
            setError(detail);
        } finally {
            setBusy("tts", false);
        }
    };


    return <AppRoutes sharedProps={sharedProps} />;

    // return (
    //     <div className="h-full min-h-screen bg-gradient-to-b from-slate-50 via-white to-slate-50 text-slate-900 dark:from-slate-950 dark:via-slate-950 dark:to-slate-950 dark:text-slate-100">
    //         <div className="h-screen flex">
    //             <div className="hidden md:block">
    //                 <Sidebar />
    //             </div>

    //             {/* mobile overlay */}
    //             {mobileSidebarOpen && (
    //                 <div className="md:hidden fixed inset-0 z-50 flex">
    //                     <div className="absolute inset-0 bg-black/40" onClick={() => setMobileSidebarOpen(false)} />
    //                     <div className="relative h-full">
    //                         <Sidebar onCloseMobile={() => setMobileSidebarOpen(false)} />
    //                     </div>
    //                 </div>
    //             )}

    //             <main className="flex-1 flex flex-col min-w-0">
    //                 <header className="px-4 py-3 border-b border-slate-200 dark:border-white/10 bg-white/70 dark:bg-slate-950/60 backdrop-blur flex items-center justify-between gap-3">
    //                     <div className="flex items-center gap-2">
    //                         <button
    //                             className="md:hidden px-3 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-white/10 dark:hover:bg-white/15 text-sm font-semibold"
    //                             onClick={() => setMobileSidebarOpen(true)}
    //                         >
    //                             Чаттар
    //                         </button>
    //                         <div className="font-extrabold tracking-tight">
    //                             {activeConversation?.title || "Kyrgyz AI"}
    //                         </div>
    //                         {authedEmail && (
    //                             <div className="flex items-center gap-2">
    //                                 <div className="text-xs px-2 py-1 rounded-full bg-slate-100 dark:bg-white/10 text-slate-700 dark:text-slate-200">
    //                                     {authedName ? `Салам, ${authedName}` : authedEmail}
    //                                 </div>
    //                                 <button
    //                                     className="text-xs px-3 py-1 rounded-full bg-slate-200 dark:bg-white/10 text-slate-800 dark:text-slate-100 hover:bg-slate-300 dark:hover:bg-white/20"
    //                                     onClick={() => {
    //                                         localStorage.removeItem("ky_token");
    //                                         localStorage.removeItem("ky_authed_email");
    //                                         localStorage.removeItem("ky_authed_name");
    //                                         setAuth(undefined);
    //                                         setAuthedEmail(undefined);
    //                                         setAuthedName(undefined);
    //                                     }}
    //                                 >
    //                                     Logout
    //                                 </button>
    //                             </div>
    //                         )}
    //                     </div>
    //                     <div className="flex items-center gap-2">
    //                         <div className="text-xs text-slate-600 dark:text-slate-300 hidden sm:block">
    //                             {busy.health
    //                                 ? "Сервис текшерилип жатат…"
    //                                 : health
    //                                   ? `Groq: ${health.groq_configured ? "бар" : "жок"} • TTS: ${
    //                                         health.models.female.loaded || health.models.male.loaded ? "бар" : "жок"
    //                                     }`
    //                                   : "Сервис белгисиз"}
    //                         </div>
    //                         <Tabs value={tab} onChange={setTab} />
    //                     </div>
    //                 </header>

    //                 {error && (
    //                     <div className="mx-4 mt-4 rounded-xl bg-rose-50 ring-1 ring-rose-200 px-4 py-3 text-rose-800">
    //                         {error}
    //                     </div>
    //                 )}

    //                 <div className="flex-1 overflow-y-auto p-4">
    //                     {/* Login card (optional, for JWT/Postgres features) */}
    //                     {!authedEmail && (
    //                         <div className="max-w-4xl mx-auto mb-4">
    //                             <LoginPanel
    //                                 onAuthed={(token, email) => {
    //                                     localStorage.setItem("ky_token", token);
    //                                     localStorage.setItem("ky_authed_email", email);
    //                                     setAuth(token);
    //                                     setAuthedEmail(email);
    //                                     const n = localStorage.getItem("ky_authed_name") || undefined;
    //                                     if (n) setAuthedName(n);
    //                                     syncFromServer().catch(() => {});
    //                                 }}
    //                             />
    //                         </div>
    //                     )}

    //                     {tab === "chat" && (
    //                         <div className="max-w-4xl mx-auto flex flex-col gap-4">
    //                             <div className="flex items-center justify-between gap-2 flex-wrap">
    //                                 <div className="text-sm text-slate-600">
    //                                     Realtime сүйлөшүү (Gemini сыяктуу): текст агым менен келет, үн бөлүктөр менен чыгат.
    //                                 </div>
    //                                 <button
    //                                     className="px-3 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-sm font-semibold"
    //                                     onClick={() => {
    //                                         if (!activeConversationId) return;
    //                                         const ok = confirm("Бул чаттагы билдирүүлөр тазалансынбы?");
    //                                         if (ok) clearConversation(activeConversationId);
    //                                     }}
    //                                 >
    //                                     Тазалоо
    //                                 </button>
    //                             </div>

    //                             <div className="space-y-3">
    //                                 {(activeConversation?.messages || []).map((m) => (
    //                                     <MessageBubble key={m.id} m={m} />
    //                                 ))}
    //                                 <div ref={chatEndRef} />
    //                             </div>

    //                             <ChatComposer onSend={onSendRealtime} />

    //                             <div className="text-xs text-slate-500">
    //                                 Статус: <b>{wsStatus}</b> • Модель: <b>{voice}</b>
    //                             </div>
    //                         </div>
    //                     )}

    //                     {tab === "live" && (
    //                         <div className="max-w-4xl mx-auto flex flex-col gap-4">
    //                             <div className="rounded-2xl bg-white/70 dark:bg-slate-950/60 ring-1 ring-slate-200 dark:ring-white/10 p-4 backdrop-blur">
    //                                 <h2 className="text-xl font-extrabold">Gemini Live (Push‑to‑talk)</h2>
    //                                 <p className="text-slate-600 dark:text-slate-300 mt-1">
    //                                     1) Микрофон менен сүйлөп жазып аласыз → 2) STT текст чыгарат → 3) Автоматтык түрдө чатка жиберет → 4) AI үн менен жооп берет (1 файл).
    //                                 </p>
    //                                 <div className="mt-4">
    //                                     <AudioManager transcriber={transcriber} />
    //                                 </div>
    //                                 <div className="mt-3 flex gap-2">
    //                                     <button
    //                                         className="px-4 py-2 rounded-xl bg-slate-900 text-white font-semibold hover:bg-slate-800 disabled:opacity-50"
    //                                         disabled={!sttText.trim()}
    //                                         onClick={() => {
    //                                             setTab("chat");
    //                                             onSendRealtime(sttText.trim());
    //                                         }}
    //                                     >
    //                                         Live → Жиберүү
    //                                     </button>
    //                                     <div className="text-sm text-slate-500 dark:text-slate-400 flex items-center">
    //                                         Кеңеш: аудио даяр болгондо “Транскрипт” чыгып калат.
    //                                     </div>
    //                                 </div>
    //                             </div>
    //                         </div>
    //                     )}

    //                     {tab === "stt" && (
    //                         <div className="max-w-4xl mx-auto flex flex-col gap-4">
    //                             <div className="rounded-2xl bg-white shadow-sm ring-1 ring-slate-200 p-4">
    //                                 <h2 className="text-xl font-bold">STT — Сүйлөөнү текстке</h2>
    //                                 <p className="text-slate-600 mt-1">
    //                                     Микрофон/файл/URL аркылуу аудиону берип, браузер ичинде транскрипция жасаңыз.
    //                                 </p>
    //                                 <div className="mt-4">
    //                                     <AudioManager transcriber={transcriber} />
    //                                 </div>
    //                                 <Transcript transcribedData={transcriber.output} />
    //                             </div>

    //                             <div className="rounded-2xl bg-white shadow-sm ring-1 ring-slate-200 p-4">
    //                                 <div className="flex items-center justify-between gap-3 flex-wrap">
    //                                     <h3 className="text-lg font-bold">Транскрипт</h3>
    //                                     <div className="flex gap-2">
    //                                         <button
    //                                             className="px-3 py-2 rounded-xl bg-slate-900 text-white font-semibold hover:bg-slate-800 disabled:opacity-50"
    //                                             disabled={!sttText.trim()}
    //                                             onClick={() => {
    //                                                 setChatInput(sttText);
    //                                                 setTab("chat");
    //                                             }}
    //                                         >
    //                                             Chat'ка жөнөтүү
    //                                         </button>
    //                                         <button
    //                                             className="px-3 py-2 rounded-xl bg-indigo-600 text-white font-semibold hover:bg-indigo-500 disabled:opacity-50"
    //                                             disabled={!sttText.trim()}
    //                                             onClick={() => {
    //                                                 setTtsText(sttText);
    //                                                 setTab("tts");
    //                                             }}
    //                                         >
    //                                             TTS'ке жөнөтүү
    //                                         </button>
    //                                     </div>
    //                                 </div>
    //                                 <textarea
    //                                     className="mt-3 w-full min-h-[120px] rounded-xl ring-1 ring-slate-200 p-3 focus:outline-none focus:ring-2 focus:ring-indigo-500"
    //                                     value={sttText}
    //                                     onChange={(e) => setSttText(e.target.value)}
    //                                     placeholder="Бул жерде текст чыгат..."
    //                                 />
    //                             </div>
    //                         </div>
    //                     )}

    //                     {tab === "tts" && (
    //                         <div className="max-w-4xl mx-auto rounded-2xl bg-white shadow-sm ring-1 ring-slate-200 p-4">
    //                             <h2 className="text-xl font-bold">TTS — Тексттен үнгө</h2>
    //                             <p className="text-slate-600 mt-1">
    //                                 Кыргызча текст киргизиңиз, анан үн синтездөө баскычын басыңыз.
    //                             </p>
    //                             <div className="mt-3">
    //                                 {/* Voice toggle also in TTS */}
    //                                 <div className="text-sm text-slate-600 dark:text-slate-300 mb-2">Үн тандоо</div>
    //                                 <VoiceToggle value={voice} onChange={(v) => useAppStore.getState().setVoice(v)} />
    //                             </div>
    //                             <div className="mt-4">
    //                                 <textarea
    //                                     className="w-full min-h-[160px] rounded-xl ring-1 ring-slate-200 p-3 focus:outline-none focus:ring-2 focus:ring-indigo-500"
    //                                     value={ttsText}
    //                                     onChange={(e) => setTtsText(e.target.value)}
    //                                     placeholder="Мисалы: Салам! Бүгүн аба ырайы кандай?"
    //                                     onKeyDown={(e) => {
    //                                         if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
    //                                             onTts();
    //                                         }
    //                                     }}
    //                                 />
    //                                 <div className="mt-3 flex gap-2 items-center">
    //                                     <button
    //                                         className="px-4 py-2 rounded-xl bg-indigo-600 text-white font-semibold hover:bg-indigo-500 disabled:opacity-50"
    //                                         disabled={busy.tts}
    //                                         onClick={onTts}
    //                                     >
    //                                         {busy.tts ? "Синтездөлүүдө…" : "Үнгө айлантуу"}
    //                                     </button>
    //                                     <div className="text-xs text-slate-500">
    //                                         Кеңеш: <b>Ctrl + Enter</b>
    //                                     </div>
    //                                 </div>
    //                             </div>

    //                             {ttsAudioUrl && (
    //                                 <div className="mt-4 rounded-2xl bg-slate-50 ring-1 ring-slate-200 p-4">
    //                                     <div className="font-bold">Натыйжа</div>
    //                                     <div className="mt-2">
    //                                         <audio controls src={ttsAudioUrl} className="w-full" />
    //                                     </div>
    //                                     {ttsCleaned && (
    //                                         <div className="mt-3">
    //                                             <div className="text-xs font-bold text-slate-600 mb-1">
    //                                                 TTS үчүн тазаланган текст
    //                                             </div>
    //                                             <div className="text-sm whitespace-pre-wrap text-slate-800">
    //                                                 {ttsCleaned}
    //                                             </div>
    //                                         </div>
    //                                     )}
    //                                 </div>
    //                             )}
    //                         </div>
    //                     )}
    //                 </div>
    //             </main>
    //         </div>
    //     </div>
    // );
}

export default App;
