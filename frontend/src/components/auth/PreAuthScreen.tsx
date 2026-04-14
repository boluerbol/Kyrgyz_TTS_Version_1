import LoginPanel from './LoginPanel';
import { useAppStore } from '../../state/appStore';

interface PreAuthScreenProps {
  onLogin: (token: string, email: string) => void;
}

export function PreAuthScreen(props: PreAuthScreenProps) {
  const syncFromServer = useAppStore((s) => s.syncFromServer);

  return (
    <div className="flex flex-col items-center justify-center min-h-[400px] p-4">
      <div className="max-w-md w-full rounded-2xl bg-white/70 dark:bg-slate-950/60 ring-1 ring-slate-200 dark:ring-white/10 p-6 backdrop-blur">
        <h2 className="text-2xl font-bold text-center mb-6 text-slate-900 dark:text-slate-100">
          Kyrgyz AI
        </h2>
        <p className="text-center text-slate-600 dark:text-slate-300 mb-8 text-sm">
          Чатка кирүү үчүн кириңиз же катталыңыз. 
        </p>
        <LoginPanel 
          onAuthed={(token: string, email: string) => {
            useAppStore.getState().setAuth(token);
            syncFromServer().catch(() => {});
            props.onLogin(token, email);
          }}
        />
      </div>
    </div>
  );
}
