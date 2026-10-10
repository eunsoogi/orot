import { AppButton as Button } from '../layout/AppButton';
import { AppText as Text } from '../layout/AppText';
import { useEffect, useRef, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { navigationText } from '../i18n/navigation';
import { appColors } from '../layout/appColors';
import type { EvidenceReference } from '@orot/agent-runtime';
import { getRagConversationCopy } from './copy';
import type { RagConversationMessage } from './task';
import type { RagConversationOutcome } from './service';
import type { AiFeatureNavigationStateChange } from '../aiFeatures/integration/useAiFeatureNavigationState';
import { useAiFeatureScreenNavigationState } from '../aiFeatures/integration/useAiFeatureNavigationState';

interface DisplayMessage extends RagConversationMessage {
  readonly id: number;
  readonly citations?: readonly EvidenceReference[];
}

interface ConversationScreenProps {
  readonly navigationRouteKey?: string;
  readonly onNavigationStateChange?: AiFeatureNavigationStateChange;
  readonly onBack: () => void;
  readonly onSend: (
    question: string,
    previousMessages: readonly RagConversationMessage[],
    signal?: AbortSignal,
  ) => Promise<RagConversationOutcome>;
  readonly onOpenSource: (reference: EvidenceReference) => void;
}

/** Keeps chat history in view state only; evidence is freshly loaded by the injected turn service. */
export function ConversationScreen({
  navigationRouteKey,
  onNavigationStateChange,
  onBack,
  onSend,
  onOpenSource,
}: ConversationScreenProps) {
  const copy = getRagConversationCopy();
  const [draft, setDraft] = useState('');
  const [messages, setMessages] = useState<readonly DisplayMessage[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const nextMessageId = useRef(0);
  const operationController = useRef<AbortController | null>(null);
  const inputRevision = useRef(0);

  useAiFeatureScreenNavigationState(
    navigationRouteKey,
    {
      hasUnsavedChanges: draft.length > 0 || messages.length > 0,
      isRecording: false,
      // The unmount cleanup below aborts the current request after confirmation.
      hasOngoingOperation: busy,
    },
    inputRevision.current,
    onNavigationStateChange,
  );

  useEffect(
    () => () => {
      operationController.current?.abort();
      operationController.current = null;
    },
    [],
  );

  async function send() {
    const question = draft.trim();
    if (!question || busy) return;
    const history = messages.map(({ role, content }) => ({ role, content }));
    const userMessage = {
      id: ++nextMessageId.current,
      role: 'user' as const,
      content: question,
    };
    inputRevision.current += 1;
    setMessages(current => [...current, userMessage]);
    setDraft('');
    const controller = new AbortController();
    operationController.current = controller;
    setBusy(true);
    setError('');
    try {
      const outcome = await onSend(question, history, controller.signal);
      if (controller.signal.aborted) return;
      const assistantContent =
        outcome.status === 'answer'
          ? outcome.answer
          : outcome.status === 'no_evidence'
            ? copy.noEvidence
            : outcome.status === 'insufficient'
              ? copy.insufficient
              : copy.unavailable;
      inputRevision.current += 1;
      setMessages(current => [
        ...current,
        {
          id: ++nextMessageId.current,
          role: 'assistant',
          content: assistantContent,
          ...(outcome.status === 'answer'
            ? { citations: outcome.citations }
            : {}),
        },
      ]);
    } catch {
      if (!controller.signal.aborted) setError(copy.unavailable);
    } finally {
      if (operationController.current === controller) {
        operationController.current = null;
        setBusy(false);
      }
    }
  }

  return (
    <ScrollView
      contentContainerStyle={styles.container}
      testID="rag-conversation-screen"
    >
      {navigationRouteKey ? null : (
        <Button
          accessibilityLabel={navigationText.back.accessibilityLabel}
          onPress={onBack}
          title={navigationText.back.label}
        />
      )}
      <Text accessibilityRole="header" style={styles.heading}>
        {copy.title}
      </Text>
      <Text>{copy.description}</Text>
      {messages.map(message => (
        <View key={message.id} style={styles.message}>
          <Text style={styles.role}>
            {message.role === 'user' ? copy.speakerUser : '오롯'}
          </Text>
          <Text>{message.content}</Text>
          {message.citations?.map(reference => (
            <Pressable
              key={`${reference.sourceId}:${reference.evidenceId}:${reference.evidenceRevision}`}
              accessibilityRole="button"
              onPress={() => onOpenSource(reference)}
            >
              <Text style={styles.source}>
                {copy.source(reference.sourceId)}
              </Text>
            </Pressable>
          ))}
        </View>
      ))}
      {busy ? (
        <Text testID="rag-conversation-loading">{copy.loading}</Text>
      ) : null}
      {error ? (
        <Text accessibilityRole="alert" style={styles.error}>
          {error}
        </Text>
      ) : null}
      <TextInput
        accessibilityLabel={copy.placeholder}
        editable={!busy}
        maxLength={1000}
        onChangeText={value => {
          inputRevision.current += 1;
          setDraft(value);
        }}
        placeholder={copy.placeholder}
        placeholderTextColor={appColors.secondary}
        style={styles.input}
        testID="rag-conversation-input"
        value={draft}
      />
      <Button
        disabled={busy || !draft.trim()}
        onPress={() => {
          send().catch(() => setError(copy.unavailable));
        }}
        testID="rag-conversation-send"
        title={copy.send}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { gap: 12, padding: 20 },
  heading: { fontSize: 22, fontWeight: '700' },
  input: {
    backgroundColor: appColors.surface,
    borderColor: appColors.border,
    borderRadius: 12,
    borderWidth: 1,
    color: appColors.text,
    minHeight: 48,
    paddingHorizontal: 12,
  },
  message: {
    borderColor: appColors.border,
    borderRadius: 12,
    borderWidth: 1,
    gap: 6,
    padding: 12,
  },
  role: { fontWeight: '700' },
  error: { color: appColors.danger },
  source: {
    color: appColors.primaryText,
    fontWeight: '700',
    paddingVertical: 4,
  },
});
