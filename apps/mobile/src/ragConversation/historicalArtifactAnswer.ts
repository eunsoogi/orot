import type { EvidenceReference } from '@orot/agent-runtime';
import type { EvidenceSourceReadResult } from '../aiFeatures/integration/evidenceSourceDocument';
import type { MultiAgentRunResult } from '@orot/agent-runtime';
import type { GroundedRagAnswer } from './task';
import type {
  RagConversationOutcome,
  RagConversationRunOptions,
} from './service';
import { revalidateWithLocalDeletionGuard } from '../aiFeatures/integration/deletionAwareEvidence';
import { t } from '../i18n';

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

export const HISTORICAL_ARTIFACT_MESSAGE = t(
  'ragConversation.conversation.historicalArtifactNotice',
);

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
  return {
    status: 'answer',
    answer: HISTORICAL_ARTIFACT_MESSAGE,
    citations: result.citations,
  };
}
