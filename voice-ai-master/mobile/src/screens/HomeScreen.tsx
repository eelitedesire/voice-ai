/**
 * HomeScreen — Main dashboard with quick actions and session overview.
 */

import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { ProcessingIndicator } from '../components/ProcessingIndicator';
import { useOnDeviceModels } from '../hooks/useOnDeviceModels';
import { getSettings, getSessionHistory, getSpeakerProfiles } from '../services/StorageService';
import { colors, typography, spacing, borderRadius, shadows } from '../theme';
import type { RootStackParamList } from '../navigation/AppNavigator';

type Nav = NativeStackNavigationProp<RootStackParamList>;

export function HomeScreen() {
  const navigation = useNavigation<Nav>();
  const settings = getSettings();
  const { status: modelStatus, allReady } = useOnDeviceModels('/var/mobile'); // placeholder path
  const sessionHistory = getSessionHistory();
  const speakers = getSpeakerProfiles();

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
    >
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.title}>Voice AI</Text>
        <Text style={styles.subtitle}>Couples Therapy Assistant</Text>
        <View style={styles.statusRow}>
          <ProcessingIndicator mode={settings.processingMode} modelStatus={modelStatus} />
        </View>
      </View>

      {/* Quick Actions */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Quick Actions</Text>
        <View style={styles.actionGrid}>
          <Pressable
            style={({ pressed }) => [
              styles.actionCard,
              styles.primaryAction,
              pressed && styles.actionPressed,
            ]}
            onPress={() => navigation.navigate('Session')}
          >
            <Text style={styles.actionIcon}>{'[mic]'}</Text>
            <Text style={styles.actionTitle}>New Session</Text>
            <Text style={styles.actionDesc}>Start recording a therapy session</Text>
          </Pressable>

          <Pressable
            style={({ pressed }) => [
              styles.actionCard,
              pressed && styles.actionPressed,
            ]}
            onPress={() => navigation.navigate('Enrollment')}
          >
            <Text style={styles.actionIcon}>{'[user]'}</Text>
            <Text style={styles.actionTitle}>Enroll Speaker</Text>
            <Text style={styles.actionDesc}>
              {speakers.length} enrolled
            </Text>
          </Pressable>

          <Pressable
            style={({ pressed }) => [
              styles.actionCard,
              pressed && styles.actionPressed,
            ]}
            onPress={() => navigation.navigate('History')}
          >
            <Text style={styles.actionIcon}>{'[list]'}</Text>
            <Text style={styles.actionTitle}>History</Text>
            <Text style={styles.actionDesc}>
              {sessionHistory.length} sessions
            </Text>
          </Pressable>

          <Pressable
            style={({ pressed }) => [
              styles.actionCard,
              pressed && styles.actionPressed,
            ]}
            onPress={() => navigation.navigate('Settings')}
          >
            <Text style={styles.actionIcon}>{'[gear]'}</Text>
            <Text style={styles.actionTitle}>Settings</Text>
            <Text style={styles.actionDesc}>Configure processing</Text>
          </Pressable>
        </View>
      </View>

      {/* Model Status */}
      {settings.processingMode !== 'server' && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>On-Device Models</Text>
          <View style={styles.modelList}>
            <ModelRow label="Speech Recognition" status={modelStatus.asr} />
            <ModelRow label="Voice Activity Detection" status={modelStatus.vad} />
            <ModelRow label="Speaker Identification" status={modelStatus.speaker} />
          </View>
          {!allReady && (
            <Text style={styles.modelHint}>
              Download models in Settings for on-device processing
            </Text>
          )}
        </View>
      )}

      {/* Recent Sessions */}
      {sessionHistory.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Recent Sessions</Text>
          {sessionHistory.slice(0, 3).map((item, index) => (
            <Pressable
              key={item.session.id}
              style={styles.sessionRow}
              onPress={() => navigation.navigate('Analysis', {
                sessionId: item.session.id,
              })}
            >
              <View style={styles.sessionInfo}>
                <Text style={styles.sessionDate}>
                  {new Date(item.session.startTime).toLocaleDateString()}
                </Text>
                <Text style={styles.sessionMeta}>
                  {item.session.transcript.length} entries
                  {item.analysis ? ' · Analyzed' : ''}
                </Text>
              </View>
              {item.analysis && (
                <Text style={styles.sessionMood}>{item.analysis.mood}</Text>
              )}
            </Pressable>
          ))}
        </View>
      )}
    </ScrollView>
  );
}

function ModelRow({
  label,
  status,
}: {
  label: string;
  status: string;
}) {
  const statusColor =
    status === 'ready'
      ? colors.success
      : status === 'downloading'
      ? colors.warning
      : status === 'error'
      ? colors.error
      : colors.textMuted;

  const statusText =
    status === 'ready'
      ? 'Ready'
      : status === 'downloading'
      ? 'Downloading...'
      : status === 'error'
      ? 'Error'
      : 'Not downloaded';

  return (
    <View style={styles.modelRow}>
      <Text style={styles.modelLabel}>{label}</Text>
      <View style={styles.modelStatus}>
        <View style={[styles.modelDot, { backgroundColor: statusColor }]} />
        <Text style={[styles.modelStatusText, { color: statusColor }]}>
          {statusText}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    padding: spacing.md,
    paddingBottom: spacing.xxl,
  },
  header: {
    paddingVertical: spacing.lg,
  },
  title: {
    ...typography.h1,
    color: colors.textPrimary,
  },
  subtitle: {
    ...typography.body,
    color: colors.textSecondary,
    marginTop: spacing.xs,
  },
  statusRow: {
    marginTop: spacing.md,
    flexDirection: 'row',
  },
  section: {
    marginTop: spacing.lg,
  },
  sectionTitle: {
    ...typography.label,
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: spacing.md,
  },
  actionGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
  },
  actionCard: {
    width: '47%',
    backgroundColor: colors.surface,
    borderRadius: borderRadius.lg,
    padding: spacing.lg,
    ...shadows.sm,
  },
  primaryAction: {
    backgroundColor: colors.primary,
  },
  actionPressed: {
    opacity: 0.8,
  },
  actionIcon: {
    fontSize: 24,
    marginBottom: spacing.sm,
    color: colors.textPrimary,
  },
  actionTitle: {
    ...typography.h3,
    color: colors.textPrimary,
    marginBottom: spacing.xs,
  },
  actionDesc: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  modelList: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.md,
    overflow: 'hidden',
  },
  modelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border + '40',
  },
  modelLabel: {
    ...typography.bodySmall,
    color: colors.textPrimary,
  },
  modelStatus: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  modelDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  modelStatusText: {
    ...typography.caption,
  },
  modelHint: {
    ...typography.caption,
    color: colors.textMuted,
    marginTop: spacing.sm,
  },
  sessionRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  sessionInfo: {
    flex: 1,
  },
  sessionDate: {
    ...typography.bodySmall,
    color: colors.textPrimary,
    fontWeight: '600',
  },
  sessionMeta: {
    ...typography.caption,
    color: colors.textMuted,
    marginTop: 2,
  },
  sessionMood: {
    ...typography.caption,
    color: colors.primaryLight,
    backgroundColor: colors.primary + '20',
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: borderRadius.full,
    overflow: 'hidden',
  },
});
