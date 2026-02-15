/**
 * EnrollmentScreen — Speaker voice enrollment.
 *
 * Records a 5-15 second voice sample, extracts the voiceprint
 * on-device, and stores it locally for speaker identification.
 */

import React, { useState, useCallback, useRef, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  Pressable,
  Alert,
  FlatList,
  ActivityIndicator,
} from 'react-native';
import RNFS from 'react-native-fs';
import { RecordButton } from '../components/RecordButton';
import { AudioWaveform } from '../components/AudioWaveform';
import { SpeakerBadge } from '../components/SpeakerBadge';
import { SpeakerIdentificationService } from '../services/SpeakerIdentification';
import { useAudioCapture } from '../hooks/useAudioCapture';
import { useOnDeviceModels } from '../hooks/useOnDeviceModels';
import { audioCapture, AudioBufferEvent } from '../native/AudioCapture';
import { getSpeakerProfiles, saveSpeakerProfiles } from '../services/StorageService';
import { SpeakerProfile } from '../types';
import { AUDIO_CONFIG } from '../config/api';
import { colors, typography, spacing, borderRadius, shadows } from '../theme';

export function EnrollmentScreen() {
  const [name, setName] = useState('');
  const [role, setRole] = useState('client');
  const [isEnrolling, setIsEnrolling] = useState(false);
  const [enrollProgress, setEnrollProgress] = useState(0);
  const [profiles, setProfiles] = useState<SpeakerProfile[]>(getSpeakerProfiles);
  const [isInitializing, setIsInitializing] = useState(false);
  const { audioLevel } = useAudioCapture();

  const documentDir = RNFS.DocumentDirectoryPath;
  const { status: modelStatus } = useOnDeviceModels(documentDir);
  const speakerService = useRef(new SpeakerIdentificationService());
  const audioBuffers = useRef<string[]>([]);
  const serviceInitialized = useRef(false);

  const MIN_DURATION = 5; // seconds
  const MAX_DURATION = 15; // seconds

  // Initialize speaker service when model is ready
  useEffect(() => {
    const initService = async () => {
      if (modelStatus.speaker === 'ready' && !serviceInitialized.current) {
        setIsInitializing(true);
        try {
          await speakerService.current.initialize(documentDir);
          serviceInitialized.current = true;
        } catch (err) {
          console.error('[Enrollment] Failed to initialize speaker service:', err);
          Alert.alert(
            'Initialization Error',
            'Failed to load speaker model. Please try restarting the app.',
          );
        } finally {
          setIsInitializing(false);
        }
      }
    };
    initService();
  }, [modelStatus.speaker, documentDir]);

  const handleStartEnrollment = useCallback(async () => {
    if (!name.trim()) {
      Alert.alert('Name Required', 'Please enter a name for this speaker.');
      return;
    }

    if (!serviceInitialized.current) {
      Alert.alert(
        'Model Not Ready',
        'Speaker model is not loaded. Please download models from Settings first.',
      );
      return;
    }

    setIsEnrolling(true);
    setEnrollProgress(0);
    audioBuffers.current = [];

    // Collect audio buffers
    const unsub = audioCapture.onAudioBuffer((event: AudioBufferEvent) => {
      audioBuffers.current.push(event.samples);
      const totalSamples = audioBuffers.current.length * AUDIO_CONFIG.bufferSize;
      const seconds = totalSamples / AUDIO_CONFIG.sampleRate;
      setEnrollProgress(Math.min(seconds / MIN_DURATION, 1));

      // Auto-stop at max duration
      if (seconds >= MAX_DURATION) {
        handleStopEnrollment();
      }
    });

    try {
      await audioCapture.start({
        sampleRate: AUDIO_CONFIG.sampleRate,
        channels: AUDIO_CONFIG.channels,
        bufferSize: AUDIO_CONFIG.bufferSize,
      });
    } catch (err) {
      Alert.alert('Error', 'Failed to start recording. Check microphone permissions.');
      setIsEnrolling(false);
      unsub();
    }
  }, [name]);

  const handleStopEnrollment = useCallback(async () => {
    await audioCapture.stop();
    setIsEnrolling(false);

    const totalSamples = audioBuffers.current.length * AUDIO_CONFIG.bufferSize;
    const seconds = totalSamples / AUDIO_CONFIG.sampleRate;

    if (seconds < MIN_DURATION) {
      Alert.alert(
        'Too Short',
        `Please record at least ${MIN_DURATION} seconds of speech.`,
      );
      return;
    }

    try {
      // Concatenate all audio buffers for enrollment
      const combinedBase64 = audioBuffers.current.join('');

      const profile = await speakerService.current.enrollSpeaker(
        name.trim(),
        role,
        combinedBase64,
      );

      setProfiles(getSpeakerProfiles());
      setName('');
      Alert.alert('Enrolled', `${profile.name} has been enrolled successfully.`);
    } catch (err) {
      console.error('[Enrollment] Error:', err);
      Alert.alert(
        'Error',
        err instanceof Error ? err.message : 'Failed to process voice sample. Please try again.',
      );
    }
  }, [name, role]);

  const handleDeleteProfile = useCallback((profileId: string) => {
    Alert.alert('Delete Speaker', 'Remove this speaker profile?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          const updated = profiles.filter(p => p.id !== profileId);
          saveSpeakerProfiles(updated);
          setProfiles(updated);
        },
      },
    ]);
  }, [profiles]);

  return (
    <View style={styles.container}>
      {/* Model status warning */}
      {modelStatus.speaker !== 'ready' && (
        <View style={styles.warningBanner}>
          <Text style={styles.warningText}>
            ⚠️ Speaker model not downloaded. Go to Settings to download models.
          </Text>
        </View>
      )}

      {/* Loading indicator */}
      {isInitializing && (
        <View style={styles.loadingBanner}>
          <ActivityIndicator size="small" color={colors.primary} />
          <Text style={styles.loadingText}>Loading speaker model...</Text>
        </View>
      )}

      {/* Enrollment form */}
      <View style={styles.form}>
        <Text style={styles.heading}>Enroll New Speaker</Text>
        <Text style={styles.description}>
          Record {MIN_DURATION}-{MAX_DURATION} seconds of natural speech.
          The voiceprint is extracted and stored on-device only.
        </Text>

        <TextInput
          style={styles.input}
          placeholder="Speaker name"
          placeholderTextColor={colors.textMuted}
          value={name}
          onChangeText={setName}
          editable={!isEnrolling}
        />

        <View style={styles.roleRow}>
          {['client', 'therapist', 'other'].map(r => (
            <Pressable
              key={r}
              style={[styles.roleChip, role === r && styles.roleChipActive]}
              onPress={() => setRole(r)}
              disabled={isEnrolling}
            >
              <Text
                style={[
                  styles.roleChipText,
                  role === r && styles.roleChipTextActive,
                ]}
              >
                {r.charAt(0).toUpperCase() + r.slice(1)}
              </Text>
            </Pressable>
          ))}
        </View>

        {/* Progress / Waveform */}
        {isEnrolling && (
          <View style={styles.enrollingSection}>
            <AudioWaveform
              audioLevel={audioLevel.rms}
              isActive={true}
              maxHeight={40}
              barCount={30}
            />
            <View style={styles.progressBar}>
              <View
                style={[
                  styles.progressFill,
                  { width: `${enrollProgress * 100}%` },
                ]}
              />
            </View>
            <Text style={styles.progressText}>
              {enrollProgress < 1
                ? 'Keep speaking...'
                : 'Ready! You can stop now.'}
            </Text>
          </View>
        )}

        {/* Record button */}
        <View style={styles.buttonContainer}>
          <RecordButton
            isRecording={isEnrolling}
            audioLevel={audioLevel.rms}
            onPress={isEnrolling ? handleStopEnrollment : handleStartEnrollment}
            size={64}
          />
        </View>
      </View>

      {/* Enrolled speakers */}
      <View style={styles.listSection}>
        <Text style={styles.listTitle}>
          Enrolled Speakers ({profiles.length})
        </Text>
        <FlatList
          data={profiles}
          keyExtractor={item => item.id}
          renderItem={({ item }) => (
            <Pressable
              style={styles.profileRow}
              onLongPress={() => handleDeleteProfile(item.id)}
            >
              <SpeakerBadge name={item.name} isActive />
              <Text style={styles.profileRole}>{item.role}</Text>
            </Pressable>
          )}
          ListEmptyComponent={
            <Text style={styles.emptyText}>No speakers enrolled yet</Text>
          }
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  form: {
    padding: spacing.md,
  },
  heading: {
    ...typography.h2,
    color: colors.textPrimary,
    marginBottom: spacing.xs,
  },
  description: {
    ...typography.bodySmall,
    color: colors.textSecondary,
    marginBottom: spacing.lg,
  },
  input: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    ...typography.body,
    color: colors.textPrimary,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: spacing.md,
  },
  roleRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.lg,
  },
  roleChip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: borderRadius.full,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  roleChipActive: {
    backgroundColor: colors.primary + '20',
    borderColor: colors.primary,
  },
  roleChipText: {
    ...typography.bodySmall,
    color: colors.textSecondary,
  },
  roleChipTextActive: {
    color: colors.primary,
    fontWeight: '600',
  },
  enrollingSection: {
    marginBottom: spacing.md,
    gap: spacing.sm,
  },
  progressBar: {
    height: 4,
    backgroundColor: colors.surfaceLight,
    borderRadius: 2,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: colors.success,
    borderRadius: 2,
  },
  progressText: {
    ...typography.caption,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  buttonContainer: {
    alignItems: 'center',
    marginVertical: spacing.md,
  },
  listSection: {
    flex: 1,
    padding: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border + '40',
  },
  listTitle: {
    ...typography.label,
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: spacing.md,
  },
  profileRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  profileRole: {
    ...typography.caption,
    color: colors.textMuted,
    textTransform: 'capitalize',
  },
  emptyText: {
    ...typography.body,
    color: colors.textMuted,
    textAlign: 'center',
    paddingVertical: spacing.lg,
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
  loadingBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.md,
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: borderRadius.md,
    margin: spacing.md,
  },
  loadingText: {
    ...typography.bodySmall,
    color: colors.textSecondary,
  },
});
