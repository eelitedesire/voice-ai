/**
 * ChatBubble — Styled chat message with sender alignment.
 */

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { ChatMessage } from '../types';
import { colors, typography, spacing, borderRadius } from '../theme';

interface ChatBubbleProps {
  message: ChatMessage;
}

export function ChatBubble({ message }: ChatBubbleProps) {
  const isTherapist = message.role === 'therapist';

  return (
    <View
      style={[
        styles.container,
        isTherapist ? styles.therapistContainer : styles.speakerContainer,
      ]}
    >
      <View
        style={[
          styles.bubble,
          isTherapist ? styles.therapistBubble : styles.speakerBubble,
        ]}
      >
        {!isTherapist && message.speaker && (
          <Text style={styles.senderName}>{message.speaker}</Text>
        )}
        {isTherapist && (
          <Text style={styles.therapistLabel}>AI Therapist</Text>
        )}
        <Text
          style={[
            styles.messageText,
            isTherapist ? styles.therapistText : styles.speakerText,
          ]}
        >
          {message.text}
        </Text>
        <Text style={styles.timestamp}>
          {new Date(message.timestamp).toLocaleTimeString([], {
            hour: '2-digit',
            minute: '2-digit',
          })}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginVertical: spacing.xs,
    paddingHorizontal: spacing.md,
  },
  therapistContainer: {
    alignItems: 'flex-start',
  },
  speakerContainer: {
    alignItems: 'flex-end',
  },
  bubble: {
    maxWidth: '80%',
    padding: spacing.md,
    borderRadius: borderRadius.lg,
  },
  therapistBubble: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 4,
  },
  speakerBubble: {
    backgroundColor: colors.primary,
    borderTopRightRadius: 4,
  },
  senderName: {
    ...typography.caption,
    color: colors.primaryLight,
    marginBottom: spacing.xs,
    fontWeight: '600',
  },
  therapistLabel: {
    ...typography.caption,
    color: colors.textMuted,
    marginBottom: spacing.xs,
    fontWeight: '600',
  },
  messageText: {
    ...typography.body,
  },
  therapistText: {
    color: colors.textPrimary,
  },
  speakerText: {
    color: '#FFFFFF',
  },
  timestamp: {
    ...typography.caption,
    color: colors.textMuted,
    marginTop: spacing.xs,
    alignSelf: 'flex-end',
  },
});
