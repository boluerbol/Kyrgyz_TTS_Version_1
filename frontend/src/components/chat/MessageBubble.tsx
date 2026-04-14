import type { ChatMessage } from "../../state/appStore";

export function MessageBubble(props: { m: ChatMessage }) {
  const m = props.m;
  const isUser = m.role === "user";
  const isAssistant = m.role === "assistant";
  const isError = m.role === "error";

  return (
    <div className={`w-full flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[820px] rounded-2xl px-4 py-3 ring-1 shadow-sm ${
          isUser
            ? "bg-slate-900 text-white ring-slate-900"
            : isError
              ? "bg-rose-50 text-rose-800 ring-rose-200"
              : "bg-white text-slate-900 ring-slate-200"
        }`}
      >
        <div className="text-[11px] font-bold opacity-70 mb-1">
          {m.role === "user" ? "Сиз" : m.role === "assistant" ? "AI" : m.role === "system" ? "Система" : "Ката"}
          {isAssistant && m.streaming && <span className="ml-2">• Жооп жазылып жатат…</span>}
        </div>
        <div className="whitespace-pre-wrap leading-relaxed">{m.text}</div>

        {!!m.audioUrls?.length && (
          <div className="mt-3 space-y-2">
            {m.audioUrls.map((u, idx) => (
              <audio key={`${u}_${idx}`} controls src={u} className="w-full" />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

