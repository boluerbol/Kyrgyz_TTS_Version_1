// src/components/views/SttView.tsx
import { AudioManager } from '../AudioManager';
import Transcript from '../Transcript';

interface SttViewProps {
  transcriber: any;
  sttText: string;
  setSttText: (v: string) => void;
}

export function SttView({ transcriber, sttText, setSttText }: SttViewProps) {
  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden p-4 lg:p-6">
      <div className="max-w-4xl mx-auto w-full flex flex-col h-full gap-6">
        
        {/* Header Section */}
        <div>
          <h2 className="text-2xl font-bold text-slate-900 dark:text-white">
            Кыргызча кепти текстке айлантуу (STT)
          </h2>
          <p className="text-slate-500 dark:text-slate-400 mt-1">
            Микрофон аркылуу сүйлөңүз же аудио файл жүктөп бериңиз.
          </p>
        </div>

        {/* Audio Controls Section */}
        <div className="bg-white dark:bg-slate-900 rounded-3xl p-6 shadow-sm border border-slate-100 dark:border-slate-800">
          <AudioManager transcriber={transcriber} />
        </div>

        {/* Real-time Transcription Display */}
        <div className="flex-1 min-h-0 bg-white dark:bg-slate-900 rounded-3xl shadow-sm border border-slate-100 dark:border-slate-800 flex flex-col overflow-hidden">
          <div className="p-4 border-b border-slate-50 dark:border-slate-800 flex justify-between items-center">
            <span className="font-semibold text-sm uppercase tracking-wider text-slate-500">
              Транскрипция
            </span>
            {transcriber.isBusy && (
              <span className="flex h-2 w-2 rounded-full bg-red-500 animate-pulse" />
            )}
          </div>
          
          <div className="flex-1 overflow-y-auto p-6">
            <Transcript 
              transcribedData={transcriber.output} 
            />
            
            {!transcriber.output && !transcriber.isBusy && (
              <div className="h-full flex items-center justify-center text-slate-400 italic">
                Азырынча маалымат жок...
              </div>
            )}
          </div>
        </div>

        {/* Editable Result Area */}
        {transcriber.output && (
            <div className="bg-indigo-50 dark:bg-indigo-950/30 border border-indigo-100 dark:border-indigo-900/50 rounded-2xl p-4">
                <label className="text-xs font-bold text-indigo-600 dark:text-indigo-400 mb-2 block uppercase">
                    Акыркы натыйжа (түзөтсө болот):
                </label>
                <textarea 
                    className="w-full bg-transparent border-none focus:ring-0 text-slate-800 dark:text-slate-200 resize-none"
                    value={sttText}
                    onChange={(e) => setSttText(e.target.value)}
                    rows={3}
                />
            </div>
        )}
      </div>
    </div>
  );
}