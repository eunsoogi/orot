import { AppButton as Button } from '../layout/AppButton';
import { AppText as Text } from '../layout/AppText';
import { useEffect, useRef, useState } from 'react';
import type { ReactNode, ComponentRef } from 'react';
import { ConversationComposer } from './ConversationComposer';
import { styles } from './ConversationScreen.styles';
import { ConversationMessage } from './ConversationMessage';
import type { DisplayMessage } from './ConversationMessage';
import { ScrollView, KeyboardAvoidingView, Platform, View } from 'react-native';
import { navigationText } from '../i18n/navigation';
import type { EvidenceReference } from '@orot/agent-runtime';
import { getRagConversationCopy } from './copy';
import type { RagConversationMessage } from './task';
import type { RagConversationOutcome } from './service';
import type { AiFeatureNavigationStateChange } from '../aiFeatures/integration/useAiFeatureNavigationState';
import { useAiFeatureScreenNavigationState } from '../aiFeatures/integration/useAiFeatureNavigationState';

interface ConversationScreenProps {
  readonly providerSelection?: ReactNode;
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
  providerSelection,
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
  const historyView = useRef<ComponentRef<typeof ScrollView>>(null);

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
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={styles.screen}
      testID="rag-conversation-screen"
    >
      <View style={styles.header}>
        {!navigationRouteKey && (
          <Button
            accessibilityLabel={navigationText.back.accessibilityLabel}
            onPress={onBack}
            title={navigationText.back.label}
          />
        )}
        <Text accessibilityRole="header" style={styles.heading}>
          {copy.title}
        </Text>
        <Text style={styles.description}>{copy.description}</Text>
        {providerSelection ? (
          <View style={styles.provider}>{providerSelection}</View>
        ) : null}
      </View>
      <ScrollView
        ref={historyView}
        style={styles.history}
        contentContainerStyle={styles.container}
        keyboardShouldPersistTaps="handled"
        onContentSizeChange={() =>
          historyView.current?.scrollToEnd({ animated: true })
        }
        testID="rag-conversation-history"
      >
        {!messages.length && (
          <View style={styles.empty}>
            <Text style={styles.disclaimer}>
              질문을 보내면 관련 기록과 원문 근거를 함께 찾아요.
            </Text>
            <Text style={styles.disclaimer}>
              필요하면 동의를 받고 공개 의학 문헌도 찾아요.
            </Text>
          </View>
        )}
        {messages.map(message => (
          <ConversationMessage
            key={message.id}
            message={message}
            onOpenSource={onOpenSource}
            onLinkError={() =>
              setError('문헌 링크를 열지 못했어요. 다시 시도해 주세요.')
            }
          />
        ))}
        {busy && (
          <Text
            accessibilityLiveRegion="polite"
            testID="rag-conversation-loading"
          >
            {copy.loading}
          </Text>
        )}
        {error ? (
          <Text accessibilityRole="alert" style={styles.error}>
            {error}
          </Text>
        ) : null}
      </ScrollView>
      <ConversationComposer
        value={draft}
        busy={busy}
        onChangeText={value => {
          inputRevision.current += 1;
          setDraft(value);
        }}
        onSend={() => {
          send().catch(() => setError(copy.unavailable));
        }}
        onCancel={() => {
          operationController.current?.abort();
          operationController.current = null;
          setBusy(false);
        }}
      />
    </KeyboardAvoidingView>
  );
}
