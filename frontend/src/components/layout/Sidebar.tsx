// src/components/layout/Sidebar.tsx
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAppStore } from "../../state/appStore";
import { useUiStore } from "../../state/uiStore";

interface SidebarProps {
  open: boolean;
  setOpen: (open: boolean) => void;
  activeTab: string;
  authedName?: string;
  logout?: () => void;
  // Add setTab to your interface so TypeScript knows it exists
  setTab: (tab: string) => void; 
}

export function Sidebar({ open, setOpen,authedName,logout, activeTab, setTab }: SidebarProps) {
  const navigate = useNavigate();
  const conversations = useAppStore((s) => s.conversations);
  const activeId = useAppStore((s) => s.activeConversationId);
  const setActive = useAppStore((s) => s.setActiveConversation);
  const newConv = useAppStore((s) => s.newConversation);
  const rename = useAppStore((s) => s.renameConversation);
  const del = useAppStore((s) => s.deleteConversation);
  const theme = useUiStore((s) => s.theme);
  const toggleTheme = useUiStore((s) => s.toggleTheme);
  const [q, setQ] = useState("");

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return conversations;
    return conversations.filter((c) => c.title.toLowerCase().includes(term));
  }, [conversations, q]);

  return (
    <aside className={`fixed inset-y-0 left-0 z-50 w-[280px] shrink-0 bg-slate-950 text-slate-100 flex flex-col transition-transform duration-300 md:relative md:translate-x-0 ${open ? "translate-x-0" : "-translate-x-full"}`}>
      {/* 1. THE NEW USER FOOTER */}
      <div className="p-4 border-t border-white/10 bg-slate-900/50">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-full bg-indigo-600 flex items-center justify-center font-bold text-white border border-white/20">
            {authedName?.charAt(0).toUpperCase() || "Э"}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-[10px] text-slate-500 font-bold uppercase tracking-tight">Кош келиңиз</div>
            <div className="text-sm font-semibold truncate text-white">
              Салам, {authedName}!
            </div>
          </div>
        </div>
      </div>
      {/* 1. TOP HEADER & THEME */}
      <div className="p-4 border-b border-white/10">
        <div className="flex items-center justify-between mb-4">
          <div className="font-extrabold tracking-tight text-indigo-400">Ала-Тоо AI</div>
          <button onClick={toggleTheme} className="p-2 rounded-lg bg-white/5 hover:bg-white/10 text-xs">
            {theme === "dark" ? "☀️" : "🌙"}
          </button>
        </div>
        
        {/* 2. MAIN NAVIGATION (NEW) */}
        <nav className="flex flex-col gap-1 mb-4">
          {[
            { id: 'chat', path: '/chat', label: 'Чат', icon: '💬' },
            { id: 'live', path: '/live', label: 'Live Mode', icon: '⚡' },
            { id: 'tts', path: '/tts', label: 'TTS (Үн)', icon: '🔊' },
            { id: 'stt', path: '/stt', label: 'STT (Текст)', icon: '🎤' }
          ].map((item: { id: string; path: string; label: string; icon: string }) => (
            <button
              key={item.id}
              onClick={() => {
                setTab(item.id);
                navigate(item.path);
                if (window.innerWidth < 768) setOpen(false);
              }}
              className={`flex items-center gap-3 px-3 py-2 rounded-xl text-sm font-medium transition-colors ${
                activeTab === item.id ? "bg-indigo-600 text-white" : "hover:bg-white/5 text-slate-400"
              }`}
            >
              <span>{item.icon}</span> {item.label}
            </button>
          ))}
        </nav>

        <button
          className="w-full py-2 rounded-xl bg-white/10 hover:bg-white/15 text-sm font-semibold mb-3 transition-all"
          onClick={() => {
            const id = newConv();
            setActive(id);
            setTab('chat'); // Switch to chat tab immediately
            setOpen(false);
          }}
        >
          + Жаңы чат
        </button>

        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Чаттарды издөө..."
          className="w-full rounded-xl bg-white/5 ring-1 ring-white/10 px-3 py-2 text-sm outline-none focus:ring-indigo-500"
        />
      </div>

      {/* 3. CONVERSATIONS LIST */}
      <div className="flex-1 overflow-y-auto p-2 space-y-1">
        <div className="px-3 py-2 text-[10px] font-bold text-slate-500 uppercase tracking-widest">Тарых</div>
        {filtered.map((c) => {
          const active = c.id === activeId && activeTab === 'chat';
          return (
            <div
              key={c.id}
              className={`group flex items-center gap-2 rounded-xl px-3 py-2 cursor-pointer transition-all ${
                active ? "bg-white/10 ring-1 ring-white/20" : "hover:bg-white/5 text-slate-400"
              }`}
              onClick={() => {
                setActive(c.id);
                setTab('chat'); // Ensure we switch to chat view
                setOpen(false);
              }}
            >
              <div className="flex-1 min-w-0">
                <div className={`truncate text-sm ${active ? "font-bold text-white" : ""}`}>{c.title}</div>
                <div className="text-[10px] opacity-50">{new Date(c.updatedAt).toLocaleDateString()}</div>
              </div>
              
              <div className="opacity-0 group-hover:opacity-100 transition-opacity flex gap-1">
                <button className="p-1 hover:text-indigo-400" onClick={(e) => { e.stopPropagation(); const t = prompt("Атын өзгөртүү", c.title); if (t) rename(c.id, t); }}>✎</button>
                <button className="p-1 hover:text-rose-400" onClick={(e) => { e.stopPropagation(); if (confirm("Өчүрүлсүнбү?")) del(c.id); }}>✕</button>
              </div>
            </div>
          );
        })}
      </div>
      {/* 2. THE ALWAYS-PRESENT LOGOUT BUTTON */}
      <button
          onClick={logout}
          className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-xl bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 text-xs font-bold transition-all border border-rose-500/20"
        >
          <span>🚪</span> Чыгуу
        </button>

      {/* 4. FOOTER */}
      <div className="p-4 border-t border-white/10 bg-slate-950/50">
         <div className="text-[10px] uppercase tracking-widest text-slate-600 font-bold mb-1">Статус</div>
         <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></div>
            <div className="text-xs text-slate-400">Система даяр</div>
         </div>
      </div>
    </aside>
  );
}