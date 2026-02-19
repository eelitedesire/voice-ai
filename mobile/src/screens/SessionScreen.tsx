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
import RNFS from 'react-native-fs';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RecordButton } from '../components/RecordButton';
import { AudioWaveform } from '../components/AudioWaveform';
import { TranscriptView } from '../components/TranscriptView';
import { ProcessingIndicator } from '../components/ProcessingIndicator';
import { SpeakerBadge } from '../components/SpeakerBadge';
import { useTranscription } from '../hooks/useTranscription';
import { useSession } from '../hooks/useSession';
import { useOnDeviceModels } from '../hooks/useOnDeviceModels';
import { getSettings, getSpeakerProfiles } from '../services/StorageService';
import { colors, typography, spacing, borderRadius, shadows } from '../theme';
import type { RootStackParamList } from '../navigation/AppNavigator';

type Nav = NativeStackNavigationProp<RootStackParamList>;

export function SessionScreen() {
  const navigation = useNavigation<Nav>();
  const settings = getSettings();
  const speakers = getSpeakerProfiles();

  const documentDir = RNFS.DocumentDirectoryPath;
  const { status: modelStatus } = useOnDeviceModels(documentDir);
  const {
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
  } = useTranscription(documentDir);

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
      // Start recording - check prerequisites first
      const needsModels = processingMode === 'on-device' || processingMode === 'hybrid';
      const modelsReady = modelStatus.asr === 'ready' && modelStatus.vad === 'ready';

      if (needsModels && !modelsReady) {
        Alert.alert(
          'Models Not Ready',
          'On-device processing requires downloaded models. Go to Settings to download them, or switch to server mode.',
          [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Settings', onPress: () => navigation.navigate('Settings') },
          ],
        );
        return;
      }

      if (processingMode === 'server' && connectionStatus === 'disconnected') {
        Alert.alert(
          'Server Not Connected',
          `Cannot connect to ${settings.serverUrl}. Make sure the server is running.`,
        );
        return;
      }

      clearTranscript();
      startSession();
      setElapsed(0);

      const interval = setInterval(() => {
        setElapsed(prev => prev + 1);
      }, 1000);
      setTimerInterval(interval);

      try {
        await start();
      } catch (err) {
        clearInterval(interval);
        setTimerInterval(null);
        Alert.alert(
          'Recording Failed',
          err instanceof Error ? err.message : 'Failed to start recording',
        );
      }
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
    processingMode,
    modelStatus,
    connectionStatus,
    settings.serverUrl,
  ]);

  const formatElapsed = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const needsModels = processingMode === 'on-device' || processingMode === 'hybrid';
  const modelsNotReady = needsModels && (
    modelStatus.asr !== 'ready' ||
    modelStatus.vad !== 'ready' ||
    (processingMode === 'on-device' && modelStatus.speaker !== 'ready')
  );

  return (
    <View style={styles.container}>
      {/* Warning banners */}
      {modelsNotReady && !isActive && (
        <View style={styles.warningBanner}>
          <Text style={styles.warningText}>
            ⚠️ Models not downloaded. Go to Settings to download models or switch to server mode.
          </Text>
          <Pressable
            style={styles.warningButton}
            onPress={() => navigation.navigate('Settings')}
          >
            <Text style={styles.warningButtonText}>Go to Settings</Text>
          </Pressable>
        </View>
      )}

      {processingMode === 'server' && connectionStatus === 'disconnected' && !isActive && (
        <View style={styles.warningBanner}>
          <Text style={styles.warningText}>
            ⚠️ Server not connected. Make sure the backend is running at {settings.serverUrl}
          </Text>
        </View>
      )}

      {/* Status bar */}
      <View style={styles.statusBar}>
        <ProcessingIndicator
          mode={processingMode}
          modelStatus={modelStatus}
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
  warningBanner: {
    backgroundColor: colors.warning + '20',
    borderLeftWidth: 4,
    borderLeftColor: colors.warning,
    padding: spacing.md,
    margin: spacing.md,
    borderRadius: borderRadius.sm,
  },
  warningText: {
    ...typography.bodySmall,
    color: colors.warning,
  },
  warningButton: {
    backgroundColor: colors.warning,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: borderRadius.md,
    alignSelf: 'flex-start',
    marginTop: spacing.sm,
  },
  warningButtonText: {
    ...typography.label,
    color: colors.surface,
  },
});
