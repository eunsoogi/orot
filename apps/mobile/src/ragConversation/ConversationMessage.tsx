import { View } from 'react-native';
import type { ReactNode } from 'react';
import type { EvidenceReference } from '@orot/agent-runtime';
import { AppText as Text } from '../layout/AppText';
import { AiResponseText } from '../layout/AiResponseText';
import { ConversationSources } from './ConversationSources';
import { ConversationToolEvents } from './ConversationToolEvents';
import { HealthSummaryCard } from './HealthSummaryCard';
import type { ResolveConversationToolSource } from './ConversationToolEventSources';
import { t } from '../i18n';
import { styles } from './ConversationScreen.styles';
import type { RagConversationMessage } from './task';

export interface DisplayMessage extends RagConversationMessage {
  readonly submittedInput?: import('./conversationSubmittedInput').ConversationSubmittedInput;
  readonly photoAttached?: boolean;
  readonly id: number;
  readonly dailyReport?: NonNullable<
    import('../aiFeatures/integration/conversationIntent').ConversationEntryContext['dailyReport']
  >;
  readonly citations?: readonly EvidenceReference[];
  readonly healthSources?: import('./conversationHealthDeletion').HealthSourceDependencies;
  readonly activity?: string;
  readonly streaming?: boolean;
  readonly incomplete?: boolean;
  readonly completion?: 'complete' | 'partial';
  readonly toolMessageId?: string;
  /** Only committed turns may be used as durable conversation history. */
  readonly retainedTurnId?: string;
  readonly toolEvents?: readonly import('@orot/agent-runtime').ConversationToolEvent[];
  readonly healthSummary?: import('./healthSummary').HealthSummaryResult | null;
  readonly retryHealthSummary?: () => Promise<
    import('./healthSummary').HealthSummaryResult | null
  >;
  readonly visitQuestions?: import('./conversationVisitQuestions').ConversationVisitQuestions;
  readonly visitQuestionsUnavailable?: boolean;
  /** Failed prompts stay visible when the user has already drafted a different question. */
  readonly failed?: boolean;
}

/** Keeps transcript citations beside their answer; compact session previews may omit source links. */
export function ConversationMessage({
  message,
  onOpenSource,
  onLinkError,
  showCitations = true,
  compact = false,
  toolSourceSessionId,
  resolveToolSource,
  renderVisitQuestions,
}: {
  readonly message: DisplayMessage;
  readonly onOpenSource: (reference: EvidenceReference) => void;
  readonly onLinkError: () => void;
  readonly showCitations?: boolean;
  readonly compact?: boolean;
  readonly toolSourceSessionId?: string | null;
  readonly resolveToolSource?: ResolveConversationToolSource;
  readonly renderVisitQuestions?: (message: DisplayMessage) => ReactNode;
}) {
  const user = message.role === 'user';
  const MessageText = user ? Text : AiResponseText;
  // Native production verification needs a stable target for completed text, apart from citation controls.
  const messageTextTestID = message.streaming
    ? 'rag-conversation-stream'
    : user
      ? undefined
      : message.incomplete
        ? 'rag-conversation-incomplete-body'
        : 'rag-conversation-answer-body';
  const activity = message.activity ? (
    <Text
      accessibilityLiveRegion={message.streaming ? 'none' : 'polite'}
      style={styles.activity}
      testID={
        message.streaming
          ? 'rag-conversation-progress'
          : message.incomplete
            ? 'rag-conversation-incomplete-activity'
            : undefined
      }
    >
      {message.activity}
    </Text>
  ) : null;
  // Keep the last streamed line at the end of a short reading viewport.
  const activityBeforeText = compact && message.streaming;
  return (
    <View style={user ? styles.userMessage : styles.assistantMessage}>
      {!user && message.dailyReport ? (
        <Text>
          {t('dailyReport.followUpIdentity', {
            date: message.dailyReport.identity.localDate,
            zone: message.dailyReport.identity.timeZone,
          })}{' '}
          ·{' '}
          {t('dailyReport.savedRevision', {
            revision: message.dailyReport.revision,
          })}
        </Text>
      ) : null}
      <View
        style={
          !user && [
            styles.assistantBody,
            activityBeforeText && styles.compactStreamingBody,
          ]
        }
      >
        {message.incomplete && message.content ? (
          <>
            <Text style={styles.activity}>
              {t('aiActivity.draft.incompleteHeading')}
            </Text>
            <Text style={styles.activity}>
              {t('aiActivity.draft.incompleteNote')}
            </Text>
          </>
        ) : null}
        {message.completion === 'partial' ? (
          <Text style={styles.activity}>
            {t('ragConversation.savedPartial')}
          </Text>
        ) : null}
        {activityBeforeText ? activity : null}
        {!user && message.toolEvents?.length ? (
          <ConversationToolEvents
            allowSourceActions={showCitations}
            durableMessageId={message.toolMessageId}
            events={message.toolEvents}
            messageId={message.toolMessageId ?? String(message.id)}
            onLinkError={onLinkError}
            onOpenSource={onOpenSource}
            resolveToolSource={resolveToolSource}
            sessionId={toolSourceSessionId}
          />
        ) : null}
        {user && (message.photoAttached || message.submittedInput?.ocr) ? (
          <Text style={[styles.messageText, styles.userText]}>
            {t('ragConversation.photo.message')}
          </Text>
        ) : null}
        {message.content ? (
          <MessageText
            selectable
            style={[styles.messageText, user && styles.userText]}
            testID={messageTextTestID}
          >
            {message.content}
          </MessageText>
        ) : null}
        {message.healthSummary ? (
          <HealthSummaryCard
            result={message.healthSummary}
            showCitations={showCitations}
            onOpenSource={onOpenSource}
            onLinkError={onLinkError}
            onRetry={
              message.retryHealthSummary
                ? () => {
                    message.retryHealthSummary?.().catch(onLinkError);
                  }
                : undefined
            }
          />
        ) : message.healthSummary === null ? (
          <Text>
            {t('ragConversation.conversation.savedSummaryUnavailable')}
          </Text>
        ) : null}
        {!activityBeforeText ? activity : null}
        {message.visitQuestionsUnavailable ? (
          <Text accessibilityRole="alert" style={styles.activity}>
            {t('ragConversation.conversation.savedVisitQuestionsUnavailable')}
          </Text>
        ) : null}
        {!user && message.visitQuestions
          ? renderVisitQuestions?.(message)
          : null}
        {showCitations ? (
          <ConversationSources
            references={message.citations ?? []}
            onOpenSource={onOpenSource}
            onLinkError={onLinkError}
          />
        ) : null}
      </View>
    </View>
  );
}
