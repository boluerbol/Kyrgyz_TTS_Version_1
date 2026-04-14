import { useAppStore } from '../../state/appStore';
import { Tabs } from '../ui/Tabs';

interface AuthHeaderProps {
  activeConversationTitle?: string;
  health?: any;
  busy: { health: boolean };
  authedName?: string | null;
  authedEmail?: string;
  onLogout: () => void;
  tab: 'chat' | 'live' | 'stt' | 'tts';
  setTab: (tab: 'chat' | 'live' | 'stt' | 'tts') => void;
  mobileSidebarOpen: boolean;
  setMobileSidebarOpen: (open: boolean) => void;
}

export function AuthHeader(props: AuthHeaderProps) {
  const { activeConversationTitle, health, busy, authedName, authedEmail, onLogout, tab, setTab, mobileSidebarOpen, setMobileSidebarOpen } = props;

  return (
    <header className="px-4 py-3 border-b border-slate-200 dark:border-white/10 bg-white/70 dark:bg-slate-950/60 backdrop-blur flex items-center justify-between gap-3">
      <div className="flex items-center gap-2">
        <button
          className="md:hidden px-3 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-white/10 dark:hover:bg-white/15 text-sm font-semibold"
          onClick={() => setMobileSidebarOpen(true)}
        >
          Чаттар
        </button>
        <div className="font-extrabold tracking-tight">
          {activeConversationTitle || "Ала-Тоо AI"}
        </div>
        {(authedName || authedEmail) && (
          <div className="flex items-center gap-2">
            <div className="text-xs px-2 py-1 rounded-full bg-slate-100 dark:bg-white/10 text-slate-700 dark:text-slate-200">
{authedName ? `Салам, ${authedName}` : authedEmail?.split('@')[0] || authedEmail}
            </div>
            <button
              className="text-xs px-3 py-1 rounded-full bg-slate-200 dark:bg-white/10 text-slate-800 dark:text-slate-100 hover:bg-slate-300 dark:hover:bg-white/20"
              onClick={onLogout}
            >
              Logout
            </button>
          </div>
        )}
      </div>
      <div className="flex items-center gap-2">
        <div className="text-xs text-slate-600 dark:text-slate-300 hidden sm:block">
          {busy.health
            ? "Сервис текшерилип жатат…"
            : health
              ? `Groq: ${health.groq_configured ? "бар" : "жок"} • TTS: ${
                  health.models.female.loaded || health.models.male.loaded ? "бар" : "жок"
                }`
              : "Сервис белгисиз"}
        </div>
        <Tabs value={tab} onChange={setTab} />
      </div>
    </header>
  );
}
