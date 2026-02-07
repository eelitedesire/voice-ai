'use client';

import { useState, useEffect, useRef, useCallback } from 'react';

const ENROLLMENT_TEXT =
  'The rainbow is a division of white light into many beautiful colors. ' +
  'These take the shape of a long round arch, with its path high above, ' +
  'and its two ends apparently beyond the horizon. There is, according to legend, ' +
  'a boiling pot of gold at one end. People look, but no one ever finds it. ' +
  'When a man looks for something beyond his reach, his friends say he is looking ' +
  'for the pot of gold at the end of the rainbow.';

interface Speaker {
  id: string;
  name: string;
}

interface SpeakerEnrollmentProps {
  onSpeakersChanged?: () => void;
}

export default function SpeakerEnrollment({ onSpeakersChanged }: SpeakerEnrollmentProps) {
  const [speakers, setSpeakers] = useState<Speaker[]>([]);
  const [name, setName] = useState('');
  const [isRecording, setIsRecording] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [recordingTime, setRecordingTime] = useState(0);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  const fetchSpeakers = useCallback(async () => {
    try {
      const res = await fetch('/api/speakers');
      const data = await res.json();
      setSpeakers(data.speakers || []);
    } catch {
      // silently fail - speakers list is non-critical
    }
  }, []);

  useEffect(() => {
    fetchSpeakers();
  }, [fetchSpeakers]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
      }
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
    };
  }, []);

  const startRecording = async () => {
    if (!name.trim()) {
      setError('Please enter the speaker name first.');
      return;
    }

    try {
      setError(null);
      setSuccess(null);
      audioChunksRef.current = [];

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, sampleRate: 16000 },
      });
      streamRef.current = stream;

      const mediaRecorder = new MediaRecorder(stream, {
        mimeType: 'audio/webm;codecs=opus',
      });

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorderRef.current = mediaRecorder;
      mediaRecorder.start(100);
      setIsRecording(true);
      setRecordingTime(0);

      timerRef.current = setInterval(() => {
        setRecordingTime(prev => prev + 1);
      }, 1000);
    } catch (err) {
      setError('Microphone access denied. Please allow microphone access.');
      console.error('Failed to start recording:', err);
    }
  };

  const stopRecording = async () => {
    if (!mediaRecorderRef.current) return;

    return new Promise<void>((resolve) => {
      mediaRecorderRef.current!.onstop = async () => {
        // Stop timer
        if (timerRef.current) {
          clearInterval(timerRef.current);
          timerRef.current = null;
        }

        // Stop mic
        if (streamRef.current) {
          streamRef.current.getTracks().forEach(track => track.stop());
          streamRef.current = null;
        }

        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        setIsRecording(false);

        if (audioBlob.size < 1000) {
          setError('Recording too short. Please record at least 5 seconds.');
          resolve();
          return;
        }

        // Upload for enrollment
        await enrollSpeaker(audioBlob);
        resolve();
      };

      mediaRecorderRef.current!.stop();
    });
  };

  const enrollSpeaker = async (audioBlob: Blob) => {
    setIsProcessing(true);
    setError(null);

    try {
      const formData = new FormData();
      formData.append('audio', audioBlob, 'enrollment.webm');
      formData.append('name', name.trim());

      const res = await fetch('/api/enroll', {
        method: 'POST',
        body: formData,
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Enrollment failed');
      }

      setSuccess(`${data.speaker.name} enrolled successfully!`);
      setName('');
      await fetchSpeakers();
      onSpeakersChanged?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Enrollment failed');
    } finally {
      setIsProcessing(false);
    }
  };

  const removeSpeaker = async (id: string) => {
    try {
      setError(null);
      const res = await fetch('/api/speakers', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to remove speaker');
      }

      await fetchSpeakers();
      onSpeakersChanged?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to remove speaker');
    }
  };

  return (
    <div className="space-y-4">
      {/* Reading text */}
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
        <p className="text-xs font-medium text-blue-700 uppercase tracking-wide mb-2">
          Read this text aloud while recording
        </p>
        <p className="text-gray-800 leading-relaxed text-sm italic">
          &ldquo;{ENROLLMENT_TEXT}&rdquo;
        </p>
      </div>

      {/* Enrollment form */}
      <div className="flex items-end gap-3">
        <div className="flex-1">
          <label htmlFor="speaker-name" className="block text-sm font-medium text-gray-700 mb-1">
            Speaker Name
          </label>
          <input
            id="speaker-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. John"
            disabled={isRecording || isProcessing}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 disabled:bg-gray-100 text-sm"
          />
        </div>

        {!isRecording ? (
          <button
            onClick={startRecording}
            disabled={isProcessing || !name.trim()}
            className={`px-5 py-2 rounded-lg font-medium text-white text-sm transition-all whitespace-nowrap ${
              isProcessing || !name.trim()
                ? 'bg-gray-400 cursor-not-allowed'
                : 'bg-red-500 hover:bg-red-600 active:scale-95'
            }`}
          >
            {isProcessing ? 'Processing...' : 'Record Voice'}
          </button>
        ) : (
          <button
            onClick={stopRecording}
            className="px-5 py-2 rounded-lg font-medium text-white text-sm bg-gray-700 hover:bg-gray-800 active:scale-95 transition-all whitespace-nowrap"
          >
            Stop ({recordingTime}s)
          </button>
        )}
      </div>

      {/* Recording indicator */}
      {isRecording && (
        <div className="flex items-center gap-2 text-red-600 text-sm">
          <div className="w-2.5 h-2.5 bg-red-500 rounded-full animate-pulse" />
          <span>Recording... Read the text above. Aim for at least 10 seconds.</span>
        </div>
      )}

      {isProcessing && (
        <div className="flex items-center gap-2 text-blue-600 text-sm">
          <div className="w-2.5 h-2.5 bg-blue-500 rounded-full animate-pulse" />
          <span>Extracting voiceprint...</span>
        </div>
      )}

      {/* Status messages */}
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-3 py-2 rounded-lg text-sm">
          {error}
        </div>
      )}

      {success && (
        <div className="bg-green-50 border border-green-200 text-green-700 px-3 py-2 rounded-lg text-sm">
          {success}
        </div>
      )}

      {/* Enrolled speakers list */}
      {speakers.length > 0 && (
        <div>
          <p className="text-sm font-medium text-gray-700 mb-2">
            Enrolled Speakers ({speakers.length})
          </p>
          <div className="flex flex-wrap gap-2">
            {speakers.map((speaker) => (
              <span
                key={speaker.id}
                className="inline-flex items-center gap-1.5 bg-gray-100 text-gray-800 px-3 py-1.5 rounded-full text-sm"
              >
                {speaker.name}
                <button
                  onClick={() => removeSpeaker(speaker.id)}
                  className="text-gray-400 hover:text-red-500 transition-colors ml-0.5"
                  title={`Remove ${speaker.name}`}
                >
                  &times;
                </button>
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
