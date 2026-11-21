import {
  createCuratedPublisherEvidence,
  explicitPublisherSearch,
  selectedOnDeviceApple,
} from './curatedPublisherEvidence';
import type { RagConversationServiceDependencies } from './ragConversationServiceDependencies';
import type { RagConversationObserver } from '../../ragConversation/service';
import type { createResearchInputTracker } from './researchInputTracker';
import {
  createSelectedExternalEvidence,
  type SelectedExternalEvidenceSnapshot,
} from './selectedExternalEvidence';
import { retainLiteratureResults } from './researchRetention';
import { observeConversationTool } from '../../ragConversation/observeConversationTool';
import { runDefaultPublicSearch } from './defaultPublicSearch';

/** Share the conversation's consent and retention boundaries with literature tools. */
export function conversationExternalEvidence(input: {
  selected: Awaited<
    ReturnType<RagConversationServiceDependencies['selectedAi']>
  >;
  consent: RagConversationServiceDependencies['consent'];
  queryConsent: RagConversationServiceDependencies['queryConsent'];
  externalEvidence: RagConversationServiceDependencies['externalEvidence'];
  loadLocalData: RagConversationServiceDependencies['loadLocalData'];
  observer?: RagConversationObserver;
  researchInputs: ReturnType<typeof createResearchInputTracker>;
  restored?: SelectedExternalEvidenceSnapshot;
  curatedQuestion?: string;
  owner?: () => Promise<boolean>;
}) {
  const {
    selected,
    consent,
    queryConsent,
    externalEvidence,
    loadLocalData,
    observer,
    researchInputs,
    owner: recoveredOwnerIsCurrent,
  } = input;
  // An omitted history can leave no references, but never releases the recovered
  // owner's fence at optional network dispatches.
  const checkOwner = async (signal?: AbortSignal) => {
    if (
      signal?.aborted ||
      !(await recoveredOwnerIsCurrent?.()) ||
      signal?.aborted
    )
      throw new Error('Conversation research owner is no longer current.');
  };
  const provider = selected.provider;
  const external = createSelectedExternalEvidence({
    selected:
      recoveredOwnerIsCurrent && provider.searchPublicWeb
        ? {
            ...selected,
            provider: {
              ...provider,
              async searchPublicWeb(request, options) {
                await checkOwner(options?.signal);
                return provider.searchPublicWeb!(request, options);
              },
            },
          }
        : selected,
    consent,
    recoverUnavailable: true,
    restored: input.restored,
    literature: retainLiteratureResults(
      recoveredOwnerIsCurrent
        ? {
            ...externalEvidence,
            async search(query, options) {
              await checkOwner(options.signal);
              return externalEvidence.search(query, options);
            },
          }
        : externalEvidence,
      loadLocalData,
      'record_conversation',
      observer?.retentionSession,
      researchInputs.recordResearch,
      { providerId: selected.provider.id, modelId: selected.modelId },
    ),
    literatureConsent: queryConsent,
    loadData: loadLocalData,
    originFeature: 'record_conversation',
    retentionSession: observer?.retentionSession,
    captureResearchInputs: researchInputs.capture,
    validateResearchInputs: researchInputs.revalidate,
    onResearchRetained: researchInputs.recordResearch,
  });
  const onDeviceApple = selectedOnDeviceApple({
    providerId: selected.provider.id,
    modelId: selected.modelId,
    remoteProcessing: selected.remoteProcessing,
  });
  if (input.restored?.curated && !onDeviceApple)
    throw new Error(
      'Unexpected publisher evidence for another answer provider.',
    );
  const localWeb =
    onDeviceApple &&
    (input.restored?.curated ||
      explicitPublisherSearch(input.curatedQuestion ?? ''))
      ? createCuratedPublisherEvidence(input.restored?.curated)
      : undefined;
  return {
    ...external,
    // Explicit local web search must not make Europe PMC or a third party a fallback.
    tools: localWeb ? [] : external.tools,
    curatedSearch: localWeb?.search,
    snapshot: () => ({
      ...external.snapshot(),
      ...(localWeb ? { curated: localWeb.snapshot() } : {}),
    }),
    validates: (reference: Parameters<typeof external.validates>[0]) =>
      external.validates(reference) || Boolean(localWeb?.validates(reference)),
  };
}

/** Keep public search observation and cancellation tied to the same turn. */
export function conversationPublicSearch(input: {
  external: ReturnType<typeof conversationExternalEvidence>;
  observer?: RagConversationObserver;
  runId: string;
  question: string;
  signal: AbortSignal;
}) {
  return runDefaultPublicSearch({
    tool: observeConversationTool(
      input.external.publicWebTool,
      input.observer?.onToolEvent,
    ),
    operationRunId: input.runId,
    request: input.question,
    signal: input.signal,
  });
}
