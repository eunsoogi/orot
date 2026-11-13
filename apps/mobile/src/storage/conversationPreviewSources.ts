import type { ConversationArtifactSource } from '../ragConversation/conversationArtifactSources';

/** External and generated sources lack a complete local mutation fence. */
export function eligibleConversationPreviewSources(
  sources: readonly ConversationArtifactSource[],
) {
  return sources.every(
    source =>
      source.reference.sourceKind !== 'external_medical' &&
      source.reference.sourceKind !== 'generated_artifact',
  );
}
