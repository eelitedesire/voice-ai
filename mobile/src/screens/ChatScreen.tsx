/**
 * ChatScreen — Live chat with AI therapist.
 *
 * The conversation is augmented with session transcript context
 * and speaker memories. LLM inference happens server-side via Groq.
 */

import React, { useState, useRef, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  Pressable,
  FlatList,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { ChatBubble } from '../components/ChatBubble';
import { useSession } from '../hooks/useSession';
import { getSpeakerProfiles } from '../services/StorageService';
import { ChatMessage, SpeakerProfile } from '../types';
import { colors, typography, spacing, borderRadius } from '../theme';

export function ChatScreen() {
  const [inputText, setInputText] = useState('');
  const [selectedSpeaker, setSelectedSpeaker] = useState<SpeakerProfile | null>(
    null,
  );

  const { chatMessages, isChatting, sendChat } = useSession();
  const speakers = getSpeakerProfiles();
  const flatListRef = useRef<FlatList<ChatMessage>>(null);

  useEffect(() => {
    if (chatMessages.length > 0) {
      setTimeout(() => {
        flatListRef.current?.scrollToEnd({ animated: true });
      }, 100);
    }
  }, [chatMessages.length]);

  const handleSend = async () => {
    const text = inputText.trim();
    if (!text || isChatting) return;

    setInputText('');
    await sendChat(text, selectedSpeaker?.name);
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={90}
    >
      {/* Speaker selector */}
      {speakers.length > 0 && (
        <View style={styles.speakerSelector}>
          <Text style={styles.speakerLabel}>Speaking as:</Text>
          <View style={styles.speakerChips}>
            {speakers.map(s => (
              <Pressable
                key={s.id}
                style={[
                  styles.speakerChip,
                  selectedSpeaker?.id === s.id && styles.speakerChipActive,
                ]}
                onPress={() =>
                  setSelectedSpeaker(
                    selectedSpeaker?.id === s.id ? null : s,
                  )
                }
              >
                <Text
                  style={[
                    styles.speakerChipText,
                    selectedSpeaker?.id === s.id && styles.speakerChipTextActive,
                  ]}
                >
                  {s.name}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>
      )}

      {/* Messages */}
      <FlatList
        ref={flatListRef}
        data={chatMessages}
        keyExtractor={item => item.id}
        renderItem={({ item }) => <ChatBubble message={item} />}
        contentContainerStyle={styles.messageList}
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <Text style={styles.emptyTitle}>AI Therapist</Text>
            <Text style={styles.emptyText}>
              Ask questions about the session, explore emotional patterns,
              or get therapeutic guidance. Your session transcript provides
              context for the conversation.
            </Text>
          </View>
        }
      />

      {/* Typing indicator */}
      {isChatting && (
        <View style={styles.typingIndicator}>
          <Text style={styles.typingText}>AI is thinking...</Text>
        </View>
      )}

      {/* Input */}
      <View style={styles.inputContainer}>
        <TextInput
          style={styles.input}
          placeholder="Type a message..."
          placeholderTextColor={colors.textMuted}
          value={inputText}
          onChangeText={setInputText}
          multiline
          maxLength={2000}
          returnKeyType="send"
          onSubmitEditing={handleSend}
          editable={!isChatting}
        />
        <Pressable
          style={[
            styles.sendButton,
            (!inputText.trim() || isChatting) && styles.sendButtonDisabled,
          ]}
          onPress={handleSend}
          disabled={!inputText.trim() || isChatting}
        >
          <Text style={styles.sendButtonText}>Send</Text>
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  speakerSelector: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border + '40',
    gap: spacing.sm,
  },
  speakerLabel: {
    ...typography.caption,
    color: colors.textMuted,
  },
  speakerChips: {
    flexDirection: 'row',
    gap: spacing.xs,
  },
  speakerChip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: borderRadius.full,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  speakerChipActive: {
    backgroundColor: colors.primary + '20',
    borderColor: colors.primary,
  },
  speakerChipText: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  speakerChipTextActive: {
    color: colors.primary,
    fontWeight: '600',
  },
  messageList: {
    paddingVertical: spacing.md,
  },
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
    paddingTop: 100,
  },
  emptyTitle: {
    ...typography.h2,
    color: colors.textPrimary,
    marginBottom: spacing.md,
  },
  emptyText: {
    ...typography.body,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 24,
  },
  typingIndicator: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  typingText: {
    ...typography.caption,
    color: colors.textMuted,
    fontStyle: 'italic',
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    padding: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border + '40',
    backgroundColor: colors.surface,
    gap: spacing.sm,
  },
  input: {
    flex: 1,
    backgroundColor: colors.background,
    borderRadius: borderRadius.lg,
    padding: spacing.md,
    ...typography.body,
    color: colors.textPrimary,
    maxHeight: 120,
    borderWidth: 1,
    borderColor: colors.border,
  },
  sendButton: {
    backgroundColor: colors.primary,
    borderRadius: borderRadius.lg,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  sendButtonDisabled: {
    backgroundColor: colors.surfaceLight,
  },
  sendButtonText: {
    ...typography.label,
    color: colors.textPrimary,
  },
});
