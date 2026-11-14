import { getRagConversationFailureCopy } from './copy';
import type { DisplayMessage } from './ConversationMessage';
import type { ConversationSession } from './conversationSessionTypes';
import type { RagConversationOutcome } from './outcome';
import type { ColdConversationSourceOwner } from '../aiFeatures/integration/coldConversationSourceResolvers';
import { answerUsesDeletedHealthEvidence } from './conversationHealthDeletion';

/** Replace only the adopted interrupted bubble; never append another question/answer pair.
 * The controller must still verify its current owner immediately before applying this pure result.
 */
export function replaceColdConversationAnswer(input: {
  session: ConversationSession;
  requestId: string;
  responseId: number;
  userMessageId: number;
  owner: ColdConversationSourceOwner;
  outcome: Extract<RagConversationOutcome, { status: 'answer' }>;
  committed: boolean;
}) {
  const { session, outcome, owner } = input;
  const matches = session.messages.filter(
    message =>
      message.role === 'assistant' && message.toolMessageId === input.requestId,
  );
  const original = matches[0];
  if (
    session.quarantined ||
    matches.length !== 1 ||
    !original?.incomplete ||
    original.id !== input.responseId ||
    owner.requestId !== input.requestId ||
    !session.messages.some(
      message => message.id === input.userMessageId && message.role === 'user',
    ) ||
    (session.pendingMessage?.withholdHealthBody &&
      answerUsesDeletedHealthEvidence(
        outcome,
        session.pendingMessage.deletedHealthIds,
      ))
  )
    return undefined;
  return {
    pendingMessage: null,
    messages: session.messages.map(message =>
      message === original
        ? {
            ...message,
            content: outcome.answer,
            citations: outcome.citations,
            healthSources: outcome.healthSources,
            completion: outcome.completion,
            healthSummary: outcome.healthSummary,
            visitQuestions: outcome.visitQuestions,
            sourceOwner: Object.freeze({ ...owner }),
            retainedTurnId: input.committed ? input.requestId : undefined,
            coldResume: undefined,
            incomplete: undefined,
            interruptionReason: undefined,
            activity: undefined,
            streaming: undefined,
          }
        : message.id === input.userMessageId
          ? { ...message, failed: undefined }
          : message,
    ),
  } satisfies Partial<ConversationSession>;
}

/** A failed eligibility recheck hides only the stale button, preserving the interrupted preview. */
export function withoutColdRecovery(
  session: ConversationSession,
  responseId: number,
) {
  return session.messages.map(message =>
    message.id === responseId
      ? {
          ...message,
          coldResume: undefined,
          ...coldPreviewPatch(session, message),
        }
      : message,
  );
}

/** Terminal cold outcomes cannot offer the already-claimed execution again. */
export function coldOutcomeFailure(
  outcome: Exclude<RagConversationOutcome, { status: 'answer' }>,
) {
  return getRagConversationFailureCopy(
    outcome.status === 'failure' ? outcome.kind : 'unavailable',
  );
}

/** Promote only the matching pending preview, retaining deletion withholding across pause/Stop. */
export function coldPreviewPatch(
  session: ConversationSession,
  message: DisplayMessage,
): Partial<DisplayMessage> {
  const pending = session.pendingMessage;
  if (pending?.id !== message.id) return {};
  return {
    content: pending.withholdHealthBody ? '' : pending.content,
    sourceOwner: pending.sourceOwner ?? message.sourceOwner,
    ...(pending.withholdHealthBody
      ? {
          citations: [],
          healthSources: [],
          toolEvents: pending.toolEvents?.filter(
            event => event.inputSummary.sourceKind === 'external_medical',
          ),
        }
      : {}),
  };
}

/** Re-pause keeps the newest unvalidated draft in the same bubble, never in retained history. */
export function coldPausedMessages(
  session: ConversationSession,
  responseId: number,
  recovery: { attempt: number; reason: 'expired' | 'decision-required' },
  sourceOwner: ColdConversationSourceOwner,
) {
  return session.messages.map(message =>
    message.id === responseId
      ? {
          ...message,
          ...coldPreviewPatch(session, message),
          sourceOwner,
          coldResume: { attempt: recovery.attempt },
          interruptionReason: recovery.reason,
        }
      : message,
  );
}
