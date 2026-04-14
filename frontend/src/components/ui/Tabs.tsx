import { TabKey } from "../../state/appStore";

const LABELS: Record<TabKey, string> = {
  chat: "Чат",
  live: "Live",
  stt: "STT",
  tts: "TTS",
};

export function Tabs(props: {
  value: TabKey;
  onChange: (t: TabKey) => void;
}) {
  const items: TabKey[] = ["chat", "live", "stt", "tts"];
  return (
    <div className="w-full flex justify-center">
      <div className="inline-flex rounded-xl bg-white/70 ring-1 ring-slate-200 p-1 shadow-sm">
        {items.map((k) => {
          const active = props.value === k;
          return (
            <button
              key={k}
              onClick={() => props.onChange(k)}
              className={`px-3 py-2 text-sm font-semibold rounded-lg transition-all ${
                active
                  ? "bg-slate-900 text-white shadow"
                  : "text-slate-700 hover:bg-slate-100"
              }`}
            >
              {LABELS[k]}
            </button>
          );
        })}
      </div>
    </div>
  );
}

