import { ConversationBubbleActivity } from './ConversationBubbleActivity';
import { useConversationMarkdownLinkError } from './useConversationMarkdownLinkError';
import type { ConversationBubbleCopyScope } from './ConversationBubbleCopyHost';
import { conversationBubbleCopyMenus } from './conversationBubbleCopyText';
import { conversationMessageBodyTestID } from './conversationMessageBodyTestID';
import type { ReactNode } from 'react';
import { View } from 'react-native';
import { useConversationMessageEvidence } from './useConversationMessageEvidence';
import type { EvidenceReference } from '@orot/agent-runtime';
import { AppButton } from '../layout/AppButton';
import { AppText as Text } from '../layout/AppText';
import {
  ConversationMessageText,
  conversationAssistantTextFormat,
} from './ConversationMessageText';
import { ConversationSentPhoto } from './ConversationSentPhoto';
import { useOwnedColdPhotoPreview } from './ownedColdPhotoDisplay';
import { ConversationPreviousOutputs } from './ConversationPreviousOutputs';
import { ConversationInitialResponse } from './ConversationInitialResponse';
import { ConversationBubbleEntrance } from './ConversationBubbleEntrance';
import { conversationBubbleKey } from './conversationBubbleEntrances';
import {
  ConversationMessageBubbles,
  ConversationBubbleBody,
} from './ConversationMessageBubbles';
import { ConversationToolEvents } from './ConversationToolEvents';
import { ConversationDailyReportIdentity } from './ConversationMessageReceipt';
import { HealthSummaryCard } from './HealthSummaryCard';
import type { ResolveConversationToolSource } from './ConversationToolEventSources';
import { t } from '../i18n';
import { styles } from './ConversationScreen.styles';
import * as a2ui from './conversationA2UISelection';
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
  coldPhotoSessionId,
  toolSourceSessionId,
  resolveToolSource,
  resolveColdToolSource,
  renderVisitQuestions,
  verifiedA2UI,
}: {
  readonly message: DisplayMessage;
  readonly verifiedA2UI?: a2ui.VerifiedConversationA2UI;
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
  readonly coldPhotoSessionId?: number;
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
  const markdownLinkError = useConversationMarkdownLinkError(onLinkError);
  const photo = useOwnedColdPhotoPreview(message, coldPhotoSessionId);
  const user = message.role === 'user';
  const copyMenus = conversationBubbleCopyMenus(copyScope, message);
  const visitQuestions =
    !user &&
    (message.visitQuestions ||
      (message.savedHistoryDisplayOnly &&
        !message.incomplete &&
        !message.directPhotoReply &&
        message.archivedVisitBookmark))
      ? renderVisitQuestions?.(message)
      : null;
  const activity = <ConversationBubbleActivity message={message} />;
  const activityBeforeText = compact && message.streaming;
  return (
    <ConversationMessageBubbles
      message={message}
      openingCopyMenu={copyMenus?.opening}
      beforeAnswer={beforeAnswer}
      photo={photo ? <ConversationSentPhoto uri={photo} /> : undefined}
      presentation={{
        showCitations,
        showToolActivity,
        visitQuestions,
        canResume: Boolean(onContinueCold),
      }}
    >
      <ConversationBubbleEntrance
        entranceKey={conversationBubbleKey(message.role, message.id)}
        restored={message.restoredHistory || message.id <= 0}
        copyMenu={user ? copyMenus?.body : undefined}
        isolateUserCopyPaint={user}
        testID={`conversation-${message.role}-message`}
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
        <ConversationBubbleBody
          user={user}
          compactStreaming={activityBeforeText}
          copyMenu={user ? undefined : copyMenus?.body}
        >
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
              verifiedA2UI={a2ui.select(suppliedMessage, verifiedA2UI)}
              savedPossibilityNarrative={message.savedPossibilityNarrative}
              user={user}
              onLinkError={markdownLinkError}
              staticText={message.savedHistoryDisplayOnly}
              selectable={copyMenus === undefined}
              assistantFormat={conversationAssistantTextFormat(message)}
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
        </ConversationBubbleBody>
      </ConversationBubbleEntrance>
    </ConversationMessageBubbles>
  );
}
