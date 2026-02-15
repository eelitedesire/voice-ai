/**
 * AudioWaveform — Real-time audio level visualization.
 *
 * Renders a series of vertical bars that respond to the current audio level.
 * Uses Reanimated for smooth 60fps updates without JS thread blocking.
 */

import React, { useEffect, useRef } from 'react';
import { View, StyleSheet } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  Easing,
} from 'react-native-reanimated';
import { colors } from '../theme';

interface AudioWaveformProps {
  audioLevel: number; // 0-1 normalized
  isActive: boolean;
  barCount?: number;
  barWidth?: number;
  barGap?: number;
  maxHeight?: number;
  color?: string;
  activeColor?: string;
}

const BAR_COUNT = 40;

function WaveBar({
  index,
  audioLevel,
  isActive,
  barWidth,
  maxHeight,
  color,
  activeColor,
  total,
}: {
  index: number;
  audioLevel: number;
  isActive: boolean;
  barWidth: number;
  maxHeight: number;
  color: string;
  activeColor: string;
  total: number;
}) {
  const height = useSharedValue(4);

  useEffect(() => {
    if (!isActive) {
      height.value = withTiming(4, { duration: 300 });
      return;
    }

    // Create wave-like distribution from center
    const center = total / 2;
    const distFromCenter = Math.abs(index - center) / center;
    const baseMultiplier = 1 - distFromCenter * 0.6;

    // Add some randomness for organic feel
    const randomFactor = 0.7 + Math.random() * 0.6;
    const targetHeight = Math.max(
      4,
      audioLevel * maxHeight * baseMultiplier * randomFactor,
    );

    height.value = withTiming(targetHeight, {
      duration: 80 + Math.random() * 40,
      easing: Easing.out(Easing.ease),
    });
  }, [audioLevel, isActive, index, maxHeight, total, height]);

  const animatedStyle = useAnimatedStyle(() => ({
    height: height.value,
  }));

  return (
    <Animated.View
      style={[
        styles.bar,
        animatedStyle,
        {
          width: barWidth,
          backgroundColor: isActive ? activeColor : color,
          borderRadius: barWidth / 2,
        },
      ]}
    />
  );
}

export function AudioWaveform({
  audioLevel,
  isActive,
  barCount = BAR_COUNT,
  barWidth = 3,
  barGap = 2,
  maxHeight = 60,
  color = colors.surfaceLight,
  activeColor = colors.primary,
}: AudioWaveformProps) {
  return (
    <View style={[styles.container, { height: maxHeight }]}>
      {Array.from({ length: barCount }).map((_, i) => (
        <WaveBar
          key={i}
          index={i}
          audioLevel={audioLevel}
          isActive={isActive}
          barWidth={barWidth}
          maxHeight={maxHeight}
          color={color}
          activeColor={activeColor}
          total={barCount}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
  },
  bar: {
    minHeight: 4,
  },
});
