'use client';

import { TranscriptEntry } from '@/types';
import { useEffect, useRef, useMemo } from 'react';

interface TranscriptDisplayProps {
  transcript: TranscriptEntry[];
}

const SPEAKER_COLORS = [
  { bg: 'bg-blue-100', text: 'text-blue-900' },
  { bg: 'bg-purple-100', text: 'text-purple-900' },
  { bg: 'bg-green-100', text: 'text-green-900' },
  { bg: 'bg-amber-100', text: 'text-amber-900' },
  { bg: 'bg-pink-100', text: 'text-pink-900' },
  { bg: 'bg-teal-100', text: 'text-teal-900' },
];

export default function TranscriptDisplay({ transcript }: TranscriptDisplayProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [transcript]);

  // Assign colors to speakers in order of appearance
  const speakerColorMap = useMemo(() => {
    const map = new Map<string, number>();
    for (const entry of transcript) {
      if (!map.has(entry.speaker)) {
        map.set(entry.speaker, map.size);
      }
    }
    return map;
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
        {transcript.map((entry, index) => {
          const colorIdx = (speakerColorMap.get(entry.speaker) ?? 0) % SPEAKER_COLORS.length;
          const colors = SPEAKER_COLORS[colorIdx];
          const isEven = colorIdx % 2 === 0;

          return (
            <div
              key={index}
              className={`flex flex-col ${isEven ? 'items-start' : 'items-end'}`}
            >
              <div className={`px-4 py-2 rounded-lg max-w-[80%] ${colors.bg} ${colors.text}`}>
                <div className="font-semibold text-sm mb-1">{entry.speaker}</div>
                <div className="text-base">{entry.text}</div>
                <div className="text-xs opacity-70 mt-1">
                  {new Date(entry.timestamp).toLocaleTimeString()}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
