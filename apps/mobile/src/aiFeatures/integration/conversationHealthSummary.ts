import type { createHealthSummaryService } from './healthSummaryService';
import type { RagConversationObserver } from '../../ragConversation/conversationObserver';
import type { RagConversationOutcome } from '../../ragConversation/outcome';
import type { HealthSummaryRequest } from '../../ragConversation/healthSummary';
import { AiProviderSelectionError } from './provider';

/** The turn stores only a reference; the authoritative summary owns its evidence and save state. */
export function createConversationHealthSummary(
  service: ReturnType<typeof createHealthSummaryService>,
) {
  return async (
    request: HealthSummaryRequest,
    signal: AbortSignal,
    observer?: RagConversationObserver,
  ): Promise<RagConversationOutcome> => {
    let output: Awaited<ReturnType<typeof service>>;
    try {
      output = await service(request, signal, observer);
    } catch (error) {
      return {
        status: 'failure',
        kind: signal.aborted
          ? 'cancelled'
          : error instanceof AiProviderSelectionError
            ? error.status === 'selection-required'
              ? 'provider_configuration'
              : 'provider_unavailable'
            : 'unavailable',
      };
    }
    if ('failure' in output) return output.failure;
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
