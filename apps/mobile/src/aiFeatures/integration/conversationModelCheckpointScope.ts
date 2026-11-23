import type { ExecutionConsentPort } from '@orot/agent-runtime';
import type { RagConversationObserver } from '../../ragConversation/conversationObserver';
import { isSettingsOnlyExecutionConsent } from '../../agent/execution/useInferenceConsent';
import { isDecisionFreePreviewPreparation } from '../../ragConversation/conversationRequestPreview';
import type { ConversationEntryContext } from './conversationIntent';

/** Only the actual ordinary live service attaches this stock candidate port. */
export function modelCheckpointScope(
  signal: AbortSignal,
  consent: ExecutionConsentPort,
  context?: ConversationEntryContext,
  photo?: unknown,
) {
  const ordinary =
    !context ||
    (context.intent === 'conversation' &&
      !context.appointmentId &&
      !context.dailyReport &&
      !context.reportRequest &&
      !context.typedPossibilityReport);
  return { signal, settingsConsent: ordinary && !photo ? consent : undefined };
}

export function isKnownModelCheckpointScope(
  consent: ExecutionConsentPort | undefined,
  observer: RagConversationObserver | undefined,
  retained: boolean,
) {
  return Boolean(
    consent &&
    isSettingsOnlyExecutionConsent(consent) &&
    !observer?.photoInput &&
    isDecisionFreePreviewPreparation(observer, retained),
  );
}
