import { useState } from "react";
import { requestLoginCode, verifyLoginCode, register, login } from "../../api/auth";

export default function LoginPanel(props: { onAuthed: (token: string, email: string) => void }) {
  const [tab, setTab] = useState<"password" | "code">("password");
  const [mode, setMode] = useState<"login" | "register">("login");
  
  // Registration states
  const [username, setUsername] = useState("");
  const [emailReg, setEmailReg] = useState(""); 
  const [password, setPassword] = useState("");
  
  // Login/Verification states
  const [identifier, setIdentifier] = useState("");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [step, setStep] = useState<"email" | "code">("email");
  
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | undefined>();
  const [note, setNote] = useState<string | undefined>();

  return (
    <div className="rounded-2xl bg-white/70 dark:bg-slate-950/60 ring-1 ring-slate-200 dark:ring-white/10 p-4 backdrop-blur">
      {/* Tab Switcher */}
      <div className="flex bg-slate-200/50 dark:bg-white/5 rounded-xl p-1 mb-4">
        <button 
          className={`flex-1 px-3 py-1.5 rounded-lg font-semibold text-sm transition-all ${tab === "password" ? "bg-white dark:bg-white/10 shadow-sm" : "text-slate-500"}`}
          onClick={() => { setTab("password"); setErr(undefined); setNote(undefined); }}
        >
          Сөз айкашы
        </button>
        <button 
          className={`flex-1 px-3 py-1.5 rounded-lg font-semibold text-sm transition-all ${tab === "code" ? "bg-white dark:bg-white/10 shadow-sm" : "text-slate-500"}`}
          onClick={() => { setTab("code"); setErr(undefined); setNote(undefined); }}
        >
          Email Код
        </button>
      </div>

      <div className="flex flex-col gap-3">
        {err && <div className="text-xs text-red-500 bg-red-50 dark:bg-red-900/20 p-2 rounded-lg">{err}</div>}
        {note && <div className="text-xs text-emerald-600 bg-emerald-50 dark:bg-emerald-900/20 p-2 rounded-lg">{note}</div>}

        {tab === "password" ? (
          <>
            {mode === "register" && (
              <input
                className="px-4 py-2 rounded-xl bg-slate-100 dark:bg-white/5 border-none focus:ring-2 focus:ring-indigo-500 outline-none"
                placeholder="Колдонуучунун аты (Username)"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
              />
            )}
            <input
              className="px-4 py-2 rounded-xl bg-slate-100 dark:bg-white/5 border-none focus:ring-2 focus:ring-indigo-500 outline-none"
              placeholder={mode === "login" ? "Email же Username" : "Электрондук почта (Email)"}
              value={mode === "login" ? identifier : emailReg}
              onChange={(e) => mode === "login" ? setIdentifier(e.target.value) : setEmailReg(e.target.value)}
            />
            <input
              type="password"
              className="px-4 py-2 rounded-xl bg-slate-100 dark:bg-white/5 border-none focus:ring-2 focus:ring-indigo-500 outline-none"
              placeholder="Сөз айкашы (Password)"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            
            <button
              disabled={busy}
              className="mt-2 bg-indigo-600 text-white py-2 rounded-xl font-semibold hover:bg-indigo-500 disabled:opacity-50"
              onClick={async () => {
                setBusy(true); setErr(undefined);
                try {
                  if (mode === "login") {
                    const r = await login(identifier, password);
                    props.onAuthed(r.access_token, r.user.email);
                  } else {
                    // 1. Call Register
                    await register(username, emailReg, password);
                    // 2. Success! Now move to verification step
                    setNote("Каттоо коду почтаңызга жөнөтүлдү. Аны бул жерге жазыңыз.");
                    setEmail(emailReg); // Transfer email to the verification state
                    setTab("code");      // Switch to the Code tab
                    setStep("code");     // Set step to enter code
                  }
                } catch (e: any) {
                  setErr(e.message);
                } finally { setBusy(false); }
              }}
            >
              {busy ? "Жүктөлүүдө..." : (mode === "login" ? "Кирүү" : "Катталуу")}
            </button>
            
            <button 
              className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline"
              onClick={() => setMode(mode === "login" ? "register" : "login")}
            >
              {mode === "login" ? "Аккаунт жокпу? Катталуу" : "Аккаунтуңуз барбы? Кирүү"}
            </button>
          </>
        ) : (
          /* EMAIL CODE TAB LOGIC */
          step === "email" ? (
            <>
              <input
                className="px-4 py-2 rounded-xl bg-slate-100 dark:bg-white/5 border-none focus:ring-2 focus:ring-indigo-500 outline-none"
                placeholder="Электрондук почта"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
              <button
                disabled={busy}
                className="bg-indigo-600 text-white py-2 rounded-xl font-semibold hover:bg-indigo-500 disabled:opacity-50"
                onClick={async () => {
                  setBusy(true); setErr(undefined);
                  try {
                    await requestLoginCode(email.trim());
                    setStep("code");
                    setNote("Код жөнөтүлдү.");
                  } catch (e: any) { setErr(e.message); }
                  finally { setBusy(false); }
                }}
              >
                {busy ? "Жөнөтүлүүдө..." : "Код алуу"}
              </button>
            </>
          ) : (
            <>
              <div className="text-sm font-medium px-1 italic text-slate-500">{email}</div>
              <input
                className="px-4 py-2 rounded-xl bg-slate-100 dark:bg-white/5 border-none focus:ring-2 focus:ring-indigo-500 outline-none"
                placeholder="6-орундуу код"
                value={code}
                onChange={(e) => setCode(e.target.value)}
              />
              <button
                disabled={busy}
                className="bg-indigo-600 text-white py-2 rounded-xl font-semibold hover:bg-indigo-500 disabled:opacity-50"
                onClick={async () => {
                  setBusy(true); setErr(undefined);
                  try {
                    const r = await verifyLoginCode(email.trim(), code.trim());
                    localStorage.setItem("ky_token", r.access_token);
                    props.onAuthed(r.access_token, r.user.email);
                  } catch (e: any) { setErr(e.message); }
                  finally { setBusy(false); }
                }}
              >
                {busy ? "Текшерүү..." : "Ырастоо жана Кирүү"}
              </button>
              <button className="text-xs text-slate-500 hover:underline" onClick={() => setStep("email")}>Артка</button>
            </>
          )
        )}
      </div>
    </div>
  );
}