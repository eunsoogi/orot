import type {
  SavedGeneratedConversationSource,
  SavedGeneratedSummarySource,
  SavedGeneratedResearchSource,
  SavedSummarySource,
} from '../diseaseHypotheses/savedSummaries';
import type { EvidenceReference } from '@orot/agent-runtime';
export type {
  SavedGeneratedConversationSource,
  SavedGeneratedSummarySource,
  SavedGeneratedResearchSource,
} from '../diseaseHypotheses/savedSummaries';

/** Generated parents remain distinct from clinical records and retain their exact revision. */
/** The protected request remains the authority for the original and recognized section. */
export type ConversationPhotoArtifactSource = {
  readonly kind: 'conversation_photo';
  readonly reference: EvidenceReference;
  readonly requestId: string;
  readonly sectionId: string;
};
export type ConversationArtifactSource =
  SavedSummarySource | ConversationPhotoArtifactSource;

export function isConversationPhotoSource(
  source: ConversationArtifactSource,
): source is ConversationPhotoArtifactSource {
  return 'kind' in source && source.kind === 'conversation_photo';
}

/** Consumers without photo ownership must refuse the entire input, never drop its dependency. */
export function requireNonPhotoSources(
  sources: readonly ConversationArtifactSource[],
): readonly SavedSummarySource[] {
  if (sources.some(isConversationPhotoSource))
    throw new Error('Conversation photo source is unsupported.');
  return sources.filter(
    (source): source is SavedSummarySource =>
      !isConversationPhotoSource(source),
  );
}

export function isGeneratedSummarySource(
  source: ConversationArtifactSource,
): source is SavedGeneratedSummarySource {
  return 'kind' in source && source.kind === 'generated_summary';
}

export function isOriginalConversationSource(
  source: ConversationArtifactSource,
): source is Exclude<
  ConversationArtifactSource,
  | SavedGeneratedSummarySource
  | SavedGeneratedConversationSource
  | SavedGeneratedResearchSource
  | ConversationPhotoArtifactSource
> {
  return (
    !isGeneratedSummarySource(source) &&
    !isConversationPhotoSource(source) &&
    !isGeneratedConversationSource(source) &&
    !isGeneratedResearchSource(source)
  );
}

export function isGeneratedResearchSource(
  source: ConversationArtifactSource,
): source is SavedGeneratedResearchSource {
  return 'kind' in source && source.kind === 'generated_research';
}

export function isGeneratedConversationSource(
  source: ConversationArtifactSource,
): source is SavedGeneratedConversationSource {
  return 'kind' in source && source.kind === 'generated_conversation';
}
