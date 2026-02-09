/**
 * SettingsScreen — App configuration: server URL, processing mode, model management.
 */

import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  ScrollView,
  Pressable,
  Switch,
  Alert,
} from 'react-native';
import {
  getSettings,
  saveSettings,
  clearAllData,
} from '../services/StorageService';
import { useOnDeviceModels } from '../hooks/useOnDeviceModels';
import { ProcessingMode, AppSettings } from '../types';
import { colors, typography, spacing, borderRadius, shadows } from '../theme';

export function SettingsScreen() {
  const [settings, setSettings] = useState<AppSettings>(getSettings);
  const { status: modelStatus, checkModels } = useOnDeviceModels('/var/mobile');

  const updateSetting = <K extends keyof AppSettings>(
    key: K,
    value: AppSettings[K],
  ) => {
    const updated = { ...settings, [key]: value };
    setSettings(updated);
    saveSettings({ [key]: value });
  };

  const processingModes: { mode: ProcessingMode; label: string; desc: string }[] = [
    {
      mode: 'on-device',
      label: 'On-Device',
      desc: 'All audio processing happens locally. No data leaves your phone. Requires downloaded models.',
    },
    {
      mode: 'hybrid',
      label: 'Hybrid',
      desc: 'Speech recognition on-device, analysis and chat via server. Best balance of privacy and features.',
    },
    {
      mode: 'server',
      label: 'Server',
      desc: 'Stream audio to server for processing. Requires network connection. Full feature set.',
    },
  ];

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
    >
      {/* Processing Mode */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Processing Mode</Text>
        {processingModes.map(({ mode, label, desc }) => (
          <Pressable
            key={mode}
            style={[
              styles.modeCard,
              settings.processingMode === mode && styles.modeCardActive,
            ]}
            onPress={() => updateSetting('processingMode', mode)}
          >
            <View style={styles.modeHeader}>
              <View
                style={[
                  styles.radio,
                  settings.processingMode === mode && styles.radioActive,
                ]}
              >
                {settings.processingMode === mode && (
                  <View style={styles.radioDot} />
                )}
              </View>
              <Text
                style={[
                  styles.modeLabel,
                  settings.processingMode === mode && styles.modeLabelActive,
                ]}
              >
                {label}
              </Text>
            </View>
            <Text style={styles.modeDesc}>{desc}</Text>
          </Pressable>
        ))}
      </View>

      {/* Server URL */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Server Connection</Text>
        <Text style={styles.fieldLabel}>Server URL</Text>
        <TextInput
          style={styles.input}
          value={settings.serverUrl}
          onChangeText={v => updateSetting('serverUrl', v)}
          placeholder="http://localhost:3000"
          placeholderTextColor={colors.textMuted}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
        />
      </View>

      {/* On-Device Models */}
      {settings.processingMode !== 'server' && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>On-Device Models</Text>
          <View style={styles.modelList}>
            <ModelRow label="ASR (Zipformer)" status={modelStatus.asr} />
            <ModelRow label="VAD (Silero v5)" status={modelStatus.vad} />
            <ModelRow label="Speaker (WeSpeaker)" status={modelStatus.speaker} />
          </View>
          <Pressable style={styles.downloadButton} onPress={checkModels}>
            <Text style={styles.downloadButtonText}>Check Models</Text>
          </Pressable>
        </View>
      )}

      {/* Audio Settings */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Audio</Text>
        <SettingRow
          label="Voice Activity Detection"
          value={settings.enableVAD}
          onToggle={v => updateSetting('enableVAD', v)}
        />
        <SettingRow
          label="Speaker Identification"
          value={settings.enableSpeakerIdentification}
          onToggle={v => updateSetting('enableSpeakerIdentification', v)}
        />
        <SettingRow
          label="Keep Screen Awake"
          value={settings.keepScreenAwake}
          onToggle={v => updateSetting('keepScreenAwake', v)}
        />
        <SettingRow
          label="Haptic Feedback"
          value={settings.hapticFeedback}
          onToggle={v => updateSetting('hapticFeedback', v)}
        />
      </View>

      {/* Danger Zone */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Data</Text>
        <Pressable
          style={styles.dangerButton}
          onPress={() => {
            Alert.alert(
              'Clear All Data',
              'This will delete all sessions, speaker profiles, and settings. This cannot be undone.',
              [
                { text: 'Cancel', style: 'cancel' },
                {
                  text: 'Clear',
                  style: 'destructive',
                  onPress: () => {
                    clearAllData();
                    setSettings(getSettings());
                    Alert.alert('Done', 'All data has been cleared.');
                  },
                },
              ],
            );
          }}
        >
          <Text style={styles.dangerButtonText}>Clear All Data</Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}

function ModelRow({ label, status }: { label: string; status: string }) {
  const color =
    status === 'ready'
      ? colors.success
      : status === 'downloading'
      ? colors.warning
      : colors.textMuted;

  return (
    <View style={styles.modelRow}>
      <Text style={styles.modelLabel}>{label}</Text>
      <View style={styles.modelStatus}>
        <View style={[styles.modelDot, { backgroundColor: color }]} />
        <Text style={[styles.modelStatusText, { color }]}>
          {status === 'ready' ? 'Ready' : status === 'downloading' ? 'Downloading' : 'Missing'}
        </Text>
      </View>
    </View>
  );
}

function SettingRow({
  label,
  value,
  onToggle,
}: {
  label: string;
  value: boolean;
  onToggle: (v: boolean) => void;
}) {
  return (
    <View style={styles.settingRow}>
      <Text style={styles.settingLabel}>{label}</Text>
      <Switch
        value={value}
        onValueChange={onToggle}
        trackColor={{ false: colors.surfaceLight, true: colors.primary + '60' }}
        thumbColor={value ? colors.primary : colors.textMuted}
      />
    </View>
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
  section: {
    marginBottom: spacing.xl,
  },
  sectionTitle: {
    ...typography.label,
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: spacing.md,
  },
  modeCard: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border + '40',
  },
  modeCardActive: {
    borderColor: colors.primary,
    backgroundColor: colors.primary + '10',
  },
  modeHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.xs,
  },
  radio: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioActive: {
    borderColor: colors.primary,
  },
  radioDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: colors.primary,
  },
  modeLabel: {
    ...typography.body,
    color: colors.textPrimary,
    fontWeight: '600',
  },
  modeLabelActive: {
    color: colors.primary,
  },
  modeDesc: {
    ...typography.caption,
    color: colors.textSecondary,
    marginLeft: 28,
    lineHeight: 18,
  },
  fieldLabel: {
    ...typography.bodySmall,
    color: colors.textSecondary,
    marginBottom: spacing.xs,
  },
  input: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    ...typography.body,
    color: colors.textPrimary,
    borderWidth: 1,
    borderColor: colors.border,
  },
  modelList: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.md,
    overflow: 'hidden',
  },
  modelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border + '40',
  },
  modelLabel: {
    ...typography.bodySmall,
    color: colors.textPrimary,
  },
  modelStatus: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  modelDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  modelStatusText: {
    ...typography.caption,
  },
  downloadButton: {
    backgroundColor: colors.primary,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    alignItems: 'center',
    marginTop: spacing.md,
  },
  downloadButtonText: {
    ...typography.label,
    color: colors.textPrimary,
  },
  settingRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  settingLabel: {
    ...typography.body,
    color: colors.textPrimary,
  },
  dangerButton: {
    backgroundColor: colors.error + '20',
    borderRadius: borderRadius.md,
    padding: spacing.md,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.error,
  },
  dangerButtonText: {
    ...typography.label,
    color: colors.error,
  },
});
