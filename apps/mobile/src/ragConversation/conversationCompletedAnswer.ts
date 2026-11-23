import type { RagConversationOutcome } from './outcome';
import type { ConversationSession } from './conversationSessionTypes';
import type { createConversationTurnActivity } from './conversationTurnActivity';
import { healthSummaryRetry } from './healthSummaryRetry';
import { answerUsesDeletedHealthEvidence } from './conversationHealthDeletion';
import { restoreFailedPrompt } from './conversationFailedPrompt';
import { getRagConversationFailureCopy } from './copy';
import { t } from '../i18n';

/** Attach a validated answer and keep each summary retry bound to its own message. */
export function conversationCompletedAnswer(input: {
  id: number;
  messageId: number;
  userMessageId: number;
  restorePromptToComposer: boolean;
  retainedTurnId?: string;
  retentionUnavailable?: boolean;
  dailyReport?: ConversationSession['dailyReport'];
  copy: { noEvidence: string; insufficient: string };
  outcome: Exclude<
    RagConversationOutcome,
    { status: 'failure' | 'unavailable' }
  >;
  activity: ReturnType<typeof createConversationTurnActivity>;
  find: (id: number) => ConversationSession;
  update: (id: number, change: Partial<ConversationSession>) => void;
}) {
  const { id, messageId, outcome, activity, find, update } = input;
  const session = find(id);
  if (
    session.pendingMessage?.withholdHealthBody &&
    outcome.status === 'answer' &&
    answerUsesDeletedHealthEvidence(
      outcome,
      session.pendingMessage.deletedHealthIds,
    )
  ) {
    const prompt = session.messages.find(
      item => item.id === input.userMessageId,
    );
    if (prompt)
      restoreFailedPrompt(
        find,
        update,
        id,
        prompt.content,
        prompt.id,
        getRagConversationFailureCopy('stale_evidence'),
        false,
        input.restorePromptToComposer,
      );
    return;
  }
  const clarification =
    outcome.status === 'insufficient' && outcome.guidance === 'visit_goal';
  if (clarification && input.retentionUnavailable) {
    // A save rejection cannot publish new local copy. Keep only the opening
    // already shown for this owner; never echo pending provider text or receipts.
    const { pendingMessage } = session;
    const opening = pendingMessage?.initialResponse;
    const messages = session.messages.map(message =>
      message.id === input.userMessageId
        ? { ...message, localClarification: true as const }
        : message,
    );
    if (
      pendingMessage &&
      !pendingMessage.withholdHealthBody &&
      opening &&
      opening.source !== 'receipt'
    )
      messages.push({
        id: pendingMessage.id,
        role: 'assistant',
        content: '',
        initialResponse: opening,
        incomplete: true,
      });
    update(id, { pendingMessage: null, messages });
    const prompt = session.messages.find(
      message => message.id === input.userMessageId,
    );
    restoreFailedPrompt(
      find,
      update,
      id,
      prompt?.content ?? '',
      input.userMessageId,
      t('ragConversation.conversation.answerSaveFailed'),
      false,
      input.restorePromptToComposer,
    );
    return;
  }
  const content =
    outcome.status === 'answer'
      ? outcome.answer
      : outcome.status === 'no_evidence'
        ? input.copy.noEvidence
        : outcome.guidance === 'visit_goal'
          ? t('visitQuestions.conversation.clarifyGoal')
          : input.copy.insufficient;
  update(id, {
    pendingMessage: null,
    // A generated report is retained on its own message, not selected for every later prompt.
    ...(outcome.status === 'answer' &&
    input.retentionUnavailable &&
    !session.error
      ? { error: t('ragConversation.conversation.answerSaveSourceUnavailable') }
      : {}),
    messages: [
      ...find(id).messages.map(message =>
        clarification && message.id === input.userMessageId
          ? { ...message, localClarification: true as const }
          : message,
      ),
      {
        id: messageId,
        role: 'assistant',
        ...(clarification ? { localClarification: true as const } : {}),
        content,
        initialResponse: session.pendingMessage?.withholdHealthBody
          ? undefined
          : session.pendingMessage?.initialResponse,
        previousOutputs:
          clarification || session.pendingMessage?.withholdHealthBody
            ? undefined
            : session.pendingMessage?.previousOutputs,
        ...(input.dailyReport ? { dailyReport: input.dailyReport } : {}),
        ...activity.metadata(session.pendingMessage?.withholdHealthBody),
        ...(!clarification && input.retainedTurnId
          ? { retainedTurnId: input.retainedTurnId }
          : {}),
        ...(outcome.status === 'answer'
          ? {
              ...(outcome.dailyReport
                ? { dailyReport: outcome.dailyReport }
                : {}),
              citations: outcome.citations,
              healthSources: outcome.healthSources,
              healthSummary: outcome.healthSummary,
              visitQuestions: outcome.visitQuestions,
              retryHealthSummary: outcome.retryHealthSummary
                ? healthSummaryRetry({
                    id,
                    messageId,
                    retry: outcome.retryHealthSummary,
                    find,
                    update,
                  })
                : undefined,
            }
          : { healthSources: [] }),
      },
    ],
  });
}
