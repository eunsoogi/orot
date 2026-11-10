import type { RagConversationOutcome } from './outcome';
import type { ConversationSession } from './conversationSessionTypes';
import type { createConversationTurnActivity } from './conversationTurnActivity';
import { healthSummaryRetry } from './healthSummaryRetry';

/** Attach a validated answer and keep each summary retry bound to its own message. */
export function conversationCompletedAnswer(input: {
  id: number;
  messageId: number;
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
        ...activity.metadata(),
        ...(input.retainedTurnId
          ? { retainedTurnId: input.retainedTurnId }
          : {}),
        ...(outcome.status === 'answer'
          ? {
              citations: outcome.citations,
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
