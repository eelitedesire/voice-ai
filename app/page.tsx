'use client';

import { useState, useCallback, useEffect } from 'react';
import { TranscriptEntry, TherapeuticAnalysis, ChatMessage } from '@/types';
import SessionRecorder from '@/components/SessionRecorder';
import LiveTranscriptChat from '@/components/LiveTranscriptChat';
import AnalysisPanel from '@/components/AnalysisPanel';
import SpeakerEnrollment from '@/components/SpeakerEnrollment';
import PromptEditor from '@/components/PromptEditor';

export default function Home() {
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [showAnalysis, setShowAnalysis] = useState(false);
  const [supervisorPrompt, setSupervisorPrompt] = useState('');
  const [isTherapistTyping, setIsTherapistTyping] = useState(false);
  const [speakers, setSpeakers] = useState<string[]>([]);

  // Fetch enrolled speakers on mount
  useEffect(() => {
    fetchSpeakers();
  }, []);

  const fetchSpeakers = async () => {
    try {
      const res = await fetch('/api/speakers');
      if (res.ok) {
        const data = await res.json();
        const names: string[] = data.speakers?.map((s: { name: string }) => s.name) ?? [];
        // Always ensure at least default options
        const allNames = new Set([...names]);
        if (allNames.size === 0) {
          allNames.add('Partner 1');
          allNames.add('Partner 2');
        }
        setSpeakers(Array.from(allNames));
      }
    } catch {
      // Fallback default speakers
      setSpeakers(['Partner 1', 'Partner 2']);
    }
  };

  const handleTranscriptUpdate = (entry: TranscriptEntry) => {
    setTranscript(prev => [...prev, entry]);
    // Add new speaker to the dropdown if not already present
    setSpeakers(prev => {
      if (!prev.includes(entry.speaker)) {
        return [...prev, entry.speaker];
      }
      return prev;
    });
  };

  const handleSessionComplete = (finalTranscript: TranscriptEntry[]) => {
    setTranscript(finalTranscript);
    setShowAnalysis(true);

    // Add speakers from transcript
    const newSpeakers = new Set(speakers);
    for (const entry of finalTranscript) {
      newSpeakers.add(entry.speaker);
    }
    setSpeakers(Array.from(newSpeakers));
  };

  const handleAnalysisComplete = (analysis: TherapeuticAnalysis) => {
    // Post the analysis summary as a therapist message in the chat
    const summaryParts: string[] = [];

    if (analysis.summary) {
      summaryParts.push(analysis.summary);
    }
    if (analysis.keyBreakthroughs && analysis.keyBreakthroughs.length > 0) {
      summaryParts.push(`\nKey observations:\n${analysis.keyBreakthroughs.map(b => `  - ${b}`).join('\n')}`);
    }
    if (analysis.homework) {
      summaryParts.push(`\nSuggested exercise: ${analysis.homework}`);
    }
    if (analysis.concerns && analysis.concerns.length > 0) {
      summaryParts.push(`\nImportant to address:\n${analysis.concerns.map(c => `  - ${c}`).join('\n')}`);
    }

    const analysisMessage: ChatMessage = {
      id: `analysis-${Date.now()}`,
      role: 'therapist',
      text: summaryParts.join('\n'),
      timestamp: Date.now(),
      kind: 'analysis-summary',
    };

    setChatMessages(prev => [...prev, analysisMessage]);
  };

  const handleSendMessage = useCallback(async (message: ChatMessage) => {
    // Add the speaker's message to chat
    setChatMessages(prev => [...prev, message]);

    // Send to therapist LLM for a response
    setIsTherapistTyping(true);
    try {
      const res = await fetch('/api/therapist-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: `[${message.speaker}]: ${message.text}`,
          chatHistory: chatMessages,
          transcript,
          systemPrompt: supervisorPrompt || undefined,
        }),
      });

      if (res.ok) {
        const data = await res.json();
        const therapistMessage: ChatMessage = {
          id: `therapist-${Date.now()}`,
          role: 'therapist',
          text: data.reply,
          timestamp: Date.now(),
          kind: 'message',
        };
        setChatMessages(prev => [...prev, therapistMessage]);
      }
    } catch (err) {
      console.error('Failed to get therapist response:', err);
      const errorMessage: ChatMessage = {
        id: `error-${Date.now()}`,
        role: 'therapist',
        text: 'I apologize, I was unable to respond at this time. Please try again.',
        timestamp: Date.now(),
        kind: 'message',
      };
      setChatMessages(prev => [...prev, errorMessage]);
    } finally {
      setIsTherapistTyping(false);
    }
  }, [chatMessages, transcript, supervisorPrompt]);

  const resetSession = () => {
    setTranscript([]);
    setChatMessages([]);
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
            {(transcript.length > 0 || chatMessages.length > 0) && (
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

        {/* Live Transcript Chat */}
        <div className="bg-white rounded-xl shadow-lg p-6 mb-8">
          <h2 className="text-2xl font-semibold mb-4">Live Transcript</h2>
          <LiveTranscriptChat
            transcript={transcript}
            chatMessages={chatMessages}
            onSendMessage={handleSendMessage}
            speakers={speakers}
            isTherapistTyping={isTherapistTyping}
          />
        </div>

        {/* Supervisor Prompt Configuration */}
        <div className="bg-white rounded-xl shadow-lg p-6 mb-8">
          <PromptEditor onPromptChange={setSupervisorPrompt} />
        </div>

        {/* Analysis Panel */}
        {showAnalysis && (
          <div className="bg-white rounded-xl shadow-lg p-6 mb-8">
            <AnalysisPanel
              transcript={transcript}
              systemPrompt={supervisorPrompt}
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
