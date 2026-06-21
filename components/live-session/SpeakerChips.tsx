'use client';

import { motion } from 'framer-motion';
import { getSpeakerColor } from '@/lib/utils/speaker-colors';

interface SpeakerChipsProps {
  speakers: string[];
  activeSpeaker?: string;
}

export function SpeakerChips({ speakers, activeSpeaker }: SpeakerChipsProps) {
  if (speakers.length === 0) return null;

  return (
    <div className="flex items-center gap-2">
      <span className="text-xs font-medium text-secondary">Speakers</span>
      <div className="flex gap-2">
        {speakers.map(speaker => {
          const colors = getSpeakerColor(speaker);
          const isActive = speaker === activeSpeaker;

          return (
            <div
              key={speaker}
              className={`relative flex items-center gap-1.5 px-3 py-1.5 rounded-full border ${colors.bg} ${colors.text} ${colors.border}`}
            >
              <motion.div
                className={`w-2 h-2 rounded-full ${colors.dot}`}
                animate={isActive ? { scale: [1, 1.3, 1] } : {}}
                transition={{ duration: 0.8, repeat: Infinity }}
              />
              <span className="text-xs font-medium">{speaker}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
