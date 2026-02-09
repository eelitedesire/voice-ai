/**
 * SpeakerBadge — Small pill showing identified speaker name.
 */

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { colors, typography, spacing, borderRadius } from '../theme';

interface SpeakerBadgeProps {
  name: string;
  isActive?: boolean;
  size?: 'small' | 'medium';
}

export function SpeakerBadge({
  name,
  isActive = false,
  size = 'medium',
}: SpeakerBadgeProps) {
  // Consistent color per speaker name
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = (hash << 5) - hash + name.charCodeAt(i);
  }
  const badgeColor = hash % 2 === 0 ? colors.speaker1 : colors.speaker2;

  return (
    <View
      style={[
        styles.badge,
        size === 'small' ? styles.badgeSmall : styles.badgeMedium,
        { borderColor: badgeColor },
        isActive && { backgroundColor: badgeColor + '20' },
      ]}
    >
      <View
        style={[styles.dot, { backgroundColor: isActive ? badgeColor : colors.textMuted }]}
      />
      <Text
        style={[
          size === 'small' ? styles.textSmall : styles.textMedium,
          { color: isActive ? badgeColor : colors.textSecondary },
        ]}
      >
        {name}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: borderRadius.full,
    gap: spacing.xs,
  },
  badgeSmall: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  badgeMedium: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  textSmall: {
    ...typography.caption,
  },
  textMedium: {
    ...typography.bodySmall,
    fontWeight: '600',
  },
});
