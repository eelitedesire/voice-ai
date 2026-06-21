'use client';

import { motion } from 'framer-motion';
import { TranscriptEntry } from '@/types';
import { getSpeakerColor } from '@/lib/utils/speaker-colors';

interface SpeakerBubbleGroupProps {
  speaker: string;
  entries: TranscriptEntry[];
}

export function SpeakerBubbleGroup({ speaker, entries }: SpeakerBubbleGroupProps) {
  const colors = getSpeakerColor(speaker);
  const firstEntry = entries[0];

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      className="flex items-start gap-3 px-4"
    >
      {/* Avatar */}
      <div className={`flex-shrink-0 w-8 h-8 rounded-full ${colors.dot} flex items-center justify-center`}>
        <span className="text-xs font-semibold text-white">
          {speaker.charAt(0).toUpperCase()}
        </span>
      </div>

      {/* Messages */}
      <div className="flex-1 max-w-[85%]">
        {/* Header */}
        <div className="flex items-center gap-2 mb-2">
          <span className="text-sm font-semibold text-primary">{speaker}</span>
          <span className="text-xs text-tertiary">
            {new Date(firstEntry.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </span>
          {firstEntry.speakerInfo && (
            <span
              className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                firstEntry.speakerInfo.decision === 'known'
                  ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                  : 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400'
              }`}
              title={firstEntry.speakerInfo.reason}
            >
              {Math.round(firstEntry.speakerInfo.score * 100)}%
            </span>
          )}
        </div>

        {/* Bubbles */}
        <div className="space-y-2">
          {entries.map((entry, idx) => (
            <div
              key={`${entry.timestamp}-${idx}`}
              className={`px-4 py-3 rounded-2xl border ${colors.bg} ${colors.text} ${colors.border}`}
            >
              <p className="text-sm leading-relaxed">{entry.text}</p>
            </div>
          ))}
        </div>
      </div>
    </motion.div>
  );
}
