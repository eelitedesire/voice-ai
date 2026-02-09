/**
 * HistoryScreen — Past session list with analysis summaries.
 */

import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  Pressable,
  Alert,
} from 'react-native';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import {
  getSessionHistory,
  deleteSession,
  StoredSession,
} from '../services/StorageService';
import { colors, typography, spacing, borderRadius, shadows } from '../theme';
import type { RootStackParamList } from '../navigation/AppNavigator';

type Nav = NativeStackNavigationProp<RootStackParamList>;

export function HistoryScreen() {
  const navigation = useNavigation<Nav>();
  const [sessions, setSessions] = useState<StoredSession[]>([]);

  useFocusEffect(
    useCallback(() => {
      setSessions(getSessionHistory());
    }, []),
  );

  const handleDelete = (sessionId: string) => {
    Alert.alert('Delete Session', 'This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          deleteSession(sessionId);
          setSessions(getSessionHistory());
        },
      },
    ]);
  };

  const formatDuration = (start: number, end?: number): string => {
    if (!end) return '--';
    const mins = Math.round((end - start) / 60000);
    return `${mins} min`;
  };

  return (
    <View style={styles.container}>
      <FlatList
        data={sessions}
        keyExtractor={item => item.session.id}
        contentContainerStyle={styles.list}
        renderItem={({ item }) => (
          <Pressable
            style={styles.card}
            onPress={() =>
              navigation.navigate('Analysis', {
                sessionId: item.session.id,
              })
            }
            onLongPress={() => handleDelete(item.session.id)}
          >
            <View style={styles.cardHeader}>
              <Text style={styles.date}>
                {new Date(item.session.startTime).toLocaleDateString()}
              </Text>
              <Text style={styles.duration}>
                {formatDuration(item.session.startTime, item.session.endTime)}
              </Text>
            </View>

            <Text style={styles.entries}>
              {item.session.transcript.length} transcript entries
            </Text>

            {item.analysis && (
              <>
                <Text style={styles.mood}>{item.analysis.mood}</Text>
                <Text style={styles.summary} numberOfLines={2}>
                  {item.analysis.summary}
                </Text>
              </>
            )}

            {!item.analysis && (
              <Text style={styles.noAnalysis}>Not analyzed</Text>
            )}
          </Pressable>
        )}
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <Text style={styles.emptyTitle}>No Sessions Yet</Text>
            <Text style={styles.emptyText}>
              Start a recording session to see your history here.
            </Text>
          </View>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  list: {
    padding: spacing.md,
    gap: spacing.md,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.lg,
    padding: spacing.lg,
    ...shadows.sm,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
  },
  date: {
    ...typography.label,
    color: colors.textPrimary,
  },
  duration: {
    ...typography.caption,
    color: colors.textMuted,
  },
  entries: {
    ...typography.caption,
    color: colors.textMuted,
    marginBottom: spacing.sm,
  },
  mood: {
    ...typography.bodySmall,
    color: colors.primaryLight,
    fontWeight: '600',
    marginBottom: spacing.xs,
  },
  summary: {
    ...typography.bodySmall,
    color: colors.textSecondary,
    lineHeight: 20,
  },
  noAnalysis: {
    ...typography.caption,
    color: colors.textMuted,
    fontStyle: 'italic',
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: 100,
  },
  emptyTitle: {
    ...typography.h2,
    color: colors.textSecondary,
    marginBottom: spacing.sm,
  },
  emptyText: {
    ...typography.body,
    color: colors.textMuted,
    textAlign: 'center',
  },
});
