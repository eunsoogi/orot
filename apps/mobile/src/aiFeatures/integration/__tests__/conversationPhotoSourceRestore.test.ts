import { NativeModules } from 'react-native';
import { runMigrations } from '@orot/storage';
import { openSqliteTestDatabase } from '../../../../../../packages/storage/__tests__/sqliteTestDatabase';
import { createConversationArtifactStorage } from '../../../storage/conversationArtifactStorage';
import { createConversationPhotoInputValidator } from '../conversationPhotoInputValidation';
import { LocalEvidenceReferenceRegistry } from '../evidenceRegistry';
import { registerConversationPhotoEvidence } from '../conversationPhotoEvidence';
import { captureConversationSources } from '../captureConversationSources';
import { restoreConversationArtifact } from '../restoreConversationArtifact';
import { revalidateWithLocalDeletionGuard } from '../deletionAwareEvidence';
import type { AiFeatureLocalData } from '../localData';
import type { ConversationSubmittedInput } from '../../../ragConversation/conversationSubmittedInput';

test('photo evidence survives protected save and reopens only while its original remains valid', async () => {
  const db = openSqliteTestDatabase(':memory:');
  const previous = NativeModules.MedicalDocumentImportModule;
  const ensure = jest.fn().mockResolvedValue(undefined);
  NativeModules.MedicalDocumentImportModule = {
    ensureMedicalDocumentOriginal: ensure,
  };
  const submitted: ConversationSubmittedInput = {
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
    await runMigrations(db.database);
    const storage = createConversationArtifactStorage(db.database);
    await storage.createSession('session', await storage.currentGeneration());
    await storage.startRequest({
      id: 'request',
      sessionId: 'session',
      sessionVersion: 0,
      question: '',
      createdAt: '2026-11-13T00:00:00.000Z',
      submittedInput: submitted,
    });
    const validate = createConversationPhotoInputValidator(storage);
    const registry = new LocalEvidenceReferenceRegistry();
    const signal = new AbortController().signal;
    const [item] = registerConversationPhotoEvidence({
      submitted,
      registry,
      isCurrent: currentSignal => validate(submitted, currentSignal),
    });
    expect(item!.content).toContain('사진에서 추출한 글자');
    expect(item!.evidenceId).not.toBe('section');
    expect(
      await revalidateWithLocalDeletionGuard(
        [item!],
        signal,
        registry.revalidateEvidence.bind(registry),
        registry.resolve.bind(registry),
      ),
    ).toBe(true);
    expect(
      await revalidateWithLocalDeletionGuard(
        [item!],
        signal,
        registry.revalidateEvidence.bind(registry),
      ),
    ).toBe(false);
    const captured = await captureConversationSources(
      [item!],
      registry,
      signal,
    );
    const citation = captured.mapping.get(JSON.stringify(item))!;
    await storage.append({
      id: 'request',
      sessionId: 'session',
      createdAt: '2026-11-13T00:00:00.000Z',
      providerId: 'provider',
      modelId: 'model',
      status: 'complete',
      question: '',
      answer: 'synthetic answer',
      submittedInput: submitted,
      sources: captured.sources,
      citations: [citation],
    });
    const data = {
      validateConversationPhotoInput: validate,
    } as AiFeatureLocalData;
    const freshRegistry = new LocalEvidenceReferenceRegistry();
    const restored = await restoreConversationArtifact({
      id: 'request',
      storage,
      registry: freshRegistry,
      data,
      signal,
    });
    expect(restored?.answer).toBe('synthetic answer');
    expect(
      (await freshRegistry.readSource(restored!.citations[0]!, signal)).status,
    ).toBe('available');
    ensure.mockRejectedValueOnce(new Error('missing original'));
    expect(
      await restoreConversationArtifact({
        id: 'request',
        storage,
        registry: new LocalEvidenceReferenceRegistry(),
        data,
        signal,
      }),
    ).toBeNull();
    await storage.invalidateRequestSource(submitted.ocr!.source.id);
    expect(
      await revalidateWithLocalDeletionGuard(
        [item!],
        signal,
        registry.revalidateEvidence.bind(registry),
        registry.resolve.bind(registry),
      ),
    ).toBe(false);
    expect(
      await restoreConversationArtifact({
        id: 'request',
        storage,
        registry: new LocalEvidenceReferenceRegistry(),
        data,
        signal,
      }),
    ).toBeNull();
  } finally {
    NativeModules.MedicalDocumentImportModule = previous;
    db.close();
  }
});
