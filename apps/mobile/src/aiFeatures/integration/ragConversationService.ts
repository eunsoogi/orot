import { conversationPublicSearchPlan as planSearch } from './conversationPublicSearchPlan';
import { prepareLiveRagContinuation as continuationFor } from './liveRagConversationCapture';
import type { RagConversationServiceDependencies } from './ragConversationServiceDependencies';
import { finishConversationWorkflow } from './finishConversationWorkflow';
import type * as Conversation from '../../ragConversation/service';
import type { RagConversationMessage } from '../../ragConversation/task';
import { executionOptions } from './featureServiceExecution';
import * as background from './conversationBackgroundProvider';
import { operationRunId } from './featureRunIdentity';
import { createConversationToolBundle } from './conversationToolBundle';
import { withProviderStage } from '../../providers/diagnostics';
import { ragConversationFailure } from './ragConversationFailure';
import { createConversationRetentionBridge } from './conversationRetentionBridge';
import * as run from './conversationRunOptions';
import { createResearchInputTracker } from './researchInputTracker';
import type { ConversationEntryContext } from './conversationIntent';
import { conversationEarlyResponse } from './conversationEarlyResponse';
import { loadConversationHistory } from './conversationHistorySources';
import {
  conversationTargetFailure,
  resolveConversationSelection,
  validConversationInput,
} from './conversationVoiceSelection';
import {
  bindConversationPhotoExecution as bindPhoto,
  prepareConversationPhoto as preparePhoto,
} from './conversationPhotoService';
import * as targets from './conversationEntryTargets';
import { conversationExternalEvidence } from './conversationExternalEvidence';
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
    const request = question.trim();
    const photo = background.photo(observer);
    if (!validConversationInput(request, photo))
      return { status: 'failure', kind: 'validation_failed' };
    const linked = background.scope(parentSignal, observer);
    const signal = linked.controller.signal;
    const consent = background.consent(consentPort, observer);
    const queryConsent = background.consent(queryConsentPort, observer);
    let stage: 'selection' | 'data' | 'workflow' = 'data';
    try {
      const target = await targets.resolveConversationTargets({
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
          question: request,
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
      const photoEvidence = await preparePhoto({
        photo,
        question: request,
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
      const historyIsCurrent = targets.conversationInputsAreCurrent(
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
      const { eager: publicSearch, ...searchPlan } = await planSearch({
        external,
        observer,
        runId: createOperationRunId?.() ?? operationRunId(),
        question: request,
        signal,
        continuation: await continuationFor(
          observer,
          selected,
          selectedAi,
          {
            registry,
            tracker: researchInputs,
            external,
            signal,
          },
          () => ({
            history,
            entryContext,
            reportReferences: report?.items ?? [],
            localRetrievalFailed: localRetrievalFailed(),
            hasPagingState: generated.hasPagingState(),
            publicSearch: searchPlan.coldSearch,
          }),
        ),
      });
      if (publicSearch.status === 'cancelled')
        return { status: 'failure', kind: 'cancelled' };
      const { tools, generated, localRetrievalFailed } =
        createConversationToolBundle({
          data,
          registry,
          observer,
          researchInputs,
          external,
          publicSearchSucceeded: searchPlan.includeExternalTools,
        });
      const retention = createConversationRetentionBridge({
        observer,
        registry,
        question: request,
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
        operationRunId: searchPlan.operationRunId,
        consent,
        registry,
        tools,
        external,
      });
      const execution = photo
        ? bindPhoto(baseExecution, photo, photoEvidence!, {
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
        run.conversationRunRequest({
          continuation: searchPlan.continuation,
          onInitialSearchStatus: searchPlan.onInitialSearchStatus,
          question: request,
          photoEvidence,
          entryIntent: entryContext?.intent,
          targetVisitEvidence: target.evidence,
          dailyReportEvidence: report?.items,
          history,
          retention,
          rag: data.rag,
          search: publicSearch,
          registry,
          workflow: {
            ...run.conversationRunWorkflow(
              execution,
              historyIsCurrent,
              !!history.references.length || !!report,
              publicSearch,
              searchPlan.chargeEagerSearch,
            ),
            initialSearch: searchPlan.initialSearch,
          },
        }),
        run.conversationRunInvocation(
          observer,
          Boolean(history.references.length || report || photo),
          registry,
          { providerId: selected.provider.id, modelId: selected.modelId },
          signal,
        ),
      );
      return await finishConversationWorkflow({
        outcome,
        observer,
        generated,
        localRetrievalFailed,
        historyIsCurrent,
        publicSearch: searchPlan.currentSearch,
        skipPublicSearchNotice: !request,
        retention,
        signal,
        reportIsCurrent: report?.isCurrent,
      });
    } catch (error) {
      return ragConversationFailure(error, signal, stage);
    } finally {
      linked.dispose();
    }
  };
}
