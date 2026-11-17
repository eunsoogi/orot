import { conversationMessageBodyTestID } from './conversationMessageBodyTestID';
import { View } from 'react-native';
import type { ReactNode } from 'react';
import type { EvidenceReference } from '@orot/agent-runtime';
import { AppButton } from '../layout/AppButton';
import { AppText as Text } from '../layout/AppText';
import { ConversationMessageText } from './ConversationMessageText';
import { ConversationPreviousOutputs } from './ConversationPreviousOutputs';
import { ConversationInitialResponse } from './ConversationInitialResponse';
import { ConversationMessageBubbles } from './ConversationMessageBubbles';
import { ConversationSources } from './ConversationSources';
import { ConversationToolEvents } from './ConversationToolEvents';
import { HealthSummaryCard } from './HealthSummaryCard';
import type { ResolveConversationToolSource } from './ConversationToolEventSources';
import { t } from '../i18n';
import { styles } from './ConversationScreen.styles';
import type { DisplayMessage } from './conversationDisplayMessage';
export type { DisplayMessage } from './conversationDisplayMessage';
/** Keeps transcript citations beside their answer; compact session previews may omit source links. */
export function ConversationMessage({
  message,
  onContinueCold,
  coldResumeBusy,
  onOpenSource,
  onLinkError,
  showCitations = true,
  showToolActivity = true,
  compact = false,
  toolSourceSessionId,
  resolveToolSource,
  resolveColdToolSource,
  renderVisitQuestions,
}: {
  readonly message: DisplayMessage;
  readonly onContinueCold?: (requestId: string) => void;
  readonly coldResumeBusy?: boolean;
  readonly onOpenSource: (
    reference: EvidenceReference,
    owner?: import('../aiFeatures/integration/coldConversationSourceResolvers').ColdConversationSourceOwner,
  ) => void;
  readonly onLinkError: () => void;
  readonly showCitations?: boolean;
  readonly showToolActivity?: boolean;
  readonly compact?: boolean;
  readonly toolSourceSessionId?: string | null;
  readonly resolveColdToolSource?: import('../aiFeatures/integration/coldConversationSourceResolvers').ResolveColdConversationToolSource;
  readonly resolveToolSource?: ResolveConversationToolSource;
  readonly renderVisitQuestions?: (message: DisplayMessage) => ReactNode;
}) {
  // Alias identity belongs to this answer, never to whichever run is globally current.
  const openSource = (reference: EvidenceReference) =>
    message.sourceOwner
      ? onOpenSource(reference, message.sourceOwner)
      : onOpenSource(reference);
  const user = message.role === 'user';
  const visitQuestions =
    !user && message.visitQuestions ? renderVisitQuestions?.(message) : null;
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
    <ConversationMessageBubbles
      message={message}
      presentation={{
        showCitations,
        showToolActivity,
        visitQuestions,
        canResume: Boolean(onContinueCold),
      }}
    >
      <View
        testID={
          user ? 'conversation-user-message' : 'conversation-assistant-message'
        }
        style={
          user
            ? styles.userMessage
            : [
                styles.assistantMessage,
                message.visitQuestions && styles.visitQuestionsMessage,
              ]
        }
      >
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
          testID="conversation-message-body"
          style={
            !user && [
              styles.assistantBody,
              activityBeforeText && styles.compactStreamingBody,
            ]
          }
        >
          <ConversationPreviousOutputs outputs={message.previousOutputs} />
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
          {message.incomplete &&
          message.coldResume &&
          message.toolMessageId &&
          onContinueCold ? (
            <AppButton
              title={t('conversationInterruption.resumeAction')}
              testID={`rag-conversation-cold-resume-${message.id}`}
              disabled={coldResumeBusy}
              onPress={() => onContinueCold(message.toolMessageId!)}
            />
          ) : null}
          {activityBeforeText ? activity : null}
          {/* Restored execution rows are not replayed; individual answer citations remain available. */}
          {!user && !message.restoredHistory && message.toolEvents?.length ? (
            <View
              style={!showToolActivity && styles.toolEventsHidden}
              accessibilityElementsHidden={!showToolActivity}
              importantForAccessibility={
                showToolActivity ? 'auto' : 'no-hide-descendants'
              }
            >
              <ConversationToolEvents
                key={JSON.stringify(message.sourceOwner ?? null)}
                allowSourceActions={showCitations}
                durableMessageId={message.toolMessageId}
                events={message.toolEvents}
                messageId={message.toolMessageId ?? String(message.id)}
                onLinkError={onLinkError}
                onOpenSource={openSource}
                resolveToolSource={
                  message.sourceOwner
                    ? resolveColdToolSource &&
                      ((reference, signal, scope) =>
                        resolveColdToolSource(
                          message.sourceOwner!,
                          reference,
                          signal,
                          scope,
                        ))
                    : resolveToolSource
                }
                sessionId={toolSourceSessionId}
              />
            </View>
          ) : null}
          {user && (message.photoAttached || message.submittedInput?.ocr) ? (
            <Text style={[styles.messageText, styles.userText]}>
              {t('ragConversation.photo.message')}
            </Text>
          ) : null}
          {!user &&
          message.initialResponse &&
          message.streaming &&
          message.initialResponse.source === 'receipt' ? (
            <ConversationInitialResponse
              key={message.initialResponse.callId}
              response={message.initialResponse}
            />
          ) : null}
          {message.content ? (
            <ConversationMessageText
              content={message.content}
              user={user}
              allowReport={!message.streaming && !message.incomplete}
              testID={conversationMessageBodyTestID(message)}
            />
          ) : null}
          {message.healthSummary ? (
            <HealthSummaryCard
              testIDPrefix={`rag-conversation-message-${message.id}-summary`}
              result={message.healthSummary}
              showCitations={showCitations}
              onOpenSource={openSource}
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
          {visitQuestions != null && visitQuestions !== false ? (
            <View
              style={styles.visitQuestionsRegion}
              testID="conversation-question-region"
            >
              {visitQuestions}
            </View>
          ) : null}
          {showCitations ? (
            <ConversationSources
              testIDPrefix={`rag-conversation-message-${message.id}`}
              references={message.citations ?? []}
              onOpenSource={openSource}
              onLinkError={onLinkError}
            />
          ) : null}
        </View>
      </View>
    </ConversationMessageBubbles>
  );
}
