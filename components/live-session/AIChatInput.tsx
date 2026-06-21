'use client';

import { useState, useRef, KeyboardEvent } from 'react';
import { Send, Sparkles, Loader2 } from 'lucide-react';
import { motion } from 'framer-motion';

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
    <div className="border-t border-default bg-surface p-4">
      <div className="flex items-center gap-2 mb-3">
        <Sparkles className="w-4 h-4 text-accent" />
        <span className="text-sm font-medium text-primary">Ask AI for Guidance</span>
      </div>
      
      <div className="flex gap-3">
        {/* Speaker Selector */}
        <select
          value={selectedSpeaker}
          onChange={(e) => setSelectedSpeaker(e.target.value)}
          disabled={speakers.length === 0 || isSending}
          className="flex-shrink-0 px-3 py-2 rounded-lg border border-default bg-base text-primary text-sm font-medium focus:ring-2 focus:ring-accent focus:border-accent disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <option value="">Select speaker</option>
          {speakers.map(speaker => (
            <option key={speaker} value={speaker}>{speaker}</option>
          ))}
        </select>

        {/* Message Input */}
        <div className="flex-1 relative">
          <textarea
            ref={textareaRef}
            value={message}
            onChange={handleTextareaChange}
            onKeyDown={handleKeyDown}
            placeholder="Type your question or concern for AI guidance..."
            disabled={!selectedSpeaker || isSending || isProcessing}
            className="w-full px-4 py-2 pr-12 rounded-lg border border-default bg-base text-primary text-sm resize-none focus:ring-2 focus:ring-accent focus:border-accent disabled:opacity-50 disabled:cursor-not-allowed"
            rows={1}
            style={{ minHeight: '40px', maxHeight: '120px' }}
          />
          
          <button
            onClick={handleSend}
            disabled={!message.trim() || !selectedSpeaker || isSending || isProcessing}
            className="absolute right-2 top-1/2 -translate-y-1/2 p-2 rounded-lg bg-accent text-white hover:bg-accent/90 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors"
          >
            {isSending || isProcessing ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Send className="w-4 h-4" />
            )}
          </button>
        </div>
      </div>
      
      <p className="text-xs text-secondary mt-2">
        Press Enter to send, Shift+Enter for new line
      </p>
    </div>
  );
}
