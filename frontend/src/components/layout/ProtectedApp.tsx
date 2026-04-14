import { useEffect, useRef } from 'react';
import type { VoiceModel } from '../../api/kyrgyzService';
import { Sidebar } from '../layout/Sidebar';
import { ChatComposer } from '../chat/ChatComposer';
import { MessageBubble } from '../chat/MessageBubble';
import { Tabs } from '../ui/Tabs';
import { AudioManager } from '../AudioManager';
import Transcript from '../Transcript';
import { VoiceToggle } from '../ui/VoiceToggle';
import { useAppStore } from '../../state/appStore';
import type { KyrgyzWsClient } from '../../realtime/wsClient';
import { ChatView } from '../views/ChatView';
import { TtsView } from '../views/TtsView';
import { SttView } from '../views/SttView'; // Assume similar logic for 
import ChatPage from '../pages/ChatPage';
import TtsPage from '../pages/TtsPage';
import SttPage from '../pages/SttPage';
interface ProtectedAppProps {
  wsRef: React.MutableRefObject<KyrgyzWsClient | null>;
  chatEndRef: React.RefObject<HTMLDivElement>;
  pendingAssistantId: React.MutableRefObject<string | null>;
  currentConversationIdRef: React.MutableRefObject<string | undefined>;
  onSendRealtime: (text: string) => void;
  transcriber: any;
  onTts: () => void;
  ttsText: string;
  setTtsText: (v: string) => void;
  ttsAudioUrl?: string;
  ttsCleaned?: string;
  sttText: string;
  setSttText: (v: string) => void;
  setTab: (tab: import('../../state/appStore').TabKey) => void;
  tab: import('../../state/appStore').TabKey;
  voice: string;
  setVoice: (v: string) => void;
  mobileSidebarOpen: boolean;
  setMobileSidebarOpen: (open: boolean) => void;
  activeConversation?: {
    title: string;
    messages: Array<{
      id: string;
      role: 'user' | 'assistant' | 'system' | 'error';
      text: string;
      createdAt: number;
      streaming?: boolean;
      audioUrls?: string[];
    }>;
  };
  activeConversationId?: string;
  clearConversation: (id: string) => void;
  error?: string;
  busy: { health: boolean; tts: boolean; wsSend: boolean };
  wsStatus: string;
}

export function ProtectedApp({ children, sharedProps }: any) {
  return (
    <div className="flex h-screen w-full overflow-hidden bg-white dark:bg-slate-950">
      {/* The Sidebar is now always present for protected routes */}
      <Sidebar 
        open={sharedProps.mobileSidebarOpen} 
        setOpen={sharedProps.setMobileSidebarOpen}
        activeTab={sharedProps.tab}
        setTab={sharedProps.setTab}
      />
      
      <main className="flex-1 h-full overflow-hidden relative">
        {children}
      </main>
    </div>
  );
}

// export function ProtectedApp(props: ProtectedAppProps) {
//   const { activeConversation, wsRef, chatEndRef, pendingAssistantId, currentConversationIdRef, onSendRealtime, transcriber, onTts, ttsText, setTtsText, ttsAudioUrl, ttsCleaned, sttText, setSttText, setTab, tab, voice, setVoice, mobileSidebarOpen, setMobileSidebarOpen, error, busy, wsStatus, activeConversationId, clearConversation } = props;

//   useEffect(() => {
//     if (tab !== 'chat') return;
//     const t = setTimeout(() => chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 50);
//     return () => clearTimeout(t);
//   }, [activeConversation?.messages?.length, tab, chatEndRef]);

//   return (
//     <div className="h-screen flex">
//       <div className="hidden md:block">
//         <Sidebar />
//       </div>

// {mobileSidebarOpen && (
//         <div className="md:hidden fixed inset-0 z-50 flex">
//           <div className="absolute inset-0 bg-black/40" onClick={() => setMobileSidebarOpen(false)} />
//           <div className="relative h-full">
//             <Sidebar onCloseMobile={() => setMobileSidebarOpen(false)} />
//           </div>
//         </div>
//       )}

