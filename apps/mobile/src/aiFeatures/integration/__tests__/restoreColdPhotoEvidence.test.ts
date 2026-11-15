import { restoreColdConversationRegistry } from '../restoreColdConversationRegistry';
import { NativeModules } from 'react-native';
import { runMigrations } from '@orot/storage';
import { openSqliteTestDatabase } from '../../../../../../packages/storage/__tests__/sqliteTestDatabase';
import { createConversationArtifactStorage } from '../../../storage/conversationArtifactStorage';
import { createConversationPhotoInputValidator } from '../conversationPhotoInputValidation';
import { LocalEvidenceReferenceRegistry } from '../evidenceRegistry';
import { registerConversationPhotoEvidence } from '../conversationPhotoEvidence';
import { restoreColdPhotoEvidence } from '../restoreColdPhotoEvidence';
import type { AiFeatureLocalData } from '../localData';
import type { ConversationSubmittedInput } from '../../../ragConversation/conversationSubmittedInput';

// Actual SQLite ownership; original-file bridge is synthetic, never a user's attachment.
test.each([
  'valid',
  'native-missing',
  'generation',
  'section',
  'owner',
] as const)(
  'cold photo readers preserve exact protected ownership: %s',
  async mode => {
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
      const destination = new LocalEvidenceReferenceRegistry();
      const reference = registry.resolve(item!)!;
      const source = {
        kind: 'conversation_photo' as const,
        reference,
        requestId: 'request',
        sectionId: mode === 'section' ? 'other' : 'section',
      };
      if (mode === 'native-missing')
        ensure.mockRejectedValue(new Error('missing original'));
      if (mode === 'generation') await storage.hideSession('session');
      const restore = () =>
        restoreColdPhotoEvidence({
          submitted,
          owner: {
            requestId: mode === 'owner' ? 'other' : 'request',
            sessionId: 'session',
            sessionVersion: 0,
          },
          sources: [source],
          registry: destination,
          signal,
          data: {
            openConversationArtifactStorage: async () => storage,
            validateConversationPhotoInput: validate,
          } as AiFeatureLocalData,
        });
      if (mode !== 'valid') {
        await expect(restore()).rejects.toThrow();
        expect(destination.snapshot().entries).toHaveLength(0);
      } else {
        const restored = await restore();
        expect(destination.resolve(restored[0]!)).toEqual(reference);
        expect(
          (await destination.readSource(restored[0]!, signal)).status,
        ).toBe('available');
        const cold = await restoreColdConversationRegistry({
          snapshot: registry.snapshot(),
          sources: [source],
          signal,
          photo: {
            submitted,
            owner: {
              requestId: 'request',
              sessionId: 'session',
              sessionVersion: 0,
            },
          },
          data: {
            openConversationArtifactStorage: async () => storage,
            validateConversationPhotoInput: validate,
          } as AiFeatureLocalData,
        });
        expect(cold.resolve(item!)).toEqual(reference);
        expect((await cold.readSource(item!, signal)).status).toBe('available');
        await storage.invalidateRequestSource(submitted.ocr!.source.id);
        expect(await cold.revalidateEvidence([item!], signal)).toBe(false);
        expect(await destination.revalidateEvidence(restored, signal)).toBe(
          false,
        );
      }
    } finally {
      NativeModules.MedicalDocumentImportModule = previous;
      db.close();
    }
  },
);
