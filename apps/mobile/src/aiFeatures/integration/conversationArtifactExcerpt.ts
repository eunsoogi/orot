import type { EvidenceReference } from '@orot/agent-runtime';
import type { ArtifactMetadata } from '../../healthEvidence/artifactDiscovery';
import { retainedResearchMetadata } from './retainedResearchSearch';

/** Preserve complete text for interactive work; label prior output as generated, never fresh facts. */
export function conversationArtifactExcerpt(
  metadata: ArtifactMetadata,
  content: { question: string; answer: string },
  sources: readonly EvidenceReference[],
  sourceStatus: 'current' | 'changed' | 'unknown',
  complete = false,
) {
  return JSON.stringify({
    kind: 'conversation_turn',
    createdAt: metadata.createdAt,
    provider: metadata.providerId,
    model: metadata.modelId,
    sourceStatus,
    warning:
      'Historical AI-generated answer, not independently verified medical evidence.',
    question: complete ? content.question : content.question.slice(0, 400),
    answer: complete ? content.answer : content.answer.slice(0, 1200),
    excerptTruncated:
      !complete &&
      (content.question.length > 400 || content.answer.length > 1200),
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
    sourceStatus,
    warning:
      'Historical AI-generated answer; open its citation for the saved result.',
    excerptTruncated: true,
  });
}
