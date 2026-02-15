/**
 * ProcessingIndicator — Shows current processing mode and status.
 */

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { ProcessingMode, ModelStatus } from '../types';
import { ConnectionStatus } from '../services/StreamingService';
import { colors, typography, spacing, borderRadius } from '../theme';

interface ProcessingIndicatorProps {
  mode: ProcessingMode;
  modelStatus?: ModelStatus;
  connectionStatus?: ConnectionStatus;
}

export function ProcessingIndicator({
  mode,
  modelStatus,
  connectionStatus,
}: ProcessingIndicatorProps) {
  const getStatusColor = (): string => {
    if (mode === 'on-device') {
      return modelStatus?.asr === 'ready' ? colors.success : colors.warning;
    }
    if (mode === 'server') {
      return connectionStatus === 'connected' ? colors.success : colors.warning;
    }
    // hybrid
    const onDeviceOk = modelStatus?.asr === 'ready';
    const serverOk = connectionStatus === 'connected';
    if (onDeviceOk && serverOk) return colors.success;
    if (onDeviceOk || serverOk) return colors.warning;
    return colors.error;
  };

  const getStatusText = (): string => {
    switch (mode) {
      case 'on-device':
        return modelStatus?.asr === 'ready'
          ? 'On-device'
          : 'Models not loaded';
      case 'server':
        return connectionStatus === 'connected'
          ? 'Server connected'
          : 'Server disconnected';
      case 'hybrid':
        return 'Hybrid mode';
    }
  };

  const getModeIcon = (): string => {
    switch (mode) {
      case 'on-device':
        return 'phone';
      case 'server':
        return 'cloud';
      case 'hybrid':
        return 'sync';
    }
  };

  return (
    <View style={styles.container}>
      <View style={[styles.dot, { backgroundColor: getStatusColor() }]} />
      <Text style={styles.text}>{getStatusText()}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: borderRadius.full,
    gap: spacing.xs,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  text: {
    ...typography.caption,
    color: colors.textSecondary,
  },
});
