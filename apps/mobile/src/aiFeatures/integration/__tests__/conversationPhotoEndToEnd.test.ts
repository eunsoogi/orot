import { NativeModules } from 'react-native';
import { providerSuccess } from '@orot/model-runtime';
import { runMigrations } from '@orot/storage';
import { openSqliteTestDatabase } from '../../../../../../packages/storage/__tests__/sqliteTestDatabase';
import { createConversationArtifactStorage } from '../../../storage/conversationArtifactStorage';
import { runRagConversationTurn } from '../../../ragConversation/service';
import { createRagConversationService } from '../ragConversationService';
import { createConversationPhotoInputValidator } from '../conversationPhotoInputValidation';
import { restoreConversationArtifact } from '../restoreConversationArtifact';
import { createConversationArtifactDiscovery } from '../conversationArtifactDiscovery';
import { LocalEvidenceReferenceRegistry } from '../evidenceRegistry';
import { localData } from '../featureServiceFixtures';
import { publicEvidenceFixture } from '../testSupport/publicWebEvidenceTestSupport';
import type { ConversationSubmittedInput } from '../../../ragConversation/conversationSubmittedInput';
import type { RagConversationObserver } from '../../../ragConversation/conversationObserver';
import { currentMedicalDocumentGeneration } from '../../../medicalDocuments/medicalDocumentLifecycle';
test('photo-only OCR crosses explicit consent, provider, protected save and fresh restore', async () => {
  const db = openSqliteTestDatabase(':memory:');
  const previous = NativeModules.MedicalDocumentImportModule;
  NativeModules.MedicalDocumentImportModule = {
    ensureMedicalDocumentOriginal: jest.fn().mockResolvedValue(undefined),
  };
  const f = publicEvidenceFixture();
  const generate = jest.fn().mockResolvedValue(
    providerSuccess({
      text: JSON.stringify({
        type: 'result',
        value: {
          answerKind: 'grounded',
          answer: '사진에 합성 문구가 있어요.',
        },
        citations: ['e2'],
      }),
      toolCalls: [],
      finishReason: 'complete',
    }),
  );
  const provider = {
    ...f.selected.provider,
    searchPublicWeb: undefined,
    generate,
    capabilities: {
      ...f.selected.provider.capabilities,
      streaming: false,
      toolCalling: false,
      structuredOutput: false,
    },
  };
  const selected = {
    ...f.selected,
    provider,
    recipient: 'device',
    remoteProcessing: false,
  };
  const submitted: ConversationSubmittedInput = {
    schemaVersion: 1,
    inputRevision: 1,
    sessionId: 'session',
    requestId: 'request',
    question: '',
    ocr: {
      providerId: provider.id,
      modelId: selected.modelId,
      recipient: selected.recipient,
      remoteProcessing: false,
      consentScope: {
        purpose: 'record_conversation',
        policyVersion: 'local-records-v1',
        dataCategories: [
          'health_records',
          'reviewed_memory',
          'conversation',
          'medical_literature',
          'photo_ocr',
        ],
      },
      source: {
        id: '12345678-1234-4234-8234-123456789abc',
        contentHash: `sha256:${'a'.repeat(64)}`,
      },
      deletionGeneration: 0,
      sections: [
        { id: 'section', text: 'synthetic OCR', startOffset: 0, endOffset: 13 },
      ],
    },
  };
  try {
    await runMigrations(db.database);
    const storage = createConversationArtifactStorage(db.database);
    await storage.createSession('session', await storage.currentGeneration());
    const createdAt = '2026-11-13T00:00:00.000Z';
    await storage.startRequest({
      id: 'request',
      sessionId: 'session',
      sessionVersion: 0,
      question: '',
      createdAt,
      submittedInput: submitted,
    });
    const validate = createConversationPhotoInputValidator(storage);
    const data = {
      ...localData([]).data,
      openConversationArtifactStorage: async () => storage,
      validateConversationPhotoInput: validate,
    };
    const registry = new LocalEvidenceReferenceRegistry();
    const photoConsent = jest
      .fn()
      .mockResolvedValueOnce(false)
      .mockResolvedValue(true);
    let currentSelection = selected;
    const service = createRagConversationService({
      consent: f.consent,
      queryConsent: { authorize: async () => 'authorized' },
      externalEvidence: { search: jest.fn() },
      loadLocalData: async () => data,
      selectedAi: async () => currentSelection,
      registry,
      ragRunner: runRagConversationTurn,
    });
    const observer: RagConversationObserver = {
      retentionSession: { id: 'session', version: 0 },
      photoInput: {
        submitted,
        stagingGeneration: currentMedicalDocumentGeneration(),
        confirm: photoConsent,
      },
      onRetentionCandidate: async candidate => {
        await storage.append({
          ...candidate,
          id: 'request',
          sessionId: 'session',
          createdAt,
          status: candidate.status ?? 'complete',
        });
      },
    };
    currentSelection = { ...selected, modelId: 'changed-model' };
    expect((await service('', [], undefined, observer)).status).toBe('failure');
    expect(photoConsent).not.toHaveBeenCalled();
    expect(generate).not.toHaveBeenCalled();
    currentSelection = selected;
    expect(await service('', [], undefined, observer)).toMatchObject({
      status: 'failure',
      kind: 'consent_required',
    });
    expect(generate).not.toHaveBeenCalled();
    const outcome = await service('', [], undefined, observer);
    expect(outcome.status).toBe('answer');
    expect(photoConsent).toHaveBeenCalledTimes(2);
    expect(photoConsent).toHaveBeenLastCalledWith(
      expect.objectContaining({
        providerName: provider.displayName,
        modelId: selected.modelId,
        recipient: selected.recipient,
        remoteProcessing: false,
      }),
      expect.any(AbortSignal),
    );
    const saved = await storage.read('request');
    expect(saved?.submittedInput?.question).toBe('');
    expect(saved?.sources).toEqual([
      expect.objectContaining({
        kind: 'conversation_photo',
        requestId: 'request',
        sectionId: 'section',
      }),
    ]);
    const restored = await restoreConversationArtifact({
      id: 'request',
      storage,
      registry: new LocalEvidenceReferenceRegistry(),
      data,
      signal: new AbortController().signal,
    });
    expect(restored?.answer).toContain('합성 문구');
    Object.assign(data, {
      conversationArtifactDiscovery: async (
        currentRegistry: LocalEvidenceReferenceRegistry,
      ) =>
        createConversationArtifactDiscovery({
          database: db.database,
          storage,
          registry: currentRegistry,
          data,
        }),
    });
    await storage.startRequest({
      id: 'follow-up',
      sessionId: 'session',
      sessionVersion: 0,
      question: '다시 설명해 줘',
      createdAt: '2026-11-13T00:01:00.000Z',
    });
    generate.mockResolvedValueOnce(
      providerSuccess({
        text: JSON.stringify({
          type: 'result',
          value: { answerKind: 'conversation', answer: '다시 설명할게요.' },
          citations: [],
        }),
        toolCalls: [],
        finishReason: 'complete',
      }),
    );
    const followUp = await service('다시 설명해 줘', [], undefined, {
      retentionSession: { id: 'session', version: 0 },
      retainedHistory: [{ id: 'request', question: '' }],
      onRetentionCandidate: async candidate => {
        await storage.append({
          ...candidate,
          id: 'follow-up',
          sessionId: 'session',
          createdAt: '2026-11-13T00:01:00.000Z',
          status: candidate.status ?? 'complete',
        });
      },
    });
    expect(followUp.status).toBe('answer');
    expect((await storage.read('follow-up'))?.sources).toContainEqual(
      expect.objectContaining({
        kind: 'generated_conversation',
        id: 'request',
      }),
    );
    expect(
      await restoreConversationArtifact({
        id: 'follow-up',
        storage,
        registry: new LocalEvidenceReferenceRegistry(),
        data,
        signal: new AbortController().signal,
      }),
    ).not.toBeNull();
    await storage.invalidateRequestSource(submitted.ocr!.source.id);
    expect(await storage.read('follow-up')).toBeNull();
    expect(
      await restoreConversationArtifact({
        id: 'request',
        storage,
        registry: new LocalEvidenceReferenceRegistry(),
        data,
        signal: new AbortController().signal,
      }),
    ).toBeNull();
  } finally {
    NativeModules.MedicalDocumentImportModule = previous;
    db.close();
  }
});
