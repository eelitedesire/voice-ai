/**
 * AppNavigator — Root navigation structure.
 *
 * Uses a bottom tab navigator for main sections and a stack for drill-down screens.
 */

import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { View, Text, StyleSheet } from 'react-native';

import { HomeScreen } from '../screens/HomeScreen';
import { SessionScreen } from '../screens/SessionScreen';
import { EnrollmentScreen } from '../screens/EnrollmentScreen';
import { ChatScreen } from '../screens/ChatScreen';
import { AnalysisScreen } from '../screens/AnalysisScreen';
import { HistoryScreen } from '../screens/HistoryScreen';
import { SettingsScreen } from '../screens/SettingsScreen';
import { colors, typography } from '../theme';

export type RootStackParamList = {
  MainTabs: undefined;
  Session: undefined;
  Chat: undefined;
  Analysis: { sessionId: string };
  Enrollment: undefined;
};

export type TabParamList = {
  Home: undefined;
  History: undefined;
  Record: undefined;
  Settings: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();
const Tab = createBottomTabNavigator<TabParamList>();

function TabIcon({ label, focused }: { label: string; focused: boolean }) {
  return (
    <Text
      style={[
        styles.tabIcon,
        { color: focused ? colors.primary : colors.textMuted },
      ]}
    >
      {label}
    </Text>
  );
}

function MainTabs() {
  return (
    <Tab.Navigator
      screenOptions={{
        headerStyle: { backgroundColor: colors.background },
        headerTintColor: colors.textPrimary,
        headerTitleStyle: typography.h3,
        tabBarStyle: {
          backgroundColor: colors.surface,
          borderTopColor: colors.border + '40',
          height: 85,
          paddingBottom: 20,
          paddingTop: 8,
        },
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textMuted,
        tabBarLabelStyle: { ...typography.caption, marginTop: 2 },
      }}
    >
      <Tab.Screen
        name="Home"
        component={HomeScreen}
        options={{
          title: 'Voice AI',
          tabBarIcon: ({ focused }) => <TabIcon label="[H]" focused={focused} />,
        }}
      />
      <Tab.Screen
        name="Record"
        component={SessionScreen}
        options={{
          title: 'Session',
          tabBarIcon: ({ focused }) => <TabIcon label="[R]" focused={focused} />,
        }}
      />
      <Tab.Screen
        name="History"
        component={HistoryScreen}
        options={{
          title: 'History',
          tabBarIcon: ({ focused }) => <TabIcon label="[L]" focused={focused} />,
        }}
      />
      <Tab.Screen
        name="Settings"
        component={SettingsScreen}
        options={{
          title: 'Settings',
          tabBarIcon: ({ focused }) => <TabIcon label="[S]" focused={focused} />,
        }}
      />
    </Tab.Navigator>
  );
}

export function AppNavigator() {
  return (
    <Stack.Navigator
      screenOptions={{
        headerStyle: { backgroundColor: colors.background },
        headerTintColor: colors.textPrimary,
        headerTitleStyle: typography.h3,
        contentStyle: { backgroundColor: colors.background },
        animation: 'slide_from_right',
      }}
    >
      <Stack.Screen
        name="MainTabs"
        component={MainTabs}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="Session"
        component={SessionScreen}
        options={{ title: 'Recording Session' }}
      />
      <Stack.Screen
        name="Chat"
        component={ChatScreen}
        options={{ title: 'AI Therapist' }}
      />
      <Stack.Screen
        name="Analysis"
        component={AnalysisScreen}
        options={{ title: 'Session Analysis' }}
      />
      <Stack.Screen
        name="Enrollment"
        component={EnrollmentScreen}
        options={{ title: 'Speaker Enrollment' }}
      />
    </Stack.Navigator>
  );
}

const styles = StyleSheet.create({
  tabIcon: {
    fontSize: 18,
    fontWeight: '600',
  },
});
