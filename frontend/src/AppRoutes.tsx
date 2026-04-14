// src/AppRoutes.tsx
import { Routes, Route, Navigate } from 'react-router-dom';
import { useAppStore } from './state/appStore';
import ChatPage from './components/pages/ChatPage';
import TtsPage from './components/pages/TtsPage';
import SttPage from './components/pages/SttPage';
import LivePage from './components/pages/LivePage';
import LoginPanel from './components/auth/LoginPanel';
import { ProtectedApp } from './components/layout/ProtectedApp';

export default function AppRoutes({ sharedProps }: any) {
  const isAuthed = useAppStore((s) => !!s.token);
  const setAuth = useAppStore((s) => s.setAuth);
  const syncFromServer = useAppStore((s) => s.syncFromServer);

  const handleLogin = (token: string, email: string) => {
    localStorage.setItem('ky_token', token);
    localStorage.setItem('ky_authed_email', email);
    setAuth(token);
    syncFromServer().catch(() => {});
  };

  return (
    <Routes>
      <Route path="/login" 
        element={!isAuthed ? (
          <div className="flex items-center justify-center min-h-screen bg-slate-50 dark:bg-slate-950">
            <LoginPanel onAuthed={handleLogin} /> 
          </div>
        ) : (
          <Navigate to="/chat" />
        )} 
      />
      
      {/* WRAP PROTECTED ROUTES IN PROTECTEDAPP */}
      <Route path="/chat" element={
        isAuthed ? (
          <ProtectedApp sharedProps={sharedProps}>
            <ChatPage {...sharedProps} />
          </ProtectedApp>
        ) : <Navigate to="/login" />
      } />

      <Route path="/tts" element={
        isAuthed ? (
          <ProtectedApp sharedProps={sharedProps}>
            <TtsPage {...sharedProps} />
          </ProtectedApp>
        ) : <Navigate to="/login" />
      } />

      <Route path="/stt" element={
        isAuthed ? (
          <ProtectedApp sharedProps={sharedProps}>
            <SttPage {...sharedProps} />
          </ProtectedApp>
        ) : <Navigate to="/login" />
      } />

      <Route path="/live" element={
        isAuthed ? (
          <ProtectedApp sharedProps={sharedProps}>
            <LivePage setTab={sharedProps.setTab} />
          </ProtectedApp>
        ) : <Navigate to="/login" />
      } />

      <Route path="/" element={<Navigate to="/chat" />} />
    </Routes>
  );
}