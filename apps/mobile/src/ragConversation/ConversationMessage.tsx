import type { ConversationBubbleCopyScope } from './ConversationBubbleCopyHost';
import { conversationBubbleCopyMenus } from './conversationBubbleCopyText';
import { conversationMessageBodyTestID } from './conversationMessageBodyTestID';
import type { ReactNode } from 'react';
import { View } from 'react-native';
import { useConversationMessageEvidence } from './useConversationMessageEvidence';
import type { EvidenceReference } from '@orot/agent-runtime';
import { AppButton } from '../layout/AppButton';
import { AppText as Text } from '../layout/AppText';
import { ConversationMessageText } from './ConversationMessageText';
import { ConversationPreviousOutputs } from './ConversationPreviousOutputs';
import { ConversationInitialResponse } from './ConversationInitialResponse';
import { ConversationBubbleEntrance } from './ConversationBubbleEntrance';
import { conversationBubbleKey } from './conversationBubbleEntrances';
import { ConversationMessageBubbles } from './ConversationMessageBubbles';
import { ConversationToolEvents } from './ConversationToolEvents';
import { ConversationDailyReportIdentity } from './ConversationMessageReceipt';
import { HealthSummaryCard } from './HealthSummaryCard';
import type { ResolveConversationToolSource } from './ConversationToolEventSources';
import { t } from '../i18n';
import { styles } from './ConversationScreen.styles';
import type { DisplayMessage } from './conversationDisplayMessage';
export type { DisplayMessage } from './conversationDisplayMessage';
export function ConversationMessage({
  message: suppliedMessage,
  beforeAnswer,
  onContinueCold,
  coldResumeBusy,
  onOpenSource,
  onLinkError,
  showCitations = true,
  showToolActivity = true,
  compact = false,
  copyScope,
  toolSourceSessionId,
  resolveToolSource,
  resolveColdToolSource,
  renderVisitQuestions,
}: {
  readonly message: DisplayMessage;
  readonly beforeAnswer?: ReactNode;
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
  readonly copyScope?: ConversationBubbleCopyScope;
  readonly toolSourceSessionId?: string | null;
  readonly resolveColdToolSource?: import('../aiFeatures/integration/coldConversationSourceResolvers').ResolveColdConversationToolSource;
  readonly resolveToolSource?: ResolveConversationToolSource;
  readonly renderVisitQuestions?: (message: DisplayMessage) => ReactNode;
}) {
  const { message, openSource, citations, openArchivedSummary } =
    useConversationMessageEvidence({
      suppliedMessage,
      showCitations,
      onOpenSource,
      onLinkError,
    });
  const user = message.role === 'user';
  const copyMenus = conversationBubbleCopyMenus(copyScope, message);
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
  const activityBeforeText = compact && message.streaming;
  const bodyStyle = user
    ? styles.userMessageBody
    : [styles.assistantBody, activityBeforeText && styles.compactStreamingBody];
  return (
    <ConversationMessageBubbles
      message={message}
      openingCopyMenu={copyMenus?.opening}
      beforeAnswer={beforeAnswer}
      presentation={{
        showCitations,
        showToolActivity,
        visitQuestions,
        canResume: Boolean(onContinueCold),
      }}
    >
      <ConversationBubbleEntrance
        entranceKey={conversationBubbleKey(
          user ? 'user' : 'assistant',
          message.id,
        )}
        restored={message.restoredHistory || message.id <= 0}
        copyMenu={copyMenus?.body}
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
          <ConversationDailyReportIdentity report={message.dailyReport} />
        ) : null}
        <View testID="conversation-message-body" style={bodyStyle}>
          <ConversationPreviousOutputs
            outputs={beforeAnswer ? undefined : message.previousOutputs}
          />
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
          message.streaming &&
          message.initialResponse?.source === 'receipt' ? (
            <ConversationInitialResponse
              key={message.initialResponse.callId}
              response={message.initialResponse}
            />
          ) : null}
          {message.content ? (
            <ConversationMessageText
              content={message.content}
              user={user}
              staticText={message.savedHistoryDisplayOnly}
              selectable={copyMenus === undefined}
              allowReport={
                !(message.directPhotoReply || message.streaming) &&
                !message.incomplete &&
                !message.historyUnavailable
              }
              testID={conversationMessageBodyTestID(message)}
            />
          ) : null}
          {message.healthSummary ? (
            <HealthSummaryCard
              testIDPrefix={`rag-conversation-message-${message.id}-summary`}
              result={message.healthSummary}
              openArchivedCitation={openArchivedSummary}
              showCitations={showCitations}
              onOpenSource={openSource}
              onLinkError={onLinkError}
              onRetry={
                message.retryHealthSummary
                  ? () => message.retryHealthSummary?.().catch(onLinkError)
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
          {citations}
        </View>
      </ConversationBubbleEntrance>
    </ConversationMessageBubbles>
  );
}
