import { runMigrations } from '@orot/storage';
import { openSqliteTestDatabase } from '../../../../../../packages/storage/__tests__/sqliteTestDatabase';
import { createConversationArtifactStorage } from '../../../storage/conversationArtifactStorage';
import { createConversationPhotoImport } from '../../../ragConversation/conversationPhotoImport';
import { medicalDocumentFileDeletion } from '../../../medicalDocuments/medicalDocumentNativeBridge';
import { createConversationPhotoPreparation } from '../conversationPhotoPreparation';
import { localData } from '../featureServiceFixtures';
import { publicEvidenceFixture } from '../testSupport/publicWebEvidenceTestSupport';

test('failed unsent release fences the photo and retains failed cleanup for retry', async () => {
  const db = openSqliteTestDatabase(':memory:');
  const discard = jest
    .spyOn(medicalDocumentFileDeletion, 'discard')
    .mockResolvedValue(undefined);
  const sourceId = '12345678-1234-4234-8234-123456789abc';
  try {
    await runMigrations(db.database);
    const storage = createConversationArtifactStorage(db.database);
    await storage.createSession('session', await storage.currentGeneration());
    jest
      .spyOn(storage, 'releaseUnsentPhotoRequest')
      .mockRejectedValueOnce(new Error('release failed'));
    const fence = jest
      .spyOn(storage, 'invalidateRequestSource')
      .mockRejectedValueOnce(new Error('fence failed'));
    const drafts = createConversationPhotoImport({
      selectDocument: async () => ({
        id: sourceId,
        displayName: 'photo.jpg',
        contentHash: `sha256:${'a'.repeat(64)}`,
        sections: [{ id: 's', text: 'photo', startOffset: 0, endOffset: 5 }],
      }),
      discardDocument: async () => {},
    });
    await drafts.select(1);
    const preparation = createConversationPhotoPreparation({
      loadLocalData: async () => ({
        ...localData([]).data,
        openConversationArtifactStorage: async () => storage,
      }),
      selectedAi: async () => publicEvidenceFixture().selected,
    });
    const controller = new AbortController();
    const photo = await preparation.prepare({
      drafts,
      sessionId: 1,
      durableSession: { id: 'session', version: 0 },
      requestId: 'request',
      question: '',
      signal: controller.signal,
      confirm: async () => false,
      start: submittedInput =>
        storage.startRequest({
          id: 'request',
          sessionId: 'session',
          sessionVersion: 0,
          question: '',
          createdAt: '2026-11-13T00:00:00.000Z',
          submittedInput,
        }),
    });
    await expect(photo.settleUnsent!()).rejects.toThrow('fence failed');
    expect(drafts.get(1).status).toBe('empty');
    expect(preparation.retirement.pending()).toEqual([sourceId]);
    expect(discard).not.toHaveBeenCalled();
    await preparation.retirement.retire(sourceId);
    expect(fence).toHaveBeenCalledTimes(2);
    expect(discard).toHaveBeenCalledWith(sourceId);
    expect(preparation.retirement.pending()).toEqual([]);
  } finally {
    discard.mockRestore();
    db.close();
  }
});
