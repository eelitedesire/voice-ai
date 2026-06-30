/**
 * useTranscription — Manages the transcription pipeline.
 *
 * Supports three modes:
 *   'on-device' — All processing local (VAD + ASR + Speaker ID)
 *   'server'    — Stream audio to server over WebSocket
 *   'hybrid'    — On-device VAD + ASR, server for analysis/RAG
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import { OnDeviceASR } from '../services/OnDeviceASR';
import { StreamingService, ConnectionStatus } from '../services/StreamingService';
import {
  ProcessingMode,
  TranscriptEntry,
  OnDeviceTranscriptionResult,
  StreamingServerMessage,
} from '../types';
import { getSettings, getSpeakerProfiles } from '../services/StorageService';

interface UseTranscriptionReturn {
  isActive: boolean;
  transcript: TranscriptEntry[];
  partialText: string;
  isSpeaking: boolean;
  connectionStatus: ConnectionStatus;
  processingMode: ProcessingMode;
  audioLevel: { rms: number; peak: number };
  start: () => Promise<void>;
  stop: () => Promise<TranscriptEntry[]>;
  clearTranscript: () => void;
}

export function useTranscription(documentDir: string): UseTranscriptionReturn {
  const [isActive, setIsActive] = useState(false);
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
  const [partialText, setPartialText] = useState('');
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [audioLevel, setAudioLevel] = useState({ rms: 0, peak: 0 });
  const [connectionStatus, setConnectionStatus] =
    useState<ConnectionStatus>('disconnected');

  const settings = getSettings();
  const [processingMode] = useState<ProcessingMode>(settings.processingMode);

  const onDeviceRef = useRef<OnDeviceASR | null>(null);
  const streamingRef = useRef<StreamingService | null>(null);
  const cleanupCallbacksRef = useRef<(() => void)[]>([]);

  // Initialize services
  useEffect(() => {
    const init = async () => {
      if (processingMode === 'on-device' || processingMode === 'hybrid') {
        const asr = new OnDeviceASR();
        try {
          await asr.initialize(documentDir);
          // Load enrolled speakers so the ASR can identify who is speaking.
          const profiles = getSpeakerProfiles();
          asr.setSpeakerReferences(
            profiles.map(p => ({ name: p.name, embedding: p.voiceprint })),
          );
          onDeviceRef.current = asr;
        } catch (err) {
          console.warn('On-device ASR init failed, falling back to server:', err);
        }
      }

      if (processingMode === 'server') {
        const streaming = new StreamingService(settings.serverUrl);
        streaming.onStatusChange(setConnectionStatus);
        streamingRef.current = streaming;
        // Connect immediately to check server availability
        streaming.connect().catch((err) => {
          console.warn('Initial server connection failed:', err);
        });
      }

      // In hybrid mode, set connection status based on whether on-device ASR is ready
      if (processingMode === 'hybrid') {
        setConnectionStatus(onDeviceRef.current ? 'connected' : 'disconnected');
      }
    };

    init();

    return () => {
      onDeviceRef.current?.release();
      streamingRef.current?.disconnect();
    };
  }, [documentDir, processingMode, settings.serverUrl]);

  const start = useCallback(async () => {
    if (isActive) return;

    const useOnDevice =
      (processingMode === 'on-device' || processingMode === 'hybrid') &&
      onDeviceRef.current;

    if (useOnDevice) {
      const unsubTranscription = onDeviceRef.current!.onTranscription(
        (result: OnDeviceTranscriptionResult) => {
          if (result.isFinal) {
            setTranscript(prev => [
              ...prev,
              {
                speaker: result.speaker || '',
                text: result.text,
                timestamp: result.timestamp,
              },
            ]);
            setPartialText('');
          } else {
            setPartialText(result.text);
          }
        },
      );

      const unsubVAD = onDeviceRef.current!.onVADChange(setIsSpeaking);
      const unsubAudioLevel = typeof onDeviceRef.current!.onAudioLevel === 'function'
        ? onDeviceRef.current!.onAudioLevel((rms, peak) => {
            setAudioLevel({ rms, peak });
          })
        : () => {};

      // Store cleanup functions
      cleanupCallbacksRef.current = [unsubTranscription, unsubVAD, unsubAudioLevel];

      await onDeviceRef.current!.start();
    } else if (streamingRef.current) {
      streamingRef.current.onMessage((msg: StreamingServerMessage) => {
        switch (msg.type) {
          case 'partial':
            setPartialText(msg.text);
            break;
          case 'final':
            setTranscript(prev => [
              ...prev,
              { speaker: msg.speaker, text: msg.text, timestamp: msg.timestamp },
            ]);
            setPartialText('');
            break;
          case 'vad':
            setIsSpeaking(msg.isSpeaking);
            break;
        }
      });

      await streamingRef.current.startStreaming();
    }

    setIsActive(true);
  }, [isActive, processingMode]);

  const stop = useCallback(async (): Promise<TranscriptEntry[]> => {
    if (!isActive) return transcript;

    // Clean up callbacks first
    cleanupCallbacksRef.current.forEach(cleanup => cleanup());
    cleanupCallbacksRef.current = [];

    let result: TranscriptEntry[];

    if (onDeviceRef.current) {
      result = await onDeviceRef.current.stop();
    } else if (streamingRef.current) {
      result = await streamingRef.current.stopStreaming();
    } else {
      result = transcript;
    }

    setIsActive(false);
    setIsSpeaking(false);
    setPartialText('');
    setAudioLevel({ rms: 0, peak: 0 });

    return result;
  }, [isActive, transcript]);

  const clearTranscript = useCallback(() => {
    setTranscript([]);
    setPartialText('');
    onDeviceRef.current?.clearTranscript();
    streamingRef.current?.clearTranscript();
  }, []);

  return {
    isActive,
    transcript,
    partialText,
    isSpeaking,
    connectionStatus,
    processingMode,
    audioLevel,
    start,
    stop,
    clearTranscript,
  };
}
