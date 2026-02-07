'use client';

import { useState } from 'react';
import { TranscriptEntry, TherapeuticAnalysis } from '@/types';
import SessionRecorder from '@/components/SessionRecorder';
import TranscriptDisplay from '@/components/TranscriptDisplay';
import AnalysisPanel from '@/components/AnalysisPanel';
import SpeakerEnrollment from '@/components/SpeakerEnrollment';

export default function Home() {
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
  const [showAnalysis, setShowAnalysis] = useState(false);

  const handleTranscriptUpdate = (entry: TranscriptEntry) => {
    setTranscript(prev => [...prev, entry]);
  };

  const handleSessionComplete = (finalTranscript: TranscriptEntry[]) => {
    setTranscript(finalTranscript);
    setShowAnalysis(true);
  };

  const handleAnalysisComplete = (analysis: TherapeuticAnalysis) => {
    console.log('Analysis complete:', analysis);
  };

  const resetSession = () => {
    setTranscript([]);
    setShowAnalysis(false);
  };

  return (
    <main className="min-h-screen bg-gradient-to-br from-blue-50 to-purple-50 p-8">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold text-gray-900 mb-2">
            AI Co-Therapist Platform
          </h1>
          <p className="text-gray-600">
            Voice-enabled therapeutic session assistant with real-time transcription
          </p>
        </div>

        {/* Session Controls */}
        <div className="bg-white rounded-xl shadow-lg p-6 mb-8">
          <div className="flex justify-between items-center mb-6">
            <h2 className="text-2xl font-semibold">Session Control</h2>
            {transcript.length > 0 && (
              <button
                onClick={resetSession}
                className="px-4 py-2 text-sm bg-gray-200 hover:bg-gray-300 rounded-lg transition"
              >
                New Session
              </button>
            )}
          </div>

          <SessionRecorder
            onTranscriptUpdate={handleTranscriptUpdate}
            onSessionComplete={handleSessionComplete}
          />
        </div>

        {/* Live Transcript */}
        <div className="bg-white rounded-xl shadow-lg p-6 mb-8">
          <h2 className="text-2xl font-semibold mb-4">Live Transcript</h2>
          <TranscriptDisplay transcript={transcript} />
        </div>

        {/* Analysis Panel */}
        {showAnalysis && (
          <div className="bg-white rounded-xl shadow-lg p-6 mb-8">
            <AnalysisPanel
              transcript={transcript}
              onAnalysisComplete={handleAnalysisComplete}
            />
          </div>
        )}

        {/* Speaker Enrollment */}
        <div className="bg-white rounded-xl shadow-lg p-6 mb-8">
          <h2 className="text-2xl font-semibold mb-4">Enroll Speakers</h2>
          <SpeakerEnrollment />
        </div>
      </div>
    </main>
  );
}
