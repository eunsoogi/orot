import { coldRagFactoryFixture } from '../testSupport/coldRagFactoryFixture';
import { NativeModules } from 'react-native';
import { runMigrations } from '@orot/storage';
import { openSqliteTestDatabase } from '../../../../../../packages/storage/__tests__/sqliteTestDatabase';
import { createConversationArtifactStorage } from '../../../storage/conversationArtifactStorage';
import { createConversationPhotoInputValidator } from '../conversationPhotoInputValidation';
import { LocalEvidenceReferenceRegistry } from '../evidenceRegistry';
import { registerConversationPhotoEvidence } from '../conversationPhotoEvidence';
import type { AiFeatureLocalData } from '../localData';
import type { ConversationSubmittedInput } from '../../../ragConversation/conversationSubmittedInput';
import { restoreColdPhotoExecution } from '../restoreColdPhotoExecution';

// Actual protected SQLite with a synthetic native original and explicit local decision.
test('cold photo binding requires a new decision and rejects changed ownership after that decision', async () => {
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
        purpose: 'record_conversation',
        policyVersion: 'v1',
        dataCategories: ['photo_ocr'],
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
    const confirm = jest.fn().mockResolvedValue(true);
    const f = await coldRagFactoryFixture();
    const selected = {
      ...f.selected,
      provider: {
        ...f.selected.provider,
        id: 'provider',
        displayName: 'Synthetic',
        capabilities: {
          ...f.selected.provider.capabilities,
          inputTypes: ['text'] as const,
        },
      },
      modelId: 'model',
      recipient: 'recipient',
      remoteProcessing: false,
    };
    const base = {
      ...f.options,
      execution: {
        ...f.options.execution,
        consentScope: {
          purpose: 'record_conversation' as const,
          policyVersion: 'v1',
          dataCategories: [],
        },
      },
    };
    const binding = await restoreColdPhotoExecution({
      base,
      selected,
      submitted,
      owner: { requestId: 'request', sessionId: 'session', sessionVersion: 0 },
      data: {
        openConversationArtifactStorage: async () => storage,
        validateConversationPhotoInput: validate,
      } as AiFeatureLocalData,
      registry,
      evidenceIds: [item!.evidenceId],
      confirm,
      signal,
    });
    expect(confirm).not.toHaveBeenCalled();
    const request = {
      operationRunId: 'run',
      providerId: 'provider',
      modelId: 'model',
      recipient: 'recipient',
      remoteProcessing: false,
      consentScope: submitted.ocr!.consentScope,
      allowedScope: { sourceKinds: ['personal_record' as const] },
      signal,
      payload: {
        messages: [
          {
            role: 'user' as const,
            content: JSON.stringify({ evidence: [item] }),
          },
        ],
      },
    };
    expect(await binding.photoInput.consent.authorize(request)).toBe(
      'authorized',
    );
    expect(confirm).toHaveBeenCalledTimes(1);
    confirm.mockImplementationOnce(async () => {
      await storage.invalidateRequestSource(submitted.ocr!.source.id);
      return true;
    });
    expect(await binding.photoInput.consent.authorize(request)).toBe(
      'renewal_required',
    );
    expect(confirm).toHaveBeenCalledTimes(2);
  } finally {
    NativeModules.MedicalDocumentImportModule = previous;
    db.close();
  }
});
