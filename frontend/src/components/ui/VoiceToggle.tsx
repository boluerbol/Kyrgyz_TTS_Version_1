import type { VoiceModel } from "../../api/kyrgyzService";

export function VoiceToggle(props: {
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="inline-flex rounded-xl bg-white/70 ring-1 ring-slate-200 p-1 shadow-sm">
      <button
        className={`px-3 py-2 text-sm font-semibold rounded-lg transition-all ${
          props.value === "female"
            ? "bg-indigo-600 text-white shadow"
            : "text-slate-700 hover:bg-slate-100"
        }`}
        onClick={() => props.onChange("female")}
      >
        Аял үн
      </button>
      <button
        className={`px-3 py-2 text-sm font-semibold rounded-lg transition-all ${
          props.value === "male"
            ? "bg-indigo-600 text-white shadow"
            : "text-slate-700 hover:bg-slate-100"
        }`}
        onClick={() => props.onChange("male")}
      >
        Эркек үн
      </button>
    </div>
  );
}

