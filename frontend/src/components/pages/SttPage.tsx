import { AudioManager } from '../AudioManager';
import Transcript from '../Transcript';
import { useEffect } from 'react';
export default function SttPage({ setTab, ...props }: any) {
  useEffect(() => {
    setTab('stt'); // Sync the sidebar highlight if someone refreshes on this page
  }, [setTab]);
  const { transcriber } = props;

  return (
    <div className="flex-1 overflow-y-auto p-4 md:p-8">
      <div className="max-w-3xl mx-auto space-y-8">
        <div className="text-center space-y-2">
          <h1 className="text-3xl font-bold text-slate-900 dark:text-white">Кыргызча STT</h1>
          <p className="text-slate-500">Үнүңүздү текстке айлантуу үчүн микрофонду иштетиңиз.</p>
        </div>

        <div className="flex justify-center">
          <AudioManager transcriber={transcriber} />
        </div>

        <div className="bg-white dark:bg-slate-900 rounded-3xl shadow-xl shadow-slate-200/50 dark:shadow-none border border-slate-100 dark:border-slate-800 overflow-hidden">
          <div className="p-4 border-b border-slate-50 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/50">
            <h2 className="font-semibold text-slate-700 dark:text-slate-300">Транскрипция</h2>
          </div>
          <div className="p-6 min-h-[200px]">
             <Transcript transcribedData={transcriber.output} />
          </div>
        </div>
      </div>
    </div>
  );
}