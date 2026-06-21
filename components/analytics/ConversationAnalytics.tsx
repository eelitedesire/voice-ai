'use client';

import { TranscriptEntry } from '@/types';
import { getSpeakerColor } from '@/lib/utils/speaker-colors';
import { BarChart3 } from 'lucide-react';

interface ConversationAnalyticsProps {
  transcript: TranscriptEntry[];
}

export function ConversationAnalytics({ transcript }: ConversationAnalyticsProps) {
  if (transcript.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <BarChart3 className="w-12 h-12 text-gray-400 mb-3" />
        <p className="text-sm text-secondary">No data yet</p>
      </div>
    );
  }

  const stats = calculateStats(transcript);

  return (
    <div className="space-y-6">
      {/* Talk Time */}
      <div>
        <h4 className="text-sm font-semibold text-primary mb-3">Talk Time Distribution</h4>
        <div className="space-y-2">
          {stats.talkTime.map(({ speaker, percentage, wordCount }) => {
            const colors = getSpeakerColor(speaker);
            return (
              <div key={speaker} className="space-y-1">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-medium text-primary">{speaker}</span>
                  <span className="text-secondary">{percentage}% · {wordCount} words</span>
                </div>
                <div className="h-2 bg-gray-200 dark:bg-gray-800 rounded-full overflow-hidden">
                  <div
                    className={`h-full ${colors.dot}`}
                    style={{ width: `${percentage}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Turn Taking */}
      <div>
        <h4 className="text-sm font-semibold text-primary mb-3">Turn Taking</h4>
        <div className="flex items-center gap-px h-8 rounded-lg overflow-hidden">
          {stats.turns.map((turn, idx) => {
            const colors = getSpeakerColor(turn.speaker);
            return (
              <div
                key={idx}
                className={`${colors.dot} transition-all hover:opacity-80`}
                style={{ width: `${turn.percentage}%` }}
                title={`${turn.speaker}: ${turn.count} turns`}
              />
            );
          })}
        </div>
        <div className="flex items-center justify-between mt-2 text-xs text-secondary">
          <span>{stats.turns.length} turns</span>
          <span>{Math.round(stats.avgTurnLength)} words/turn</span>
        </div>
      </div>
    </div>
  );
}

function calculateStats(transcript: TranscriptEntry[]) {
  const speakerWords = new Map<string, number>();
  const turns: Array<{ speaker: string; count: number; percentage: number }> = [];
  
  let currentSpeaker = '';
  let currentTurnCount = 0;
  
  for (const entry of transcript) {
    const wordCount = entry.text.split(/\s+/).length;
    speakerWords.set(entry.speaker, (speakerWords.get(entry.speaker) || 0) + wordCount);
    
    if (entry.speaker !== currentSpeaker) {
      if (currentSpeaker) {
        turns.push({ speaker: currentSpeaker, count: currentTurnCount, percentage: 0 });
      }
      currentSpeaker = entry.speaker;
      currentTurnCount = 1;
    }
  }
  
  if (currentSpeaker) {
    turns.push({ speaker: currentSpeaker, count: currentTurnCount, percentage: 0 });
  }
  
  const totalWords = Array.from(speakerWords.values()).reduce((a, b) => a + b, 0);
  const totalTurns = turns.reduce((a, b) => a + b.count, 0);
  
  turns.forEach(turn => {
    turn.percentage = (turn.count / totalTurns) * 100;
  });
  
  const talkTime = Array.from(speakerWords.entries())
    .map(([speaker, wordCount]) => ({
      speaker,
      wordCount,
      percentage: Math.round((wordCount / totalWords) * 100),
    }))
    .sort((a, b) => b.wordCount - a.wordCount);
  
  return {
    talkTime,
    turns,
    avgTurnLength: totalWords / totalTurns,
  };
}
