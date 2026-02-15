/**
 * App — Root component.
 *
 * Sets up navigation, safe area, and status bar.
 */

import React, { useEffect } from 'react';
import { StatusBar, StyleSheet, LogBox } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AppNavigator } from './navigation/AppNavigator';
import { colors } from './theme';

// Suppress known harmless warnings from native modules during development
LogBox.ignoreLogs([
  'new NativeEventEmitter',
]);

export default function App() {
  return (
    <SafeAreaProvider>
      <StatusBar barStyle="light-content" backgroundColor={colors.background} />
      <NavigationContainer
        theme={{
          dark: true,
          colors: {
            primary: colors.primary,
            background: colors.background,
            card: colors.surface,
            text: colors.textPrimary,
            border: colors.border,
            notification: colors.error,
          },
          fonts: {
            regular: { fontFamily: 'System', fontWeight: '400' },
            medium: { fontFamily: 'System', fontWeight: '500' },
            bold: { fontFamily: 'System', fontWeight: '700' },
            heavy: { fontFamily: 'System', fontWeight: '800' },
          },
        }}
      >
        <AppNavigator />
      </NavigationContainer>
    </SafeAreaProvider>
  );
}
