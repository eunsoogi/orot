import type { ArtifactContinuation } from '../../ragConversation/artifactContinuation';
import type { RagConversationOutcome } from '../../ragConversation/service';
import {
  confirmHistoricalArtifacts,
  HISTORICAL_ARTIFACT_MESSAGE,
} from '../../ragConversation/historicalArtifactAnswer';
import type { AiFeatureLocalData } from './localData';
import type { LocalEvidenceReferenceRegistry } from './evidenceRegistry';
import { createSummaryArtifactTool } from './summaryArtifactTool';
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
  const tool = createSummaryArtifactTool(input.data, input.registry, {
    scope: input.scope,
    referenceOnly: true,
    onPage: (query, cursor) => {
      next = cursor ? { query, cursor } : null;
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
    maxPayloadBytes: 20 * 1024,
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
        ? '아직 일치하는 결과가 없어요. 더 이전 결과를 계속 찾아볼 수 있어요.'
        : gaps
          ? '일부 저장 결과를 읽지 못해 검색을 완료하지 못했어요.'
          : '이전 결과를 끝까지 찾았지만 더 일치하는 내용은 없어요.',
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
      (gaps ? '\n\n일부 저장 결과는 읽지 못했어요.' : '') +
      (next ? '\n\n더 이전 결과를 계속 찾아볼 수 있어요.' : ''),
  };
}
