import type { EvidenceReference } from '@orot/agent-runtime';
import type { EvidenceSourceReadResult } from '../aiFeatures/integration/evidenceSourceDocument';
import type { MultiAgentRunResult } from '@orot/agent-runtime';
import type { GroundedRagAnswer } from './task';
import type {
  RagConversationOutcome,
  RagConversationRunOptions,
} from './service';
import { revalidateWithLocalDeletionGuard } from '../aiFeatures/integration/deletionAwareEvidence';

/** Keep generated prose out of conversation history; the source screen re-reads it on demand. */
export async function confirmHistoricalArtifacts(
  references: readonly EvidenceReference[],
  read: (
    reference: EvidenceReference,
    signal: AbortSignal,
  ) => Promise<EvidenceSourceReadResult>,
  signal: AbortSignal,
): Promise<boolean> {
  if (!references.length) return false;
  for (const reference of references) {
    const result = await read(reference, signal);
    if (
      signal.aborted ||
      result.status !== 'available' ||
      result.document.sourceKind !== 'generated_artifact'
    )
      return false;
  }
  return true;
}

export const HISTORICAL_ARTIFACT_MESSAGE =
  '이전에 생성된 AI 결과를 찾았어요. 아래 출처에서 생성 시각, 불확실성과 현재 출처 상태를 확인해 주세요. 독립적으로 확인된 의료 사실은 아니에요.';

/** Return a link only after the artifact and its original sources are checked again. */
export async function historicalArtifactOutcome(
  result: Extract<MultiAgentRunResult<GroundedRagAnswer>, { status: 'result' }>,
  options: RagConversationRunOptions,
  signal: AbortSignal,
): Promise<RagConversationOutcome> {
  if (
    result.citations.some(
      reference => reference.sourceKind !== 'generated_artifact',
    ) ||
    !options.readHistoricalArtifact
  )
    return { status: 'insufficient' };
  const available = await confirmHistoricalArtifacts(
    result.citations,
    options.readHistoricalArtifact,
    signal,
  );
  if (
    !available ||
    !(await revalidateWithLocalDeletionGuard(
      result.citations,
      signal,
      options.workflow.revalidateEvidence,
      options.resolveLocalEvidenceIdentity,
    ))
  )
    return { status: 'insufficient' };
  const more = result.coverage.some(
    coverage =>
      coverage.sourceKind === 'generated_artifact' && coverage.nextCursor,
  );
  return {
    status: 'answer',
    answer: more
      ? `${HISTORICAL_ARTIFACT_MESSAGE}\n\n더 오래된 결과가 있어요. 계속 찾아달라고 요청할 수 있어요.`
      : HISTORICAL_ARTIFACT_MESSAGE,
    citations: result.citations,
  };
}
