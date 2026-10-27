import { NativeModules } from 'react-native';
import type { AgentMemoryService } from '@orot/agent-memory';
import type { RecordRepository } from '@orot/storage';
import { createLocalE5RagService } from '../../rag/localE5RagService';
import { removeAllLocalDataWithMemory } from '../../memory/removeAllLocalDataWithMemory';
import {
  openLocalAgentMemoryDatabase,
  openLocalStorage,
} from '../../storage/secureDatabase';
import { createMedicalDocumentImportService } from '../medicalDocumentImportService';
import {
  getProtectedMedicalDocumentSourceIds,
  medicalDocumentFileDeletion,
  medicalDocumentNativeBridge,
  type StagedMedicalDocument,
} from '../medicalDocumentNativeBridge';
import { currentMedicalDocumentGeneration } from '../medicalDocumentLifecycle';

jest.mock('../../rag/localE5RagService', () => ({
  createLocalE5RagService: jest.fn(),
}));
jest.mock('../../storage/secureDatabase', () => ({
  openLocalAgentMemoryDatabase: jest.fn(),
  openLocalStorage: jest.fn(),
}));

const stagedDocument: StagedMedicalDocument = {
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  displayName: 'synthetic-delayed-save.txt',
  contentHash: `sha256:${'a'.repeat(64)}`,
  sections: [
    {
      id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      text: 'Synthetic delayed save',
      startOffset: 0,
      endOffset: 23,
    },
  ],
};

test('a save paused before persistence cannot re-protect a deleted source', async () => {
  const previousNativeModule = NativeModules.MedicalDocumentImportModule;
  NativeModules.MedicalDocumentImportModule = {
    pickMedicalDocument: jest.fn().mockResolvedValue(stagedDocument),
    discardMedicalDocument: jest.fn().mockResolvedValue(undefined),
    ensureMedicalDocumentOriginal: jest.fn().mockResolvedValue(undefined),
    reconcileMedicalDocumentFiles: jest.fn().mockResolvedValue(undefined),
    stageMedicalDocumentDeletion: jest.fn().mockResolvedValue(undefined),
    restoreMedicalDocumentDeletion: jest.fn().mockResolvedValue(undefined),
    commitMedicalDocumentDeletion: jest.fn().mockResolvedValue(undefined),
  };

  let signalLookupStarted!: () => void;
  const lookupStarted = new Promise<void>(resolve => {
    signalLookupStarted = resolve;
  });
  // Hold the database lookup across deletion to exercise a save that resumes on the stale epoch.
  let resolveHashLookup!: (source: null) => void;
  const hashLookup = new Promise<null>(resolve => {
    resolveHashLookup = resolve;
  });
  const findByContentHash = jest.fn(() => {
    signalLookupStarted();
    return hashLookup;
  });
  const repository = {
    list: jest.fn().mockResolvedValue([]),
    sourceRecords: { findByContentHash },
    listAllLocalDeletionReferences: jest.fn().mockResolvedValue([]),
    deleteAllLocalData: jest.fn().mockResolvedValue({ sourceRecordIds: [] }),
    transaction: jest.fn(),
  } as unknown as RecordRepository;
  jest.mocked(openLocalAgentMemoryDatabase).mockResolvedValue({} as never);
  jest.mocked(openLocalStorage).mockResolvedValue(repository);
  jest
    .mocked(createLocalE5RagService)
    .mockReturnValue({ prepare: jest.fn(), clear: jest.fn() } as never);
  const memory = {
    forgetAll: jest.fn().mockResolvedValue(0),
  } as unknown as AgentMemoryService;
  const service = createMedicalDocumentImportService({
    loadRepository: async () => repository,
    now: () => '2026-10-26T10:00:00.000Z',
  });

  try {
    await expect(service.selectDocument()).resolves.toEqual(stagedDocument);
    const preDeleteGeneration = currentMedicalDocumentGeneration();
    const saving = service.saveDocument(stagedDocument);
    await lookupStarted;

    await expect(
      removeAllLocalDataWithMemory(memory, {
        audioDeletion: {
          reconcile: jest.fn().mockResolvedValue(undefined),
          stage: jest.fn().mockResolvedValue(undefined),
          restore: jest.fn().mockResolvedValue(undefined),
          commit: jest.fn().mockResolvedValue(undefined),
        },
      }),
    ).resolves.toMatchObject({ medicalDocumentCleanupPending: false });

    resolveHashLookup(null);
    await expect(saving).rejects.toMatchObject({ code: 'IMPORT_FAILED' });
    expect(repository.transaction).not.toHaveBeenCalled();
    await expect(getProtectedMedicalDocumentSourceIds()).resolves.toEqual([]);
    const nativeReconcile =
      NativeModules.MedicalDocumentImportModule.reconcileMedicalDocumentFiles;
    const reconcileCalls = nativeReconcile.mock.calls.length;
    await medicalDocumentFileDeletion.reconcile(
      [stagedDocument.id],
      preDeleteGeneration,
    );
    expect(nativeReconcile).toHaveBeenCalledTimes(reconcileCalls);
  } finally {
    await medicalDocumentNativeBridge.discard(stagedDocument.id);
    if (previousNativeModule === undefined) {
      delete NativeModules.MedicalDocumentImportModule;
    } else {
      NativeModules.MedicalDocumentImportModule = previousNativeModule;
    }
  }
});
