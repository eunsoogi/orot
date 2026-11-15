import type { ConversationToolEvent } from '@orot/agent-runtime';
import type { createConversationArtifactStorage } from '../../storage/conversationArtifactStorage';
import type { AiFeatureLocalData } from './localData';
import type { LocalEvidenceReferenceRegistry } from './evidenceRegistry';
import { bindLiveConversationToolSources } from './bindLiveConversationToolSources';

/** Bind external sources only after their protected event write has succeeded. */
export function conversationStoredToolObserver(
  openStorage: () => Promise<
    ReturnType<typeof createConversationArtifactStorage>
  >,
  loadData: () => Promise<AiFeatureLocalData>,
  registry: LocalEvidenceReferenceRegistry,
) {
  return async (event: ConversationToolEvent, sessionId: string) => {
    if (event.sources.some(source => source.sourceKind === 'external_medical'))
      await bindLiveConversationToolSources(
        event,
        sessionId,
        await openStorage(),
        await loadData(),
        registry,
      );
  };
}
