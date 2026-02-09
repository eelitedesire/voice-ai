/**
 * TranscriptView — Scrollable list of transcript entries with speaker labels.
 */

import React, { useRef, useEffect } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
} from 'react-native';
import { TranscriptEntry } from '../types';
import { colors, typography, spacing, borderRadius } from '../theme';

interface TranscriptViewProps {
  entries: TranscriptEntry[];
  partialText?: string;
  isSpeaking?: boolean;
}

function speakerColor(speaker: string): string {
  if (speaker.toLowerCase().includes('unknown')) return colors.textMuted;
  // Alternate between speaker colors based on name hash
  let hash = 0;
  for (let i = 0; i < speaker.length; i++) {
    hash = (hash << 5) - hash + speaker.charCodeAt(i);
  }
  return hash % 2 === 0 ? colors.speaker1 : colors.speaker2;
}

function formatTime(timestamp: number): string {
  const date = new Date(timestamp);
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function TranscriptView({
  entries,
  partialText,
  isSpeaking,
}: TranscriptViewProps) {
  const scrollRef = useRef<ScrollView>(null);

  useEffect(() => {
    // Auto-scroll to bottom on new entries
    setTimeout(() => {
      scrollRef.current?.scrollToEnd({ animated: true });
    }, 100);
  }, [entries.length, partialText]);

  return (
    <ScrollView
      ref={scrollRef}
      style={styles.container}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
    >
      {entries.length === 0 && !partialText && (
        <View style={styles.emptyState}>
          <Text style={styles.emptyText}>
            Transcript will appear here as you speak...
          </Text>
        </View>
      )}

      {entries.map((entry, index) => (
        <View key={index} style={styles.entry}>
          <View style={styles.entryHeader}>
            <View
              style={[
                styles.speakerDot,
                { backgroundColor: speakerColor(entry.speaker) },
              ]}
            />
            <Text
              style={[
                styles.speakerName,
                { color: speakerColor(entry.speaker) },
              ]}
            >
              {entry.speaker}
            </Text>
            <Text style={styles.timestamp}>{formatTime(entry.timestamp)}</Text>
          </View>
          <Text style={styles.entryText}>{entry.text}</Text>
        </View>
      ))}

      {/* Partial (in-progress) transcription */}
      {partialText ? (
        <View style={[styles.entry, styles.partialEntry]}>
          <View style={styles.entryHeader}>
            <View style={[styles.speakerDot, styles.speakerDotPulsing]} />
            <Text style={styles.partialLabel}>Listening...</Text>
          </View>
          <Text style={styles.partialText}>{partialText}</Text>
        </View>
      ) : null}

      {/* Speaking indicator */}
      {isSpeaking && !partialText ? (
        <View style={[styles.entry, styles.partialEntry]}>
          <View style={styles.entryHeader}>
            <View style={[styles.speakerDot, styles.speakerDotPulsing]} />
            <Text style={styles.partialLabel}>Detecting speech...</Text>
          </View>
        </View>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    padding: spacing.md,
    gap: spacing.sm,
  },
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.xxl,
  },
  emptyText: {
    ...typography.body,
    color: colors.textMuted,
    textAlign: 'center',
  },
  entry: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.md,
    padding: spacing.md,
  },
  entryHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.xs,
    gap: spacing.xs,
  },
  speakerDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  speakerDotPulsing: {
    backgroundColor: colors.processing,
  },
  speakerName: {
    ...typography.label,
    flex: 1,
  },
  timestamp: {
    ...typography.caption,
    color: colors.textMuted,
  },
  entryText: {
    ...typography.body,
    color: colors.textPrimary,
  },
  partialEntry: {
    borderStyle: 'dashed',
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: 'transparent',
  },
  partialLabel: {
    ...typography.caption,
    color: colors.processing,
  },
  partialText: {
    ...typography.body,
    color: colors.textSecondary,
    fontStyle: 'italic',
  },
});
