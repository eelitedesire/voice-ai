'use client';

import { useState, useRef, useCallback } from 'react';
import { TranscriptEntry } from '@/types';
import { AudioRecorder, StreamingAudioCapture, StreamingAudioEvent } from '@/lib/audio-utils';

interface SessionRecorderProps {
  onTranscriptUpdate: (entry: TranscriptEntry) => void;
  onSessionComplete: (transcript: TranscriptEntry[]) => void;
  onPartialTranscript?: (text: string) => void;
  onVadStatus?: (isSpeaking: boolean) => void;
}

export default function SessionRecorder({
  onTranscriptUpdate,
  onSessionComplete,
  onPartialTranscript,
  onVadStatus,
}: SessionRecorderProps) {
  const [isRecording, setIsRecording] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);

  const streamingCapture = useRef<StreamingAudioCapture | null>(null);
  const transcript = useRef<TranscriptEntry[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleStreamingEvent = useCallback((event: StreamingAudioEvent) => {
    switch (event.type) {
      case 'connected':
        setIsConnected(true);
        break;

      case 'disconnected':
        setIsConnected(false);
        break;

      case 'transcript_partial':
        onPartialTranscript?.(event.text);
        break;

      case 'transcript_final': {
        const entry: TranscriptEntry = {
          speaker: event.speaker,
          text: event.text,
          timestamp: event.timestamp,
        };
        transcript.current.push(entry);
        onTranscriptUpdate(entry);
        // Clear partial when final arrives
        onPartialTranscript?.('');
        break;
      }

      case 'vad':
        setIsSpeaking(event.isSpeaking);
        // Clear the partial transcript when speech ends so "transcribing..." dismisses
        // immediately even before the final transcript_final event arrives.
        if (!event.isSpeaking) {
          onPartialTranscript?.('');
        }
        onVadStatus?.(event.isSpeaking);
        break;

      case 'error':
        setError(event.message);
        break;
    }
  }, [onTranscriptUpdate, onPartialTranscript, onVadStatus]);

  const startStreamingRecording = async () => {
    try {
      setError(null);
      transcript.current = [];

      streamingCapture.current = new StreamingAudioCapture(handleStreamingEvent);
      await streamingCapture.current.start();

      setIsRecording(true);
      setIsStreaming(true);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to start streaming';
      // Fall back to batch mode if WebSocket fails
      if (msg.includes('WebSocket')) {
        console.warn('Streaming unavailable, falling back to batch mode');
        await startBatchRecording();
      } else {
        setError(msg);
      }
    }
  };

  // Batch recording fallback (original implementation)
  const audioRecorder = useRef<AudioRecorder | null>(null);
  const [isInitialized, setIsInitialized] = useState(false);

  const initializeBatch = async () => {
    audioRecorder.current = new AudioRecorder();
    await audioRecorder.current.initialize();
    setIsInitialized(true);
  };

  const startBatchRecording = async () => {
    try {
      setError(null);
      transcript.current = [];

      if (!isInitialized) {
        await initializeBatch();
      }

      audioRecorder.current?.start();
      setIsRecording(true);
      setIsStreaming(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start recording');
    }
  };

  const startRecording = async () => {
    // Try streaming first, fall back to batch
    await startStreamingRecording();
  };

  const stopRecording = async () => {
    try {
      setError(null);

      if (isStreaming && streamingCapture.current) {
        // Streaming mode: stop capture, server will finalize
        streamingCapture.current.stop();
        streamingCapture.current = null;
        setIsRecording(false);
        setIsStreaming(false);
        setIsConnected(false);
        setIsSpeaking(false);
        onPartialTranscript?.('');

        onSessionComplete(transcript.current);
      } else if (audioRecorder.current) {
        // Batch mode: stop recording, send to server
        const audioBlob = await audioRecorder.current.stop();
        setIsRecording(false);

        await processAudioSession(audioBlob);
        onSessionComplete(transcript.current);
      }
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

      console.log('Processing uploaded file:', file.name, file.type, file.size);

      await processAudioSession(file);
      onSessionComplete(transcript.current);

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
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 text-red-500">
            <div className="w-3 h-3 bg-red-500 rounded-full animate-pulse"></div>
            <span className="font-medium">Live Recording</span>
          </div>

          {isStreaming && (
            <div className="flex items-center gap-2">
              <div className={`w-2 h-2 rounded-full ${isConnected ? 'bg-green-400' : 'bg-yellow-400 animate-pulse'}`}></div>
              <span className="text-sm text-gray-500">
                {isConnected ? 'Streaming' : 'Connecting...'}
              </span>
            </div>
          )}

          {isStreaming && isSpeaking && (
            <div className="flex items-center gap-1">
              {[1, 2, 3].map(i => (
                <div
                  key={i}
                  className="w-1 bg-green-500 rounded-full animate-pulse"
                  style={{
                    height: `${8 + i * 4}px`,
                    animationDelay: `${i * 100}ms`,
                  }}
                />
              ))}
              <span className="text-sm text-green-600 ml-1">Speaking</span>
            </div>
          )}

          {isStreaming && !isConnected && (
            <span className="text-xs text-gray-400">(batch fallback)</span>
          )}
        </div>
      )}

      {isProcessing && (
        <div className="flex items-center gap-2 text-blue-500">
          <div className="w-3 h-3 bg-blue-500 rounded-full animate-pulse"></div>
          <span className="font-medium">Processing audio...</span>
        </div>
      )}

      <div className="text-sm text-gray-500 text-center max-w-md">
        <p>Use "Start Session" to record live with streaming transcription, or "Upload Test File" to test with a pre-recorded WAV/WebM file.</p>
      </div>
    </div>
  );
}
