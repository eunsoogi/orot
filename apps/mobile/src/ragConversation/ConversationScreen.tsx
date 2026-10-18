import { AppButton as Button } from '../layout/AppButton';
import { AppText as Text } from '../layout/AppText';
import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { ConversationComposer } from './ConversationComposer';
import { styles } from './ConversationScreen.styles';
import type { DisplayMessage } from './ConversationMessage';
import { KeyboardAvoidingView, Platform, View } from 'react-native';
import { ConversationHistory } from './ConversationHistory';
import { navigationText } from '../i18n/navigation';
import type { EvidenceReference } from '@orot/agent-runtime';
import { getRagConversationCopy } from './copy';
import type { RagConversationMessage } from './task';
import type { RagConversationOutcome } from './service';
import type { RagConversationObserver } from './service';
import { progressCopy } from './conversationProgress';
import { applyWorkflowStreamEvent } from '../agent/workflowActivity';
import type { AiFeatureNavigationStateChange } from '../aiFeatures/integration/useAiFeatureNavigationState';
import { useAiFeatureScreenNavigationState } from '../aiFeatures/integration/useAiFeatureNavigationState';
import { useAiCancellationAction } from '../agent/useAiCancellationAction';

interface ConversationScreenProps {
  readonly providerSelection?: ReactNode;
  readonly navigationRouteKey?: string;
  readonly onNavigationStateChange?: AiFeatureNavigationStateChange;
  readonly onBack: () => void;
  readonly onSend: (
    question: string,
    previousMessages: readonly RagConversationMessage[],
    signal?: AbortSignal,
    observer?: RagConversationObserver,
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
  const [pendingMessage, setPendingMessage] = useState<{
    content: string;
    activity: string;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const nextMessageId = useRef(0);
  const operationController = useRef<AbortController | null>(null);
  const inputRevision = useRef(0);
  const partialText = useRef('');
  function cancel() {
    operationController.current?.abort();
    operationController.current = null;
    setBusy(false);
    retainPartial(copy.progressCancelled, true);
  }
  const hasSharedCancel = useAiCancellationAction(
    busy,
    cancel,
    'rag-conversation-cancel',
  );

  // Incomplete text stays visible but is excluded from future model context.
  function retainPartial(activity: string, retainEmpty = false) {
    const content = partialText.current;
    partialText.current = '';
    setPendingMessage(null);
    if (!content && !retainEmpty) return;
    const message: DisplayMessage = {
      id: ++nextMessageId.current,
      role: 'assistant',
      content,
      activity,
      incomplete: true,
    };
    setMessages(current => [...current, message]);
  }

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
    const history = messages
      .filter(message => !message.incomplete)
      .map(({ role, content }) => ({ role, content }));
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
    partialText.current = '';
    setPendingMessage({ content: '', activity: copy.loading });
    const isCurrentRun = () =>
      operationController.current === controller && !controller.signal.aborted;
    try {
      const observer: RagConversationObserver = {
        onProgress: event => {
          if (!isCurrentRun()) return;
          setPendingMessage(current =>
            current
              ? { ...current, activity: progressCopy(event, copy) }
              : current,
          );
        },
        onTaskStreamEvent: event => {
          if (!isCurrentRun()) return;
          partialText.current = applyWorkflowStreamEvent(
            partialText.current,
            event,
          );
          setPendingMessage({
            content: partialText.current,
            activity: copy.progressAnswer,
          });
        },
      };
      const outcome = await onSend(
        question,
        history,
        controller.signal,
        observer,
      );
      if (!isCurrentRun()) return;
      if (outcome.status !== 'answer') retainPartial(copy.unavailable);
      else setPendingMessage(null);
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
      if (isCurrentRun()) {
        retainPartial(copy.unavailable);
        setError(copy.unavailable);
      }
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
      <ConversationHistory
        messages={messages}
        pendingMessage={pendingMessage}
        error={error}
        onOpenSource={onOpenSource}
        onLinkError={() =>
          setError('문헌 링크를 열지 못했어요. 다시 시도해 주세요.')
        }
      />
      <ConversationComposer
        value={draft}
        busy={busy}
        hasSharedCancel={hasSharedCancel}
        onChangeText={value => {
          inputRevision.current += 1;
          setDraft(value);
        }}
        onSend={() => {
          send().catch(() => setError(copy.unavailable));
        }}
        onCancel={cancel}
      />
    </KeyboardAvoidingView>
  );
}
