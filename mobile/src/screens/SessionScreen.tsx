/**
 * SessionScreen — Main recording and live transcription screen.
 *
 * This is the core screen where therapy sessions are captured.
 * Shows audio waveform, record controls, and live transcript.
 */

import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  Alert,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RecordButton } from '../components/RecordButton';
import { AudioWaveform } from '../components/AudioWaveform';
import { TranscriptView } from '../components/TranscriptView';
import { ProcessingIndicator } from '../components/ProcessingIndicator';
import { SpeakerBadge } from '../components/SpeakerBadge';
import { useTranscription } from '../hooks/useTranscription';
import { useSession } from '../hooks/useSession';
import { useAudioCapture } from '../hooks/useAudioCapture';
import { getSettings, getSpeakerProfiles } from '../services/StorageService';
import { colors, typography, spacing, borderRadius, shadows } from '../theme';
import type { RootStackParamList } from '../navigation/AppNavigator';

type Nav = NativeStackNavigationProp<RootStackParamList>;

export function SessionScreen() {
  const navigation = useNavigation<Nav>();
  const settings = getSettings();
  const speakers = getSpeakerProfiles();

  const { audioLevel } = useAudioCapture();
  const {
    isActive,
    transcript,
    partialText,
    isSpeaking,
    connectionStatus,
    processingMode,
    start,
    stop,
    clearTranscript,
  } = useTranscription('/var/mobile'); // document dir — resolved at runtime

  const { session, startSession, endSession, analyzeSession, isAnalyzing } =
    useSession();

  const [elapsed, setElapsed] = useState(0);
  const [timerInterval, setTimerInterval] = useState<ReturnType<typeof setInterval> | null>(null);

  const handleToggleRecording = useCallback(async () => {
    if (isActive) {
      // Stop recording
      const finalTranscript = await stop();

      if (timerInterval) {
        clearInterval(timerInterval);
        setTimerInterval(null);
      }

      endSession(finalTranscript);

      if (finalTranscript.length > 0) {
        Alert.alert(
          'Session Complete',
          `Captured ${finalTranscript.length} transcript entries. Analyze now?`,
          [
            { text: 'Later', style: 'cancel' },
            {
              text: 'Analyze',
              onPress: async () => {
                const result = await analyzeSession();
                if (result) {
                  navigation.navigate('Analysis', {
                    sessionId: session?.id || '',
                  });
                }
              },
            },
            {
              text: 'Chat',
              onPress: () => navigation.navigate('Chat'),
            },
          ],
        );
      }
    } else {
      // Start recording
      clearTranscript();
      startSession();
      setElapsed(0);

      const interval = setInterval(() => {
        setElapsed(prev => prev + 1);
      }, 1000);
      setTimerInterval(interval);

      await start();
    }
  }, [
    isActive,
    stop,
    start,
    timerInterval,
    endSession,
    startSession,
    clearTranscript,
    analyzeSession,
    navigation,
    session,
  ]);

  const formatElapsed = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <View style={styles.container}>
      {/* Status bar */}
      <View style={styles.statusBar}>
        <ProcessingIndicator
          mode={processingMode}
          connectionStatus={connectionStatus}
        />
        {isActive && <Text style={styles.timer}>{formatElapsed(elapsed)}</Text>}
      </View>

      {/* Enrolled speakers */}
      {speakers.length > 0 && (
        <View style={styles.speakerRow}>
          {speakers.map(s => (
            <SpeakerBadge key={s.id} name={s.name} size="small" />
          ))}
        </View>
      )}

      {/* Waveform */}
      <View style={styles.waveformContainer}>
        <AudioWaveform
          audioLevel={audioLevel.rms}
          isActive={isActive}
          activeColor={isSpeaking ? colors.success : colors.primary}
        />
      </View>

      {/* Transcript */}
      <View style={styles.transcriptContainer}>
        <TranscriptView
          entries={transcript}
          partialText={partialText}
          isSpeaking={isSpeaking}
        />
      </View>

      {/* Controls */}
      <View style={styles.controls}>
        <RecordButton
          isRecording={isActive}
          audioLevel={audioLevel.rms}
          onPress={handleToggleRecording}
        />

        {!isActive && transcript.length > 0 && (
          <View style={styles.postSessionActions}>
            <Pressable
              style={[styles.actionButton, styles.analyzeButton]}
              onPress={async () => {
                const result = await analyzeSession();
                if (result) {
                  navigation.navigate('Analysis', {
                    sessionId: session?.id || '',
                  });
                }
              }}
              disabled={isAnalyzing}
            >
              <Text style={styles.actionButtonText}>
                {isAnalyzing ? 'Analyzing...' : 'Analyze'}
              </Text>
            </Pressable>

            <Pressable
              style={[styles.actionButton, styles.chatButton]}
              onPress={() => navigation.navigate('Chat')}
            >
              <Text style={styles.actionButtonText}>Chat</Text>
            </Pressable>
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  statusBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  timer: {
    ...typography.h3,
    color: colors.recording,
    fontVariant: ['tabular-nums'],
  },
  speakerRow: {
    flexDirection: 'row',
    paddingHorizontal: spacing.md,
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  waveformContainer: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  transcriptContainer: {
    flex: 1,
    borderTopWidth: 1,
    borderTopColor: colors.border + '40',
  },
  controls: {
    alignItems: 'center',
    paddingVertical: spacing.lg,
    paddingBottom: spacing.xxl,
    borderTopWidth: 1,
    borderTopColor: colors.border + '40',
    backgroundColor: colors.surface,
  },
  postSessionActions: {
    flexDirection: 'row',
    gap: spacing.md,
    marginTop: spacing.md,
  },
  actionButton: {
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    borderRadius: borderRadius.lg,
    ...shadows.sm,
  },
  analyzeButton: {
    backgroundColor: colors.primary,
  },
  chatButton: {
    backgroundColor: colors.surfaceLight,
  },
  actionButtonText: {
    ...typography.label,
    color: colors.textPrimary,
  },
});
