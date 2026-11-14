import { prepareConversationContinuation as continuationFor } from './prepareConversationContinuation';
import type { RagConversationServiceDependencies } from './ragConversationServiceDependencies';
import { finishRagConversation } from './finishRagConversation';
import type * as Conversation from '../../ragConversation/service';
import type { RagConversationMessage } from '../../ragConversation/task';
import { executionOptions } from './featureServiceExecution';
import * as background from './conversationBackgroundProvider';
import { operationRunId } from './featureRunIdentity';
import { createConversationToolBundle } from './conversationToolBundle';
import { withProviderStage } from '../../providers/diagnostics';
import { ragConversationFailure } from './ragConversationFailure';
import { createConversationRetentionBridge } from './conversationRetentionBridge';
import {
  conversationRunInvocation,
  conversationRunRequest,
  conversationRunWorkflow,
} from './conversationRunOptions';
import { createResearchInputTracker } from './researchInputTracker';
import type { ConversationEntryContext } from './conversationIntent';
import { conversationEarlyResponse } from './conversationEarlyResponse';
import { loadConversationHistory } from './conversationHistorySources';
import { conversationFallbackOutcome } from './conversationFallbackOutcome';
import {
  conversationTargetFailure,
  resolveConversationSelection,
  validConversationInput,
} from './conversationVoiceSelection';
import {
  bindConversationPhotoExecution,
  prepareConversationPhoto,
} from './conversationPhotoService';
import {
  conversationInputsAreCurrent,
  resolveConversationTargets,
} from './conversationEntryTargets';
import {
  conversationExternalEvidence,
  conversationPublicSearch,
} from './conversationExternalEvidence';
/** Keeps local availability checks ahead of provider resolution and model dispatch. */
export function createRagConversationService({
  consent: consentPort,
  queryConsent: queryConsentPort,
  externalEvidence,
  loadLocalData,
  selectedAi,
  registry,
  ragRunner,
  createOperationRunId,
  resolveDailyReport,
}: RagConversationServiceDependencies) {
  return async function sendRagMessage(
    question: string,
    previousMessages: readonly RagConversationMessage[],
    parentSignal?: AbortSignal,
    observer?: Conversation.RagConversationObserver,
    entryContext?: ConversationEntryContext,
  ): Promise<Conversation.RagConversationOutcome> {
    const normalizedQuestion = question.trim();
    const photo = background.photo(observer);
    if (!validConversationInput(normalizedQuestion, photo)) {
      return { status: 'failure', kind: 'validation_failed' };
    }
    const linked = background.scope(parentSignal, observer);
    const signal = linked.controller.signal;
    const consent = background.consent(consentPort, observer);
    const queryConsent = background.consent(queryConsentPort, observer);
    let stage: 'selection' | 'data' | 'workflow' = 'selection';
    try {
      stage = 'data';
      const target = await resolveConversationTargets({
        context: entryContext,
        loadLocalData,
        resolveDailyReport,
        registry,
        signal,
      });
      if (target.failure)
        return conversationTargetFailure(signal, target.failure);
      const report = target.report;
      stage = 'selection';
      const early =
        !report &&
        !photo &&
        (await conversationEarlyResponse({
          question: normalizedQuestion,
          observer,
          loadLocalData,
          targetData: target.data,
          registry,
          signal,
          onData: () => {
            stage = 'data';
          },
        }));
      if (early) return early;
      stage = 'selection';
      const selected = await resolveConversationSelection(observer, selectedAi);
      if (!selected) return { status: 'failure', kind: 'consent_required' };
      stage = 'data';
      const data =
        target.data ?? (await withProviderStage('rag', 'data', loadLocalData));
      const photoEvidence = await prepareConversationPhoto({
        photo,
        question: normalizedQuestion,
        sessionId: observer?.retentionSession?.id,
        selected,
        data,
        registry,
        signal,
      });
      // User follow-ups may influence an answer, so retain their validated turn lineage.
      const history = await loadConversationHistory({
        messages: previousMessages,
        session: observer?.retentionSession,
        retainedHistory: observer?.retainedHistory,
        data,
        registry,
        signal,
      });
      const historyIsCurrent = conversationInputsAreCurrent(
        registry,
        history.references,
        signal,
        report,
      );
      const researchInputs = createResearchInputTracker(
        registry,
        data,
        observer?.retentionSession?.id,
      );
      const external = conversationExternalEvidence({
        selected,
        consent,
        queryConsent,
        externalEvidence,
        loadLocalData,
        observer,
        researchInputs,
      });
      const runId = createOperationRunId?.() ?? operationRunId();
      const publicSearch = normalizedQuestion
        ? await conversationPublicSearch({
            external,
            observer,
            runId,
            question: normalizedQuestion,
            signal,
          })
        : { status: 'unavailable' as const };
      if (publicSearch.status === 'cancelled')
        return { status: 'failure', kind: 'cancelled' };
      const { tools, generated, localRetrievalFailed } =
        createConversationToolBundle({
          data,
          registry,
          observer,
          researchInputs,
          external,
          publicSearchSucceeded: publicSearch.status === 'success',
        });
      const retention = createConversationRetentionBridge({
        observer,
        registry,
        question: normalizedQuestion,
        ...(photo ? { submittedInput: photo.submitted } : {}),
        providerId: selected.provider.id,
        modelId: selected.modelId,
        entryContext,
        priorDialogue: history.priorTurns,
        priorUserReports: history.reports,
        ...(history.omitted ? { priorDialogueOmitted: true as const } : {}),
        signal,
      });
      const baseExecution = executionOptions({
        consentPurpose: 'record_conversation',
        selected,
        operationRunId: runId,
        consent,
        registry,
        tools,
        external,
      });
      const execution = photo
        ? bindConversationPhotoExecution(baseExecution, photo, photoEvidence!, {
            selected,
            data,
            registry,
            sessionVersion: observer!.retentionSession!.version,
          })
        : baseExecution;
      stage = 'workflow';
      if (!(await historyIsCurrent()))
        return { status: 'failure', kind: 'retrieval_failed' };
      const outcome = await ragRunner(
        conversationRunRequest({
          continuation: await continuationFor(observer, selected, selectedAi),
          question: normalizedQuestion,
          photoEvidence,
          entryIntent: entryContext?.intent,
          targetVisitEvidence: target.evidence,
          dailyReportEvidence: report?.items,
          history,
          retention,
          rag: data.rag,
          search: publicSearch,
          registry,
          workflow: conversationRunWorkflow(
            execution,
            historyIsCurrent,
            !!history.references.length || !!report,
            publicSearch,
            Boolean(normalizedQuestion && external.publicWebTool),
          ),
        }),
        conversationRunInvocation(
          observer,
          Boolean(history.references.length || report || photo),
          registry,
          { providerId: selected.provider.id, modelId: selected.modelId },
          signal,
        ),
      );
      if (signal.aborted) return { status: 'failure', kind: 'cancelled' };
      if (!(await historyIsCurrent()))
        return { status: 'failure', kind: 'retrieval_failed' };
      const continuation = generated.choose(outcome);
      observer?.onArtifactContinuation?.(continuation);
      const fallback = conversationFallbackOutcome(
        outcome,
        Boolean(continuation),
        localRetrievalFailed(),
      );
      if (fallback) return fallback;
      return await finishRagConversation({
        outcome,
        publicSearch,
        skipPublicSearchNotice: !normalizedQuestion,
        retention,
        signal,
        continuation: Boolean(continuation),
        reportIsCurrent: report?.isCurrent,
      });
    } catch (error) {
      return ragConversationFailure(error, signal, stage);
    } finally {
      linked.dispose();
    }
  };
}
