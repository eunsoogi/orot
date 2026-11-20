import { startPreparedRagOpening as start } from './preparedOpeningConsent';
import { conversationPublicSearchPlan as planSearch } from './conversationPublicSearchPlan';
import { prepareLiveRagContinuation as continuationFor } from './liveRagConversationCapture';
import { conversationMutationExecution } from './conversationMutationExecution';
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
import type { ConversationEntryContext } from './conversationIntent';
import { conversationEarlyResponse } from './conversationEarlyResponse';
import { prepareConversationHistory } from './prepareConversationHistory';
import * as voiceSelection from './conversationVoiceSelection';
import { prepareConversationPhoto as preparePhoto } from './conversationPhotoService';
import * as targets from './conversationEntryTargets';
import { conversationExternalEvidence } from './conversationExternalEvidence';
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
  async function sendRagMessage(
    question: string,
    previousMessages: readonly RagConversationMessage[],
    parentSignal?: AbortSignal,
    observer?: Conversation.RagConversationObserver,
    entryContext?: ConversationEntryContext,
  ): Promise<Conversation.RagConversationOutcome> {
    const request = question.trim();
    const photo = background.photo(observer);
    if (!voiceSelection.validConversationInput(request, photo))
      return { status: 'failure', kind: 'validation_failed' };
    const linked = background.scope(parentSignal, observer);
    const signal = linked.controller.signal;
    const consent = background.consent(consentPort, observer);
    const queryConsent = background.consent(queryConsentPort, observer);
    let opening: ReturnType<typeof start> | undefined;
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
        return voiceSelection.conversationTargetFailure(signal, target.failure);
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
      const selected = await voiceSelection.resolveConversationSelection(
        observer,
        selectedAi,
      );
      if (!selected) return { status: 'failure', kind: 'consent_required' };
      const current = report?.isCurrent;
      opening = start(selected, request, observer, consent, signal, current);
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
      const { history, historyIsCurrent, researchInputs, guardHistory } =
        await prepareConversationHistory(
          {
            messages: previousMessages,
            session: observer?.retentionSession,
            retainedHistory: observer?.retainedHistory,
            data,
            registry,
            signal,
          },
          report,
          { entry: entryContext, hasPhoto: !!photo },
        );
      const external = conversationExternalEvidence({
        selected,
        consent,
        queryConsent,
        externalEvidence,
        loadLocalData,
        observer,
        researchInputs,
        owner: history.recoveredOwnerIsCurrent,
      });
      opening[history.recoveredOwnerIsCurrent ? 'dispose' : 'ready']();
      await opening.done;
      const searchPlan = await planSearch({
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
            ...generated.coldPaging(),
            publicSearch: searchPlan.coldSearch,
          }),
        ),
      });
      if (searchPlan.eager.status === 'cancelled') return run.cancelled;
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
      const execution = conversationMutationExecution({
        baseExecution,
        photo,
        photoEvidence,
        selected,
        data,
        registry,
        observer,
        question: request,
        history,
      });
      stage = 'workflow';
      if (!(await historyIsCurrent()))
        return { status: 'failure', kind: 'retrieval_failed' };
      const outcome = await run.observeConversationMain(ragRunner)(
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
          search: searchPlan.eager,
          registry,
          workflow: {
            ...run.conversationRunWorkflow(
              execution,
              historyIsCurrent,
              guardHistory,
              searchPlan.eager,
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
        priorDialogueOmitted: history.omitted,
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
      opening?.dispose();
      linked.dispose();
    }
  }
  return run.observeConversationReceiptTiming(sendRagMessage);
}
