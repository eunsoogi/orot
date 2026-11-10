import type { RagConversationOutcome } from './outcome';
import type { ConversationSession } from './conversationSessionTypes';
import type { createConversationTurnActivity } from './conversationTurnActivity';
import { healthSummaryRetry } from './healthSummaryRetry';
import { answerUsesDeletedHealthEvidence } from './conversationHealthDeletion';
import { restoreFailedPrompt } from './conversationFailedPrompt';
import { getRagConversationFailureCopy } from './copy';

/** Attach a validated answer and keep each summary retry bound to its own message. */
export function conversationCompletedAnswer(input: {
  id: number;
  messageId: number;
  userMessageId: number;
  retainedTurnId?: string;
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
      );
    return;
  }
  const content =
    outcome.status === 'answer'
      ? outcome.answer
      : outcome.status === 'no_evidence'
        ? input.copy.noEvidence
        : input.copy.insufficient;
  update(id, {
    pendingMessage: null,
    messages: [
      ...find(id).messages,
      {
        id: messageId,
        role: 'assistant',
        content,
        ...activity.metadata(session.pendingMessage?.withholdHealthBody),
        ...(input.retainedTurnId
          ? { retainedTurnId: input.retainedTurnId }
          : {}),
        ...(outcome.status === 'answer'
          ? {
              citations: outcome.citations,
              healthSources: outcome.healthSources,
              completion: outcome.completion,
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
          : {}),
      },
    ],
  });
}
