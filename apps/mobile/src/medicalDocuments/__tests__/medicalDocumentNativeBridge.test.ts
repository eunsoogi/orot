import { NativeModules } from 'react-native';
import type { AgentMemoryService } from '@orot/agent-memory';
import type { RecordRepository } from '@orot/storage';
import {
  getProtectedMedicalDocumentSourceIds,
  markMedicalDocumentPersisted,
  medicalDocumentFileDeletion,
  medicalDocumentNativeBridge,
} from '../medicalDocumentNativeBridge';
import type { StagedMedicalDocument } from '../medicalDocumentNativeBridge';
import { createLocalE5RagService } from '../../rag/localE5RagService';
import {
  openLocalAgentMemoryDatabase,
  openLocalStorage,
} from '../../storage/secureDatabase';
import { removeAllLocalDataWithMemory } from '../../memory/removeAllLocalDataWithMemory';

jest.mock('../../rag/localE5RagService', () => ({
  createLocalE5RagService: jest.fn(),
}));
jest.mock('../../storage/secureDatabase', () => ({
  openLocalAgentMemoryDatabase: jest.fn(),
  openLocalStorage: jest.fn(),
}));

const stagedDocument: StagedMedicalDocument = {
  id: '77777777-7777-4777-8777-777777777777',
  displayName: 'synthetic-pending-note.txt',
  contentHash: `sha256:${'c'.repeat(64)}`,
  sections: [
    {
      id: '88888888-8888-4888-8888-888888888888',
      text: 'Synthetic pending note',
      startOffset: 0,
      endOffset: 22,
    },
  ],
};

test('keeps a selected original protected until a fresh database snapshot reconciles it', async () => {
  const previousNativeModule = NativeModules.MedicalDocumentImportModule;
  let resolvePick!: (document: StagedMedicalDocument) => void;
  const pickResult = new Promise<StagedMedicalDocument>(resolve => {
    resolvePick = resolve;
  });
  const reconcileMedicalDocumentFiles = jest.fn().mockResolvedValue(undefined);
  NativeModules.MedicalDocumentImportModule = {
    pickMedicalDocument: jest.fn(() => pickResult),
    discardMedicalDocument: jest.fn().mockResolvedValue(undefined),
    ensureMedicalDocumentOriginal: jest.fn().mockResolvedValue(undefined),
    reconcileMedicalDocumentFiles,
    stageMedicalDocumentDeletion: jest.fn().mockResolvedValue(undefined),
    restoreMedicalDocumentDeletion: jest.fn().mockResolvedValue(undefined),
    commitMedicalDocumentDeletion: jest.fn().mockResolvedValue(undefined),
  };

  try {
    const picking = medicalDocumentNativeBridge.pick();
    const selectionSnapshot = Promise.resolve(
      getProtectedMedicalDocumentSourceIds(),
    );
    resolvePick(stagedDocument);
    await expect(picking).resolves.toEqual(stagedDocument);
    await expect(selectionSnapshot).resolves.toEqual([stagedDocument.id]);

    markMedicalDocumentPersisted(stagedDocument.id);
    await medicalDocumentFileDeletion.reconcile([]);
    expect(reconcileMedicalDocumentFiles).toHaveBeenLastCalledWith([
      stagedDocument.id,
    ]);
    await expect(getProtectedMedicalDocumentSourceIds()).resolves.toEqual([
      stagedDocument.id,
    ]);

    await medicalDocumentFileDeletion.reconcile([stagedDocument.id]);
    await expect(getProtectedMedicalDocumentSourceIds()).resolves.toEqual([]);
  } finally {
    if (previousNativeModule === undefined) {
      delete NativeModules.MedicalDocumentImportModule;
    } else {
      NativeModules.MedicalDocumentImportModule = previousNativeModule;
    }
  }
});

test('restores an unsaved original without losing protection after local deletion rolls back', async () => {
  const previousNativeModule = NativeModules.MedicalDocumentImportModule;
  const activeDocument = {
    ...stagedDocument,
    id: '99999999-9999-4999-8999-999999999999',
  };
  const reconcileMedicalDocumentFiles = jest.fn().mockResolvedValue(undefined);
  const restoreMedicalDocumentDeletion = jest.fn().mockResolvedValue(undefined);
  NativeModules.MedicalDocumentImportModule = {
    pickMedicalDocument: jest.fn().mockResolvedValue(activeDocument),
    discardMedicalDocument: jest.fn().mockResolvedValue(undefined),
    ensureMedicalDocumentOriginal: jest.fn().mockResolvedValue(undefined),
    reconcileMedicalDocumentFiles,
    stageMedicalDocumentDeletion: jest.fn().mockResolvedValue(undefined),
    restoreMedicalDocumentDeletion,
    commitMedicalDocumentDeletion: jest.fn().mockResolvedValue(undefined),
  };

  const deletionFailure = new Error('Synthetic local deletion failure.');
  const repository = {
    list: jest.fn().mockResolvedValue([]),
    listAllLocalDeletionReferences: jest.fn().mockResolvedValue([]),
    deleteAllLocalData: jest.fn().mockRejectedValue(deletionFailure),
  } as unknown as RecordRepository;
  const prepare = jest.fn().mockResolvedValue(undefined);
  const clear = jest.fn().mockResolvedValue(undefined);
  const memory = {
    forgetAll: jest.fn().mockResolvedValue(0),
  } as unknown as AgentMemoryService;

  jest.mocked(openLocalAgentMemoryDatabase).mockResolvedValue({} as never);
  jest.mocked(openLocalStorage).mockResolvedValue(repository);
  jest
    .mocked(createLocalE5RagService)
    .mockReturnValue({ prepare, clear } as never);
  await medicalDocumentNativeBridge.pick();

  try {
    await expect(
      removeAllLocalDataWithMemory(memory, {
        audioDeletion: {
          reconcile: jest.fn().mockResolvedValue(undefined),
          stage: jest.fn().mockResolvedValue(undefined),
          restore: jest.fn().mockResolvedValue(undefined),
          commit: jest.fn().mockResolvedValue(undefined),
        },
      }),
    ).rejects.toBe(deletionFailure);

    expect(restoreMedicalDocumentDeletion).toHaveBeenCalledWith(
      activeDocument.id,
    );
    await medicalDocumentFileDeletion.reconcile([]);
    expect(reconcileMedicalDocumentFiles).toHaveBeenLastCalledWith([
      activeDocument.id,
    ]);
    await expect(getProtectedMedicalDocumentSourceIds()).resolves.toEqual([
      activeDocument.id,
    ]);
  } finally {
    await medicalDocumentNativeBridge.discard(activeDocument.id);
    if (previousNativeModule === undefined) {
      delete NativeModules.MedicalDocumentImportModule;
    } else {
      NativeModules.MedicalDocumentImportModule = previousNativeModule;
    }
  }
});
