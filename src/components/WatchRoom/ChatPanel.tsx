import { useState, useRef, useEffect } from 'react';
import { SendHorizontal, Crown } from 'lucide-react';
import type { ChatMessage, User } from '../../types';
import { Avatar } from '../ui/Avatar';

interface ChatPanelProps {
  messages: ChatMessage[];
  currentUser: User;
  onSendMessage: (text: string) => void;
  /** Current display names by user id (messages keep the name used when sent as a fallback) */
  nameById?: Map<string, string>;
  /** Id of the current host (their messages get a crown) */
  hostId?: string;
}

export function ChatPanel({ messages, currentUser, onSendMessage, nameById, hostId }: ChatPanelProps) {
  const [inputText, setInputText] = useState('');
  const logRef = useRef<HTMLDivElement>(null);

  // Keep the newest message in view (scrolls only the chat, not the page)
  useEffect(() => {
    const log = logRef.current;
    if (log) log.scrollTop = log.scrollHeight;
  }, [messages]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputText.trim()) return;
    onSendMessage(inputText.trim());
    setInputText('');
  };

  return (
    <div className="flex h-full flex-col">
      <div
        ref={logRef}
        className="flex-1 space-y-4 overflow-y-auto px-4 py-4"
        role="log"
        aria-live="polite"
        aria-label="Chat messages"
        tabIndex={0}
      >
        {messages.length === 0 && (
          <p className="mt-10 text-center text-xs text-ash">No messages yet. Say hello to the room 👋</p>
        )}
        {messages.map((msg) => {
          if (msg.isSystem) {
            return (
              <div key={msg.id} className="rounded-lg border border-bronze-soft bg-ink/40 px-3 py-2 text-center text-[11px] text-ash">
                {msg.text}
              </div>
            );
          }

          const isMe = msg.userId === currentUser.id;
          const senderName = (isMe ? currentUser.name : nameById?.get(msg.userId)) ?? msg.userName;
          const fromHost = Boolean(hostId) && msg.userId === hostId;

          return (
            <div key={msg.id} className="flex items-start gap-3">
              <Avatar name={senderName} src={msg.userAvatar || undefined} color={msg.userColor} size={34} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 text-xs">
                  <span className={`truncate font-semibold ${isMe ? 'text-gold' : 'text-ivory'}`}>{senderName}</span>
                  {fromHost && <Crown className="h-3 w-3 shrink-0 text-gold" aria-label="Host" />}
                  <span className="shrink-0 text-[11px] text-ash-muted">{msg.timestamp}</span>
                </div>
                <p className="mt-0.5 break-words text-[13px] leading-relaxed text-ivory/90">{msg.text}</p>
              </div>
            </div>
          );
        })}
      </div>

      <form onSubmit={handleSubmit} className="border-t border-bronze-soft p-3">
        <div className="relative flex items-center">
          <input
            type="text"
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            maxLength={500}
            placeholder="Type a message…"
            aria-label="Chat message"
            className="field h-11 rounded-full py-0 pl-4 pr-12 text-[13px]"
          />
          <button
            type="submit"
            disabled={!inputText.trim()}
            className="btn-gold absolute right-1.5 h-8 w-8 rounded-full p-0 disabled:opacity-40"
            aria-label="Send message"
          >
            <SendHorizontal className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      </form>
    </div>
  );
}
