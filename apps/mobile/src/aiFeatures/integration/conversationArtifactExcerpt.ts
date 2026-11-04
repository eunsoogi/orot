import type { EvidenceReference } from '@orot/agent-runtime';
import type { ArtifactMetadata } from '../../healthEvidence/artifactDiscovery';
import { retainedResearchMetadata } from './retainedResearchSearch';

/** Provider text is bounded and explicitly identifies prior output as generated. */
export function conversationArtifactExcerpt(
  metadata: ArtifactMetadata,
  content: { question: string; answer: string },
  sources: readonly EvidenceReference[],
  sourceStatus: 'current' | 'changed' | 'unknown',
) {
  return JSON.stringify({
    kind: 'conversation_turn',
    createdAt: metadata.createdAt,
    provider: metadata.providerId,
    model: metadata.modelId,
    completion: metadata.completion,
    sourceStatus,
    warning:
      'Historical AI-generated answer, not independently verified medical evidence.',
    question: content.question.slice(0, 400),
    answer: content.answer.slice(0, 1200),
    excerptTruncated:
      content.question.length > 400 || content.answer.length > 1200,
    sources: sources.map(source => ({
      kind: source.sourceKind,
      evidenceId: source.evidenceId,
    })),
    retainedResearch: retainedResearchMetadata(sources),
  });
}

/** Compact continuation pages disclose a link without sending private answer text. */
export function compactConversationArtifactExcerpt(
  metadata: ArtifactMetadata,
  sourceStatus: 'current' | 'changed' | 'unknown',
) {
  return JSON.stringify({
    kind: 'conversation_turn',
    createdAt: metadata.createdAt,
    completion: metadata.completion,
    sourceStatus,
    warning:
      'Historical AI-generated answer; open its citation for the saved result.',
    excerptTruncated: true,
  });
}
