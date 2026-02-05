'use client';

import { TranscriptEntry } from '@/types';
import { useEffect, useRef } from 'react';

interface TranscriptDisplayProps {
  transcript: TranscriptEntry[];
}

export default function TranscriptDisplay({ transcript }: TranscriptDisplayProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Auto-scroll to bottom when new entries are added
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [transcript]);

  if (transcript.length === 0) {
    return (
      <div className="bg-gray-50 border-2 border-dashed border-gray-300 rounded-lg p-8 text-center text-gray-500">
        <p className="text-lg">No transcript yet</p>
        <p className="text-sm mt-2">Start a session to begin recording</p>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="bg-white border border-gray-300 rounded-lg p-6 max-h-96 overflow-y-auto"
    >
      <div className="space-y-4">
        {transcript.map((entry, index) => (
          <div
            key={index}
            className={`flex flex-col ${
              entry.speaker === 'Client 1' ? 'items-start' : 'items-end'
            }`}
          >
            <div
              className={`px-4 py-2 rounded-lg max-w-[80%] ${
                entry.speaker === 'Client 1'
                  ? 'bg-blue-100 text-blue-900'
                  : 'bg-purple-100 text-purple-900'
              }`}
            >
              <div className="font-semibold text-sm mb-1">{entry.speaker}</div>
              <div className="text-base">{entry.text}</div>
              <div className="text-xs opacity-70 mt-1">
                {new Date(entry.timestamp).toLocaleTimeString()}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
