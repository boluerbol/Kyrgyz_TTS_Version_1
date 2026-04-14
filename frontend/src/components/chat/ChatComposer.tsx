import { useEffect, useMemo, useRef } from "react";
import { useAppStore } from "../../state/appStore";
import { VoiceToggle } from "../ui/VoiceToggle";
import { VoiceModel } from "../../api/kyrgyzService";



export function ChatComposer(props: { 
  onSend: (text: string) => void; disabled?: boolean;}) {
  const voice = useAppStore((s) => s.voice);
  const setVoice = useAppStore((s) => s.setVoice);
  const wsStatus = useAppStore((s) => s.wsStatus);
  const busySend = useAppStore((s) => s.busy.wsSend);
  const chatInput = useAppStore((s) => s.chatInput);
  const setChatInput = useAppStore((s) => s.setChatInput);

  const ref = useRef<HTMLTextAreaElement | null>(null);

  const canSend = useMemo(() => 
    !!chatInput.trim() && !busySend && !props.disabled, 
    [chatInput, busySend, props.disabled]
  );

  useEffect(() => {
    ref.current?.focus();
  }, []);

  return (
    <div className="rounded-2xl bg-white/70 ring-1 ring-slate-200 p-3 backdrop-blur">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
        <div className="text-xs font-semibold text-slate-600">
          WebSocket:{" "}
          <span
            className={
              wsStatus === "connected"
                ? "text-emerald-700"
                : wsStatus === "connecting"
                  ? "text-amber-700"
                  : wsStatus === "error"
                    ? "text-rose-700"
                    : "text-slate-600"
            }
          >
            {wsStatus}
          </span>
        </div>
        <VoiceToggle 
          value={voice} 
          onChange={(v: string) => setVoice(v as VoiceModel)} 
        />
      </div>

      <textarea
        ref={ref}
        value={chatInput}
        disabled={props.disabled || busySend} // 3. Also disable the textarea
        onChange={(e) => setChatInput(e.target.value)}
        placeholder="Кыргызча жазыңыз… (Ctrl+Enter менен жиберүү)"
        className="w-full min-h-[80px] max-h-[220px] resize-y rounded-xl ring-1 ring-slate-200 p-3 outline-none focus:ring-2 focus:ring-indigo-500 disabled:bg-slate-50"
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            if (!canSend) return;
            props.onSend(chatInput.trim());
          }
        }}
      />

      <div className="mt-2 flex items-center justify-between gap-2">
        <div className="text-xs text-slate-500">
          Кеңеш: STT табында сүйлөп алып, “Chat’ка жөнөтүү” басыңыз.
        </div>
        <button
          disabled={!canSend}
          onClick={() => props.onSend(chatInput.trim())}
          className="px-4 py-2 rounded-xl bg-indigo-600 text-white font-semibold hover:bg-indigo-500 disabled:opacity-50"
        >
          {busySend || props.disabled ? "Жооп күтүлүүдө…" : "Жиберүү"}
        </button>
      </div>
    </div>
  );
}

