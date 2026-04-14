// src/components/views/ChatView.tsx
import { MessageBubble } from '../chat/MessageBubble';
import { ChatComposer } from '../chat/ChatComposer';

export function ChatView({ activeConversation, onSendRealtime, chatEndRef, busy }: any) {
    return (
        <div className="flex flex-col h-full">
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {activeConversation?.messages.map((msg: any, i: number) => (
                <MessageBubble 
                    key={i} 
                    m={msg} // Changed from 'message={msg}' to 'm={msg}'
                />
            ))}
                <div ref={chatEndRef} />
            </div>
            <div className="p-4 border-t border-slate-200 dark:border-slate-800">
                <ChatComposer onSend={onSendRealtime} disabled={busy.wsSend} />
            </div>
        </div>
    );
}