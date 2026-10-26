import { NativeModules } from 'react-native';
import {
  getProtectedMedicalDocumentSourceIds,
  markMedicalDocumentPersisted,
  medicalDocumentFileDeletion,
  medicalDocumentNativeBridge,
} from '../medicalDocumentNativeBridge';
import type { StagedMedicalDocument } from '../medicalDocumentNativeBridge';

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
