import { useEffect, useRef } from 'react';
export default function TtsPage({ ttsAudioUrl,setTab, ...props }: any) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  // Automatically play when a new audio URL arrives
  useEffect(() => {
    if (ttsAudioUrl && audioRef.current) {
      audioRef.current.play().catch(err => {
        console.error("Autoplay blocked or failed:", err);
      });
    }
  }, [ttsAudioUrl]);
    useEffect(() => {
      setTab('tts'); // Sync the sidebar highlight if someone refreshes on this page
    }, [setTab]);
    const { ttsText, setTtsText, onTts, busy,  ttsCleaned } = props;

  
    return (
      <div className="h-full overflow-y-auto">
      <div className="p-6 max-w-2xl mx-auto">
        <h2 className="text-2xl font-bold mb-4 dark:text-white">Кыргызча TTS</h2>
        
        {/* Hidden audio element */}
        <audio ref={audioRef} src={ttsAudioUrl} />
  
        <textarea
          className="w-full p-4 rounded-xl border dark:bg-slate-900 dark:border-slate-700 mb-4"
          rows={4}
          value={ttsText}
          onChange={(e) => props.setTtsText(e.target.value)}
          placeholder="Бул жерге текст жазыңыз..."
        />
  
        <button
          onClick={onTts}
          disabled={busy.tts}
          className="px-6 py-3 bg-indigo-600 text-white rounded-xl font-bold hover:bg-indigo-500 disabled:opacity-50 transition-all"
        >
          {busy.tts ? "Генерацияланууда..." : "Угуу"}
        </button>
  
        {ttsAudioUrl && (
          <div className="mt-6 p-4 bg-emerald-500/10 border border-emerald-500/20 rounded-xl">
            <p className="text-sm text-emerald-600 dark:text-emerald-400 mb-2">Даяр! Төмөндөн жүктөп алсаңыз болот:</p>
            <a 
              href={ttsAudioUrl} 
              download="kyrgyz_speech.wav"
              className="text-indigo-500 hover:underline font-medium"
            >
              💾 Аудиону жүктөө (.wav)
            </a>
          </div>
        )}
      </div>
      </div>
    );
  }