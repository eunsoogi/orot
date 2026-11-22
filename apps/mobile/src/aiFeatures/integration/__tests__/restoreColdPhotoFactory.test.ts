import { coldPhotoGenerate } from '../testSupport/coldPhotoGenerate';
import { runContinuableConversationWorkflow } from '../../../ragConversation/conversationWorkflowContinuation';
import { createConversationColdResumeStorage } from '../../../storage/conversationColdResumeStorage';
import { runColdConversationWorkflow } from '../../../ragConversation/runColdConversationWorkflow';
import { captureColdRagConversationState } from '../coldRagConversationState';
import { restoreColdRagConversationFactory } from '../restoreColdRagConversationFactory';
import {
  continuationInput,
  continuationManifest,
} from '../../../storage/conversationWorkflowContinuationIdentity';
import { coldRagFactoryFixture } from '../testSupport/coldRagFactoryFixture';
import { NativeModules } from 'react-native';
import { runMigrations } from '@orot/storage';
import { openSqliteTestDatabase } from '../../../../../../packages/storage/__tests__/sqliteTestDatabase';
import { createConversationArtifactStorage } from '../../../storage/conversationArtifactStorage';
import { createConversationPhotoInputValidator } from '../conversationPhotoInputValidation';
import { registerConversationPhotoEvidence } from '../conversationPhotoEvidence';
import type { AiFeatureLocalData } from '../localData';
import type { ConversationSubmittedInput } from '../../../ragConversation/conversationSubmittedInput';
import { restoreColdPhotoExecution } from '../restoreColdPhotoExecution';
test.each([true, false])(
  'cold photo reconstruction rechecks settings authorization: %s',
  async allow => {
    const db = openSqliteTestDatabase(':memory:');
    const previous = NativeModules.MedicalDocumentImportModule;
    const ensure = jest.fn().mockResolvedValue(undefined);
    NativeModules.MedicalDocumentImportModule = {
      ensureMedicalDocumentOriginal: ensure,
    };
    const f = await coldRagFactoryFixture({
      version: 1,
      status: 'consent_required',
      charged: true,
    });
    const submitted: ConversationSubmittedInput = {
      schemaVersion: 1,
      inputRevision: 1,
      sessionId: 'session',
      requestId: 'request',
      question: f.options.request,
      ocr: {
        providerId: f.selected.provider.id,
        modelId: f.selected.modelId,
        recipient: f.selected.recipient,
        remoteProcessing: f.selected.remoteProcessing,
        consentScope: {
          ...f.options.execution.consentScope,
          dataCategories: [
            ...f.options.execution.consentScope.dataCategories,
            'photo_ocr',
          ],
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
        question: f.options.request,
        createdAt: '2026-11-13T00:00:00.000Z',
        submittedInput: submitted,
      });
      const validate = createConversationPhotoInputValidator(storage);
      const registry = f.registry;
      const signal = new AbortController().signal;
      const [item] = registerConversationPhotoEvidence({
        submitted,
        registry,
        isCurrent: currentSignal => validate(submitted, currentSignal),
      });
      const confirm = jest.fn().mockResolvedValue(true);
      const selected = f.selected;
      const base = f.options;
      f.local.data.openConversationArtifactStorage = async () => storage;
      f.local.data.validateConversationPhotoInput = validate;
      const binding = await restoreColdPhotoExecution({
        base,
        selected,
        submitted,
        owner: {
          requestId: 'request',
          sessionId: 'session',
          sessionVersion: 0,
        },
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
      const generate = coldPhotoGenerate();
      const provider = { ...selected.provider, generate, stream: undefined };
      f.dependencies.selectedAi.mockResolvedValue({ ...selected, provider });
      const options = {
        ...f.options,
        ...binding,
        provider,
        initialSearch: undefined,
        initialEvidence: { items: [item!], coverage: [], conflicts: [] },
      };
      const owner = {
        requestId: 'request',
        sessionId: 'session',
        sessionVersion: 0,
      };
      const descriptor = {
        ...f.descriptor,
        submittedInput: JSON.stringify(submitted),
        request: submitted.question,
        manifest: continuationManifest(
          owner,
          'conversation-resume:request',
          options,
        ),
        exactInput: continuationInput(options),
        reconstruction: await captureColdRagConversationState({
          registry,
          tracker: f.tracker,
          external: f.external,
          sessionId: 'session',
          operationRunId: 'run',
          knownCallIds: [],
          batches: [options.initialEvidence],
          options,
          signal,
        }),
      };
      Object.assign(descriptor.reconstruction, {
        completion: f.descriptor.reconstruction.completion!,
        publicSearch: { version: 1, status: 'consent_required', charged: true },
      });
      const restored = await restoreColdRagConversationFactory({
        descriptor,
        dependencies: f.dependencies,
        signal,
        observer: { confirmPhotoResume: confirm },
        readKnownCallIds: async () => [],
      });
      expect(continuationInput(restored.options)).toBe(descriptor.exactInput);
      expect(restored.registry.resolve(item!)).toEqual(registry.resolve(item!));
      expect(restored.submittedInput).toEqual(submitted);
      expect(confirm).not.toHaveBeenCalled();
      for (const operation of [f.authorize, f.search])
        expect(operation).not.toHaveBeenCalled();
      await expect(
        restoreColdRagConversationFactory({
          descriptor,
          dependencies: f.dependencies,
          signal,
          readKnownCallIds: async () => [],
        }),
      ).rejects.toThrow();
      let pause = () => {};
      f.authorize.mockImplementationOnce(async () => {
        pause();
        return 'authorized';
      });
      const persisted = await storage.openWorkflowContinuation(
        owner,
        async input => ({
          completion: f.descriptor.reconstruction.completion!,
          publicSearch: {
            version: 1,
            status: 'consent_required',
            charged: true,
          },
          ...(await captureColdRagConversationState({
            registry,
            tracker: f.tracker,
            external: f.external,
            sessionId: 'session',
            operationRunId: 'run',
            knownCallIds: input.knownCallIds,
            batches: input.evidenceBatches!,
            options,
            signal,
          })),
        }),
      );
      const paused = await runContinuableConversationWorkflow(
        options,
        {},
        {
          persisted,
          bindPause: next => {
            pause = next;
          },
          waitForContinue: async () => false,
        },
      );
      expect(paused.status).toBe('paused');
      expect(generate).not.toHaveBeenCalled();
      const saved = await createConversationColdResumeStorage(db.database).open(
        owner,
      );
      expect(saved).toBeDefined();
      const coldConfirm = jest.fn().mockResolvedValue(true);
      const factory = await restoreColdRagConversationFactory({
        descriptor: saved!,
        dependencies: f.dependencies,
        signal,
        observer: { confirmPhotoResume: coldConfirm },
        readKnownCallIds: async () => [],
      });
      f.authorize.mockResolvedValue(allow ? 'authorized' : 'renewal_required');
      const result = await runColdConversationWorkflow({
        database: db.database,
        descriptor: saved!,
        options: factory.options,
        invocation: { signal },
        validateSelection: factory.validateSelection,
        capture: factory.capture,
      });
      expect(result.status).toBe(allow ? 'result' : 'consent_required');
      expect(coldConfirm).not.toHaveBeenCalled();
      expect(f.authorize).toHaveBeenCalled();
      expect(generate).toHaveBeenCalledTimes(allow ? 1 : 0);
      await expect(
        runColdConversationWorkflow({
          database: db.database,
          descriptor: saved!,
          options: factory.options,
          invocation: { signal },
          validateSelection: factory.validateSelection,
          capture: factory.capture,
        }),
      ).rejects.toThrow();
      expect(generate).toHaveBeenCalledTimes(allow ? 1 : 0);
    } finally {
      NativeModules.MedicalDocumentImportModule = previous;
      db.close();
    }
  },
);
