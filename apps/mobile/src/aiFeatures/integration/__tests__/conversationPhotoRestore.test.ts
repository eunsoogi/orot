import { runMigrations } from '@orot/storage';
import { openSqliteTestDatabase } from '../../../../../../packages/storage/__tests__/sqliteTestDatabase';
import { createConversationArtifactStorage } from '../../../storage/conversationArtifactStorage';
import type { ConversationSubmittedInput } from '../../../ragConversation/conversationSubmittedInput';
import { LocalEvidenceReferenceRegistry } from '../evidenceRegistry';
import { localData } from '../featureServiceFixtures';
import { restoreConversationArtifact } from '../restoreConversationArtifact';
import { createConversationArtifactDiscovery } from '../conversationArtifactDiscovery';
import { createConversationSessionOptions } from '../conversationSessionOptions';
import { createConversationSessionRestoreState } from '../../../ragConversation/conversationSessionRestoreState';

test('photo-only answer restoration requires a separate current original check', async () => {
  const connection = openSqliteTestDatabase(':memory:');
  try {
    await runMigrations(connection.database);
    const storage = createConversationArtifactStorage(connection.database);
    await storage.createSession('session', await storage.currentGeneration());
    const submittedInput: ConversationSubmittedInput = {
      schemaVersion: 1,
      inputRevision: 1,
      sessionId: 'session',
      requestId: 'request',
      question: '',
      ocr: {
        providerId: 'provider',
        modelId: 'model',
        recipient: 'recipient',
        remoteProcessing: true,
        consentScope: {
          purpose: 'conversation',
          policyVersion: 'v1',
          dataCategories: ['ocr'],
        },
        source: {
          id: '12345678-1234-4234-8234-123456789abc',
          contentHash: `sha256:${'a'.repeat(64)}`,
        },
        deletionGeneration: 1,
        sections: [
          {
            id: 'section',
            text: 'Synthetic OCR',
            startOffset: 0,
            endOffset: 13,
          },
        ],
      },
    };
    const createdAt = '2026-11-13T00:00:00.000Z';
    await storage.startRequest({
      id: 'request',
      sessionId: 'session',
      sessionVersion: 0,
      question: '',
      createdAt,
      submittedInput,
    });
    await storage.append({
      id: 'request',
      sessionId: 'session',
      question: '',
      createdAt,
      providerId: 'provider',
      modelId: 'model',
      status: 'complete',
      answer: 'Synthetic answer',
      sources: [],
      citations: [],
      submittedInput,
    });
    const data = localData([]).data;
    const args = {
      id: 'request',
      storage,
      data,
      registry: new LocalEvidenceReferenceRegistry(),
      signal: new AbortController().signal,
    };
    expect(await restoreConversationArtifact(args)).toBeNull();
    const validateConversationPhotoInput = jest.fn().mockResolvedValue(true);
    const restored = await restoreConversationArtifact({
      ...args,
      data: { ...data, validateConversationPhotoInput },
    });
    expect(restored).toMatchObject({
      question: '',
      answer: 'Synthetic answer',
      submittedInput,
    });
    expect(validateConversationPhotoInput).toHaveBeenCalledTimes(2);
    validateConversationPhotoInput.mockResolvedValue(false);
    expect(
      await restoreConversationArtifact({
        ...args,
        data: { ...data, validateConversationPhotoInput },
      }),
    ).toBeNull();
    validateConversationPhotoInput.mockReset();
    validateConversationPhotoInput
      .mockResolvedValueOnce(true)
      .mockImplementationOnce(async () => {
        await storage.invalidateRequestSource(submittedInput.ocr!.source.id);
        return true;
      });
    expect(
      await restoreConversationArtifact({
        ...args,
        data: { ...data, validateConversationPhotoInput },
      }),
    ).toBeNull();
  } finally {
    connection.close();
  }
});

test('an interrupted photo-only input restores only after native source validation', async () => {
  const connection = openSqliteTestDatabase(':memory:');
  try {
    await runMigrations(connection.database);
    const storage = createConversationArtifactStorage(connection.database);
    await storage.createSession('session', await storage.currentGeneration());
    const submittedInput: ConversationSubmittedInput = {
      schemaVersion: 1,
      inputRevision: 1,
      sessionId: 'session',
      requestId: 'request',
      question: '',
      ocr: {
        providerId: 'provider',
        modelId: 'model',
        recipient: 'recipient',
        remoteProcessing: true,
        consentScope: {
          purpose: 'conversation',
          policyVersion: 'v1',
          dataCategories: ['ocr'],
        },
        source: {
          id: '12345678-1234-4234-8234-123456789abc',
          contentHash: `sha256:${'a'.repeat(64)}`,
        },
        deletionGeneration: 1,
        sections: [
          {
            id: 'section',
            text: 'Synthetic OCR',
            startOffset: 0,
            endOffset: 13,
          },
        ],
      },
    };
    await storage.startRequest({
      id: 'request',
      sessionId: 'session',
      sessionVersion: 0,
      question: '',
      createdAt: '2026-11-13T00:00:00.000Z',
      submittedInput,
    });
    const base = localData([]).data;
    const registry = new LocalEvidenceReferenceRegistry();
    const data = {
      ...base,
      openConversationArtifactStorage: async () => storage,
      conversationArtifactDiscovery: async () =>
        createConversationArtifactDiscovery({
          database: connection.database,
          storage,
          registry,
          data: base,
        }),
    };
    const options = createConversationSessionOptions({
      registry,
      loadLocalData: async () => data,
    });
    await expect(
      options.restoreSession!('session', new AbortController().signal),
    ).rejects.toThrow('attachment');
    const validateConversationPhotoInput = jest.fn().mockResolvedValue(true);
    const validated = createConversationSessionOptions({
      registry,
      loadLocalData: async () => ({ ...data, validateConversationPhotoInput }),
    });
    const turns = await validated.restoreSession!(
      'session',
      new AbortController().signal,
    );
    expect(turns).toMatchObject([
      { question: '', answer: '', completion: 'partial', submittedInput },
    ]);
    const update = jest.fn();
    const restore = createConversationSessionRestoreState({
      read: async () => turns,
      update,
    });
    await restore.start(1, 'session');
    expect(update).toHaveBeenCalledWith(
      1,
      expect.objectContaining({
        messages: [
          expect.objectContaining({
            role: 'user',
            content: '',
            submittedInput,
          }),
          expect.objectContaining({ role: 'assistant', incomplete: true }),
        ],
      }),
    );
    validateConversationPhotoInput.mockReset();
    validateConversationPhotoInput
      .mockResolvedValueOnce(true)
      .mockImplementationOnce(async () => {
        await storage.invalidateRequestSource(submittedInput.ocr!.source.id);
        return true;
      });
    await expect(
      validated.restoreSession!('session', new AbortController().signal),
    ).rejects.toThrow('attachment');
  } finally {
    connection.close();
  }
});
