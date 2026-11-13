import type { createConversationArtifactStorage } from '../storage/conversationArtifactStorage';
import type { ConversationArtifactSource } from './conversationArtifactSources';

/** Keep all raw preview operations bound to the retained turn and its session lease. */
export function createConversationRetainedPreview(input: {
  readonly storage: Partial<
    Pick<
      ReturnType<typeof createConversationArtifactStorage>,
      'invalidatePreview' | 'preparePreview' | 'writePreview'
    >
  >;
  readonly sessionId: string;
  readonly sessionVersion?: number;
  readonly turnId: string;
}) {
  const lease = {
    requestId: input.turnId,
    sessionId: input.sessionId,
    sessionVersion: input.sessionVersion ?? 0,
  };
  return {
    async invalidatePreview() {
      if (!input.storage.invalidatePreview)
        throw new Error('Conversation preview is unavailable.');
      return input.storage.invalidatePreview(lease);
    },
    async preparePreview(
      boundary: number,
      template: {
        providerId: string;
        modelId: string;
        sources: readonly ConversationArtifactSource[];
      },
    ) {
      if (!input.storage.preparePreview)
        throw new Error('Conversation preview is unavailable.');
      return input.storage.preparePreview(lease, boundary, template);
    },
    async writePreview(boundary: number, body: string) {
      if (!input.storage.writePreview)
        throw new Error('Conversation preview is unavailable.');
      return input.storage.writePreview(lease, boundary, body);
    },
  };
}
