import { NativeModules } from 'react-native';
import { runMigrations } from '@orot/storage';
import { openSqliteTestDatabase } from '../../../../../../packages/storage/__tests__/sqliteTestDatabase';
import { createConversationArtifactStorage } from '../../../storage/conversationArtifactStorage';
import { createConversationPhotoInputValidator } from '../conversationPhotoInputValidation';
import type { ConversationSubmittedInput } from '../../../ragConversation/conversationSubmittedInput';

test('requires the real retained request and checks its exact protected original', async () => {
  const connection = openSqliteTestDatabase(':memory:');
  const previous = NativeModules.MedicalDocumentImportModule;
  const ensureMedicalDocumentOriginal = jest.fn().mockResolvedValue(undefined);
  NativeModules.MedicalDocumentImportModule = { ensureMedicalDocumentOriginal };
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
      source: {
        id: '12345678-1234-4234-8234-123456789abc',
        contentHash: `sha256:${'a'.repeat(64)}`,
      },
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
    const validate = createConversationPhotoInputValidator(storage);
    const signal = new AbortController().signal;
    expect(await validate(input, signal)).toBe(true);
    expect(ensureMedicalDocumentOriginal).toHaveBeenCalledWith(
      input.ocr!.source.id,
      input.ocr!.source.id,
      input.ocr!.source.contentHash,
    );
    expect(
      await validate(
        { ...input, ocr: { ...input.ocr!, deletionGeneration: 1 } },
        signal,
      ),
    ).toBe(false);
    ensureMedicalDocumentOriginal.mockRejectedValueOnce(new Error('missing'));
    expect(await validate(input, signal)).toBe(false);
    await storage.invalidateRequestSource(input.ocr!.source.id);
    expect(await validate(input, signal)).toBe(false);
  } finally {
    NativeModules.MedicalDocumentImportModule = previous;
    connection.close();
  }
});
