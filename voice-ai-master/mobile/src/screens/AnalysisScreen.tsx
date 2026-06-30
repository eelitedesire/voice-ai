/**
 * AnalysisScreen — Displays therapeutic analysis results for a session.
 */

import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  ActivityIndicator,
} from 'react-native';
import { useRoute, useNavigation } from '@react-navigation/native';
import type { RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { getSessionHistory, StoredSession } from '../services/StorageService';
import { TherapeuticAnalysis } from '../types';
import { colors, typography, spacing, borderRadius, shadows } from '../theme';
import type { RootStackParamList } from '../navigation/AppNavigator';

type RouteProps = RouteProp<RootStackParamList, 'Analysis'>;
type Nav = NativeStackNavigationProp<RootStackParamList>;

export function AnalysisScreen() {
  const route = useRoute<RouteProps>();
  const navigation = useNavigation<Nav>();
  const [storedSession, setStoredSession] = useState<StoredSession | null>(null);

  useEffect(() => {
    const history = getSessionHistory();
    const found = history.find(s => s.session.id === route.params.sessionId);
    if (found) {
      setStoredSession(found);
    }
  }, [route.params.sessionId]);

  if (!storedSession) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  const { session, analysis } = storedSession;

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
    >
      {/* Session info */}
      <View style={styles.sessionHeader}>
        <Text style={styles.sessionDate}>
          {new Date(session.startTime).toLocaleDateString('en-US', {
            weekday: 'long',
            year: 'numeric',
            month: 'long',
            day: 'numeric',
          })}
        </Text>
        <Text style={styles.sessionMeta}>
          {session.transcript.length} transcript entries
          {session.endTime
            ? ` · ${Math.round((session.endTime - session.startTime) / 60000)} min`
            : ''}
        </Text>
      </View>

      {analysis ? (
        <>
          {/* Mood */}
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Session Mood</Text>
            <Text style={styles.moodText}>{analysis.mood}</Text>
          </View>

          {/* Summary */}
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Summary</Text>
            <Text style={styles.cardBody}>{analysis.summary}</Text>
          </View>

          {/* Key Breakthroughs */}
          {analysis.keyBreakthroughs.length > 0 && (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Key Breakthroughs</Text>
              {analysis.keyBreakthroughs.map((item, index) => (
                <View key={index} style={styles.listItem}>
                  <Text style={styles.listBullet}>•</Text>
                  <Text style={styles.listText}>{item}</Text>
                </View>
              ))}
            </View>
          )}

          {/* Homework */}
          {analysis.homework && (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Homework</Text>
              <Text style={styles.cardBody}>{analysis.homework}</Text>
            </View>
          )}

          {/* Concerns */}
          {analysis.concerns && analysis.concerns.length > 0 && (
            <View style={[styles.card, styles.concernCard]}>
              <Text style={styles.cardTitle}>Areas of Concern</Text>
              {analysis.concerns.map((item, index) => (
                <View key={index} style={styles.listItem}>
                  <Text style={styles.listBullet}>!</Text>
                  <Text style={[styles.listText, styles.concernText]}>
                    {item}
                  </Text>
                </View>
              ))}
            </View>
          )}
        </>
      ) : (
        <View style={styles.noAnalysis}>
          <Text style={styles.noAnalysisText}>
            No analysis available for this session.
          </Text>
          <Text style={styles.noAnalysisHint}>
            Analysis requires a server connection.
          </Text>
        </View>
      )}

      {/* Actions */}
      <View style={styles.actions}>
        <Pressable
          style={styles.actionButton}
          onPress={() => navigation.navigate('Chat')}
        >
          <Text style={styles.actionButtonText}>Discuss with AI</Text>
        </Pressable>
      </View>
    </ScrollView>
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
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.background,
  },
  sessionHeader: {
    marginBottom: spacing.lg,
  },
  sessionDate: {
    ...typography.h2,
    color: colors.textPrimary,
  },
  sessionMeta: {
    ...typography.bodySmall,
    color: colors.textMuted,
    marginTop: spacing.xs,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.lg,
    padding: spacing.lg,
    marginBottom: spacing.md,
    ...shadows.sm,
  },
  concernCard: {
    borderLeftWidth: 3,
    borderLeftColor: colors.warning,
  },
  cardTitle: {
    ...typography.label,
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: spacing.sm,
  },
  moodText: {
    ...typography.h2,
    color: colors.primaryLight,
  },
  cardBody: {
    ...typography.body,
    color: colors.textPrimary,
    lineHeight: 24,
  },
  listItem: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.xs,
  },
  listBullet: {
    ...typography.body,
    color: colors.primary,
    fontWeight: '700',
  },
  listText: {
    ...typography.body,
    color: colors.textPrimary,
    flex: 1,
    lineHeight: 24,
  },
  concernText: {
    color: colors.warning,
  },
  noAnalysis: {
    alignItems: 'center',
    paddingVertical: spacing.xxl,
  },
  noAnalysisText: {
    ...typography.body,
    color: colors.textSecondary,
  },
  noAnalysisHint: {
    ...typography.caption,
    color: colors.textMuted,
    marginTop: spacing.xs,
  },
  actions: {
    marginTop: spacing.lg,
    alignItems: 'center',
  },
  actionButton: {
    backgroundColor: colors.primary,
    borderRadius: borderRadius.lg,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    ...shadows.sm,
  },
  actionButtonText: {
    ...typography.label,
    color: colors.textPrimary,
  },
});
