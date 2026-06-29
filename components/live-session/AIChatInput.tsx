'use client';

import { useState, useRef, KeyboardEvent } from 'react';
import { Send, Sparkles, Smile, Paperclip } from 'lucide-react';

interface AIChatInputProps {
  onSendMessage: (message: string, speaker: string) => Promise<void>;
  speakers: string[];
  isProcessing?: boolean;
}

export function AIChatInput({ onSendMessage, speakers, isProcessing }: AIChatInputProps) {
  const [message, setMessage] = useState('');
  const [selectedSpeaker, setSelectedSpeaker] = useState('');
  const [isSending, setIsSending] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleSend = async () => {
    if (!message.trim() || !selectedSpeaker || isSending) return;

    setIsSending(true);
    try {
      await onSendMessage(message, selectedSpeaker);
      setMessage('');
      if (textareaRef.current) {
        textareaRef.current.style.height = 'auto';
      }
    } finally {
      setIsSending(false);
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleTextareaChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setMessage(e.target.value);
    e.target.style.height = 'auto';
    e.target.style.height = `${Math.min(e.target.scrollHeight, 120)}px`;
  };

  return (
    <div className="bg-surface p-3 border-t border-default">
      {/* Header with AI indicator */}
      <div className="flex items-center gap-2 mb-2 px-2">
        <div className="flex items-center gap-2 bg-base px-3 py-1.5 rounded-full shadow-sm border border-default">
          <Sparkles className="w-3.5 h-3.5 text-accent" />
          <span className="text-xs font-medium text-primary">AI Assistant</span>
        </div>
      </div>
      
      <div className="flex items-end gap-2">
        {/* Speaker Selector - WhatsApp style */}
        <div className="flex-shrink-0">
          <select
            value={selectedSpeaker}
            onChange={(e) => setSelectedSpeaker(e.target.value)}
            disabled={speakers.length === 0 || isSending}
            className="h-11 px-3 rounded-lg bg-base text-primary text-sm font-medium border border-default focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent disabled:opacity-50 disabled:cursor-not-allowed shadow-sm"
          >
            <option value="">Speaker</option>
            {speakers.map(speaker => (
              <option key={speaker} value={speaker}>{speaker}</option>
            ))}
          </select>
        </div>

        {/* Message Input Container - WhatsApp style */}
        <div className="flex-1 flex items-end bg-base rounded-lg shadow-sm border border-default">
          <textarea
            ref={textareaRef}
            value={message}
            onChange={handleTextareaChange}
            onKeyDown={handleKeyDown}
            placeholder="Type a message"
            disabled={!selectedSpeaker || isSending || isProcessing}
            className="flex-1 px-4 py-2.5 bg-transparent text-primary text-[15px] resize-none focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed placeholder:text-secondary"
            rows={1}
            style={{ minHeight: '44px', maxHeight: '120px' }}
          />
        </div>
        
        {/* Send Button - WhatsApp style */}
        <button
          onClick={handleSend}
          disabled={!message.trim() || !selectedSpeaker || isSending || isProcessing}
          className="flex-shrink-0 w-11 h-11 flex items-center justify-center rounded-full bg-accent hover:bg-accent/90 disabled:bg-gray-400 disabled:cursor-not-allowed transition-all shadow-sm active:scale-95"
        >
          {isSending || isProcessing ? (
            <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
          ) : (
            <Send className="w-5 h-5 text-white" fill="white" />
          )}
        </button>
      </div>
    </div>
  );
}
