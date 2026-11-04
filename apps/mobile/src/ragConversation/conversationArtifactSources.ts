import type {
  SavedGeneratedConversationSource,
  SavedGeneratedSummarySource,
  SavedGeneratedResearchSource,
  SavedSummarySource,
} from '../diseaseHypotheses/savedSummaries';
export type {
  SavedGeneratedConversationSource,
  SavedGeneratedSummarySource,
  SavedGeneratedResearchSource,
} from '../diseaseHypotheses/savedSummaries';

/** Generated parents remain distinct from clinical records and retain their exact revision. */
export type ConversationArtifactSource = SavedSummarySource;

export function isGeneratedSummarySource(
  source: ConversationArtifactSource,
): source is SavedGeneratedSummarySource {
  return 'kind' in source && source.kind === 'generated_summary';
}

export function isOriginalConversationSource(
  source: ConversationArtifactSource,
): source is Exclude<
  SavedSummarySource,
  | SavedGeneratedSummarySource
  | SavedGeneratedConversationSource
  | SavedGeneratedResearchSource
> {
  return (
    !isGeneratedSummarySource(source) &&
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
