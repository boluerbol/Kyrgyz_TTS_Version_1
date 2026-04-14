import { useEffect } from 'react';
import { ChatComposer } from '../chat/ChatComposer';
import { MessageBubble } from '../chat/MessageBubble';

export default function ChatPage(props: any) {
  
  const { activeConversation, onSendRealtime, chatEndRef, busy } = props;

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [activeConversation?.messages.length]);

  useEffect(() => {
    props.setTab('chat');
  }, []);

  return (
    <div className="flex flex-col h-full bg-white dark:bg-slate-950">
      <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-6">
        {activeConversation?.messages.map((msg: any, i: number) => (
            <MessageBubble 
                key={i} 
                m={msg} // Change 'message={msg}' to 'm={msg}'
            />
        ))}
        <div ref={chatEndRef} />
      </div>
      
      <div className="p-4 border-t border-slate-100 dark:border-slate-800">
        <div className="max-w-4xl mx-auto">
          <ChatComposer 
            onSend={onSendRealtime} 
            disabled={busy.wsSend} 
          />
        </div>
      </div>
    </div>
  );
}