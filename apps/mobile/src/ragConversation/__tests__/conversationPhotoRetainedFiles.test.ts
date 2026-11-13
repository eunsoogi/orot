import { runMigrations, createRecordRepository } from '@orot/storage';
import { openSqliteTestDatabase } from '../../../../../packages/storage/__tests__/sqliteTestDatabase';
import { createConversationArtifactStorage } from '../../storage/conversationArtifactStorage';
import { createMedicalDocumentImportService } from '../../medicalDocuments/medicalDocumentImportService';
import type { ConversationSubmittedInput } from '../conversationSubmittedInput';

test('reconciliation preserves request originals including undo, and fails closed if ownership cannot be read', async () => {
  const connection = openSqliteTestDatabase(':memory:');
  const sourceId = '12345678-1234-4234-8234-123456789abc';
  const input: ConversationSubmittedInput = {
    schemaVersion: 1,
    inputRevision: 1,
    sessionId: 'session',
    requestId: 'request',
    question: '',
    ocr: {
      providerId: 'provider',
      modelId: 'model',
      recipient: 'recipient',
      remoteProcessing: false,
      consentScope: {
        purpose: 'conversation',
        policyVersion: 'v1',
        dataCategories: ['ocr'],
      },
      source: { id: sourceId, contentHash: `sha256:${'a'.repeat(64)}` },
      deletionGeneration: 0,
      sections: [
        { id: 'section', text: 'synthetic', startOffset: 0, endOffset: 9 },
      ],
    },
  };
  try {
    await runMigrations(connection.database);
    const storage = createConversationArtifactStorage(connection.database);
    await storage.createSession('session', await storage.currentGeneration());
    await storage.startRequest({
      id: 'request',
      sessionId: 'session',
      sessionVersion: 0,
      question: '',
      createdAt: '2026-11-13T00:00:00.000Z',
      submittedInput: input,
    });
    const reconcile = jest.fn().mockResolvedValue(undefined);
    const pick = jest.fn().mockResolvedValue(null);
    const files = {
      reconcile,
      stage: jest.fn(),
      restore: jest.fn(),
      commit: jest.fn(),
      ensureOriginal: jest.fn(),
      discard: jest.fn(),
    };
    const retainedConversationSourceIds = jest.fn(() =>
      storage.retainedRequestSourceIds(),
    );
    const service = createMedicalDocumentImportService({
      loadRepository: async () => createRecordRepository(connection.database),
      retainedConversationSourceIds,
      fileDeletion: files,
      pick,
    });
    await service.selectDocument('photos');
    expect(reconcile.mock.calls[0][0]).toContain(sourceId);
    await storage.hideSession('session', 0);
    await service.selectDocument('photos');
    expect(reconcile.mock.calls[1][0]).toContain(sourceId);
    retainedConversationSourceIds.mockRejectedValueOnce(
      new Error('database unavailable'),
    );
    await expect(service.selectDocument('photos')).rejects.toThrow();
    expect(reconcile).toHaveBeenCalledTimes(2);
    expect(pick).toHaveBeenCalledTimes(2);
  } finally {
    connection.close();
  }
});
