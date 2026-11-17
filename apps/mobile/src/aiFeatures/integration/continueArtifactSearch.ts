import { t } from '../../i18n';
import type { ArtifactContinuation } from '../../ragConversation/artifactContinuation';
import type { RagConversationOutcome } from '../../ragConversation/service';
import {
  confirmHistoricalArtifacts,
  HISTORICAL_ARTIFACT_MESSAGE,
} from '../../ragConversation/historicalArtifactAnswer';
import type { AiFeatureLocalData } from './localData';
import type { LocalEvidenceReferenceRegistry } from './evidenceRegistry';
import { createSummaryArtifactTool } from './summaryArtifactTool';
import { createConversationArtifactTool } from './conversationArtifactTool';
import { referenceOnly } from '../../diseaseHypotheses/resultValidation';

/** Resume only the calling conversation's saved local search; no query is sent to a provider. */
export async function continueArtifactSearch(input: {
  readonly data: AiFeatureLocalData;
  readonly registry: LocalEvidenceReferenceRegistry;
  readonly scope: string;
  readonly continuation: ArtifactContinuation;
  readonly signal: AbortSignal;
  readonly onContinuation: (value: ArtifactContinuation | null) => void;
}): Promise<RagConversationOutcome> {
  let next: ArtifactContinuation | null = null;
  const createTool =
    input.continuation.catalog === 'conversation'
      ? createConversationArtifactTool
      : createSummaryArtifactTool;
  const tool = createTool(input.data, input.registry, {
    scope: input.scope,
    referenceOnly: true,
    onPage: (query, cursor) => {
      next = cursor
        ? {
            query,
            cursor,
            ...(input.continuation.catalog === 'conversation'
              ? { catalog: 'conversation' as const }
              : {}),
          }
        : null;
    },
  });
  const result = await tool.search({
    operationRunId: 'artifact-continuation',
    operationKey: 'local-page',
    input: {
      query: input.continuation.query,
      cursor: input.continuation.cursor,
    },
    allowedScope: { sourceKinds: ['generated_artifact'] },
    resultLimit: 8,
    // Pagination is a batch size, not a byte quota for retained artifacts.
    maxPayloadBytes: 20 * 1024,
    executionLimits: 'unbounded',
    signal: input.signal,
  });
  if ('status' in result)
    return { status: 'failure', kind: 'consent_required' };
  const gaps = result.coverage.some(coverage => coverage.gaps.length > 0);
  if (!result.items.length) {
    input.onContinuation(next);
    return {
      status: 'answer',
      citations: [],
      answer: next
        ? t('ragConversation.conversation.continuationNoResults')
        : gaps
          ? t('ragConversation.conversation.continuationIncomplete')
          : t('ragConversation.conversation.continuationExhausted'),
    };
  }
  const available = await confirmHistoricalArtifacts(
    result.items,
    (reference, signal) => input.registry.readSource(reference, signal),
    input.signal,
  );
  if (
    !available ||
    !(await input.registry.revalidateEvidence(result.items, input.signal))
  )
    return { status: 'failure', kind: 'stale_evidence' };
  input.onContinuation(next);
  return {
    status: 'answer',
    citations: result.items.map(referenceOnly),
    answer:
      HISTORICAL_ARTIFACT_MESSAGE +
      (gaps
        ? '\n\n' + t('ragConversation.conversation.continuationGaps')
        : '') +
      (next
        ? '\n\n' + t('ragConversation.conversation.continuationAvailable')
        : ''),
  };
}
