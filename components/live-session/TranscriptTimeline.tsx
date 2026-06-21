'use client';

import { useRef, useEffect, useState } from 'react';
import { TranscriptEntry } from '@/types';
import { SpeakerBubbleGroup } from './SpeakerBubbleGroup';
import { PendingBubble } from './PendingBubble';
import { ArrowDown } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

interface TranscriptTimelineProps {
  transcript: TranscriptEntry[];
  partialTranscript?: string;
}

export function TranscriptTimeline({ transcript, partialTranscript }: TranscriptTimelineProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [showJumpToLive, setShowJumpToLive] = useState(false);

  const grouped = groupBySpeaker(transcript);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    const handleScroll = () => {
      const isNearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 100;
      setShowJumpToLive(!isNearBottom);
    };

    el.addEventListener('scroll', handleScroll);
    return () => el.removeEventListener('scroll', handleScroll);
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el || showJumpToLive) return;
    el.scrollTop = el.scrollHeight;
  }, [grouped.length, partialTranscript, showJumpToLive]);

  const scrollToBottom = () => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  };

  return (
    <div className="relative h-full">
      <div
        ref={scrollRef}
        className="h-full overflow-y-auto px-2 py-4 space-y-4 scroll-smooth"
      >
        {grouped.length === 0 && !partialTranscript && (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <div className="w-16 h-16 rounded-full bg-gray-100 dark:bg-gray-800 flex items-center justify-center mb-4">
              <svg className="w-8 h-8 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
              </svg>
            </div>
            <p className="text-lg font-medium text-primary">No transcript yet</p>
            <p className="text-sm text-secondary mt-1">Start a session to begin real-time transcription</p>
          </div>
        )}

        {grouped.map((group, idx) => (
          <SpeakerBubbleGroup key={idx} speaker={group.speaker} entries={group.entries} />
        ))}

        <AnimatePresence>
          {partialTranscript && <PendingBubble text={partialTranscript} />}
        </AnimatePresence>
      </div>

      {/* Jump to Live Button */}
      <AnimatePresence>
        {showJumpToLive && (
          <motion.button
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 10 }}
            onClick={scrollToBottom}
            className="absolute bottom-4 right-4 flex items-center gap-2 px-4 py-2 rounded-full bg-accent text-white shadow-lg hover:bg-accent/90 transition-colors"
          >
            <ArrowDown className="w-4 h-4" />
            <span className="text-sm font-medium">Jump to live</span>
          </motion.button>
        )}
      </AnimatePresence>
    </div>
  );
}

function groupBySpeaker(transcript: TranscriptEntry[]) {
  const groups: Array<{ speaker: string; entries: TranscriptEntry[] }> = [];
  
  for (const entry of transcript) {
    const lastGroup = groups[groups.length - 1];
    if (lastGroup && lastGroup.speaker === entry.speaker) {
      lastGroup.entries.push(entry);
    } else {
      groups.push({ speaker: entry.speaker, entries: [entry] });
    }
  }
  
  return groups;
}
