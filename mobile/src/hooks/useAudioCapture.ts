/**
 * useAudioCapture — Hook for managing microphone audio capture.
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import { audioCapture, AudioLevelEvent } from '../native/AudioCapture';
import { AUDIO_CONFIG } from '../config/api';
import { AudioLevel } from '../types';

interface UseAudioCaptureReturn {
  isRecording: boolean;
  hasPermission: boolean | null;
  audioLevel: AudioLevel;
  requestPermission: () => Promise<boolean>;
  startRecording: () => Promise<void>;
  stopRecording: () => Promise<void>;
}

export function useAudioCapture(): UseAudioCaptureReturn {
  const [isRecording, setIsRecording] = useState(false);
  const [hasPermission, setHasPermission] = useState<boolean | null>(null);
  const [audioLevel, setAudioLevel] = useState<AudioLevel>({
    rms: 0,
    peak: 0,
    isSpeaking: false,
  });

  const levelUnsubRef = useRef<(() => void) | null>(null);

  const requestPermission = useCallback(async () => {
    const granted = await audioCapture.requestPermission();
    setHasPermission(granted);
    return granted;
  }, []);

  const startRecording = useCallback(async () => {
    if (isRecording) return;

    levelUnsubRef.current = audioCapture.onAudioLevel(
      (event: AudioLevelEvent) => {
        setAudioLevel(prev => ({
          ...prev,
          rms: event.rms,
          peak: event.peak,
        }));
      },
    );

    await audioCapture.start({
      sampleRate: AUDIO_CONFIG.sampleRate,
      channels: AUDIO_CONFIG.channels,
      bufferSize: AUDIO_CONFIG.bufferSize,
    });

    setIsRecording(true);
  }, [isRecording]);

  const stopRecording = useCallback(async () => {
    if (!isRecording) return;

    await audioCapture.stop();
    levelUnsubRef.current?.();
    levelUnsubRef.current = null;
    setIsRecording(false);
    setAudioLevel({ rms: 0, peak: 0, isSpeaking: false });
  }, [isRecording]);

  useEffect(() => {
    return () => {
      levelUnsubRef.current?.();
    };
  }, []);

  return {
    isRecording,
    hasPermission,
    audioLevel,
    requestPermission,
    startRecording,
    stopRecording,
  };
}
