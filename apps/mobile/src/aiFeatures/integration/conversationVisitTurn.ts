import type { OutboundProcessingRequest } from '@orot/agent-runtime';
import type {
  RagConversationObserver,
  RagConversationOutcome,
} from '../../ragConversation/service';
import type { ConversationEntryContext } from './conversationIntent';
import type { AiFeatureServices } from './featureServices';
import type { SelectedAiResolution } from './provider';
import type { AiFeatureLocalData } from './localData';
import type { LocalEvidenceReferenceRegistry } from './evidenceRegistry';
import { generateConversationVisitQuestions } from './conversationVisitQuestions';
import { defaultVisitQuestionRouteOperations } from './visitQuestionsRouteOperations';
import { operationRunId } from './featureRunIdentity';
import { createConversationVisitToolSource } from './conversationVisitToolSource';
import { prepareConversationVisitRetention } from './prepareConversationVisitRetention';
import { RetainedSourceInvalidError } from './retainedSourceError';

/** Retain the visit reference separately from the user's explicit prepared-question save. */
export function createConversationVisitTurn(deps: {
  readonly loadLocalData: () => Promise<AiFeatureLocalData>;
  readonly registry: LocalEvidenceReferenceRegistry;
  readonly loadSaved: AiFeatureServices['loadSavedVisitQuestions'];
  readonly generatedArtifactTools?: AiFeatureServices['generatedArtifactTools'];
  readonly registerSource: AiFeatureServices['registerVisitQuestionSource'];
}) {
  return async (input: {
    readonly question: string;
    readonly context?: ConversationEntryContext;
    readonly signal: AbortSignal;
    readonly observer?: RagConversationObserver;
    readonly resolveSelectedAi: () => Promise<SelectedAiResolution>;
    readonly confirmConsent: (
      request: OutboundProcessingRequest,
    ) => Promise<boolean>;
  }): Promise<RagConversationOutcome> => {
    const ownerKey = `${input.observer?.conversationScope ?? 'conversation'}:${operationRunId()}`;
    const result = await generateConversationVisitQuestions({
      ownerKey,
      appointmentId: input.context?.appointmentId,
      request: input.question,
      operations: defaultVisitQuestionRouteOperations,
      loadSaved: deps.loadSaved,
      resolveSelectedAi: input.resolveSelectedAi,
      generatedArtifactTools: deps.generatedArtifactTools,
      confirmConsent: input.confirmConsent,
      isCurrentOwner: () => !input.signal.aborted,
      signal: input.signal,
      registerToolSource: createConversationVisitToolSource(
        deps.registry,
        deps.registerSource,
      ),
      observer: {
        onProgress: event => {
          if (!input.signal.aborted) input.observer?.onProgress?.(event);
        },
        onToolEvent: event => {
          if (!input.signal.aborted || event.status === 'cancelled')
            input.observer?.onToolEvent?.(event);
        },
      },
    });
    if (result.status !== 'ready') {
      const kind =
        result.status === 'cancelled'
          ? 'cancelled'
          : result.status === 'no_appointment'
            ? 'visit_no_appointment'
            : result.status === 'saved_unavailable'
              ? 'visit_saved_unavailable'
              : result.status === 'provider_unavailable'
                ? 'provider_unavailable'
                : result.status === 'consent_required'
                  ? 'consent_required'
                  : result.status === 'appointment_changed' ||
                      result.status === 'refresh_required'
                    ? 'stale_evidence'
                    : 'validation_failed';
      return { status: 'failure', kind };
    }
    const answer =
      '진료에서 물어볼 질문을 준비했어요. 선택하고 수정한 뒤 저장할 수 있어요.';
    if (input.observer?.onRetentionCandidate) {
      const prepare = prepareConversationVisitRetention({
        result,
        question: input.question,
        answer,
        loadLocalData: deps.loadLocalData,
        registry: deps.registry,
        registerSource: deps.registerSource,
      });
      let writing = false;
      try {
        const candidate = await prepare(input.signal);
        writing = true;
        await input.observer.onRetentionCandidate(candidate, input.signal);
      } catch (error) {
        if (input.signal.aborted)
          return { status: 'failure', kind: 'cancelled' };
        if (error instanceof RetainedSourceInvalidError)
          return { status: 'failure', kind: 'stale_evidence' };
        input.observer.onRetentionFailure?.(writing ? undefined : prepare);
      }
    }
    return {
      status: 'answer',
      answer,
      citations: [],
      visitQuestions: {
        appointment: result.appointment,
        review: result.review,
        validateSource: result.generation.validateSource,
        restorationNotice: result.restorationNotice,
      },
    };
  };
}
