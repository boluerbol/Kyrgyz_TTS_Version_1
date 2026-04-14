// src/components/views/TtsView.tsx
export function TtsView({ ttsText, setTtsText, onTts, busy, ttsAudioUrl, ttsCleaned }: any) {
    return (
        <div className="p-6 max-w-4xl mx-auto w-full">
            <h2 className="text-2xl font-bold mb-4">Текстти үнгө айлантуу</h2>
            <textarea
                className="w-full h-40 p-4 rounded-2xl border border-slate-200 dark:bg-slate-900 focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                placeholder="Бул жерге текстти жазыңыз..."
                value={ttsText}
                onChange={(e) => setTtsText(e.target.value)}
            />
            <button
                className="mt-4 px-6 py-3 bg-indigo-600 text-white rounded-xl font-semibold hover:bg-indigo-500 disabled:opacity-50 transition-colors"
                disabled={busy.tts}
                onClick={onTts}
            >
                {busy.tts ? 'Күтө туруңуз...' : 'Үнгө айлантуу'}
            </button>

            {ttsAudioUrl && (
                <div className="mt-8 p-6 bg-white dark:bg-slate-900 rounded-3xl shadow-sm border border-slate-100">
                    <p className="font-bold mb-2">Натыйжа:</p>
                    <audio src={ttsAudioUrl} controls className="w-full" />
                </div>
            )}
        </div>
    );
}