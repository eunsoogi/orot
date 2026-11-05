import type { createHealthSummaryService } from './healthSummaryService';
import type { RagConversationObserver } from '../../ragConversation/conversationObserver';
import type { RagConversationOutcome } from '../../ragConversation/outcome';
import type { HealthSummaryRequest } from '../../ragConversation/healthSummary';

/** The turn stores only a reference; the authoritative summary owns its evidence and save state. */
export function createConversationHealthSummary(
  service: ReturnType<typeof createHealthSummaryService>,
) {
  return async (
    request: HealthSummaryRequest,
    signal: AbortSignal,
    observer?: RagConversationObserver,
  ): Promise<RagConversationOutcome> => {
    const output = await service(request, signal, observer);
    if (!output)
      return {
        status: 'failure',
        kind: signal.aborted ? 'cancelled' : 'validation_failed',
      };
    const answer = '건강 기록을 요약했어요.';
    if (!signal.aborted && observer?.onRetentionCandidate) {
      try {
        await observer.onRetentionCandidate(
          {
            question: request.question,
            answer,
            providerId: output.providerId,
            modelId: output.modelId,
            sources: [],
            citations: [],
            healthSummary: output.result.reference,
          },
          signal,
        );
      } catch {
        if (!signal.aborted) observer.onRetentionFailure?.();
      }
    }
    return {
      status: 'answer',
      answer,
      citations: [],
      healthSummary: output.result,
      retryHealthSummary: output.retry,
    };
  };
}
