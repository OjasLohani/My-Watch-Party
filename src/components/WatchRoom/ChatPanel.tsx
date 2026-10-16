import { useState, useRef, useEffect } from 'react';
import { Send, Smile, Shield } from 'lucide-react';
import type { ChatMessage, User } from '../../types';
import { REACTION_EMOJIS } from '../../lib/reactions';

interface ChatPanelProps {
  messages: ChatMessage[];
  currentUser: User;
  onSendMessage: (text: string) => void;
  onTriggerReaction: (emoji: string) => void;
}

export function ChatPanel({
  messages,
  currentUser,
  onSendMessage,
  onTriggerReaction,
}: ChatPanelProps) {
  const [inputText, setInputText] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputText.trim()) return;
    onSendMessage(inputText.trim());
    setInputText('');
  };

  return (
    <div className="flex h-full flex-col bg-[#0A0C13]">
      {/* Messages Feed */}
      <div
        className="flex-1 overflow-y-auto p-4 space-y-3 min-h-[300px] max-h-[460px]"
        role="log"
        aria-live="polite"
        aria-label="Chat messages"
      >
        {messages.length === 0 && (
          <p className="mt-10 text-center text-[11px] text-slate-400">
            No messages yet. Say hello to the room 👋
          </p>
        )}
        {messages.map((msg) => {
          if (msg.isSystem) {
            return (
              <div
                key={msg.id}
                className="rounded-lg border border-white/[0.08] bg-white/[0.02] p-2 text-center text-[11px] text-slate-400 font-mono"
              >
                {msg.text}
              </div>
            );
          }

          const isMe = msg.userId === currentUser.id;

          return (
            <div
              key={msg.id}
              className={`flex items-start gap-2.5 ${isMe ? 'flex-row-reverse' : ''}`}
            >
              {msg.userAvatar ? (
                <img
                  src={msg.userAvatar}
                  alt={msg.userName}
                  className="h-7 w-7 rounded-full object-cover shrink-0 border border-white/20"
                  onError={(e) => {
                    e.currentTarget.src = 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=120&auto=format&fit=crop&q=80';
                  }}
                />
              ) : (
                <div
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white"
                  style={{ backgroundColor: msg.userColor }}
                >
                  {msg.userName.charAt(0)}
                </div>
              )}

              <div
                className={`max-w-[82%] rounded-2xl px-3.5 py-2 text-xs leading-relaxed ${
                  isMe
                    ? 'rounded-tr-none bg-violet-600 text-white shadow-md shadow-violet-950/40'
                    : 'rounded-tl-none border border-white/[0.08] bg-white/[0.03] text-slate-200'
                }`}
              >
                <div className={`flex items-center gap-1.5 font-bold text-[10px] mb-0.5 ${isMe ? 'text-violet-200' : 'text-slate-400'}`}>
                  <span>{msg.userName}</span>
                  {isMe && currentUser.isHost && (
                    <Shield className="h-2.5 w-2.5 text-amber-300" />
                  )}
                  <span className={`font-normal font-mono ${isMe ? 'text-violet-200/70' : 'text-slate-400'}`}>
                    {msg.timestamp}
                  </span>
                </div>
                <p className="break-words">{msg.text}</p>
              </div>
            </div>
          );
        })}
        <div ref={messagesEndRef} />
      </div>

      {/* Floating Reaction Bar */}
      <div className="border-t border-white/[0.06] bg-[#07080E] px-3.5 py-2">
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-semibold tracking-wider uppercase text-slate-400 flex items-center gap-1.5">
            <Smile className="h-3 w-3 text-violet-400" />
            Reactions
          </span>
          <div className="flex items-center gap-1">
            {REACTION_EMOJIS.map((emoji) => (
              <button
                key={emoji}
                type="button"
                onClick={() => onTriggerReaction(emoji)}
                className="rounded-lg p-1.5 text-base transition-transform hover:scale-125 hover:bg-white/[0.08] active:scale-95"
                title={`Send ${emoji} reaction`}
                aria-label={`Send ${emoji} reaction`}
              >
                {emoji}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Input Message Form */}
      <form onSubmit={handleSubmit} className="border-t border-white/[0.06] p-3 bg-[#0A0C13]">
        <div className="relative flex items-center">
          <input
            type="text"
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            maxLength={500}
            placeholder="Send message to theater..."
            aria-label="Chat message"
            className="w-full rounded-xl border border-white/[0.08] bg-white/[0.03] py-2.5 pl-3.5 pr-10 text-xs text-white placeholder-slate-500 transition-colors focus:border-violet-500/60 focus:bg-white/[0.05] focus:outline-none"
          />
          <button
            type="submit"
            disabled={!inputText.trim()}
            className="absolute right-1.5 rounded-lg bg-violet-600 hover:bg-violet-500 p-1.5 text-white transition-all disabled:opacity-40"
            aria-label="Send message"
          >
            <Send className="h-3.5 w-3.5" />
          </button>
        </div>
      </form>
    </div>
  );
}
