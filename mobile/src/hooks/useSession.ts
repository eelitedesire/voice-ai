/**
 * useSession — Manages session lifecycle and analysis.
 */

import { useState, useCallback, useRef } from 'react';
import { APIService } from '../services/APIService';
import {
  Session,
  TranscriptEntry,
  TherapeuticAnalysis,
  ChatMessage,
} from '../types';
import {
  saveSession,
  getSettings,
  addToOfflineQueue,
} from '../services/StorageService';

interface UseSessionReturn {
  session: Session | null;
  analysis: TherapeuticAnalysis | null;
  chatMessages: ChatMessage[];
  isAnalyzing: boolean;
  isChatting: boolean;
  startSession: () => void;
  endSession: (transcript: TranscriptEntry[]) => void;
  analyzeSession: () => Promise<TherapeuticAnalysis | null>;
  sendChat: (message: string, speakerName?: string) => Promise<void>;
}

export function useSession(): UseSessionReturn {
  const [session, setSession] = useState<Session | null>(null);
  const [analysis, setAnalysis] = useState<TherapeuticAnalysis | null>(null);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isChatting, setIsChatting] = useState(false);

  const settings = getSettings();
  const apiRef = useRef(new APIService(settings.serverUrl));

  const startSession = useCallback(() => {
    const newSession: Session = {
      id: `session_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      transcript: [],
      startTime: Date.now(),
    };
    setSession(newSession);
    setAnalysis(null);
    setChatMessages([]);
  }, []);

  const endSession = useCallback(
    (transcript: TranscriptEntry[]) => {
      if (!session) return;

      const completed: Session = {
        ...session,
        transcript,
        endTime: Date.now(),
      };

      setSession(completed);
    },
    [session],
  );

  const analyzeSession = useCallback(async (): Promise<TherapeuticAnalysis | null> => {
    if (!session || session.transcript.length === 0) return null;

    setIsAnalyzing(true);

    try {
      const result = await apiRef.current.analyzeSession(
        session.transcript,
        session.coupleId,
      );
      setAnalysis(result);
      saveSession(session, result);
      return result;
    } catch (err) {
      // Offline — queue for later
      addToOfflineQueue(session.transcript);
      console.warn('Analysis failed (offline?), queued for later:', err);
      saveSession(session);
      return null;
    } finally {
      setIsAnalyzing(false);
    }
  }, [session]);

  const sendChat = useCallback(
    async (message: string, speakerName?: string) => {
      if (!session) return;

      const userMessage: ChatMessage = {
        id: `msg_${Date.now()}`,
        role: 'speaker',
        speaker: speakerName,
        text: message,
        timestamp: Date.now(),
      };

      setChatMessages(prev => [...prev, userMessage]);
      setIsChatting(true);

      try {
        const response = await apiRef.current.sendChatMessage(
          message,
          session.transcript,
          chatMessages,
          speakerName,
          session.coupleId,
        );

        const therapistMessage: ChatMessage = {
          id: `msg_${Date.now()}_resp`,
          role: 'therapist',
          text: response,
          timestamp: Date.now(),
        };

        setChatMessages(prev => [...prev, therapistMessage]);
      } catch (err) {
        const errorMessage: ChatMessage = {
          id: `msg_${Date.now()}_err`,
          role: 'therapist',
          text: 'Unable to reach the server. Please check your connection.',
          timestamp: Date.now(),
        };
        setChatMessages(prev => [...prev, errorMessage]);
      } finally {
        setIsChatting(false);
      }
    },
    [session, chatMessages],
  );

  return {
    session,
    analysis,
    chatMessages,
    isAnalyzing,
    isChatting,
    startSession,
    endSession,
    analyzeSession,
    sendChat,
  };
}