//       <main className="flex-1 flex flex-col min-w-0">
// {/* Header will be in AuthHeader component */}
// {error && (
//           <div className="mx-4 mt-4 rounded-xl bg-rose-50 ring-1 ring-rose-200 px-4 py-3 text-rose-800">
//             {error}
//           </div>
//         )}

//         <div className="flex-1 overflow-y-auto p-4">
// {tab === "chat" && (
//             <div className="max-w-4xl mx-auto flex flex-col gap-4">
//               <div className="flex items-center justify-between gap-2 flex-wrap">
//                 <div className="text-sm text-slate-600">
//                   Realtime сүйлөшүү (Gemini сыяктуу): текст агым менен келет, үн бөлүктөр менен чыгат.
//                 </div>
//                 <button
//                   className="px-3 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-sm font-semibold"
//                   onClick={() => {
// if (!activeConversationId) return;
//                     const ok = confirm("Бул чаттагы билдирүүлөр тазалансынбы?");
// clearConversation(activeConversationId);
//                   }}
//                 >
//                   Тазалоо
//                 </button>
//               </div>

//               <div className="space-y-3">
//                 {(activeConversation?.messages || []).map((m) => (
//                   <MessageBubble key={m.id} m={m} />
//                 ))}
//                 <div ref={chatEndRef} />
//               </div>

//               <ChatComposer onSend={onSendRealtime} />

//               <div className="text-xs text-slate-500">
//                 Статус: <b>{wsStatus}</b> • Модель: <b>{voice}</b>
//               </div>
//             </div>
//           )}

// {tab === "live" && (
//             <div className="max-w-4xl mx-auto flex flex-col gap-4">
//               <div className="rounded-2xl bg-white/70 dark:bg-slate-950/60 ring-1 ring-slate-200 dark:ring-white/10 p-4 backdrop-blur">
//                 <h2 className="text-xl font-extrabold">Gemini Live (Push‑to‑talk)</h2>
//                 <p className="text-slate-600 dark:text-slate-300 mt-1">
//                   1) Микрофон менен сүйлөп жазып аласыз → 2) STT текст чыгарат → 3) Автоматтык түрдө чатка жиберет → 4) AI үн менен жооп берет (1 файл).
//                 </p>
//                 <div className="mt-4">
//                   <AudioManager transcriber={transcriber} />
//                 </div>
//                 <div className="mt-3 flex gap-2">
//                   <button
//                     className="px-4 py-2 rounded-xl bg-slate-900 text-white font-semibold hover:bg-slate-800 disabled:opacity-50"
//                     disabled={!sttText.trim()}
//                     onClick={() => {
//                       setTab("chat");
//                       onSendRealtime(sttText.trim());
//                     }}
//                   >
//                     Live → Жиберүү
//                   </button>
//                   <div className="text-sm text-slate-500 dark:text-slate-400 flex items-center">
//                     Кеңеш: аудио даяр болгондо "Транскрипт" чыгып калат.
//                   </div>
//                 </div>
//               </div>
//             </div>
//           )}

//           {/* STT & TTS tabs similar extraction */}
// {tab === "stt" && (
//             <div className="max-w-4xl mx-auto flex flex-col gap-4">
//               <div className="rounded-2xl bg-white shadow-sm ring-1 ring-slate-200 p-4">
//                 <h2 className="text-xl font-bold">STT — Сүйлөөнү текстке</h2>
//                 <p className="text-slate-600 mt-1">
//                   Микрофон/файл/URL аркылуу аудиону берип, браузер ичинде транскрипция жасаңыз.
//                 </p>
//                 <div className="mt-4">
//                   <AudioManager transcriber={transcriber} />
//                 </div>
//                 <Transcript transcribedData={transcriber.output} />
//               </div>

