import { createMultiAgentPauseController } from '@orot/agent-runtime';
import type { SqlDatabase } from '@orot/storage';
import type { JsonObject } from '@orot/model-runtime';
import type { RagConversationObserver } from '../../ragConversation/conversationObserver';
import type { ConversationContinuationIdentity } from '../../storage/conversationWorkflowContinuationIdentity';
import type { RagConversationServiceDependencies } from './ragConversationServiceDependencies';
import { createConversationColdResumeStorage } from '../../storage/conversationColdResumeStorage';
import { readConversationColdCallIds } from '../../storage/optionalConversationColdCapture';
import { restoreColdRagConversationFactory } from './restoreColdRagConversationFactory';
import { readColdRagCompletion } from './coldRagCompletion';
import { createConversationRetentionBridge } from './conversationRetentionBridge';
import { runColdConversationWorkflow } from '../../ragConversation/runColdConversationWorkflow';
import { conversationWorkflowOutcome } from '../../ragConversation/conversationWorkflowOutcome';
import { conversationRunInvocation } from './conversationRunOptions';
import { finishConversationWorkflow } from './finishConversationWorkflow';
import * as background from './conversationBackgroundProvider';
import { resolveConversationSelection } from './conversationVoiceSelection';

/** Explicit Continue endpoint. It never invokes send, initial retrieval, or creates another request.
 * The caller adopts the retained turn and routes returned readers only to that turn's bubble.
 * A paused result remains interrupted; calling again requires another explicit Continue action.
 * The session lifetime owns normal terminal failure and pending-save settlement, as for live sends.
 */
export async function resumeColdRagConversation(input: {
  database: SqlDatabase;
  identity: ConversationContinuationIdentity;
  dependencies: RagConversationServiceDependencies;
  observer: RagConversationObserver;
  signal: AbortSignal;
  onRegistry?(
    owner: import('./coldConversationSourceResolvers').ColdConversationSourceOwner,
    registry: import('./evidenceRegistry').LocalEvidenceReferenceRegistry,
  ): void;
}) {
  const { database, identity, observer, dependencies: deps } = input;
  if (
    observer.retentionRequestId !== identity.requestId ||
    observer.retentionSession?.id !== identity.sessionId ||
    observer.retentionSession.version !== identity.sessionVersion ||
    !observer.onWorkflowPauseController ||
    !observer.onRetentionCandidate ||
    observer.photoInput ||
    input.signal.aborted
  )
    throw new Error('Cold retained owner unavailable.');
  const linked = background.scope(input.signal, observer);
  const signal = linked.controller.signal;
  try {
    const descriptor =
      await createConversationColdResumeStorage(database).open(identity);
    if (!descriptor || signal.aborted)
      throw new Error('Cold continuation unavailable.');
    const factory = await restoreColdRagConversationFactory({
      descriptor,
      signal,
      observer,
      dependencies: {
        ...deps,
        consent: background.consent(deps.consent, observer),
        queryConsent: background.consent(deps.queryConsent, observer),
        selectedAi: async () => {
          const selected = await resolveConversationSelection(
            observer,
            deps.selectedAi,
          );
          if (!selected) throw new Error('Cold selection changed.');
          return selected;
        },
      },
      readKnownCallIds: () =>
        readConversationColdCallIds(
          database,
          identity,
          descriptor.manifest.operationRunId,
        ),
    });
    // Legacy eager-search budgets/status are not yet a reconstructable cold contract.
    if (!factory.options.initialSearch)
      throw new Error('Cold initial-search contract unavailable.');
    const completion = await readColdRagCompletion(
      descriptor.reconstruction,
      factory.registry,
      signal,
    );
    const retention = createConversationRetentionBridge({
      observer,
      registry: factory.registry,
      question: descriptor.request,
      providerId: factory.options.execution.providerId,
      modelId: factory.options.execution.modelId,
      entryContext: completion.entryContext ?? undefined,
      priorDialogue: completion.priorDialogue,
      priorUserReports: completion.priorUserReports,
      ...(completion.priorDialogueOmitted
        ? { priorDialogueOmitted: true as const }
        : {}),
      signal,
    });
    const pause = createMultiAgentPauseController();
    observer.onWorkflowPauseController(() => pause.requestPause());
    const result = await runColdConversationWorkflow({
      database,
      descriptor,
      options: factory.options,
      invocation: {
        ...conversationRunInvocation(
          observer,
          true,
          factory.registry,
          factory.options.execution,
          signal,
        ),
        pause,
      },
      validateSelection: factory.validateSelection,
      onClaim: () =>
        input.onRegistry?.(
          { ...identity, operationRunId: descriptor.manifest.operationRunId },
          factory.registry,
        ),
      capture: async batches => {
        if (factory.bundle.generated.hasPagingState())
          throw new Error('Cold paging reconstruction unavailable.');
        return {
          ...(await factory.capture(batches)),
          completion: {
            ...completion,
            localRetrievalFailed:
              completion.localRetrievalFailed ||
              factory.bundle.localRetrievalFailed(),
          } as unknown as JsonObject,
        };
      },
    });
    if (result.status === 'paused')
      return {
        status: 'paused' as const,
        reason: result.checkpoint.awaitingAuthorization
          ? ('decision-required' as const)
          : ('expired' as const),
        attempt: descriptor.attempt + 1,
      };
    const outcome = await conversationWorkflowOutcome(
      result,
      {
        workflow: factory.options,
        resolveLocalEvidenceIdentity: reference =>
          factory.registry.resolve(reference),
        readHistoricalArtifact: (reference, current) =>
          factory.registry.readSource(reference, current),
        onValidatedEvidence: references =>
          retention.onValidatedEvidence([
            ...references,
            ...completion.historySources,
            ...completion.reportReferences,
          ]),
      },
      signal,
    );
    const finished = await finishConversationWorkflow({
      outcome,
      observer,
      retention,
      signal,
      generated: factory.bundle.generated,
      localRetrievalFailed: () =>
        completion.localRetrievalFailed ||
        factory.bundle.localRetrievalFailed(),
      historyIsCurrent: factory.historyIsCurrent,
      reportIsCurrent: completion.reportReferences.length
        ? factory.historyIsCurrent
        : undefined,
      publicSearch: {
        status:
          result.checkpoint.initialSearchStatus &&
          result.checkpoint.initialSearchStatus !== 'pending'
            ? result.checkpoint.initialSearchStatus
            : 'unavailable',
      },
      skipPublicSearchNotice: !descriptor.request,
    });
    // This private registry must not replace the global alias map: aliases can overlap between requests.
    return {
      status: 'completed' as const,
      outcome: finished,
      registry: factory.registry,
    };
  } finally {
    linked.dispose();
  }
}
