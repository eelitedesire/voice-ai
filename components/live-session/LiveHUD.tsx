'use client';

import { VuMeter } from './VuMeter';
import { AccuracyBar } from './AccuracyBar';
import { SpeakerChips } from './SpeakerChips';
import { RecordControl } from './RecordControl';

interface LiveHUDProps {
  isRecording: boolean;
  onStart: () => void;
  onStop: () => void;
  audioStream: MediaStream | null;
  confidence: number;
  speakers: string[];
  activeSpeaker?: string;
  disabled?: boolean;
}

export function LiveHUD({
  isRecording,
  onStart,
  onStop,
  audioStream,
  confidence,
  speakers,
  activeSpeaker,
  disabled,
}: LiveHUDProps) {
  return (
    <div className="flex flex-col gap-6">
      {/* Primary Control */}
      <div className="flex justify-center">
        <RecordControl
          isRecording={isRecording}
          onStart={onStart}
          onStop={onStop}
          disabled={disabled}
        />
      </div>

      {/* Metrics Row */}
      {isRecording && (
        <div className="flex flex-wrap items-center justify-center gap-6 px-6 py-4 rounded-xl bg-surface border border-default">
          <VuMeter audioStream={audioStream} />
          <div className="w-px h-8 bg-border-default" />
          <AccuracyBar confidence={confidence} />
          {speakers.length > 0 && (
            <>
              <div className="w-px h-8 bg-border-default" />
              <SpeakerChips speakers={speakers} activeSpeaker={activeSpeaker} />
            </>
          )}
        </div>
      )}
    </div>
  );
}