//               <div className="rounded-2xl bg-white shadow-sm ring-1 ring-slate-200 p-4">
//                 <div className="flex items-center justify-between gap-3 flex-wrap">
//                   <h3 className="text-lg font-bold">Транскрипт</h3>
//                   <div className="flex gap-2">
//                     <button
//                       className="px-3 py-2 rounded-xl bg-slate-900 text-white font-semibold hover:bg-slate-800 disabled:opacity-50"
//                       disabled={!sttText.trim()}
//                       onClick={() => {
//                         useAppStore.getState().setChatInput(sttText);
//                         setTab("chat");
//                       }}
//                     >
//                       Chat'ка жөнөтүү
//                     </button>
//                     <button
//                       className="px-3 py-2 rounded-xl bg-indigo-600 text-white font-semibold hover:bg-indigo-500 disabled:opacity-50"
//                       disabled={!sttText.trim()}
//                       onClick={() => {
//                         setTtsText(sttText);
//                         setTab("tts");
//                       }}
//                     >
//                       TTS'ке жөнөтүү
//                     </button>
//                   </div>
//                 </div>
//                 <textarea
//                   className="mt-3 w-full min-h-[120px] rounded-xl ring-1 ring-slate-200 p-3 focus:outline-none focus:ring-2 focus:ring-indigo-500"
//                   value={sttText}
//                   onChange={(e) => setSttText(e.target.value)}
//                   placeholder="Бул жерде текст чыгат..."
//                 />
//               </div>
//             </div>
//           )}

// {tab === "tts" && (
//             <div className="max-w-4xl mx-auto rounded-2xl bg-white shadow-sm ring-1 ring-slate-200 p-4">
//               <h2 className="text-xl font-bold">TTS — Тексттен үнгө</h2>
//               <p className="text-slate-600 mt-1">
//                 Кыргызча текст киргизиңиз, анан үн синтездөө баскычын басыңыз.
//               </p>
//               <div className="mt-3">
//                 <div className="text-sm text-slate-600 dark:text-slate-300 mb-2">Үн тандоо</div>
//                 <VoiceToggle value={voice} onChange={setVoice} />
//               </div>
//               <div className="mt-4">
//                 <textarea
//                   className="w-full min-h-[160px] rounded-xl ring-1 ring-slate-200 p-3 focus:outline-none focus:ring-2 focus:ring-indigo-500"
//                   value={ttsText}
//                   onChange={(e) => setTtsText(e.target.value)}
//                   placeholder="Мисалы: Салам! Бүгүн аба ырайы кандай?"
// onKeyDown={(e) => {
// if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
//                       onTts();
//                     }
//                   }}
//                 />
//                 <div className="mt-3 flex gap-2 items-center">
//                   <button
//                     className="px-4 py-2 rounded-xl bg-indigo-600 text-white font-semibold hover:bg-indigo-500 disabled:opacity-50"
//                     disabled={busy.tts}
//                     onClick={onTts}
//                   >
//                     {busy.tts ? 'Синтездөлүүдө…' : 'Үнгө айлантуу'}
//                   </button>
//                   <div className="text-xs text-slate-500">
//                     Кеңеш: <b>Ctrl + Enter</b>
//                   </div>
//                 </div>
//               </div>

// {ttsAudioUrl && (
//                 <div className="mt-4 rounded-2xl bg-slate-50 ring-1 ring-slate-200 p-4">
//                   <div className="font-bold">Натыйжа</div>
//                   <div className="mt-2">
//                     <audio controls src={ttsAudioUrl} className="w-full" />
//                   </div>
// {ttsCleaned && (
//                     <div className="mt-3">
//                       <div className="text-xs font-bold text-slate-600 mb-1">
//                         TTS үчүн тазаланган текст
//                       </div>
//                       <div className="text-sm whitespace-pre-wrap text-slate-800">
//                         {ttsCleaned}
//                       </div>
//                     </div>
//                   )}
//                 </div>
//               )}
//             </div>
//           )}
//         </div>
//       </main>
//     </div>
//   );
// }
