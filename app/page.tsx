'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import Image from 'next/image';
import { TranscriptEntry, ChatMessage } from '@/types';
import { StreamingAudioCapture, StreamingAudioEvent } from '@/lib/audio-utils';
import { ThemeProvider } from '@/lib/hooks/useTheme';
import { ConnectionStatus } from '@/components/ui/ConnectionStatus';
import { ThemeToggle } from '@/components/ui/ThemeToggle';
import { TabBar } from '@/components/ui/TabBar';
import { TranscriptTimeline } from '@/components/live-session/TranscriptTimeline';
import { LiveHUD } from '@/components/live-session/LiveHUD';
import { ConversationAnalytics } from '@/components/analytics/ConversationAnalytics';
import { EnrollmentCard } from '@/components/enroll/EnrollmentCard';
import PromptEditor from '@/components/PromptEditor';
import MemoryPanel from '@/components/MemoryPanel';
import { AIChatInput } from '@/components/live-session/AIChatInput';
import { AudioFileUpload } from '@/components/live-session/AudioFileUpload';
import { UserPlus, Radio, Settings, Brain, BarChart3 } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

function HomePage() {
  const [activeTab, setActiveTab] = useState('enroll');
  const [connectionState, setConnectionState] = useState<'disconnected' | 'connecting' | 'connected'>('disconnected');
  const [isRecording, setIsRecording] = useState(false);
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
  const [partialTranscript, setPartialTranscript] = useState('');
  const [speakers, setSpeakers] = useState<Array<{ id: string; name: string; sampleCount?: number }>>([]);
  const [activeSpeaker, setActiveSpeaker] = useState<string>();
  const [showAnalytics, setShowAnalytics] = useState(false);
  const [supervisorPrompt, setSupervisorPrompt] = useState('');
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [isAIProcessing, setIsAIProcessing] = useState(false);
  
  const streamingCapture = useRef<StreamingAudioCapture | null>(null);
  const audioStreamRef = useRef<MediaStream | null>(null);

  useEffect(() => {
    fetchSpeakers();
  }, []);

  const fetchSpeakers = async () => {
    try {
      const res = await fetch('/api/speakers');
      if (res.ok) {
        const data = await res.json();
        setSpeakers(data.speakers || []);
      }
    } catch (err) {
      console.error('Failed to fetch speakers:', err);
    }
  };

  const handleStreamingEvent = useCallback((event: StreamingAudioEvent) => {
    switch (event.type) {
      case 'connected':
        setConnectionState('connected');
        break;
      case 'disconnected':
        setConnectionState('disconnected');
        break;
      case 'transcript_partial':
        setPartialTranscript(event.text);
        break;
      case 'transcript_final': {
        const entry: TranscriptEntry = {
          speaker: event.speaker,
          text: event.text,
          timestamp: event.timestamp,
          speakerInfo: event.speakerInfo,
        };
        setTranscript(prev => [...prev, entry]);
        setPartialTranscript('');
        setActiveSpeaker(event.speaker);
        break;
      }
      case 'vad':
        if (!event.isSpeaking) {
          setPartialTranscript('');
          setActiveSpeaker(undefined);
        }
        break;
      case 'error':
        console.error('Streaming error:', event.message);
        break;
    }
  }, []);

  const startSession = async () => {
    try {
      setConnectionState('connecting');
      streamingCapture.current = new StreamingAudioCapture(handleStreamingEvent);
      await streamingCapture.current.start();
      setIsRecording(true);
    } catch (err) {
      console.error('Failed to start session:', err);
      setConnectionState('disconnected');
    }
  };

  const stopSession = () => {
    if (streamingCapture.current) {
      streamingCapture.current.stop();
      streamingCapture.current = null;
    }
    setIsRecording(false);
    setConnectionState('disconnected');
    setActiveSpeaker(undefined);
    setPartialTranscript('');
  };

  const handleEnroll = async (name: string, audioBlob: Blob) => {
    const formData = new FormData();
    formData.append('audio', audioBlob, 'enrollment.webm');
    formData.append('name', name);

    const res = await fetch('/api/enroll', { method: 'POST', body: formData });
    if (!res.ok) throw new Error('Enrollment failed');
    
    await fetchSpeakers();
  };

  const handleRemoveSpeaker = async (id: string) => {
    const res = await fetch('/api/speakers', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    });
    if (!res.ok) throw new Error('Failed to remove speaker');
    await fetchSpeakers();
  };

  const handleSendMessage = async (message: string, speaker: string) => {
    setIsAIProcessing(true);
    try {
      const res = await fetch('/api/therapist-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: `[${speaker}]: ${message}`,
          chatHistory: chatMessages,
          transcript,
          systemPrompt: supervisorPrompt || undefined,
        }),
      });

      if (res.ok) {
        const data = await res.json();
        const aiMessage: ChatMessage = {
          id: `ai-${Date.now()}`,
          role: 'therapist',
          text: data.reply,
          timestamp: Date.now(),
          kind: 'message',
        };
        setChatMessages(prev => [...prev, aiMessage]);
      }
    } catch (err) {
      console.error('Failed to get AI response:', err);
    } finally {
      setIsAIProcessing(false);
    }
  };

  const handleFileUpload = async (file: File) => {
    const formData = new FormData();
    formData.append('audio', file);

    const res = await fetch('/api/transcribe', {
      method: 'POST',
      body: formData,
    });

    if (!res.ok) throw new Error('Transcription failed');

    const result = await res.json();
    if (result.transcript) {
      setTranscript(prev => [...prev, ...result.transcript]);
    }
  };

  const uniqueSpeakers = Array.from(new Set(transcript.map(t => t.speaker)));

  return (
    <div className="min-h-screen bg-base transition-colors">
      {/* App Shell */}
      <header className="sticky top-0 z-50 glass border-b border-default">
        <div className="max-w-[1920px] mx-auto px-4 sm:px-6 py-3 sm:py-4">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 sm:gap-3 min-w-0">
              <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl overflow-hidden shadow-lg shrink-0 bg-surface">
                <Image
                  src="/sanuvia.png"
                  alt="Sanuvia"
                  width={40}
                  height={40}
                  priority
                  className="w-full h-full object-cover"
                />
              </div>
              <div className="min-w-0">
                <h1 className="text-lg sm:text-xl font-semibold text-primary truncate">Sanuvia</h1>
                <p className="text-xs text-secondary truncate">Real-time Voice AI</p>
              </div>
            </div>

            <div className="flex items-center gap-2 sm:gap-3 shrink-0">
              <ConnectionStatus state={connectionState} />
              <ThemeToggle />
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-[1920px] mx-auto px-4 sm:px-6 py-6 sm:py-8">
        {/* Tab Navigation */}
        <div className="mb-8">
          <TabBar
            tabs={[
              { id: 'enroll', label: 'Enroll Speakers', icon: <UserPlus className="w-4 h-4" /> },
              { id: 'live', label: 'Live Session', icon: <Radio className="w-4 h-4" /> },
              { id: 'settings', label: 'AI Supervisor', icon: <Settings className="w-4 h-4" /> },
              { id: 'memory', label: 'Memory', icon: <Brain className="w-4 h-4" /> },
            ]}
            activeTab={activeTab}
            onTabChange={setActiveTab}
          />
        </div>

        <AnimatePresence mode="wait">
          {activeTab === 'enroll' && (
            <motion.div
              key="enroll"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.2 }}
              className="space-y-6"
            >
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {speakers.map(speaker => (
                  <EnrollmentCard
                    key={speaker.id}
                    speaker={speaker}
                    onEnroll={handleEnroll}
                    onRemove={handleRemoveSpeaker}
                  />
                ))}
                <EnrollmentCard onEnroll={handleEnroll} />
              </div>
            </motion.div>
          )}

          {activeTab === 'live' && (
            <motion.div
              key="live"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.2 }}
              className="space-y-6"
            >
              {/* Live HUD with Upload */}
              <div className="rounded-xl border border-default bg-surface p-6">
                <div className="flex flex-col lg:flex-row gap-6 items-start lg:items-center">
                  <div className="flex-1 min-w-0">
                    <LiveHUD
                      isRecording={isRecording}
                      onStart={startSession}
                      onStop={stopSession}
                      audioStream={audioStreamRef.current}
                      confidence={0.85}
                      speakers={uniqueSpeakers}
                      activeSpeaker={activeSpeaker}
                    />
                  </div>
                  <div className="w-full lg:w-auto lg:min-w-[280px]">
                    <AudioFileUpload onUpload={handleFileUpload} disabled={isRecording} />
                  </div>
                </div>
              </div>

              {/* Transcript Timeline - Full Width */}
              <div className="rounded-xl border border-default bg-surface overflow-hidden">
                <div className="h-[500px]">
                  <TranscriptTimeline
                    transcript={transcript}
                    partialTranscript={partialTranscript}
                  />
                </div>
              </div>

              {/* AI Chat Input - Full Width */}
              <div className="rounded-xl border border-default bg-surface">
                <AIChatInput
                  onSendMessage={handleSendMessage}
                  speakers={uniqueSpeakers}
                  isProcessing={isAIProcessing}
                />
              </div>

              {/* Analytics Toggle */}
              {transcript.length > 0 && (
                <div className="rounded-xl border border-default bg-surface p-6">
                  <button
                    onClick={() => setShowAnalytics(!showAnalytics)}
                    className="flex items-center gap-2 text-sm font-medium text-primary hover:text-accent transition-colors"
                  >
                    <BarChart3 className="w-4 h-4" />
                    {showAnalytics ? 'Hide' : 'Show'} Conversation Analytics
                  </button>
                  
                  {showAnalytics && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      exit={{ opacity: 0, height: 0 }}
                      className="mt-6"
                    >
                      <ConversationAnalytics transcript={transcript} />
                    </motion.div>
                  )}
                </div>
              )}
            </motion.div>
          )}

          {activeTab === 'settings' && (
            <motion.div
              key="settings"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.2 }}
            >
              <div className="rounded-xl border border-default bg-surface p-8">
                <PromptEditor onPromptChange={setSupervisorPrompt} />
              </div>
            </motion.div>
          )}

          {activeTab === 'memory' && (
            <motion.div
              key="memory"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.2 }}
            >
              <div className="rounded-xl border border-default bg-surface p-8">
                <MemoryPanel />
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </main>
    </div>
  );
}

export default function Home() {
  return (
    <ThemeProvider>
      <HomePage />
    </ThemeProvider>
  );
}
