import type { SqlDatabase } from '@orot/storage';
import { withStatementMemory } from '../../memory/scheduleStatementMemory';
import type { AiFeatureLocalData } from './localData';
import type { LocalEvidenceReferenceRegistry } from './evidenceRegistry';
import type { createConversationArtifactStorage } from '../../storage/conversationArtifactStorage';
import type { createConversationArtifactDiscovery } from './conversationArtifactDiscovery';

const productionModules = {
  storage: () => import('../../storage/conversationArtifactStorage'),
  notifications: () =>
    import('../../replyNotifications/replyNotificationStorage'),
  discovery: () => import('./conversationArtifactDiscovery'),
};

/** One protected storage wrapper owns discovery reads and completion side effects.
 * Only owners are shared: source validity and hydrated results are never cached here. */
export function createConversationLocalAccess(
  database: SqlDatabase,
  getData: () => AiFeatureLocalData,
  modules = productionModules,
) {
  let conversationStorage:
    Promise<ReturnType<typeof createConversationArtifactStorage>> | undefined;
  const conversationDiscoveries = new WeakMap<
    LocalEvidenceReferenceRegistry,
    Promise<ReturnType<typeof createConversationArtifactDiscovery>>
  >();
  const openConversationArtifactStorage = async () => {
    // One wrapper owns notification serialization and deletion observers for this protected database.
    conversationStorage ??= Promise.all([
      modules.storage(),
      modules.notifications(),
    ])
      .then(
        ([
          { createConversationArtifactStorage },
          { createReplyNotificationStorage },
        ]) =>
          createReplyNotificationStorage(
            withStatementMemory(
              createConversationArtifactStorage(database),
              database,
            ),
            database,
          ),
      )
      .catch(error => {
        conversationStorage = undefined;
        throw error;
      });
    return conversationStorage;
  };
  return {
    openConversationArtifactStorage,
    async conversationArtifactDiscovery(
      registry: LocalEvidenceReferenceRegistry,
    ) {
      let discovery = conversationDiscoveries.get(registry);
      if (!discovery) {
        discovery = Promise.all([
          modules.discovery(),
          openConversationArtifactStorage(),
        ])
          .then(([{ createConversationArtifactDiscovery }, storage]) =>
            createConversationArtifactDiscovery({
              database,
              storage,
              data: getData(),
              registry,
            }),
          )
          .catch(error => {
            conversationDiscoveries.delete(registry);
            throw error;
          });
        conversationDiscoveries.set(registry, discovery);
      }
      return discovery;
    },
  };
}
