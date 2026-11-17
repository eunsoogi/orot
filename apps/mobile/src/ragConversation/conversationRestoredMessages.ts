import type { RestoredTurn } from './conversationRestoredTurn';
import type { DisplayMessage } from './ConversationMessage';
import type { StoredSteeringInstruction } from '../storage/conversationSteeringStorage';
import { t } from '../i18n';

/** Allocate stable display identities without renumbering already visible pages. */
export function conversationRestoredMessages(
  turns: readonly RestoredTurn[],
  receipts: readonly (readonly StoredSteeringInstruction[])[],
  nextId: () => number,
): DisplayMessage[] {
  return turns.flatMap((turn, index) => [
    ...(turn.question || turn.submittedInput?.ocr
      ? [
          {
            id: nextId(),
            restoredHistory: true as const,
            role: 'user' as const,
            content: turn.question,
            delivery: turn.delivery,
            ...(turn.submittedInput
              ? { submittedInput: turn.submittedInput }
              : {}),
            ...(turn.interrupted ||
            (!turn.answer && turn.completion === 'partial')
              ? { failed: true }
              : {}),
          },
        ]
      : []),
    {
      id: nextId(),
      restoredHistory: true as const,
      role: 'assistant' as const,
      steeringInstructions: receipts[index],
      content: turn.preview ?? turn.answer,
      initialResponse: turn.initialResponse,
      citations: turn.citations,
      healthSources: turn.healthSources,
      toolMessageId: turn.toolMessageId,
      coldResume: turn.coldResume,
      ...(turn.question && turn.toolMessageId && !turn.interrupted
        ? { retainedTurnId: turn.toolMessageId }
        : {}),
      toolEvents: turn.toolEvents,
      ...(turn.healthSummary !== undefined
        ? { healthSummary: turn.healthSummary }
        : {}),
      visitQuestions: turn.visitQuestions,
      visitQuestionsUnavailable: turn.visitQuestionsUnavailable,
      ...(turn.dailyReport ? { dailyReport: turn.dailyReport } : {}),
      ...(turn.interrupted || (!turn.answer && turn.completion === 'partial')
        ? {
            incomplete: true,
            interruptionReason:
              turn.interruptionReason ?? 'process-interrupted',
            activity: turn.interruptionReason
              ? t(`conversationInterruption.${turn.interruptionReason}`)
              : t('ragConversation.progressInterrupted'),
          }
        : {}),
    },
  ]);
}
