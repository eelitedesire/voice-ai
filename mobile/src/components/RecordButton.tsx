/**
 * RecordButton — Animated circular record/stop button with audio level ring.
 *
 * Uses Reanimated for 60fps pulse animation during recording.
 */

import React, { useEffect } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withTiming,
  withSequence,
  Easing,
  cancelAnimation,
} from 'react-native-reanimated';
import { colors, shadows } from '../theme';

interface RecordButtonProps {
  isRecording: boolean;
  audioLevel: number; // 0-1 normalized RMS
  onPress: () => void;
  size?: number;
}

export function RecordButton({
  isRecording,
  audioLevel,
  onPress,
  size = 80,
}: RecordButtonProps) {
  const pulseScale = useSharedValue(1);
  const levelScale = useSharedValue(1);

  useEffect(() => {
    if (isRecording) {
      pulseScale.value = withRepeat(
        withSequence(
          withTiming(1.15, { duration: 800, easing: Easing.inOut(Easing.ease) }),
          withTiming(1, { duration: 800, easing: Easing.inOut(Easing.ease) }),
        ),
        -1,
        true,
      );
    } else {
      cancelAnimation(pulseScale);
      pulseScale.value = withTiming(1, { duration: 200 });
    }
  }, [isRecording, pulseScale]);

  useEffect(() => {
    levelScale.value = withTiming(1 + audioLevel * 0.3, {
      duration: 100,
      easing: Easing.out(Easing.ease),
    });
  }, [audioLevel, levelScale]);

  const pulseStyle = useAnimatedStyle(() => ({
    transform: [{ scale: pulseScale.value }],
  }));

  const levelRingStyle = useAnimatedStyle(() => ({
    transform: [{ scale: levelScale.value }],
    opacity: isRecording ? 0.4 : 0,
  }));

  const innerSize = isRecording ? size * 0.35 : size * 0.7;
  const innerRadius = isRecording ? 8 : size * 0.35;

  return (
    <View style={[styles.container, { width: size * 1.6, height: size * 1.6 }]}>
      {/* Audio level ring */}
      <Animated.View
        style={[
          styles.levelRing,
          levelRingStyle,
          {
            width: size * 1.4,
            height: size * 1.4,
            borderRadius: size * 0.7,
            borderColor: colors.recording,
          },
        ]}
      />

      {/* Pulse ring */}
      <Animated.View
        style={[
          styles.pulseRing,
          pulseStyle,
          {
            width: size * 1.2,
            height: size * 1.2,
            borderRadius: size * 0.6,
            backgroundColor: isRecording ? colors.recordingPulse : 'transparent',
          },
        ]}
      />

      {/* Button */}
      <Pressable
        onPress={onPress}
        style={({ pressed }) => [
          styles.button,
          {
            width: size,
            height: size,
            borderRadius: size / 2,
            backgroundColor: colors.surface,
            opacity: pressed ? 0.8 : 1,
          },
          shadows.md,
        ]}
      >
        <Animated.View
          style={[
            styles.inner,
            {
              width: innerSize,
              height: innerSize,
              borderRadius: innerRadius,
              backgroundColor: isRecording ? colors.recording : colors.primary,
            },
          ]}
        />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  levelRing: {
    position: 'absolute',
    borderWidth: 3,
  },
  pulseRing: {
    position: 'absolute',
    opacity: 0.2,
  },
  button: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 3,
    borderColor: colors.border,
  },
  inner: {},
});
