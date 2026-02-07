'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { ChatMessage, TranscriptEntry } from '@/types';

interface LiveTranscriptChatProps {
  transcript: TranscriptEntry[];
  chatMessages: ChatMessage[];
  onSendMessage: (message: ChatMessage) => void;
  speakers: string[];
  isTherapistTyping: boolean;
  partialTranscript?: string;
}

const THERAPIST_COLOR = { bg: 'bg-emerald-50', text: 'text-emerald-900', border: 'border-emerald-200' };

const SPEAKER_COLORS = [
  { bg: 'bg-blue-50', text: 'text-blue-900', border: 'border-blue-200' },
  { bg: 'bg-purple-50', text: 'text-purple-900', border: 'border-purple-200' },
  { bg: 'bg-amber-50', text: 'text-amber-900', border: 'border-amber-200' },
  { bg: 'bg-pink-50', text: 'text-pink-900', border: 'border-pink-200' },
  { bg: 'bg-teal-50', text: 'text-teal-900', border: 'border-teal-200' },
  { bg: 'bg-orange-50', text: 'text-orange-900', border: 'border-orange-200' },
];

export default function LiveTranscriptChat({
  transcript,
  chatMessages,
  onSendMessage,
  speakers,
  isTherapistTyping,
  partialTranscript,
}: LiveTranscriptChatProps) {
  const [inputText, setInputText] = useState('');
  const [selectedSpeaker, setSelectedSpeaker] = useState('');
  const chatEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Build a unified timeline: transcript entries + chat messages, sorted by timestamp
  const timeline = buildTimeline(transcript, chatMessages);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [timeline.length, isTherapistTyping]);

  // Set default speaker when speakers list updates
  useEffect(() => {
    if (speakers.length > 0 && !selectedSpeaker) {
      setSelectedSpeaker(speakers[0]);
    }
  }, [speakers, selectedSpeaker]);

  // Assign colors to speakers
  const speakerColorMap = useRef(new Map<string, number>());
  let colorIdx = 0;
  for (const item of timeline) {
    const name = item.type === 'transcript' ? item.data.speaker : item.data.speaker || '';
    if (name && !speakerColorMap.current.has(name)) {
      speakerColorMap.current.set(name, colorIdx++);
    }
  }

  const getSpeakerColor = (name: string) => {
    const idx = (speakerColorMap.current.get(name) ?? 0) % SPEAKER_COLORS.length;
    return SPEAKER_COLORS[idx];
  };

  const handleSend = useCallback(() => {
    const text = inputText.trim();
    if (!text || !selectedSpeaker) return;

    const message: ChatMessage = {
      id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      role: 'speaker',
      speaker: selectedSpeaker,
      text,
      timestamp: Date.now(),
      kind: 'message',
    };

    onSendMessage(message);
    setInputText('');
    inputRef.current?.focus();
  }, [inputText, selectedSpeaker, onSendMessage]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Chat messages area */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3 max-h-[500px] bg-gray-50 rounded-t-lg border border-gray-200">
        {timeline.length === 0 && (
          <div className="text-center text-gray-400 py-12">
            <p className="text-lg font-medium">No messages yet</p>
            <p className="text-sm mt-1">Start a session or type a message below</p>
          </div>
        )}

        {timeline.map((item) => {
          if (item.type === 'transcript') {
            const entry = item.data as TranscriptEntry;
            const colors = getSpeakerColor(entry.speaker);
            return (
              <div key={item.key} className="flex items-start gap-2">
                <div className="flex-shrink-0 w-2 h-2 mt-2.5 rounded-full bg-gray-300" />
                <div className={`px-3 py-2 rounded-lg border ${colors.bg} ${colors.text} ${colors.border} max-w-[85%]`}>
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="font-semibold text-xs">{entry.speaker}</span>
                    <span className="text-[10px] opacity-50">
                      {new Date(entry.timestamp).toLocaleTimeString()}
                    </span>
                    <span className="text-[10px] opacity-40 italic">transcript</span>
                  </div>
                  <p className="text-sm">{entry.text}</p>
                </div>
              </div>
            );
          }

          // Chat message
          const msg = item.data as ChatMessage;
          const isTherapist = msg.role === 'therapist';
          const isAnalysis = msg.kind === 'analysis-summary';
          const colors = isTherapist ? THERAPIST_COLOR : getSpeakerColor(msg.speaker || '');

          return (
            <div
              key={item.key}
              className={`flex ${isTherapist ? 'justify-start' : 'justify-end'}`}
            >
              <div
                className={`px-4 py-2.5 rounded-lg border max-w-[85%] ${colors.bg} ${colors.text} ${colors.border} ${
                  isAnalysis ? 'ring-1 ring-emerald-300' : ''
                }`}
              >
                <div className="flex items-center gap-2 mb-0.5">
                  <span className="font-semibold text-xs">
                    {isTherapist ? 'Therapist' : msg.speaker}
                  </span>
                  <span className="text-[10px] opacity-50">
                    {new Date(msg.timestamp).toLocaleTimeString()}
                  </span>
                  {isAnalysis && (
                    <span className="text-[10px] bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded-full font-medium">
                      Analysis
                    </span>
                  )}
                </div>
                <p className="text-sm whitespace-pre-wrap">{msg.text}</p>
              </div>
            </div>
          );
        })}

        {/* Partial streaming transcript */}
        {partialTranscript && (
          <div className="flex items-start gap-2">
            <div className="flex-shrink-0 w-2 h-2 mt-2.5 rounded-full bg-green-400 animate-pulse" />
            <div className="px-3 py-2 rounded-lg border border-dashed border-gray-300 bg-gray-50 text-gray-600 max-w-[85%]">
              <div className="flex items-center gap-2 mb-0.5">
                <span className="text-[10px] opacity-50 italic">transcribing...</span>
              </div>
              <p className="text-sm italic">{partialTranscript}</p>
            </div>
          </div>
        )}

        {/* Typing indicator */}
        {isTherapistTyping && (
          <div className="flex justify-start">
            <div className={`px-4 py-2.5 rounded-lg border ${THERAPIST_COLOR.bg} ${THERAPIST_COLOR.text} ${THERAPIST_COLOR.border}`}>
              <div className="flex items-center gap-2 mb-0.5">
                <span className="font-semibold text-xs">Therapist</span>
              </div>
              <div className="flex items-center gap-1">
                <div className="w-1.5 h-1.5 bg-emerald-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                <div className="w-1.5 h-1.5 bg-emerald-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                <div className="w-1.5 h-1.5 bg-emerald-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
              </div>
            </div>
          </div>
        )}

        <div ref={chatEndRef} />
      </div>

      {/* Input area */}
      <div className="bg-white border border-t-0 border-gray-200 rounded-b-lg p-3">
        <div className="flex items-center gap-2">
          {/* Speaker dropdown */}
          <select
            value={selectedSpeaker}
            onChange={(e) => setSelectedSpeaker(e.target.value)}
            className="flex-shrink-0 w-36 px-3 py-2 bg-gray-50 border border-gray-300 rounded-lg text-sm font-medium focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
          >
            {speakers.length === 0 && (
              <option value="" disabled>No speakers</option>
            )}
            {speakers.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>

          {/* Text input */}
          <input
            ref={inputRef}
            type="text"
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type a message or question for the therapist..."
            className="flex-1 px-4 py-2 border border-gray-300 rounded-lg text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
            disabled={!selectedSpeaker}
          />

          {/* Send button */}
          <button
            onClick={handleSend}
            disabled={!inputText.trim() || !selectedSpeaker}
            className={`flex-shrink-0 px-4 py-2 rounded-lg font-medium text-sm text-white transition-all ${
              !inputText.trim() || !selectedSpeaker
                ? 'bg-gray-300 cursor-not-allowed'
                : 'bg-blue-500 hover:bg-blue-600 active:scale-95'
            }`}
          >
            Send
          </button>
        </div>

        <p className="text-[11px] text-gray-400 mt-1.5 px-1">
          Messages are sent to the Therapist AI for guidance. Select your name from the dropdown.
        </p>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------
// Helpers
// ------------------------------------------------------------------

interface TimelineItem {
  key: string;
  type: 'transcript' | 'chat';
  timestamp: number;
  data: TranscriptEntry | ChatMessage;
}

function buildTimeline(
  transcript: TranscriptEntry[],
  chatMessages: ChatMessage[],
): TimelineItem[] {
  const items: TimelineItem[] = [];

  for (let i = 0; i < transcript.length; i++) {
    items.push({
      key: `t-${i}`,
      type: 'transcript',
      timestamp: transcript[i].timestamp,
      data: transcript[i],
    });
  }

  for (const msg of chatMessages) {
    items.push({
      key: `c-${msg.id}`,
      type: 'chat',
      timestamp: msg.timestamp,
      data: msg,
    });
  }

  items.sort((a, b) => a.timestamp - b.timestamp);
  return items;
}
