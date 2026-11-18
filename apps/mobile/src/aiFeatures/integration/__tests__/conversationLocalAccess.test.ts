import * as storageModule from '../../../storage/conversationArtifactStorage';
import * as notificationModule from '../../../replyNotifications/replyNotificationStorage';
import * as discoveryModule from '../conversationArtifactDiscovery';
import { createConversationLocalAccess } from '../conversationLocalAccess';
import { withConversationHistoryReadOperation } from '../conversationHistoryReadOperation';
import { LocalEvidenceReferenceRegistry } from '../evidenceRegistry';
import { periodContributorFixture } from '../../../storage/testSupport/periodContributorFixture';
import { createLocalEvidenceData } from '../../../healthEvidence/localEvidenceData';
import type { AiFeatureLocalData } from '../localData';

/** Exercise the production memory/notification wrappers, not a raw test store. */
test('discovery and opened storage share the exact protected operation owner', async () => {
  const f = await periodContributorFixture('heart_rate', 'measurements');
  const data = createLocalEvidenceData(f.database) as AiFeatureLocalData;
  const access = createConversationLocalAccess(f.database, () => data, {
    storage: async () => storageModule,
    notifications: async () => notificationModule,
    discovery: async () => discoveryModule,
  });
  const registry = new LocalEvidenceReferenceRegistry();
  try {
    const [storage, sameStorage, discovery, sameDiscovery] = await Promise.all([
      access.openConversationArtifactStorage(),
      access.openConversationArtifactStorage(),
      access.conversationArtifactDiscovery(registry),
      access.conversationArtifactDiscovery(registry),
    ]);
    expect(storage).toBe(sameStorage);
    expect(discovery).toBe(sameDiscovery);
    let escaped = storage;
    await withConversationHistoryReadOperation(
      discovery,
      new AbortController().signal,
      async (_scoped, context) => {
        expect(context?.healthContextReportScope).toBeDefined();
        const scopedStorage = context!.storage(storage);
        expect(scopedStorage).not.toBe(storage);
        escaped = scopedStorage;
        expect(scopedStorage.append).toBe(storage.append);
        expect(scopedStorage.hideSession).toBe(storage.hideSession);
        expect(scopedStorage.deleteSession).toBe(storage.deleteSession);
        expect(context!.storage(f.conversation)).toBe(f.conversation);
        expect(
          (await scopedStorage.readToolTurnsSnapshot('session', 0)).items,
        ).toHaveLength(1);
      },
    );
    await f.repository.delete('health_observation', f.candidate.id);
    expect((await escaped.readToolTurnsSnapshot('session', 0)).items).toEqual(
      [],
    );
  } finally {
    f.close();
  }
});

test('failed loading retries without duplicating protected owners or cross-registry discovery', async () => {
  const f = await periodContributorFixture('heart_rate', 'measurements');
  const data = createLocalEvidenceData(f.database) as AiFeatureLocalData;
  const failure = new Error('Synthetic module loading failure');
  const notifications = jest
    .fn()
    .mockRejectedValueOnce(failure)
    .mockResolvedValue(notificationModule);
  const access = createConversationLocalAccess(f.database, () => data, {
    storage: async () => storageModule,
    notifications,
    discovery: async () => discoveryModule,
  });
  const registry = new LocalEvidenceReferenceRegistry();
  try {
    await expect(access.conversationArtifactDiscovery(registry)).rejects.toBe(
      failure,
    );
    const [discovery, storage] = await Promise.all([
      access.conversationArtifactDiscovery(registry),
      access.openConversationArtifactStorage(),
    ]);
    expect(notifications).toHaveBeenCalledTimes(2);
    const other = await access.conversationArtifactDiscovery(
      new LocalEvidenceReferenceRegistry(),
    );
    expect(other).not.toBe(discovery);
    await withConversationHistoryReadOperation(
      other,
      new AbortController().signal,
      async (_scoped, context) => {
        expect(context!.storage(storage)).not.toBe(storage);
      },
    );
    expect(await access.openConversationArtifactStorage()).toBe(storage);
    expect(notifications).toHaveBeenCalledTimes(2);
  } finally {
    f.close();
  }
});
