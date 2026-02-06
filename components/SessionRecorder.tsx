'use client';

import { useState, useRef, useCallback } from 'react';
import { TranscriptEntry } from '@/types';
import { AudioRecorder } from '@/lib/audio-utils';

interface SessionRecorderProps {
  onTranscriptUpdate: (entry: TranscriptEntry) => void;
  onSessionComplete: (transcript: TranscriptEntry[]) => void;
}

export default function SessionRecorder({
  onTranscriptUpdate,
  onSessionComplete,
}: SessionRecorderProps) {
  const [isRecording, setIsRecording] = useState(false);
  const [isInitialized, setIsInitialized] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);

  const audioRecorder = useRef<AudioRecorder | null>(null);
  const transcript = useRef<TranscriptEntry[]>([]);
  const sessionStartTime = useRef<number>(0);
  const audioChunksRef = useRef<Blob[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const initialize = async () => {
    try {
      setError(null);
      audioRecorder.current = new AudioRecorder();
      await audioRecorder.current.initialize();
      setIsInitialized(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to initialize microphone');
    }
  };

  const startRecording = async () => {
    if (!isInitialized) {
      await initialize();
    }

    try {
      setError(null);
      transcript.current = [];
      sessionStartTime.current = Date.now();
      audioChunksRef.current = [];

      audioRecorder.current?.start();
      setIsRecording(true);

      // Start real-time transcription processing
      startTranscriptionStream();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start recording');
    }
  };

  const startTranscriptionStream = useCallback(async () => {
    // Send audio chunks to the server for real-time transcription
    const processChunk = async () => {
      if (!isRecording || !audioRecorder.current) return;

      try {
        const stream = audioRecorder.current.getAudioStream();
        if (!stream) return;

        // Create a WebSocket or use fetch to stream audio to server
        // For now, we'll use periodic polling approach
        // In production, use WebSocket for true real-time streaming

        setTimeout(processChunk, 1000); // Process every second
      } catch (err) {
        console.error('Transcription error:', err);
      }
    };

    processChunk();
  }, [isRecording]);

  const stopRecording = async () => {
    try {
      setError(null);
      const audioBlob = await audioRecorder.current!.stop();
      setIsRecording(false);

      // Send final audio to server for processing
      await processAudioSession(audioBlob);

      // Notify parent component
      onSessionComplete(transcript.current);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to stop recording');
    }
  };

  const processAudioSession = async (audioBlob: Blob) => {
    try {
      setIsProcessing(true);
      const formData = new FormData();
      formData.append('audio', audioBlob, 'session.webm');

      const response = await fetch('/api/transcribe', {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        throw new Error('Transcription failed');
      }

      const result = await response.json();

      // Update transcript with identified speakers
      if (result.transcript) {
        result.transcript.forEach((entry: TranscriptEntry) => {
          transcript.current.push(entry);
          onTranscriptUpdate(entry);
        });
      }
    } catch (err) {
      console.error('Failed to process audio:', err);
      throw err;
    } finally {
      setIsProcessing(false);
    }
  };

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      setError(null);
      transcript.current = [];
      sessionStartTime.current = Date.now();

      console.log('Processing uploaded file:', file.name, file.type, file.size);

      await processAudioSession(file);
      onSessionComplete(transcript.current);

      // Reset file input
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to process file');
    }
  };

  return (
    <div className="flex flex-col items-center gap-4">
      {error && (
        <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded">
          {error}
        </div>
      )}

      <div className="flex gap-4">
        <button
          onClick={startRecording}
          disabled={isRecording || isProcessing}
          className={`px-8 py-4 rounded-lg font-semibold text-white transition-all ${
            isRecording || isProcessing
              ? 'bg-gray-400 cursor-not-allowed'
              : 'bg-green-500 hover:bg-green-600 active:scale-95'
          }`}
        >
          {isRecording ? 'Recording...' : 'Start Session'}
        </button>

        <button
          onClick={stopRecording}
          disabled={!isRecording || isProcessing}
          className={`px-8 py-4 rounded-lg font-semibold text-white transition-all ${
            !isRecording || isProcessing
              ? 'bg-gray-400 cursor-not-allowed'
              : 'bg-red-500 hover:bg-red-600 active:scale-95'
          }`}
        >
          Stop Session
        </button>

        {/* File Upload Button for Testing */}
        <div className="relative">
          <input
            ref={fileInputRef}
            type="file"
            accept=".wav,.webm,audio/*"
            onChange={handleFileUpload}
            disabled={isRecording || isProcessing}
            className="absolute inset-0 w-full h-full opacity-0 cursor-pointer disabled:cursor-not-allowed"
          />
          <button
            disabled={isRecording || isProcessing}
            className={`px-8 py-4 rounded-lg font-semibold text-white transition-all ${
              isRecording || isProcessing
                ? 'bg-gray-400 cursor-not-allowed'
                : 'bg-blue-500 hover:bg-blue-600 active:scale-95'
            }`}
          >
            {isProcessing ? 'Processing...' : 'Upload Test File'}
          </button>
        </div>
      </div>

      {isRecording && (
        <div className="flex items-center gap-2 text-red-500">
          <div className="w-3 h-3 bg-red-500 rounded-full animate-pulse"></div>
          <span className="font-medium">Live Recording</span>
        </div>
      )}

      {isProcessing && (
        <div className="flex items-center gap-2 text-blue-500">
          <div className="w-3 h-3 bg-blue-500 rounded-full animate-pulse"></div>
          <span className="font-medium">Processing audio...</span>
        </div>
      )}

      <div className="text-sm text-gray-500 text-center max-w-md">
        <p>Use "Start Session" to record live, or "Upload Test File" to test with a pre-recorded WAV/WebM file.</p>
      </div>
    </div>
  );
}
